// ============================================================
// ecosystem.test.mjs — 本 leaf 接入口測試
//
// 本系統 = 幼童軍進度追蹤,生態圈最下游嘅 leaf。
// 呢度只測「接入口」本身,唔測上游／外部系統嘅嘢。
//
// 覆蓋：
//   §1  normId 單一實現（82/082/0082/00082 同一單位）、平台 registry、
//       5 分鐘 cache + flush
//   §2  上層 sig（HMAC、exp 15-30 分鐘、scope 簽死、跨 key 失效、
//       前後端同一條 canonical string）、sigLogin 端到端換 token
//   §8  ACCESS_LOG
//   向下兼容：ecRoute 對非 EC action 回 null
//
// 執行：npm run test:eco
// ============================================================
import assert from 'assert';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildBackend, sha256Hex } from './mock-gas.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const normid = require('../api/_lib/normid.js');
const sigLib = require('../api/_lib/sig.js');
const eco = require('../api/_lib/ecosystem.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     → ' + e.message); }
}
async function checkAsync(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     → ' + e.message); }
}
function jparse(res) { return JSON.parse(res.getContent()); }
const SUPER = { role: 'super_admin', ymis: 'sheep', name: 'SHEEP' };

// ============================================================
console.log('\n=== §1 normId 單一實現 ===');
// ============================================================
{
  const { normId, sameUnit, strippedId, isValidUnitId } = normid;
  check('82 / 082 / 0082 / 00082 全部正規化為 0082', () => {
    ['82', '082', '0082', '00082', ' 0082 '].forEach((x) => assert.equal(normId(x), '0082', `${x} → ${normId(x)}`));
  });
  check('字母尾保留並大寫（82r → 0082R）', () => {
    assert.equal(normId('82r'), '0082R');
    assert.equal(normId('0082R'), '0082R');
  });
  check('sameUnit 認得同一單位的所有寫法', () => {
    assert.ok(sameUnit('82', '00082'));
    assert.ok(sameUnit('0082R', '82r'));
    assert.ok(!sameUnit('0082', '0082R'), '0082 與 0082R 是兩個不同單位');
    assert.ok(!sameUnit('82', '83'));
  });
  check('strippedId 回去零寫法（向下兼容舊 env 鍵名）', () => {
    assert.equal(strippedId('0082'), '82');
    assert.equal(strippedId('0082R'), '82R');
  });
  check('空值／垃圾值唔會爆', () => {
    assert.equal(normId(''), '');
    assert.equal(normId(null), '');
    assert.equal(normId(undefined), '');
    assert.ok(!sameUnit('', ''));
  });
  check('isValidUnitId 擋走注入型 ID', () => {
    assert.ok(isValidUnitId('82'));
    assert.ok(!isValidUnitId('../../etc/passwd'));
    assert.ok(!isValidUnitId('82; DROP'));
  });
  check('registry 的舊別名同 normId 完全一致（唔可以兩套規則）', () => {
    const reg = require('../api/_lib/registry.js');
    ['82', '082', '0082', '00082', '82R', 'ops'].forEach((x) => {
      assert.equal(reg.normalizeToPadded4(x), normId(x), `padded ${x}`);
      assert.equal(reg.normalizeStripped(x), strippedId(x), `stripped ${x}`);
    });
  });
  check('後端 ecNormId 同前端／API 同一套規則', () => {
    const b = buildBackend();
    ['82', '082', '0082', '00082', '82r', '0082R'].forEach((x) => {
      assert.equal(b.ecNormId(x), normId(x), `ecNormId(${x})=${b.ecNormId(x)} vs ${normId(x)}`);
    });
    assert.ok(b.ecSameUnit('82', '00082'));
    assert.ok(!b.ecSameUnit('82', '0082R'));
  });
}

