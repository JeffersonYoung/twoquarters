import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { publishedVideo, putVideo, videoKey } from '../server/video-oss.mjs';

const id = '40aaf3af-e66a-467c-91d0-28eca41983b1';
test('video CDN checks publication and readiness on every request, including cached ranges', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE projects(id TEXT, published INTEGER); CREATE TABLE videos(id TEXT, project_id TEXT, status TEXT)');
  db.prepare('INSERT INTO projects VALUES(?,?)').run('p',0);
  db.prepare('INSERT INTO videos VALUES(?,?,?)').run(id,'p','ready');
  const uri = '/' + videoKey(id);
  assert.equal(publishedVideo(db,uri,'GET'),false);
  db.exec('UPDATE projects SET published=1');
  for (const method of ['GET','HEAD']) assert.equal(publishedVideo(db,uri,method),true);
  for (const method of ['POST','OPTIONS',undefined]) assert.equal(publishedVideo(db,uri,method),false);
  for (const value of [uri+'?x=1',uri+'/',uri+'.mp4',uri.replace('40','%34%30'),'/api/videos/../secret',undefined]) assert.equal(publishedVideo(db,value,'GET'),false);
  for (const status of ['processing','failed','queued']) {
    db.prepare('UPDATE videos SET status=?').run(status);
    assert.equal(publishedVideo(db,uri,'GET'),false);
  }
  db.exec("UPDATE videos SET status='ready'; UPDATE projects SET published=0");
  assert.equal(publishedVideo(db,uri,'GET'),false);
  db.exec('UPDATE projects SET published=1; DELETE FROM videos');
  assert.equal(publishedVideo(db,uri,'GET'),false);
  assert.throws(()=>videoKey('../private'));
  db.close();
});

test('video OSS verifies bytes and supports idempotent migration, fails closed on bad uploads', async () => {
  const dir=await mkdtemp(path.join(tmpdir(),'video-oss-'));
  try {
    const filename=path.join(dir,'video.mp4'), bytes=Buffer.from('test video payload');
    await writeFile(filename,bytes);
    let stored, puts=0;
    const client={
      async head() { if (!stored) throw {status:404}; return stored; },
      async put(key,file,options) {
        puts++;
        assert.equal(key,videoKey(id));
        assert.equal(file,filename);
        assert.deepEqual(await readFile(file),bytes);
        assert.equal(options.headers['Content-MD5'],createHash('md5').update(bytes).digest('base64'));
        assert.match(options.headers['Cache-Control'],/max-age=0, s-maxage=86400, must-revalidate/);
        stored={meta:options.meta,res:{headers:{'content-length':String(bytes.length),'content-type':options.mime}}};
      },
    };
    assert.equal((await putVideo(id,filename,'video/mp4',client)).uploaded,true);
    assert.equal((await putVideo(id,filename,'video/mp4',client)).uploaded,false);
    assert.equal(puts,1);
    stored=undefined;
    client.put=async()=>{stored={meta:{sha256:'wrong'},res:{headers:{'content-length':String(bytes.length),'content-type':'video/mp4'}}};};
    await assert.rejects(putVideo(id,filename,'video/mp4',client),/verification failed/);
    client.head=async()=>{throw Object.assign(new Error('denied'),{status:403});};
    await assert.rejects(putVideo(id,filename,'video/mp4',client),/denied/);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
