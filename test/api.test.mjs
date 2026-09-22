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

await check('modules：導航由註冊表生成', async () => {
  const handler = freshModule('../api/ecosystem.js');
  const res = mockRes();
  await handler(mockReq({ query: { action: 'modules', unit: '82' } }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.navigation.length > 0);
  assert.ok(res.body.navigation.every((n) => res.body.modules.includes(n.id)));
});

await check('share：notice 可分享，finance 唔可以', async () => {
  const handler = freshModule('../api/ecosystem.js');
  const a = mockRes();
  await handler(mockReq({ query: { action: 'share', unit: '82', module: 'notice' } }), a);
  assert.equal(a.statusCode, 200);
  assert.ok(Array.isArray(a.body.targets));
  const b = mockRes();
  await handler(mockReq({ query: { action: 'share', unit: '82', module: 'finance' } }), b);
  assert.equal(b.statusCode, 403, '財務模組未啟用 → gate 擋住');
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
  eco.cacheSet('ops:0082', { v: 1 });
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
console.log('\n=== /api/ecosystem 旅層 registry（server-to-server）===');
// ============================================================
await check('OPS 讀取：apikey 只出現在對 OPS 的請求，唔會回前端', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_OPS_BACKEND = 'https://script.google.com/macros/s/AKfycbOPSXXXXXXXXXXX/exec';
  process.env.TROOP_0082_OPS_APIKEY = 'sc_ops_secret';
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  let sawKey = false;
  stubFetch([['AKfycbOPS', async (u) => {
    if (u.includes('sc_ops_secret')) sawKey = true;
    return { body: { success: true, version: 'ec-1.0', branches: [{ id: '82', name: '幼童軍', modules: ['notice'], apikey: 'sc_branch_secret' }], modules: { notice: true } } };
  }]]);
  try {
    const handler = freshModule('../api/ecosystem.js');
    const res = mockRes();
    await handler(mockReq({ query: { action: 'registry', unit: '82' } }), res);
    assert.ok(sawKey, 'server 應該用 apikey 打 OPS');
    const raw = JSON.stringify(res.body);
    assert.ok(!raw.includes('sc_ops_secret'), 'OPS key 洩漏');
    assert.ok(!raw.includes('sc_branch_secret'), '支部 key 洩漏');
    assert.equal(res.body.troop.opsLinked, true);
    assert.equal(res.body.troop.branches[0].id, '0082');
  } finally { restoreFetch(); }
});

await check('OPS 開關可以開啟旅系統模組（calendar）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_OPS_BACKEND = 'https://script.google.com/macros/s/AKfycbOPSXXXXXXXXXXX/exec';
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubFetch([['AKfycbOPS', async () => ({ body: { success: true, branches: [], modules: { calendar: true, notice: false } } })]]);
  try {
    const handler = freshModule('../api/ecosystem.js');
    const res = mockRes();
    await handler(mockReq({ query: { action: 'modules', unit: '82' } }), res);
    assert.ok(res.body.modules.includes('calendar'), '旅長開咗 calendar');
    assert.ok(!res.body.modules.includes('notice'), '旅長關咗 notice');
  } finally { restoreFetch(); }
});

await check('OPS 打唔通時唔會冧（degrade 成 leaf 本地模組）', async () => {
  clearEnv();
  process.env.TROOP_0082_BACKEND = 'https://script.google.com/macros/s/AKfycbTESTKEYXXXXXXXX/exec';
  process.env.TROOP_0082_OPS_BACKEND = 'https://script.google.com/macros/s/AKfycbOPSXXXXXXXXXXX/exec';
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubFetch([['AKfycbOPS', async () => { throw new Error('network down'); }]]);
  try {
    const handler = freshModule('../api/ecosystem.js');
    const res = mockRes();
    await handler(mockReq({ query: { action: 'registry', unit: '82' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.troop.opsLinked, false);
    assert.ok(res.body.modules.includes('progress'), '進度模組照用');
  } finally { restoreFetch(); }
});

// ============================================================
console.log('\n=== /api/subscriptions（★ 個人化訂閱橋接）===');
// ============================================================
await check('config：回 VAPID public key + 訂閱字典', async () => {
  clearEnv();
  stubFetch([
    ['/api/push-config', async () => ({ body: { ok: true, enabled: true, vapidPublicKey: 'BPublicKeyXXX' } })],
    ['subscription_catalog.json', async () => ({ body: { version: '3.1.0', branches: [{ id: '幼童軍', label: '幼童軍' }], topics: [{ id: 'all:new', label: '全選', group: '全部', branches: ['*'] }] } })]
  ]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({ query: { action: 'config' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.enabled, true);
    assert.equal(res.body.vapidPublicKey, 'BPublicKeyXXX');
    assert.equal(res.body.catalog.version, '3.1.0');
  } finally { restoreFetch(); }
});

await check('upsert：只送 endpoint/keys/branch/topic —— 冇 YMIS、冇 email、冇姓名', async () => {
  clearEnv();
  let sent = null;
  stubFetch([
    ['subscription_catalog.json', async () => ({ body: { version: '3.1.0', branches: [{ id: '幼童軍' }], topics: [{ id: 'branch:幼童軍:category:service' }] } })],
    ['/api/push-subscriptions', async (u, opts) => { sent = JSON.parse(opts.body); return { status: 201, body: { ok: true, status: 'saved' } }; }]
  ]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({
      method: 'POST',
      body: {
        action: 'upsert', clientToken: 'tok123',
        subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
        branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'],
        ymis: '1234567890', email: 'leaked@example.org', name: '陳大文'  // 故意塞身份資料
      }
    }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const raw = JSON.stringify(sent);
    assert.ok(!raw.includes('1234567890'), 'YMIS 洩漏咗！');
    assert.ok(!raw.includes('leaked@example.org'), 'email 洩漏咗！');
    assert.ok(!raw.includes('陳大文'), '姓名洩漏咗！');
    assert.deepEqual(sent.branches, ['幼童軍']);
    assert.equal(sent.source, 'system', '要標示 source=system 畀館方統計分開');
  } finally { restoreFetch(); }
});

await check('upsert：唔喺字典內的 topic 會被剔走', async () => {
  clearEnv();
  let sent = null;
  stubFetch([
    ['subscription_catalog.json', async () => ({ body: { version: '3', branches: [{ id: '幼童軍' }], topics: [{ id: 'good:topic' }] } })],
    ['/api/push-subscriptions', async (u, o) => { sent = JSON.parse(o.body); return { status: 201, body: { ok: true } }; }]
  ]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      action: 'upsert', clientToken: 't',
      subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
      branches: ['幼童軍', '火星軍'], topics: ['good:topic', 'evil:topic']
    } }), res);
    assert.deepEqual(sent.topics, ['good:topic']);
    assert.deepEqual(sent.branches, ['幼童軍']);
  } finally { restoreFetch(); }
});

await check('upsert：一個項目都冇揀 → 400（唔會亂訂閱）', async () => {
  clearEnv();
  stubFetch([['subscription_catalog.json', async () => ({ body: { version: '3', branches: [], topics: [] } })]]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      action: 'upsert', clientToken: 't',
      subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
      branches: [], topics: []
    } }), res);
    assert.equal(res.statusCode, 400);
  } finally { restoreFetch(); }
});