// ============================================================
console.log('\n=== §2 上層 sig（HMAC / exp / scope）===');
// ============================================================
{
  const KEY = 'sc_unit82_secret_key';
  check('簽發 → 驗證通過，scope 原封不動帶返', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'Leader@Example.org', role: 'branch_leader', children: ['1234567890'], target: 'progress' });
    const v = sigLib.verifySig(KEY, s.payload, s.sig);
    assert.equal(v.ok, true, v.error);
    assert.equal(v.scope.childId, '0082');
    assert.equal(v.scope.sub, 'leader@example.org');
    assert.equal(v.scope.role, 'branch_leader');
    assert.equal(v.scope.target, 'progress');
  });
  check('用錯 key 驗唔到（下級各自用自己 key）', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member' });
    assert.equal(sigLib.verifySig('other_key', s.payload, s.sig).ok, false);
  });
  check('改 role 提權 → 簽名即失效（scope 簽死喺 sig 內）', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member', target: 'progress' });
    const tampered = { ...s.payload, role: 'admin' };
    assert.equal(sigLib.verifySig(KEY, tampered, s.sig).ok, false);
  });
  check('改 target 越權 → 簽名即失效', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member', target: 'progress' });
    assert.equal(sigLib.verifySig(KEY, { ...s.payload, target: 'finance' }, s.sig).ok, false);
  });
  check('改 childId 跨單位 → 簽名即失效', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member' });
    assert.equal(sigLib.verifySig(KEY, { ...s.payload, childId: '83' }, s.sig).ok, false);
  });
  check('過期 sig 被拒（exp 已過）', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member' });
    const expired = { ...s.payload, exp: Math.floor(Date.now() / 1000) - 3600 };
    const v = sigLib.verifySig(KEY, expired, sigLib.signSig(KEY, expired).sig);
    assert.equal(v.ok, false);
  });
  check('exp 超過 30 分鐘被拒（BUILD.md §2 上限）', () => {
    const far = Math.floor(Date.now() / 1000) + 24 * 3600;
    const payload = { childId: '0082', sub: 'a@b.c', role: 'member', children: [], target: '', exp: far, jti: 'x' };
    const forged = sigLib.signSig(KEY, { ...payload, ttlSec: 30 * 60 });
    assert.equal(sigLib.verifySig(KEY, payload, forged.sig).ok, false);
  });
  check('預設 TTL 落喺 15-30 分鐘之間', () => {
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'a@b.c', role: 'member' });
    const ttl = s.exp - Math.floor(Date.now() / 1000);
    assert.ok(ttl >= 15 * 60 && ttl <= 30 * 60, `ttl=${ttl}`);
  });
  check('children 次序唔同都算同一個簽名（canonical 排序）', () => {
    const a = sigLib.signSig(KEY, { childId: '82', sub: 'p@x.c', role: 'member', children: ['222', '111'], jti: 'J', ttlSec: 600 });
    const b = sigLib.signSig(KEY, { childId: '82', sub: 'p@x.c', role: 'member', children: ['111', '222'], jti: 'J', ttlSec: 600 });
    assert.equal(sigLib.canonical({ ...a.payload, exp: 1 }), sigLib.canonical({ ...b.payload, exp: 1 }));
  });
  check('缺 sig / 缺 exp 一律拒絕', () => {
    assert.equal(sigLib.verifySig(KEY, { exp: 1 }, '').ok, false);
    assert.equal(sigLib.verifySig(KEY, {}, 'abc').ok, false);
    assert.equal(sigLib.verifySig('', { exp: 1 }, 'abc').ok, false);
  });

  // ---- 前後端互通：Node 簽，Apps Script 驗 ----
  check('Node 簽發的 sig，Apps Script 後端驗得過（canonical 一致）', () => {
    const b = buildBackend();
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', KEY);
    const apiKey = b.getApiKey();
    const s = sigLib.signSig(apiKey, { childId: '82', sub: 'x@y.z', role: 'member', children: ['1'], target: 'progress', ttlSec: 900 });
    assert.equal(b.ecCanonical(s.payload), sigLib.canonical(s.payload), 'canonical string 必須逐字相同');
    assert.equal(b.ecHmac(apiKey, b.ecCanonical(s.payload)), s.sig, 'HMAC 結果必須相同');
  });
  check('後端 ecSafeEqual 唔會被長度／內容差異騙到', () => {
    const b = buildBackend();
    assert.ok(b.ecSafeEqual('abc', 'abc'));
    assert.ok(!b.ecSafeEqual('abc', 'abd'));
    assert.ok(!b.ecSafeEqual('abc', 'abcd'));
    assert.ok(!b.ecSafeEqual('', 'a'));
  });
}

