// e2e.mjs
// cubsbadge 後端邏輯 e2e（在 Node 中以 mock-gas 載入 apps-script/Code.gs）
// 驗證 v5.3.1 核心規則：
//   【10d】旅長鎖死一位（後端硬鎖、顯示姓名、換人流程）
//   【10e】領袖免 YMIS 用電郵登入（自動分派 L 編號、電郵登入、批量免 YMIS）
//   【10f】權限收緊 + 批量開戶
//   【10g】預設密碼 1234 + 首次登入強制改密
// v5.3.2 新增：
//   【11a】YMIS／Email 全表唯一（含已停用帳號不可重用）
//   【11b】用戶管理不漏成員（status 空白＝active、純成員合併列出、include_inactive）
//   【11c】領袖設定密碼（自訂 new_password、權限檢查、純成員開通、重複列寫對列）
//   【11d】重新啟用已停用帳號（補回成員名單、密碼重設、旅長鎖）
//   【11e】修改成員資料／刪除成員（同步兩表、刪後 YMIS 仍不可重用）
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
  check('gslLockMsg 顯示現任旅長姓名', () => {
    const m = b.gslLockMsg('陳大文');
    assert.ok(m.includes('旅長只能有一位'));
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

// ---------- 【10d】旅長鎖死一位（後端硬鎖 + 顯示姓名 + 換人） ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw' });
  // 升第一位旅長成功
  const make = b.createUserRecord({ name: '陳大文', email: 'gsl1@example.org', role: 'group_leader', password: '1234', can_tick: true }, ADMIN);
  check('開立第一位旅長成功', () => assert.equal(make.success, true));
  check('現任旅長 = 陳大文 (L0001)', () => {
    const cur = b.getActiveGroupLeader();
    assert.ok(cur); assert.equal(cur.name, '陳大文'); assert.ok(/^L\d+$/.test(cur.ymis));
  });
  // 再嘗試開立第二位旅長 → 硬鎖
  const second = b.createUserRecord({ name: '黃志明', email: 'gsl2@example.org', role: 'group_leader', password: '1234', can_tick: true }, ADMIN);
  check('重複開立旅長被拒並顯示現任姓名', () => {
    assert.equal(second.success, false);
    assert.ok(second.error.includes('旅長只能有一位'));
    assert.ok(second.error.includes('陳大文'));
  });
  // updateUserRole 將他人升為旅長亦被鎖
  seedUser(b, { ymis: '2222333344', name: '候選人', email: 'cand@example.org', role: 'branch_leader', pwd: 'pw' });
  const up = jparse(b.handleUpdateUserRole('2222333344', 'group_leader', true, '1111111111'));
  check('updateUserRole 升他人為旅長被鎖並顯示姓名', () => { assert.equal(up.success, false); assert.ok(up.error.includes('陳大文')); });
  // 換人流程：先把現任轉為其他角色，再升新人 → 成功
  const demote = jparse(b.handleUpdateUserRole(make.ymis, 'branch_leader', true, '1111111111'));
  check('先將現任旅長降為幼童軍領袖（解鎖）', () => assert.equal(demote.success, true));
  const promote = jparse(b.handleUpdateUserRole('2222333344', 'group_leader', true, '1111111111'));
  check('解鎖後可升新旅長', () => assert.equal(promote.success, true));
  check('換人後現任旅長為候選人', () => {
    const cur = b.getActiveGroupLeader();
    assert.ok(cur); assert.equal(cur.name, '候選人');
  });
}

// ---------- 用戶管理：一般成員可轉為幼童軍領袖／副團長 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  seedUser(b, { ymis: '1234567890', name: '新領袖', email: 'leader@example.org', role: 'member', pwd: '1234' });
  seedUser(b, { ymis: '1234567891', name: '副隊長', role: 'member', pwd: '1234' });
  const token = b.createToken('1111111111');
  const response = jparse(b.doPost({
    parameter: {},
    postData: { contents: JSON.stringify({
      action: 'updateUserRole', token, target_ymis: '1234567890', new_role: 'branch_leader', can_tick: true
    }) }
  }));
  check('帶 action + session token 的角色更新請求可升級 member 為 branch_leader', () => assert.equal(response.success, true));
  check('升級後用戶清單回報 branch_leader', () => {
    const user = b.getAllUsers().find(u => u.ymis === '1234567890');
    assert.ok(user);
    assert.equal(user.role, 'branch_leader');
    assert.equal(user.can_tick, true);
  });
  const viceCaptain = jparse(b.doPost({ parameter: {}, postData: { contents: JSON.stringify({
    action: 'updateMemberSquadRole', token, target_ymis: '1234567891', squad_role: 'vice_captain'
  }) } }));
  check('登入成員可由 member 改為小隊副隊長（vice_captain）', () => assert.equal(viceCaptain.success, true));
  check('getAllUsers 回傳正式副隊長值，且帳戶角色／進度權限不變', () => {
    const user = b.getAllUsers().find(u => u.ymis === '1234567891');
    assert.ok(user);
    assert.equal(user.squad_role, 'vice_captain');
    assert.equal(user.role, 'member');
    assert.equal(user.can_tick, false);
  });
  const viceCaptainRow=b.__ss.sheets.Users.rows.find(row=>String(row[0])==='1234567891');
  viceCaptainRow[14]='副隊長';
  check('舊資料中的中文副隊長標籤讀取時映射為正式值，不改寫原資料', () => {
    const user=b.getAllUsers().find(u=>u.ymis==='1234567891');
    assert.equal(user.squad_role,'vice_captain');
    assert.equal(viceCaptainRow[14],'副隊長');
  });
  const rejectedAlias=jparse(b.doPost({parameter:{},postData:{contents:JSON.stringify({
    action:'updateMemberSquadRole',token,target_ymis:'1234567891',squad_role:'seconder'
  })}}));
  check('不接受 seconder 作副隊長儲存值',()=>assert.equal(rejectedAlias.success,false));
  const rejectedAccountRole=jparse(b.doPost({parameter:{},postData:{contents:JSON.stringify({
    action:'updateMemberSquadRole',token,target_ymis:'1234567891',squad_role:'branch_leader'
  })}}));
  check('不把帳戶角色 branch_leader 當成小隊副隊長職務',()=>assert.equal(rejectedAccountRole.success,false));
  const sixer=jparse(b.doPost({parameter:{},postData:{contents:JSON.stringify({
    action:'updateMemberSquadRole',token,target_ymis:'1234567891',squad_role:'sixer'
  })}}));
  check('隊長使用正式值 sixer',()=>assert.equal(sixer.success,true));
  check('隊長職務更新後 Users 儲存值為 sixer',()=>{
    const user=b.getAllUsers().find(u=>u.ymis==='1234567891');
    assert.equal(user.squad_role,'sixer');
  });

  const memberRows = b.__ss.sheets['成員名單'].rows;
  memberRows.push(['1234567892','純成員',new Date(),'','', '紅隊']);
  const originalMemberData = memberRows[memberRows.length-1].slice(0,6);
  const pureViceCaptain = jparse(b.doPost({ parameter: {}, postData: { contents: JSON.stringify({
    action: 'updateMemberSquadRole', token, target_ymis: '1234567892', squad_role: 'vice_captain'
  }) } }));
  check('無 Users 帳號的純成員亦可設定小隊副隊長', () => assert.equal(pureViceCaptain.success, true));
  check('純成員職務存入最右新欄，既有成員名單資料不變', () => {
    const row = memberRows.find(r => String(r[0]) === '1234567892');
    assert.deepEqual(row.slice(0,6), originalMemberData);
    assert.equal(memberRows[0][6], 'squad_role');
    assert.equal(row[6], 'vice_captain');
  });
  check('純成員小隊職務更新後可從用戶清單讀回', () => {
    const user = b.getAllUsers().find(u => u.ymis === '1234567892');
    assert.ok(user);
    assert.equal(user.squad_role, 'vice_captain');
  });
  const addedPureMember=jparse(b.doPost({parameter:{},postData:{contents:JSON.stringify({
    action:'addMember',token,ymis:'1234567893',name:'新增純成員',squad:'藍隊',squad_role:'vice_captain'
  })}}));
  check('新增純成員可直接指定正式副隊長值',()=>assert.equal(addedPureMember.success,true));
  check('新純成員職務寫入小隊職務欄並可讀回',()=>{
    const row=memberRows.find(r=>String(r[0])==='1234567893');
    const user=b.getAllUsers().find(u=>u.ymis==='1234567893');
    assert.ok(row&&user);
    assert.equal(row[6],'vice_captain');
    assert.equal(user.squad_role,'vice_captain');
  });
  const legacyUsersRows=b.__ss.sheets.Users.rows;
  const legacySquadRoleColumn=legacyUsersRows[0].indexOf('squad_role');
  legacyUsersRows.forEach(row=>row.splice(legacySquadRoleColumn,1));
  check('舊 Users 表缺少 squad_role 時不會誤讀相鄰欄，預設顯示隊員',()=>{
    const user=b.getAllUsers().find(u=>u.ymis==='1234567891');
    assert.ok(user);
    assert.equal(user.squad_role,'member');
  });
}