await check('origin_not_allowed → 回可行動的錯誤訊息（叫人加 allowlist）', async () => {
  clearEnv();
  stubFetch([
    ['subscription_catalog.json', async () => ({ body: { version: '3', branches: [{ id: '幼童軍' }], topics: [{ id: 't1' }] } })],
    ['/api/push-subscriptions', async () => ({ status: 403, body: { ok: false, error: 'origin_not_allowed' } })]
  ]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: {
      action: 'upsert', clientToken: 't',
      subscription: { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'p', auth: 'a' } },
      branches: ['幼童軍'], topics: ['t1']
    } }), res);
    assert.equal(res.body.error, 'origin_not_allowed');
    assert.ok(res.body.message.includes('cubbadge.vercel.app'), '要講明係邊個 origin 要加');
  } finally { restoreFetch(); }
});

await check('delete：退訂唔需要 subscription body', async () => {
  clearEnv();
  let sent = null;
  stubFetch([['/api/push-subscriptions', async (u, o) => { sent = JSON.parse(o.body); return { body: { ok: true, status: 'deleted' } }; }]]);
  try {
    const handler = freshModule('../api/subscriptions.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { action: 'delete', clientToken: 't', endpoint: 'https://fcm.googleapis.com/x' } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(sent.action, 'delete');
  } finally { restoreFetch(); }
});

await check('缺 clientToken → 400', async () => {
  const handler = freshModule('../api/subscriptions.js');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { action: 'upsert' } }), res);
  assert.equal(res.statusCode, 400);
});

