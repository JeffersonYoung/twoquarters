import { db, dataDir } from '../server/store.mjs';
import { prepareImageVariants } from '../server/images.mjs';
// Explicit, idempotent backfill. No project updates, no sample initialization.
try {
 if (process.argv.length !== 2) throw new Error('Usage: npm run images:prepare (stop the app first; use its DATA_DIR).');
 let count = 0;
 for (const row of db.prepare('SELECT data FROM projects').all()) {
  for (const image of JSON.parse(row.data).images) {
   if (!image.storagePath) continue;
   await prepareImageVariants(dataDir, image.id); count++;
  }
 }
 console.log(`Prepared image variants for ${count} images; project content unchanged.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { db.close(); }