// ---------- 【10f】權限收緊：幼童軍領袖只能開 member ----------
{
  const b = buildBackend();
  const BL = { role: 'branch_leader', ymis: 'L0001', name: '幼童軍領袖' };
  const okMem = b.createUserRecord({ ymis: '1234560001', name: '小團員', role: 'member' }, BL);
  check('幼童軍領袖可開立 member', () => assert.equal(okMem.success, true));
  const badGsl = b.createUserRecord({ name: 'G', email: 'g@x.org', role: 'group_leader' }, BL);
  const badAdmin = b.createUserRecord({ name: 'A', email: 'a@x.org', role: 'admin' }, BL);
  const badPeer = b.createUserRecord({ name: 'B', email: 'b@x.org', role: 'branch_leader' }, BL);
  check('幼童軍領袖不可越權開立 group_leader', () => assert.equal(badGsl.success, false));
  check('幼童軍領袖不可越權開立 admin', () => assert.equal(badAdmin.success, false));
  check('幼童軍領袖不可越權開立 branch_leader', () => assert.equal(badPeer.success, false));
}

// ---------- 【10f】批量開戶 + 批量中旅長鎖 + 免 YMIS 領袖 ----------
{
  const b = buildBackend();
  const res = jparse(b.handleBulkAddUsers([
    { ymis: '1234560001', name: '成員一', role: 'member' },
    { ymis: '', name: '領袖一', email: 'lb1@example.org', role: 'branch_leader', password: '1234' },
    { name: '旅長甲', email: 'gA@example.org', role: 'group_leader', password: '1234' },
    { name: '旅長乙', email: 'gB@example.org', role: 'group_leader', password: '1234' },
  ], ADMIN));
  check('批量開戶回傳逐列結果', () => { assert.equal(res.ok, 3); assert.equal(res.skipped, 1); });
  const gA = res.results.find(r => r.name === '旅長甲');
  const gB = res.results.find(r => r.name === '旅長乙');
  check('批量中第一位旅長成功', () => { assert.ok(gA); assert.equal(gA.success, true); });
  check('批量中第二位旅長被鎖並顯示姓名', () => {
    assert.ok(gB); assert.equal(gB.success, false);
    assert.ok(gB.error.includes('旅長甲'));
  });
  // 批量開戶的領袖列留空 YMIS → 有電郵即可
  const l1 = res.results.find(r => r.name === '領袖一');
  check('批量領袖留空 YMIS 成功', () => { assert.ok(l1); assert.equal(l1.success, true); });
  check('批量回傳訊息', () => assert.ok(res.message.includes('3 成功')));
}

