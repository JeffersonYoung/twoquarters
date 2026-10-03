import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs';
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
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users(username TEXT PRIMARY KEY,password TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,data TEXT NOT NULL,published INTEGER NOT NULL,sort_order INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);`);
export function seed() {
 if (db.prepare('SELECT value FROM settings WHERE key=?').get('seed')) return;
 const source = JSON.parse(readFileSync(path.join(root, 'server/seed.json'), 'utf8'));
 db.exec('BEGIN IMMEDIATE');
 try {
  source.forEach((p,i) => {
   p.id = 'sample-' + p.slug; p.published = true;
   const originalCover = p.cover.src;
   const originals = p.images.some(im=>im.src===originalCover) ? p.images : [p.cover,...p.images];
   p.images = originals.map(im => {
    const id=randomUUID();
    copyFileSync(path.join(root,'server/seed-images',im.src.replace('/images/','')),path.join(dataDir,'uploads',id));
    chmodSync(path.join(dataDir,'uploads',id),0o600);
    return {...im,id,storagePath:id,src:'/api/images/'+id,contentType:'image/jpeg',originalSrc:im.src};
   });
   p.cover=p.images.find(im=>im.originalSrc===originalCover);
   for(const im of p.images)delete im.originalSrc;
   db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(p.id,p.slug,JSON.stringify(p),1,i);
  });
  db.prepare('INSERT INTO settings VALUES(?,?)').run('seed','repository-only-v1'); db.exec('COMMIT');
 } catch (e) { db.exec('ROLLBACK'); throw e; }
}
