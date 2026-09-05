// e2e.mjs
// cubsbadge 後端邏輯 e2e（在 Node 中以 mock-gas 載入 apps-script/Code.gs）
// 驗證 v5.3.1 核心規則：
//   【10d】團長鎖死一位（後端硬鎖、顯示姓名、換人流程）
//   【10e】領袖免 YMIS 用電郵登入（自動分派 L 編號、電郵登入、批量免 YMIS）
//   【10f】權限收緊 + 批量開戶
//   【10g】預設密碼 1234 + 首次登入強制改密
// 執行：npm run test:e2e   （或 node test/e2e.mjs）
import { buildBackend, sha256Hex } from './mock-gas.mjs';
import assert from 'assert';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('  ✔ ' + name); }
  catch (e) { failed++; console.error('  ✘ ' + name + '\n     → ' + e.message); }
}
function jparse(res) { return JSON.parse(res.getContent()); }
const ADMIN = { role: 'admin', ymis: '1111111111', name: '管理員' };
const SUPER = { role: 'super_admin', ymis: 'sheep', name: 'SHEEP' };

function seedUser(sandbox, o) {
  const rows = sandbox.__ss.sheets.Users.rows;
  const row = new Array(16).fill('');
  row[0] = o.ymis; row[1] = o.name; row[2] = o.email || ''; row[3] = o.role;
  row[4] = sha256Hex(o.pwd ?? 'pw'); row[5] = 'b4';
  row[6] = (o.role !== 'member'); row[11] = o.status ?? 'active';
  row[13] = ''; row[14] = 'member'; row[15] = (o.force !== false);
  rows.push(row);
  return rows;
}
// pushUser: 直接在 Users 建列（seed 用）

// ---------- constants / helpers ----------
{
  const b = buildBackend();
  check('generateTemporaryPassword() 回傳預設 1234', () => assert.equal(b.generateTemporaryPassword(), '1234'));
  check('gslLockMsg 顯示現任團長姓名', () => {
    const m = b.gslLockMsg('陳大文');
    assert.ok(m.includes('團長只能有一位'));
    assert.ok(m.includes('陳大文'));
    assert.ok(!/L\d{3,}/.test(m), '不應洩漏內部 L 編號');
  });
  check('空 Users 時 getNextLeaderId 回傳 L0001', () => assert.equal(b.getNextLeaderId(), 'L0001'));
}

// ---------- 【10e】領袖免 YMIS、電郵登入、順序 L 編號 ----------
{
  const b = buildBackend();
  const r = b.createUserRecord({ name: '李領袖', email: 'leader1@example.org', role: 'branch_leader', password: '1234', can_tick: true }, SUPER);
  check('領袖免 YMIS 開戶成功並自動分派 L 編號', () => { assert.equal(r.success, true); assert.ok(/^L\d+$/.test(r.ymis)); });
  check('第一個領袖編號為 L0001', () => assert.equal(r.ymis, 'L0001'));
  // 第二位領袖 → L0002（順序編配）
  const r2 = b.createUserRecord({ name: '王領袖', email: 'leader2@example.org', role: 'branch_leader', password: '1234', can_tick: true }, SUPER);
  check('第二個領袖編號順序為 L0002', () => assert.equal(r2.ymis, 'L0002'));
  // 電郵登入
  const login = jparse(b.handleLogin('leader1@example.org', '1234'));
  check('領袖可用電郵登入且觸發強制改密', () => {
    assert.equal(login.success, true);
    assert.equal(login.user.role, 'branch_leader');
    assert.equal(login.force_change_password, true);
  });
  // 舊有 10 位 YMIS 領袖相容：可同時用 YMIS 與電郵登入
  seedUser(b, { ymis: '1111222233', name: '舊領袖', email: 'old@example.org', role: 'branch_leader', pwd: '9999' });
  const lA = jparse(b.handleLogin('1111222233', '9999'));
  const lB = jparse(b.handleLogin('old@example.org', '9999'));
  check('舊 10 位 YMIS 領袖可用 YMIS 或電郵登入', () => { assert.equal(lA.success, true); assert.equal(lB.success, true); });
  // 缺少電郵的領袖開戶會被拒
  const rNo = b.createUserRecord({ name: '無郵箱', role: 'branch_leader' }, SUPER);
  check('領袖開戶無 Email 會被拒', () => { assert.equal(rNo.success, false); assert.ok(rNo.error.includes('Email')); });
}

