import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
function cmd(dir,args){return spawnSync(process.execPath,args,{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});}
const open=dir=>new DatabaseSync(path.join(dir,'portfolio.sqlite'));
const start=dir=>cmd(dir,['--input-type=module','-e',"import {db} from './server/store.mjs';db.close()"]);
test('startup refuses absent database without creating one',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tq-db-'));try{assert.notEqual(start(dir).status,0);assert.equal(existsSync(path.join(dir,'portfolio.sqlite')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('startup never repairs schema/version or migrates legacy rows; manual migration preserves account',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tq-db-'));try{
  assert.equal(cmd(dir,['scripts/database.mjs','init','--maintenance']).status,0);
  assert.notEqual(cmd(dir,['scripts/database.mjs','init','--maintenance']).status,0);
  let db=open(dir);db.exec("PRAGMA user_version=0; INSERT INTO users VALUES('admin','keep-hash');");
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('p','p',JSON.stringify({category:'fashion'}),0,0);db.close();
  assert.notEqual(start(dir).status,0);
  db=open(dir);assert.equal(db.prepare('PRAGMA user_version').get().user_version,0);assert.match(db.prepare('SELECT data FROM projects').get().data,/fashion/);db.close();
  assert.notEqual(cmd(dir,['scripts/database.mjs','migrate']).status,0);
  const result=cmd(dir,['scripts/database.mjs','migrate','--maintenance']);assert.equal(result.status,0,result.stderr);
  assert.equal(start(dir).status,0);
  db=open(dir);assert.equal(db.prepare('SELECT password FROM users').get().password,'keep-hash');assert.match(db.prepare('SELECT data FROM projects').get().data,/fmcg/);
  db.exec('DROP INDEX videos_project');db.close();assert.notEqual(start(dir).status,0);
  db=open(dir);assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='videos_project'").get(),undefined);db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('manual migration fails without changing version/data on incompatible schema',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tq-db-'));try{
  assert.equal(cmd(dir,['scripts/database.mjs','init','--maintenance']).status,0);
  const db=open(dir);db.exec("PRAGMA user_version=0; ALTER TABLE users ADD COLUMN unexpected TEXT;");db.close();
  assert.notEqual(cmd(dir,['scripts/database.mjs','migrate','--maintenance']).status,0);
  const after=open(dir);assert.equal(after.prepare('PRAGMA user_version').get().user_version,0);after.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