// ---------- 【10g】首次登入強制改密：密碼 4-8 位 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1000000001', name: '新成員', email: 'm1@example.org', role: 'member', pwd: '1234', force: true });
  // 4 位新密碼可通過
  const ok4 = jparse(b.handleChangePassword('1000000001', '1234', 'abcd'));
  check('新密碼 4 位可通過', () => assert.equal(ok4.success, true));
  seedUser(b, { ymis: '1000000002', name: '另一員', email: 'm2@example.org', role: 'member', pwd: '1234', force: true });
  const bad3 = jparse(b.handleChangePassword('1000000002', '1234', 'abc'));
  check('新密碼少於 4 位被拒', () => { assert.equal(bad3.success, false); assert.ok(bad3.error.includes('4')); });
  const bad9 = jparse(b.handleChangePassword('1000000002', '1234', 'abcdefghi'));
  check('新密碼超過 8 位被拒（4-8 位規則）', () => { assert.equal(bad9.success, false); assert.ok(bad9.error.includes('8')); });
  const ok8 = jparse(b.handleChangePassword('1000000002', '1234', 'abcdefgh'));
  check('新密碼 8 位可通過（4-8 位規則）', () => assert.equal(ok8.success, true));
  check('passwordRuleError：4-8 位以外一律有錯', () => {
    assert.equal(b.passwordRuleError('abc'), '密碼需 4-8 位');
    assert.equal(b.passwordRuleError('abcdefghi'), '密碼需 4-8 位');
    assert.equal(b.passwordRuleError('abcd'), '');
    assert.equal(b.passwordRuleError('abcdefgh'), '');
  });
  // 登入回傳 force_change_password
  const login = jparse(b.handleLogin('1000000001', 'abcd'));
  check('改密後登入不再強制改密', () => { assert.equal(login.success, true); assert.equal(login.force_change_password, false); });
}

