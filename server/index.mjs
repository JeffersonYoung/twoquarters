import { storageOverview } from './storage.mjs';
import { projectVideos, startVideoQueue, stopVideoQueue, uploadVideo, deleteVideo, deleteProjectVideos, serveVideo } from './video.mjs';
import sharp from 'sharp';
import http from 'node:http';
import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, root, dataDir, seed } from './store.mjs';
import { session, rateLimit, randomToken, hashToken, verifyPassword } from './auth.mjs';
const port=Number(process.env.PORT||3000),host=process.env.HOST||'127.0.0.1';
const origin=new URL(process.env.APP_ORIGIN||`http://localhost:${port}`).origin;
if(process.env.NODE_ENV==='production'&&!origin.startsWith('https://')) throw new Error('Production requires APP_ORIGIN=https://your-domain');
const secure=origin.startsWith('https://');
const cookie=(value,maxAge)=>`tq_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure?'; Secure':''}`;
seed();
await startVideoQueue();
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
async function body(req,max=64*1024){
 if(Number(req.headers['content-length']||0)>max)fail('请求过大',413);
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)fail('请求过大',413);chunks.push(chunk);}return Buffer.concat(chunks);
}
async function input(req){if(!req.headers['content-type']?.startsWith('application/json'))fail('需要 JSON',415);try{return JSON.parse(await body(req));}catch(e){if(e.status)throw e;fail('JSON 格式不正确');}}
function getProject(id){const r=db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!r)fail('作品不存在',404);return JSON.parse(r.data);}
function save(p){db.prepare('UPDATE projects SET data=?,published=? WHERE id=?').run(JSON.stringify(p),p.published?1:0,p.id);return p;}
function draft(value){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('资料格式不正确');
 const d={};for(const [key,max] of Object.entries({title:200,titleEn:200,category:30,year:20,discipline:200,summary:10000,credits:2000})){
  if(value[key]!=null&&typeof value[key]!=='string')fail('文字资料格式不正确');d[key]=(value[key]||'').trim();if(d[key].length>max)fail('文字过长');
 }
 if(!d.title||!['automotive','cg-ai','fmcg','video','bts'].includes(d.category))fail('请填写标题和有效分类');d.published=value.published===true;return d;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.woff2':'font/woff2','.ico':'image/x-icon'};
async function sendFile(req,res,file,type){let bytes;try{bytes=await readFile(file);}catch{fail('Not found',404);}res.writeHead(200,{'Content-Type':type||mime[path.extname(file)]||'application/octet-stream','Content-Length':bytes.length});res.end(req.method==='HEAD'?undefined:bytes);}
let pendingLogins=0;
async function handle(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
 if(secure)res.setHeader('Strict-Transport-Security','max-age=31536000');
 const url=new URL(req.url,origin),route=url.pathname,method=req.method;
 const current=session(req);
 if(route.startsWith('/api/')){
  if(!['GET','HEAD'].includes(method)){
   if(req.headers.origin!==origin)fail('请从本站提交操作',403);
   if(route!=='/api/login'){
    if(!current)fail('请先登录',401);
    if(req.headers['x-csrf-token']!==current.csrf)fail('页面已过期，请刷新后重试',403);
   }
  }
  if(route==='/api/session'&&method==='GET')return json(res,{admin:!!current,csrfToken:current?.csrf||null});
  if(route==='/api/login'&&method==='POST'){
   const value=await input(req),username=typeof value?.username==='string'?value.username.trim():'';
   if(typeof value?.password!=='string'||value.password.length>1024||!username||username.length>80)fail('用户名或密码不正确',401);
   // Socket address is authoritative; forwarded headers are deliberately ignored.
   if(!rateLimit('ip:'+req.socket.remoteAddress,30)||!rateLimit('user:'+username,10)||pendingLogins>=4){res.setHeader('Retry-After','900');fail('登录尝试过多，请稍后重试',429);}
   pendingLogins++;let valid;try{valid=await verifyPassword(value.password,db.prepare('SELECT password FROM users WHERE username=?').get(username)?.password);}finally{pendingLogins--;}
   if(!valid)fail('用户名或密码不正确',401);
   const token=randomToken(),csrf=randomToken();
   db.prepare('DELETE FROM sessions WHERE expires<? OR username=?').run(Date.now(),username);
   db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hashToken(token),username,csrf,Date.now()+8*3600000);
   res.setHeader('Set-Cookie',cookie(token,8*3600));return json(res,{admin:true,csrfToken:csrf});
  }
  if(route==='/api/logout'&&method==='POST'){db.prepare('DELETE FROM sessions WHERE token=?').run(current.token);res.setHeader('Set-Cookie',cookie('',0));return json(res,{ok:true});}
  if(route.startsWith('/api/admin/')&&!current)fail('请先登录',401);
  if(route==='/api/admin/storage'&&method==='GET') {
   const activeJobs=db.prepare("SELECT count(*) AS n FROM videos WHERE status IN ('uploading','queued','processing')").get().n;
   return json(res,await storageOverview(dataDir,activeJobs));
  }
  if((route==='/api/projects'||route==='/api/admin/projects')&&method==='GET'){
   const rows=db.prepare('SELECT data FROM projects'+(route==='/api/projects'?' WHERE published=1':'')+' ORDER BY sort_order,rowid DESC').all();
   return json(res,rows.map(r=>projectVideos(JSON.parse(r.data),route==='/api/admin/projects')).filter(p=>route!=='/api/projects'||p.cover));
  }
  if(route.startsWith('/api/videos/')&&(method==='GET'||method==='HEAD')) {
   const id=route.slice(12); if(!/^[a-f0-9-]{36}$/.test(id))fail('视频不存在',404);
   return serveVideo(req,res,id,!!current);
  }
  const videoRoute=route.match(/^\/api\/admin\/projects\/([^/]+)\/videos(?:\/([^/]+))?$/);
  if(videoRoute) {
   const [,pid,vid]=videoRoute; getProject(pid);
   if(!vid&&method==='POST') { await uploadVideo(req,pid); return json(res,projectVideos(getProject(pid),true),202); }
   if(vid&&method==='DELETE') { await deleteVideo(pid,vid); return json(res,projectVideos(getProject(pid),true)); }
  }
  if(route.startsWith('/api/images/')&&(method==='GET'||method==='HEAD')){
   const iid=route.slice(12);if(!/^[a-f0-9-]{36}$/.test(iid))fail('图片不存在',404);
   const rows=db.prepare('SELECT data FROM projects'+(current?'':' WHERE published=1')).all();let im;
   for(const r of rows){const p=JSON.parse(r.data);im=p.images.find(x=>x.id===iid);if(im)break;}
   if(!im?.storagePath)fail('图片不存在',404);
   return sendFile(req,res,path.join(dataDir,'uploads',iid),im.contentType);
  }
  if(route==='/api/admin/projects'&&method==='POST'){
   const d=draft(await input(req)),id=randomUUID();const slug=((d.titleEn||d.title).toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/[\s-]+/g,'-')||'project')+'-'+id.slice(0,8);
   const p={...d,id,slug,published:false,cover:null,images:[]};db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(id,slug,JSON.stringify(p),0,-Date.now());return json(res,p,201);
  }
  const match=route.match(/^\/api\/admin\/projects\/([^/]+)(?:\/(cover|images)(?:\/([^/]+))?)?$/);
  if(match){
   const [,id,action,imageId]=match;
   if(!action&&method==='PATCH'){const p=getProject(id),d=draft(await input(req));if(d.published&&!p.cover)fail('请先上传图片并设置封面');return json(res,save(Object.assign(p,d)));}
   if(!action&&method==='DELETE'){const p=getProject(id);db.prepare('DELETE FROM projects WHERE id=?').run(id);await deleteProjectVideos(id);for(const im of p.images)if(im.storagePath)await unlink(path.join(dataDir,'uploads',im.id)).catch(()=>{});return json(res,{ok:true});}
   if(action==='cover'&&method==='POST'){const value=await input(req),p=getProject(id),im=p.images.find(x=>x.id===value?.imageId);if(!im)fail('图片不存在',404);p.cover=im;return json(res,save(p));}
   if(action==='images'&&imageId&&method==='DELETE'){const p=getProject(id),im=p.images.find(x=>x.id===imageId);if(!im)fail('图片不存在',404);p.images=p.images.filter(x=>x.id!==imageId);if(p.cover?.id===imageId)p.cover=p.images[0]||null;if(!p.cover)p.published=false;save(p);if(im.storagePath)await unlink(path.join(dataDir,'uploads',im.id)).catch(()=>{});return json(res,p);}
   if(action==='images'&&!imageId&&method==='POST'){
    getProject(id);if(!req.headers['content-type']?.startsWith('multipart/form-data;'))fail('需要图片表单',415);
    const bytes=await body(req,64*1024*1024);let form;try{form=await new Request(origin,{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();}catch{fail('图片表单格式不正确');}
    const files=form.getAll('images');if(!files.length||files.length>10)fail('每次请选择 1–10 张图片');
    const images=[];let total=0;
    for(const file of files){
     if(typeof file==='string'||!file.size||file.size>12*1024*1024)fail('单张图片不能超过 12MB');total+=file.size;if(total>60*1024*1024)fail('单次上传不能超过 60MB');
     const b=Buffer.from(await file.arrayBuffer());const valid=file.type==='image/jpeg'?b[0]===255&&b[1]===216&&b[2]===255:file.type==='image/png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):file.type==='image/gif'?['GIF87a','GIF89a'].includes(b.toString('ascii',0,6)):file.type==='image/webp'?b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP':false;
     if(!valid)fail('仅支持有效 JPEG、PNG、WebP 或 GIF 图片');
     let clean;try {
      const decoder=sharp(b,{animated:true,limitInputPixels:40_000_000,failOn:'warning'});
      const meta=await decoder.metadata();
      if((meta.pages||1)>50 || (meta.width||0)*(meta.height||0)>40_000_000)fail('图片像素或帧数过多');
      clean=await decoder.autoOrient().toFormat(meta.format,{quality:95}).toBuffer();
     }catch(e){if(e.status)throw e;fail('图片损坏或不能解码');}
     const iid=randomUUID();images.push({id:iid,storagePath:iid,src:'/api/images/'+iid,alt:file.name.replace(/\.[^.]+$/,'').slice(0,160),contentType:file.type,bytes:clean});
    }
    const written=[];try{
     for(const im of images){await writeFile(path.join(dataDir,'uploads',im.id),im.bytes,{flag:'wx',mode:0o600});written.push(im.id);delete im.bytes;}
     const p=getProject(id);p.images.push(...images);p.cover ||= images[0];save(p);return json(res,p);
    }catch(e){await Promise.all(written.map(i=>unlink(path.join(dataDir,'uploads',i)).catch(()=>{})));throw e;}
   }
  }
  fail('未找到接口',404);
 }
 if(!['GET','HEAD'].includes(method))fail('Method not allowed',405);
 let relative;try{relative=decodeURIComponent(route);}catch{fail('Bad path');}
 const client=path.join(root,'dist/client'),file=path.resolve(client,'.'+relative);
 if(!file.startsWith(client+path.sep)) {if(relative!=='/')fail('Not found',404);}
 if(relative!=='/'&&file.startsWith(client+path.sep)&&await stat(file).then(s=>s.isFile()).catch(()=>false))return sendFile(req,res,file);
 if(path.extname(relative))fail('Not found',404);
 return sendFile(req,res,path.join(client,'index.html'));
}
const server=http.createServer((req,res)=>{handle(req,res).catch(e=>{if(!res.headersSent)json(res,{error:e.status?e.message:'服务暂时不可用，请稍后重试'},e.status||500);else res.end();if(!e.status)console.error(e);});});
server.requestTimeout=10*60_000;server.headersTimeout=15_000;server.maxRequestsPerSocket=100;
server.listen(port,host,()=>console.log(`Twoquarters listening on ${host}:${port}; origin ${origin}`));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
 const stopped=stopVideoQueue();
 server.close(async()=>{await stopped;db.close();process.exit(0);});
 server.closeAllConnections();
});
