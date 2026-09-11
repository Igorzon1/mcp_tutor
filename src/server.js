import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { Store, AppError } from './store.js';
import { APP_VERSION, TOOL_DEFINITIONS, sessionSchema } from './schema.js';
import { AgentRunner, openingMessage } from './agent.js';
import { root, dataDirectory, port, baseUrl } from './paths.js';
import { demoSession } from './demo.js';

const store = await new Store(dataDirectory).init();
const agent = new AgentRunner({ root });
const token = randomBytes(32).toString('hex');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([...hosts].map(host => `http://${host}`));
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/message-format.js', ['message-format.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const sse = new Set();
assets.set('/exercise-worker.js', ['exercise-worker.js', 'text/javascript; charset=utf-8']);
assets.set('/study-layout.js', ['study-layout.js', 'text/javascript; charset=utf-8']);
assets.set('/code-editor.js', ['code-editor.js', 'text/javascript; charset=utf-8']);
const panelSessionSchema = sessionSchema.extend({ startTutor: z.boolean().default(false) });

async function answerChat(id, learnerBody, existingMessage) {
  let learnerMessage = existingMessage;
  let answer;
  try {
    answer = await agent.reply(store.get(id), learnerBody, {
      beforeRun: async () => { learnerMessage = existingMessage || await store.message(id, learnerBody); },
    });
  } catch (error) {
    if (learnerMessage && error.status !== 499 && error.status !== 409) await store.tutorMessage(id, 'Não consegui alcançar o agente agora. A sua mensagem ficou salva nesta aula; tente novamente ou continue pelo cliente MCP conectado.', 'Conexão do tutor').catch(() => {});
    throw error;
  }
  const tutorMessage = await store.tutorMessage(id, answer);
  return { learnerMessage, tutorMessage, agent: agent.status(id) };
}

