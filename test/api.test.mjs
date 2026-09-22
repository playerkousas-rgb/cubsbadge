// ============================================================
// api.test.mjs — 生態圈 API 端點測試（不打真實網絡）
//
// 以假 req/res 直接呼叫 handler，並 stub global.fetch，
// 驗證 BUILD.md 的死規矩：
//   - apikey 永不回前端、永不入 URL、永不入 QR
//   - key 未設定 = 拒絕敏感 action
//   - server-side 模組 gate
//   - flush endpoint 要 key
//   - 訂閱只送 endpoint/keys/branch/topic，唔送身份
//
// 執行：npm run test:api
// ============================================================
import assert from 'assert';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     → ' + (e && e.message)); }
}

// ---------- 假 res ----------
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: null, ended: false,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(d) { this.body = d; this.ended = true; return this; },
    end(s) { if (s && !this.body) { try { this.body = JSON.parse(s); } catch (e) { this.body = s; } } this.ended = true; return this; }
  };
  return res;
}
function mockReq({ method = 'GET', query = {}, body = undefined, headers = {} } = {}) {
  return { method, query, body, headers: { host: 'cubbadge.vercel.app', 'x-forwarded-proto': 'https', ...headers } };
}

// ---------- fetch stub ----------
const realFetch = global.fetch;
function stubFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    const u = String(url);
    for (const [pattern, handler] of routes) {
      if (u.includes(pattern)) {
        const r = await handler(u, opts);
        return {
          ok: r.status ? r.status < 400 : true,
          status: r.status || 200,
          text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
          json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body)
        };
      }
    }
    throw new Error('unstubbed fetch: ' + u.slice(0, 80));
  };
}
function restoreFetch() { global.fetch = realFetch; }

function freshModule(p) {
  delete require.cache[require.resolve(p)];
  return require(p);
}
function clearEnv() {
  Object.keys(process.env).filter((k) => /^TROOP_|^EC_|^CIRCULAR_|^SUPER_/.test(k)).forEach((k) => delete process.env[k]);
}

// ============================================================
console.log('\n=== /api/ecosystem ===');
// ============================================================
await check('registry：回應絕不含 apikey', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_TOP_SECRET_KEY';
  const eco = freshModule('../api/_lib/ecosystem.js');
  eco.cacheFlush();
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ query: { action: 'registry', unit: '82' } }), res);
  const raw = JSON.stringify(res.body);
  assert.equal(res.statusCode, 200, raw);
  assert.ok(!raw.includes('sc_TOP_SECRET_KEY'), 'apikey 洩漏咗！');
  assert.equal(res.body.platform.apikeyConfigured, true, '只可以講「有設定」');
  assert.equal(res.body.unit, '0082');
});

await check('registry：82 / 00082 都解析到同一單位', async () => {
  const handler = freshModule('../api/ecosystem.js');
  for (const id of ['82', '082', '00082']) {
    const res = mockRes();
    await handler(mockReq({ query: { action: 'registry', unit: id } }), res);
    assert.equal(res.body.unit, '0082', `${id} → ${res.body.unit}`);
  }
});

await check('registry：非法 unit id 被擋', async () => {
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ query: { action: 'registry', unit: '../../secret' } }), res);
  assert.equal(res.statusCode, 400);
});

await check('modules：只申報本 leaf 自己有嘅模組', async () => {
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ query: { action: 'modules', unit: '82' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.detail.length > 0);
  assert.ok(res.body.detail.every((n) => res.body.modules.includes(n.id)));
  // 進度追蹤係 leaf：唔應該申報旅系統先有嘅模組
  ['calendar', 'album', 'items', 'finance', 'notice'].forEach((m) => {
    assert.ok(!res.body.modules.includes(m), `leaf 唔應該話自己有 ${m}`);
  });
  assert.ok(res.body.modules.includes('progress'), 'progress 係本 leaf 本業');
});

await check('flush：未設 EC_FLUSH_KEY → 503（唔會變成公開清 cache）', async () => {
  clearEnv();
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ query: { action: 'flush', unit: '82' } }), res);
  assert.equal(res.statusCode, 503);
});

