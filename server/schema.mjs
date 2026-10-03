import { DatabaseSync } from 'node:sqlite';
export const SCHEMA_VERSION = 1;
// DDL is executed only by the explicit database CLI, never by application startup.
export const SCHEMA_SQL = `
CREATE TABLE users(username TEXT PRIMARY KEY,password TEXT NOT NULL);
CREATE TABLE sessions(token TEXT PRIMARY KEY,username TEXT NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE projects(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,data TEXT NOT NULL,published INTEGER NOT NULL,sort_order INTEGER NOT NULL);
CREATE TABLE login_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset INTEGER NOT NULL);
CREATE TABLE videos (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, status TEXT NOT NULL,
 input_type TEXT NOT NULL, source_bytes INTEGER NOT NULL DEFAULT 0, output_bytes INTEGER,
 width INTEGER, height INTEGER, duration REAL, error TEXT, created INTEGER NOT NULL
);
CREATE INDEX videos_project ON videos(project_id);`;
const normalize = sql => sql.toLowerCase().replace(/\s+/g,'').replace(/ifnotexists/g,'');
export function checkSchema(db, { legacy = false } = {}) {
 db.exec('PRAGMA busy_timeout=5000');
 const version = db.prepare('PRAGMA user_version').get().user_version;
 if (version !== SCHEMA_VERSION && !(legacy && version === 0)) throw new Error(`Database version ${version}; expected ${SCHEMA_VERSION}. Manual migration required.`);
 const expected = new DatabaseSync(':memory:');
 try {
  expected.exec(SCHEMA_SQL);
  for (const row of expected.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL").all()) {
   const actual=db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(row.type,row.name);
   if (!actual || normalize(actual.sql)!==normalize(row.sql)) throw new Error(`Database schema mismatch: ${row.name}. Manual migration required.`);
  }
 } finally { expected.close(); }
 if (!legacy && db.prepare("SELECT count(*) AS n FROM projects WHERE json_extract(data,'$.category')='fashion'").get().n) throw new Error('Legacy project categories require manual migration.');
}
