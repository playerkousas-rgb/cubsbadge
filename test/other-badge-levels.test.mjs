// 活動徽章級別（初／中／高）＋ A09-* 分流回歸測試 —— 對應 CUBBOOK v1.2.5 交接文件第④⑤節。
// 用 mock-gas 直接跑 apps-script/Code.gs，驗證真實 handler 行為（不是只比對原始碼字串）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBackend } from './mock-gas.mjs';

const json = res => JSON.parse(res.getContent());
const YMIS = '9000000001';
const LEADER = 'LEADER1';

function fresh() {
  const b = buildBackend();
  b.initializeSheets();
  return b;
}
const rows = (b, name) => b.__ss.getSheetByName(name).getDataRange().getValues();
const dataRows = (b, name) => rows(b, name).slice(1).filter(r => String(r[0] || '').trim());
const otherRows = (b, ymis) => dataRows(b, '其他獎章').filter(r => String(r[0]) === ymis);

function submit(b, itemId, name, level, date) {
  const body = { itemId, itemName: name, requested_date: date };
  if (level) body.level = level;
  return json(b.handleRequestComplete(body, YMIS));
}
function approve(b, requestId, date) {
  return json(b.handleReviewRequest(requestId, 'approved', '', LEADER, date));
}
function load(b) {
  return json(b.handleLoad(null));
}

test('活動徽章判斷：A01–A42、A09-* 六枚、A25-* 三枚全部認得（共 49 個官方編號）', () => {
  const b = fresh();
  const ids = ['A01', 'A09-ANTI-DECEPTION', 'A09-ANTI-DRUG', 'A09-CHILD-PROTECTION',
    'A09-COMMUNITY-EMERGENCY', 'A09-GREEN-PIONEER', 'A09-EM-PIONEER',
    'A18', 'A25-PLASTIC', 'A25-NATURE', 'A25-SOLAR', 'A26', 'A39', 'A42'];
  for (const id of ids) assert.equal(b.isActivityBadgeId_(id), true, `${id} 必須視為活動徽章`);
  for (const id of ['1.1.1', '2.3.4', 'P2-A', 'REQ_1', '', 'A1', 'ACT-07', 'M1']) {
    assert.equal(b.isActivityBadgeId_(id), false, `${id} 不是活動徽章編號`);
  }
});

test('6 枚 A09-* 批准後寫入「其他獎章」，不會再消失於「進度追蹤」', () => {
  const b = fresh();
  const ids = ['A09-ANTI-DECEPTION', 'A09-ANTI-DRUG', 'A09-CHILD-PROTECTION',
    'A09-COMMUNITY-EMERGENCY', 'A09-GREEN-PIONEER', 'A09-EM-PIONEER'];
  ids.forEach((id, i) => {
    const req = submit(b, id, '測試章' + i, '', '2024-03-0' + (i + 1));
    const res = approve(b, req.request_id, '2024-03-0' + (i + 1));
    assert.equal(res.target, '其他獎章', `${id} 應分流到其他獎章`);
  });
  assert.deepEqual(dataRows(b, '進度追蹤'), [], '進度追蹤不可出現活動徽章');
  const stored = otherRows(b, YMIS).map(r => String(r[1])).sort();
  assert.deepEqual(stored, [...ids].sort());
});

test('A26 初級、中級是兩次獨立送交：兩列、級別 E／I、日期各自正確', () => {
  const b = fresh();
  const e = submit(b, 'A26', '射箭章（初級）', 'E', '2024-03-01');
  const i = submit(b, 'A26', '射箭章（中級）', 'I', '2024-05-01');
  assert.notEqual(e.request_id, i.request_id, '不同級別必須是兩張獨立申請');
  assert.equal(e.duplicate, false);
  assert.equal(i.duplicate, false);
  assert.equal(dataRows(b, '待批完成').length, 2);
  approve(b, e.request_id, '2024-03-01');
  approve(b, i.request_id, '2024-05-01');
  const stored = otherRows(b, YMIS).filter(r => String(r[1]) === 'A26').sort((a, c) => String(a[7]).localeCompare(String(c[7])));
  assert.equal(stored.length, 2, '兩級各一列，不可互相覆蓋');
  assert.deepEqual(stored.map(r => String(r[7])), ['E', 'I']);
  assert.deepEqual(stored.map(r => String(r[3])), ['2024-03-01', '2024-05-01']);
});

