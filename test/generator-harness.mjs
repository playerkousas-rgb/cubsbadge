import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const data = require('../data/items.json');
const P = require('../assets/cub-progress.js');
const forms = require('../assets/form-generator.js');

const member = { ymis:'1234567890', name:'陳大文', district:'測試區', region:'測試地域' };
const flat = {
  '1.1.1':'2026-08-20', '4.2.3':'2026-10-01',
  'L3-OUT-CAMP-01':'2025-01-01', 'L3-OUT-CAMP-02':'2025-01-02',
  'L5-CAMP-01':'2026-01-03', 'L5-CAMP-07':'2026-01-05',
  'L5-SVC-01':'2026-02-01', 'L5-SVC-02':'2026-02-02'
};
// Give the legacy PT67 generator a completed old Adventure Award without treating it as current progress.
for (const id of P.getBadgeItemIds(P.findLegacyBadge(data,'L3'))) flat[id] ||= '2025-12-15';
const otherFlat = {
  'ACT-07':{date:'2024-01-01'},
  'A05':{date:'2026-09-01'},
  'A12':{date:'2026-09-10'},
  'A22':{date:'2026-09-20'},
  'A17':{date:'2026-10-01'},
  'A25-SOLAR':{date:'2026-10-02'}
};
const context = { data, member, troopName:'第82旅', flat, otherFlat, today:'2026-10-23', lang:'zh' };
const outDir = fs.mkdtempSync(path.join(os.tmpdir(),'cubsbadge-generator-'));
const outputs = {};
for (const key of ['CURRENT_GBA','PT67','PT68','RECORD']) {
  const html = forms.generate(key, context);
  assert.ok(html.length > 1500, `${key} generated output is unexpectedly small`);
  assert.ok(html.includes('class="print-area generated-form"'));
  outputs[key] = html;
  fs.writeFileSync(path.join(outDir,`${key}.html`),html);
}
outputs.CERTIFICATE = forms.generate('CERTIFICATE',{...context,badgeId:'P1'});
fs.writeFileSync(path.join(outDir,'CERTIFICATE.html'),outputs.CERTIFICATE);

assert.match(outputs.CURRENT_GBA,/非官方核對工具/);
assert.match(outputs.CURRENT_GBA,/4\.1\.1/);
assert.match(outputs.CURRENT_GBA,/4\.4\.2/);
assert.match(outputs.CURRENT_GBA,/八星期/);
assert.match(outputs.CURRENT_GBA,/十歲半/);
assert.match(outputs.CURRENT_GBA,/學校證明文件副本/);
assert.match(outputs.CURRENT_GBA,/不同興趣類別/);
assert.match(outputs.CURRENT_GBA,/不設模擬官方簽署欄/);
assert.match(outputs.CURRENT_GBA,/data-form="CURRENT_GBA"/);
assert.ok(!outputs.CURRENT_GBA.includes('data-form="PT68"'));

for (const key of ['PT67','PT68']) {
  assert.match(outputs[key],/（1）個人資料/);
  assert.match(outputs[key],/（3）確認及批核/);
  assert.match(outputs[key],/申請者簽署/);
  assert.match(outputs[key],/旅長／幼童軍團長簽署/);
  assert.match(outputs[key],/旅／幼童軍團印章/);
  assert.match(outputs[key],/區總監簽署/);
}
assert.match(outputs.PT67,/（2）考驗計劃/);
assert.match(outputs.PT67,/預計開展日期/);
assert.match(outputs.PT67,/2025-12-15/);
assert.match(outputs.PT67,/區印/);
assert.match(outputs.PT68,/（2）完成之項目/);
assert.match(outputs.PT68,/06\/2024/);
assert.match(outputs.PT68,/2026-01-03 至 2026-01-05/);
assert.match(outputs.PT68,/地域總監簽署/);
assert.match(outputs.PT68,/地域辦事處專用/);
assert.match(outputs.PT68,/證書發出日期/);
assert.ok(!outputs.PT68.includes('01/2020'));
assert.ok(!outputs.PT68.includes('2025-01-01'), 'PT68 must not read old L3 camping IDs as Golden Bauhinia camping');
assert.match(outputs.RECORD,/歷險挑戰（甲部）/);
assert.match(outputs.RECORD,/歷險挑戰（乙部）/);
assert.match(outputs.RECORD,/不少於八次/);
assert.ok(outputs.RECORD.includes('家長／監護人簽署'));
assert.ok(!outputs.RECORD.includes('相關活動負責人／教練'));
assert.match(outputs.CERTIFICATE,/幼童軍體驗章/);
assert.ok(!outputs.CERTIFICATE.includes('幼童軍獎章</b>'));

const oldOnly = P.getOverallProgress(data, {'L1-01':'2026-01-01'}, {'ACT-07':{date:'2024-01-01'}});
assert.equal(oldOnly.done,0,'old IDs must not increase current completion');
const partitioned = P.partitionRecords(data,flat,otherFlat);
assert.ok(partitioned.legacy.some(row => row.id === 'L3-OUT-CAMP-01' && row.label === '舊版紀錄／不計完成度'));
assert.ok(partitioned.legacy.some(row => row.id === 'ACT-07'));
const interest = P.getInterestStatus(data.badges.find(b=>b.id==='P4').segments.find(s=>s.activityRequirement),otherFlat,data);
assert.equal(interest.complete,true);
assert.deepEqual(new Set(interest.categories),new Set(['CREATIVE','SCIENCE']));
const sameCategory = P.getInterestStatus(data.badges.find(b=>b.id==='P2').segments.find(s=>s.activityRequirement),{A12:{date:'2026-09-01'},A13:{date:'2026-09-02'}},data);
assert.equal(sameCategory.complete,false,'two badges in one interest category must not satisfy two-category rule');
const interestSegment = id => data.badges.find(b=>b.id===id).segments.find(s=>s.activityRequirement);
assert.equal(P.getInterestStatus(interestSegment('P3'),{A12:{date:'2026-09-01'}},data).completed.length,0,'a single-level badge used at P2 must not count again at P3');
assert.equal(P.getInterestStatus(interestSegment('P3'),{A18:{date:'2026-09-01',level:1}},data).completed.length,0);
assert.equal(P.getInterestStatus(interestSegment('P3'),{A18:{date:'2026-09-01',level:2}},data).completed.length,1,'a higher level of a three-level badge may be used at the next stage');
assert.equal(P.getInterestStatus(interestSegment('P4'),{A18:{date:'2026-09-01',level:2}},data).completed.length,0);
assert.equal(P.getInterestStatus(interestSegment('P4'),{A18:{date:'2026-09-01',note:'[CUB_LEVEL=3]'}},data).completed.length,1,'persisted level metadata must be honoured');
assert.equal(P.isItemComplete(P.leafItems(data.badges.find(b=>b.id==='P4')).find(i=>i.id==='4.2.1'),flat,otherFlat),true);

console.log(`generator-harness: OK — generated and inspected ${Object.keys(outputs).length} HTML documents in ${outDir}`);
