import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBackend } from './mock-gas.mjs';

function json(response) { return JSON.parse(response.getContent()); }
function snapshotRows(backend, names) {
  return Object.fromEntries(names.map(name => [name, JSON.parse(JSON.stringify(backend.__ss.sheets[name].rows))]));
}

test('latest GS release is consistent between frontend announcement and Apps Script', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const gas = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  const release = html.match(/const LATEST_RELEASE=Object\.freeze\(\{updated:'([^']+)',gsVersion:'([^']+)',initializeRequired:(true|false)\}\)/);
  assert.ok(release, 'frontend exposes one latest-release declaration');
  const gs = gas.match(/const CUB_GS_VERSION = '([^']+)'/);
  assert.ok(gs, 'Apps Script exposes its latest GS version');
  assert.equal(release[1], '2026-10-23');
  assert.equal(release[2], gs[1], 'frontend required GS and backend reported GS must match');
  assert.equal(release[3], 'true', 'this release explicitly requires initializeSheets()');
  assert.ok(html.includes(`href="apps-script/Code.gs?gs=${gs[1]}"`), 'setup tab download link carries current GS version query to bust stale cache');
  assert.ok(html.includes('href="apps-script/Code.gs?gs=${encodeURIComponent(LATEST_RELEASE.gsVersion)}"'), 'release notice download link carries current GS version query');
  assert.match(gas, /setProperty\(CUB_GS_INITIALIZED_PROP,CUB_GS_VERSION\)/);
  assert.doesNotMatch(gas, /CUB_GS_VERSION_HISTORY|SEQUENTIAL_PATCH/);
});

test('GS version and initialization are independently verified; initialization is idempotent and preserves user data', () => {
  const backend = buildBackend();
  const sheets = backend.__ss.sheets;
  sheets.Users.rows.push(['1234567890','陳大文','parent@example.org','member','existing-hash','b4',false,'leader','2026-01-01','2026-01-01','2026-01-02','active','','紅隊','member',false]);
  sheets['成員名單'].rows.push(['1234567890','陳大文','2025-01-01','幼童軍','','紅隊']);
  sheets['進度追蹤'].rows.push(['1234567890','L1-01','2025-01-01','2025-01-02','舊領袖','舊版備註']);
  sheets['其他獎章'].rows.push(['1234567890','ACT-07','游泳章','2024-01-01','CERT-OLD','舊徽章備註','2024-01-02']);
  sheets['活動履歷'].rows.push(['LOG_OLD','service','1234567890','陳大文','2024-01-01','舊服務','義工','2','CERT','舊內容','舊領袖','2024-01-02','']);
  sheets.Tokens.rows.push(['token-user','1234567890','2026-01-01','2099-01-01']);
  sheets['操作紀錄'].rows.push(['2026-01-01','領袖','update','1234567890','原有操作紀錄']);
  const originalConfig = ['allow_member_requests','true','keep-time','keep-actor'];
  sheets.SystemConfig.rows.push(originalConfig.slice());
  const preservedSheetNames = ['Users','成員名單','進度追蹤','其他獎章','活動履歷','Tokens','操作紀錄'];
  const originalRows = snapshotRows(backend, preservedSheetNames);

  const before = json(backend.ecStatus('0082'));
  assert.equal(before.success, true);
  assert.equal(before.gsVersion, '2026.10.23');
  assert.equal(before.initializedGsVersion, '', 'new Code.gs alone must not count as initialized');
  assert.equal(before.gsInitializationCurrent, false);

  const apiKey = backend.getApiKey();
  const initialized = backend.initializeSheets();
  assert.equal(initialized.success, true);
  assert.equal(initialized.gsVersion, before.gsVersion);
  assert.equal(initialized.gsInitializationCurrent, true);
  assert.equal(backend.getApiKey(), apiKey, 'running the required initialization must not rotate the existing API key');
  assert.deepEqual(snapshotRows(backend, preservedSheetNames), originalRows, 'initialization must not modify existing user records, including old IDs');
  assert.deepEqual(sheets.SystemConfig.rows[1], originalConfig, 'an existing troop setting must not be overwritten by a default');

  const after = json(backend.ecStatus('0082'));
  assert.equal(after.gsVersion, before.gsVersion);
  assert.equal(after.initializedGsVersion, before.gsVersion);
  assert.equal(after.gsInitializationCurrent, true);
  assert.equal(after.backendVersion, 'cub-leaf', 'existing ecosystem compatibility identifier is unchanged');

  const load = json(backend.handleLoad(null));
  assert.equal(load.gsVersion, before.gsVersion);
  assert.equal(load.initializedGsVersion, before.gsVersion);
  assert.equal(load.gsInitializationCurrent, true, 'post-login load also carries release status');

  backend.initializeSheets();
  assert.equal(backend.getApiKey(), apiKey, 're-running initialization remains safe and idempotent');
  assert.deepEqual(snapshotRows(backend, preservedSheetNames), originalRows, 're-running initialization must also preserve every existing user value');
  assert.deepEqual(sheets.SystemConfig.rows[1], originalConfig);
});
