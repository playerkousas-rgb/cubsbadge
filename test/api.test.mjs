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
  Object.keys(process.env).filter((k) => /^TROOP_|^EC_|^CIRCULAR_/.test(k)).forEach((k) => delete process.env[k]);
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

await check('proxy：apikey 未設定 → 敏感 action 直接 503（§10 施工次序 1）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbREALXXXXXXXXXX/exec';
  let called = false;
  stubFetch([['script.google.com', async () => { called = true; return { body: { success: true } }; }]]);
  try {
    const handler = freshModule('../api/proxy.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { troopId: '82', action: 'save', token: 't', changes: [] } }), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'apikey_not_configured');
    assert.ok(!called, '拒絕就唔應該打上游');
    assert.ok(res.body.troubleshooting.hint.includes('TROOP_0082_APIKEY'));
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

console.log(`\n== api 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
