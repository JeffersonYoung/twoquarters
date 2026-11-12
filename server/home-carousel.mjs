import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { putOriginal, deleteOriginal } from './oss.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const imagePath=/^\/api\/images\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/;
export async function createHomeCarousel(directory) {
 const filename=path.join(directory,'home-carousel.json');
 let state={revision:0,interval:5,slides:[]};
 try {state=JSON.parse(await readFile(filename,'utf8'));} catch(error) {if(error.code!=='ENOENT')throw error;}
 if(!Array.isArray(state.slides)||!Number.isSafeInteger(state.revision)||!Number.isInteger(state.interval)||state.interval<3||state.interval>30)throw new Error('Invalid home carousel configuration');
 let queue=Promise.resolve(),pending=0;
 function exclusive(work){
  if(pending>=4)fail('首页图片正在处理中，请稍后重试',503);
  pending++;
  const job=queue.then(work);queue=job.catch(()=>{});
  return job.finally(()=>{pending--;});
 }
 async function persist(next){
  next={...next,revision:state.revision+1};
  const temp=filename+'.'+randomUUID()+'.tmp';
  try {await writeFile(temp,JSON.stringify(next),{flag:'wx',mode:0o600});await rename(temp,filename);state=next;}
  finally {await unlink(temp).catch(()=>{});}
 }
 const snapshot=(admin=false)=>({revision:state.revision,interval:state.interval,slides:state.slides.filter(s=>admin||s.enabled).map(s=>structuredClone(s))});
 function find(id,admin=false){return state.slides.filter(s=>admin||s.enabled).flatMap(s=>s.variants).find(v=>v.id===id);}
 async function cleanup(variants){
  for(const v of variants){await unlink(path.join(directory,'uploads',v.id)).catch(()=>{});try{await deleteOriginal(v.id);}catch{console.error('Carousel OSS cleanup failed:',v.id);}}
 }
 return {
  snapshot,find,
  allows(uri,method){const match=typeof uri==='string'&&uri.match(imagePath);return ['GET','HEAD'].includes(method)&&!!match&&!!find(match[1]);},
  upload(bytes,name){return exclusive(async()=>{
   if(!bytes.length||bytes.length>40*1024*1024)fail('单张图片最大 40 MB',413);
   let meta;
   try{meta=await sharp(bytes,{limitInputPixels:80_000_000,failOn:'warning'}).metadata();}catch{fail('图片损坏或超过 8000 万像素');}
   if(!['jpeg','png','webp'].includes(meta.format)||(meta.pages||1)>1)fail('请上传静态 JPEG、PNG 或 WebP 图片');
   const variants=[];
   try{
    for(const width of [480,1280,2560]){
     const {data,info}=await sharp(bytes,{limitInputPixels:80_000_000,failOn:'warning'}).autoOrient().toColourspace('srgb').resize({width,withoutEnlargement:true}).webp({quality:88,effort:4}).toBuffer({resolveWithObject:true});
     if(variants.some(v=>v.width===info.width))continue;
     const id=randomUUID(),v={id,src:'/api/images/'+id,storagePath:id,contentType:'image/webp',width:info.width,height:info.height};
     variants.push(v);await writeFile(path.join(directory,'uploads',id),data,{flag:'wx',mode:0o600});await putOriginal(id,data,'image/webp');
    }
    const slide={id:randomUUID(),name:String(name||'首页图片').slice(0,240),alt:'',enabled:false,variants};
    await persist({...state,slides:[...state.slides,slide]});return snapshot(true);
   }catch(error){await cleanup(variants);throw error;}
  });},
  update(value){return exclusive(async()=>{
   if(value?.revision!==state.revision)fail('图片列表已变化，请重新加载后再保存',409);
   if(!Number.isInteger(value.interval)||value.interval<3||value.interval>30)fail('轮播间隔须为 3–30 秒');
   if(!Array.isArray(value.slides)||value.slides.length!==state.slides.length||new Set(value.slides.map(s=>s?.id)).size!==state.slides.length)fail('请保留完整图片列表，通过删除按钮移除图片');
   const slides=value.slides.map(s=>{
    const old=state.slides.find(v=>v.id===s?.id);
    if(!old||typeof s.enabled!=='boolean'||typeof s.alt!=='string'||s.alt.length>300)fail('图片设置格式不正确');
    return {...old,enabled:s.enabled,alt:s.alt.trim()};
   });
   await persist({...state,interval:value.interval,slides});return snapshot(true);
  });},
  remove(id,revision){return exclusive(async()=>{
   if(revision!==state.revision)fail('图片列表已变化，请重新加载后再删除',409);
   const slide=state.slides.find(s=>s.id===id);if(!slide)fail('图片不存在',404);
   await persist({...state,slides:state.slides.filter(s=>s.id!==id)});
   await cleanup(slide.variants);return snapshot(true);
  });},
 };
}