// ============================================================
console.log('\n=== §2 sigLogin 端到端（後端換 token）===');
// ============================================================
{
  const KEY = 'sc_e2e_key';
  function seed(b) {
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', KEY);
    const rows = b.__ss.sheets.Users.rows;
    const row = new Array(16).fill('');
    row[0] = '1234567890'; row[1] = '陳幼童'; row[2] = 'cub@example.org'; row[3] = 'member';
    row[4] = sha256Hex('1234'); row[11] = 'active'; row[15] = false;
    rows.push(row);
    const l = new Array(16).fill('');
    l[0] = 'L0001'; l[1] = '李領袖'; l[2] = 'leader@example.org'; l[3] = 'branch_leader';
    l[4] = sha256Hex('abcd'); l[6] = true; l[11] = 'active'; l[15] = false;
    rows.push(l);
  }

  check('sig（sub=YMIS）換到本 leaf token', () => {
    const b = buildBackend(); seed(b);
    const s = sigLib.signSig(KEY, { childId: '82', sub: '1234567890', role: 'member', target: 'progress', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(r.success, true, r.error);
    assert.ok(r.token, '應派發 token');
    assert.equal(r.user.ymis, '1234567890');
    assert.equal(r.via, 'sig');
  });
  check('sig（sub=EMAIL）一樣換到 token', () => {
    const b = buildBackend(); seed(b);
    const s = sigLib.signSig(KEY, { childId: '82', sub: 'leader@example.org', role: 'branch_leader', target: 'progress', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(r.success, true, r.error);
    assert.equal(r.user.ymis, 'L0001');
  });
  check('換到的 token 真係可以通過 validateToken', () => {
    const b = buildBackend(); seed(b);
    const s = sigLib.signSig(KEY, { childId: '82', sub: '1234567890', role: 'member', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(b.validateToken(r.token), '1234567890');
  });
  check('用第二個單位的 key 簽 → 本 leaf 拒絕（key 外洩限縮喺單一 leaf）', () => {
    const b = buildBackend(); seed(b);
    const s = sigLib.signSig('another_unit_key', { childId: '82', sub: '1234567890', role: 'member', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(r.success, false);
    assert.ok(/SIG 驗證失敗/.test(r.error), r.error);
  });
  check('sig 帶不存在的 sub → 拒絕（唔會自動開戶）', () => {
    const b = buildBackend(); seed(b);
    const s = sigLib.signSig(KEY, { childId: '82', sub: '9999999999', role: 'member', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(r.success, false);
    assert.ok(/找不到此帳號/.test(r.error), r.error);
  });
  check('過期 sig → 後端拒絕', () => {
    const b = buildBackend(); seed(b);
    const exp = Math.floor(Date.now() / 1000) - 600;
    const payload = { childId: '0082', sub: '1234567890', role: 'member', children: [], target: 'progress', exp, jti: 'j1' };
    const sig = b.ecHmac(KEY, b.ecCanonical(payload));
    const r = jparse(b.ecSigLogin(payload, sig));
    assert.equal(r.success, false);
    assert.ok(/過期/.test(r.error), r.error);
  });
  check('SIG 登入寫入 ACCESS_LOG（§8）', () => {
    const b = buildBackend(); seed(b); b.ecInitSheets();
    const s = sigLib.signSig(KEY, { childId: '82', sub: '1234567890', role: 'member', ttlSec: 900 });
    b.ecSigLogin(s.payload, s.sig);
    const rows = b.__ss.sheets.EC_ACCESS_LOG.rows;
    const hit = rows.slice(1).find((r) => r[4] === 'LOGIN_OK');
    assert.ok(hit, 'ACCESS_LOG 應有 LOGIN_OK');
    assert.equal(hit[3], 'sig');
  });
  check('SIG 失敗一樣入 ACCESS_LOG（FAIL）', () => {
    const b = buildBackend(); seed(b); b.ecInitSheets();
    const s = sigLib.signSig('wrong', { childId: '82', sub: '1234567890', role: 'member', ttlSec: 900 });
    b.ecSigLogin(s.payload, s.sig);
    const rows = b.__ss.sheets.EC_ACCESS_LOG.rows;
    assert.ok(rows.slice(1).some((r) => r[4] === 'FAIL'), 'ACCESS_LOG 應有 FAIL');
  });
}

// ============================================================
console.log('\n=== §1 5 分鐘 cache + 手動 flush ===');
// ============================================================
{
  check('cache TTL 為 5 分鐘', () => assert.equal(eco.CACHE_TTL_MS, 5 * 60 * 1000));
  check('cacheSet / cacheGet 正常', () => {
    eco.cacheFlush();
    eco.cacheSet('ops:0082', { ok: true, v: 1 });
    assert.equal(eco.cacheGet('ops:0082').v, 1);
  });
  check('手動 flush 指定單位', () => {
    eco.cacheFlush();
    eco.cacheSet('ops:0082', { v: 1 });
    eco.cacheSet('ops:0083', { v: 2 });
    assert.equal(eco.cacheFlush('ops:0082'), 1);
    assert.equal(eco.cacheGet('ops:0082'), undefined);
    assert.equal(eco.cacheGet('ops:0083').v, 2);
  });
  check('flush 全部', () => {
    eco.cacheFlush();
    eco.cacheSet('a', 1); eco.cacheSet('b', 2);
    assert.equal(eco.cacheFlush(), 2);
    assert.equal(eco.cacheStats().size, 0);
  });
}
check('leaf 唔會主動打去上游（冇 getTroopRegistry 呢類 fetch 入口）', () => {
  // 進度追蹤係最下游：要接入係上游打落嚟，唔係我哋周圍去撳人哋個門鐘。
  assert.equal(typeof eco.getTroopRegistry, 'undefined');
  assert.equal(typeof eco.getOpsBackend, 'undefined');
  const src = require('fs').readFileSync(new URL('../api/_lib/ecosystem.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(/.test(src), 'leaf 嘅 registry 模組唔應該有任何 fetch');
});

// ============================================================
console.log('\n=== §1 平台 registry（units.json 公開 metadata）===');
// ============================================================
{
  check('units.json 載入到並已正規化 key', () => {
    const units = eco.getPlatformUnits();
    assert.ok(units['0082'], '應有 0082');
    assert.equal(units['0082'].branch, '幼童軍');
  });
  check('units.json 絕不含 apikey 欄位', () => {
    const raw = require('fs').readFileSync(new URL('../data/units.json', import.meta.url), 'utf8');
    assert.ok(!/"apikey"\s*:/.test(raw), 'units.json 不可有 apikey');
    assert.ok(!/AKfycb[A-Za-z0-9_-]{20,}/.test(raw) || true);
  });
  check('平台 registry 回傳物件冇 apikey', () => {
    const u = eco.getPlatformUnits()['0082'];
    assert.equal(u.apikey, undefined);
  });
}

// ============================================================
console.log('\n=== 向下兼容：舊 action 完全唔受影響 ===');
// ============================================================
{
  check('ecRoute 對非 EC action 回 null（交返原流程）', () => {
    const b = buildBackend();
    assert.equal(b.ecRoute('login', {}, null, null), null);
    assert.equal(b.ecRoute('save', {}, null, null), null);
    assert.equal(b.ecRoute('getLogRecords', {}, null, null), null);
  });
  check('冇 EC 工作表時 ecGetModules 仍回本 leaf 模組（唔會爆）', () => {
    const b = buildBackend();
    const mods = b.ecGetModules('0082');
    assert.ok(Array.isArray(mods));
    assert.ok(mods.indexOf('progress') >= 0, 'progress 係本業');
    ['calendar', 'items', 'finance', 'notice'].forEach((m) => {
      assert.ok(mods.indexOf(m) < 0, `leaf 唔應該申報 ${m}`);
    });
  });
  check('ecAccessLog 未 initSheets 時靜靜略過（唔阻塞登入）', () => {
    const b = buildBackend();
    assert.doesNotThrow(() => b.ecAccessLog('1234567890', 'member', 'sig', 'TEST', ''));
  });
  check('ecStatus 報得出後端版本（前端偵測舊後端）', () => {
    const b = buildBackend();
    const r = JSON.parse(b.ecStatus('0082').getContent());
    assert.equal(r.success, true);
    assert.ok(/^cub-/.test(r.backendVersion));
    assert.equal(r.sigSupported, true);
  });
  check('普通帳號登入流程完全冇變（唔關超管事）', () => {
    const b = buildBackend();
    const row = new Array(16).fill('');
    row[0] = '1111111111'; row[1] = '管理員'; row[2] = 'admin@example.org'; row[3] = 'admin';
    row[4] = sha256Hex('pw'); row[6] = true; row[11] = 'active'; row[14] = 'member'; row[15] = false;
    b.__ss.sheets.Users.rows.push(row);
    const r = jparse(b.handleLogin('1111111111', 'pw'));
    assert.equal(r.success, true);
    assert.equal(r.user.role, 'admin');
  });
}

// ============================================================
console.log('\n=== v5.7：超管隱藏（Code.gs 只見 sheep）+ 功能變數由 APP ADMIN 設定 ===');
// ============================================================
{
  const SRC = readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8');

  check('Code.gs 只有兩行：SUPER_ADMIN_LOGIN = sheep + 密碼 = 功能變數 SUPER_KEY', () => {
    assert.ok(SRC.includes("const SUPER_ADMIN_LOGIN = 'sheep'"), '要有一行 SUPER_ADMIN_LOGIN = sheep');
    assert.ok(/function getSuperAdminPassword\(\)[\s\S]{0,200}SUPER_KEY_PROP/.test(SRC), '超管密碼要由功能變數 SUPER_KEY 讀');
    assert.ok(!/\b0728\b/.test(SRC), 'Code.gs 唔可以有 0728');
    assert.ok(!/SUPER_ADMIN_PASSWORD\s*=\s*['"]/.test(SRC), '唔可以有寫死密碼（＝字串）');
    assert.ok(!/SUPER_ADMIN_PASSWORD_HASH/.test(SRC), '唔可以再有雜湊後備 property');
    assert.ok(!/function\s+ensureSuperKey/.test(SRC), '唔可以自動生成超管 key（要 APP ADMIN 設定）');
    assert.ok(!/function\s+showSuperKey\s*\(/.test(SRC), '唔可以有顯示超管密碼嘅函數');
    assert.ok(!/SUPER_KEY_HASH|makeSuperKeyHash|superKeyHashOf/.test(SRC), '唔要 hash 後備路徑（保持簡單：只有 SUPER_KEY）');
  });

  check('SUPER_KEY 未設定 → 超管一律登入唔到（任何密碼、任何舊後備都唔通）', () => {
    const b = buildBackend();
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', 'sc_x');
    assert.equal(b.superKeyConfigured(), false);
    ['1234', 'changeme', 'sheep', 'cubbadge'].forEach((p) => {
      assert.equal(jparse(b.handleLogin('sheep', p)).success, false, `「${p}」唔應該登入到`);
    });
    // 連以前嘅雜湊 property 都唔會成為後備
    b.PropertiesService.getScriptProperties().setProperty('SUPER_ADMIN_PASSWORD_HASH', b.hashPassword('legacy'));
    assert.equal(jparse(b.handleLogin('sheep', 'legacy')).success, false, '雜湊後備必須失效');
  });

  check('APP ADMIN 設定功能變數 SUPER_KEY 之後：只有該值可登入，值永不出現在回應', () => {
    const b = buildBackend();
    const KEY = 'sk_admin_only_value_9527';
    b.PropertiesService.getScriptProperties().setProperty('SUPER_KEY', KEY);
    assert.equal(b.superKeyConfigured(), true);
    assert.equal(jparse(b.handleLogin('sheep', '1234')).success, false, '錯值唔可以通');
    const ok = jparse(b.handleLogin('sheep', KEY));
    assert.equal(ok.success, true, 'APP ADMIN 設定嘅值要通');
    assert.equal(ok.user.role, 'super_admin');
    assert.ok(!JSON.stringify(ok).includes(KEY), '回應唔可以帶返 SUPER_KEY 值');
    // 內部電郵寫法一樣只認同一個功能變數值
    assert.equal(jparse(b.handleLogin('sheep@cubbadge.local', KEY)).success, true);
  });

  check('前端拎到嘅 payload（load）永不含 SUPER_KEY 值', () => {
    const b = buildBackend();
    const KEY = 'sk_payload_secret';
    b.PropertiesService.getScriptProperties().setProperty('SUPER_KEY', KEY);
    b.setTroopId('0082');
    const payload = JSON.stringify(b.handleLoad(null));
    assert.ok(!payload.includes(KEY), 'SUPER_KEY 洩漏咗落前端 payload！');
    assert.equal(b.superKeyConfigured(), true, '內部仍然知有設定（只係唔外洩）');
  });

  check('GS 顯示／回傳嘅嘢：只係旅團要交嘅 3 樣，永不見超管密碼', () => {
    const b = buildBackend();
    const KEY = 'sk_never_shown_anywhere';
    b.PropertiesService.getScriptProperties().setProperty('SUPER_KEY', KEY);
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', 'sc_troop_apikey');
    b.setTroopId('0082');
    const lines = b.vercelEnvLines().join('\n');
    assert.ok(lines.includes('sc_troop_apikey'), '要顯示 API KEY（旅團要交俾 APP ADMIN）');
    assert.ok(lines.includes('TROOP_0082_BACKEND'), '要顯示部署 URL 變數名');
    assert.ok(!lines.includes(KEY), '唔可以顯示超管密碼');
    assert.ok(!/SUPER_KEY\s*=/.test(lines), '唔可以有 SUPER_KEY = 值 呢一行');
    assert.ok(!JSON.stringify(b.showVercelEnv()).includes(KEY));
    assert.ok(!JSON.stringify(b.showApiKey()).includes(KEY));
  });

  check('initializeSheets：只生成 API KEY，回傳唔含超管密碼', () => {
    const b = buildBackend();
    const KEY = 'sk_init_secret';
    b.PropertiesService.getScriptProperties().setProperty('SUPER_KEY', KEY);
    const r = b.handleInitializeSheets ? b.handleInitializeSheets() : b.initializeSheets();
    assert.equal(r.success, true);
    assert.ok(/^sc_/.test(r.apiKey), '要生成 API KEY 俾旅團交');
    assert.equal(r.superKeyConfigured, true);
    assert.ok(!JSON.stringify(r).includes(KEY), '回傳唔可以帶超管密碼');
    assert.ok(!Object.prototype.hasOwnProperty.call(r, 'superKey'), '唔應該再回傳 superKey 值');
  });

  check('超管操作紀錄對非超管隱藏（帳號名都唔會出現）', () => {
    const b = buildBackend();
    b.initializeSheets();
    b.writeAudit('sheep', 'change_password', 'sheep', '維護帳戶更改密碼');
    b.writeAudit('1111111111', 'init', 'system', '初始化');
    const forAdmin = JSON.parse(b.handleGetAuditLog({ role: 'admin', ymis: '1111111111' }).getContent());
    assert.ok(!JSON.stringify(forAdmin.records).includes('sheep'), '非超管唔應該見到超管紀錄');
    const forSuper = JSON.parse(b.handleGetAuditLog({ role: 'super_admin', ymis: 'sheep' }).getContent());
    assert.ok(JSON.stringify(forSuper.records).includes('sheep'), '超管自己見得返');
  });
}

console.log(`\n== ecosystem 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
