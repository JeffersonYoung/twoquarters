import { writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { putOriginal, deleteOriginal } from './oss.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function cleanupHomeImages(directory,variants){
 for(const v of variants){await unlink(path.join(directory,'uploads',v.id)).catch(()=>{});try{await deleteOriginal(v.id);}catch{console.error('Homepage image cleanup failed:',v.id);}}
}
export async function uploadHomeImages(directory,bytes){
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
    return variants;
   }catch(error){await cleanupHomeImages(directory,variants);throw error;}
}
