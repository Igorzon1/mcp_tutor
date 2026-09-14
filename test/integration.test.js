import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { root } from '../src/paths.js';

test('SDK MCP real ↔ serviço local ↔ ações do aluno e feedback do tutor', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-tutor-integration-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, TUTOR_DATA_DIR: directory, TUTOR_PORT: String(port) };
  const service = spawn(process.execPath, [join(root, 'src/server.js')], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let logs = '';
  service.stderr.on('data', chunk => { logs += chunk; });
  const serviceClosed = once(service, 'exit');
  const client = new Client({ name: 'tutor-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [join(root, 'src/mcp.js')], env, stderr: 'pipe' });
  t.after(async () => {
    await client.close();
    service.kill('SIGTERM');
    await serviceClosed;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (logs.includes('MCP Tutor pronto')) break;
    if (service.exitCode !== null) assert.fail(logs);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(logs, /MCP Tutor pronto/);
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="blocks"/);
  const cookie = page.headers.get('set-cookie').split(';')[0];
  const browserHeaders = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-Tutor-Client': 'browser' };
  const browserGet = path => fetch(`${base}${path}`, { headers: { Cookie: cookie } });
  const browserPost = (path, data, headers = browserHeaders) => fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(data) });
  assert.equal((await fetch(`${base}/api/sessions`)).status, 401);
  const badHostStatus = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await browserPost('/api/demo', {}, { ...browserHeaders, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await browserPost('/bridge/tool', { name: 'tutor_list_sessions', args: {} })).status, 403);
  assert.equal((await fetch(`${base}/app.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);

  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 10);
  assert.equal((await client.listPrompts()).prompts[0].name, 'active_learning_tutor');
  assert.match((await client.readResource({ uri: 'tutor://guide' })).contents[0].text, /prever/);
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent || JSON.parse(result.content[0].text);
  };
  const session = await call('tutor_start_session', { title: 'Aula de integração', goal: 'Praticar HTML', level: 'beginner' });
  assert.equal(session.mode, 'tutor');
  assert.match(session.url, new RegExp(String(port)));
  const { block } = await call('tutor_add_block', { sessionId: session.id, block: { type: 'quiz', title: 'Prever', stage: 'predict', prompt: 'Qual é o título?', options: ['p', 'h1'], correctIndex: 1, explanation: 'h1 comunica um título.', hints: ['Pense no papel do conteúdo.'] } });
  const publicSession = await (await browserGet(`/api/sessions/${session.id}`)).json();
  assert.equal(publicSession.blocks[0].correctIndex, undefined);
  const cursor = publicSession.revision;
  const waiting = call('tutor_get_events', { sessionId: session.id, after: cursor, waitSeconds: 3 });
  const submission = await browserPost(`/api/sessions/${session.id}/attempts`, { blockId: block.id, choice: 1, reasoning: 'h1 representa um título.', confidence: 2 });
  assert.equal(submission.status, 201);
  const attempt = await submission.json();
  assert.equal(attempt.result.status, 'passed');
  assert.ok((await waiting).events.some(event => event.type === 'attempt_submitted'));
  const updated = await call('tutor_get_session', { sessionId: session.id });
  assert.equal(updated.attempts[0].reasoning, 'h1 representa um título.');
  await call('tutor_review_attempt', { sessionId: session.id, attemptId: attempt.id, passed: true, feedback: 'Você reconheceu o papel semântico do h1. Vamos praticar.' });
  const reviewed = await (await browserGet(`/api/sessions/${session.id}`)).json();
  assert.equal(reviewed.attempts[0].review.passed, true);
  await call('tutor_add_block', { sessionId: session.id, block: { type: 'chart', title: 'Tentativas observadas', caption: 'Uma tentativa enviada nesta sessão de teste.', points: [{ label: 'Respostas', value: 1 }] } });
  assert.equal((await call('tutor_list_sessions', {})).sessions.length, 1);
  const capabilities = await call('tutor_list_runtimes', {});
  if (capabilities.languages.find(runtime => runtime.id === 'python').available) {
    const execution = await call('tutor_run_code', { language: 'python', code: 'print(int(input()) * 2)', stdin: '9' });
    assert.equal(execution.stdout.trim(), '18');
    const browserExecution = await browserPost('/api/run', { language: 'python', code: 'print("painel")' });
    assert.equal((await browserExecution.json()).stdout.trim(), 'painel');
  } else {
    t.diagnostic(`Execução indisponível: ${capabilities.sandbox.reason}`);
    assert.equal((await browserPost('/api/run', { language: 'python', code: 'print(1)' })).status, 503);
    const unavailable = await client.callTool({ name: 'tutor_run_code', arguments: { language: 'python', code: 'print(1)' } });
    assert.equal(unavailable.isError, true, 'não usa execução sem isolamento como alternativa');
  }
  assert.equal((await fetch(`${base}/api/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"language":"python","code":"print(1)"}' })).status, 401);
  const review = await call('tutor_schedule_review', { sessionId: session.id, concept: 'Significado do h1', prompt: 'Para que serve h1?', referenceAnswer: 'Identifica o título principal.', dueAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await call('tutor_get_reviews', { sessionId: session.id })).reviews[0].referenceAnswer, 'Identifica o título principal.');
  const publicReviews = await (await browserGet('/api/reviews')).json();
  assert.equal(publicReviews.reviews[0].referenceAnswer, undefined);
  const recall = await browserPost(`/api/sessions/${session.id}/reviews/${review.id}/recall`, { answer: 'É o título principal.' });
  assert.equal((await recall.json()).referenceAnswer, 'Identifica o título principal.');
  const rating = await browserPost(`/api/sessions/${session.id}/reviews/${review.id}/rate`, { rating: 'partial' });
  assert.equal((await rating.json()).intervalDays, 1);
  const malformed = await client.callTool({ name: 'tutor_add_block', arguments: { sessionId: session.id, block: { type: 'quiz', title: 'Q', prompt: 'Q', options: ['A', 'B'], correctIndex: 5, explanation: 'E' } } });
  assert.equal(malformed.isError, true);
  const badBody = await fetch(`${base}/api/sessions/${session.id}/attempts`, { method: 'POST', headers: browserHeaders, body: '{' });
  assert.equal(badBody.status, 400);
  const oversized = await browserPost(`/api/sessions/${session.id}/messages`, { body: 'x'.repeat(170000) });
  assert.equal(oversized.status, 413);
  const saved = JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'));
  assert.equal(saved.sessions[0].attempts[0].review.passed, true);
});
