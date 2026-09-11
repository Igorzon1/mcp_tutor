import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root } from '../src/paths.js';

test('backup cria uma cópia privada e não altera o arquivo de sessões', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-tutor-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await mkdir(directory, { recursive: true });
  const original = JSON.stringify({ version: 3, sessions: [{ id: 'exemplo' }] }, null, 2);
  await writeFile(join(directory, 'sessions.json'), original);
  const result = spawnSync(process.execPath, [join(root, 'scripts/backup.js')], {
    cwd: root,
    env: { ...process.env, TUTOR_DATA_DIR: directory },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const files = await readdir(join(directory, 'backups'));
  assert.equal(files.length, 1);
  assert.match(files[0], /^sessions-.*\.json$/);
  assert.equal(await readFile(join(directory, 'backups', files[0]), 'utf8'), original);
  assert.equal(await readFile(join(directory, 'sessions.json'), 'utf8'), original);
});
