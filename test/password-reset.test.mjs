// ============================================================
// 領袖登入「忘記密碼」回歸測試（v6.0 / GS 2026.11.02 / frontend 2026.11.02.1）
//
// 以 mock-gas 執行真正嘅 apps-script/Code.gs（經 doPost），驗證：
//   - 重設碼只寄去已登記嘅啟用中領袖電郵；帳號不存在／成員／停用／保留帳號一律唔寄信，回應一致
//   - 重設碼只存 SHA-256 雜湊、15 分鐘到期、最多 5 次嘗試、一次性、新申請取代舊碼
//   - 唔接受 token／apikey／指定 YMIS 嘅特權捷徑；限速；成功後舊 session 失效、寫中性操作紀錄
//   - 前端（登入頁連結、兩步 modal、中英字典、版本識別）與 proxy 防線一致
//
// 執行：node --test test/password-reset.test.mjs
// ============================================================
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBackend, sha256Hex, USERS_HEADER } from './mock-gas.mjs';

const EMAIL = 'leader@example.org';

function call(b, payload) {
  // 經真正嘅 doPost 路由，唔係直接叫 handler：確保兩個 action 真係註冊咗公開入口。
  const res = b.doPost({ postData: { contents: JSON.stringify(payload) }, parameter: {} });
  return JSON.parse(res.getContent());
}
function seedUser(b, o) {
  const row = new Array(USERS_HEADER.length).fill('');
  row[0] = o.ymis; row[1] = o.name || ''; row[2] = o.email || ''; row[3] = o.role || 'branch_leader';
  row[4] = sha256Hex(o.pwd || 'oldpw'); row[6] = (o.role || 'branch_leader') !== 'member';
  row[11] = o.status || 'active'; row[15] = o.force !== false;
  b.__ss.sheets.Users.rows.push(row);
  return row;
}
function resetRows(b) { return b.__ss.sheets['密碼重設'].rows.slice(1); }
function codeFromMail(b) {
  const mail = b.__mail[b.__mail.length - 1];
  assert.ok(mail && mail.body, '應該寄出一封重設碼電郵');
  const m = String(mail.body).match(/重設碼 \/ Reset code：([0-9A-F]{4}-[0-9A-F]{4})/);
  assert.ok(m, '電郵應包含 8 位重設碼');
  return m[1].replace('-', '');
}
function newLeaderBackend() {
  const b = buildBackend();
  seedUser(b, { ymis: 'L0001', name: '李領袖', email: EMAIL, role: 'branch_leader', pwd: 'oldpw' });
  return b;
}
function issueCode(b, email = EMAIL, extra = {}) {
  const res = call(b, { action: 'requestPasswordReset', email, ...extra });
  assert.equal(res.success, true, JSON.stringify(res));
  return { res, code: codeFromMail(b) };
}
function confirm(b, email, code, password, extra = {}) {
  return call(b, { action: 'confirmPasswordReset', email, code, new_password: password, ...extra });
}

test('完整流程：寄碼 → 雜湊入表 → 錯碼計次 → 改密成功 → 舊 session 登出 → 不可重用', () => {
  const b = newLeaderBackend();
  b.__ss.sheets.Tokens.rows.push(['old-session', 'L0001', '2026-01-01', '2099-01-01']);

  const { code } = issueCode(b);
  assert.equal(b.__mail.length, 1);
  assert.equal(b.__mail[0].to, EMAIL);
  assert.equal(b.__mail[0].body.includes('oldpw'), false, '電郵不可包含舊密碼');
  assert.equal(b.__mail[0].body.includes('newpw'), false, '電郵不可包含新密碼');

  const rows = resetRows(b);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 'L0001');
  assert.equal(rows[0][2], EMAIL);
  assert.equal(rows[0][3], sha256Hex(code), '只可存重設碼雜湊');
  assert.equal(rows[0][7], 'pending');
  assert.equal(JSON.stringify(rows).includes(code), false, '明文重設碼不可入表');
  assert.ok(rows[0][5] - rows[0][4] === 15 * 60 * 1000, '有效期 15 分鐘');

  const bad = confirm(b, EMAIL, '00000000', 'newpw');
  assert.equal(bad.success, false);
  assert.match(bad.error, /重設碼不正確|Invalid or expired/);
  assert.equal(resetRows(b)[0][6], 1, '錯碼要計次');

  const tooShort = confirm(b, EMAIL, code, 'abc');
  assert.equal(tooShort.success, false, '密碼規則 4-8 位');
  assert.equal(resetRows(b)[0][6], 1, '不合規則唔應該消耗嘗試次數');

  const ok = confirm(b, EMAIL, code, 'newpw');
  assert.equal(ok.success, true, JSON.stringify(ok));

  const u = b.__ss.sheets.Users.rows[1];
  assert.match(u[4], /^pbkdf2\$/); assert.equal(b.verifyPassword('newpw',u[4]),true);
  assert.equal(u[15], false, '用戶自己揀嘅新密碼，毋須再強制改密');
  assert.equal(JSON.parse(b.handleLogin(EMAIL, 'oldpw').getContent()).success, false);
  const login = JSON.parse(b.handleLogin(EMAIL, 'newpw').getContent());
  assert.equal(login.success, true);
  assert.equal(login.force_change_password, false);

  assert.equal(b.__ss.sheets.Tokens.rows.some(r => r[0] === 'old-session'), false, '舊 session 要即刻失效');
  const audit = b.__ss.sheets['操作紀錄'].rows.slice(1).find(r => r[2] === 'password_reset_by_email');
  assert.ok(audit, '要寫操作紀錄');
  assert.equal(audit.join(' ').includes(code), false, '操作紀錄不可含重設碼');
  assert.equal(audit.join(' ').includes('newpw'), false, '操作紀錄不可含密碼');

  assert.equal(resetRows(b)[0][7], 'used');
  assert.equal(confirm(b, EMAIL, code, 'otherpw').success, false, '重設碼只可用一次');
  assert.equal(b.verifyPassword('newpw', b.__ss.sheets.Users.rows[1][4]), true, '重用唔可以再改密碼');
});

