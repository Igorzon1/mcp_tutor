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
import { TEACHING_GUIDE } from '../src/pedagogy.js';

test('SDK MCP real ↔ serviço local ↔ ações do aluno e feedback do tutor', { timeout: 30000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-tutor-integration-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, TUTOR_DATA_DIR: directory, TUTOR_PORT: String(port), TUTOR_AGENT: 'none' };
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
  const health = await (await fetch(`${base}/health`)).json();
  assert.equal(health.version, '0.4.0');
  assert.equal(health.status, 'ready');
  const pageText = await page.text();
  assert.match(pageText, /id="blocks"/);
  assert.match(pageText, /id="activity-panel"/);
  assert.match(pageText, /id="chat-pending-title"/);
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
  const appResponse = await fetch(`${base}/app.js`);
  assert.equal(appResponse.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const appText = await appResponse.text();
  assert.match(appText, /class="optional-reasoning"/);
  assert.doesNotMatch(appText, /name="reasoning"[^>]*required/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval/);
  const workerResponse = await fetch(`${base}/exercise-worker.js`);
  assert.equal(workerResponse.status, 200);
  assert.match(workerResponse.headers.get('content-type'), /text\/javascript/);
  assert.match(workerResponse.headers.get('content-security-policy'), /script-src 'unsafe-eval'; connect-src 'none'; worker-src 'none'/);
  const editorResponse = await fetch(`${base}/code-editor.js`);
  assert.equal(editorResponse.status, 200);
  assert.match(editorResponse.headers.get('content-type'), /text\/javascript/);
  assert.doesNotMatch(editorResponse.headers.get('content-security-policy'), /unsafe-eval/);
  assert.match(pageText, /lesson-rail/);
  const agentStatus = await browserGet('/api/agent');
  assert.equal(agentStatus.status, 200);
  assert.equal((await agentStatus.json()).enabled, false);
  const idleAgentStatus = await browserGet('/api/agent?sessionId=11111111-1111-4111-8111-111111111111');
  assert.equal((await idleAgentStatus.json()).session.phase, 'idle');
  const panelSessionResponse = await browserPost('/api/sessions', { title: 'Aula pelo painel', goal: 'Conversar com o tutor', level: 'beginner' });
  assert.equal(panelSessionResponse.status, 201);
  const panelSession = await panelSessionResponse.json();
  assert.equal(panelSession.progress.stage, 'predict');
  const offlineChat = await browserPost(`/api/sessions/${panelSession.id}/chat`, { body: 'Quero começar.' });
  assert.equal(offlineChat.status, 503);
  assert.equal((await browserGet(`/api/sessions/${panelSession.id}`)).status, 200);

  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 8);
  assert.equal((await client.listPrompts()).prompts[0].name, 'active_learning_tutor');
  assert.match((await client.readResource({ uri: 'tutor://guide' })).contents[0].text, /prever/);
  assert.ok((await client.readResource({ uri: 'tutor://guide' })).contents[0].text.includes(TEACHING_GUIDE));
  const call = async (name, args) => {
    const result = await client.callTool({ name, arguments: args });
    assert.ok(!result.isError, JSON.stringify(result));
    return result.structuredContent || JSON.parse(result.content[0].text);
  };
  const session = await call('tutor_start_session', { title: 'Aula de integração', goal: 'Praticar HTML', level: 'beginner' });
  assert.equal(session.mode, 'tutor');
  assert.match(session.url, new RegExp(String(port)));
  const configured = await call('tutor_set_learning_plan', {
    sessionId: session.id,
    learnerProfile: { priorKnowledge: 'Conheço tags básicas.', timeAvailableMinutes: 30, preferences: 'Exemplos visuais.' },
    plan: {
      summary: 'Aprender estrutura semântica construindo e explicando uma página pequena.',
      outcomes: ['Escolher elementos semânticos', 'Reconstruir a estrutura sem consulta'],
      checkpoints: [
        { stage: 'predict', objective: 'Antecipar a função de uma tag', evidence: 'Justificativa antes da prática' },
        { stage: 'practice', objective: 'Construir uma estrutura pequena', evidence: 'HTML aprovado pelas verificações' },
        { stage: 'explain', objective: 'Explicar as escolhas', evidence: 'Raciocínio revisado pelo tutor' },
        { stage: 'transfer', objective: 'Recriar em outro contexto', evidence: 'Nova solução sem copiar a anterior' },
      ],
    },
  });
  assert.equal(configured.plan.checkpoints.length, 4);
  assert.equal(configured.learnerProfile.timeAvailableMinutes, 30);
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
  assert.equal(updated.progress.status, 'ready_for_transition');
  await call('tutor_review_attempt', { sessionId: session.id, attemptId: attempt.id, passed: true, feedback: 'Você reconheceu o papel semântico do h1. Vamos praticar.' });
  const reviewed = await (await browserGet(`/api/sessions/${session.id}`)).json();
  assert.equal(reviewed.attempts[0].review.passed, true);
  const advanced = await call('tutor_advance_stage', { sessionId: session.id, attemptId: attempt.id, reason: 'A explicação identifica corretamente o papel semântico de h1.' });
  assert.equal(advanced.stage, 'practice');
  assert.equal(advanced.status, 'ready_for_activity');
  await call('tutor_add_block', { sessionId: session.id, block: { type: 'chart', stage: 'practice', title: 'Tentativas observadas', caption: 'Uma tentativa enviada nesta sessão de teste.', points: [{ label: 'Respostas', value: 1 }] } });
  const javascript = await call('tutor_add_block', { sessionId: session.id, block: { type: 'code', stage: 'practice', title: 'Uma função', prompt: 'Crie uma função que transforme texto.', language: 'javascript', starterCode: 'function upperCase(text) {}', tests: [{ label: 'A função existe', expression: "typeof upperCase === 'function'" }, { label: 'Transforma o texto', expression: "upperCase('oi') === 'OI'" }] } });
  const jsSubmission = await browserPost(`/api/sessions/${session.id}/attempts`, { blockId: javascript.block.id, answer: "function upperCase(text) { return text.toUpperCase(); }", reasoning: 'Usei o método de string que transforma todas as letras.', confidence: 2, runtimeEvidence: { status: 'passed', checks: [{ label: 'A função existe', passed: true }, { label: 'Transforma o texto', passed: true }], output: '', durationMs: 3 } });
  assert.equal(jsSubmission.status, 201);
  const jsAttempt = await jsSubmission.json();
  assert.equal(jsAttempt.result.source, 'browser');
  assert.equal((await call('tutor_get_session', { sessionId: session.id })).progress.status, 'awaiting_review');
  await call('tutor_review_attempt', { sessionId: session.id, attemptId: jsAttempt.id, passed: true, feedback: 'A função transforma o texto e você explicou a escolha.' });
  assert.equal((await call('tutor_advance_stage', { sessionId: session.id, attemptId: jsAttempt.id, reason: 'Os testes passaram e o raciocínio explica a solução.' })).stage, 'explain');
  assert.equal((await call('tutor_list_sessions', {})).sessions.length, 2);
  const autoResponse = await browserPost('/api/sessions', { title: 'Abertura automática', goal: 'Aprender variáveis JavaScript', level: 'beginner', startTutor: true });
  assert.equal(autoResponse.status, 201);
  const automatic = await autoResponse.json();
  assert.equal(automatic.blocks.filter(block => block.role === 'learner').length, 1);
  assert.match(automatic.blocks[0].body, /Aprender variáveis JavaScript/);
  const automaticStatus = await (await browserGet(`/api/agent?sessionId=${automatic.id}`)).json();
  assert.equal(automaticStatus.session.phase, 'failed'); // Deliberately disabled CLI fixture.
  assert.equal((await browserPost(`/api/sessions/${automatic.id}/chat`, { retry: true })).status, 503);
  for (let read = 0; read < 2; read++) {
    const reopened = await (await browserGet(`/api/sessions/${automatic.id}`)).json();
    assert.equal(reopened.blocks.filter(block => block.role === 'learner').length, 1);
  }
  assert.equal((await browserPost('/api/sessions', { title: 'Inválida', goal: 'Um objetivo', startTutor: 'yes' })).status, 400);
  assert.equal((await fetch(`${base}/study-layout.js`)).status, 200);
  const malformed = await client.callTool({ name: 'tutor_add_block', arguments: { sessionId: session.id, block: { type: 'quiz', title: 'Q', prompt: 'Q', options: ['A', 'B'], correctIndex: 5, explanation: 'E' } } });
  assert.equal(malformed.isError, true);
  const badBody = await fetch(`${base}/api/sessions/${session.id}/attempts`, { method: 'POST', headers: browserHeaders, body: '{' });
  assert.equal(badBody.status, 400);
  const oversized = await browserPost(`/api/sessions/${session.id}/messages`, { body: 'x'.repeat(170000) });
  assert.equal(oversized.status, 413);
  const saved = JSON.parse(await readFile(join(directory, 'sessions.json'), 'utf8'));
  const savedSession = saved.sessions.find(item => item.id === session.id);
  assert.equal(savedSession.attempts[0].review.passed, true);
});
