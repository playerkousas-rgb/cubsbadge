// Vercel Serverless Function - Same-origin Proxy for Google Apps Script
// 超管（隱藏維護帳戶）密碼只喺 Vercel 比對（SUPER_KEY），之後改送 action=superLogin
//       （apikey 由 registry 注入）—— 密碼永遠唔會轉發去 leaf GS。
const { getTroopConfig, getRegistry, normalizeToPadded4, normalizeStripped } = require('./_lib/registry');
const { isSuperAdminLoginId, verifySuperAdminLogin } = require('./_lib/superadmin');

/**
 * 敏感 action：一定要有 server 端 apikey 先可以轉發（BUILD.md §10 施工次序 1）。
 * 匿名可寫面（§3 白名單）唔喺呢度，佢哋本身就設計成無 key 都可以寫入待批表。
 */
const SENSITIVE_ACTIONS = new Set([
  'save', 'saveDbPart', 'saveDbCommit', 'loadDbPart',
  'addUser', 'addMember', 'updateUser', 'deleteUser', 'resetPassword',
  'saveOtherBadge', 'approveRequest', 'rejectRequest',
  'setConfig', 'saveConfig', 'initializeSheets',
  'exportAll', 'importAll', 'transferOut', 'transferIn',
  'ecSetModule', 'ecRegisterBranch', 'ecUnregisterBranch', 'ecInitSheets', 'ecAccessLog',
  'opsRegistry'
]);

