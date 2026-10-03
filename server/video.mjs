import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createReadStream, statfsSync } from 'node:fs';
import { open, rename, unlink, stat, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { db, dataDir } from './store.mjs';

import { MAX_VIDEO_BYTES, VIDEO_DISK_RESERVE } from './storage.mjs';
export { MAX_VIDEO_BYTES } from './storage.mjs';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const file = (id, suffix) => path.join(dataDir, 'uploads', `video-${id}.${suffix}`);
const remove = p => unlink(p).catch(error => { if (error.code !== 'ENOENT') throw error; });
const find = id => db.prepare('SELECT * FROM videos WHERE id=?').get(id);
const DISK_RESERVE = VIDEO_DISK_RESERVE;
function ensureDiskSpace(additional = 0) {
 const active = db.prepare("SELECT count(*) AS n FROM videos WHERE status IN ('uploading','queued','processing')").get().n;
 const disk = statfsSync(path.join(dataDir,'uploads'));
 if (disk.bavail * disk.bsize < DISK_RESERVE + (active + additional) * 2 * MAX_VIDEO_BYTES) fail('服务器可用空间不足，请清理存储后重试',507);
}
const uploadRequests = new Map();
let uploading = 0, running = false, stopping = false, activeProcess, activeId;


export function projectVideos(p, admin = false) {
 const rows = db.prepare('SELECT * FROM videos WHERE project_id=? ORDER BY created,id').all(p.id);
 return { ...p, videos: rows.filter(v => admin || v.status === 'ready').map(v => ({
  id: v.id, src: '/api/videos/' + v.id, name: v.name, status: v.status,
  contentType: 'video/mp4', width: v.width, height: v.height, duration: v.duration,
  ...(admin ? { error: v.error, sourceBytes: v.source_bytes, outputBytes: v.output_bytes } : {}),
 })) };
}
function command(bin, args, timeout = 30000) {
 return new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcess = child;
  let out = '', err = '', tooLarge = false;
  const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
  child.stdout.on('data', data => { out += data; if (out.length > 1024 * 1024) { tooLarge = true; child.kill('SIGKILL'); } });
  child.stderr.on('data', data => { err = (err + data).slice(-8192); });
  child.on('error', reject);
  child.on('close', code => {
   clearTimeout(timer); if (activeProcess === child) activeProcess = undefined;
   if (code === 0 && !tooLarge) resolve(out); else reject(new Error(`${bin} failed (${code}): ${err}`));
  });
 });
}
async function inspect(id, type) {
 const source = file(id, 'source');
 const handle = await open(source, 'r'); const magic = Buffer.alloc(16);
 try { await handle.read(magic, 0, 16, 0); } finally { await handle.close(); }
 const webm = type === 'video/webm';
 if (webm ? !magic.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) : magic.toString('ascii',4,8) !== 'ftyp') throw new Error('Invalid container');
 // Force a container demuxer: never allow playlists or arbitrary protocol auto-detection.
 const info = JSON.parse(await command('ffprobe', ['-v','error','-protocol_whitelist','file','-f',webm?'matroska':'mov','-threads','2','-show_streams','-show_format','-of','json',source]));
 const streams = info.streams || [], video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
 const duration = Number(info.format?.duration);
 if (!video || streams.length > 8 || !Number.isFinite(duration) || duration <= 0 || duration > 600 ||
  !video.width || !video.height || Math.max(video.width,video.height) > 4096 || video.width * video.height > 8847360) throw new Error('Unsupported dimensions or duration');
 const [n,d] = String(video.avg_frame_rate).split('/').map(Number);
 if (!Number.isFinite(n/d) || n/d <= 0 || n/d > 120) throw new Error('Unsupported frame rate');
 return { video, duration, demuxer: webm?'matroska':'mov' };
}
async function processQueue() {
 if (running || stopping) return;
 running = true;
 try {
  while (!stopping) {
   const v = db.prepare("SELECT * FROM videos WHERE status='queued' ORDER BY created,id LIMIT 1").get();
   if (!v) break;
   activeId = v.id;
   db.prepare("UPDATE videos SET status='processing',error=NULL WHERE id=?").run(v.id);
   try {
    ensureDiskSpace();
    const { video, duration, demuxer } = await inspect(v.id, v.input_type);
    if (!find(v.id) || stopping) continue;
    // Account for pixel aspect ratio; retain orientation; cap long/short edges at 1920/1080.
    const factor = 'min(1,min(1920/max(iw*sar,ih),1080/min(iw*sar,ih)))';
    const filter = `scale=w='max(2,trunc(iw*sar*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)',setsar=1`;
    await command('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-y','-xerror','-protocol_whitelist','file',
     '-f',demuxer,'-threads','2','-i',file(v.id,'source'),'-map',`0:${video.index}`,'-map','0:a:0?',
     '-map_metadata','-1','-map_chapters','-1','-sn','-dn','-vf',filter,'-filter_threads','1',
     '-c:v','libx264','-threads','2','-preset','fast','-crf','22','-pix_fmt','yuv420p','-fpsmax','30',
     '-c:a','aac','-b:a','128k','-ac','2','-ar','48000','-t','600','-fs',String(MAX_VIDEO_BYTES),
     '-movflags','+faststart','-f','mp4',file(v.id,'partial')], 15*60*1000);
    if (!find(v.id)) continue;
    const output = JSON.parse(await command('ffprobe',['-v','error','-protocol_whitelist','file','-f','mov','-show_streams','-show_format','-of','json',file(v.id,'partial')]));
    const stream = output.streams.find(s=>s.codec_type==='video'), size = (await stat(file(v.id,'partial'))).size;
    if (!stream || stream.codec_name!=='h264' || !size || size >= MAX_VIDEO_BYTES || !Number.isFinite(Number(output.format.duration)) || Number(output.format.duration) < duration - 0.25) throw new Error('Invalid output');
    if (!find(v.id)) continue;
    await rename(file(v.id,'partial'),file(v.id,'mp4'));
    if (!find(v.id)) { await remove(file(v.id,'mp4')); continue; }
    await remove(file(v.id,'source'));
    db.prepare("UPDATE videos SET status='ready',output_bytes=?,width=?,height=?,duration=?,error=NULL WHERE id=?").run(size,stream.width,stream.height,Number(output.format.duration),v.id);
   } catch (error) {
    await Promise.all(['source','partial','mp4'].map(s=>remove(file(v.id,s))));
    if (!stopping) db.prepare("UPDATE videos SET status='failed',error=? WHERE id=?").run('视频处理失败；临时原片已清理，请重新上传有效 MP4 / MOV / WebM（最长 10 分钟、最高 4K / 120fps），或检查服务器 FFmpeg 与磁盘空间。',v.id);
    console.error(`Video processing failed: ${v.id}: ${error.message}`);
   } finally {
    activeId = undefined;
    await remove(file(v.id,'partial'));
    await remove(file(v.id,'source'));
    if (!find(v.id)) { await remove(file(v.id,'source')); await remove(file(v.id,'mp4')); }
   }
  }
 } finally { running = false; }
}
export async function startVideoQueue() {
 // A crash interrupts uploads/encodes. Discard temporary originals rather than silently retaining them.
 db.prepare("UPDATE videos SET status='failed',error=? WHERE status IN ('uploading','processing')").run('处理被服务器重启中断；临时原片已清理，请重新上传。');
 for (const name of await readdir(path.join(dataDir,'uploads'))) {
  const match = /^video-([a-f0-9-]{36})\.(source|partial|mp4)$/.exec(name); if (!match) continue;
  const v = find(match[1]);
  const keep = v && ((match[2] === 'source' && v.status === 'queued') || (match[2] === 'mp4' && v.status === 'ready'));
  if (!keep) await remove(path.join(dataDir,'uploads',name));
 }
 void processQueue();
}
export async function stopVideoQueue() {
 stopping = true; activeProcess?.kill('SIGKILL');
 while (running || uploading) await delay(20);
}
export async function uploadVideo(req, projectId) {
 if (stopping) fail('服务器正在重启，请稍后重试',503);
 const type = String(req.headers['content-type'] || '').split(';')[0];
 if (!['video/mp4','video/webm','video/quicktime'].includes(type)) fail('仅支持 MP4、MOV 或 WebM 视频',415);
 const length = Number(req.headers['content-length']);
 if (length > MAX_VIDEO_BYTES) fail('视频不能超过 250 MiB',413);
 if (uploading >= 2 || db.prepare("SELECT count(*) AS n FROM videos WHERE status IN ('uploading','queued','processing')").get().n >= 8) fail('视频队列已满，请稍后再试',429);
 ensureDiskSpace(1);
 let name; try { name = decodeURIComponent(req.headers['x-upload-name'] || 'video'); } catch { fail('文件名格式不正确'); }
 name = path.basename(name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,160) || 'video';
 const id = randomUUID(); let handle, complete = false; uploading++;
 try {
  db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created) VALUES(?,?,?,?,?,?)').run(id,projectId,name,'uploading',type,Date.now());
  uploadRequests.set(id,req);
  handle = await open(file(id,'source'),'wx',0o600); let size = 0;
  if (!find(id) || req.destroyed) fail('上传已取消',409);
  for await (const chunk of req) { size += chunk.length; if (size > MAX_VIDEO_BYTES) fail('视频不能超过 250 MiB',413); await handle.writeFile(chunk); }
  await handle.close(); handle = undefined;
  if (!size) fail('视频文件为空');
  if (!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) fail('作品不存在',404);
  const updated=db.prepare("UPDATE videos SET status='queued',source_bytes=? WHERE id=?").run(size,id);
  if (!updated.changes) fail('上传已取消',409);
  complete = true; setImmediate(() => void processQueue());
 } finally {
  try {
   if (handle) await handle.close();
   if (!complete) { db.prepare('DELETE FROM videos WHERE id=?').run(id); await remove(file(id,'source')); }
  } finally { uploading--; uploadRequests.delete(id); }
 }
}
export async function deleteVideo(projectId, id) {
 const v = find(id); if (!v || v.project_id !== projectId) fail('视频不存在',404);
 db.prepare('DELETE FROM videos WHERE id=?').run(id);
 uploadRequests.get(id)?.destroy();
 if (activeId === id) activeProcess?.kill('SIGKILL');
 // A running process may still hold a file handle; the worker performs a final cleanup too.
 await Promise.all(['source','mp4','partial'].map(s=>remove(file(id,s))));
}
export async function deleteProjectVideos(projectId) {
 for (const v of db.prepare('SELECT id FROM videos WHERE project_id=?').all(projectId)) await deleteVideo(projectId,v.id);
}
export async function serveVideo(req,res,id,admin) {
 const v = find(id), p = v && db.prepare('SELECT published FROM projects WHERE id=?').get(v.project_id);
 if (!v || v.status !== 'ready' || !p || (!admin && !p.published)) fail('视频不存在',404);
 let size; try { size = (await stat(file(id,'mp4'))).size; } catch { fail('视频不存在',404); }
 let start=0,end=size-1,status=200;
 const range = req.headers.range;
 if (range) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1]&&!match[2])) { res.setHeader('Content-Range',`bytes */${size}`); fail('Invalid range',416); }
  if (!match[1]) { const suffix=Number(match[2]); start=Math.max(0,size-suffix); }
  else { start=Number(match[1]); if(match[2]) end=Math.min(Number(match[2]),size-1); }
  if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start) { res.setHeader('Content-Range',`bytes */${size}`); fail('Invalid range',416); }
  status=206; res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
 }
 res.writeHead(status,{'Content-Type':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes'});
 if(req.method==='HEAD') return res.end();
 const stream=createReadStream(file(id,'mp4'),{start,end});
 res.on('close',()=>stream.destroy()); stream.on('error',()=>res.destroy()); stream.pipe(res);
}