await check('flush：key 錯 → 403；key 啱 → 清得到', async () => {
  clearEnv();
  process.env.EC_FLUSH_KEY = 'flush_me';
  const eco = freshModule('../api/_lib/ecosystem.js');
  const handler = freshModule('../api/ecosystem.js');
  const bad = mockRes();
  await handler(mockReq({ query: { action: 'flush', unit: '82', key: 'nope' } }), bad);
  assert.equal(bad.statusCode, 403);
  eco.cacheSet('unit:0082', { v: 1 });
  const ok = mockRes();
  await handler(mockReq({ query: { action: 'flush', unit: '82', key: 'flush_me' } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.cleared, 1);
});

await check('sigLogin：apikey 未設定 → 拒絕敏感 action（§10 施工次序 1）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'sigLogin', unit: '82', payload: {}, sig: 'x' } }), res);
  assert.equal(res.statusCode, 503);
  assert.ok(/apikey/i.test(res.body.error));
});

await check('sigLogin：正確簽名 → 回 scope，但唔回 apikey', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82';
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  const sig = freshModule('../api/_lib/sig.js');
  const handler = freshModule('../api/ecosystem.js');
  const s = sig.signSig('sc_key_82', { childId: '82', sub: 'a@b.c', role: 'member', target: 'progress', ttlSec: 900 });
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'sigLogin', unit: '82', payload: s.payload, sig: s.sig } }), res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.scope.sub, 'a@b.c');
  assert.ok(!JSON.stringify(res.body).includes('sc_key_82'), 'apikey 洩漏咗！');
});

await check('sigLogin：簽名錯 → 401', async () => {
  const handler = freshModule('../api/ecosystem.js');
  const sig = freshModule('../api/_lib/sig.js');
  const s = sig.signSig('wrong_key', { childId: '82', sub: 'a@b.c', role: 'member', ttlSec: 900 });
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'sigLogin', unit: '82', payload: s.payload, sig: s.sig } }), res);
  assert.equal(res.statusCode, 401);
});

await check('sigLogin：sig 的 childId 同請求單位唔夾 → 401', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82';
  const sig = freshModule('../api/_lib/sig.js');
  const handler = freshModule('../api/ecosystem.js');
  const s = sig.signSig('sc_key_82', { childId: '99', sub: 'a@b.c', role: 'member', ttlSec: 900 });
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'sigLogin', unit: '82', payload: s.payload, sig: s.sig } }), res);
  assert.equal(res.statusCode, 401);
});

// ============================================================
console.log('\n=== /api/proxy 仍然係唯一業務出口 ===');
// ============================================================
await check('proxy：前端唔使、亦唔可以自帶 backend URL（SSRF 防線）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_real_key';
  let calledUrl = '';
  stubFetch([['script.google.com', async (u, o) => { calledUrl = u; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      troopId: '82', action: 'getConfig', token: 't',
      backend: 'https://evil.example/exec', gasUrl: 'https://evil.example/exec'
    } }), res);
    assert.ok(calledUrl.includes('AKfycbREAL'), '一定要打 registry 入面嗰條 URL');
    assert.ok(!calledUrl.includes('evil.example'));
  } finally { restoreFetch(); }
});

await check('proxy：server 端注入 apikey（前端從來唔知）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_injected_key';
  let sentBody = null;
  stubFetch([['script.google.com', async (u, o) => { sentBody = o.body ? JSON.parse(o.body) : null; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '82', action: 'getConfig', token: 't' } }), res);
    assert.equal(sentBody.apikey, 'sc_injected_key');
    assert.ok(!JSON.stringify(res.body).includes('sc_injected_key'), 'apikey 唔可以回前端');
  } finally { restoreFetch(); }
});

await check('proxy：未登記單位 → 404 連帶可行動提示', async () => {
  clearEnv();
  const handler = freshModule('../api/proxy.js');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { troopId: '9999', action: 'getConfig' } }), res);
  assert.equal(res.statusCode, 404);
  assert.ok(res.body.troubleshooting);
});

await check('proxy：前端自帶 apikey 會被丟棄，一律用 registry 嗰條（§1）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_server_key';
  let sentBody = null;
  stubFetch([['script.google.com', async (u, o) => { sentBody = o.body ? JSON.parse(o.body) : null; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      troopId: '82', action: 'save', token: 't',
      apikey: 'attacker_key', apiKey: 'attacker_key2', api_key: 'attacker_key3'
    } }), res);
    assert.equal(sentBody.apikey, 'sc_server_key');
    assert.ok(!JSON.stringify(sentBody).includes('attacker_key'), '前端送嘅 key 一個都唔可以去到上游');
  } finally { restoreFetch(); }
});

