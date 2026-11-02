import {statSync,readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const rules=readFileSync('.vercelignore','utf8').split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));
function ignored(path){ return rules.some(rule=>rule.endsWith('/')?path.startsWith(rule):rule.startsWith('*.')?path.endsWith(rule.slice(1)):path===rule); }
function total(path){
 if(ignored(path)) return 0;
 const stat=statSync(path); if(stat.isDirectory()) return readdirSync(path).reduce((n,p)=>n+total(join(path,p)),0);
 return stat.size;
}
const bytes=readdirSync('.').reduce((n,p)=>n+total(p),0);
console.log(`Vercel source artifact: ${bytes} bytes`);
if(bytes>=5*1024*1024) throw Error('Artifact must be smaller than 5 MiB');