// ---------- 【11a】v5.3.2：YMIS／Email 全表唯一（含已停用帳號） ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  const mk = b.createUserRecord({ ymis: '1234560001', name: '陳小美', email: 'mei@example.org', role: 'member', password: '1234' }, ADMIN);
  check('開戶成功', () => assert.equal(mk.success, true));
  // 模擬停用（status → inactive）
  const rows = b.__ss.sheets.Users.rows;
  rows.find(r => String(r[0]) === '1234560001')[11] = 'inactive';
  const dup1 = b.createUserRecord({ ymis: '1234560001', name: '陳小美（新）', email: 'other@example.org', role: 'member', password: '1234' }, ADMIN);
  check('已停用帳號的 YMIS 不可再開新帳號（提示重新啟用）', () => {
    assert.equal(dup1.success, false);
    assert.ok(dup1.error.includes('重新啟用'));
    assert.ok(dup1.error.includes('YMIS'));
  });
  const dup2 = b.createUserRecord({ ymis: '1234560099', name: '另一位', email: 'mei@example.org', role: 'member', password: '1234' }, ADMIN);
  check('已停用帳號的 Email 不可再開新帳號', () => {
    assert.equal(dup2.success, false);
    assert.ok(dup2.error.includes('Email'));
  });
  check('Users 表不會出現重複 YMIS 列', () => assert.equal(rows.filter(r => String(r[0]) === '1234560001').length, 1));
  // 申請同 YMIS／Email 亦被拒
  const app1 = jparse(b.handleApply('1234560001', '陳小美', 'x@example.org', 'member', 'cub'));
  const app2 = jparse(b.handleApply('1234560098', '陳小美', 'mei@example.org', 'member', 'cub'));
  check('apply 用已停用帳號的 YMIS 被拒', () => { assert.equal(app1.success, false); assert.ok(app1.error.includes('YMIS')); });
  check('apply 用已停用帳號的 Email 被拒', () => { assert.equal(app2.success, false); assert.ok(app2.error.includes('Email')); });
  // 批量開戶同批重複 → 第二列被拒
  const bulk = jparse(b.handleBulkAddUsers([
    { ymis: '1234560077', name: '甲', role: 'member' },
    { ymis: '1234560077', name: '甲重複', role: 'member' },
  ], ADMIN));
  check('批量同批重複 YMIS：1 成功 1 失敗', () => {
    assert.equal(bulk.ok, 1); assert.equal(bulk.skipped, 1);
  });
  // addMember 重複被拒
  const am = jparse(b.handleAddMember('1234560077', '甲', '', 'member'));
  check('addMember 重複 YMIS 被拒', () => { assert.equal(am.success, false); assert.ok(am.error.includes('不可重複')); });
  // 純成員已在成員名單 → addUser 開通帳號成功，成員名單不會重複加入
  jparse(b.handleAddMember('1234560088', '乙純成員', '紅隊', 'member'));
  const upgrade = b.createUserRecord({ ymis: '1234560088', name: '乙純成員', role: 'member', password: '1234' }, ADMIN);
  check('純成員YMIS開通帳號成功（不重複加名單）', () => {
    assert.equal(upgrade.success, true);
    const cnt = b.__ss.sheets['成員名單'].rows.filter(r => String(r[0]) === '1234560088').length;
    assert.equal(cnt, 1);
  });
  const upLogin = jparse(b.handleLogin('1234560088', '1234'));
  check('純成員開通後可登入', () => assert.equal(upLogin.success, true));
}