await check('proxy：未設 apikey 但用戶已登入 → 照行（唔可以整死現有旅團）', async () => {
  // 回歸防線：好多旅團部署咗但未喺 Vercel 設 TROOP_<id>_APIKEY，
  // 一直靠 session token 運作（Code.gs 本身就有呢個向下兼容）。
  // proxy 唔可以喺呢度一刀切攔截，否則勾進度／開戶／批量加人即刻全死。
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  let called = false;
  stubFetch([['script.google.com', async () => { called = true; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    for (const action of ['save', 'addUser', 'addMember', 'saveOtherBadge', 'bulkAddUsers']) {
      called = false;
      const res = mockRes();
      await handler(mockReq({ method: 'POST', body: { troopId: '82', action, token: 'valid-session' } }), res);
      assert.equal(res.statusCode, 200, `${action} 應該照行`);
      assert.ok(called, `${action} 應該真係打到上游`);
    }
  } finally { restoreFetch(); }
});

await check('proxy：冇 apikey 又冇 token → 401（真係零認證先攔）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  let called = false;
  stubFetch([['script.google.com', async () => { called = true; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '82', action: 'save', changes: [] } }), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.code, 'no_credentials');
    assert.ok(!called, '拒絕就唔應該打上游');
  } finally { restoreFetch(); }
});

await check('proxy：apikey 未設定但唔敏感的 action 照行（唔會整死唯讀面）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  let called = false;
  stubFetch([['script.google.com', async () => { called = true; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '82', action: 'getConfig' } }), res);
    assert.equal(res.statusCode, 200);
    assert.ok(called);
  } finally { restoreFetch(); }
});

// ============================================================
console.log('\n=== 功能變數契約（4樣）：SUPER_KEY + TROOP_*_BACKEND/_APIKEY/_NAME ===');
// ============================================================
await check('registry：NAME 指向功能變數 TROOP_<id>_NAME（唔讀 JSON）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82';
  process.env.TROOP_0082_NAME = '第 82 旅（來自功能變數）';
  const reg = freshModule('../api/_lib/registry.js');
  const cfg = reg.getTroopConfig('0082');
  assert.ok(cfg, '0082 應該搵到');
  assert.equal(cfg.name, '第 82 旅（來自功能變數）');
  assert.equal(cfg._env.name, true, 'name 應該來自功能變數');
  assert.equal(cfg._env.backend, true);
  assert.equal(cfg._env.apikey, true);
  // 82 / 0082 同步
  assert.equal(reg.getTroopConfig('82').name, '第 82 旅（來自功能變數）');
});

await check('registry：設定淨係指向功能變數 — 冇 env 就冇旅團（唔讀 JSON、冇內置 URL）', async () => {
  clearEnv();
  const reg = freshModule('../api/_lib/registry.js');
  assert.equal(reg.getTroopConfig('0082'), null, '唔應該再有內置 URL fallback');
  assert.equal(Object.keys(reg.getRegistry()).length, 0, 'troops.json 已棄用，唔應該影響 registry');
  const troopsHandler = freshModule('../api/troops.js');
  const res = mockRes();
  troopsHandler(mockReq({}), res);
  assert.equal(Object.keys(res.body.troops).length, 0);
  assert.ok(res.body._hint && res.body._hint.includes('SUPER_KEY'), '空 registry 要提示設定功能變數 4 樣');
});

await check('registry：SUPER_KEY 指向功能變數，verifySuperKey 驗證（值永不外洩）', async () => {
  clearEnv();
  process.env.SUPER_KEY = 'sk_SUPER_SECRET';
  const reg = freshModule('../api/_lib/registry.js');
  assert.equal(reg.superKeyConfigured(), true);
  assert.equal(reg.verifySuperKey('sk_SUPER_SECRET'), true);
  assert.equal(reg.verifySuperKey('wrong'), false);
  delete process.env.SUPER_KEY;
  assert.equal(reg.superKeyConfigured(), false);
  assert.equal(reg.verifySuperKey('sk_SUPER_SECRET'), false, '未設 SUPER_KEY 一律唔過');
});

