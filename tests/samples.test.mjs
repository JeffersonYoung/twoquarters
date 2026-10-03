import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { initializeSamples } from '../server/samples.mjs';
const root = process.cwd();
function command(dir, args) { return spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' }); }
function store(dir) { if(!existsSync(path.join(dir,'portfolio.sqlite'))) {const init=command(dir,['scripts/database.mjs','init','--maintenance']);assert.equal(init.status,0,init.stderr);} const result = command(dir, ['--input-type=module', '-e', "import {db} from './server/store.mjs';db.close()"]); assert.equal(result.status, 0, result.stderr); return new DatabaseSync(path.join(dir, 'portfolio.sqlite')); }
function temp() { return mkdtempSync(path.join(tmpdir(), 'tq-samples-')); }
async function startEmpty(dir) {
 const child = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, DATA_DIR: dir, SITE_CONFIG_FILE: '', HOST: '127.0.0.1', PORT: '3197', APP_ORIGIN: 'http://127.0.0.1:3197', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
 let log = '';child.stderr.on('data', b => log += b);
 try {
  for (let i = 0; i < 100; i++) {
   assert.equal(child.exitCode, null, log);
   try { const response = await fetch('http://127.0.0.1:3197/api/projects'); if(response.ok) { assert.deepEqual(await response.json(), []); return; } } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; }
   await delay(50);
  }
  assert.fail('Startup timed out: ' + log);
 } finally { if (child.exitCode === null && child.signalCode === null) { const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGTERM'); await exited; } }
}
test('fresh and repeated startup stays empty, creates no settings or replacement marker table', async () => {
 const dir = temp();
 try {
  store(dir).close(); await startEmpty(dir); await startEmpty(dir);
  const db = new DatabaseSync(path.join(dir, 'portfolio.sqlite'));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name), ['login_limits', 'projects', 'sessions', 'users', 'videos']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n, 0);db.close();
  assert.deepEqual(readdirSync(path.join(dir, 'uploads')), []);
 } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('explicit CLI imports six projects, preserves credentials, refuses duplicate import without changes', async () => {
 const dir = temp();
 try {
  let db = store(dir);db.prepare('INSERT INTO users VALUES(?,?)').run('existing-admin','unchanged-hash');db.close();
  let result = command(dir, ['scripts/init-samples.mjs']);assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/Initialized 6/);
  db = new DatabaseSync(path.join(dir,'portfolio.sqlite'));
  const before = db.prepare('SELECT * FROM projects ORDER BY id').all();assert.equal(before.length,6);
  const files = readdirSync(path.join(dir,'uploads')).sort();assert.ok(files.length > 0);
  for (const row of before) { const p=JSON.parse(row.data);assert.equal(p.published,true);for(const im of p.images)assert.ok(readFileSync(path.join(dir,'uploads',im.storagePath)).length > 0); }
  result = command(dir,['scripts/init-samples.mjs']);assert.equal(result.status,1);assert.match(result.stderr,/projects already exist/);
  assert.deepEqual(db.prepare('SELECT * FROM projects ORDER BY id').all(),before);assert.deepEqual(readdirSync(path.join(dir,'uploads')).sort(),files);
  assert.equal(db.prepare('SELECT password FROM users').get().password,'unchanged-hash');assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='settings'").get(),undefined);
  db.exec('DELETE FROM projects');db.close();for(const file of files)rmSync(path.join(dir,'uploads',file));
  await startEmpty(dir);await startEmpty(dir);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('existing custom content, media and legacy settings survive upgrade; no settings consulted by initializer', () => {
 const dir=temp();
 try {
  let db=store(dir);
  const p={id:'own',slug:'own',category:'fmcg',title:'Keep me',images:[{storagePath:'own-image'}],videos:[{storagePath:'own-video'}]};
  db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(p.id,p.slug,JSON.stringify(p),0,9);
  db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO settings VALUES('seed','repository-only-v1'),('custom','keep');");
  writeFileSync(path.join(dir,'uploads','own-image'),'image');writeFileSync(path.join(dir,'uploads','own-video'),'video');db.close();
  db=store(dir);assert.deepEqual(JSON.parse(db.prepare('SELECT data FROM projects').get().data),{...p,category:'fmcg'});
  const before=db.prepare('SELECT * FROM projects').all();
  assert.equal(command(dir,['scripts/init-samples.mjs']).status,1);assert.deepEqual(db.prepare('SELECT * FROM projects').all(),before);
  assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get().n,2);
  assert.equal(readFileSync(path.join(dir,'uploads','own-image'),'utf8'),'image');assert.equal(readFileSync(path.join(dir,'uploads','own-video'),'utf8'),'video');
  db.exec('DELETE FROM projects');
  assert.throws(()=>initializeSamples({db,root,dataDir:dir}),/uploads is not empty/);
  rmSync(path.join(dir,'uploads','own-image'));rmSync(path.join(dir,'uploads','own-video'));
  assert.equal(initializeSamples({db,root,dataDir:dir}),6,'manual operation does not consult legacy seed marker');
  assert.equal(db.prepare('SELECT count(*) AS n FROM settings').get().n,2);db.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('partial import failure rolls back records and only new files, then explicit retry succeeds', () => {
 const dir=temp(),fixture=temp();
 try {
  const db=store(dir);mkdirSync(path.join(fixture,'server','seed-images'),{recursive:true});
  copyFileSync(path.join(root,'server','seed-images','bts','vitalik-vynarchyk-TUzsO59UFpo-unsplash.jpg'),path.join(fixture,'server','seed-images','present.jpg'));
  const sample=slug=>({slug,cover:{src:'/images/present.jpg'},images:[{src:'/images/present.jpg'}]});
  const first=sample('first'),second=sample('second');second.images.push({src:'/images/missing.jpg'});
  writeFileSync(path.join(fixture,'server','seed.json'),JSON.stringify([first,second]));
  assert.throws(()=>initializeSamples({db,root:fixture,dataDir:dir}),/ENOENT/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,0);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
  writeFileSync(path.join(fixture,'server','seed.json'),JSON.stringify([first,first]));
  assert.throws(()=>initializeSamples({db,root:fixture,dataDir:dir}),/UNIQUE/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,0);assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);
  assert.equal(initializeSamples({db,root,dataDir:dir}),6);db.close();
 } finally { rmSync(dir,{recursive:true,force:true});rmSync(fixture,{recursive:true,force:true}); }
});

test('orphan video records also prevent an import without altering records', () => {
 const dir=temp();
 try {
  const db=store(dir);db.exec("INSERT INTO videos(id,project_id,name,status,input_type,created) VALUES('orphan','missing','fixture','failed','video/mp4',0)");
  assert.throws(()=>initializeSamples({db,root,dataDir:dir}),/video records already exist/);
  assert.equal(db.prepare('SELECT id FROM videos').get().id,'orphan');assert.deepEqual(readdirSync(path.join(dir,'uploads')),[]);db.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('simultaneous explicit initializers import only once without duplicate files', async () => {
 const dir=temp();
 try {
  const run=()=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['scripts/init-samples.mjs'],{cwd:root,env:{...process.env,DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
   let stderr='';child.stderr.on('data',b=>stderr+=b);child.once('error',reject);child.once('exit',code=>resolve({code,stderr}));
  });
  // Initialize only the schema before racing the two deployment commands.
  store(dir).close();
  const results=await Promise.all([run(),run()]);assert.deepEqual(results.map(r=>r.code).sort(),[0,1]);assert.match(results.find(r=>r.code===1).stderr,/projects already exist/);
  const db=new DatabaseSync(path.join(dir,'portfolio.sqlite'));const projects=db.prepare('SELECT data FROM projects').all();assert.equal(projects.length,6);
  const referenced=projects.flatMap(row=>JSON.parse(row.data).images.map(im=>im.storagePath));assert.deepEqual(readdirSync(path.join(dir,'uploads')).sort(),referenced.sort());db.close();
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