module.exports = async function handler(req, res) {
  if (!res.status) {
    res.status = function(code) { res.statusCode = code; return res; };
  }
  if (!res.json) {
    res.json = function(data) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(data));
      return res;
    };
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ success: false, error: `Method ${req.method} Not Allowed` });
  }

  const startTime = Date.now();

  try {
    let payload = {};
    if (req.method === 'POST') {
      if (typeof req.body === 'string') {
        try { payload = JSON.parse(req.body || '{}'); } catch (e) {
          return res.status(400).json({ success: false, error: 'Invalid JSON request body' });
        }
      } else {
        payload = req.body || {};
      }
    } else {
      payload = req.query || {};
    }

    const rawTroopId = payload.troopId || payload.troopKey || payload.troop || (req.query && (req.query.troopId || req.query.u || req.query.troop)) || '0082';
    const troopId = String(rawTroopId).trim();
    let action = payload.action || (req.query && req.query.action);

    if (!action) {
      return res.status(400).json({ success: false, error: 'Missing required parameter: action' });
    }

    // ── 隱藏超管：SUPER_KEY 只存在 Vercel 功能變數 ──────────────────
    // 前端照舊送 {action:'login', login_id:'sheep', password}，密碼只喺呢度比對，
    // **永遠唔會**轉發去 leaf GS（旅團開 Sheet／Apps Script／指令碼屬性都見唔到）。
    // 比對通過就改送 action=superLogin，apikey 照舊由 registry 注入。
    const isSuperAdminRequest = payload.login_id && isSuperAdminLoginId(payload.login_id);
    if (isSuperAdminRequest) {
      const clientKey = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '')
        .split(',')[0].trim() || 'anon';
      const check = verifySuperAdminLogin({ loginId: payload.login_id, password: payload.password, clientKey });
      if (!check.ok) return res.status(check.status).json(check.body);
      // 通過：換成 server-to-server action，密碼即刻丟棄（唔會落 GS）
      payload.action = 'superLogin';
      action = 'superLogin';
      delete payload.password;
      delete payload.login_id;
    }

    const troopConfig = getTroopConfig(troopId);
    if (!troopConfig) {
      let available = [];
      try {
        const reg = getRegistry();
        const uniq = new Set();
        Object.keys(reg).forEach(k => {
          const n = normalizeToPadded4(k);
          if (/^\d{4}$/.test(n) || /^\d+$/.test(k)) uniq.add(n);
        });
        available = Array.from(uniq).sort().slice(0, 20);
      } catch(e) {}
      return res.status(404).json({
        success: false,
        error: `Unregistered or invalid troop ID: ${troopId}. 請檢查旅團編號是否為 0082 / 82？可用旅團: ${available.join(', ') || '無'}`,
        troubleshooting: {
          requested: troopId,
          normalizedPadded: normalizeToPadded4(troopId),
          normalizedStripped: normalizeStripped(troopId),
          availableTroops: available,
          hint: '若你看到「找不到82的SHEET」，請確認 Vercel 環境變數 TROOP_0082_BACKEND 已正確設定，並且 Apps Script 已執行 initializeSheets()'
        }
      });
    }

    const gasUrl = troopConfig.backend;

    // ── BUILD.md §1 + §10 施工次序 1：apikey 只存 server ──────────────────
    // 前端送乜 apikey 都一律丟棄，再由 registry 注入。咁樣就算 index.html
    // 舊 code 仲喺度帶 apikey，或者有人手砌 request，都改變唔到用邊條 key。
    delete payload.apikey;
    delete payload.apiKey;
    delete payload.api_key;
    delete payload.backend;   // 前端永遠唔可以自帶 backend URL（SSRF 防線）
    delete payload.scriptUrl;

    // key 未設定 + 連 token 都冇 = 真係零認證，擺明唔做好過無聲無息行落去。
    //
    // 注意：唔可以淨係見到「冇 apikey」就攔。GAS 本身有向下兼容設計
    // （Code.gs：「若無 apikey 但有有效 token 也允許」），好多旅團部署咗
    // 但未喺 Vercel 設 TROOP_<id>_APIKEY，佢哋一直靠 session token 正常運作。
    // 喺呢度一刀切攔截，會即刻整死勾進度／開戶／批量加人。
    // 認證與否最終由 GAS 判斷，proxy 只負責擋「乜都冇」嗰種。
    if (!troopConfig.apikey && !payload.token && SENSITIVE_ACTIONS.has(action)) {
      console.error(`[PROXY] refuse action=${action} troop=${troopId}: no apikey and no token`);
      return res.status(401).json({
        success: false,
        code: 'no_credentials',
        error: `敏感操作 (${action}) 需要登入。請重新登入後再試。`,
        troubleshooting: {
          hint: `若此單位長期靠 API Key 運作，請喺 Vercel 設定環境變數 TROOP_${normalizeToPadded4(troopId)}_APIKEY。`,
          action
        }
      });
    }
    if (troopConfig.apikey) payload.apikey = troopConfig.apikey;

    const controller = new AbortController();
    const timeoutMs = 25000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let gasResponse;

    if (action === 'load') {
      // Frontend sends load as POST via apiRequest, but Apps Script implements load in doGet().
      // Translate both proxy methods to upstream GET so login and post-login data load use compatible entry points.
      const targetUrl = new URL(gasUrl);
      targetUrl.searchParams.set('action', 'load');
      if (payload.token) targetUrl.searchParams.set('token', payload.token);
      if (payload.apikey) targetUrl.searchParams.set('apikey', payload.apikey);

      gasResponse = await fetch(targetUrl.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        redirect: 'follow',
        signal: controller.signal
      });
    } else {
      const forwardPayload = { ...payload };
      delete forwardPayload.troopId;
      delete forwardPayload.troopKey;
      delete forwardPayload.troop;

      gasResponse = await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(forwardPayload),
        redirect: 'follow',
        signal: controller.signal
      });
    }

    clearTimeout(timeoutId);

    const rawText = await gasResponse.text();
    let jsonResult = null;

    try {
      jsonResult = JSON.parse(rawText);
    } catch (parseErr) {
      console.error(`[PROXY] Upstream non-JSON troop=${troopId} (norm=${normalizeToPadded4(troopId)}), action=${action}, status=${gasResponse.status}`);
      const isSheetMissing = /Exception.*sheet/i.test(rawText) || /找不到/.test(rawText) || /工作表/.test(rawText);
      return res.status(502).json({
        success: false,
        error: isSheetMissing
          ? `後端 Google Sheet 設定異常：${troopId} 的 Spreadsheet 可能缺少必要工作表，請在 Apps Script 執行 initializeSheets() 重建。原始錯誤：${rawText.substring(0,150)}`
          : '後端服務響應異常 (GAS Upstream Error) - 請檢查 Apps Script 是否正確部署為「任何人可存取」且 URL 為 /exec 結尾',
        details: rawText.length > 300 ? rawText.substring(0, 300) + '...' : rawText,
        troubleshooting: {
          troopIdRequested: troopId,
          troopIdNormalized: normalizeToPadded4(troopId),
          gasUrl: gasUrl.substring(0, 80) + '...',
          hint: '常見原因：1) Apps Script 未重新部署「新版本」 2) 未執行 initializeSheets() 3) Google 帳戶授權過期 4) Spreadsheet 被刪除'
        }
      });
    }

    const duration = Date.now() - startTime;
    console.log(`[PROXY] troop=${troopId} (norm=${normalizeToPadded4(troopId)}) action=${action} status=${gasResponse.status} duration=${duration}ms success=${jsonResult?.success !== false}`);

    if (jsonResult && jsonResult.success === false && jsonResult.error) {
      const errLower = String(jsonResult.error).toLowerCase();
      if (errLower.includes('sheet') || errLower.includes('工作表') || errLower.includes('找不到')) {
        jsonResult.troubleshooting = {
          hint: `此錯誤通常表示 Google Sheet 缺少工作表或 ${troopId} 設定異常。請執行 initializeSheets()，並確認 TROOP_${normalizeToPadded4(troopId)}_BACKEND 指向正確的 Spreadsheet。`,
          troopId: troopId,
          normalized: normalizeToPadded4(troopId)
        };
      }
    }

    // 下游入口關閉（leaf 回 code=DOWNSTREAM_CLOSED）：代理回 HTTP 403，前端一樣讀到同一個訊息
    if (jsonResult && jsonResult.code === 'DOWNSTREAM_CLOSED') return res.status(403).json(jsonResult);

    return res.status(200).json(jsonResult);

  } catch (err) {
    const duration = Date.now() - startTime;
    if (err.name === 'AbortError') {
      console.error(`[PROXY] Timeout calling GAS after ${duration}ms`);
      return res.status(504).json({ success: false, error: '後端服務連線逾時 (GAS Request Timeout) - 請檢查 Google Apps Script 是否回應過慢或配額耗盡' });
    }
    console.error(`[PROXY] Exception:`, err.message);
    return res.status(500).json({ success: false, error: `代理伺服器錯誤: ${err.message}` });
  }
};
