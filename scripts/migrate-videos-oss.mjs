import path from 'node:path';
import { db, dataDir } from '../server/store.mjs';
import { ossEnabled } from '../server/oss.mjs';
import { putVideo, deleteVideoObject } from '../server/video-oss.mjs';

if (!ossEnabled) throw new Error('Configure OSS before migrating videos');
let uploaded = 0, existing = 0, bytes = 0;
try {
  for (const video of db.prepare("SELECT id,output_type FROM videos WHERE status='ready' ORDER BY id").all()) {
    const suffix = video.output_type === 'video/webm' ? 'webm' : 'mp4';
    const result = await putVideo(video.id, path.join(dataDir, 'uploads', `video-${video.id}.${suffix}`), video.output_type);
    if (!db.prepare("SELECT 1 FROM videos WHERE id=? AND status='ready'").get(video.id)) {
      await deleteVideoObject(video.id); continue;
    }
    if (result.uploaded) uploaded++; else existing++;
    bytes += result.bytes;
    console.log(JSON.stringify({ id: video.id, ...result }));
  }
  console.log(JSON.stringify({ total: uploaded + existing, uploaded, existing, bytes }));
} finally { db.close(); }
