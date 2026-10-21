// register_apply.e2e.mjs — 「新旅團接入申請」端到端測試（真 HTTP、唔打真實外網）
//
// 起一個本機 mock Scout Admin GS（記錄收到嘅 payload，回 {status:"success"}），
// 再以子行程起 test/devserver.mjs（同 Vercel 一樣 /api/* → serverless handler），
// 環境變數只設 APP ADMIN 喺 Vercel 用緊嘅 SCOUTBADGE_ADMIN_API（仲要帶空白驗 trim），
// 然後用前端原格式（submitRegistration → POST /api/register）行完整條路：
//   前端 scriptUrl → 伺服器映射 backendUrl + type:"apply" + appType:"cubsbadge"
//   → mock Scout Admin 收到申請記錄；全程唔使用、唔外洩 SUPER_KEY。
// 順帶驗 submitFeedback 共用同一收件匣。
//
// 執行：npm run test:register-e2e
import assert from 'assert';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_SECRET = 'e2e_SERVER_SECRET_do_not_leak';
const APPLICANT_URL = 'https://script.google.com/macros/s/AKfycbE2EAPPLICANT12345/exec';

let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     → ' + (e && e.message)); }
}

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

// ---------- mock Scout Admin GS ----------
const received = [];
let mockMode = 'success';
const mockAdmin = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* keep null */ }
    received.push({ method: req.method, url: req.url, raw, body });
    const out = mockMode === 'success'
      ? { status: 'success', message: '申請已記錄' }
      : { status: 'error', message: 'mock 收件失敗' };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out));
  });
});
await new Promise((r) => mockAdmin.listen(0, '127.0.0.1', r));
const mockPort = mockAdmin.address().port;

// ---------- app（devserver 子行程，env 同 Vercel 實況看齊）----------
const appPort = await freePort();
const childEnv = { ...process.env };
Object.keys(childEnv).filter((k) => /^TROOP_|_ADMIN_API$|^VERCEL_ENV$/.test(k)).forEach((k) => delete childEnv[k]);
childEnv.PORT = String(appPort);
childEnv.NODE_ENV = 'development'; // 容許本機 mock 收件匣（生產 isValidGasUrl 只認 script.google.com）
childEnv.SUPER_KEY = SERVER_SECRET; // 伺服器有設 — 正好驗證佢永遠唔落申請 payload
// APP ADMIN 喺 Vercel 設定嘅名就係呢個；前後空白一併驗 trim
childEnv.SCOUTBADGE_ADMIN_API = `  http://127.0.0.1:${mockPort}/exec  `;

const child = spawn(process.execPath, ['test/devserver.mjs'], { cwd: ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
let childLog = '';
child.stdout.on('data', (d) => { childLog += d; });
child.stderr.on('data', (d) => { childLog += d; });
let childExited = false;
child.on('exit', () => { childExited = true; });

const base = `http://127.0.0.1:${appPort}`;
const postJson = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

try {
  // 等 devserver 起好（起唔到就印 log 方便 debug）
  const deadline = Date.now() + 20000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    if (childExited) break;
    try { const r = await fetch(`${base}/api/health?troopId=0082&checkBackend=0`); if (r.ok) ready = true; } catch { /* 未起好 */ }
    if (!ready) await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw new Error('devserver 未能啟動：\n' + childLog.slice(-1500));

  console.log('\n=== register「新旅團接入申請」E2E（前端 → /api/register → mock Scout Admin）===');

  await check('前端格式不變：首頁 submitRegistration 仍然 POST /api/register 帶 scriptUrl', async () => {
    const html = await (await fetch(`${base}/`)).text();
    assert.ok(html.includes("fetch('/api/register'"), '前端要打同源 /api/register');
    assert.ok(html.includes('scriptUrl:su'), '前端請求格式維持 scriptUrl（映射喺伺服器端做）');
  });

  await check('公開申請（冇 SUPER_KEY header）成功；上游收到對齊 payload，前端收 {success:true}', async () => {
    const before = received.length;
    // 同 index.html submitRegistration() 一字不差嘅 body 形狀
    const resp = await postJson('/api/register', {
      troopId: '0099', troopName: '', scriptUrl: APPLICANT_URL,
      apiKey: 'cb_e2e_key', appType: 'cubbadge', note: '聯絡電郵 leader@example.org'
    });
    const body = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(body));
    assert.deepEqual(body, { success: true, message: '申請已提交' }, '唔可以原文回 {status:"success"}');

    assert.equal(received.length, before + 1, 'mock Scout Admin 要收到一份申請');
    const got = received[received.length - 1];
    assert.equal(got.body.type, 'apply');
    assert.equal(got.body.appType, 'cubsbadge');
    assert.equal(got.body.troopId, '0099');
    assert.equal(got.body.troopName, '第 0099 旅', '空旅名補預設，Scout Admin 卡片先唔會略過');
    assert.equal(got.body.backendUrl, APPLICANT_URL, 'scriptUrl 映射為 backendUrl');
    assert.ok(!('scriptUrl' in got.body), '唔再送 scriptUrl');
    assert.equal(got.body.apiKey, 'cb_e2e_key');
    assert.equal(got.body.note, '[cubsbadge] 聯絡電郵 leader@example.org', 'note 標記邊個 APP 寄出');
    assert.ok(!('superKey' in got.body) && !('super_key' in got.body), 'payload 冇 superKey 欄位');
    assert.ok(!got.raw.includes(SERVER_SECRET), 'SUPER_KEY 值絕不可外洩去 Google Sheet／Email');
  });

  await check('必填缺漏（冇 apiKey）→ 400，mock Scout Admin 冇收到嘢', async () => {
    const before = received.length;
    const resp = await postJson('/api/register', { troopId: '0099', scriptUrl: APPLICANT_URL });
    const body = await resp.json();
    assert.equal(resp.status, 400);
    assert.equal(body.success, false);
    assert.equal(received.length, before);
  });

  await check('上游 {status:"error"} → 前端收 502 {success:false}（唔呃用戶話成功）', async () => {
    mockMode = 'error';
    try {
      const resp = await postJson('/api/register', {
        troopId: '0099', troopName: '第 99 旅', scriptUrl: APPLICANT_URL, apiKey: 'cb_e2e_key', note: ''
      });
      const body = await resp.json();
      assert.equal(resp.status, 502, JSON.stringify(body));
      assert.equal(body.success, false);
    } finally { mockMode = 'success'; }
  });

  await check('submitFeedback 共用同一收件匣 env → confirmed', async () => {
    const before = received.length;
    const resp = await postJson('/api/proxy', {
      action: 'submitFeedback', type: 'feedback', contact: 'a@b.c',
      troopId: '0082', fbType: '建議', content: '希望可以匯出 PDF'
    });
    const body = await resp.json();
    assert.equal(resp.status, 200, JSON.stringify(body));
    assert.deepEqual(body, { success: true, deliveryStatus: 'confirmed' });
    assert.equal(received.length, before + 1);
    assert.equal(received[received.length - 1].body.content, '希望可以匯出 PDF');
  });
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => child.once('exit', r)),
    new Promise((r) => setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* 已退出 */ } r(); }, 3000))
  ]);
  await new Promise((r) => mockAdmin.close(r));
}

console.log(`\n== register e2e 結果：${passed} 通過，${failed} 失敗 ==`);
if (failed > 0) process.exit(1);