test('重複送交同一 (ymis, A26, E) 回 duplicate:true 且待批只有一列', () => {
  const b = fresh();
  const first = submit(b, 'A26', '射箭章（初級）', 'E', '2024-03-01');
  const again = submit(b, 'A26', '射箭章（初級）', 'E', '2024-03-01');
  assert.equal(again.success, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.request_id, first.request_id);
  assert.equal(dataRows(b, '待批完成').length, 1);
  const pending = json(b.handleGetPendingRequests());
  assert.equal(pending.requests.length, 1);
  assert.equal(pending.requests[0].level, 'E', '待批清單要帶級別');
});

test('已核實的一級再送交不會重開待批（BOOK 拉回後不會重複出現）', () => {
  const b = fresh();
  const req = submit(b, 'A26', '射箭章（初級）', 'E', '2024-03-01');
  approve(b, req.request_id, '2024-03-01');
  assert.equal(json(b.handleGetPendingRequests()).requests.length, 0);
  const resubmit = submit(b, 'A26', '射箭章（初級）', 'E', '2024-03-01');
  assert.equal(resubmit.success, true);
  assert.equal(resubmit.duplicate, true);
  assert.equal(resubmit.already_verified, true);
  assert.equal(dataRows(b, '待批完成').length, 1, '不可多一張待批');
  // 另一級仍然可以正常送交
  const mid = submit(b, 'A26', '射箭章（中級）', 'I', '2024-05-01');
  assert.equal(mid.duplicate, false);
});

test('load／getOtherBadges 回傳後綴鍵（A26-E）並附級別；舊列仍用 A26', () => {
  const b = fresh();
  for (const [lv, name, date] of [['E', '射箭章（初級）', '2024-03-01'], ['I', '射箭章（中級）', '2024-05-01']]) {
    const req = submit(b, 'A26', name, lv, date);
    approve(b, req.request_id, date);
  }
  b.handleSaveOtherBadge([{ ymis: YMIS, badgeId: 'A12', name: '藝術章', date: '2024-01-01', cert: 'C1' }]);
  const map = load(b).otherBadges[YMIS];
  assert.equal(map['A26-E'].date, '2024-03-01');
  assert.equal(map['A26-E'].level, 'E');
  assert.equal(map['A26-I'].date, '2024-05-01');
  assert.equal(map['A26-I'].level, 'I');
  assert.ok(!map['A26'], '多級時不可再回單一 A26 鍵（會覆蓋）');
  assert.equal(map['A12'].date, '2024-01-01', '無級別舊寫法照舊用 A12 鍵');
  assert.equal(map['A12'].cert, 'C1');

  const one = json(b.handleGetOtherBadges(YMIS));
  const a26 = one.other.filter(r => r.id === 'A26');
  assert.deepEqual(a26.map(r => r.level).sort(), ['E', 'I']);
  assert.deepEqual(a26.map(r => r.key).sort(), ['A26-E', 'A26-I']);
  assert.equal(one.otherBadges[YMIS]['A26-I'].date, '2024-05-01', 'getOtherBadges 亦帶同一對照表');
});

