import { execFileSync } from 'node:child_process';
const [base,head]=process.argv.slice(2);
if(!/^[a-f0-9]{40}$/.test(base||'')||!/^[a-f0-9]{40}$/.test(head||''))throw new Error('Two complete commit SHAs required; unknown baseline requires manual deployment.');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
const files=git('diff','--name-only',base,head).trim().split('\n');
const sensitive=files.filter(p=>/^(server\/(schema|store)\.mjs|scripts\/database\.mjs|migrations\/|database\/)/.test(p));
const sql=git('diff','--unified=0',base,head,'--','server','scripts').split('\n').filter(l=>/^[+-][^+-]/.test(l)&&/\b(CREATE\s+(TABLE|INDEX)|ALTER\s+TABLE|DROP\s+(TABLE|INDEX)|PRAGMA\s+user_version)\b/i.test(l));
if(sensitive.length||sql.length){console.error('Database-sensitive changes: manual deployment required. '+sensitive.join(', '));process.exitCode=1;}
else console.log('No database migration changes detected. Runtime schema check is still required.');