// ---------- 【11b】v5.3.2：用戶管理不漏成員 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  // status 空白（舊資料）
  const rows = b.__ss.sheets.Users.rows;
  rows.push(['1234560002', '王小迪', '', 'member', sha256Hex('1234'), 'b4', false, 'x', '', '', '', '', '', '', '', '']);
  // 純成員（只在成員名單）
  b.__ss.sheets['成員名單'].rows.push(['1234560003', '李純成員', '', '', '', '紅隊']);
  // 已停用帳號；成員名單仍保留對應列，不應被誤列成純成員
  seedUser(b, { ymis: '1234560004', name: '舊人', email: 'old@example.org', role: 'member', pwd: 'x', status: 'inactive' });
  b.__ss.sheets['成員名單'].rows.push(['1234560004','舊人',new Date(),'','old@example.org','紅隊']);
  const def = b.getAllUsers();
  check('status 空白的成員在 getAllUsers 可見', () => assert.ok(def.some(u => u.ymis === '1234560002')));
  check('純成員合併列出（member_only 標記）', () => {
    const u = def.find(x => x.ymis === '1234560003');
    assert.ok(u); assert.equal(u.member_only, true); assert.equal(u.password_set, false); assert.equal(u.squad, '紅隊');
  });
  check('預設不列出已停用帳號（舊客戶端相容）', () => assert.ok(!def.some(u => u.ymis === '1234560004')));
  const inc = b.getAllUsers(true);
  check('include_inactive=true 列出已停用帳號', () => {
    const u = inc.find(x => x.ymis === '1234560004');
    assert.ok(u); assert.equal(u.status, 'inactive');
  });
  // 空白 status 的成員可改角色／停用（以前完全不能操作）
  const up = jparse(b.handleUpdateUserRole('1234560002', 'member', true, '1111111111'));
  check('空白 status 成員可改權限', () => assert.equal(up.success, true));
  const tok = b.createToken('1111111111');
  const de = jparse(b.handleDeactivateUser({ target_ymis: '1234560002', token: tok }));
  check('空白 status 成員可停用', () => assert.equal(de.success, true));
}

