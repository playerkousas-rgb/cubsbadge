// Central admin registration proxy - avoids browser direct fetch to script.google.com
// 功能變數契約：APP ADMIN 層嘅管理操作要帶 SUPER_KEY（x-super-key header 或 body superKey）。
// SUPER_KEY 由 APP ADMIN 喺 Vercel 設定（唔係旅團設定、GS 亦唔會顯示），並轉發俾後端管理 GS 驗證。
const { getSuperKey, verifySuperKey } = require('./_lib/registry');
const ADMIN_API_URL = process.env.SCOUT_ADMIN_API || 'https://script.google.com/macros/s/AKfycbxj5BDDGgjs559smkK4Z5aYImWYeXbN5af8U1ObON0z9WnsN6QJW4I1XWolhs5kQ_H-UQ/exec';
const TIMEOUT_MS = 12000;

function isValidAdminUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'script.google.com') return false;
    if (!u.pathname.includes('/macros/s/')) return false;
    if (!u.pathname.endsWith('/exec')) return false;
    return true;
  } catch {
    return false;
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

  if (!isValidAdminUrl(ADMIN_API_URL)) {
    console.error('[register] Invalid ADMIN_API_URL');
    return res.status(500).json({ success: false, error: 'Admin API misconfigured' });
  }

  let body = {};
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body || '{}');
  } catch {
    return res.status(400).json({ success: false, error: 'Invalid JSON body' });
  }

  // ── SUPER_KEY 驗證（APP ADMIN 喺 Vercel 設定嘅管理 key；GS 永不顯示值）──
  // key 未設定 = 管理 API 停用（同 EC_FLUSH_KEY 一樣，唔會變成公開註冊口）。
  if (!getSuperKey()) {
    return res.status(503).json({
      success: false,
      error: 'SUPER_KEY 未設定：請 APP ADMIN 喺 Vercel 環境變數設定 SUPER_KEY（管理 API 用）'
    });
  }
  const providedKey = String((req.headers && req.headers['x-super-key']) || body.superKey || body.super_key || '');
  if (!verifySuperKey(providedKey)) {
    return res.status(403).json({ success: false, error: 'SUPER_KEY 驗證失敗' });
  }

  const troopId = String(body.troopId || '').trim();
  const scriptUrl = String(body.scriptUrl || '').trim();
  const apiKey = String(body.apiKey || '').trim();
  if (!troopId || !scriptUrl || !apiKey) {
    return res.status(400).json({ success: false, error: 'Missing required fields: troopId, scriptUrl, apiKey' });
  }
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(troopId)) {
    return res.status(400).json({ success: false, error: 'Invalid troopId format' });
  }
  if (!isValidAdminUrl(scriptUrl)) {
    return res.status(400).json({ success: false, error: 'Invalid scriptUrl - must be HTTPS script.google.com /exec URL' });
  }

  console.log(`[register] Forwarding registration troop=${troopId} appType=${body.appType || 'cubbadge'}`);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const upstreamResp = await fetch(ADMIN_API_URL, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
        'User-Agent': 'cubsbadge-register-proxy/1.0'
      },
      body: JSON.stringify({
        troopId,
        troopName: body.troopName || '',
        scriptUrl,
        apiKey,
        superKey: getSuperKey(),
        appType: body.appType || 'cubbadge',
        note: body.note || ''
      })
    });

    clearTimeout(timeoutId);

    const text = await upstreamResp.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!upstreamResp.ok) {
      return res.status(upstreamResp.status).json(json || { success: false, error: `Upstream error ${upstreamResp.status}` });
    }

    if (json) {
      return res.status(200).json(json);
    } else {
      return res.status(200).json({ success: true, message: 'Submitted', raw: text.slice(0,200) });
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, error: 'Registration upstream timeout' });
    }
    console.error('[register] upstream error', err.message.slice(0,200));
    return res.status(502).json({ success: false, error: 'Registration forwarding failed' });
  }
}

module.exports = handler;
