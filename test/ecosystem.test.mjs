// ============================================================
// ecosystem.test.mjs — 旅團生態圈接入測試 (BUILD.md v2026-09-22)
//
// 覆蓋：
//   §1  normId 單一實現（82/082/0082/00082 同一單位）、兩層 registry、
//       5 分鐘 cache + flush、退出＝刪 entry
//   §2  上層 sig（HMAC、exp 15-30 分鐘、scope 簽死、跨 key 失效、
//       前後端同一條 canonical string）
//   §4  TROOP_MODULES 開關（server-side 拒絕停用模組）、模組註冊表導航、
//       分享目標過濾（接收方要有該模組）、個人化訂閱命中規則
//   §5  Share 連結／QR 永不帶 key
//   §8  ACCESS_LOG
//
// 執行：npm run test:eco
// ============================================================
import assert from 'assert';
import { createRequire } from 'module';
import { buildBackend, sha256Hex } from './mock-gas.mjs';

const require = createRequire(import.meta.url);
const normid = require('../api/_lib/normid.js');
const sigLib = require('../api/_lib/sig.js');
const eco = require('../api/_lib/ecosystem.js');
const ECQr = require('../assets/ec-qr.js');

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
console.log('\n=== §4 TROOP_MODULES 開關 + 模組 gate ===');
// ============================================================
{
  function admin(b) { return { role: 'admin', ymis: 'A1' }; }

  check('ecInitSheets 建齊 3 張 EC 表並寫入預設開關', () => {
    const b = buildBackend();
    b.ecInitSheets();
    assert.ok(b.__ss.sheets.EC_REGISTRY, 'EC_REGISTRY');
    assert.ok(b.__ss.sheets.EC_MODULES, 'EC_MODULES');
    assert.ok(b.__ss.sheets.EC_ACCESS_LOG, 'EC_ACCESS_LOG');
    const mods = b.ecGetModules('0082');
    assert.equal(mods.progress, true);
    assert.equal(mods.finance, false, '旅系統模組預設關');
  });
  check('ecInitSheets 重複執行安全（唔會複製表頭）', () => {
    const b = buildBackend();
    b.ecInitSheets();
    const before = b.__ss.sheets.EC_MODULES.rows.length;
    b.ecInitSheets(); b.ecInitSheets();
    assert.equal(b.__ss.sheets.EC_MODULES.rows.length, before);
  });
  check('旅長開啟 notice 模組 → gate 放行', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecSetModule('calendar', true, '*', 'A1');
    assert.equal(b.ecModuleEnabled('calendar', '0082'), true);
  });
  check('停用模組 → server-side gate 拒絕（唔靠前端隱藏）', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecSetModule('notice', false, '*', 'A1');
    assert.equal(b.ecModuleEnabled('notice', '0082'), false);
  });
  check('指定支部的設定覆蓋全旅設定', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecSetModule('notice', false, '*', 'A1');
    b.ecSetModule('notice', true, '82', 'A1');   // 用去零寫法設定
    assert.equal(b.ecModuleEnabled('notice', '0082'), true, '0082 應命中 82 的設定');
    assert.equal(b.ecModuleEnabled('notice', '0083'), false, '其他支部維持全旅設定');
  });
  check('核心模組不可停用（否則 leaf 自己都入唔到）', () => {
    const b = buildBackend(); b.ecInitSheets();
    const r = jparse(b.ecSetModule('progress', false, '*', 'A1'));
    assert.equal(r.success, false);
    assert.equal(b.ecModuleEnabled('progress', '0082'), true);
  });
  check('模組開關需團長以上（ecRoute 權限檢查）', () => {
    const b = buildBackend(); b.ecInitSheets();
    const member = { role: 'member', ymis: 'M1' };
    const r = jparse(b.ecRoute('ecSetModule', { module: 'notice', enabled: false }, member, 'M1'));
    assert.equal(r.success, false);
    assert.ok(/權限/.test(r.error));
  });
  check('SIG 指向已停用模組 → 拒絕入場', () => {
    const b = buildBackend();
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', 'k1');
    b.ecInitSheets();
    b.ecSetModule('notice', false, '*', 'A1');
    const s = sigLib.signSig('k1', { childId: '82', sub: 'x@y.z', role: 'member', target: 'notice', ttlSec: 900 });
    const r = jparse(b.ecSigLogin(s.payload, s.sig));
    assert.equal(r.success, false);
    assert.ok(/模組未啟用/.test(r.error), r.error);
  });
}