test('不洩漏帳號存在與否：不存在／成員／停用／保留／超管角色一律唔寄信，回應完全相同', () => {
  const b = buildBackend();
  seedUser(b, { ymis: '1234567890', name: '家長', email: 'parent@example.org', role: 'member' });
  seedUser(b, { ymis: 'L0002', name: '停用領袖', email: 'off@example.org', role: 'group_leader', status: 'inactive' });
  seedUser(b, { ymis: 'L0003', name: '保留電郵', email: 'sheep@cubbadge.local', role: 'admin' });
  seedUser(b, { ymis: 'L0004', name: '假超管', email: 'fake-super@example.org', role: 'super_admin' });

  const baseline = call(b, { action: 'requestPasswordReset', email: 'nobody@example.org' });
  assert.equal(baseline.success, true);
  for (const email of ['parent@example.org', 'off@example.org', 'sheep@cubbadge.local', 'fake-super@example.org']) {
    const r = call(b, { action: 'requestPasswordReset', email });
    assert.equal(r.success, baseline.success);
    assert.equal(r.message, baseline.message, `${email} 回應唔可以同「不存在」有分別`);
  }
  assert.equal(b.__mail.length, 0, '唔應該寄任何重設碼');
  assert.equal(resetRows(b).every(r => r[7] === 'no_account' && r[3] === ''), true);
  // 無有效碼就唔可以confirm任何密碼
  assert.equal(confirm(b, 'parent@example.org', 'AAAAAAAA', 'hackpw').success, false);
  assert.equal(b.__ss.sheets.Users.rows[1][4], sha256Hex('oldpw'));
});

test('電郵格式無效即時拒絕；新申請取代舊碼；舊碼作廢', () => {
  const b = newLeaderBackend();
  for (const bad of ['not-an-email', '=1+1@example.org', '+x@example.org', '-x@example.org', '@example.org']) {
    assert.equal(call(b, { action: 'requestPasswordReset', email: bad }).success, false, bad);
    assert.equal(confirm(b, bad, 'A1B2C3D4', 'newpw').success, false, bad + ' (confirm)');
  }
  const first = issueCode(b);
  const second = issueCode(b);
  assert.notEqual(first.code, second.code);
  const rows = resetRows(b);
  assert.equal(rows.length, 2);
  assert.equal(rows[0][7], 'superseded', '舊碼要作廢');
  assert.equal(rows[1][7], 'pending');
  assert.equal(confirm(b, EMAIL, first.code, 'firstpw').success, false, '舊碼不可用');
  // 任何錯碼（包括已作廢嘅舊碼）都計入目前有效碼嘅嘗試次數，防止無限試碼。
  assert.equal(resetRows(b)[1][6], 1);
  assert.equal(confirm(b, EMAIL, second.code, 'secondpw').success, true);
  assert.equal(b.verifyPassword('secondpw',b.__ss.sheets.Users.rows[1][4]),true);
});

