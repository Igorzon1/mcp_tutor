import { spawn } from 'node:child_process';
import { access, mkdtemp, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export const languageSchema = z.enum(['python', 'java', 'javascript', 'c', 'cpp']);
export const executionSchema = z.object({
  language: languageSchema,
  code: z.string().trim().min(1).max(50000),
  stdin: z.string().max(8000).default(''),
  timeoutMs: z.number().int().min(500).max(10000).default(5000),
}).strict();
const launcher = fileURLToPath(new URL('./runner-launcher.py', import.meta.url));
const definitions = [
  { id: 'python', label: 'Python', binary: 'python3', filename: 'main.py', sample: 'nome = input()\nprint(f"Olá, {nome}!")\n', input: 'mundo' },
  { id: 'java', label: 'Java', binary: 'java', compiler: 'javac', filename: 'Main.java', sample: 'import java.util.Scanner;\n\npublic class Main {\n    public static void main(String[] args) {\n        Scanner entrada = new Scanner(System.in);\n        String nome = entrada.nextLine();\n        System.out.println("Olá, " + nome + "!");\n    }\n}\n', input: 'mundo' },
  { id: 'javascript', label: 'JavaScript', binary: 'node', filename: 'main.js', sample: 'const fs = require("node:fs");\nconst nome = fs.readFileSync(0, "utf8").trim();\nconsole.log(`Olá, ${nome}!`);\n', input: 'mundo' },
  { id: 'c', label: 'C', binary: 'gcc', filename: 'main.c', sample: '#include <stdio.h>\n\nint main(void) {\n    char nome[80];\n    if (scanf("%79s", nome) == 1) {\n        printf("Olá, %s!\\n", nome);\n    }\n    return 0;\n}\n', input: 'mundo' },
  { id: 'cpp', label: 'C++', binary: 'g++', filename: 'main.cpp', sample: '#include <iostream>\n#include <string>\n\nint main() {\n    std::string nome;\n    std::getline(std::cin, nome);\n    std::cout << "Olá, " << nome << "!\\n";\n}\n', input: 'mundo' },
];
const outputLimit = 32768;
const environment = { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
async function binary(name) {
  for (const directory of ['/usr/bin', '/usr/local/bin', '/bin']) {
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      const resolved = await realpath(candidate);
      if (resolved.startsWith('/usr/')) return resolved;
    } catch {}
  }
  return null;
}
function processResult(command, args, { input = '', timeoutMs = 5000, signal, limit = outputLimit } = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    const child = spawn(command, args, { env: environment, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), stopped;
    const terminate = reason => {
      if (!stopped) stopped = reason;
      // Killing the namespace reaper also kills descendants, including setsid children.
      if (child.pid) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
    };
    const capture = target => chunk => {
      const buffer = target === 'stdout' ? stdout : stderr;
      const remaining = Math.max(0, limit - stdout.length - stderr.length);
      const appended = Buffer.concat([buffer, chunk.subarray(0, remaining)]);
      if (target === 'stdout') stdout = appended; else stderr = appended;
      if (chunk.length > remaining) terminate('output_limit');
    };
    child.stdout.on('data', capture('stdout'));
    child.stderr.on('data', capture('stderr'));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const abort = () => terminate('cancelled');
    const timer = setTimeout(() => terminate('timeout'), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.once('error', error => { stopped = 'unavailable'; stderr = Buffer.from(error.message); });
    child.once('close', (exitCode, processSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ status: stopped || (exitCode === 0 ? 'completed' : 'error'), exitCode, signal: processSignal, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), durationMs: Math.round(performance.now() - start) });
    });
  });
}