// ---------- 【11c】v5.3.2：領袖設定成員密碼 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  seedUser(b, { ymis: '1234560001', name: '陳小美', email: 'mei@example.org', role: 'member', pwd: 'old', force: false });
  const admin = jparse(b.handleLogin('1111111111', 'pw'));
  const tok = admin.token;
  // 自訂新密碼
  const r1 = jparse(b.handleResetPassword('1234560001', admin.user, 'mei2026'));
  check('領袖可直接設定自訂新密碼', () => { assert.equal(r1.success, true); assert.equal(r1.temp_password, 'mei2026'); });
  const l1 = jparse(b.handleLogin('1234560001', 'mei2026'));
  check('成員可用領袖設定的新密碼登入（強制改密）', () => {
    assert.equal(l1.success, true); assert.equal(l1.force_change_password, true);
  });
  // 留空 → 預設 1234
  const r2 = jparse(b.handleResetPassword('1234560001', admin.user, ''));
  check('留空＝預設 1234', () => { assert.equal(r2.success, true); assert.equal(r2.temp_password, '1234'); });
  // 太短被拒
  const r3 = jparse(b.handleResetPassword('1234560001', admin.user, 'abc'));
  check('新密碼少於 4 位被拒', () => { assert.equal(r3.success, false); assert.ok(r3.error.includes('4')); });
  // 權限：幼童軍領袖不可為 admin 重設
  seedUser(b, { ymis: 'L0009', name: '幼童軍領袖', email: 'bl@example.org', role: 'branch_leader', pwd: 'bl', force: false });
  const bl = jparse(b.handleLogin('bl@example.org', 'bl'));
  const r4 = jparse(b.handleResetPassword('1111111111', bl.user, '1234'));
  check('幼童軍領袖不可為 admin 設定密碼（權限收緊）', () => { assert.equal(r4.success, false); assert.ok(r4.error.includes('權限')); });
  const r4b = jparse(b.handleResetPassword('1234560001', bl.user, 'abcd'));
  check('幼童軍領袖可為 member 設定密碼', () => assert.equal(r4b.success, true));
  // 純成員 → 設定密碼即場開通帳號
  b.__ss.sheets['成員名單'].rows.push(['1234560005', '李純成員', '', '', 'lee@example.org', '']);
  const r5 = jparse(b.handleResetPassword('1234560005', admin.user, 'open2026'));
  check('純成員設定密碼＝即場開通帳號', () => { assert.equal(r5.success, true); assert.equal(r5.temp_password, 'open2026'); });
  const l5 = jparse(b.handleLogin('1234560005', 'open2026'));
  check('開通後可用 YMIS＋新密碼登入', () => { assert.equal(l5.success, true); assert.equal(l5.user.name, '李純成員'); });
  // 舊資料重複列（inactive 在前、active 在後）→ 只寫 active 列
  seedUser(b, { ymis: '1234560006', name: '重複列舊', email: 'dup@example.org', role: 'member', pwd: '9999', status: 'inactive', force: false });
  seedUser(b, { ymis: '1234560006', name: '重複列新', email: 'dup@example.org', role: 'member', pwd: '8888', force: false });
  const r6 = jparse(b.handleResetPassword('1234560006', admin.user, ''));
  check('重複列場景重設成功', () => assert.equal(r6.success, true));
  const dupRows = b.__ss.sheets.Users.rows.filter(r => String(r[0]) === '1234560006');
  const hash1234 = sha256Hex('1234');
  check('密碼寫入 active 列（不是 inactive 列）', () => {
    const inactiveRow = dupRows.find(r => r[11] === 'inactive');
    const activeRow = dupRows.find(r => r[11] === 'active');
    assert.equal(activeRow[4], hash1234);
    assert.notEqual(inactiveRow[4], hash1234);
  });
  // 已停用帳號 → 要求先重新啟用
  seedUser(b, { ymis: '1234560007', name: '停用者', email: 'off@example.org', role: 'member', pwd: 'x', status: 'inactive' });
  const r8 = jparse(b.handleResetPassword('1234560007', admin.user, 'abcd'));
  check('已停用帳號不可直接設密（須先重新啟用）', () => { assert.equal(r8.success, false); assert.ok(r8.error.includes('重新啟用')); });
}

