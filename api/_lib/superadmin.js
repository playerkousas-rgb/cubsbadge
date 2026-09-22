// api/_lib/superadmin.js — 超管（隱藏維護帳戶）密碼閘口
//
// 死規矩：超管密碼（SUPER_KEY）只存在 **Vercel 功能變數**，leaf GS 完全冇。
// 呢個檔淨係做一件事：將前端送嚟嘅密碼同 process.env.SUPER_KEY 比對（timing-safe）。
// 對咗之後，proxy 會改用 action=superLogin 落 leaf，apikey 由 registry 注入
// （同其他 server-to-server 請求一模一樣）→ leaf 發超管 token。
//
// 紅線：密碼／SUPER_KEY 值永不入 response、永不入 URL、永不入 log、永不轉發去 GS。

const { getSuperKey, verifySuperKey } = require('./registry');

// 只認超管帳號寫法（server-side，唔會回傳出去）
const SUPER_ADMIN_IDS = ['sheep', 'sheep@cubbadge.local'];
const GENERIC_FAIL = '帳號或密碼錯誤';

// 失敗限流（同一 instance、15 分鐘 20 次）：擋暴力嘗試，唔阻 APP ADMIN 正常登入
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 20;
const _fails = new Map();

function isSuperAdminLoginId(id) {
  return SUPER_ADMIN_IDS.indexOf(String(id || '').trim().toLowerCase()) >= 0;
}

/** 驗超管密碼。@returns {{ok:boolean, status?:number, body?:object}} */
function verifySuperAdminLogin({ loginId, password, clientKey }) {
  const login = String(loginId || '').trim().toLowerCase();
  if (!isSuperAdminLoginId(login)) return { ok: false, status: 200, body: { success: false, error: GENERIC_FAIL } };

  const rateKey = String(clientKey || 'anon');
  const rec = _fails.get(rateKey);
  if (rec && Date.now() - rec.first < FAIL_WINDOW_MS && rec.count >= FAIL_MAX) {
    return { ok: false, status: 200, body: { success: false, error: GENERIC_FAIL } };
  }

  // 未設定 SUPER_KEY = 超管入口完全關閉（冇後備密碼）
  if (!getSuperKey()) {
    recordFailure(rateKey);
    console.error('[superadmin] refuse: SUPER_KEY not set in Vercel env');
    return { ok: false, status: 200, body: { success: false, error: GENERIC_FAIL } };
  }
  if (!verifySuperKey(String(password || ''))) {
    recordFailure(rateKey);
    console.error('[superadmin] reject: bad password');
    return { ok: false, status: 200, body: { success: false, error: GENERIC_FAIL } };
  }

  _fails.delete(rateKey);
  return { ok: true };
}

function recordFailure(key) {
  const rec = _fails.get(key);
  if (!rec || Date.now() - rec.first >= FAIL_WINDOW_MS) _fails.set(key, { first: Date.now(), count: 1 });
  else rec.count += 1;
}

module.exports = { isSuperAdminLoginId, verifySuperAdminLogin };
