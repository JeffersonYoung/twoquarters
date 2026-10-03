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
export const db = new DatabaseSync(path.join(dataDir, 'portfolio.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,data TEXT NOT NULL,published INTEGER NOT NULL,sort_order INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
// User-approved category migration: preserve all project metadata and image references.
db.exec("UPDATE projects SET data=json_set(data,'$.category','fmcg') WHERE json_extract(data,'$.category')='fashion'");