// ---------- 【11d】v5.3.2：重新啟用已停用帳號 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  seedUser(b, { ymis: '1234560001', name: '陳小美', email: 'mei@example.org', role: 'member', pwd: '1234', status: 'inactive' });
  const tok = b.createToken('1111111111');
  // 停用時成員名單已被移除 → 重新啟用會補回
  const re1 = jparse(b.handleReactivateUser({ target_ymis: '1234560001', token: tok }));
  check('重新啟用成功並回傳臨時密碼 1234', () => {
    assert.equal(re1.success, true); assert.equal(re1.temp_password, '1234');
  });
  check('成員名單已補回', () => assert.ok(b.__ss.sheets['成員名單'].rows.some(r => String(r[0]) === '1234560001')));
  const l1 = jparse(b.handleLogin('1234560001', '1234'));
  check('重新啟用後可用 1234 登入（強制改密）', () => {
    assert.equal(l1.success, true); assert.equal(l1.force_change_password, true);
  });
  const re2 = jparse(b.handleReactivateUser({ target_ymis: '1234560001', token: tok }));
  check('已是 active 再啟用 → 拒絕', () => { assert.equal(re2.success, false); });
  // 旅長唯一鎖：已有一位 active 旅長時，不可啟用第二位（inactive 旅長）
  seedUser(b, { ymis: 'L0100', name: '舊旅長', email: 'oldgsl@example.org', role: 'group_leader', pwd: 'x', status: 'inactive' });
  const rGsl = b.createUserRecord({ name: '新旅長', email: 'newgsl@example.org', role: 'group_leader', password: '1234', can_tick: true }, ADMIN);
  assert.equal(rGsl.success, true);
  const re3 = jparse(b.handleReactivateUser({ target_ymis: 'L0100', token: tok }));
  check('重新啟用第二位旅長被鎖（顯示現任姓名）', () => {
    assert.equal(re3.success, false); assert.ok(re3.error.includes('旅長只能有一位')); assert.ok(re3.error.includes('新旅長'));
  });
}

// ---------- 【11e】v5.3.2：修改成員資料／刪除成員 ----------
{
  const b = buildBackend();
  seedUser(b, { ymis: '1111111111', name: '管理員', email: 'admin@example.org', role: 'admin', pwd: 'pw', force: false });
  const mk = b.createUserRecord({ ymis: '1234560001', name: '陳小美', email: 'mei@example.org', role: 'member', password: '1234' }, ADMIN);
  assert.equal(mk.success, true);
  const tok = b.createToken('1111111111');
  const ed = jparse(b.handleUpdateMemberEntry({ target_ymis: '1234560001', name: '陳小美（改名）', squad: '藍隊', token: tok }));
  check('修改姓名／小隊成功', () => assert.equal(ed.success, true));
  const users = b.getAllUsers();
  const u = users.find(x => x.ymis === '1234560001');
  check('Users 及回傳清單已同步新名字／小隊', () => { assert.equal(u.name, '陳小美（改名）'); assert.equal(u.squad, '藍隊'); });
  check('成員名單亦已同步', () => {
    const m = b.__ss.sheets['成員名單'].rows.find(r => String(r[0]) === '1234560001');
    assert.equal(m[1], '陳小美（改名）');
  });
  // 刪除成員（有帳號 → 一併停用）
  const del = jparse(b.handleDeleteMemberEntry({ target_ymis: '1234560001', token: tok }));
  check('刪除成員成功', () => assert.equal(del.success, true));
  check('已移出成員名單', () => assert.ok(!b.__ss.sheets['成員名單'].rows.some(r => String(r[0]) === '1234560001')));
  const rowAfter = b.__ss.sheets.Users.rows.find(r => String(r[0]) === '1234560001');
  check('帳號已停用（Users 列保留作紀錄）', () => assert.equal(rowAfter[11], 'inactive'));
  const reuse = b.createUserRecord({ ymis: '1234560001', name: '新人用同編號', role: 'member', password: '1234' }, ADMIN);
  check('刪除後同一 YMIS 仍不可開新帳號（須重新啟用）', () => { assert.equal(reuse.success, false); assert.ok(reuse.error.includes('重新啟用')); });
  // 純成員（無帳號）刪除 → 只移成員名單
  b.__ss.sheets['成員名單'].rows.push(['1234560009', '純成員乙', '', '', '', '']);
  const del2 = jparse(b.handleDeleteMemberEntry({ target_ymis: '1234560009', token: tok }));
  check('純成員刪除成功', () => assert.equal(del2.success, true));
  check('純成員刪除後可在同 YMIS 重新加入（無帳號紀錄）', () => {
    const again = jparse(b.handleAddMember('1234560009', '純成員乙（回歸）', '', 'member'));
    assert.equal(again.success, true);
  });
}

// ---------- 彙總 ----------
console.log('\n== e2e 結果：' + passed + ' 通過，' + failed + ' 失敗 ==');
if (failed > 0) process.exit(1);
