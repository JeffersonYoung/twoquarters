import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { originalKey, publishedOriginal } from '../server/oss.mjs';

test('CDN authorization denies drafts, changed publication, queries, variants and non-read requests', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE projects (published INTEGER, data TEXT)');
  const id = '0cdac628-2f91-4921-a8d9-4076486927b0';
  const uri = `/${originalKey(id)}`;
  db.prepare('INSERT INTO projects VALUES(?,?)').run(0, JSON.stringify({ images: [{ id, storagePath: id }] }));
  assert.equal(publishedOriginal(db, uri, 'GET'), false);
  db.exec('UPDATE projects SET published=1');
  for (const method of ['GET','HEAD']) assert.equal(publishedOriginal(db, uri, method), true);
  for (const method of ['POST','PUT','DELETE','OPTIONS',undefined]) assert.equal(publishedOriginal(db, uri, method), false);
  for (const value of [undefined,'/api/admin/projects',uri+'?width=480',uri+'?x=1',uri+'/',uri.replace('/api/','//api/'),uri.replace('0c','%30c')]) {
    assert.equal(publishedOriginal(db, value, 'GET'), false);
  }
  db.exec('UPDATE projects SET published=0');
  assert.equal(publishedOriginal(db, uri, 'GET'), false);
  assert.throws(() => originalKey('../secret'));
  db.close();
});