function json(response, status, data) { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(data)); }
async function body(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new AppError('Use application/json.', 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 160000) throw new AppError('O envio excede 160 KB.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new AppError('JSON inválido.'); }
}
const linkSession = session => ({ ...session, url: `${baseUrl}/#session=${session.id}` });
async function callTool(name, raw) {
  const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
  if (!definition) throw new AppError('Ferramenta não encontrada.', 404);
  const args = definition.schema.parse(raw);
  switch (name) {
    case 'tutor_start_session': return linkSession(await store.create(args));
    case 'tutor_list_sessions': return { sessions: store.list().map(linkSession) };
    case 'tutor_get_session': return linkSession(store.get(args.sessionId));
    case 'tutor_set_learning_plan': return store.setLearningPlan(args.sessionId, args);
    case 'tutor_add_block': {
      agent.assertCanAddBlock(args.sessionId, args.block);
      return { block: await store.addBlock(args.sessionId, args.block), url: `${baseUrl}/#session=${args.sessionId}` };
    }
    case 'tutor_get_events': return store.getEvents(args.sessionId, args.after, args.waitSeconds);
    case 'tutor_review_attempt': return store.review(args.sessionId, { attemptId: args.attemptId, passed: args.passed, feedback: args.feedback });
    case 'tutor_advance_stage': return store.advanceStage(args.sessionId, args);
  }
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (!hosts.has(request.headers.host)) throw new AppError('Host não permitido.', 403);
    if (request.headers.origin && !origins.has(request.headers.origin)) throw new AppError('Origem não permitida.', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('Requisição entre sites bloqueada.', 403);
    const url = new URL(request.url, baseUrl);
    const bridge = request.headers.authorization === `Bearer ${token}`;
    const cookie = (request.headers.cookie || '').split(';').some(part => part.trim() === `tutor_session=${token}`);
    if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { app: 'mcp-tutor', version: APP_VERSION, status: 'ready', agent: agent.status() });
    if (assets.has(url.pathname) && request.method === 'GET') {
      const [file, type] = assets.get(url.pathname);
      if (url.pathname === '/') response.setHeader('Set-Cookie', `tutor_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      if (url.pathname === '/exercise-worker.js') response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      response.writeHead(200, { 'Content-Type': type });
      return response.end(await readFile(join(root, 'public', file)));
    }
    if (!bridge && !cookie) throw new AppError('Abra o painel local para iniciar sua conexão.', 401);
    if (request.method === 'POST' && !bridge && (!origins.has(request.headers.origin) || request.headers['x-tutor-client'] !== 'browser')) throw new AppError('Envio não autorizado.', 403);
    if (url.pathname === '/bridge/tool' && request.method === 'POST') {
      if (!bridge) throw new AppError('Esta rota exige a conexão MCP.', 403);
      const payload = await body(request);
      return json(response, 200, await callTool(payload.name, payload.args));
    }
    if (url.pathname === '/api/sessions' && request.method === 'GET') return json(response, 200, { sessions: store.list() });
    if (url.pathname === '/api/agent' && request.method === 'GET') return json(response, 200, agent.status(url.searchParams.get('sessionId')));
    if (url.pathname === '/api/sessions' && request.method === 'POST') {
      const { startTutor, ...input } = panelSessionSchema.parse(await body(request));
      const created = await store.create(input);
      if (startTutor) {
        const firstMessage = await store.message(created.id, openingMessage(input));
        // The operation belongs to the session, not to the lifetime of this HTTP request.
        // Errors are recorded by AgentRunner and surfaced through the existing retry UI.
        void answerChat(created.id, firstMessage.body, firstMessage).catch(() => {});
      }
      return json(response, 201, { ...store.get(created.id, true), url: `${baseUrl}/#session=${created.id}` });
    }
    if (url.pathname === '/api/demo' && request.method === 'POST') { await body(request); return json(response, 201, store.get((await store.create(demoSession, true)).id, true)); }
    const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(attempts|hints|messages|chat(?:\/cancel)?|events))?$/);
    if (!match) throw new AppError('Rota não encontrada.', 404);
    const [, id, action] = match;
    store.session(id);
    if (!action && request.method === 'GET') return json(response, 200, store.get(id, true));
    if (action === 'events' && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      response.write(`data: ${JSON.stringify({ revision: store.session(id).revision })}\n\n`);
      const listener = changed => { if (changed === id) response.write(`data: ${JSON.stringify({ revision: store.session(id).revision })}\n\n`); };
      store.events.on('change', listener);
      sse.add(response);
      const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 20000);
      request.on('close', () => { clearInterval(heartbeat); store.events.off('change', listener); sse.delete(response); });
      return;
    }
    if (action === 'chat/cancel' && request.method === 'POST') {
      const result = await agent.cancel(id);
      return json(response, 200, { cancelled: result.cancelled, agent: agent.status(id) });
    }
    if (request.method === 'POST') {
      const input = await body(request);
      if (action === 'attempts') return json(response, 201, await store.submit(id, input));
      if (action === 'hints') return json(response, 200, await store.hint(id, input.blockId));
      if (action === 'messages') return json(response, 201, await store.message(id, input.body));
      if (action === 'chat') {
        const retryMessage = input.retry === true ? store.get(id).blocks.filter(block => block.role === 'learner').at(-1) : null;
        if (input.retry === true && !retryMessage) throw new AppError('Não há uma mensagem anterior para retomar.');
        const learnerBody = retryMessage?.body ?? input.body;
        return json(response, 201, await answerChat(id, learnerBody, retryMessage));
      }
    }
    throw new AppError('Método não permitido.', 405);
  } catch (error) {
    if (response.headersSent) { response.end(); return; }
    const validation = error instanceof ZodError;
    const status = validation ? 400 : error.status || 500;
    if (status === 500) console.error(error);
    json(response, status, { error: validation ? error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') : status === 500 ? 'Não foi possível concluir a operação.' : error.message });
  }
});
server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `A porta ${port} está ocupada. Se o tutor já estiver aberto, use ${baseUrl}. Para outra instância, defina TUTOR_PORT e TUTOR_DATA_DIR distintos.` : error); process.exit(1); });
server.listen(port, '127.0.0.1', async () => {
  await writeFile(join(dataDirectory, 'runtime.json'), JSON.stringify({ token, port, pid: process.pid }), { mode: 0o600 });
  console.error(`MCP Tutor pronto: ${baseUrl}`);
});
function shutdown() {
  for (const response of sse) response.end();
  server.close(async () => { await store.queue; process.exit(0); });
  server.closeIdleConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