// ============================================================
console.log('\n=== /api/notices（通告頁：本單位 + 已訂閱圖書館）===');
// ============================================================
const CACHE_FIXTURE = {
  last_updated: '2026-09-22',
  notices: [
    { source_site: '新界東地域', region: '新界東地域', title: '幼童軍服務日', pdf_url: 'https://x/1.pdf', captured_date: '2026-09-20' },
    { source_site: '總會', region: '總會', title: '童軍大露營', pdf_url: 'https://x/2.pdf', captured_date: '2026-09-21' },
    { source_site: '總會', region: '總會', title: '未分類通告', pdf_url: 'https://x/3.pdf', captured_date: '2026-09-22' }
  ]
};
const ENRICH_FIXTURE = {
  'https://x/1.pdf': { branch_tags: ['幼童軍'], subscription_tags: ['category:service'], deadline: '2026-10-01' },
  'https://x/2.pdf': { branch_tags: ['童軍'], subscription_tags: ['activity:big-camp'] }
};
const CATALOG_FIXTURE = {
  version: '3.1.0',
  branches: [{ id: '幼童軍', label: '幼童軍' }, { id: '童軍', label: '童軍' }],
  topics: [
    { id: 'all:new', label: '全選', group: '全部', branches: ['*'] },
    { id: 'branch:幼童軍:category:service', label: '服務', group: '服務', branches: ['幼童軍'], match_topic: 'category:service' },
    { id: 'branch:童軍:activity:big-camp', label: '大露營', group: '活動', branches: ['童軍'], match_topic: 'activity:big-camp' }
  ]
};
function stubLibrary() {
  stubFetch([
    ['cache.json', async () => ({ body: CACHE_FIXTURE })],
    ['enrich.json', async () => ({ body: ENRICH_FIXTURE })],
    ['subscription_catalog.json', async () => ({ body: CATALOG_FIXTURE })]
  ]);
}

await check('未訂閱 → 回空清單 + 提示（唔會亂塞通告）', async () => {
  clearEnv();
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  const handler = freshModule('../api/notices.js');
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { unit: '82', branches: [], topics: [] } }), res);
  assert.equal(res.body.subscribed, false);
  assert.deepEqual(res.body.items, []);
});

await check('訂閱「幼童軍 × 服務」→ 只收到幼童軍服務通告', async () => {
  clearEnv();
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubLibrary();
  try {
    const handler = freshModule('../api/notices.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { unit: '82', branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] } }), res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].title, '幼童軍服務日');
    assert.equal(res.body.items[0].origin, 'library', '要標示來源');
    assert.equal(res.body.items[0].attachment, 'https://x/1.pdf', '附件指返圖書館');
  } finally { restoreFetch(); }
});

await check('唔會收到其他支部的通告（唔交叉命中）', async () => {
  clearEnv();
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubLibrary();
  try {
    const handler = freshModule('../api/notices.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { unit: '82', branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] } }), res);
    assert.ok(!res.body.items.some((i) => i.title === '童軍大露營'));
  } finally { restoreFetch(); }
});

await check('all:new 收晒（包括未分類）', async () => {
  clearEnv();
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubLibrary();
  try {
    const handler = freshModule('../api/notices.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { unit: '82', branches: [], topics: ['all:new'] } }), res);
    assert.equal(res.body.items.length, 3);
  } finally { restoreFetch(); }
});

await check('notice 模組被旅長停用 → 403（server-side gate）', async () => {
  clearEnv();
  process.env.TROOP_0082_OPS_BACKEND = 'https://script.google.com/macros/s/AKfycbOPSXXXXXXXXXXX/exec';
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubFetch([
    ['AKfycbOPS', async () => ({ body: { success: true, branches: [], modules: { notice: false } } })],
    ['cache.json', async () => ({ body: CACHE_FIXTURE })],
    ['enrich.json', async () => ({ body: ENRICH_FIXTURE })],
    ['subscription_catalog.json', async () => ({ body: CATALOG_FIXTURE })]
  ]);
  try {
    const handler = freshModule('../api/notices.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { unit: '82', branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'] } }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.code, 'module_disabled');
  } finally { restoreFetch(); }
});

await check('回應唔含任何身份資料', async () => {
  clearEnv();
  freshModule('../api/_lib/ecosystem.js').cacheFlush();
  stubLibrary();
  try {
    const handler = freshModule('../api/notices.js');
    const res = mockRes();
    await handler(mockReq({ method: 'POST', body: { unit: '82', branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'], ymis: '1234567890' } }), res);
    assert.ok(!JSON.stringify(res.body).includes('1234567890'));
  } finally { restoreFetch(); }
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
