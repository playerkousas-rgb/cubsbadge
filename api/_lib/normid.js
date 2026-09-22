// ============================================================
// normId — BUILD.md §1 唯一實現（single implementation）
// 「ID 正規化 normId 單一實現 (82/082/0082/00082 = 同一單位):
//   trim→大寫→數字補零至4位+字母尾」
//
// 這個檔案是 normId 的唯一真理。api/*、apps-script/Code.gs（EC_NORMID 區段）
// 與前端 index.html（window.ECNorm）必須行同一套規則，任何地方都不可以另外寫一份。
// ============================================================

/**
 * normId: 單位 ID 正規化。
 *   '82'    → '0082'
 *   '082'   → '0082'
 *   '0082'  → '0082'
 *   '00082' → '0082'（超過 4 位時，去掉前導零後再補回 4 位）
 *   '82r'   → '0082R'
 *   'ops'   → 'OPS'（非數字前綴原樣大寫，供 TROOP_OPS / FIN 等 leaf 使用）
 */
function normId(id) {
  if (id === undefined || id === null) return '';
  const s = String(id).trim().toUpperCase();
  if (!s) return '';
  const m = s.match(/^0*(\d+)([A-Z]*)$/);
  if (!m) return s;
  const digits = m[1];
  const suffix = m[2] || '';
  return digits.padStart(4, '0') + suffix;
}

/** 同一單位？82 / 082 / 0082 / 00082 全部 true。 */
function sameUnit(a, b) {
  const na = normId(a);
  const nb = normId(b);
  return !!na && na === nb;
}

/**
 * 去零寫法（向下兼容舊環境變數 TROOP_82_BACKEND 一類鍵名）。
 *   '0082' → '82'，'0082R' → '82R'
 */
function strippedId(id) {
  const n = normId(id);
  if (!n) return '';
  const m = n.match(/^0*(\d+)([A-Z]*)$/);
  if (!m) return n;
  return m[1].replace(/^0+(?=\d)/, '') + (m[2] || '');
}

/** 一個單位 ID 的所有合法寫法（查 registry / env 時逐個試）。 */
function idVariants(id) {
  const raw = String(id === undefined || id === null ? '' : id).trim();
  const out = [];
  const push = (v) => { if (v && out.indexOf(v) < 0) out.push(v); };
  push(raw);
  push(raw.toUpperCase());
  push(raw.toLowerCase());
  push(normId(raw));
  push(strippedId(raw));
  return out;
}

/** 單位 ID 是否合法（防止被當成路徑／環境變數注入）。 */
function isValidUnitId(id) {
  const n = normId(id);
  return /^[0-9A-Z]{1,16}$/.test(n);
}

module.exports = { normId, sameUnit, strippedId, idVariants, isValidUnitId };
