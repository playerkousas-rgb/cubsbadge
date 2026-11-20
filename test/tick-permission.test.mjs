// 用戶回報回歸測試（GS 2026.11.20）
//
// 回報①「使用領袖帳戶登入後未能更新成員進度紀錄，但權限已設定為可勾選」：
//   - 前端「授權／收回勾選」以前硬送 new_role:'member'，會把領袖帳戶靜靜降為成員；
//   - 後端所有寫入閘門只睇角色，完全忽略 Users 表 can_tick → 個別授權永遠無效。
//
// 回報②「在沒有更改任何密碼前提下未能登入管理員帳號」的可控成因：
//   - 權限編輯（updatePermissions／上游同步）冇帶 new_role 時，role 欄被寫成空白 → 降為成員；
//   - 舊版登入分頁把輸入截短至 10 字，Email 永遠登入失敗（前端回歸見 frontend-render-harness）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackend, sha256Hex } from './mock-gas.mjs';

const json = (response) => JSON.parse(response.getContent());

function seed(b, o) {
  const rows = b.__ss.sheets.Users.rows;
  const row = new Array(16).fill('');
  row[0] = o.ymis;
  row[1] = o.name;
  row[2] = o.email || '';
  row[3] = o.role;
  row[4] = sha256Hex(o.pwd ?? 'pw');
  row[5] = 'b4';
  row[6] = !!o.can_tick;
  row[11] = o.status ?? 'active';
  row[12] = o.allowed_badges ?? (o.role === 'member' ? '' : '*');
  row[13] = '';
  row[14] = 'member';
  row[15] = false;
  rows.push(row);
  return row;
}

function post(b, payload) {
  return json(b.doPost({ postData: { contents: JSON.stringify(payload) } }));
}

function login(b, id, pw) {
  return json(b.handleLogin(id, pw));
}

function userRow(b, ymis) {
  return b.__ss.sheets.Users.rows.find((r) => r[0] === ymis);
}

function seedAdmin(b, extra) {
  seed(b, Object.assign({ ymis: '1111111111', name: '管理員', email: 'admin@example.com', role: 'admin', can_tick: true, pwd: 'changeme', allowed_badges: '*' }, extra || {}));
}

test('帳戶獲個別「授權勾選」後，成員角色亦可更新成員進度', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: '2222222222', name: '家長甲', email: 'parent@example.org', role: 'member', can_tick: true, pwd: '1234' });

  const l = login(b, '2222222222', '1234');
  assert.equal(l.success, true);
  assert.equal(l.user.role, 'member');
  assert.equal(l.user.can_tick, true, '登入回應要帶 can_tick，前端才可以顯示可勾選');

  const saved = post(b, {
    action: 'save',
    token: l.token,
    changes: [{ ymis: '9000000001', itemId: '1.1.1', date: '2026-11-20' }]
  });
  assert.equal(saved.success, true, saved.error);
  assert.equal(saved.processed, 1);
  const rows = b.__ss.sheets['進度追蹤'].rows;
  assert.ok(rows.some((r) => r[0] === '9000000001' && r[1] === '1.1.1' && String(r[2]) === '2026-11-20'));

  // 其他獎章同屬進度寫入，亦要跟同一授權
  const other = post(b, {
    action: 'saveOtherBadge',
    token: l.token,
    records: [{ ymis: '9000000001', badgeId: 'A26', level: 'E', name: '射箭章', date: '2026-11-20' }]
  });
  assert.equal(other.success, true, other.error);
});

test('未獲授權勾選的成員仍然不可寫入進度，錯誤訊息要指向「授權勾選」', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: '3333333333', name: '成員乙', email: 'm@example.org', role: 'member', can_tick: false, pwd: '1234' });
  const l = login(b, '3333333333', '1234');
  const res = post(b, { action: 'save', token: l.token, changes: [{ ymis: '3333333333', itemId: '1.1.1', date: '2026-11-20' }] });
  assert.equal(res.success, false);
  assert.match(res.error, /勾選/);
  assert.equal(b.__ss.sheets['進度追蹤'].rows.length, 1, '被拒的寫入不可留下紀錄');
});

test('領袖角色照常可勾選，授權勾選只是額外開關', () => {
  const b = buildBackend();
  seed(b, { ymis: 'L0001', name: '李領袖', email: 'leader@example.org', role: 'branch_leader', can_tick: false, pwd: '1234' });
  const l = login(b, 'leader@example.org', '1234');
  const res = post(b, { action: 'save', token: l.token, changes: [{ ymis: '9000000002', itemId: '1.1.2', date: '2026-11-20' }] });
  assert.equal(res.success, true, res.error);
});

