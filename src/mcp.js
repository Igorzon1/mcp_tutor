#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { APP_VERSION, TOOL_DEFINITIONS, TUTOR_INSTRUCTIONS } from './schema.js';
import { root, dataDirectory, port, baseUrl } from './paths.js';

async function runtime() {
  try {
    const data = JSON.parse(await readFile(join(dataDirectory, 'runtime.json'), 'utf8'));
    if (data.port !== port || !/^[a-f0-9]{64}$/.test(data.token)) return null;
    const response = await fetch(`${baseUrl}/api/sessions`, { headers: { Authorization: `Bearer ${data.token}` }, signal: AbortSignal.timeout(1000) });
    if (response.ok) return data;
  } catch {}
  return null;
}
let starting;
async function ensureService() {
  const existing = await runtime();
  if (existing) return existing;
  if (!starting) starting = (async () => {
    // The port is the single-instance lock. Multiple clients may start together;
    // only one service can bind, and all bridges reuse that authenticated service.
    await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const log = await open(join(dataDirectory, 'server.log'), 'a', 0o600);
    try {
      const child = spawn(process.execPath, [join(root, 'src/server.js')], { cwd: root, env: process.env, detached: true, stdio: ['ignore', log.fd, log.fd] });
      child.on('error', error => console.error(`Não foi possível iniciar o painel: ${error.message}`));
      child.unref();
    } finally { await log.close(); }
    for (let i = 0; i < 40; i++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      const active = await runtime();
      if (active) return active;
    }
    throw new Error(`Não foi possível iniciar o painel em ${baseUrl}. Verifique .data/server.log ou execute npm start. Para outra instância, use TUTOR_PORT e TUTOR_DATA_DIR diferentes.`);
  })().finally(() => { starting = null; });
  return starting;
}

const server = new McpServer({ name: 'mcp-tutor', version: APP_VERSION }, { instructions: TUTOR_INSTRUCTIONS });
for (const tool of TOOL_DEFINITIONS) {
  server.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.schema.shape,
    annotations: { readOnlyHint: !!tool.readOnly, destructiveHint: false, idempotentHint: !!tool.readOnly, openWorldHint: false },
  }, async args => {
    try {
      const active = await ensureService();
      const response = await fetch(`${baseUrl}/bridge/tool`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${active.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tool.name, args }),
        signal: AbortSignal.timeout(35000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
    } catch (error) { return { content: [{ type: 'text', text: error.message }], isError: true }; }
  });
}
server.registerPrompt('active_learning_tutor', { title: 'Tutor de aprendizagem ativa', description: 'Conduz uma aula prática usando as atividades do painel MCP Tutor.' }, () => ({ messages: [{ role: 'user', content: { type: 'text', text: TUTOR_INSTRUCTIONS } }] }));
server.registerResource('teaching-guide', 'tutor://guide', { mimeType: 'text/plain', description: 'Ciclo pedagógico, limites e fluxo de interação do MVP.' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/plain', text: TUTOR_INSTRUCTIONS }] }));
await server.connect(new StdioServerTransport());