await check('register：SUPER_KEY 未設定 → 503（管理 API 停用）', async () => {
  clearEnv();
  const handler = freshModule('../api/register.js');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: {
    troopId: '0082',
    scriptUrl: 'https://script.google.com/macros/s/AKfycbTESTXXXXXX/exec',
    apiKey: 'sc_x'
  } }), res);
  assert.equal(res.statusCode, 503);
});

await check('register：SUPER_KEY 錯 → 403；啱 → 轉發俾後端 GS 並帶 superKey（對應）', async () => {
  clearEnv();
  process.env.SUPER_KEY = 'sk_admin';
  let forwarded = null;
  stubFetch([['script.google.com', async (u, o) => { forwarded = JSON.parse(o.body); return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/register.js');
    const bad = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      troopId: '0082',
      scriptUrl: 'https://script.google.com/macros/s/AKfycbTESTXXXXXX/exec',
      apiKey: 'sc_x',
      superKey: 'nope'
    } }), bad);
    assert.equal(bad.statusCode, 403);
    assert.equal(forwarded, null, '驗證失敗唔應該打上游');

    const ok = mockRes();
    await handler(mockReq({ method: 'POST', headers: { 'x-super-key': 'sk_admin' }, body: {
      troopId: '0082',
      scriptUrl: 'https://script.google.com/macros/s/AKfycbTESTXXXXXX/exec',
      apiKey: 'sc_x',
      troopName: '第 82 旅'
    } }), ok);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.ok(forwarded, '應該轉發註冊');
    assert.equal(forwarded.superKey, 'sk_admin', '後端GS 對應：superKey 要跟埋過去');
    assert.equal(forwarded.troopName, '第 82 旅');
  } finally { restoreFetch(); }
});

await check('health：envContract 回 4 樣 boolean，apikey／SUPER_KEY 值永不回傳', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_secret_hp';
  process.env.TROOP_0082_NAME = '第 82 旅';
  process.env.SUPER_KEY = 'sk_secret_hp';
  const handler = freshModule('../api/health.js');
  const res = mockRes();
  await handler(mockReq({ query: { troopId: '0082', checkBackend: '0' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.envContract.SUPER_KEY, true);
  assert.equal(res.body.envContract['TROOP_0082_BACKEND'], true);
  assert.equal(res.body.envContract['TROOP_0082_APIKEY'], true);
  assert.equal(res.body.envContract['TROOP_0082_NAME'], true);
  const raw = JSON.stringify(res.body);
  assert.ok(!raw.includes('sc_secret_hp'), 'apikey 洩漏咗！');
  assert.ok(!raw.includes('sk_secret_hp'), 'SUPER_KEY 洩漏咗！');
});

await check('B/D 唔入前端：/api/troops 同 /api/health 回應零部署 URL、零 apikey', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbSECRETID000000000000000/exec';
  process.env.TROOP_0082_APIKEY = 'sc_front_secret';
  process.env.TROOP_0082_NAME = '第 82 旅';
  process.env.SUPER_KEY = 'sk_front_secret';
  const troops = freshModule('../api/troops.js');
  const tRes = mockRes();
  troops(mockReq({ method: 'GET', query: {} }), tRes);
  const tRaw = JSON.stringify(tRes.body);
  assert.ok(!tRaw.includes('script.google.com'), 'B（部署 URL）唔可以落前端：' + tRaw.slice(0, 200));
  assert.ok(!tRaw.includes('sc_front_secret'), 'D（apikey）唔可以落前端');
  assert.equal(tRes.body.troops['0082'].connected, true, '前端只需要知「掛咗未」');
  const health = freshModule('../api/health.js');
  const hRes = mockRes();
  await health(mockReq({ query: { troopId: '0082', checkBackend: '0' } }), hRes);
  const hRaw = JSON.stringify(hRes.body);
  assert.ok(!hRaw.includes('AKfycb'), 'health 唔可以回部署 ID（連片段都唔可以）');
  assert.ok(!hRaw.includes('sc_front_secret'), 'health 唔可以回 apikey');
  assert.equal(hRes.body.config.backendConfigured, true, '只講「有冇設定」');
  clearEnv();
});

// ============================================================
console.log('\n=== v5.8 隱藏超管：SUPER_KEY 只存在 Vercel，密碼永不落 GS ===');
// ============================================================
await check('超管登入：SUPER_KEY 未設定 → 通用失敗（入口關閉，冇後備密碼）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82';
  const sa = freshModule('../api/_lib/superadmin.js');
  const out = sa.verifySuperAdminLogin({ loginId: 'sheep', password: 'anything', clientKey: 't1' });
  assert.equal(out.ok, false);
  assert.equal(out.body.error, '帳號或密碼錯誤', '要同普通登入失敗一模一樣');
  assert.ok(!JSON.stringify(out.body).includes('sc_key_82'), '唔可以洩露 apikey');
});

