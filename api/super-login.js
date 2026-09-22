// ============================================================
// api/super-login.js — 隱藏超管（APP ADMIN）登入閘口 v5.8
//
// 契約（v5.8 定版）：
//   超管密碼 = Vercel 功能變數 SUPER_KEY，只存在 APP ADMIN 嘅 Vercel Project。
//   leaf GS **永不持有、永不讀取、永不寫入、永不顯示** SUPER_KEY ——
//   之前 v5.7 寫「密碼 = GS Script Property SUPER_KEY」係錯嘅：
//   旅團開 GS → ⚙ 專案設定 → 指令碼屬性就睇到超管密碼。v5.8 已封。
//
// 流程：
//   前端照舊 POST /api/proxy {action:'login', login_id:'sheep', password}
//     → proxy 見到超管帳號就轉入呢個 handler（密碼唔會離開 Vercel，唔會落 GS）
//     → 用 SUPER_KEY 做 timing-safe 比對
//     → 用該旅團 apikey（TROOP_<id>_APIKEY）簽一張 10 分鐘 sig
//     → 轉發 action=superLogin（payload + sig，**冇密碼**）俾 leaf GS
//     → GS 用自己 getApiKey() 驗簽 → 發超管 token（虛擬帳號，不寫 Users 表）
//
// 紅線：
//   - 密碼／SUPER_KEY 值：永不入 response、永不入 URL、永不入 log
//   - 未設定 SUPER_KEY = 超管入口完全關閉（冇任何後備密碼、冇預設值）
//   - 失敗一律回同一句通用訊息（唔會透露隱藏帳戶存在、唔會透露設定狀態）
// ============================================================

const { getTroopConfig, getSuperKey, verifySuperKey } = require('./_lib/registry');
const { signSig } = require('./_lib/sig');
const { normId } = require('./_lib/normid');

// 只認超管帳號（server-side；唔會回傳出去）。email 寫法 = Code.gs 內部電郵。
const SUPER_ADMIN_IDS = ['sheep', 'sheep@cubbadge.local'];
const SIG_TTL_SEC = 10 * 60;          // 短效：簽完即用，10 分鐘自動失效
const TIMEOUT_MS = 15000;
// 通用訊息：帳號唔存在、密碼錯、未設定 SUPER_KEY 都回同一句，避免成為 oracle。
const GENERIC_FAIL = '帳號或密碼錯誤';

// 輕量失敗限流（同一個 serverless instance 內）：擋暴力嘗試，唔阻 APP ADMIN 正常登入。
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const FAIL_MAX = 20;
const _fails = new Map();
function tooManyFailures(key) {
  const rec = _fails.get(key);
  if (!rec) return false;
  if (Date.now() - rec.first > FAIL_WINDOW_MS) { _fails.delete(key); return false; }
  return rec.count >= FAIL_MAX;
}
function noteFailure(key) {
  const rec = _fails.get(key);
  if (!rec || Date.now() - rec.first > FAIL_WINDOW_MS) _fails.set(key, { first: Date.now(), count: 1 });
  else rec.count += 1;
}
function clearFailures(key) { _fails.delete(key); }

/** 係唔係超管帳號寫法（server-side 判斷，唔會回傳出去）。 */
function isSuperAdminLoginId(id) {
  return SUPER_ADMIN_IDS.indexOf(String(id || '').trim().toLowerCase()) >= 0;
}

/**
 * 核心：驗超管密碼（Vercel 功能變數）→ 簽 sig → 轉發 leaf GS 換 token。
 * @returns {Promise<{status:number, body:object}>}
 */