export class CodeRunner {
  constructor() { this.active = 0; this.children = new Set(); }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = this.discover();
    return this.initializing;
  }
  async discover() {
    this.bwrap = await binary('bwrap');
    this.python = await binary('python3');
    this.javaConfig = (await readdir('/etc')).filter(name => /^java-\d+-openjdk$/.test(name));
    this.runtimes = await Promise.all(definitions.map(async definition => ({ ...definition, executable: await binary(definition.binary), compilerPath: definition.compiler ? await binary(definition.compiler) : null })));
    let ready = false;
    let reason = 'A execução requer Linux, bubblewrap, Python 3 e libseccomp. Nenhum código será executado sem isolamento.';
    if (process.platform === 'linux' && this.bwrap && this.python) {
      const python = this.runtimes.find(runtime => runtime.id === 'python');
      const check = await this.execute(python, { code: 'print("atelie-sandbox-ok")', stdin: '', timeoutMs: 3000 });
      ready = check.status === 'completed' && check.stdout.trim() === 'atelie-sandbox-ok';
      if (!ready) reason = 'Não foi possível iniciar o isolamento. ' + check.stderr.trim().slice(0, 350);
    }
    this.ready = ready;
    this.reason = ready ? '' : reason;
    for (const runtime of this.runtimes) {
      runtime.installed = !!runtime.executable && (!runtime.compiler || !!runtime.compilerPath);
      runtime.available = ready && runtime.installed;
      if (runtime.installed) {
        const version = await processResult(runtime.executable, ['--version'], { timeoutMs: 2000, limit: 2000 });
        runtime.version = (version.stdout || version.stderr).split('\n')[0];
      }
    }
  }
  async capabilities() {
    await this.initialize();
    return { sandbox: { available: this.ready, engine: 'bubblewrap + seccomp', reason: this.reason }, limits: { timeoutMs: 10000, outputBytes: outputLimit, memoryMiB: 1536, parallel: 2 }, languages: this.runtimes.map(({ executable, compilerPath, binary: _, compiler, ...runtime }) => ({ ...runtime, reason: runtime.available ? '' : !runtime.installed ? 'Runtime não encontrado em /usr/bin ou /usr/local/bin.' : this.reason })) };
  }
  async execute(runtime, input, signal) {
    const directory = await mkdtemp(join(tmpdir(), 'atelie-run-'));
    try {
      const source = join(directory, runtime.filename);
      await writeFile(source, input.code, { mode: 0o600 });
      const args = ['--unshare-all', '--unshare-user', '--die-with-parent', '--new-session', '--cap-drop', 'ALL', '--disable-userns',
        '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64',
        '--proc', '/proc', '--dev', '/dev', '--size', '16777216', '--tmpfs', '/tmp', '--size', '67108864', '--tmpfs', '/work',
        '--ro-bind', source, `/work/${runtime.filename}`, '--ro-bind', launcher, '/runner.py', '--chdir', '/work',
        '--clearenv', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/work', '--setenv', 'LANG', 'C.UTF-8', '--setenv', 'LC_ALL', 'C.UTF-8'];
      for (const config of this.javaConfig) args.push('--ro-bind', `/etc/${config}`, `/etc/${config}`);
      args.push(this.python, '-I', '-B', '/runner.py', runtime.id, runtime.executable);
      if (runtime.compilerPath) args.push(runtime.compilerPath);
      return await processResult(this.bwrap, args, { input: input.stdin, timeoutMs: input.timeoutMs, signal });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  async run(raw, { signal } = {}) {
    const input = executionSchema.parse(raw);
    await this.initialize();
    const runtime = this.runtimes.find(item => item.id === input.language);
    if (!runtime.available) throw Object.assign(new Error(runtime.installed ? this.reason : 'Essa linguagem não está instalada no sistema.'), { status: 503 });
    if (this.active >= 2) throw Object.assign(new Error('Há duas execuções em andamento. Aguarde uma delas terminar.'), { status: 429 });
    if (signal?.aborted) return { status: 'cancelled', exitCode: null, stdout: '', stderr: '', durationMs: 0 };
    this.active++;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    this.children.add(controller);
    try { return { ...await this.execute(runtime, input, controller.signal), language: input.language }; }
    finally { this.active--; this.children.delete(controller); signal?.removeEventListener('abort', abort); }
  }
  shutdown() { for (const controller of this.children) controller.abort(); }
}
