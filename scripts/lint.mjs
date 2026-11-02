import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function files(dir) {
  return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(dir,e.name)):/\.(?:js|mjs|cjs)$/.test(e.name)?[join(dir,e.name)]:[]);
}
for (const file of ['apps-script/Code.gs',...['api','assets','test','scripts'].flatMap(files)]) {
  const result=spawnSync(process.execPath,['--check',...(file.endsWith('.gs')?[]:[file])],{input:file.endsWith('.gs')?readFileSync(file):undefined,encoding:'utf8'});
  if(result.status!==0) { console.error(file,result.stderr); process.exit(1); }
}
console.log('JavaScript syntax checks passed');