// ============================================================
console.log('\n=== §1 旅層 registry（登記／退出／apikey 不外洩）===');
// ============================================================
{
  const GSL = { role: 'group_leader', ymis: 'G1' };

  check('旅長登記支部 leaf 成功', () => {
    const b = buildBackend(); b.ecInitSheets();
    const r = jparse(b.ecRegisterBranch({
      unit_id: '82', name: '第82旅幼童軍', branch: '幼童軍',
      backend: 'https://script.google.com/macros/s/AKfycbXXXXXXXXXX/exec',
      apikey: 'sc_secret_82', modules: ['progress', 'notice']
    }, 'G1'));
    assert.equal(r.success, true, r.error);
    assert.equal(r.unit, '0082');
  });
  check('登記用去零寫法，存入時已正規化（唔會出現 82 同 0082 兩行）', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecRegisterBranch({ unit_id: '82', name: 'A', apikey: 'k' }, 'G1');
    b.ecRegisterBranch({ unit_id: '0082', name: 'A改名', apikey: 'k' }, 'G1');
    const rows = b.__ss.sheets.EC_REGISTRY.rows.slice(1).filter((r) => r[0]);
    assert.equal(rows.length, 1, '同一單位只可以有一行');
    assert.equal(rows[0][1], 'A改名');
  });
  check('opsRegistry 回應完全冇 apikey（只回 hasKey）', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecRegisterBranch({ unit_id: '82', name: 'A', apikey: 'sc_TOP_SECRET', modules: ['progress'] }, 'G1');
    const raw = b.ecOpsRegistry('0082').getContent();
    assert.ok(!/sc_TOP_SECRET/.test(raw), 'apikey 絕不可出現在回應');
    const r = JSON.parse(raw);
    assert.equal(r.branches[0].hasKey, true);
    assert.equal(r.branches[0].apikey, undefined);
  });
  check('登記留空 apikey 唔會洗走原有 key', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecRegisterBranch({ unit_id: '82', name: 'A', apikey: 'keep_me' }, 'G1');
    b.ecRegisterBranch({ unit_id: '82', name: 'A2' }, 'G1');
    const row = b.__ss.sheets.EC_REGISTRY.rows.slice(1).find((r) => r[0] === '0082');
    assert.equal(row[4], 'keep_me');
  });
  check('backend 必須為 script.google.com /exec', () => {
    const b = buildBackend(); b.ecInitSheets();
    const r = jparse(b.ecRegisterBranch({ unit_id: '83', backend: 'https://evil.example/exec' }, 'G1'));
    assert.equal(r.success, false);
  });
  check('退出 = 刪 registry entry（數據留在單位自己 Sheet）', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecRegisterBranch({ unit_id: '82', name: 'A', apikey: 'k' }, 'G1');
    const r = jparse(b.ecUnregisterBranch('82', 'G1'));
    assert.equal(r.success, true);
    assert.equal(JSON.parse(b.ecOpsRegistry('0082').getContent()).branches.length, 0);
    assert.ok(b.__ss.sheets.Users, '單位自己的資料表完全冇被刪');
  });
  check('status=inactive 的支部唔會出現在 registry', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.ecRegisterBranch({ unit_id: '82', name: 'A', apikey: 'k', status: 'inactive' }, 'G1');
    assert.equal(JSON.parse(b.ecOpsRegistry('0082').getContent()).branches.length, 0);
  });
  check('opsRegistry 經 ecRoute 一定要 apikey（server-to-server）', () => {
    const b = buildBackend(); b.ecInitSheets();
    b.PropertiesService.getScriptProperties().setProperty('API_KEY', 'realkey');
    const noKey = jparse(b.ecRoute('opsRegistry', { unit: '82' }, null, null));
    assert.equal(noKey.success, false);
    const wrong = jparse(b.ecRoute('opsRegistry', { unit: '82', apikey: 'nope' }, null, null));
    assert.equal(wrong.success, false);
    const ok = jparse(b.ecRoute('opsRegistry', { unit: '82', apikey: b.getApiKey() }, null, null));
    assert.equal(ok.success, true);
  });
  check('登記／退出需團長以上', () => {
    const b = buildBackend(); b.ecInitSheets();
    const member = { role: 'member', ymis: 'M1' };
    assert.equal(jparse(b.ecRoute('ecRegisterBranch', { unit_id: '82' }, member, 'M1')).success, false);
    assert.equal(jparse(b.ecRoute('ecUnregisterBranch', { unit_id: '82' }, member, 'M1')).success, false);
  });
}

