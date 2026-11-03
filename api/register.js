// Central admin registration proxy - avoids browser direct fetch to script.google.com
//
// 公開「新旅團接入申請」（submitRegistration）：未接入旅團提交申請，
// 只往伺服器端固定嘅 Scout Admin 收件匣（SCOUT_ADMIN_API 一族環境變數）
// 寫入「申請記錄」待審核 — 對齊共用 APP ADMIN 申請協定。
//
// 紅線：
//  - 申請人唔使（亦唔會得到）SUPER_KEY；本端點唔驗 SUPER_KEY。
//    伺服器端 SUPER_KEY 絕不可放入送往 Google Sheet／Email 嘅 payload。
//    （SUPER_KEY 仍然只用作 /api/proxy 嘅超管登入比對，值永不離開 Vercel。）
//  - 收件匣 URL 只由伺服器端環境變數決定（見 _lib/scoutAdmin.js），
//    前端自帶嘅 URL 一律唔理（SSRF 防線）；申請人自己部 GS 嘅 backendUrl
//    只會寫入申請記錄欄位俾管理員審核，唔會被伺服器攞去 fetch。
const { isValidGasUrl } = require('./_lib/registry');
const {
  APP_TYPE,
  getScoutAdminApiUrl,
  buildApplyPayload,
  isScoutAdminSuccess
} = require('./_lib/scoutAdmin');
const TIMEOUT_MS = 12000;
const PROBE_TIMEOUT_MS = 5000;

async function probeAnonymousBackend(backendUrl) {
  const urlStr = String(backendUrl || '').trim();
  if (!urlStr) return null;
  try {
    const sep = urlStr.includes('?') ? '&' : '?';
    const probeUrl = urlStr + sep + 'action=ecStatus';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const resp = await fetch(probeUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'cubsbadge-register-proxy/1.0' }
    });
    clearTimeout(timeoutId);
    const text = await resp.text();
    let data;
    try { data = JSON.parse(text); } catch { return null; }
    if (!data || typeof data !== 'object') return null;
    // ecStatus returns {success:true, gsVersion, initializedGsVersion, initRequired, ...}
    // Support both top-level and nested shapes
    if (typeof data.initRequired === 'boolean' || typeof data.gsVersion === 'string' || typeof data.initializedGsVersion === 'string') {
      return data;
    }
    return null;
  } catch (_) {
    return null;
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // 動態讀取（相容 SCOUT_ADMIN_API / ROVERBADGE_ADMIN_API / CUBSBADGE_ADMIN_API /
  // SCOUTBADGE_ADMIN_API，未設用內建預設）＋同 proxy submitFeedback 共用 helper。
  const adminApiUrl = getScoutAdminApiUrl();
  if (!isValidGasUrl(adminApiUrl)) {
    console.error('[register] Invalid Scout Admin API URL');
    return res.status(500).json({ success: false, error: 'Admin API misconfigured' });
  }

  let body = {};
  try {
    body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  // 前端請求格式不變：scriptUrl 喺伺服器端映射為 backendUrl（唔再送 scriptUrl），
  // 固定 type:"apply" + appType:"cubsbadge"；空 troopName／note 喺 builder 內補好
  // （預設旅名 + [cubsbadge] 標記，確保 Scout Admin「旅團登記」卡片必顯示且分得清來源）。
  // builder 係 allowlist：請求就算帶埋 superKey／super_key 都唔會轉發。
  const payload = buildApplyPayload(body);
  const { troopId, backendUrl, apiKey } = payload;
  if (!troopId || !backendUrl || !apiKey) {
    return res.status(400).json({ success: false, error: 'Missing required fields: troopId, backendUrl, apiKey' });
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(troopId)) {
    return res.status(400).json({ success: false, error: 'Invalid troopId format' });
  }
  if (!isValidGasUrl(backendUrl)) {
    return res.status(400).json({ success: false, error: 'Invalid backendUrl - must be HTTPS script.google.com /exec URL' });
  }

  // ── 新旅團申請入閘口：未初始化就 422 攔截，不轉發去 Admin，不洩漏 backendUrl ──
  const probe = await probeAnonymousBackend(backendUrl);
  if (probe && probe.initRequired === true) {
    const gsVersion = String(probe.gsVersion || '');
    const initializedGsVersion = String(probe.initializedGsVersion || '');
    if (initializedGsVersion !== gsVersion) {
      console.warn(`[register] block uninitialized troop=${troopId} gs=${gsVersion} initialized=${initializedGsVersion}`);
      return res.status(422).json({
        success: false,
        code: 'INIT_REQUIRED',
        error: '此旅團後端尚未完成本版的初始化／更新（initializeSheets），請先完成再申請接入。',
        gsVersion,
        initializedGsVersion
      });
    }
  }

  console.log(`[register] Forwarding apply troop=${troopId} appType=${APP_TYPE}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const upstreamResp = await fetch(adminApiUrl, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'User-Agent': 'cubsbadge-register-proxy/1.0'
      },
      body: JSON.stringify(payload)
    });

    clearTimeout(timeoutId);

    const text = await upstreamResp.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = null;
    }

    // Scout Admin GS 成功回 {status:"success"}（舊式 {success:true} 亦兼容），
    // 必須 HTTP 2xx + 成功標記齊全，先統一回前端 {success:true}；
    // 其餘（上游錯誤／非 2xx／非 JSON／冇成功標記）一律 502，
    // 唔好將冇 success:true 嘅上游原文直接回俾前端。
    if (isScoutAdminSuccess(upstreamResp.status, result)) {
      return res.status(200).json({ success: true, message: '申請已提交' });
    }

    const upstreamError = result && (result.error || result.message)
      ? String(result.error || result.message).slice(0, 200)
      : '';
    console.error(`[register] upstream not successful status=${upstreamResp.status}${upstreamError ? ' error=' + upstreamError : ''}`);
    return res.status(502).json({
      success: false,
      error: upstreamError || '申請提交失敗，請稍後重試'
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Registration upstream timeout' });
    }
    console.error('[register] upstream error', err.message.slice(0,200));
    return res.status(502).json({ success: false, error: 'Registration forwarding failed' });
  }
}

module.exports = handler;
