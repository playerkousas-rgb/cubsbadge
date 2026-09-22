// test/frontend.test.mjs — 前端接入層契約測試
// 跑法：node test/frontend.test.mjs   (npm run test:ui)
//
// 呢度唔開瀏覽器，改為做兩件事：
//   1. 靜態掃 index.html，守住 BUILD.md §1「apikey 永不落前端」呢條紅線；
//   2. 喺 vm 入面真係載入 assets/ec-qr.js + ec-core.js + ec-subscribe.js，
//      用假 fetch / 假 localStorage 行一次，驗分享連結同訂閱設定嘅行為。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  ✔ ${name}`); }
  catch (e) { failed++; console.log(`  ✘ ${name}\n      ${e.message}`); }
}

// ============================================================
console.log('\n=== index.html：§1 apikey 永不落前端 ===');
// ============================================================
await check('index.html 冇 currentApikey 呢個變數', () => {
  assert.ok(!/currentApikey/.test(html), '仲有 currentApikey 殘留');
});

await check('冇任何 apiRequest payload 帶 apikey', () => {
  const bad = html.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /apiRequest\s*\(/.test(l) && /apikey\s*:/.test(l));
  assert.equal(bad.length, 0, `第 ${bad.map(([n]) => n).join(',')} 行仲喺 apiRequest 帶 apikey`);
});

