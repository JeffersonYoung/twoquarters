import { hashPassword } from '../server/auth.mjs';
import { db } from '../server/store.mjs';
// Passwords are never accepted as command-line arguments or environment variables.
const reset=process.argv.includes('--reset');
const username=process.argv.find((s,i)=>i>1&&!s.startsWith('--'));
if(!username||!/^[A-Za-z0-9_.-]{3,80}$/.test(username))throw new Error('Usage: npm run admin:init -- USERNAME [--reset] [--stdin] (3–80 safe characters)');
const existing=db.prepare('SELECT username FROM users').all();
if(existing.length && (!reset||!existing.some(u=>u.username===username)))throw new Error('An administrator already exists. Use the same username with --reset to change its password.');
async function secret(label){
 if(!process.stdin.isTTY)throw new Error('Interactive terminal required; use --stdin to read one password from a secure stdin pipe.');
 process.stdout.write(label);process.stdin.setRawMode(true);process.stdin.resume();
 return new Promise((resolve,reject)=>{let result='';const cleanup=()=>{process.stdin.off('data',handler);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');};const handler=chunk=>{for(const c of chunk.toString()){if(c==='\u0003'){cleanup();reject(new Error('Cancelled'));return;}if(c==='\r'||c==='\n'){cleanup();resolve(result);return;}if(c==='\u007f'||c==='\b')result=result.slice(0,-1);else if(c>=' ')result+=c;}};process.stdin.on('data',handler);});
}
let password;
if(process.argv.includes('--stdin')){let b='';for await(const c of process.stdin){b+=c;if(b.length>2048)throw new Error('Password input too long');}password=b.replace(/\r?\n$/,'');}
else{password=await secret('New password (hidden): ');if(password!==await secret('Confirm password (hidden): '))throw new Error('Passwords do not match');}
if(password.length<14||password.length>1024)throw new Error('Use a unique password of 14–1024 characters.');
const hash=await hashPassword(password);
db.exec('BEGIN IMMEDIATE');try{db.prepare('INSERT INTO users VALUES(?,?) ON CONFLICT(username) DO UPDATE SET password=excluded.password').run(username,hash);db.prepare('DELETE FROM sessions').run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}db.close();console.log('Administrator saved; existing sessions revoked.');
