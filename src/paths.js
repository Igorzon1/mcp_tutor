import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const dataDirectory = resolve(process.env.TUTOR_DATA_DIR || resolve(root, '.data'));
export const port = Number(process.env.TUTOR_PORT || 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('TUTOR_PORT deve estar entre 1024 e 65535.');
export const baseUrl = `http://127.0.0.1:${port}`;
