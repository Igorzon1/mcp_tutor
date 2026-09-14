import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z, ZodError } from 'zod';
import { Store, AppError } from './store.js';
import { TOOL_DEFINITIONS } from './schema.js';
import { root, dataDirectory, port, baseUrl } from './paths.js';
import { demoSession } from './demo.js';
import { programmingDemo } from './programming-demos.js';
import { CodeRunner } from './runner.js';

const runner = new CodeRunner();
const store = await new Store(dataDirectory, { runner }).init();
const token = randomBytes(32).toString('hex');
const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
const origins = new Set([...hosts].map(host => `http://${host}`));
const assets = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['style.css', 'text/css; charset=utf-8']]]);
const sse = new Set();
assets.set('/lab.js', ['lab.js', 'text/javascript; charset=utf-8']);
assets.set('/reviews.js', ['reviews.js', 'text/javascript; charset=utf-8']);

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
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError('Envie um objeto JSON válido.'); }
}
const linkSession = session => ({ ...session, url: `${baseUrl}/#session=${session.id}` });
async function callTool(name, raw, signal) {
  const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
  if (!definition) throw new AppError('Ferramenta não encontrada.', 404);
  const args = definition.schema.parse(raw);
  switch (name) {
    case 'tutor_start_session': return linkSession(await store.create(args));
    case 'tutor_list_sessions': return { sessions: store.list().map(linkSession) };
    case 'tutor_get_session': return linkSession(store.get(args.sessionId));
    case 'tutor_add_block': return { block: await store.addBlock(args.sessionId, args.block), url: `${baseUrl}/#session=${args.sessionId}` };
    case 'tutor_get_events': return store.getEvents(args.sessionId, args.after, args.waitSeconds);
    case 'tutor_review_attempt': return store.review(args.sessionId, { attemptId: args.attemptId, passed: args.passed, feedback: args.feedback });
    case 'tutor_list_runtimes': return runner.capabilities();
    case 'tutor_run_code': return runner.run(args, { signal });
    case 'tutor_schedule_review': { const { sessionId, ...input } = args; return store.scheduleReview(sessionId, input); }
    case 'tutor_get_reviews': return { reviews: store.getReviews(args.sessionId) };
  }
}

const server = createServer(async (request, response) => {
  const controller = new AbortController();
  response.on('close', () => { if (!response.writableEnded) controller.abort(); });
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  try {
    if (!hosts.has(request.headers.host)) throw new AppError('Host não permitido.', 403);
    if (request.headers.origin && !origins.has(request.headers.origin)) throw new AppError('Origem não permitida.', 403);
    if (request.headers['sec-fetch-site'] === 'cross-site') throw new AppError('Requisição entre sites bloqueada.', 403);
    const url = new URL(request.url, baseUrl);
    const bridge = request.headers.authorization === `Bearer ${token}`;
    const cookie = (request.headers.cookie || '').split(';').some(part => part.trim() === `tutor_session=${token}`);
    if (url.pathname === '/health' && request.method === 'GET') return json(response, 200, { app: 'mcp-tutor', version: '0.2.0' });
    if (assets.has(url.pathname) && request.method === 'GET') {
      const [file, type] = assets.get(url.pathname);
      if (url.pathname === '/') response.setHeader('Set-Cookie', `tutor_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
      response.writeHead(200, { 'Content-Type': type });
      return response.end(await readFile(join(root, 'public', file)));
    }
    if (!bridge && !cookie) throw new AppError('Abra o painel local para iniciar sua conexão.', 401);
    if (request.method === 'POST' && !bridge && (!origins.has(request.headers.origin) || request.headers['x-tutor-client'] !== 'browser')) throw new AppError('Envio não autorizado.', 403);
    if (url.pathname === '/bridge/tool' && request.method === 'POST') {
      if (!bridge) throw new AppError('Esta rota exige a conexão MCP.', 403);
      const payload = await body(request);
      return json(response, 200, await callTool(payload.name, payload.args, controller.signal));
    }
    if (url.pathname === '/api/runtimes' && request.method === 'GET') return json(response, 200, await runner.capabilities());
    if (url.pathname === '/api/run' && request.method === 'POST') return json(response, 200, await runner.run(await body(request), { signal: controller.signal }));
    if (url.pathname === '/api/reviews' && request.method === 'GET') return json(response, 200, { reviews: store.getReviews(undefined, true) });
    if (url.pathname === '/api/demos' && request.method === 'GET') {
      const { languages } = await runner.capabilities();
      return json(response, 200, { demos: [{ language: 'html', title: 'Sua primeira página', description: 'Estrutura, significado e aparência.', available: true }, ...['python', 'java'].map(language => ({ language, title: programmingDemo(language).session.title, description: 'Entrada, variáveis e transformação de números.', available: languages.find(item => item.id === language)?.available || false }))] });
    }
    if (url.pathname === '/api/sessions' && request.method === 'GET') return json(response, 200, { sessions: store.list() });
    if (url.pathname === '/api/demo' && request.method === 'POST') {
      const { language } = z.object({ language: z.enum(['html', 'python', 'java']).default('html') }).strict().parse(await body(request));
      if (language !== 'html' && !(await runner.capabilities()).languages.find(item => item.id === language)?.available) throw new AppError('O executor dessa linguagem não está disponível. Confira o Laboratório.', 503);
      const definition = language === 'html' ? demoSession : programmingDemo(language).session;
      return json(response, 201, store.get((await store.create(definition, true, language)).id, true));
    }
    const recallMatch = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})\/reviews\/([a-f0-9-]{36})\/(recall|rate)$/);
    if (recallMatch && request.method === 'POST') {
      const [, sessionId, reviewId, action] = recallMatch;
      return json(response, 200, await store[action === 'recall' ? 'recall' : 'rateRecall'](sessionId, reviewId, await body(request)));
    }
    const match = url.pathname.match(/^\/api\/sessions\/([a-f0-9-]{36})(?:\/(attempts|hints|messages|events))?$/);
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
    if (request.method === 'POST') {
      const input = await body(request);
      if (action === 'attempts') return json(response, 201, await store.submit(id, input, { signal: controller.signal }));
      if (action === 'hints') return json(response, 200, await store.hint(id, input.blockId));
      if (action === 'messages') return json(response, 201, await store.message(id, input.body));
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
  runner.shutdown();
  for (const response of sse) response.end();
  server.close(async () => { await store.queue; process.exit(0); });
  server.closeIdleConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
