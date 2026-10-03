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
// Copy/browser eligibility limits are aligned with the browser compressor and
// allow modest overhead above its 4 Mbps / 128 kbps targets. Server CRF output
// remains quality-based and may exceed these bitrate caps, especially on short clips.
const MAX_VIDEO_BITRATE = 4_500_000, MAX_AUDIO_BITRATE = 160_000;
const MAX_OUTPUT_BITRATE = MAX_VIDEO_BITRATE + MAX_AUDIO_BITRATE + 128_000;
const PROCESS_TIMEOUT = 15 * 60 * 1000;
const rate = value => {
 const [n, d = 1] = String(value).split(/[/:]/).map(Number);
 return Number.isFinite(n / d) ? n / d : NaN;
};
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
  contentType: v.output_type, width: v.width, height: v.height, duration: v.duration,
  ...(admin ? { error: v.error, sourceBytes: v.source_bytes, outputBytes: v.output_bytes } : {}),
 })) };
}
function command(bin, args, timeout = 30000, consume) {
 return new Promise((resolve, reject) => {
  const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  activeProcess = child;
  let out = '', err = '', failure;
  const timer = setTimeout(() => { failure = new Error(`${bin} timed out`); child.kill('SIGKILL'); }, timeout);
  child.stdout.on('data', data => {
   try {
    if (consume) consume(String(data));
    else { out += data; if (out.length > 1024 * 1024) throw new Error('Probe output exceeded limit'); }
   } catch (error) { failure = error; child.kill('SIGKILL'); }
  });
  child.stderr.on('data', data => { err = (err + data).slice(-8192); });
  child.on('error', error => { failure = error; });
  child.on('close', code => {
   clearTimeout(timer); if (activeProcess === child) activeProcess = undefined;
   // Every caller uses loglevel=error. A partial probe can exit zero while still
   // reporting malformed packets, which must not be accepted as valid media.
   if (code === 0 && !failure && !err.trim()) resolve(out);
   else reject(failure || new Error(`${bin} failed (${code}): ${err}`));
  });
 });
}
// Matroska already supplies framed packets. Avoid the redundant Opus parser,
// which reports an error on end-of-stream with FFmpeg 8; decoding stays strict.
const inputFlags = demuxer => demuxer === 'matroska' ? ['-fflags', '+noparse'] : [];
const outputSuffix = v => v.output_type === 'video/webm' ? 'webm' : 'mp4';
async function probe(source, demuxer) {
 return JSON.parse(await command('ffprobe', ['-v','error','-protocol_whitelist','file','-f',demuxer,
  ...inputFlags(demuxer),'-threads','2','-show_streams','-show_format','-of','json',source]));
}
async function inspectBmff(source, size) {
 // ffprobe may tolerate a truncated trailing moov/metadata box. Validate top-level
 // lengths ourselves before either decoding or accepting a lossless copy.
 const handle = await open(source,'r'), header = Buffer.alloc(16);
 let offset = 0, boxes = 0, movie = 0, media = 0, brand;
 try {
  while (offset < size) {
   if (++boxes > 10000 || size-offset < 8) throw new Error('Invalid MP4 boxes');
   const { bytesRead } = await handle.read(header,0,16,offset);
   let length = header.readUInt32BE(0), headerLength = 8;
   const type = header.toString('ascii',4,8);
   if (length === 1) {
    if (bytesRead < 16) throw new Error('Invalid MP4 extended box');
    const extended = header.readBigUInt64BE(8);
    if (extended > BigInt(size)) throw new Error('Invalid MP4 box size');
    length = Number(extended); headerLength = 16;
   } else if (length === 0) length = size-offset;
   if (length < headerLength || length > size-offset) throw new Error('Truncated MP4 box');
   if (offset === 0) {
    if (type !== 'ftyp' || headerLength !== 8 || length < 16) throw new Error('Invalid MP4 signature');
    brand = header.toString('ascii',8,12);
   }
   if (type === 'moov') movie++;
   if (type === 'mdat') media++;
   offset += length;
  }
 } finally { await handle.close(); }
 if (movie !== 1 || !media) throw new Error('Missing MP4 media');
 return /^(isom|iso[2-9]|mp4[12]|avc1|M4V |dash)$/.test(brand);
}
async function inspect(id, type, suffix = 'source') {
 const source = file(id, suffix), size = (await stat(source)).size;
 if (!size || size > MAX_VIDEO_BYTES) throw new Error('Unsupported file size');
 const handle = await open(source, 'r'); const magic = Buffer.alloc(16);
 try { await handle.read(magic, 0, 16, 0); } finally { await handle.close(); }
 const webm = type === 'video/webm';
 if (webm ? !magic.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])) : magic.toString('ascii',4,8) !== 'ftyp') throw new Error('Invalid container');
 // Force a container demuxer: never allow playlists or arbitrary protocol auto-detection.
 const mp4 = webm ? false : await inspectBmff(source,size);
 const demuxer = webm ? 'matroska' : 'mov', info = await probe(source, demuxer);
 const streams = info.streams || [], video = streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
 const duration = Number(info.format?.duration);
 if (!video || streams.length > 8 || !Number.isFinite(duration) || duration <= 0 || duration > 600 ||
  !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 2 || video.height < 2 ||
  Math.max(video.width,video.height) > 4096 || video.width * video.height > 8847360) throw new Error('Unsupported dimensions or duration');
 const fps = rate(video.avg_frame_rate);
 if (!Number.isFinite(fps) || fps <= 0 || fps > 120) throw new Error('Unsupported frame rate');
 for (const stream of streams) {
  if (stream.duration !== undefined && (!Number.isFinite(Number(stream.duration)) || Number(stream.duration) > 600 || Number(stream.duration) <= 0)) throw new Error('Unsupported stream duration');
  if (stream.codec_type === 'audio' && (!Number.isInteger(stream.channels) || stream.channels < 1 || stream.channels > 8 || Number(stream.sample_rate) > 192000)) throw new Error('Unsupported audio');
 }
 return { video, streams, duration, demuxer, size, source, info, mp4 };
}
function outputShape(media, webm = false) {
 const { video, streams, mp4 } = media;
 const audio = streams.filter(stream => stream.codec_type === 'audio');
 const frameRate = rate(video.avg_frame_rate), nominalRate = rate(video.r_frame_rate);
 const aspect = video.sample_aspect_ratio;
 // An absent SAR uses H.264's square-pixel default; explicit unknown or
 // non-square values are not compliant. Transform matrices,
 // extra tracks and unsupported codecs go through server normalization.
 return (webm ? media.demuxer === 'matroska' : mp4) && streams.length === 1 + audio.length && audio.length <= 1 &&
  (webm ? ['vp8','vp9'].includes(video.codec_name) : video.codec_name === 'h264') && video.pix_fmt === 'yuv420p' && video.width % 2 === 0 && video.height % 2 === 0 &&
  Math.max(video.width,video.height) <= 1920 && Math.min(video.width,video.height) <= 1080 &&
  (aspect === '1:1' || aspect === undefined) && (!video.field_order || ['progressive','unknown'].includes(video.field_order)) &&
  !video.tags?.rotate && !video.side_data_list?.some(item => item.side_data_type === 'Display Matrix' || item.rotation !== undefined) &&
  frameRate > 0 && frameRate <= 30 && nominalRate > 0 && nominalRate <= 30 &&
  audio.every(stream => (webm ? ['opus','vorbis'].includes(stream.codec_name) : stream.codec_name === 'aac' && ['LC', undefined].includes(stream.profile)) && stream.channels <= 2 &&
   Number(stream.sample_rate) > 0 && Number(stream.sample_rate) <= 48000);
}
function withinCopyBitrateLimits(media) {
 // Eligibility to skip encoding is separate from validating server-normalized
 // output: valid CRF22 media can have high short-clip or complex-scene bitrate.
 const streamRate = stream => stream.bit_rate === undefined ? 0 : Number(stream.bit_rate);
 return media.size * 8 / media.duration <= MAX_OUTPUT_BITRATE && media.streams.every(stream =>
  streamRate(stream) >= 0 && streamRate(stream) <= (stream.codec_type === 'video' ? MAX_VIDEO_BITRATE : MAX_AUDIO_BITRATE));
}
async function packetLimits(media) {
 // Measure packet payloads instead of trusting a client flag or missing/forged
 // bitrate metadata. Streaming aggregation keeps even a 10-minute probe bounded.
 const totals = new Map(media.streams.map(stream => [stream.index, { bytes: 0, count: 0, first: Infinity, last: -Infinity }]));
 let pending = '', packets = 0;
 const consume = chunk => {
  pending += chunk;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
   const line = pending.slice(0,newline); pending = pending.slice(newline+1);
   if (!line) continue;
   const values = Object.fromEntries(line.split('|').map(field => field.split('=')));
   const total = totals.get(Number(values.stream_index));
   const size = Number(values.size), start = Number(values.pts_time);
   // Framed WebM audio need not carry packet durations. Its timestamp span is
   // bounded here; full strict decoding below verifies the actual media duration.
   const unknownAudioDuration = media.demuxer === 'matroska' && media.streams.find(s => s.index === Number(values.stream_index))?.codec_type === 'audio' && values.duration_time === 'N/A';
   const duration = unknownAudioDuration ? 0 : Number(values.duration_time);
   if (!total || !Number.isSafeInteger(size) || size <= 0 || !Number.isFinite(start) || !Number.isFinite(duration) || (duration <= 0 && !unknownAudioDuration) || ++packets > 200000) throw new Error('Invalid media packets');
   total.bytes += size; total.count++;
   total.first = Math.min(total.first,start); total.last = Math.max(total.last,start+duration);
   if (total.bytes > media.size || total.last-total.first > 600.25) throw new Error('Invalid media timeline');
  }
  if (pending.length > 8192) throw new Error('Invalid packet probe');
 };
 await command('ffprobe', ['-v','error','-protocol_whitelist','file','-f',media.demuxer,...inputFlags(media.demuxer),'-threads','2',
  '-show_packets','-show_entries','packet=stream_index,size,pts_time,duration_time','-of','compact=p=0:nk=0',media.source],30000,consume);
 if (pending.trim()) consume('\n');
 return media.streams.every(stream => {
  const total = totals.get(stream.index), span = total.last-total.first;
  return total.count > 0 && span > 0 && span <= 600.25 &&
   Math.abs(span - Number(stream.duration || media.duration)) <= 0.25 &&
   total.bytes * 8 / span <= (stream.codec_type === 'video' ? MAX_VIDEO_BITRATE : MAX_AUDIO_BITRATE) &&
   (stream.codec_type !== 'video' || total.count / span <= 30.001);
 });
}
async function validateCopy(media) {
 // Remuxing does not decode. Fully decode the bounded output once so corrupt
 // codec payloads cannot reach ready status, but never encode a compliant input.
 const progress = await command('ffmpeg', ['-hide_banner','-loglevel','error','-nostdin','-xerror','-err_detect','explode',
  '-protocol_whitelist','file','-f',media.demuxer,...inputFlags(media.demuxer),'-threads','2','-i',media.source,'-map','0:v:0','-map','0:a:0?',
  '-threads','2','-filter_threads','1','-progress','pipe:1','-nostats','-f','null','-'],PROCESS_TIMEOUT);
 const times = [...progress.matchAll(/^out_time_us=(\d+)$/gm)].map(match => Number(match[1]) / 1e6);
 const decoded = times.at(-1);
 if (!Number.isFinite(decoded) || decoded < media.duration-0.25 || decoded > 600.25) throw new Error('Invalid decoded timeline');
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
    const input = await inspect(v.id, v.input_type);
    const { video, duration, demuxer } = input;
    if (!find(v.id) || stopping) continue;
    const webm = v.compression_mode === 'server' && v.input_type === 'video/webm';
    const copy = outputShape(input, webm) && withinCopyBitrateLimits(input) && await packetLimits(input);
    if (!copy && v.compression_mode === 'browser') throw new Error('Browser output does not meet compression requirements');
    if (!find(v.id) || stopping) continue;
    const common = ['-hide_banner','-loglevel','error','-nostdin','-y','-xerror','-protocol_whitelist','file',
     '-f',demuxer,...inputFlags(demuxer),'-threads','2','-i',file(v.id,'source'),'-map',`0:${video.index}`,'-map','0:a:0?',
     '-map_metadata','-1','-map_chapters','-1','-sn','-dn'];
    if (copy) {
     // Only the container changes: faststart + metadata removal, codec packets
     // preserved for browser output AND already-compliant original uploads.
     await command('ffmpeg', [...common,'-c','copy',...(webm ? ['-f','webm'] : ['-movflags','+faststart','-f','mp4']),file(v.id,'partial')],60000);
    } else {
     // Account for pixel aspect ratio; retain orientation; cap long/short edges.
     const factor = 'min(1,min(1920/max(iw*sar,ih),1080/min(iw*sar,ih)))';
     const filter = `scale=w='max(2,trunc(iw*sar*${factor}/2)*2)':h='max(2,trunc(ih*${factor}/2)*2)',setsar=1`;
     await command('ffmpeg', [...common,'-vf',filter,'-filter_threads','1',
      '-c:v','libx264','-threads','2','-preset','fast','-crf','22','-pix_fmt','yuv420p','-fpsmax','30',
      '-c:a','aac','-b:a','128k','-ac','2','-ar','48000','-t','600','-fs',String(MAX_VIDEO_BYTES),
      '-movflags','+faststart','-f','mp4',file(v.id,'partial')],PROCESS_TIMEOUT);
    }
    if (!find(v.id) || stopping) continue;
    const outputType = copy && webm ? 'video/webm' : 'video/mp4';
    const suffix = outputType === 'video/webm' ? 'webm' : 'mp4';
    const output = await inspect(v.id,outputType,'partial');
    const stream = output.video, size = output.size;
    if (!outputShape(output, outputType === 'video/webm') || (copy && !withinCopyBitrateLimits(output)) || output.duration < duration - 0.25) throw new Error('Invalid output');
    if (copy) await validateCopy(output);
    if (!find(v.id)) continue;
    await rename(file(v.id,'partial'),file(v.id,suffix));
    if (!find(v.id)) { await remove(file(v.id,suffix)); continue; }
    await remove(file(v.id,'source'));
    db.prepare("UPDATE videos SET status='ready',output_bytes=?,width=?,height=?,duration=?,output_type=?,error=NULL WHERE id=?").run(size,stream.width,stream.height,output.duration,outputType,v.id);
   } catch (error) {
    await Promise.all(['source','partial','mp4','webm'].map(s=>remove(file(v.id,s))));
    if (!stopping) db.prepare("UPDATE videos SET status='failed',error=? WHERE id=?").run(v.compression_mode === 'browser'
     ? '浏览器压缩结果不符合要求或文件损坏；临时文件已清理。请重新压缩，或选择服务器压缩后重新上传。'
     : '视频处理失败；临时原片已清理，请重新上传有效 MP4 / MOV / WebM（最长 10 分钟、最高 4K / 120fps），或检查服务器 FFmpeg 与磁盘空间。',v.id);
    console.error(`Video processing failed: ${v.id}: ${error.message}`);
   } finally {
    activeId = undefined;
    await remove(file(v.id,'partial'));
    await remove(file(v.id,'source'));
    if (!find(v.id)) { await remove(file(v.id,'source')); await remove(file(v.id,'mp4')); await remove(file(v.id,'webm')); }
   }
  }
 } finally { running = false; }
}
export async function startVideoQueue() {
 // A crash interrupts uploads/encodes. Discard temporary originals rather than silently retaining them.
 db.prepare("UPDATE videos SET status='failed',error=? WHERE status IN ('uploading','processing')").run('处理被服务器重启中断；临时原片已清理，请重新上传。');
 for (const name of await readdir(path.join(dataDir,'uploads'))) {
  const match = /^video-([a-f0-9-]{36})\.(source|partial|mp4|webm)$/.exec(name); if (!match) continue;
  const v = find(match[1]);
  const keep = v && ((match[2] === 'source' && v.status === 'queued') || (match[2] === outputSuffix(v) && v.status === 'ready'));
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
 const mode = req.headers['x-video-compression'] ?? 'server';
 if (!['browser','server'].includes(mode)) fail('视频压缩模式不正确');
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
  db.prepare('INSERT INTO videos(id,project_id,name,status,input_type,created,compression_mode) VALUES(?,?,?,?,?,?,?)').run(id,projectId,name,'uploading',type,Date.now(),mode);
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
 await Promise.all(['source','mp4','webm','partial'].map(s=>remove(file(id,s))));
}
export async function deleteProjectVideos(projectId) {
 for (const v of db.prepare('SELECT id FROM videos WHERE project_id=?').all(projectId)) await deleteVideo(projectId,v.id);
}
export async function serveVideo(req,res,id,admin) {
 const v = find(id), p = v && db.prepare('SELECT published FROM projects WHERE id=?').get(v.project_id);
 if (!v || v.status !== 'ready' || !p || (!admin && !p.published)) fail('视频不存在',404);
 let size; try { size = (await stat(file(id,outputSuffix(v)))).size; } catch { fail('视频不存在',404); }
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
 res.writeHead(status,{'Content-Type':v.output_type,'Content-Length':end-start+1,'Accept-Ranges':'bytes'});
 if(req.method==='HEAD') return res.end();
 const stream=createReadStream(file(id,outputSuffix(v)),{start,end});
 res.on('close',()=>stream.destroy()); stream.on('error',()=>res.destroy()); stream.pipe(res);
}
