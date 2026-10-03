import test from 'node:test';
import assert from 'node:assert/strict';
import { transportPolicy } from '../server/transport.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';

const adminOrigin = 'https://portfolio.example.test';
test('transport trust is exact, explicit, and fail closed', () => {
 const request = (peer, proto='https', host='portfolio.example.test') => ({headers:{host,'x-forwarded-proto':proto},socket:{remoteAddress:peer}});
 assert.equal(transportPolicy(adminOrigin)(request('127.0.0.1')),false);
 const trusted = transportPolicy(adminOrigin,'127.0.0.1, ::1');
 assert.equal(trusted(request('127.0.0.1')),true);
 assert.equal(trusted(request('::ffff:127.0.0.1')),true);
 assert.equal(trusted(request('127.0.0.2')),false);
 assert.equal(trusted(request('127.0.0.1','https, http')),false);
 assert.equal(trusted(request('127.0.0.1','http')),false);
 assert.equal(trusted(request('127.0.0.1','https','evil.example')),false);
 assert.equal(trusted({...request('203.0.113.1'),socket:{encrypted:true}}),true);
 assert.throws(()=>transportPolicy(adminOrigin,'0.0.0.0/0'),/exact IP/);
});

test('production public HTTP works; admin HTTP and spoofed proxy credentials fail',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'tq-transport-'));
 let child;
 const token='a'.repeat(64), csrf='fixture-csrf';
 const image=id=>`${id}0000000-0000-0000-0000-000000000000`;
 try {
  execFileSync(process.execPath,['scripts/database.mjs','init','--maintenance'],{env:{...process.env,DATA_DIR:dir}});
  execFileSync(process.execPath,['--input-type=module','-e',`
   import {db,dataDir} from './server/store.mjs';
   import './server/video.mjs';
   import {hashToken,hashPassword} from './server/auth.mjs';
   import {writeFileSync} from 'node:fs';
   db.prepare('INSERT INTO users VALUES(?,?)').run('admin',await hashPassword('fixture-password-2026'));
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken('${token}'),'admin','${csrf}',Date.now()+60000);
   for(const [id,published] of [['1',1],['2',0]]) {
    const iid=id+'0000000-0000-0000-0000-000000000000';
    const cover={id:iid,storagePath:iid,src:'/api/images/'+iid,contentType:'image/png'};
    db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,id,JSON.stringify({id,cover,images:[cover]}),published,0);
    writeFileSync(dataDir+'/uploads/'+iid,'fixture-image');
    db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created) VALUES(?,?,?,?,?,?)').run(iid,id,'fixture','ready','video/mp4',Date.now());
    writeFileSync(dataDir+'/uploads/video-'+iid+'.mp4','fixture-video');
   }
   db.close();
  `],{env:{...process.env,DATA_DIR:dir}});
  child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'production',PORT:'0',HOST:'127.0.0.1',APP_ORIGIN:adminOrigin,TRUSTED_PROXY_IPS:'127.0.0.1',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
  let logs='';child.stderr.on('data',d=>logs+=d);
  // Port 0 avoids collisions with other parallel integration suites.
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(new Error('Server timed out '+logs)),10000);
   child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}: ${logs}`));});
   child.stdout.on('data',data=>{const match=String(data).match(/listening on [^:]+:(\d+)/);if(match){clearTimeout(timer);resolve(Number(match[1]));}});
  });
  const req=(route,{https=false,peer='127.0.0.1',method='GET',auth=false,origin=adminOrigin,host='portfolio.example.test',proto,body}={})=>new Promise((resolve,reject)=>{
   const headers={Host:host};if(https||proto)headers['X-Forwarded-Proto']=proto||'https';
   if(auth){headers.Cookie='tq_session='+token;headers['X-CSRF-Token']=csrf;}
   if(method!=='GET'){headers.Origin=origin;headers['Content-Type']='application/json';}
   const r=http.request({host:'127.0.0.1',port,path:route,localAddress:peer,method,headers},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});r.on('error',reject);r.end(body&&JSON.stringify(body));
  });
  for(const https of [false,true])for(const route of ['/','/api/site-config','/api/projects','/api/images/'+image('1'),'/api/videos/'+image('1')]) {
   const r=await req(route,{https});assert.equal(r.status,200,route);assert.equal(r.headers['strict-transport-security'],undefined);assert.equal(r.headers.location,undefined);
  }
  for(const route of ['/admin','/admin/anything','/%61dmin','/api/admin/projects','/api/login'])assert.equal((await req(route,{auth:true})).status,403,route);
  for(const https of [false,true])for(const kind of ['images','videos'])assert.equal((await req('/api/'+kind+'/'+image('2'),{https})).status,404);
  assert.equal((await req('/api/images/'+image('2')+'?width=480',{auth:true})).status,404);
  for(const kind of ['images','videos']) {
   assert.equal((await req('/api/'+kind+'/'+image('2'),{auth:true})).status,404);
   assert.equal((await req('/api/'+kind+'/'+image('2'),{auth:true,https:true})).status,200);
  }
  assert.deepEqual(JSON.parse((await req('/api/session',{auth:true})).text),{admin:false,csrfToken:null});
  assert.equal((await req('/api/admin/projects',{auth:true,https:true})).status,200);
  assert.equal((await req('/api/admin/projects',{auth:true,https:true,peer:'127.0.0.2'})).status,403);
  assert.equal((await req('/api/admin/projects',{auth:true,proto:'https, http'})).status,403);
  assert.equal((await req('/api/admin/projects',{auth:true,https:true,host:'evil.example'})).status,403);
  for(const route of ['/api/logout','/api/admin/projects','/api/site-config'])assert.equal((await req(route,{method:'POST',auth:true,body:{}})).status,403);
  const login={method:'POST',body:{username:'admin',password:'fixture-password-2026'}};
  assert.equal((await req('/api/login',login)).status,403);
  assert.equal((await req('/api/login',{...login,https:true,origin:'http://portfolio.example.test'})).status,403);
  const loggedIn=await req('/api/login',{...login,https:true});assert.equal(loggedIn.status,200);assert.match(loggedIn.headers['set-cookie'][0],/; Secure/);
 } finally {
  if(child&&child.exitCode===null){const exit=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exit;}
  await rm(dir,{recursive:true,force:true});
 }
});