// ---------- 【10d】團長鎖死一位（後端硬鎖 + 顯示姓名 + 換人） ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw' });
  // 升第一位團長成功
  const make = b.createUserRecord({ name: '陳大文', email: 'gsl1@example.org', role: 'group_leader', password: '1234', can_tick: true }, ADMIN);
  check('開立第一位團長成功', () => assert.equal(make.success, true));
  check('現任團長 = 陳大文 (L0001)', () => {
    const cur = b.getActiveGroupLeader();
    assert.ok(cur); assert.equal(cur.name, '陳大文'); assert.ok(/^L\d+$/.test(cur.ymis));
  });
  // 再嘗試開立第二位團長 → 硬鎖
  const second = b.createUserRecord({ name: '黃志明', email: 'gsl2@example.org', role: 'group_leader', password: '1234', can_tick: true }, ADMIN);
  check('重複開立團長被拒並顯示現任姓名', () => {
    assert.equal(second.success, false);
    assert.ok(second.error.includes('團長只能有一位'));
    assert.ok(second.error.includes('陳大文'));
  });
  // updateUserRole 將他人升為團長亦被鎖
  seedUser(b, { ymis: '2222333344', name: '候選人', email: 'cand@example.org', role: 'branch_leader', pwd: 'pw' });
  const up = jparse(b.handleUpdateUserRole('2222333344', 'group_leader', true, '1111111111'));
  check('updateUserRole 升他人為團長被鎖並顯示姓名', () => { assert.equal(up.success, false); assert.ok(up.error.includes('陳大文')); });
  // 換人流程：先把現任轉為其他角色，再升新人 → 成功
  const demote = jparse(b.handleUpdateUserRole(make.ymis, 'branch_leader', true, '1111111111'));
  check('先將現任團長降為支部領袖（解鎖）', () => assert.equal(demote.success, true));
  const promote = jparse(b.handleUpdateUserRole('2222333344', 'group_leader', true, '1111111111'));
  check('解鎖後可升新團長', () => assert.equal(promote.success, true));
  check('換人後現任團長為候選人', () => {
    const cur = b.getActiveGroupLeader();
    assert.ok(cur); assert.equal(cur.name, '候選人');
  });
}

// ---------- 【10f】權限收緊：支部領袖只能開 member ----------
{
  const b = buildBackend();
  const BL = { role: 'branch_leader', ymis: 'L0001', name: '支部領袖' };
  const okMem = b.createUserRecord({ ymis: '1234560001', name: '小團員', role: 'member' }, BL);
  check('支部領袖可開立 member', () => assert.equal(okMem.success, true));
  const badGsl = b.createUserRecord({ name: 'G', email: 'g@x.org', role: 'group_leader' }, BL);
  const badAdmin = b.createUserRecord({ name: 'A', email: 'a@x.org', role: 'admin' }, BL);
  const badPeer = b.createUserRecord({ name: 'B', email: 'b@x.org', role: 'branch_leader' }, BL);
  check('支部領袖不可越權開立 group_leader', () => assert.equal(badGsl.success, false));
  check('支部領袖不可越權開立 admin', () => assert.equal(badAdmin.success, false));
  check('支部領袖不可越權開立 branch_leader', () => assert.equal(badPeer.success, false));
}

// ---------- 【10f】批量開戶 + 批量中團長鎖 + 免 YMIS 領袖 ----------
{
  const b = buildBackend();
  const res = jparse(b.handleBulkAddUsers([
    { ymis: '1234560001', name: '成員一', role: 'member' },
    { ymis: '', name: '領袖一', email: 'lb1@example.org', role: 'branch_leader', password: '1234' },
    { name: '團長甲', email: 'gA@example.org', role: 'group_leader', password: '1234' },
    { name: '團長乙', email: 'gB@example.org', role: 'group_leader', password: '1234' },
  ], ADMIN));
  check('批量開戶回傳逐列結果', () => { assert.equal(res.ok, 3); assert.equal(res.skipped, 1); });
  const gA = res.results.find(r => r.name === '團長甲');
  const gB = res.results.find(r => r.name === '團長乙');
  check('批量中第一位團長成功', () => { assert.ok(gA); assert.equal(gA.success, true); });
  check('批量中第二位團長被鎖並顯示姓名', () => {
    assert.ok(gB); assert.equal(gB.success, false);
    assert.ok(gB.error.includes('團長甲'));
  });
  // 批量開戶的領袖列留空 YMIS → 有電郵即可
  const l1 = res.results.find(r => r.name === '領袖一');
  check('批量領袖留空 YMIS 成功', () => { assert.ok(l1); assert.equal(l1.success, true); });
  check('批量回傳訊息', () => assert.ok(res.message.includes('3 成功')));
}

// ---------- 【10g】首次登入強制改密最少 4 位 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1000000001', name: '新成員', email: 'm1@example.org', role: 'member', pwd: '1234', force: true });
  // 4 位新密碼可通過
  const ok4 = jparse(b.handleChangePassword('1000000001', '1234', 'abcd'));
  check('新密碼 4 位可通過', () => assert.equal(ok4.success, true));
  seedUser(b, { ymis: '1000000002', name: '另一員', email: 'm2@example.org', role: 'member', pwd: '1234', force: true });
  const bad3 = jparse(b.handleChangePassword('1000000002', '1234', 'abc'));
  check('新密碼少於 4 位被拒', () => { assert.equal(bad3.success, false); assert.ok(bad3.error.includes('4')); });
  // 登入回傳 force_change_password
  const login = jparse(b.handleLogin('1000000001', 'abcd'));
  check('改密後登入不再強制改密', () => { assert.equal(login.success, true); assert.equal(login.force_change_password, false); });
}

// ---------- 彙總 ----------
console.log('\n== e2e 結果：' + passed + ' 通過，' + failed + ' 失敗 ==');
if (failed > 0) process.exit(1);
