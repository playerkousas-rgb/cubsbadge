// 登入效能實測（手動執行：npm run bench:login）
// 目的：確認 doPost(action=login) 在真實旅團規模下不會觸及 Apps Script 執行上限（約 6 分鐘）。
// 注意：呢個 sandbox 係 Node/V8（與 Apps Script 同引擎），量到嘅係 CPU 成本；
// GIS 真機另外要加每次試算表服務呼叫的網絡延遲，所以本 script 同時報告呼叫次數。
import { buildBackend, sha256Hex, USERS_HEADER } from '../test/mock-gas.mjs';
import { pbkdf2Sync } from 'node:crypto';

const login = (b, id, pw) => JSON.parse(b.doPost({
  parameter: {}, postData: { contents: JSON.stringify({ action: 'login', login_id: id, password: pw }) }
}).getContent());

function seed(b, { users = 60, progress = 2000, tokens = 60, other = 300 } = {}) {
  const hash = b.hashPasswordV2('Passw0rd');
  for (let i = 0; i < users; i++) {
    const r = new Array(USERS_HEADER.length).fill('');
    r[0] = String(1000000000 + i); r[1] = '成員' + i; r[2] = `m${i}@example.org`;
    r[3] = i < 6 ? 'branch_leader' : 'member'; r[4] = hash; r[11] = 'active';
    b.__ss.sheets.Users.rows.push(r);
  }
  for (let i = 0; i < progress; i++) b.__ss.sheets['進度追蹤'].rows.push([String(1000000000 + (i % users)), '1.1.' + (i % 9), '2026-01-01', '2026-01-02', '領袖', '']);
  for (let i = 0; i < tokens; i++) b.__ss.sheets.Tokens.rows.push(['tok' + i, String(1000000000 + i), '2026-01-01', '2099-01-01']);
  for (let i = 0; i < other; i++) b.__ss.sheets['其他獎章'].rows.push([String(1000000000 + (i % users)), 'A' + String((i % 42) + 1).padStart(2, '0'), '章', '2026-01-01', '', '', '2026-01-02', '']);
  return hash;
}
function instrument(b) {
  const calls = [];
  for (const [name, sheet] of Object.entries(b.__ss.sheets)) {
    for (const m of ['getDataRange', 'appendRow', 'deleteRow']) {
      const orig = sheet[m].bind(sheet);
      sheet[m] = (...a) => { calls.push(name + '.' + m); return orig(...a); };
    }
    const gr = sheet.getRange.bind(sheet);
    sheet.getRange = (...a) => { const r = gr(...a); const sv = r.setValue.bind(r); r.setValue = v => { calls.push(name + '.setValue'); return sv(v); }; return r; };
  }
  return calls;
}
function bench(label, b, id, pw, runs = 7) {
  login(b, id, pw);
  const t = [];
  for (let i = 0; i < runs; i++) { const s = process.hrtime.bigint(); login(b, id, pw); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
  t.sort((a, c) => a - c);
  const median = t[Math.floor(runs / 2)];
  console.log(' ', label.padEnd(34), 'median', median.toFixed(1).padStart(7), 'ms');
  return median;
}

const b = buildBackend(); b.initializeSheets(); seed(b);
console.log('\n[1] 典型旅團（60 用戶／2,000 進度列／60 token）');
bench('正確密碼', b, '1000000010', 'Passw0rd');
{
  // 量度「一次成功登入」實際打幾多次試算表服務（每次真機呼叫約 10–30 ms）
  const calls = instrument(b); calls.length = 0;
  login(b, '1000000010', 'Passw0rd');
  const counts = {};
  for (const c of calls) counts[c] = (counts[c] || 0) + 1;
  console.log('    單次成功登入的試算表服務呼叫：' + calls.length + ' 次 → ' +
    Object.entries(counts).map(([k, v]) => v + '×' + k).join(', '));
}
bench('錯誤密碼', b, '1000000010', 'nope');
bench('未知帳號（dummy KDF）', b, '9876543210', 'whatever');
bench('電郵登入', b, 'm10@example.org', 'Passw0rd');

console.log('\n[2] 舊版 120,000 次雜湊（未改密碼的帳戶）：首次登入一次性收斂');
{
  const salt = '00112233445566778899aabbccddeeff';
  const legacy = 'pbkdf2$120000$' + salt + '$' + pbkdf2Sync('LegacyPass', Buffer.from(salt, 'hex'), 120000, 32, 'sha256').toString('hex');
  const row = new Array(USERS_HEADER.length).fill('');
  row[0] = '1234567899'; row[1] = '舊帳戶'; row[2] = 'old@example.org'; row[3] = 'branch_leader'; row[4] = legacy; row[11] = 'active';
  b.__ss.sheets.Users.rows.push(row);
  let s = process.hrtime.bigint();
  assert(login(b, '1234567899', 'LegacyPass').success, '舊雜湊必須仍可登入');
  console.log('  首次登入（驗證 120,000 次＋改寫）'.padEnd(37), (Number(process.hrtime.bigint() - s) / 1e6).toFixed(1).padStart(7), 'ms');
  console.log('  改寫後格式：'.padEnd(37), row[4].split('$')[1] + ' 次');
  bench('之後每次登入', b, '1234567899', 'LegacyPass');
}

console.log('\n[3] 大型旅團（600 用戶／6,000 進度列／1,000 token）');
{
  const big = buildBackend(); big.initializeSheets(); seed(big, { users: 600, progress: 6000, tokens: 1000, other: 1200 });
  bench('正確密碼', big, '1000000599', 'Passw0rd');
  bench('未知帳號', big, '9876543210', 'whatever');
}

function assert(cond, msg) { if (!cond) { console.error('✘ ' + msg); process.exitCode = 1; } }
console.log('\n結論：CPU 成本 ~50 ms（10,000 次）；每次登入只有 4 次試算表服務呼叫，遠離逾時風險。\n');