async function handleSuperLogin({ troopId, loginId, password, clientKey }) {
  const login = String(loginId || '').trim().toLowerCase();
  if (!isSuperAdminLoginId(login)) {
    // 非超管帳號唔應該行到呢度；回通用訊息，唔會講「呢個 handler 認邊個帳號」。
    return { status: 200, body: { success: false, error: GENERIC_FAIL } };
  }

  const rateKey = String(clientKey || 'anon') + '|' + normId(troopId);
  if (tooManyFailures(rateKey)) {
    return { status: 200, body: { success: false, error: GENERIC_FAIL, code: 'TOO_MANY_ATTEMPTS' } };
  }

  // 1) SUPER_KEY 只喺呢度讀（Vercel 功能變數）；未設定 = 超管入口完全關閉。
  if (!getSuperKey()) {
    noteFailure(rateKey);
    console.error('[super-login] refuse: SUPER_KEY not configured (APP ADMIN must set it in Vercel env)');
    return {
      status: 200,
      body: {
        success: false,
        error: GENERIC_FAIL,
        hint: 'APP ADMIN：Vercel 功能變數 SUPER_KEY 未設定，維護帳戶入口已關閉（GS 永不需要、亦唔應該持有 SUPER_KEY）。'
      }
    };
  }

  // 2) timing-safe 比對（值永不回傳、永不入 log）
  if (!verifySuperKey(String(password || ''))) {
    noteFailure(rateKey);
    console.error('[super-login] reject: bad password');
    return { status: 200, body: { success: false, error: GENERIC_FAIL } };
  }
  clearFailures(rateKey);

  // 3) 旅團登記（後端 GS /exec URL + apikey）：apikey 係 leaf 驗 sig 嘅鑰匙。
  const unit = normId(troopId);
  const cfg = getTroopConfig(unit);
  if (!cfg) {
    return {
      status: 404,
      body: {
        success: false,
        error: `Unregistered or invalid troop ID: ${troopId}`,
        hint: `APP ADMIN 喺 Vercel 設定 TROOP_${unit}_BACKEND / TROOP_${unit}_APIKEY / TROOP_${unit}_NAME，然後 Redeploy。`
      }
    };
  }
  if (!cfg.apikey) {
    return {
      status: 503,
      body: {
        success: false,
        error: `維護帳戶登入未啟用：此旅團未設定 TROOP_${unit}_APIKEY`,
        hint: '超管登入靠該旅團 apikey 簽 sig（leaf 用自己 key 驗簽），所以要先設定 TROOP_<id>_APIKEY。'
      }
    };
  }

  // 4) 簽 sig（HMAC-SHA256(旅團 apikey, canonical)）—— 密碼唔會出現喺簽名內容。
  let signed;
  try {
    signed = signSig(cfg.apikey, {
      childId: unit,
      sub: 'sheep',
      role: 'super_admin',
      children: [],
      target: 'progress',
      ttlSec: SIG_TTL_SEC
    });
  } catch (err) {
    console.error('[super-login] sign failed:', String(err && err.message).slice(0, 120));
    return { status: 500, body: { success: false, error: '維護帳戶登入簽名失敗' } };
  }

  // 5) 轉發 leaf GS：只送 payload + sig（無密碼、無 apikey）。
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let upstreamText = '';
  let upstreamStatus = 0;
  try {
    const resp = await fetch(cfg.backend, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'Content-Type': 'text/plain;charset=utf-8', 'User-Agent': 'cubbadge-super-login/1.0' },
      body: JSON.stringify({ action: 'superLogin', payload: signed.payload, sig: signed.sig })
    });
    upstreamStatus = resp.status;
    upstreamText = await resp.text();
  } catch (err) {
    clearTimeout(timer);
    const aborted = err && err.name === 'AbortError';
    console.error('[super-login] upstream', aborted ? 'timeout' : String(err && err.message).slice(0, 120));
    return {
      status: aborted ? 504 : 502,
      body: {
        success: false,
        error: aborted
          ? '維護帳戶登入逾時（後端 Apps Script 無回應）'
          : '維護帳戶登入失敗：連唔到旅團後端 GS'
      }
    };
  }
  clearTimeout(timer);

  let json = null;
  try { json = JSON.parse(upstreamText); } catch (e) { json = null; }
  if (!json) {
    console.error(`[super-login] upstream non-JSON (status=${upstreamStatus})`);
    return {
      status: 502,
      body: {
        success: false,
        error: '維護帳戶登入失敗：後端回應唔係 JSON',
        hint: `請確認 TROOP_${unit}_BACKEND 係 /exec URL、部署為「任何人可存取」，且 Code.gs 已更新到 v5.8（支援 action=superLogin）。`
      }
    };
  }
  if (json.success !== true) {
    // GS 側拒絕（例如未升級到 v5.8、sig 驗唔過）——原句轉回，但只限非敏感欄位。
    console.error(`[super-login] leaf refused: ${String(json.error || '').slice(0, 120)}`);
    return {
      status: 200,
      body: {
        success: false,
        error: json.error || GENERIC_FAIL,
        hint: /Unknown action/i.test(String(json.error || ''))
          ? '旅團後端 Code.gs 未升級到 v5.8（未支援 action=superLogin），請旅團重新貼上最新 Code.gs 並部署新版本。'
          : undefined
      }
    };
  }

  // 6) 只回白名單欄位（token / user）；確保永遠唔會夾帶 SUPER_KEY 或密碼。
  return {
    status: 200,
    body: {
      success: true,
      token: json.token,
      user: json.user,
      force_change_password: false,
      via: json.via || 'app-admin-sig',
      sigExp: signed.exp
    }
  };
}

/** Vercel handler：POST {troopId, login_id, password} */
async function handler(req, res) {
  if (!res.status) res.status = function (c) { res.statusCode = c; return res; };
  if (!res.json) {
    res.json = function (d) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(d));
      return res;
    };
  }
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  let body = {};
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
  } catch (e) {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  const headers = req.headers || {};
  const clientKey = String(headers['x-forwarded-for'] || headers['x-real-ip'] || '').split(',')[0].trim() || 'anon';
  const out = await handleSuperLogin({
    troopId: body.troopId || body.troop || body.u || '0082',
    loginId: body.login_id || body.loginId || body.ymis,
    password: body.password,
    clientKey
  });
  return res.status(out.status).json(out.body);
}

module.exports = handler;
module.exports.handleSuperLogin = handleSuperLogin;
module.exports.isSuperAdminLoginId = isSuperAdminLoginId;
