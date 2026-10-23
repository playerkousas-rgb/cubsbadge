import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url),'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m=>m[1]).filter(s=>s.trim());
const inline = scripts.sort((a,b)=>b.length-a.length)[0];
const data = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url),'utf8'));

const elements = new Map();
function element(id='') {
  if (elements.has(id)) return elements.get(id);
  const classes = new Set();
  const el = {
    id, style:{}, dataset:{}, value:'', innerHTML:'', textContent:'', disabled:false, checked:false,
    className:'', open:false,
    classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),toggle:(x,force)=>{if(force===undefined?classes.has(x):!force){classes.delete(x);return false;}classes.add(x);return true;},contains:x=>classes.has(x)},
    addEventListener(){}, removeEventListener(){}, setAttribute(){}, getAttribute(){return null;},
    querySelector(selector){return element(`${id} ${selector}`);}, querySelectorAll(){return [];},
    closest(){return null;}, scrollIntoView(){}, focus(){}, click(){},
  };
  elements.set(id,el); return el;
}
const store = new Map();
const document = {
  documentElement:{lang:'zh-Hant'},
  getElementById:id=>element(id), querySelectorAll:()=>[],
  querySelector:selector=>selector==='title'?element('title'):null,
  addEventListener(){}, createElement:tag=>element(`created-${tag}-${Math.random()}`),
};
const context = vm.createContext({
  console, document, navigator:{}, location:{search:'',hostname:'localhost',href:'http://localhost/'},
  localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
  fetch:async()=>{throw new Error('Unexpected fetch in render harness');},
  confirm:()=>true, alert(){}, setTimeout:()=>0, clearTimeout(){}, setInterval:()=>0, clearInterval(){},
  URL, URLSearchParams, AbortController, Blob, Date, Math, JSON, Object, Array, Set, Map, RegExp, String, Number, Boolean, Promise,
  __data:data,
});
context.window=context; context.globalThis=context;
vm.runInContext(fs.readFileSync(new URL('../assets/cub-progress.js',import.meta.url),'utf8'),context,{filename:'cub-progress.js'});
vm.runInContext(fs.readFileSync(new URL('../assets/form-generator.js',import.meta.url),'utf8'),context,{filename:'form-generator.js'});
vm.runInContext(inline,context,{filename:'index-inline.js'});
vm.runInContext(`
  itemsData=__data; currentLang='zh'; currentTroopId='DEMO'; currentTroopName='第82旅 DEMO';
  currentUser={ymis:'DEMO_LEADER',name:'示範領袖',role:'group_leader',can_tick:true,allowed_badges:'*'};
  members=[{ymis:'9000000001',name:'陳小明',squad:'紅隊'}]; selectedProgressYmis='9000000001';
  progressFlat={'9000000001':{'1.1.1':'2026-08-20','L1-01':'2026-01-10'}};
  progressRich={'9000000001':{}}; otherBadgesMap={'9000000001':{'ACT-07':{date:'2024-01-01'},'A12':{date:'2026-09-10'},'A22':{date:'2026-09-20'},'A17':{date:'2026-10-01'},'A25-SOLAR':{date:'2026-10-02'},'A18':{date:'2026-09-01',note:'[CUB_LEVEL=2]'}}};
  pendingChanges=[]; pendingRequestsQueue=[];
`,context);

function run(code){ return vm.runInContext(code,context); }
run('renderHomeBadgeList()');
assert.match(element('homeBadgeList').innerHTML,/幼童軍體驗章/);
assert.match(element('homeBadgeList').innerHTML,/金紫荊獎章/);

run('renderProgressTab()');
const progressHtml=element('tab-progress').innerHTML;
for (const text of ['1.1.1','4.4.2','A42','舊版紀錄／不計完成度','ACT-07','指定徽章（由 items.json 產生）','媒體製作章','本階段不重複計算']) assert.ok(progressHtml.includes(text), `progress output missing ${text}`);

run('renderOverviewTab()');
element('overviewBadgeSelect').value='P4'; element('overviewSegmentSelect').value='';
run('renderOverviewTable()');
assert.match(element('overviewTableContainer').innerHTML,/4\.2\.3/);
element('byitemBadgeFilterInner').value='P4'; run('renderByItemListInner()');
assert.match(element('byitemListInner').innerHTML,/4\.2\.3/);
run("checkCascading('9000000001')");
run("handleCheckboxToggle('1.1.2',true,'9000000001')");
assert.equal(run("progressFlat['9000000001']['1.1.2']"),run('todayISO()'));
assert.ok(run("pendingChanges.some(c=>c.itemId==='1.1.2')"));

const transferId=run("itemsData.legacyTransition.quickTransfers.find(r=>r.permissionItemId==='P1').id");
element('legacyEligibility_9000000001').checked=true;
run(`document.querySelectorAll=selector=>selector==='#legacyTransferList input[data-transfer-id]:checked'?[{dataset:{transferId:'${transferId}'}}]:[]`);
run("currentUser.role='branch_leader'; currentUser.allowed_badges='P2'");
const beforeDenied=run('pendingChanges.length'); run("queueLegacyTransfers('9000000001')");
assert.equal(run('pendingChanges.length'),beforeDenied,'quick transfer must enforce its own permissionItemId');
run("currentUser.allowed_badges='P1'"); run("queueLegacyTransfers('9000000001')");
assert.equal(run('pendingChanges.length'),beforeDenied+1,'authorised quick transfer should be staged');
assert.equal(run("CubProgress.getOverallProgress(itemsData,progressFlat['9000000001'],otherBadgesMap['9000000001']).done"),run("CubProgress.getOverallProgress(itemsData,{'1.1.1':'2026-08-20','1.1.2':todayISO()},otherBadgesMap['9000000001']).done"),'transition records must not alter current completion');
run("document.querySelectorAll=()=>[]; currentUser.role='member'; currentUser.allowed_badges='*'");
assert.equal(run("canCurrentUserTickItem('1.1.1')"),false,'member role must not gain write permission from a crafted allowed_badges value');
run("currentUser.role='group_leader'; currentUser.allowed_badges='*'");

run('renderOtherBadgesTab()');
assert.match(element('tab-other').innerHTML,/考驗依據/);
assert.match(element('tab-other').innerHTML,/媒體製作章/);
assert.match(element('tab-other').innerHTML,/otherLevel_A18/);
assert.equal(run("withOtherBadgeLevelNote('[CUB_LEVEL=2] 家長備註',3,true)"),'[CUB_LEVEL=3] 家長備註');
run('renderFormsTab()'); element('formMemberSelect').value='9000000001';
for(const key of ['CURRENT_GBA','PT67','PT68','RECORD']){
  run(`generatePrintableForm('${key}')`);
  assert.match(element('printableArea').innerHTML,new RegExp(`data-form="${key}"`));
}
element('certificateBadgeSelect').value='P1'; run("generatePrintableForm('CERTIFICATE')");
assert.match(element('printableArea').innerHTML,/幼童軍體驗章/);

run('renderInfoTab()');
assert.match(element('tab-info').innerHTML,/prog\.scouting\.org\.hk\/cub/);

console.log('frontend-render-harness: OK — home, progress, legacy partition, interest lists, P4 overview, ticking, other badges, forms and information rendered with the real inline script.');
