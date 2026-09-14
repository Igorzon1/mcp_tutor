import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workerPath = join(root, 'public', 'exercise-worker.js');
const trustedLoopFixture = 'while (true) {}';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

async function runWorker(payload) {
  const source = await readFile(workerPath, 'utf8');
  const messages = [];
  const fakeConsole = {};
  const sandbox = {
    console: fakeConsole,
    performance: { now: () => 100 },
    postMessage(message) { messages.push(message); },
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: workerPath });
  context.onmessage({ data: payload });
  assert.equal(messages.length, 1);
  return messages[0];
}

test('worker retorna sucesso, checks aprovados e saída do console', async () => {
  const result = await runWorker({
    token: 'success-fixture',
    code: "const answer = 2; console.log('resultado', { answer });",
    tests: [
      { label: 'resposta é um número', expression: 'typeof answer === "number"' },
      { label: 'resposta correta', expression: 'answer === 2' },
    ],
  });

  assert.equal(result.token, 'success-fixture');
  assert.equal(result.type, 'mcp-tutor-js-result');
  assert.equal(result.status, 'passed');
  assert.deepEqual(plain(result.checks), [
    { label: 'resposta é um número', passed: true },
    { label: 'resposta correta', passed: true },
  ]);
  assert.equal(result.output, 'resultado {"answer":2}\n');
  assert.equal(result.durationMs, 0);
});

test('worker reporta erro de sintaxe e reprova todos os checks', async () => {
  const result = await runWorker({
    token: 'syntax-fixture',
    code: 'const = ;',
    tests: [
      { label: 'primeiro check', expression: 'true' },
      { label: 'segundo check', expression: 'true' },
    ],
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /^SyntaxError:/);
  assert.deepEqual(plain(result.checks), [
    { label: 'primeiro check', passed: false },
    { label: 'segundo check', passed: false },
  ]);
  assert.equal(result.output, '');
});

test('worker distingue código executado sem solução', async () => {
  const result = await runWorker({
    token: 'needs-work-fixture',
    code: 'const answer = 41;',
    tests: [{ label: 'resposta é 42', expression: 'answer === 42' }],
  });

  assert.equal(result.status, 'needs_work');
  assert.deepEqual(plain(result.checks), [{ label: 'resposta é 42', passed: false }]);
  assert.equal(result.error, undefined);
});

test('worker limita a saída do console a 12.000 caracteres', async () => {
  const result = await runWorker({
    token: 'output-fixture',
    code: "console.log('x'.repeat(20000));",
    tests: [],
  });

  assert.equal(result.status, 'needs_work');
  assert.equal(result.output.length, 12000);
  assert.equal(result.output, 'x'.repeat(12000));
});

test('worker deixa APIs de rede, storage e execução adicional indisponíveis', async () => {
  const result = await runWorker({
    token: 'api-fixture',
    code: 'const apiNames = [];',
    tests: [
      { label: 'rede indisponível', expression: "typeof fetch === 'undefined' && typeof XMLHttpRequest === 'undefined' && typeof WebSocket === 'undefined' && typeof EventSource === 'undefined'" },
      { label: 'workers e scripts indisponíveis', expression: "typeof Worker === 'undefined' && typeof SharedWorker === 'undefined' && typeof importScripts === 'undefined'" },
      { label: 'storage indisponível', expression: "typeof indexedDB === 'undefined' && typeof caches === 'undefined' && typeof localStorage === 'undefined' && typeof sessionStorage === 'undefined'" },
    ],
  });

  assert.equal(result.status, 'passed');
  assert.deepEqual(plain(result.checks), [
    { label: 'rede indisponível', passed: true },
    { label: 'workers e scripts indisponíveis', passed: true },
    { label: 'storage indisponível', passed: true },
  ]);
});

test('vm timeout interrompe fixture confiável de loop; isso não testa limite do browser', async () => {
  const source = await readFile(workerPath, 'utf8');
  const sandbox = { console: {}, performance: { now: () => 100 }, postMessage() {} };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context, { filename: workerPath });

  assert.throws(
    () => vm.runInContext(trustedLoopFixture, context, { timeout: 20 }),
    error => error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT',
  );
});