test('限速：同一電郵 30 分鐘內最多 3 次；全團每小時最多 30 次', () => {
  const b = newLeaderBackend();
  for (let i = 0; i < 3; i++) assert.equal(call(b, { action: 'requestPasswordReset', email: EMAIL }).success, true);
  const fourth = call(b, { action: 'requestPasswordReset', email: EMAIL });
  assert.equal(fourth.success, false);
  assert.match(fourth.error, /請求過於頻密/);
  assert.equal(b.__mail.length, 3);

  const g = buildBackend();
  for (let i = 0; i < 30; i++) assert.equal(call(g, { action: 'requestPasswordReset', email: `nobody${i}@example.org` }).success, true);
  const overflow = call(g, { action: 'requestPasswordReset', email: 'overflow@example.org' });
  assert.equal(overflow.success, false);
  assert.match(overflow.error, /請求過於頻密/);
});

test('暴力試碼：最多 5 次，鎖住後連正確碼都唔可用', () => {
  const b = newLeaderBackend();
  const { code } = issueCode(b);
  for (let i = 0; i < 5; i++) assert.equal(confirm(b, EMAIL, 'ZZZZZZZZ', 'hackpw').success, false);
  assert.equal(resetRows(b)[0][7], 'locked');
  assert.equal(confirm(b, EMAIL, code, 'hackpw').success, false);
  assert.equal(b.__ss.sheets.Users.rows[1][4], sha256Hex('oldpw'), '密碼不能被改');
});

test('過期碼失效', () => {
  const b = newLeaderBackend();
  const { code } = issueCode(b);
  b.__ss.sheets['密碼重設'].rows[1][5] = Date.now() - 1;
  assert.equal(confirm(b, EMAIL, code, 'newpw').success, false);
  assert.equal(resetRows(b)[0][7], 'expired');
  assert.equal(b.__ss.sheets.Users.rows[1][4], sha256Hex('oldpw'));
});

test('不可挾帶身份欄位提權：token／apikey／指定 YMIS 一律唔影響重設對象', () => {
  const b = newLeaderBackend();
  seedUser(b, { ymis: 'L0009', name: '另一位領袖', email: 'other@example.org', role: 'group_leader', pwd: 'victimpw' });
  const injected = { token: 'admin-session-token', apikey: 'fake-key', ymis: 'L0009', target_ymis: 'L0009', role: 'super_admin', password_hash: 'x' };
  const { code } = issueCode(b, EMAIL, injected);
  assert.equal(resetRows(b)[0][1], 'L0001', '目標只可以由電郵查出來');
  const ok = confirm(b, EMAIL, code, 'newpw', injected);
  assert.equal(ok.success, true);
  assert.equal(b.verifyPassword('newpw', b.__ss.sheets.Users.rows[1][4]),true, '只改申請電郵所屬帳戶');
  assert.equal(b.__ss.sheets.Users.rows[2][4], sha256Hex('victimpw'), '另一位領袖密碼不可被改');
});

test('確認前帳戶被停用／降級／改電郵 → 拒絕重設', () => {
  for (const mutate of [
    row => { row[11] = 'inactive'; },
    row => { row[3] = 'member'; },
    row => { row[2] = 'changed@example.org'; }
  ]) {
    const b = newLeaderBackend();
    const { code } = issueCode(b);
    mutate(b.__ss.sheets.Users.rows[1]);
    assert.equal(confirm(b, EMAIL, code, 'newpw').success, false);
    assert.equal(b.__ss.sheets.Users.rows[1][4], sha256Hex('oldpw'));
  }
});

test('舊 Sheet 唔使重跑初始化：第一次申請自動補建「密碼重設」表，既有資料完全唔郁', () => {
  const b = newLeaderBackend();
  seedUser(b, { ymis: '1234567890', name: '陳大文', email: 'cub@example.org', role: 'member' });
  const before = JSON.parse(JSON.stringify(b.__ss.sheets.Users.rows));
  assert.equal(b.__ss.sheets['密碼重設'], undefined, 'mock 新表應該未有呢張工作表');
  const r = call(b, { action: 'requestPasswordReset', email: EMAIL });
  assert.equal(r.success, true);
  const sh = b.__ss.sheets['密碼重設'];
  assert.ok(sh, '要自動補建工作表');
  assert.deepEqual(sh.rows[0], ['reset_id','ymis','email','code_hash','created_ms','expires_ms','attempts','status','used_at']);
  assert.deepEqual(b.__ss.sheets.Users.rows, before, '既有 Users 資料唔可被改動');
  assert.equal(b.doPost({ postData: { contents: JSON.stringify({ action: 'requestPasswordReset', email: EMAIL }) }, parameter: {} }).getContent().includes('success'), true);

  const fresh = buildBackend();
  fresh.initializeSheets();
  assert.ok(fresh.__ss.sheets['密碼重設'], '新建 Sheet 初始化時要一併建立');
  assert.deepEqual(fresh.__ss.sheets['密碼重設'].rows[0], ['reset_id','ymis','email','code_hash','created_ms','expires_ms','attempts','status','used_at']);
});

