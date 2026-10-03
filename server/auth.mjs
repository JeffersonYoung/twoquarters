import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from './store.mjs';
const scrypt = promisify(scryptCallback);
const options = {N:32768,r:8,p:1,maxmem:64*1024*1024};
export const randomToken = () => randomBytes(32).toString('hex');
export const hashToken = token => createHash('sha256').update(token).digest('hex');
export async function hashPassword(password) {
 const salt=randomBytes(16).toString('hex');
 const hash=await scrypt(password,salt,64,options);
 return `scrypt-v1$${salt}$${hash.toString('hex')}`;
}
export async function verifyPassword(password,stored) {
 const [,salt,hash]=(stored||'scrypt-v1$00000000000000000000000000000000$'+'0'.repeat(128)).split('$');
 const actual=await scrypt(password,salt,64,options), expected=Buffer.from(hash,'hex');
 return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function session(req) {
 const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('tq_session='))?.slice(11);
 if(!token || !/^[a-f0-9]{64}$/.test(token)) return null;
 return db.prepare('SELECT * FROM sessions WHERE token=? AND expires>?').get(hashToken(token),Date.now())||null;
}
export function rateLimit(key,limit=10) {
 const now=Date.now();
 db.prepare('DELETE FROM login_limits WHERE reset<?').run(now);
 db.prepare('INSERT INTO login_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key,now+15*60*1000);
 return db.prepare('SELECT count FROM login_limits WHERE key=?').get(key).count<=limit;
}
