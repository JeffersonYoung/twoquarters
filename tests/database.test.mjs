import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_VERSION, SCHEMA_V1_SQL } from '../server/schema.mjs';
function cmd(dir,args){return spawnSync(process.execPath,args,{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});}
const open=dir=>new DatabaseSync(path.join(dir,'portfolio.sqlite'));
const start=dir=>cmd(dir,['--input-type=module','-e',"import {db} from './server/store.mjs';import './server/video.mjs';db.close()"]);
const temp=()=>mkdtempSync(path.join(tmpdir(),'tq-db-'));
function snapshot(dir) {
 const db=open(dir);
 try {
  return {
   version:db.prepare('PRAGMA user_version').get().user_version,
   schema:db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all(),
   rows:Object.fromEntries(['users','sessions','projects','login_limits','videos'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row=>({...row}))])),
   media:Object.fromEntries(readdirSync(path.join(dir,'uploads')).sort().map(name=>[name,readFileSync(path.join(dir,'uploads',name),'hex')])),
  };
 } finally { db.close(); }
}
function legacyFixture(dir,version) {
 mkdirSync(path.join(dir,'uploads'));
 const db=open(dir);
 try {
  db.exec(SCHEMA_V1_SQL);db.exec(`PRAGMA user_version=${version}`);
  db.prepare('INSERT INTO users VALUES(?,?)').run('admin','preserved-password-hash');
  db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('existing-session','admin','existing-csrf',2000000000000);
  db.prepare('INSERT INTO login_limits VALUES(?,?,?)').run('existing-limit',3,2000000000000);
  const image={id:'cover-id',storagePath:'cover-file',src:'/api/images/cover-id',contentType:'image/png'};
  const project={id:'p',slug:'existing-project',category:version===0?'fashion':'fmcg',title:'Keep this project',cover:image,images:[image],videos:[{id:'ready-id',src:'/api/videos/ready-id'}]};
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run('p',project.slug,JSON.stringify(project),1,9);
  for(const [id,status] of [['queued-id','queued'],['ready-id','ready']]) {
   db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,source_bytes,output_bytes,width,height,duration,error,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id,'p',`${status}.mp4`,status,'video/mp4',1234,status==='ready'?1100:null,320,180,1,null,123456789);
  }
 } finally {db.close();}
 writeFileSync(path.join(dir,'uploads','cover-file'),'existing-image-bytes');
 writeFileSync(path.join(dir,'uploads','video-queued-id.source'),'complete-queued-original');
 writeFileSync(path.join(dir,'uploads','video-ready-id.mp4'),'existing-ready-video');
}
test('startup refuses absent database without creating one',()=>{
 const dir=temp();try{assert.notEqual(start(dir).status,0);assert.equal(existsSync(path.join(dir,'portfolio.sqlite')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('explicit initialization creates version 2 with server defaults and refuses existing databases',()=>{
 const dir=temp();try{
  assert.equal(SCHEMA_VERSION,2);
  const initialized=cmd(dir,['scripts/database.mjs','init','--maintenance']);assert.equal(initialized.status,0,initialized.stderr);
  const db=open(dir);
  try {
   assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
   const column=db.prepare('PRAGMA table_info(videos)').all().find(column=>column.name==='compression_mode');
   assert.equal(column.notnull,1);assert.equal(column.dflt_value,"'server'");
  } finally {db.close();}
  const before=snapshot(dir);
  assert.notEqual(cmd(dir,['scripts/database.mjs','init','--maintenance']).status,0);
  assert.equal(start(dir).status,0);
  assert.equal(cmd(dir,['scripts/database.mjs','check']).status,0);
  assert.deepEqual(snapshot(dir),before,'initialization refusal and normal startup never alter schema or rows');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
for(const version of [0,1])test(`version ${version} startup is read-only; explicit migration preserves users, projects, queued uploads and media`,()=>{
 const dir=temp();try{
  legacyFixture(dir,version);const before=snapshot(dir);
  const rejected=start(dir);assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/Manual migration required/);
  assert.notEqual(cmd(dir,['scripts/database.mjs','check']).status,0);
  assert.notEqual(cmd(dir,['scripts/database.mjs','migrate']).status,0);
  assert.deepEqual(snapshot(dir),before,'startup and refused commands do not repair or migrate old databases');
  const migrated=cmd(dir,['scripts/database.mjs','migrate','--maintenance']);assert.equal(migrated.status,0,migrated.stderr);
  assert.equal(start(dir).status,0);assert.equal(cmd(dir,['scripts/database.mjs','check']).status,0);
  const after=snapshot(dir);assert.equal(after.version,2);assert.deepEqual(after.media,before.media);
  for(const table of ['users','sessions','login_limits'])assert.deepEqual(after.rows[table],before.rows[table],`${table} remains unchanged`);
  const expectedProject={...before.rows.projects[0],data:JSON.stringify({...JSON.parse(before.rows.projects[0].data),category:'fmcg'})};
  assert.deepEqual(after.rows.projects,[expectedProject],'all project metadata and media references survive');
  assert.deepEqual(after.rows.videos,before.rows.videos.map(row=>({...row,compression_mode:'server'})),'existing ready and queued videos retain all fields and get the old server fallback');
  assert.equal(cmd(dir,['scripts/database.mjs','migrate','--maintenance']).status,0);
  assert.deepEqual(snapshot(dir),after,'re-running the explicit migration is idempotent');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('startup and manual migration reject incompatible schema without repairs or changes',()=>{
 for(const corruption of ["ALTER TABLE users ADD COLUMN unexpected TEXT",'DROP INDEX videos_project','PRAGMA user_version=99']) {
  const dir=temp();try{
   legacyFixture(dir,1);const db=open(dir);db.exec(corruption);db.close();const before=snapshot(dir);
   assert.notEqual(start(dir).status,0);assert.notEqual(cmd(dir,['scripts/database.mjs','migrate','--maintenance']).status,0);
   assert.deepEqual(snapshot(dir),before,corruption);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
test('mislabeling a version 2 database as legacy is refused rather than guessed or repaired',()=>{
 const dir=temp();try{
  assert.equal(cmd(dir,['scripts/database.mjs','init','--maintenance']).status,0);
  const db=open(dir);db.exec('PRAGMA user_version=0');db.close();const before=snapshot(dir);
  assert.notEqual(start(dir).status,0);assert.notEqual(cmd(dir,['scripts/database.mjs','migrate','--maintenance']).status,0);
  assert.deepEqual(snapshot(dir),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy adoption and version 2 migration remain in one rollback transaction',()=>{
 const dir=temp();try{
  legacyFixture(dir,0);const db=open(dir);
  db.exec("CREATE TRIGGER refuse_fixture_migration BEFORE UPDATE ON projects BEGIN SELECT RAISE(ABORT,'fixture migration failure'); END");db.close();
  const before=snapshot(dir);const result=cmd(dir,['scripts/database.mjs','migrate','--maintenance']);
  assert.notEqual(result.status,0);assert.match(result.stderr,/fixture migration failure/);assert.deepEqual(snapshot(dir),before);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
