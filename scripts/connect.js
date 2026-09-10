import { spawnSync } from 'node:child_process';
import { root } from '../src/paths.js';
import { join } from 'node:path';

const client = process.argv[2];
if (!['codex', 'claude'].includes(client)) throw new Error('Use codex ou claude.');
const args = client === 'codex'
  ? ['mcp', 'add', 'mcp-tutor', '--', process.execPath, join(root, 'src/mcp.js')]
  : ['mcp', 'add', '--transport', 'stdio', '--scope', 'local', 'mcp-tutor', '--', process.execPath, join(root, 'src/mcp.js')];
const result = spawnSync(client, args, { stdio: 'inherit', cwd: root });
if (result.error) { console.error(`Não foi possível executar ${client}: ${result.error.message}`); process.exit(1); }
process.exit(result.status ?? 1);
