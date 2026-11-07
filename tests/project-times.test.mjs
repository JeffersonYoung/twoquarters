import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { initializeProjectTimes } from '../server/project-times.mjs';

test('legacy timestamps recover creation, preserve explicit shooting/update metadata and remain stable on restart',()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE projects(id TEXT,data TEXT,sort_order INTEGER)');
 const created=Date.parse('2024-03-01T10:00:00Z');
 const insert=db.prepare('INSERT INTO projects VALUES(?,?,?)');
 insert.run('old',JSON.stringify({publishedAt:created+1000}),-created);
 insert.run('edited',JSON.stringify({createdAt:created,shotAt:created-100000,updatedAt:created+2000}),-created);
 insert.run('unknown','{}',1);
 initializeProjectTimes(db);
 const rows=()=>db.prepare('SELECT * FROM projects ORDER BY id').all();
 const first=rows();
 const old=JSON.parse(first.find(r=>r.id==='old').data);
 assert.equal(old.createdAt,created);assert.equal(old.shotAt,created);
 assert.equal(old.publishedAt,created+1000);
 assert.equal(JSON.parse(first.find(r=>r.id==='edited').data).shotAt,created-100000);
 assert.equal(JSON.parse(first.find(r=>r.id==='edited').data).updatedAt,created+2000);
 assert.equal(JSON.parse(first.find(r=>r.id==='unknown').data).createdAt,undefined);
 initializeProjectTimes(db);assert.deepEqual(rows(),first);
 db.close();
});