await check('超管登入：只認超管帳號；普通帳號完全唔行呢條路', async () => {
  clearEnv();
  process.env.SUPER_KEY = 'sk_admin_secret';
  const sa = freshModule('../api/_lib/superadmin.js');
  assert.equal(sa.isSuperAdminLoginId('sheep'), true);
  assert.equal(sa.isSuperAdminLoginId('sheep@cubbadge.local'), true);
  assert.equal(sa.isSuperAdminLoginId('1234567890'), false);
  assert.equal(sa.isSuperAdminLoginId('leader@example.org'), false);
  const out = sa.verifySuperAdminLogin({ loginId: '1234567890', password: 'sk_admin_secret', clientKey: 't2' });
  assert.equal(out.ok, false, '普通帳號就算打中 SUPER_KEY 都唔應該經呢條路');
});

await check('超管登入：密碼錯 → 通用失敗；值永不外洩', async () => {
  clearEnv();
  process.env.SUPER_KEY = 'sk_admin_only_value';
  const sa = freshModule('../api/_lib/superadmin.js');
  const bad = sa.verifySuperAdminLogin({ loginId: 'sheep', password: 'nope', clientKey: 't3' });
  assert.equal(bad.ok, false);
  assert.equal(bad.body.error, '帳號或密碼錯誤');
  assert.ok(!JSON.stringify(bad.body).includes('sk_admin_only_value'), 'SUPER_KEY 值洩漏咗！');
  const ok = sa.verifySuperAdminLogin({ loginId: 'sheep', password: 'sk_admin_only_value', clientKey: 't3' });
  assert.equal(ok.ok, true, '正確密碼要通');
});

await check('proxy：超管登入 → Vercel 比對 SUPER_KEY，之後只送 action=superLogin（冇密碼）', async () => {
  clearEnv();
  const APKEY = 'sc_key_82_secret';
  const SUPER = 'sk_admin_only_value';
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = APKEY;
  process.env.SUPER_KEY = SUPER;
  let forwarded = null;
  stubFetch([['script.google.com', async (u, o) => {
    forwarded = JSON.parse(o.body);
    return { body: { success: true, token: 'tok_1', user: { ymis: 'sheep', role: 'super_admin' } } };
  }]]);
  try {
    const handler = freshModule('../api/proxy.js');

    // (a) 密碼錯：唔會打 leaf
    const bad = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'login', login_id: 'sheep', password: 'nope' } }), bad);
    assert.equal(bad.body.success, false);
    assert.equal(bad.body.error, '帳號或密碼錯誤');
    assert.equal(forwarded, null, '密碼錯唔應該打 leaf GS');

    // (b) 密碼啱：轉發 action=superLogin + apikey 由 registry 注入（即係普通 server-to-server）
    const ok = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '82', action: 'login', login_id: 'sheep', password: SUPER } }), ok);
    assert.equal(ok.statusCode, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.success, true);
    assert.equal(ok.body.token, 'tok_1');

    assert.ok(forwarded, '應該轉發去 leaf GS');
    assert.equal(forwarded.action, 'superLogin');
    assert.equal(forwarded.apikey, APKEY, 'apikey 由 proxy 注入（server 端）');
    assert.ok(!Object.prototype.hasOwnProperty.call(forwarded, 'password'), '密碼唔可以落 leaf GS');
    assert.ok(!Object.prototype.hasOwnProperty.call(forwarded, 'login_id'), '帳號唔需要落 leaf GS');
    assert.ok(!JSON.stringify(forwarded).includes(SUPER), 'SUPER_KEY 唔可以出現喺轉發內容');
    assert.ok(!JSON.stringify(ok.body).includes(SUPER), '回應唔可以帶 SUPER_KEY');
    assert.ok(!JSON.stringify(ok.body).includes(APKEY), '回應唔可以帶 apikey');
  } finally { restoreFetch(); }
});

