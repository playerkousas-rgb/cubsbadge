import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const data = JSON.parse(fs.readFileSync(new URL('../data/items.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const gs = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const P = require('../assets/cub-progress.js');

const names = data.badges.map(b => b.name);
assert.deepEqual(names, ['會員章','幼童軍體驗章','幼童軍歷奇章','幼童軍高級歷奇章','金紫荊獎章']);
assert.equal(data.meta.effectiveDate, '2026-08-15');
assert.match(data.meta.scheme, /第十版/);
assert.equal(data.meta.listSource, 'data/items.json');

const expectedCounts = { MEMBERSHIP: 9, P1: 12, P2: 16, P3: 18, P4: 17 };
const allCurrentIds = [];
for (const badge of data.badges) {
  const ids = P.getBadgeItemIds(badge);
  assert.equal(ids.length, expectedCounts[badge.id], `${badge.id} official item count`);
  assert.equal(new Set(ids).size, ids.length, `${badge.id} duplicate item IDs`);
  allCurrentIds.push(...ids);
  for (const item of P.leafItems(badge)) {
    if (badge.id === 'MEMBERSHIP') assert.match(item.id, /^[a-i]$/);
    else assert.match(item.id, /^[1-4]\.[1-4]\.\d+$/, `non-official current item ID ${item.id}`);
    assert.ok(item.name && item.detail, `${item.id} must have requirement text`);
  }
}
assert.equal(allCurrentIds.length, 72);
assert.ok(allCurrentIds.includes('1.1.1') && allCurrentIds.includes('4.4.2'));
assert.ok(!allCurrentIds.some(id => /^L\d|^ACT[-_]|^NEW-L/.test(id)));
const byCurrentId = Object.fromEntries(data.badges.flatMap(P.leafItems).map(item => [item.id,item]));
assert.equal(P.isItemComplete(byCurrentId['3.2.4'],{}, {'A09-CHILD-PROTECTION':{date:'2026-09-01'}}),true);
assert.equal(P.isItemComplete(byCurrentId['4.2.1'],{}, {A05:{date:'2026-09-01'}}),true);
assert.equal(P.isItemComplete(byCurrentId['4.4.1'],{}, {A42:{date:'2026-09-01'}}),false,'Scout Link exempts only part d, not the whole item');
const service = P.leafItems(data.badges.find(b => b.id === 'P4')).find(i => i.id === '4.2.3');
assert.match(service.detail, /八星期/);
assert.match(service.detail, /八小時/);
assert.match(service.detail, /三分鐘/);
assert.doesNotMatch(service.detail, /八次/);
const legacyService = data.legacyBadges.find(b => b.id === 'L5').segments.flatMap(s => s.items || []).find(i => i.id === 'L5-SVC-01');
assert.match(legacyService.name, /八次/);
assert.doesNotMatch(legacyService.name, /八星期/);
assert.ok(data.forms.RECORD.sections.find(s => s.title === '服務與分享').items.some(text => /八次/.test(text)));

assert.equal(data.otherBadges.length, 49);
assert.deepEqual([...new Set(data.otherBadges.map(b => Number(b.catalogueNo)))].sort((a,b)=>a-b), Array.from({length:42},(_,i)=>i+1));
assert.equal(new Set(data.otherBadges.map(b => b.id)).size, 49);
assert.ok(data.otherBadges.every(b => b.scheme === '2026' && b.name && b.name_en && b.category));
assert.ok(data.otherBadges.find(b => b.id === 'A17' && b.name === '媒體製作章'));
assert.ok(data.otherBadges.find(b => b.id === 'A09-CHILD-PROTECTION'));
assert.ok(data.otherBadges.find(b => b.id === 'A25-SOLAR'));

// All linked badge references and stage-specific interest lists resolve to the same live catalogue.
for (const badge of data.badges) {
  for (const item of P.leafItems(badge)) {
    for (const id of P.completingBadgeIds(item)) assert.ok(P.findOtherBadge(data,id), `missing linked badge ${id}`);
    if (item.exemptionBadgeId) assert.ok(P.findOtherBadge(data,item.exemptionBadgeId));
  }
  for (const segment of badge.segments || []) {
    if (!segment.activityRequirement) continue;
    assert.equal(segment.activityRequirement.distinctCategories, 2);
    for (const id of segment.activityRequirement.allowedBadgeIds) {
      const badge = P.findOtherBadge(data,id);
      assert.ok(badge, `missing interest badge ${id}`);
      assert.ok(segment.activityRequirement.categories.includes(badge.category), `${id} is not an interest badge`);
    }
  }
}

// Legacy syllabus data is retained, but is not part of the active list or current completion IDs.
assert.equal(data.legacyBadges.length, 5);
assert.equal(data.legacyOtherBadges.length, 41);
assert.ok(P.findLegacyBadge(data,'L5'));
assert.ok(P.findLegacyOtherBadge(data,'ACT-07'));
const legacyPartition = P.partitionRecords(data, {'L1-01':'2026-01-01','1.1.1':'2026-08-20'}, {'ACT-07':{date:'2025-01-01'},'A01':{date:'2026-09-01'}});
assert.equal(legacyPartition.legacy.length, 2);
assert.equal(legacyPartition.current.length, 2);
assert.ok(legacyPartition.legacy.every(row => row.label === '舊版紀錄／不計完成度'));
assert.equal(P.getOverallProgress(data, {'L1-01':'2026-01-01'}, {'ACT-07':{date:'2025-01-01'}}).done, 0);

// Revised form is deliberately unresolved; legacy forms follow their real (1)/(2)/(3) layout.
assert.equal(data.forms.CURRENT_GBA.official, false);
assert.equal(data.forms.CURRENT_GBA.officialCode, undefined);
assert.match(data.forms.CURRENT_GBA.notice, /PT\/XX/);
for (const key of ['PT67','PT68']) {
  assert.deepEqual(data.forms[key].sections.map(s => s.id), ['1','2','3']);
  assert.equal(data.forms[key].scheme, 'legacy');
  assert.ok(data.forms[key].sections[0].fields.includes('負責領袖電郵地址'));
  assert.equal(data.forms[key].sections[2].title, '確認及批核');
}
assert.equal(data.forms.PT68.version, '06/2024');
assert.equal(data.forms.PT67.version, '4/2019');
assert.ok(data.forms.PT67.sections[1].planning);
assert.ok(data.forms.PT67.sections[2].blocks.some(b => b.fields.includes('旅／幼童軍團印章')));
assert.ok(data.forms.PT68.sections[2].blocks.find(b => b.title === '推薦').fields.every(f => !/印章|區印/.test(f)));
assert.deepEqual(data.forms.PT68.sections[2].blocks.find(b => b.title === '地域辦事處專用').fields, ['收表日期','證書號碼','查核','證書發出日期','獎章發出日期','備註']);
assert.ok(!JSON.stringify(data.legacyTransition).includes('NEW-L'));

// Runtime badge lists and form definitions are data-driven; no copied form/role labels remain active.
assert.ok(html.includes('id="homeBadgeList"'));
assert.ok(html.includes('CubProgress.getPermissionGroups(itemsData)'));
assert.ok(html.includes('CubFormGenerator.generate(type'));
assert.ok(html.includes('assets/cub-progress.js') && html.includes('assets/form-generator.js'));
assert.ok(!html.includes("{id:'L1'") && !html.includes("{id:'L5'"));
assert.ok(!html.includes('seg.items.forEach') && !html.includes('for(const it of seg.items)'), 'interest-only segments must not break render loops');
assert.ok(html.includes('CubProgress.isItemComplete(it.source'), 'overview uses linked-badge completion rules');
assert.ok(!/PT\/18|PT\/120A|01\/2020|L3-OUT-CAMP|vs-torch|支部領袖|執委|執行委員會|executive committee|no exec|小隊長以上/.test(html));
assert.ok(!/支部領袖|領袖／執委|小隊長以上|VSBADGE|SCOUTBADGE/.test(gs));
assert.ok(!fs.existsSync(new URL('../assets/vs-torch.svg', import.meta.url)));

console.log('content-audit: OK — 72 current official-ID items, 49 current badge types, legacy records retained, forms and runtime lists verified.');
