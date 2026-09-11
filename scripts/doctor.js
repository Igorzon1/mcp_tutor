#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { APP_VERSION } from '../src/schema.js';
import { baseUrl, dataDirectory } from '../src/paths.js';

const checks = [];
const add = (status, label, detail) => checks.push({ status, label, detail });
const major = Number(process.versions.node.split('.')[0]);
add(major >= 22 ? 'OK' : 'ERRO', 'Node.js', `v${process.versions.node}; necessário 22+`);

try {
  const data = JSON.parse(await readFile(join(dataDirectory, 'sessions.json'), 'utf8'));
  add(Array.isArray(data.sessions) ? 'OK' : 'ERRO', 'Dados locais', `${Array.isArray(data.sessions) ? data.sessions.length : 0} sessão(ões), formato v${data.version ?? '?'}`);
} catch (error) {
  if (error.code === 'ENOENT') add('AVISO', 'Dados locais', 'ainda não criados; serão inicializados no primeiro uso');
  else add('ERRO', 'Dados locais', `arquivo ilegível: ${error.message}`);
}

try {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(1500) });
  const health = await response.json();
  add(response.ok && health.app === 'mcp-tutor' ? 'OK' : 'ERRO', 'Painel local', response.ok ? `${baseUrl} · v${health.version ?? '?'}` : `HTTP ${response.status}`);
} catch {
  add('AVISO', 'Painel local', `não está em execução em ${baseUrl}`);
}

const codex = spawnSync('codex', ['--version'], { encoding: 'utf8', shell: false, windowsHide: true });
add(codex.status === 0 ? 'OK' : 'AVISO', 'Codex CLI', codex.status === 0 ? codex.stdout.trim() : 'não encontrado; o modo MCP externo ainda pode ser usado');

console.log(`MCP Tutor ${APP_VERSION} — diagnóstico local`);
for (const check of checks) console.log(`[${check.status}] ${check.label}: ${check.detail}`);
process.exit(checks.some(check => check.status === 'ERRO') ? 1 : 0);