test('舊資料（無級別）照舊：讀得到、可更新、不報錯；有 [CUB_LEVEL=n] 的舊列原地升級', () => {
  const b = fresh();
  b.__ss.getSheetByName('其他獎章').rows.push([YMIS, 'A18', '音樂章', '2023-01-01', 'OLD-CERT', '[CUB_LEVEL=2] 舊備註', '2023-01-02']);
  const map = load(b).otherBadges[YMIS];
  assert.equal(map['A18'].date, '2023-01-01');
  assert.equal(map['A18'].level, undefined, '舊列不應憑空多出級別');

  // 使用者為同一級別改日期 → 沿用舊列（升級為 I），不會多出一列
  const saved = json(b.handleSaveOtherBadge([{ ymis: YMIS, badgeId: 'A18', level: 'I', name: '音樂章', date: '2024-02-02', cert: 'OLD-CERT' }]));
  assert.equal(saved.success, true);
  const stored = otherRows(b, YMIS);
  assert.equal(stored.length, 1, '舊列升級，不重複');
  assert.equal(String(stored[0][7]), 'I');
  assert.equal(String(stored[0][3]), '2024-02-02');

  // 再記錄另一級 → 新一列，舊列不受影響
  json(b.handleSaveOtherBadge([{ ymis: YMIS, badgeId: 'A18', level: 'A', name: '音樂章', date: '2025-03-03' }]));
  assert.equal(otherRows(b, YMIS).length, 2);
  const after = load(b).otherBadges[YMIS];
  assert.equal(after['A18-I'].date, '2024-02-02');
  assert.equal(after['A18-A'].date, '2025-03-03');
});

test('取消完成只刪除該級別，其他級別保留', () => {
  const b = fresh();
  b.handleSaveOtherBadge([
    { ymis: YMIS, badgeId: 'A39', level: 'E', name: '游泳章', date: '2024-01-01' },
    { ymis: YMIS, badgeId: 'A39', level: 'I', name: '游泳章', date: '2024-02-01' }
  ]);
  assert.equal(otherRows(b, YMIS).length, 2);
  b.handleSaveOtherBadge([{ ymis: YMIS, badgeId: 'A39', level: 'E', uncomplete: true }]);
  const left = otherRows(b, YMIS);
  assert.equal(left.length, 1);
  assert.equal(String(left[0][7]), 'I');
});

test('進度表安全網：活動徽章編號經 handleSave 亦轉寫「其他獎章」', () => {
  const b = fresh();
  json(b.handleSave([{ ymis: YMIS, itemId: 'A26-E', date: '2024-03-01', confirmer: LEADER }], LEADER));
  json(b.handleSave([{ ymis: YMIS, itemId: '1.1.1', date: '2024-03-02', confirmer: LEADER }], LEADER));
  const progress = dataRows(b, '進度追蹤').map(r => String(r[1]));
  assert.deepEqual(progress, ['1.1.1'], 'A26-E 不可寫入進度追蹤');
  const other = otherRows(b, YMIS);
  assert.equal(other.length, 1);
  assert.equal(String(other[0][1]), 'A26');
  assert.equal(String(other[0][7]), 'E');
  assert.equal(String(other[0][3]), '2024-03-01');
});

test('級別輸入兼容 E/I/A、1/2/3 與中文，並拒絕無效值', () => {
  const b = fresh();
  assert.equal(b.normalizeLevel_('E'), 'E');
  assert.equal(b.normalizeLevel_('i'), 'I');
  assert.equal(b.normalizeLevel_(1), 'E');
  assert.equal(b.normalizeLevel_(3), 'A');
  assert.equal(b.normalizeLevel_('初級'), 'E');
  assert.equal(b.normalizeLevel_('中級'), 'I');
  assert.equal(b.normalizeLevel_('高級'), 'A');
  assert.equal(b.normalizeLevel_(''), '');
  assert.equal(b.normalizeLevel_('Z'), '');
  // 注意：vm sandbox 內的物件與測試 realm 不同 prototype，逐個欄位比較
  const split26 = b.splitBadgeIdLevel_('A26-E', '');
  assert.equal(split26.id, 'A26');
  assert.equal(split26.level, 'E');
  const splitA09 = b.splitBadgeIdLevel_('A09-EM-PIONEER', '');
  assert.equal(splitA09.id, 'A09-EM-PIONEER', 'A09-* 不可被誤拆');
  assert.equal(splitA09.level, '');
});