await check('proxy：前端自己叫 action=superLogin → 403（唔會派超管 token 出去）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82_secret';
  process.env.SUPER_KEY = 'sk_admin_only_value';
  let forwarded = null;
  stubFetch([['script.google.com', async (u, o) => { forwarded = JSON.parse(o.body); return { body: { success: true, token: 'tok_super', user: { role: 'super_admin' } } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'superLogin' } }), res);
    assert.equal(res.statusCode, 403, JSON.stringify(res.body));
    assert.equal(res.body.code, 'SUPER_LOGIN_INTERNAL');
    assert.equal(forwarded, null, '唔應該轉發去 leaf（唔係經超管登入流程）');
  } finally { restoreFetch(); clearEnv(); }
});

await check('proxy：上游偶發 HTML 錯誤頁 → 自動重試一次（第二次成功就當無事）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82_secret';
  let calls = 0;
  stubFetch([['script.google.com', async () => {
    calls++;
    if (calls === 1) return { body: '<!DOCTYPE html><html><head><script>window["ppConfig"]={};</script></head><body>Sorry</body></html>' };
    return { body: { success: true, token: 'tok_after_retry', user: { ymis: '1111111111', role: 'admin' } } };
  }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'login', login_id: '1111111111', password: '1234' } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.success, true, '重試後應該成功');
    assert.equal(res.body.token, 'tok_after_retry');
    assert.equal(calls, 2, '應該試兩次（一次重試）');
  } finally { restoreFetch(); clearEnv(); }
});

await check('proxy：上游一路回 HTML（真係壞）→ 照樣 502，唔會無限重試', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82_secret';
  let calls = 0;
  stubFetch([['script.google.com', async () => { calls++; return { body: '<html><body>Sorry, unable to open the file at this time.</body></html>' }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'login', login_id: '1111111111', password: '1234' } }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(res.body.success, false);
    assert.ok(String(res.body.error).includes('GAS Upstream Error'));
    assert.equal(calls, 2, '只會試兩次');
    assert.ok(!JSON.stringify(res.body).includes('AKfycbTESTKEY'), '錯誤訊息唔可以漏部署 URL／ID');
  } finally { restoreFetch(); clearEnv(); }
});

await check('proxy：下游入口關閉（DOWNSTREAM_CLOSED）→ 回 HTTP 403，訊息照樣帶到前端', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82_secret';
  stubFetch([['script.google.com', async () => ({
    body: { success: false, error: '下游本地入口已關閉（ALLOW_LOCAL_LOGIN=false）', code: 'DOWNSTREAM_CLOSED', allowLocal: false }
  })]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'login', login_id: '1234567890', password: '1234' } }), res);
    assert.equal(res.statusCode, 403, '閂口後本地登入要回 403');
    assert.equal(res.body.code, 'DOWNSTREAM_CLOSED');
    assert.equal(res.body.success, false);
    assert.ok(res.body.error && res.body.error.length > 0, '要帶訊息俾前端顯示');
  } finally { restoreFetch(); clearEnv(); }
});

await check('proxy：普通帳號登入完全唔受影響（照舊 action=login，唔會經超管閘）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_APIKEY = 'sc_key_82';
  process.env.SUPER_KEY = 'sk_admin_x';
  let forwarded = null;
  stubFetch([['script.google.com', async (u, o) => { forwarded = JSON.parse(o.body); return { body: { success: true, token: 'tok_3', user: { ymis: '1234567890', role: 'member' } } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '0082', action: 'login', login_id: '1234567890', password: 'abcd' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(forwarded.action, 'login', '普通帳號照舊送 action=login 落 GS');
    assert.equal(forwarded.login_id, '1234567890');
    assert.equal(forwarded.password, 'abcd', '普通帳號密碼照舊交俾自己部 GS 驗');
    assert.equal(res.body.token, 'tok_3');
  } finally { restoreFetch(); }
});

console.log(`\n== api 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
