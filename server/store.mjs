import { checkSchema } from './schema.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.umask(0o077);
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
mkdirSync(path.join(dataDir, 'uploads'), { recursive: true, mode: 0o700 });
chmodSync(dataDir,0o700);
chmodSync(path.join(dataDir,'uploads'),0o700);
for(const name of ['portfolio.sqlite','portfolio.sqlite-wal','portfolio.sqlite-shm']){const file=path.join(dataDir,name);if(existsSync(file))chmodSync(file,0o600);}
const databaseFile=path.join(dataDir,'portfolio.sqlite');
if(!existsSync(databaseFile)) throw new Error('Database missing. Run db:init explicitly before starting the app.');
// Validate read-only before opening the live writable connection.
const check=new DatabaseSync(databaseFile,{readOnly:true});
try { checkSchema(check); } finally { check.close(); }
export const db = new DatabaseSync(databaseFile);
db.exec('PRAGMA busy_timeout=5000');
