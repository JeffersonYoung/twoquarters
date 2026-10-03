import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat, cp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
const cwd=process.cwd(), origin='http://127.0.0.1:3198';
let child,dir,cookie='',csrf='';
async function start(){child=spawn(process.execPath,['server/index.mjs'],{cwd,env:{...process.env,DATA_DIR:dir,SITE_CONFIG_FILE:path.join(dir,'site.json'),PORT:'3198',APP_ORIGIN:origin},stdio:['ignore','pipe','pipe']});let log='';child.stderr.on('data',d=>log+=d);for(let i=0;i<100;i++){if(child.exitCode!==null)throw new Error(log);try{if((await fetch(origin+'/api/session')).ok)return;}catch{}await delay(50);}throw new Error('Server start timed out '+log);}
async function stop(){if(!child)return;const p=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await p;child=null;}
async function req(route,{method='GET',body,auth=false,token=true,from=origin}={}){const headers={};if(method!=='GET')headers.Origin=from;if(auth){headers.Cookie=cookie;if(token)headers['X-CSRF-Token']=csrf;}if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';return fetch(origin+route,{method,headers,body:body?body instanceof FormData?body:JSON.stringify(body):undefined});}
async function json(route,opts){const res=await req(route,opts);return [res,await res.json()];}
const details={title:'Test draft',titleEn:'Test draft',category:'fmcg',year:'2026',discipline:'Photo',summary:'A test',credits:'Test',published:false};
test('self-contained auth, CRUD, uploads, privacy, and restart persistence',async()=>{
 dir=await mkdtemp(path.join(tmpdir(),'tq-api-'));
 try{
  execFileSync(process.execPath,['scripts/database.mjs','init','--maintenance'],{cwd,env:{...process.env,DATA_DIR:dir}});
  const init=spawn(process.execPath,['scripts/admin.mjs','test-admin','--stdin'],{cwd,env:{...process.env,DATA_DIR:dir},stdio:['pipe','pipe','pipe']});init.stdin.end('Test-only-local-password-2026\n');assert.equal(await new Promise(r=>init.on('exit',r)),0);
  // Simulate an existing installation using the retired fashion category.
  execFileSync(process.execPath,['--input-type=module','-e',`import {db,root,dataDir} from './server/store.mjs';import {initializeSamples} from './server/samples.mjs';initializeSamples({db,root,dataDir});db.exec("UPDATE projects SET data=json_set(data,'$.category','fashion') WHERE json_extract(data,'$.category')='fmcg'");db.exec('PRAGMA user_version=0');db.close();`],{cwd,env:{...process.env,DATA_DIR:dir}});
  execFileSync(process.execPath,['scripts/database.mjs','migrate','--maintenance'],{cwd,env:{...process.env,DATA_DIR:dir}});
  await writeFile(path.join(dir,'site.json'),JSON.stringify({secret:'not-public',filing:{icp:{number:'测试备案（非真实）',url:'https://example.com/verify'}},socialLinks:[{label:'小红书',url:'https://example.com/profile'}]}));
  await start();
  const configResponse=await req('/api/site-config');
  assert.equal(configResponse.status,200);assert.equal(configResponse.headers.get('cache-control'),'no-store');
  assert.deepEqual(await configResponse.json(),{filingItems:[{label:'测试备案（非真实）',url:'https://example.com/verify'}],socialLinks:[{label:'小红书',url:'https://example.com/profile'}]});
  assert.equal((await req('/api/site-config',{method:'POST',body:{}})).status,401);
  assert.equal((await req('/config/site.json')).status,404);
  assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(path.join(dir,'portfolio.sqlite'))).mode&0o777,0o600);
  let [r,list]=await json('/api/projects');assert.equal(r.status,200);assert.equal(list.length,6);assert.equal((await req(list[0].cover.src)).status,200);
  assert.equal((await req('/api/admin/projects')).status,401);
  assert.equal((await req('/api/admin/storage')).status,401);
  assert.equal((await req('/api/admin/projects',{method:'POST',body:details})).status,401);
  assert.equal((await req('/api/login',{method:'POST',body:{username:'test-admin',password:'wrong'}})).status,401);
  assert.equal((await req('/api/login',{method:'POST',from:'https://evil.example',body:{username:'test-admin',password:'Test-only-local-password-2026'}})).status,403);
  let session;[r,session]=await json('/api/login',{method:'POST',body:{username:'test-admin',password:'Test-only-local-password-2026'}});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];csrf=session.csrfToken;assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const [storageResponse,storage]=await json('/api/admin/storage',{auth:true});
  assert.equal(storageResponse.status,200);assert.equal(storageResponse.headers.get('cache-control'),'no-store');
  assert.equal(storage.filesystem.totalBytes,storage.filesystem.usedBytes+storage.filesystem.availableBytes+storage.filesystem.reservedBytes);
  assert.ok(storage.filesystem.totalBytes>0);assert.ok(storage.managedFiles.allocatedBytes>0);
  assert.equal(storage.video.requiredBytes,1024**3+500*1024**2);
  assert.equal(storage.video.hasSpaceForNextUpload,storage.video.availableBytes>=storage.video.requiredBytes);
  assert.equal(JSON.stringify(storage).includes(dir),false);
  assert.equal((await req('/api/admin/projects',{method:'POST',body:{...details,category:'fashion'},auth:true})).status,400);
  const migrated=list.find(p=>p.slug==='chroma-objects');
  assert.equal(migrated.category,'fmcg');assert.ok(migrated.images.length>0);
  assert.equal((await req(migrated.cover.src)).status,200);
  assert.equal((await req('/api/admin/projects/'+migrated.id,{method:'PATCH',body:migrated,auth:true})).status,200);
  for(const category of ['automotive','cg-ai','fmcg','video','bts']) {
   const [response,project]=await json('/api/admin/projects',{method:'POST',body:{...details,category},auth:true});
   assert.equal(response.status,201);assert.equal(project.category,category);
   assert.equal((await req('/api/admin/projects/'+project.id,{method:'DELETE',auth:true})).status,200);
  }
  assert.equal((await req('/api/admin/projects',{method:'POST',body:details,auth:true,token:false})).status,403);
  assert.equal((await req('/api/admin/projects',{method:'POST',body:details,auth:true,from:'https://evil.example'})).status,403);
  let created;[r,created]=await json('/api/admin/projects',{method:'POST',body:details,auth:true});assert.equal(r.status,201);const endpoint='/api/admin/projects/'+created.id;
  assert.equal((await req(endpoint,{method:'PATCH',body:{...details,published:true},auth:true})).status,400);
  const invalid=new FormData();invalid.append('images',new Blob([Buffer.from([255,216,255])],{type:'image/jpeg'}),'bad.jpg');assert.equal((await req(endpoint+'/images',{method:'POST',body:invalid,auth:true})).status,400);
  const png=await sharp({create:{width:8,height:8,channels:3,background:'#f00'}}).png().toBuffer();
  const oriented=await sharp({create:{width:12,height:8,channels:3,background:'#0f0'}}).jpeg().withMetadata({orientation:6}).toBuffer();
  const form=new FormData();form.append('images',new Blob([png],{type:'image/png'}),'test.png');form.append('images',new Blob([oriented],{type:'image/jpeg'}),'oriented.jpg');
  [r,created]=await json(endpoint+'/images',{method:'POST',body:form,auth:true});assert.equal(r.status,200);assert.equal(created.images.length,2);
  const image=created.images[0],second=created.images[1];
  const orientedResult=await sharp(Buffer.from(await (await req(second.src,{auth:true})).arrayBuffer())).metadata();assert.equal(orientedResult.width,8);assert.equal(orientedResult.height,12);assert.equal(orientedResult.orientation,undefined);assert.equal((await req(image.src)).status,404);assert.equal((await req(image.src,{auth:true})).status,200);
  for(const width of [480,960,1600]) {
   assert.equal((await req(image.src+'?width='+width)).status,404);
   const preview=await req(image.src+'?width='+width,{auth:true});assert.equal(preview.status,200);assert.equal(preview.headers.get('content-type'),'image/webp');assert.equal(preview.headers.get('cache-control'),'private, no-store');
   const meta=await sharp(Buffer.from(await preview.arrayBuffer())).metadata();assert.equal(meta.width,8);assert.equal(meta.height,8);
  }
  assert.equal(created.images[1].width,8);assert.equal(created.images[1].height,12);
  assert.equal((await req(image.src+'?width=123',{auth:true})).status,400);
  assert.equal((await req(image.src+'?width=480&width=960',{auth:true})).status,400);
  [r,created]=await json(endpoint+'/cover',{method:'POST',body:{imageId:second.id},auth:true});assert.equal(created.cover.id,second.id);
  assert.equal((await req(endpoint,{method:'PATCH',body:{...details,published:true},auth:true})).status,200);
  assert.equal((await req(image.src)).status,200);assert.equal((await (await req('/api/projects')).json()).length,7);
  const preview=await req(image.src+'?width=480');assert.equal(preview.headers.get('cache-control'),'public, max-age=0, must-revalidate');assert.equal(preview.headers.get('vary'),'Cookie');const etag=preview.headers.get('etag');assert.ok(etag);
  assert.equal((await fetch(origin+image.src+'?width=480',{headers:{'If-None-Match':etag}})).status,304);
  assert.equal((await req(image.src+'?width=480',{method:'HEAD'})).headers.get('content-type'),'image/webp');
  await stop();
  const restored=await mkdtemp(path.join(tmpdir(),'tq-restored-'));
  await cp(dir,restored,{recursive:true});await rm(dir,{recursive:true,force:true});dir=restored;
  await start();assert.equal((await (await req('/api/projects')).json()).length,7);assert.equal((await req(image.src)).status,200);assert.equal((await req('/api/admin/projects',{auth:true})).status,200);
  assert.equal((await req(endpoint,{method:'PATCH',body:details,auth:true})).status,200);assert.equal((await req(image.src)).status,404);
  assert.equal((await fetch(origin+image.src+'?width=480',{headers:{'If-None-Match':etag}})).status,404);
  assert.equal((await req(endpoint+'/images/'+second.id,{method:'DELETE',auth:true})).status,200);assert.equal((await req(second.src,{auth:true})).status,404);
  assert.equal((await readdir(path.join(dir,'uploads'))).some(name=>name.includes(second.id)),false);
  // Existing sample media is generated lazily, without database or initialization changes.
  const samplePreview=await req(list[1].cover.src+'?width=480');assert.equal(samplePreview.status,200);assert.equal((await sharp(Buffer.from(await samplePreview.arrayBuffer())).metadata()).width,480);
  // Seed images are also protected after unpublishing.
  const seed=list[1];assert.equal((await req('/api/admin/projects/'+seed.id,{method:'PATCH',body:{...seed,published:false},auth:true})).status,200);assert.equal((await req(seed.cover.src)).status,404);assert.equal((await req(seed.cover.src+'?width=480')).status,404);
  assert.equal((await req(endpoint,{method:'DELETE',auth:true})).status,200);assert.equal((await req(image.src,{auth:true})).status,404);assert.equal((await readdir(path.join(dir,'uploads'))).some(name=>name.includes(image.id)),false);
  assert.equal((await req('/api/logout',{method:'POST',auth:true})).status,200);assert.equal((await req('/api/admin/projects',{auth:true})).status,401);
  for(const route of ['/server/auth.mjs','/data/portfolio.sqlite','/%2e%2e%2fserver%2fauth.mjs'])assert.equal((await req(route)).status,404);
  for(let i=0;i<10;i++)r=await req('/api/login',{method:'POST',body:{username:'test-admin',password:'wrong'}});assert.equal(r.status,429);
  await stop();await start();assert.equal((await (await req('/api/projects')).json()).length,5,'seed must not reimport or republish after restart');
 }finally{await stop();if(dir)await rm(dir,{recursive:true,force:true});}
});
