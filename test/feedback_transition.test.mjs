import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import items from '../data/items.json' with { type: 'json' };

function collectItems(value, out = []) {
  if (Array.isArray(value)) { value.forEach(x => collectItems(x, out)); return out; }
  if (!value || typeof value !== 'object') return out;
  if (typeof value.id === 'string') out.push(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') collectItems(child, out);
  return out;
}

test('proxy exposes explicit feedback deliveryStatus protocol', () => {
  const proxy = fs.readFileSync('api/proxy.js', 'utf8');
  assert.match(proxy, /action === 'submitFeedback'/);
  for (const status of ['not_sent', 'unknown', 'rejected', 'confirmed']) {
    assert.match(proxy, new RegExp(`deliveryStatus:\\s*['"]${status}['"]`), `${status} status is returned`);
  }
  assert.match(proxy, /暫時未能確認回報是否送達/);
  assert.match(proxy, /SCOUT_ADMIN_API/);
});

test('Scout Admin apply contract: shared inbox helper, no SUPER_KEY forwarding', () => {
  const proxy = fs.readFileSync('api/proxy.js', 'utf8');
  const register = fs.readFileSync('api/register.js', 'utf8');
  const lib = fs.readFileSync('api/_lib/scoutAdmin.js', 'utf8');
  const html = fs.readFileSync('index.html', 'utf8');

  // register（submitRegistration）同 submitFeedback 共用同一個動態 helper
  assert.match(register, /getScoutAdminApiUrl\(\)/);
  assert.match(proxy, /getScoutAdminApiUrl\(\)/);
  for (const name of ['SCOUT_ADMIN_API', 'ROVERBADGE_ADMIN_API', 'CUBSBADGE_ADMIN_API', 'SCOUTBADGE_ADMIN_API']) {
    assert.match(lib, new RegExp(name), `${name} is honoured`);
  }
  assert.match(lib, /\.trim\(\)/);

  // 公開申請唔驗 SUPER_KEY，伺服器 key 永不落 payload（防回歸靜態閘）
  assert.doesNotMatch(register, /getSuperKey|verifySuperKey/);
  assert.doesNotMatch(register + lib, /superKey\s*:/);

  // payload 對齊 Scout Admin GS + 上游成功判斷兼容 {status:"success"}
  assert.match(lib, /type: 'apply'/);
  assert.match(lib, /backendUrl/);
  assert.match(lib, /result\.status === 'success'/);
  assert.match(register, /message: '申請已提交'/);

  // 前端請求格式／路徑不變
  assert.match(html, /fetch\('\/api\/register'/);
  assert.match(html, /scriptUrl:su/);
});

test('items.json separates the 2026 Cub catalogue from preserved legacy Cub items', () => {
  const raw = fs.readFileSync('data/items.json', 'utf8');
  assert.equal(raw.includes('詳細考驗要求請在資料庫開啟'), false, 'placeholder wording removed');

  const otherIds = new Set(items.otherBadges.map(b => b.id));
  assert.equal(items.otherBadges.length, 49, '2026 catalogue: activity badge options plus Religion and Scout Link');
  assert.ok(otherIds.has('A42'));
  assert.ok(otherIds.has('A09-CHILD-PROTECTION'));
  assert.ok(otherIds.has('A25-SOLAR'));
  for (const badge of items.otherBadges) {
    assert.ok((badge.desc || '').length > 10, `${badge.id} has a real summary`);
    assert.ok((badge.detail || '').length > 10, `${badge.id} has requirement/source text`);
    assert.equal(badge.scheme, '2026');
  }

  const legacyIds = new Set(items.legacyOtherBadges.map(b => b.id));
  assert.equal(items.legacyOtherBadges.length, 41, 'old 40 activity badges plus Scout Link remain archived');
  assert.ok(legacyIds.has('ACT-SCOUT-LINK'));
  const sci = items.legacyBadges.find(b => b.id === 'L3').segments.find(s => s.code === 'L3-SCIENCE');
  const sciIds = new Set(sci.items.map(i => i.id));
  for (const id of ['L3-SCI-STAR', 'L3-SCI-GARDEN', 'L3-SCI-WEATHER', 'L3-SCI-NATURE']) {
    assert.ok(sciIds.has(id), `legacy L3 science option remains available for history: ${id}`);
  }
});

test('legacy transition data records P022/2026 Cub transition cases', () => {
  assert.ok(items.legacyTransition, 'legacyTransition exists');
  assert.equal(items.legacyTransition.effectiveDate, '2026-08-15');
  assert.equal(items.legacyTransition.sourceUrl, 'https://www.scout.org.hk/uploads/tc/circulars/23585/p022-26.pdf');
  const mappings = items.legacyTransition.badgeMappings || [];
  for (const id of ['A-membership-to-experience', 'B-cub-award-to-experience', 'C-adventure-to-adventure', 'D-expected-adventure-to-adventure', 'E-continue-current-gba']) {
    assert.ok(mappings.some(m => m.id === id), `contains transition case ${id}`);
  }
  assert.ok((items.legacyTransition.quickTransfers || []).length >= 4, 'leader-selectable transition records available');
  assert.ok((items.legacyTransition.preservedChecklistItems || []).length >= collectItems(items.legacyBadges).filter(x => /^L/.test(x.id)).length - 5, 'old checklist ids are preserved for history');
});

test('Apps Script preserves notes and writes Other Badge columns correctly', () => {
  const gas = fs.readFileSync('apps-script/Code.gs', 'utf8');
  assert.match(gas, /Object\.prototype\.hasOwnProperty\.call\(c,'note'\)/, 'progress save only overwrites note when supplied');
  assert.match(gas, /sheet\.getRange\(i\+1,3\)\.setValue\(safeSheetText\(r\.name\|\|r\.badgeId,120\)\)/, 'other badge name column is updated as name');
  assert.match(gas, /sheet\.getRange\(i\+1,4\)\.setValue\(r\.date\|\|''\)/, 'other badge date column is updated as date');
  assert.match(gas, /sheet\.getRange\(i\+1,5\)\.setValue\(safeSheetText\(r\.cert\|\|'',60\)\)/, 'other badge cert column is updated as cert');
  assert.match(gas, /if\(Object\.prototype\.hasOwnProperty\.call\(r,'note'\)\)/, 'other badge note is preserved unless supplied');
});