test('授權／收回勾選（updatePermissions 或上游只送 can_tick）不得改寫或清空角色', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: 'L0002', name: '王領袖', email: 'w@example.org', role: 'branch_leader', can_tick: true, pwd: '1234' });
  const admin = login(b, '1111111111', 'changeme');

  const grant = post(b, { action: 'updatePermissions', token: admin.token, target_ymis: 'L0002', can_tick: true, allowed_badges: '*' });
  assert.equal(grant.success, true, grant.error);
  assert.equal(userRow(b, 'L0002')[3], 'branch_leader', '冇帶 new_role 時必須保留原本角色');

  const revoke = post(b, { action: 'updateUserRole', token: admin.token, target_ymis: 'L0002', can_tick: false });
  assert.equal(revoke.success, true, revoke.error);
  assert.equal(userRow(b, 'L0002')[3], 'branch_leader', '收回勾選不可把領袖降為成員');
  assert.equal(userRow(b, 'L0002')[6], false);

  // 明確改角色仍然有效（管理員可把領袖降為成員，屬正常操作）
  const demote = post(b, { action: 'updateUserRole', token: admin.token, target_ymis: 'L0002', new_role: 'member', can_tick: false });
  assert.equal(demote.success, true, demote.error);
  assert.equal(userRow(b, 'L0002')[3], 'member');
});

test('無效角色會被拒絕，不會把 role 欄寫成空白', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: 'L0003', name: '陳領袖', email: 'c@example.org', role: 'admin', can_tick: true, pwd: '1234' });
  const admin = login(b, '1111111111', 'changeme');
  const bad = post(b, { action: 'updateUserRole', token: admin.token, target_ymis: 'L0003', new_role: 'super_user' });
  assert.equal(bad.success, false);
  assert.equal(userRow(b, 'L0003')[3], 'admin');
  assert.equal(userRow(b, 'L0003')[6], true, '被拒的請求不可改動 can_tick');
});

test('load 回傳登入者最新權限（me），管理員改完即時生效、毋須重新登入', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: '4444444444', name: '家長丙', role: 'member', can_tick: false, pwd: '1234' });
  const l = login(b, '4444444444', '1234');
  const before = json(b.doGet({ parameter: { action: 'load', token: l.token } }));
  assert.equal(before.success, true);
  assert.equal(before.me.ymis, '4444444444');
  assert.equal(before.me.role, 'member');
  assert.equal(before.me.can_tick, false);

  const admin = login(b, '1111111111', 'changeme');
  const grant = post(b, { action: 'updateUserRole', token: admin.token, target_ymis: '4444444444', new_role: 'member', can_tick: true });
  assert.equal(grant.success, true, grant.error);

  const after = json(b.doGet({ parameter: { action: 'load', token: l.token } }));
  assert.equal(after.me.can_tick, true);
  assert.equal(post(b, { action: 'save', token: l.token, changes: [{ ymis: '4444444444', itemId: '1.1.1', date: '2026-11-20' }] }).success, true);
});

test('獲授權勾選的成員不會因此取得審批／用戶管理／活動履歷編輯權限', () => {
  const b = buildBackend();
  seedAdmin(b);
  seed(b, { ymis: '5555555555', name: '家長丁', email: 'd@example.org', role: 'member', can_tick: true, pwd: '1234' });
  const l = login(b, '5555555555', '1234');

  assert.equal(post(b, { action: 'getAllUsers', token: l.token }).success, false);
  assert.equal(post(b, { action: 'updateUserRole', token: l.token, target_ymis: '5555555555', new_role: 'admin' }).success, false);
  assert.equal(post(b, { action: 'saveLogRecord', token: l.token, records: [{ ymis: '5555555555', type: 'service', title: '服務', date: '2026-11-20' }] }).success, false);
  // 但可以為自己申報活動履歷（原有成員功能）
  const claim = post(b, { action: 'requestLogRecord', token: l.token, kind: 'new', record: { type: 'service', ymis: '5555555555', name: '家長丁', title: '賣旗', date: '2026-11-20', hours: '2' } });
  assert.equal(claim.success, true, claim.error);
});

test('內部 L 編號登入不分大小寫（l0004 亦搵到 L0004）', () => {
  const b = buildBackend();
  seed(b, { ymis: 'L0004', name: '何領袖', email: 'ho@example.org', role: 'branch_leader', can_tick: true, pwd: '1234' });
  assert.equal(login(b, 'L0004', '1234').success, true);
  assert.equal(login(b, 'l0004', '1234').success, true);
  assert.equal(login(b, 'l0004', 'wrong').success, false);
});