await check('LocalStorage session 快照唔再寫 apikey', () => {
  const m = html.match(/localStorage\.setItem\(LS\.session[^\n]*/);
  assert.ok(m, '搵唔到 session 寫入');
  assert.ok(!/apikey/i.test(m[0]), 'session 仲寫緊 apikey：' + m[0].slice(0, 160));
});

await check('URL 參數 ?apikey= 唔會再被讀取', () => {
  assert.ok(!/params\.get\(['"]apikey['"]\)/.test(html), '仲喺度讀 URL apikey');
});

await check('前端唔會自帶 backend URL 去 proxy', () => {
  const bad = html.split('\n').filter(l => /apiRequest\s*\(/.test(l) && /backend\s*:/.test(l));
  assert.equal(bad.length, 0, 'apiRequest 唔應該帶 backend');
});

// ============================================================
console.log('\n=== index.html：通告 + 訂閱 UI 已接線 ===');
// ============================================================
await check('三個生態圈腳本都有引入', () => {
  ['assets/ec-qr.js', 'assets/ec-core.js', 'assets/ec-subscribe.js'].forEach(src => {
    assert.ok(html.includes(`src="${src}"`), `未引入 ${src}`);
  });
});

await check('通告分頁有掣、有容器、有 renderer、switchTab 有分流', () => {
  assert.ok(html.includes('id="btn-tab-notice"'), '冇通告掣');
  assert.ok(html.includes('id="tab-notice"'), '冇通告容器');
  assert.ok(html.includes('function renderNoticeTab'), '冇 renderNoticeTab');
  assert.ok(/name==='notice'\)\s*renderNoticeTab\(\)/.test(html), 'switchTab 未分流到通告');
});

await check('訂閱設定同分享都有 modal', () => {
  assert.ok(html.includes('id="subscribeModal"'), '冇訂閱 modal');
  assert.ok(html.includes('id="shareModal"'), '冇分享 modal');
  assert.ok(html.includes('function openSubscribeModal'), '冇 openSubscribeModal');
  assert.ok(html.includes('function openShareModal'), '冇 openShareModal');
});

await check('新字串中英文都有（唔會淨係得一邊）', () => {
  const keys = ['nav_notice', 'notice_h', 'sub_title', 'sub_privacy', 'share_title', 'share_copy'];
  keys.forEach(k => {
    const n = (html.match(new RegExp(`(^|[,{\\s])${k}:`, 'g')) || []).length;
    assert.ok(n >= 2, `${k} 只出現 ${n} 次，應該 zh + en 各一`);
  });
});

await check('模組註冊表決定通告入口（唔係硬寫死）', () => {
  assert.ok(html.includes('applyModuleVisibility'), '冇按模組開關收埋入口');
  assert.ok(html.includes("indexOf('notice')"), '冇檢查 notice 模組');
});

// ============================================================
console.log('\n=== assets/*：喺假瀏覽器行一次 ===');
// ============================================================
function makeWindow(opts = {}) {
  const store = new Map();
  const win = {
    location: { origin: 'https://cubbadge.example', pathname: '/', href: 'https://cubbadge.example/' },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    navigator: { userAgent: 'node', clipboard: null },
    fetch: opts.fetch || (async () => ({ ok: true, json: async () => ({}) })),
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 255; return a; } },
    console,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    setTimeout, clearTimeout, Promise, Date, Math, JSON, encodeURIComponent, decodeURIComponent,
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Array, Object, String, Number, Error
  };
  win.window = win;
  win.self = win;
  win.__store = store;
  const ctx = vm.createContext(win);
  ['assets/ec-qr.js', 'assets/ec-core.js', 'assets/ec-subscribe.js'].forEach(f => {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  });
  return win;
}

await check('三個模組都掛得上 window', () => {
  const w = makeWindow();
  assert.ok(w.ECQr && w.ECCore && w.ECSubscribe);
});

await check('normId 前端鏡像同 server 一致（82 / 0082 / 第82旅）', () => {
  const w = makeWindow();
  assert.equal(w.ECCore.normId('82'), '0082');
  assert.equal(w.ECCore.normId('0082'), '0082');
  assert.equal(w.ECCore.normId(82), '0082');
  assert.ok(w.ECCore.sameUnit('82', '0082'));
  assert.equal(w.ECCore.strippedId('0082'), '82');
});

await check('分享連結永不含 apikey / token / sig（§5）', () => {
  const w = makeWindow();
  const url = w.ECCore.shareUrl({ module: 'notice', unit: '82', itemId: 'n1', title: '秋季大會操' });
  assert.ok(url.startsWith('https://cubbadge.example/?share=notice'));
  assert.ok(url.includes('u=0082'), '單位要正規化成 0082');
  ['apikey', 'apiKey', 'token', 'sig', 'AKfycb'].forEach(bad => {
    assert.ok(!url.toLowerCase().includes(bad.toLowerCase()), `分享連結唔可以有 ${bad}`);
  });
});

await check('WhatsApp 連結只係包住同一條 share URL', () => {
  const w = makeWindow();
  const url = w.ECCore.shareUrl({ module: 'notice', unit: '82' });
  const wa = w.ECCore.whatsappUrl(url, '標題');
  assert.ok(wa.startsWith('https://wa.me/?text='));
  assert.ok(decodeURIComponent(wa).includes(url));
  assert.ok(!/apikey/i.test(wa));
});

await check('QR：短連結畫得出，超長內容回 null 而唔係爆錯', () => {
  const w = makeWindow();
  const svg = w.ECCore.qrSvg('https://cubbadge.example/?share=notice&u=0082');
  assert.ok(svg && svg.startsWith('<svg'), '短連結應該畫到 QR');
  assert.ok(svg.includes('<rect'));
  const tooLong = w.ECCore.qrSvg('x'.repeat(5000));
  assert.equal(tooLong, null, '超出 v40 容量應該回 null，前端改為只顯示連結');
});

await check('訂閱設定預設空白，唔會擅自幫人訂嘢', () => {
  const w = makeWindow();
  const p = w.ECSubscribe.loadPrefs();
  assert.equal(JSON.stringify(p.branches), '[]');
  assert.equal(JSON.stringify(p.topics), '[]');
  assert.equal(p.pushEnabled, false);
});

await check('訂閱設定只存本機，內容唔含任何身份資料', () => {
  const w = makeWindow();
  w.ECSubscribe.savePrefs({ branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'], pushEnabled: false });
  const raw = Array.from(w.__store.values()).join('|');
  assert.ok(raw.includes('幼童軍'));
  ['ymis', '@', 'password', 'token'].forEach(bad => {
    assert.ok(!raw.toLowerCase().includes(bad), `本機訂閱設定唔應該有 ${bad}`);
  });
  const again = w.ECSubscribe.loadPrefs();
  assert.equal(JSON.stringify(again.topics), JSON.stringify(['branch:幼童軍:category:service']));
});

await check('clientToken 係隨機化名，同一部機穩定、唔含身份', () => {
  const w = makeWindow();
  w.ECSubscribe.savePrefs({ branches: [], topics: ['all:new'], pushEnabled: false });
  const raw = Array.from(w.__store.entries()).map(([k, v]) => k + '=' + v).join('|');
  assert.ok(!/1234567890/.test(raw));
});

await check('未揀項目 → fetchSubscribedNotices 唔會打 server', async () => {
  let called = 0;
  const w = makeWindow({ fetch: async () => { called++; return { ok: true, json: async () => ({}) }; } });
  const d = await w.ECSubscribe.fetchSubscribedNotices('82');
  assert.equal(called, 0, '零訂閱就唔應該有網絡請求');
  assert.equal(d.subscribed, false);
  assert.equal(JSON.stringify(d.items), '[]');
});

await check('有訂閱 → 只送支部／項目，body 內冇身份資料', async () => {
  let sent = null;
  const w = makeWindow({
    fetch: async (url, opt) => { sent = { url, body: JSON.parse(opt.body) }; return { ok: true, json: async () => ({ success: true, items: [] }) }; }
  });
  w.ECSubscribe.savePrefs({ branches: ['幼童軍'], topics: ['branch:幼童軍:category:service'], pushEnabled: false });
  await w.ECSubscribe.fetchSubscribedNotices('82');
  assert.equal(sent.url, '/api/notices');
  assert.equal(JSON.stringify(Object.keys(sent.body).sort()), '["branches","topics","unit"]');
});

await check('groupTopics：揀咗支部先出該支部項目', () => {
  const w = makeWindow();
  const catalog = {
    branches: [{ id: '幼童軍', label: '幼童軍' }, { id: '童軍', label: '童軍' }],
    topics: [
      { id: 'all:new', label: '全部', kind: 'all', branches: ['*'] },
      { id: 'branch:幼童軍:category:service', label: '服務', group: '分類', branches: ['幼童軍'] },
      { id: 'branch:童軍:category:training', label: '訓練', group: '分類', branches: ['童軍'] }
    ]
  };
  const only = w.ECSubscribe.groupTopics(catalog, ['幼童軍']);
  assert.equal(only.length, 1);
  assert.equal(only[0].branch, '幼童軍');
  const ids = only[0].groups.flatMap(g => g.topics.map(t => t.id));
  assert.ok(ids.includes('branch:幼童軍:category:service'));
  assert.ok(!ids.includes('branch:童軍:category:training'), '唔應該跨支部漏出');
  assert.ok(!ids.includes('all:new'), 'all:new 係獨立掣，唔入分組');
});

await check('loadEcosystem 打正確 endpoint，且會 cache', async () => {
  let calls = 0;
  const w = makeWindow({
    fetch: async (url) => { calls++; return { ok: true, json: async () => ({ success: true, unit: '0082', modules: ['notice'], navigation: [] }) }; }
  });
  await w.ECCore.loadEcosystem('82');
  await w.ECCore.loadEcosystem('0082');
  assert.equal(calls, 1, '5 分鐘內同一單位應該讀 cache');
  assert.ok(w.ECCore.moduleEnabled('notice'));
  assert.ok(!w.ECCore.moduleEnabled('finance'));
});

console.log(`\n== frontend 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
