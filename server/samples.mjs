import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, openSync, closeSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';

// Deployment-only operation. No import from the runtime server, no seed marker.
// Stop the application first: SQLite locking cannot lock unrelated filesystem writers.
export function initializeSamples({ db, root, dataDir }) {
 const created = [];
 db.exec('BEGIN IMMEDIATE');
 try {
  if (db.prepare('SELECT 1 FROM projects LIMIT 1').get()) throw new Error('Sample initialization refused: projects already exist. Nothing was imported.');
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='videos'").get() && db.prepare('SELECT 1 FROM videos LIMIT 1').get()) throw new Error('Sample initialization refused: video records already exist. Nothing was imported.');
  const uploads = path.join(dataDir, 'uploads');
  if (readdirSync(uploads).length) throw new Error('Sample initialization refused: uploads is not empty. Back up and inspect existing files; nothing was imported.');
  const source = JSON.parse(readFileSync(path.join(root, 'server/seed.json'), 'utf8'));
  if (!Array.isArray(source) || source.length === 0) throw new Error('Sample source is empty or invalid.');
  for (const [i, p] of source.entries()) {
   p.id = 'sample-' + p.slug;
   p.published = true;
   const originalCover = p.cover.src;
   const originals = p.images.some(im => im.src === originalCover) ? p.images : [p.cover, ...p.images];
   p.images = originals.map(im => {
    const id = randomUUID();
    const bytes = readFileSync(path.join(root, 'server/seed-images', im.src.replace('/images/', '')));
    const destination = path.join(uploads, id);
    // Exclusive creation prevents overwriting even in the unlikely event of a collision.
    const fd = openSync(destination, 'wx', 0o600);
    created.push(destination);
    try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
    return { ...im, id, storagePath: id, src: '/api/images/' + id, contentType: 'image/jpeg', originalSrc: im.src };
   });
   p.cover = p.images.find(im => im.originalSrc === originalCover);
   for (const im of p.images) delete im.originalSrc;
   db.prepare('INSERT INTO projects VALUES(?,?,?,?,?)').run(p.id, p.slug, JSON.stringify(p), 1, i);
  }
  db.exec('COMMIT');
  return source.length;
 } catch (error) {
  const failures = [error];
  try { db.exec('ROLLBACK'); } catch (rollbackError) { failures.push(rollbackError); }
  // Delete only files exclusively created by this attempt, never existing media.
  for (const file of created) {
   try { unlinkSync(file); } catch (cleanupError) { failures.push(cleanupError); }
  }
  if (failures.length > 1) throw new AggregateError(failures, 'Sample initialization failed; rollback/cleanup incomplete. Keep the app stopped, back up and inspect the data directory before retrying.');
  throw error;
 }
}
