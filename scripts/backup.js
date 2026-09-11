#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDirectory } from '../src/paths.js';

const source = join(dataDirectory, 'sessions.json');
let contents;
try {
  contents = await readFile(source, 'utf8');
  const parsed = JSON.parse(contents);
  if (!parsed || !Array.isArray(parsed.sessions)) throw new Error('estrutura de sessões inválida');
} catch (error) {
  console.error(`Backup não criado: não foi possível validar ${source}. ${error.message}`);
  process.exit(1);
}

const backupDirectory = join(dataDirectory, 'backups');
await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = join(backupDirectory, `sessions-${timestamp}.json`);
await writeFile(target, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
console.log(`Backup criado em ${target}`);