test('發信失敗、成功和未知帳號的公開回應一致', () => {
  const b = newLeaderBackend();
  b.MailApp.sendEmail = () => { throw new Error('no mail permission'); };
  const failed = call(b, { action: 'requestPasswordReset', email: EMAIL });
  const unknown = call(b, { action: 'requestPasswordReset', email: 'nobody2@example.org' });
  b.MailApp.sendEmail = (m) => { b.__mail.push({ ...m }); };
  const recovered = call(b, { action: 'requestPasswordReset', email: EMAIL });
  assert.deepEqual(failed, unknown);
  assert.deepEqual(failed, recovered);
  assert.equal(b.__mail.length, 1);
});

test('管理員可執行 testPasswordResetMail() 觸發授權並驗證發信', () => {
  const b = buildBackend();
  b.Session = { getActiveUser: () => ({ getEmail: () => 'gsl@example.org' }) };
  const msg = b.testPasswordResetMail();
  assert.match(msg, /gsl@example\.org/);
  assert.equal(b.__mail.length, 1);
  assert.equal(b.__mail[0].to, 'gsl@example.org');
  assert.equal(b.__ss.sheets.Users.rows.length, 1, '測試函式唔可以寫入任何帳號資料');
});

test('前端：登入頁領袖專用入口、兩步 modal、中英字典、版本識別一致', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const gs = fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
  const proxy = fs.readFileSync(new URL('../api/proxy.js', import.meta.url), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(new URL('../data/frontend-release.json', import.meta.url), 'utf8'));

  assert.match(html, /id="forgotPwWrap"[^>]*style="display:none/);
  assert.match(html, /onclick="openForgotPasswordModal\(\);return false"/);
  assert.match(html, /fpwWrap\.style\.display=\(type==='leader'\)\?'block':'none'/);
  assert.ok(html.includes('id="forgotPasswordModal"') && html.includes('id="fpwStep1"') && html.includes('id="fpwStep2"'));
  assert.match(html, /action:'requestPasswordReset'/);
  assert.match(html, /action:'confirmPasswordReset'/);
  assert.match(html, /\/Unknown action\|不支援此操作\|not supported\/i\.test\(raw\)\)/, '舊 GS 要有清晰提示');

  // I18N：所有 fpw_ key 中英都要有
  const start = html.indexOf('const I18N={'), end = html.indexOf('\n};', start);
  const I18N = new Function(html.slice(start, end + 2) + '; return I18N;')();
  const keys = Object.keys(I18N.zh).filter(k => k.startsWith('fpw_'));
  assert.ok(keys.length >= 20, `fpw_ key 太少：${keys.length}`);
  assert.deepEqual(keys.filter(k => !I18N.en[k]), [], '英文模式唔可以 fallback 中文');
  assert.ok(I18N.zh.fpw_mail_unavailable && I18N.en.fpw_mail_unavailable, '發信故障提示要中英對照');
  assert.doesNotMatch(html, /d\.delivery==='unavailable'/);

  // 版本：HTML build = manifest；GS 版本 = 前端要求 = 下載連結
  assert.equal(html.match(/<meta name="cubsbadge-build" content="([^"]+)"/)[1], manifest.build);
  const gsVersion = gs.match(/const CUB_GS_VERSION = '([^']+)'/)[1];
  assert.equal(gsVersion, '2026.11.03.2');
  assert.ok(html.includes(`gsVersion:'${gsVersion}'`));
  assert.ok(html.includes(`href="apps-script/Code.gs?gs=${gsVersion}"`));

  // proxy：兩個 action 唔可以收客戶端自帶身份欄位
  assert.match(proxy, /action === 'requestPasswordReset' \|\| action === 'confirmPasswordReset'/);
  assert.match(proxy, /\['token', 'ymis', 'target_ymis', 'role', 'password_hash', 'code_hash', 'user'\]/);
});

test('已申請的存在及不存在帳號，錯碼次數與回應一致', () => {
  const b=newLeaderBackend(); issueCode(b); call(b,{action:'requestPasswordReset',email:'missing@example.org'});
  for(let i=0;i<5;i++){
    const real=confirm(b,EMAIL,'ZZZZZZZZ','newpw');
    const missing=confirm(b,'missing@example.org','ZZZZZZZZ','newpw');
    assert.deepEqual(real,missing);
    assert.equal(real.remaining,4-i);
  }
});
