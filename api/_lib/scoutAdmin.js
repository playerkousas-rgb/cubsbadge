// api/_lib/scoutAdmin.js — Scout Admin GS（中央管理員收件匣）共用契約
//
// 單一來源，/api/register（submitRegistration／新旅團接入申請）同
// /api/proxy 嘅 submitFeedback 共用，唔好再各自寫一條常數 URL：
//   1. 收件匣 URL 只由伺服器端環境變數決定（永不接受請求自帶 URL — SSRF 防線）；
//      四個歷史／姊妹系統名稱全部相容，動態讀取 + trim，未設先用內建預設 /exec。
//   2. 接入申請 payload 對齊 Scout Admin GS：type:"apply" + appType + backendUrl
//      （GS FIELD_MAP["URL"] 只認 backendUrl／url，唔認 scriptUrl）。
//   3. Scout Admin「🏛️ 旅團登記」卡片只印 備注(note)、且 troopName 空白會略過唔顯示，
//      所以出發前要自動加 note 系統標記同補 troopName 預設值。
//   4. 上游成功判斷：HTTP 2xx + {status:"success"}（或舊式 {success:true}）。

const { normalizeGasUrl } = require('./registry');

const DEFAULT_SCOUT_ADMIN_API_URL =
  'https://script.google.com/macros/s/AKfycbxj5BDDGgjs559smkK4Z5aYImWYeXbN5af8U1ObON0z9WnsN6QJW4I1XWolhs5kQ_H-UQ/exec';

// 本系統識別（Scout Admin 對接契約用 repo 名 cubsbadge；
// 前端歷史送嘅 appType:'cubbadge' 會喺伺服器端被呢個固定值取代）。
const APP_TYPE = 'cubsbadge';

// 中央管理員收件匣 URL：每次呼叫即時讀 env（唔好喺 module load 時寫死），
// 相容 APP ADMIN 喺 Vercel 用緊嘅 SCOUTBADGE_ADMIN_API 等全部名稱；
// 純空白視為未設，順序 fallback 後用內建預設。
function getScoutAdminApiUrl(env) {
  const e = env || process.env;
  return String(e.SCOUT_ADMIN_API || '').trim() ||
    String(e.ROVERBADGE_ADMIN_API || '').trim() ||
    String(e.CUBSBADGE_ADMIN_API || '').trim() ||
    String(e.SCOUTBADGE_ADMIN_API || '').trim() ||
    DEFAULT_SCOUT_ADMIN_API_URL;
}

// Scout Admin 卡片未印出 appType，要靠 note 標記分清邊個 APP 寄出：
// 有備註 → "[cubsbadge] 原備註"；無備註 → "[cubsbadge]"；已有前綴唔重複加。
function withAppNote(note, appType) {
  const tag = `[${appType || APP_TYPE}]`;
  const text = String(note || '').trim();
  if (!text) return tag;
  if (text.toLowerCase().startsWith(tag.toLowerCase())) return text;
  return `${tag} ${text}`;
}

// Scout Admin 卡片遇空白 troopName 會 if (!troopName) return; 略過唔顯示，
// 所以空名要喺伺服器端補預設值，確保看板必定顯示。
function resolveTroopName(troopName, troopId) {
  const name = String(troopName || '').trim();
  return name || `第 ${String(troopId || '').trim()} 旅`;
}

// 前端請求格式不變（繼續送 scriptUrl）；伺服器端映射成 Scout Admin 認嘅欄位。
// allowlist 逐欄砌 payload：scriptUrl／superKey／super_key 一律唔會帶過去
// （SUPER_KEY 只存在 Vercel，絕不可放入送往 Google Sheet／Email 嘅 JSON）。
function buildApplyPayload(body) {
  const data = body || {};
  const troopId = String(data.troopId || '').trim();
  // FIELD_MAP["URL"] = ["backendUrl", "url"]：只送 backendUrl，唔再送 scriptUrl。
  // Workspace 網域內網址（/a/<domain>/macros/s/…/exec）自動轉公開網址，管理員抄去登記先打得通。
  const backendUrl = normalizeGasUrl(String(data.backendUrl || data.scriptUrl || '').trim());
  const apiKey = String(data.apiKey || '').trim();
  return {
    type: 'apply',
    appType: APP_TYPE,
    troopId,
    troopName: resolveTroopName(data.troopName, troopId),
    backendUrl,
    apiKey,
    note: withAppNote(data.note, APP_TYPE)
  };
}

// Scout Admin GS 成功回 {status:"success"}，舊部署回 {success:true}；
// 兩者都要 HTTP 2xx 先算成功（切勿只判「係咪 JSON」）。
function isScoutAdminSuccess(httpStatus, result) {
  const ok2xx = Number(httpStatus) >= 200 && Number(httpStatus) < 300;
  return !!(ok2xx && result && (result.status === 'success' || result.success === true));
}

module.exports = {
  APP_TYPE,
  DEFAULT_SCOUT_ADMIN_API_URL,
  getScoutAdminApiUrl,
  withAppNote,
  resolveTroopName,
  buildApplyPayload,
  isScoutAdminSuccess
};