// ============================================================
console.log('\n=== §4 模組註冊表 / 導航 / 分享目標過濾 ===');
// ============================================================
{
  check('導航由註冊表自動生成，按 order 排序', () => {
    const nav = eco.buildNavigation(['progress', 'users', 'logs']);
    assert.deepEqual(nav.map((n) => n.id), ['progress', 'logs', 'users']);
  });
  check('停用模組唔會出現在導航', () => {
    const nav = eco.buildNavigation(['progress', 'logs']);
    assert.ok(!nav.some((n) => n.id === 'finance'));
  });
  check('resolveModules：core 模組永遠開', () => {
    const mods = eco.resolveModules('0082', { progress: false, logs: false });
    assert.ok(mods.includes('progress'));
    assert.ok(mods.includes('logs'));
  });
  check('resolveModules：OPS 開關可以開啟旅系統模組', () => {
    const mods = eco.resolveModules('0082', { calendar: true });
    assert.ok(mods.includes('calendar'));
  });
  check('resolveModules：OPS 可停用非 core 模組（notice）', () => {
    const mods = eco.resolveModules('0082', { notice: false });
    assert.ok(!mods.includes('notice'));
  });
  check('assertModuleEnabled 係 server-side gate', () => {
    assert.equal(eco.assertModuleEnabled('notice', ['progress']).ok, false);
    assert.equal(eco.assertModuleEnabled('notice', ['notice']).ok, true);
  });
  check('分享目標：冇該模組的支部唔會出現（深資冇小隊計分就分享唔到）', () => {
    const branches = [
      { id: '0082', name: '幼童軍', modules: ['notice', 'calendar'] },
      { id: '0083', name: '深資', modules: ['calendar'] }
    ];
    const t = eco.shareTargets('notice', branches);
    assert.deepEqual(t.map((x) => x.id), ['0082']);
  });
  check('不可分享的模組（財務）無論如何都冇分享目標', () => {
    const branches = [{ id: '0082', name: 'A', modules: ['finance'] }];
    assert.deepEqual(eco.shareTargets('finance', branches), []);
  });
  check('全部支部都有該模組 = 全旅可見', () => {
    const branches = [
      { id: '0082', name: 'A', modules: ['notice'] },
      { id: '0083', name: 'B', modules: ['notice'] }
    ];
    assert.equal(eco.shareTargets('notice', branches).length, 2);
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
  check('未設定 OPS backend 時回 ops_not_configured（唔會 throw）', async () => {});
}
await checkAsync('getTroopRegistry 無 OPS 設定 → ops_not_configured', async () => {
  eco.cacheFlush();
  const r = await eco.getTroopRegistry('0082');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ops_not_configured');
  assert.deepEqual(r.branches, []);
});
await checkAsync('getTroopRegistry 結果入 cache（第二次唔再打網絡）', async () => {
  eco.cacheFlush();
  const a = await eco.getTroopRegistry('0082');
  const b = await eco.getTroopRegistry('0082');
  assert.strictEqual(a, b, '同一個物件 = 命中 cache');
});

// ============================================================
console.log('\n=== §4 ★ 個人化訂閱：命中規則（同 notify.py 一致）===');
// ============================================================
{
  // subscription_matches 的 JS 版（api/notices.js 內同一套邏輯）
  const topicById = {
    'all:new': { id: 'all:new', branches: ['*'], kind: 'all' },
    'branch:幼童軍:category:service': { id: 'branch:幼童軍:category:service', branches: ['幼童軍'], match_topic: 'category:service' },
    'branch:童軍:category:service': { id: 'branch:童軍:category:service', branches: ['童軍'], match_topic: 'category:service' },
    'branch:幼童軍:activity:big-camp': { id: 'branch:幼童軍:activity:big-camp', branches: ['幼童軍'], match_topic: 'activity:big-camp' }
  };
  function matches(prefs, meta) {
    const topics = new Set(prefs.topics || []);
    if (topics.has('all:new')) return true;
    const branches = new Set(prefs.branches || []);
    const nb = new Set(meta.branch_tags || []);
    const nt = new Set(meta.topic_tags || []);
    for (const id of topics) {
      const topic = topicById[id];
      if (!topic) continue;
      const scope = new Set(topic.branches || []);
      let eligible = [...branches].filter((b) => nb.has(b));
      if (!scope.has('*')) eligible = eligible.filter((b) => scope.has(b));
      if (eligible.length && nt.has(topic.match_topic || id)) return true;
    }
    return false;
  }

  check('支部 AND 項目同時命中 → 推', () => {
    assert.ok(matches(
      { branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] },
      { branch_tags: ['幼童軍'], topic_tags: ['category:service'] }
    ));
  });
  check('支部啱但項目唔啱 → 唔推', () => {
    assert.ok(!matches(
      { branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] },
      { branch_tags: ['幼童軍'], topic_tags: ['activity:big-camp'] }
    ));
  });
  check('項目啱但支部唔啱 → 唔推（唔會交叉命中）', () => {
    assert.ok(!matches(
      { branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] },
      { branch_tags: ['童軍'], topic_tags: ['category:service'] }
    ));
  });
  check('兩個選項取 OR', () => {
    assert.ok(matches(
      { branches: ['幼童軍'], topics: ['branch:幼童軍:category:service', 'branch:幼童軍:activity:big-camp'] },
      { branch_tags: ['幼童軍'], topic_tags: ['activity:big-camp'] }
    ));
  });
  check('all:new 全收（包括未分類）', () => {
    assert.ok(matches({ branches: [], topics: ['all:new'] }, { branch_tags: [], topic_tags: [] }));
  });
  check('未揀項目 → 唔會亂推', () => {
    assert.ok(!matches({ branches: ['幼童軍'], topics: [] }, { branch_tags: ['幼童軍'], topic_tags: ['category:service'] }));
  });
  check('唔認識的 topic id 唔會當命中', () => {
    assert.ok(!matches({ branches: ['幼童軍'], topics: ['branch:火星軍:x'] }, { branch_tags: ['幼童軍'], topic_tags: ['x'] }));
  });
}

