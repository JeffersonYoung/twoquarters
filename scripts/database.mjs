import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_SQL, SCHEMA_VERSION, checkSchema } from '../server/schema.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
const file=path.join(directory,'portfolio.sqlite');
const [mode,...options]=process.argv.slice(2);
let db;
try {
 if (!['init','check','migrate'].includes(mode) || options.some(x=>x!=='--maintenance') || (mode!=='check'&&!options.includes('--maintenance'))) throw new Error('Usage: database.mjs check | init --maintenance | migrate --maintenance. Stop the app and back up the database before migration.');
 process.umask(0o077);
 if(mode==='init') {
  if(existsSync(file))throw new Error('Database already exists; initialization refused.');
  mkdirSync(directory,{recursive:true,mode:0o700});mkdirSync(path.join(directory,'uploads'),{recursive:true,mode:0o700});
  db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
  try {db.exec(SCHEMA_SQL);db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);}catch(e){db.exec('ROLLBACK');throw e;}
  chmodSync(file,0o600);
 } else {
  if(!existsSync(file))throw new Error('Database missing; initialize explicitly with db:init.');
  db=new DatabaseSync(file,{readOnly:mode==='check'});
  if(mode==='migrate') {
   db.exec('BEGIN IMMEDIATE');
   try {
    checkSchema(db,{legacy:true});
    if(db.prepare('PRAGMA user_version').get().user_version===0){
     db.exec("UPDATE projects SET data=json_set(data,'$.category','fmcg') WHERE json_extract(data,'$.category')='fashion'");
     db.exec(`PRAGMA user_version=${SCHEMA_VERSION}`);
    }
    checkSchema(db);db.exec('COMMIT');
   } catch(e){db.exec('ROLLBACK');throw e;}
  }
 }
 checkSchema(db);console.log(`Database ${mode} OK; schema version ${SCHEMA_VERSION}.`);
} catch(e){console.error(e.message);process.exitCode=1;}finally{db?.close();}
