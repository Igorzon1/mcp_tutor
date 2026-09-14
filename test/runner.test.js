import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodeRunner, executionSchema } from '../src/runner.js';

const runner = new CodeRunner();
let capabilities;
before(async () => {
  capabilities = await runner.capabilities();
  assert.ok(capabilities.sandbox.available, capabilities.sandbox.reason);
});
after(() => runner.shutdown());
for (const language of ['python', 'java', 'javascript', 'c', 'cpp']) {
  test(`programa real em ${language}: compilação quando necessária, stdin e stdout`, { timeout: 15000 }, async t => {
    const runtime = capabilities.languages.find(runtime => runtime.id === language);
    if (!runtime.installed) { t.skip(`${language} não está instalado`); return; }
    const result = await runner.run({ language, code: runtime.sample, stdin: 'Ateliê', timeoutMs: 10000 });
    assert.equal(result.status, 'completed', result.stderr);
    assert.equal(result.stdout, 'Olá, Ateliê!\n');
    assert.equal(result.exitCode, 0);
  });
}
test('erros de sintaxe e compilação voltam como diagnóstico', async () => {
  const python = await runner.run({ language: 'python', code: 'if True print("erro")' });
  assert.equal(python.status, 'error');
  assert.match(python.stderr, /SyntaxError/);
  if (capabilities.languages.find(runtime => runtime.id === 'java').available) {
    const java = await runner.run({ language: 'java', code: 'public class Main { public static void main(String[] args) { nope } }' });
    assert.equal(java.status, 'error');
    assert.match(java.stderr, /error/);
  }
});
test('laço infinito é interrompido e não impede a próxima execução', async () => {
  const loop = await runner.run({ language: 'python', code: 'while True: pass', timeoutMs: 500 });
  assert.equal(loop.status, 'timeout');
  assert.ok(loop.durationMs < 2500);
  const next = await runner.run({ language: 'python', code: 'print(42)' });
  assert.equal(next.stdout.trim(), '42');
});
test('saída excessiva é limitada em bytes', async () => {
  const result = await runner.run({ language: 'python', code: 'print("x" * 1000000)' });
  assert.equal(result.status, 'output_limit');
  assert.ok(Buffer.byteLength(result.stdout + result.stderr) <= capabilities.limits.outputBytes);
});
test('cancelamento encerra o processo e libera a vaga', async () => {
  const controller = new AbortController();
  const pending = runner.run({ language: 'python', code: 'while True: pass' }, { signal: controller.signal });
  setTimeout(() => controller.abort(), 200);
  assert.equal((await pending).status, 'cancelled');
  assert.equal(runner.active, 0);
});
test('executor limita a concorrência', async () => {
  const input = { language: 'python', code: 'while True: pass', timeoutMs: 700 };
  const first = runner.run(input), second = runner.run(input);
  await assert.rejects(runner.run(input), error => error.status === 429);
  await Promise.all([first, second]);
  assert.equal(runner.active, 0);
});
test('código não lê arquivos do host nem variáveis de ambiente; pode usar /work temporário', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'atelie-host-sentinel-'));
  const sentinel = join(directory, 'private.txt');
  await writeFile(sentinel, 'SENTINEL-NOT-FOR-THE-EXERCISE');
  process.env.ATELIE_TEST_HOST_SECRET = 'hidden-test-value';
  try {
    const result = await runner.run({ language: 'python', code: `import os\nfrom pathlib import Path\nprint(Path(${JSON.stringify(sentinel)}).exists())\nprint(os.environ.get("ATELIE_TEST_HOST_SECRET", "not-shared"))\nPath("practice.txt").write_text("scratch-ok")\nprint(Path("practice.txt").read_text())\nprint(Path("/home").exists())` });
    assert.equal(result.status, 'completed', result.stderr);
    assert.equal(result.stdout, 'False\nnot-shared\nscratch-ok\nFalse\n');
  } finally { delete process.env.ATELIE_TEST_HOST_SECRET; await rm(directory, { recursive: true, force: true }); }
});
test('rede e criação de subprocessos são bloqueadas', async () => {
  const result = await runner.run({ language: 'python', code: 'import socket, os\ntry:\n    socket.create_connection(("1.1.1.1", 80), timeout=0.2)\n    print("NETWORK-OPEN")\nexcept OSError:\n    print("network-blocked")\ntry:\n    os.fork()\n    print("FORK-OPEN")\nexcept PermissionError:\n    print("fork-blocked")' });
  assert.equal(result.status, 'completed', result.stderr);
  assert.equal(result.stdout, 'network-blocked\nfork-blocked\n');
});
test('limites de memória e tamanho de arquivo são aplicados', async () => {
  const memory = await runner.run({ language: 'python', code: 'try:\n    value = bytearray(2 * 1024**3)\n    print("too-much")\nexcept MemoryError:\n    print("memory-limited")' });
  assert.equal(memory.stdout.trim(), 'memory-limited');
  const file = await runner.run({ language: 'python', code: 'try:\n    with open("large", "wb") as f:\n        for i in range(10):\n            f.write(b"x" * 1024**2)\n    print("too-big")\nexcept OSError:\n    print("file-limited")' });
  assert.equal(file.stdout.trim(), 'file-limited');
});
test('contratos rejeitam shell, caminhos e limites fora da faixa', () => {
  assert.equal(executionSchema.safeParse({ language: 'bash', code: 'echo test' }).success, false);
  assert.equal(executionSchema.safeParse({ language: 'python', code: 'print(1)', command: '/bin/sh' }).success, false);
  assert.equal(executionSchema.safeParse({ language: 'python', code: 'print(1)', timeoutMs: 100000 }).success, false);
});