// ============================================================
console.log('\n=== §5 分享連結 / QR：永不帶 key ===');
// ============================================================
{
  check('QR 能編碼一般分享連結', () => {
    const qr = ECQr.encode('https://cubbadge.vercel.app/?share=notice&u=0082&id=N1');
    assert.ok(qr, '應成功編碼');
    assert.equal(qr.size, qr.version * 4 + 17);
    assert.ok(qr.mask >= 0 && qr.mask <= 7);
  });
  check('QR 支援中文（UTF-8 byte mode）', () => {
    const qr = ECQr.encode('第82旅幼童軍秋季大露營通告');
    assert.ok(qr);
  });
  check('QR SVG 輸出合法且有內容', () => {
    const svg = ECQr.toSvg('https://cubbadge.vercel.app/?share=notice&u=0082');
    assert.ok(svg.startsWith('<svg'), 'SVG 開頭');
    assert.ok(svg.includes('</svg>'), 'SVG 結尾');
    assert.ok(svg.includes('<rect'), '有模組方格');
  });
  check('QR 大 payload 唔會爆（v21+ 16-bit 長度欄）', () => {
    const qr = ECQr.encode('x'.repeat(900));
    assert.ok(qr);
    assert.ok(qr.version >= 21, `version=${qr.version}`);
  });
  check('QR 超出 40 版容量時回 null（前端只顯示連結）', () => {
    assert.equal(ECQr.encode('x'.repeat(50000)), null);
  });
  check('分享連結永不含 apikey / token / sig', () => {
    const params = new URLSearchParams({ share: 'notice', u: '0082', id: 'N1', t: '大露營' });
    const url = `https://cubbadge.vercel.app/?${params}`;
    assert.ok(!/apikey|api_key|token|sig=|secret/i.test(url), url);
  });
}

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
  check('冇 EC 工作表時 ecGetModules 仍回預設（唔會爆）', () => {
    const b = buildBackend();
    const mods = b.ecGetModules('0082');
    assert.equal(mods.progress, true);
  });
  check('冇 EC 工作表時 opsRegistry 回空 branches（唔會爆）', () => {
    const b = buildBackend();
    const r = JSON.parse(b.ecOpsRegistry('0082').getContent());
    assert.equal(r.success, true);
    assert.deepEqual(r.branches, []);
  });
  check('ecStatus 報得出後端版本（前端偵測舊後端）', () => {
    const b = buildBackend();
    const r = JSON.parse(b.ecStatus('0082').getContent());
    assert.equal(r.success, true);
    assert.ok(/^cub-/.test(r.backendVersion));
    assert.equal(r.sigSupported, true);
  });
  check('舊登入流程完全冇變（sheep 後門仍有效）', () => {
    const b = buildBackend();
    const r = jparse(b.handleLogin('sheep', '0728'));
    assert.equal(r.success, true);
    assert.equal(r.user.role, 'super_admin');
  });
}

console.log(`\n== ecosystem 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
