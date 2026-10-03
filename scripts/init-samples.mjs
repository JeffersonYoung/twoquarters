import { db, root, dataDir } from '../server/store.mjs';
import { initializeSamples } from '../server/samples.mjs';
try {
 if (process.argv.length !== 2) throw new Error('Usage: npm run samples:init (stop the app first; use its DATA_DIR).');
 const count = initializeSamples({ db, root, dataDir });
 console.log(`Initialized ${count} sample projects. Administrator credentials are managed separately with admin:init.`);
} catch (error) {
 console.error(error.message);
 process.exitCode = 1;
} finally {
 db.close();
}
