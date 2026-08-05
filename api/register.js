// Central admin registration proxy - avoids browser direct fetch to script.google.com
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
