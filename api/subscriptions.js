// ============================================================
// /api/subscriptions — 個人化訂閱橋接 (BUILD.md §4 ★ 重中之重)
//
// 「推送基建 = 圖書館現有嗰條鏈，系統零另起爐灶」：
//   圖書館每日 scrape → Supabase push_subscriptions
//   → GitHub Actions 06:00 notify.py 命中「支部 AND 項目」→ pywebpush (VAPID)
// 本系統只做「訂閱設定前端」：
//   用戶揀支部×項目 → service worker 用圖書館 VAPID public key 訂閱
//   → 寫入同一張 Supabase 表（帶 source='system'）。
//
// 瀏覽器唔可以直接打圖書館（跨域），所以行呢個同源 proxy：
//   GET  /api/subscriptions?action=config    → VAPID public key + 訂閱字典
//   POST /api/subscriptions {action:'upsert'|'delete'|'sync', ...}
//
// 私隱（照館方規矩）：只傳 endpoint / keys / branch_ids / topic_ids，
// 冇 YMIS、冇 email、冇姓名 —— 館方知「幾多人訂、訂咩」，一樣唔知「邊個」。
// ============================================================

const LIBRARY_BASE = (process.env.CIRCULAR_LIBRARY_URL || 'https://scout-circulars.vercel.app').replace(/\/+$/, '');
const CATALOG_RAW = process.env.CIRCULAR_CATALOG_URL
  || 'https://raw.githubusercontent.com/playerkousas-rgb/scout-circulars/main/subscription_catalog.json';
const TIMEOUT_MS = 12000;
const CATALOG_TTL_MS = 30 * 60 * 1000;

// 本系統來源標識：館方建議 push_subscriptions 加 source 欄（library/system）統計分開。
const SOURCE_TAG = process.env.EC_PUSH_SOURCE || 'system';

let _catalogCache = null; // { at, data }

function shim(res) {
  if (!res.status) res.status = function (c) { res.statusCode = c; return res; };
  if (!res.json) {
    res.json = function (d) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(d));
      return res;
    };
  }
  return res;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } }
    return req.body;
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 128 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

async function upstream(path, { method = 'GET', body = null, origin = '' } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    // 館方 require_same_origin 之後要加 origin allowlist 認住各單位系統網址；
    // 我哋誠實報自己嘅 origin，唔會扮成圖書館自己。
    if (origin) headers.Origin = origin;
    const resp = await fetch(`${LIBRARY_BASE}${path}`, {
      method, headers, redirect: 'follow', signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { ok: resp.ok, status: resp.status, json, raw: text.slice(0, 300) };
  } finally { clearTimeout(timer); }
}

async function loadCatalog() {
  if (_catalogCache && Date.now() - _catalogCache.at < CATALOG_TTL_MS) return _catalogCache.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(CATALOG_RAW, { redirect: 'follow', signal: controller.signal });
    if (!resp.ok) throw new Error(`catalog HTTP ${resp.status}`);
    const data = await resp.json();
    _catalogCache = { at: Date.now(), data };
    return data;
  } finally { clearTimeout(timer); }
}

/** 揀選有效 branch/topic id —— 送上去前先按字典核一次，防止亂塞。 */
function sanitizePreferences(catalog, branches, topics) {
  const validBranches = new Set((catalog.branches || []).map((b) => b.id));
  const validTopics = new Set((catalog.topics || []).map((t) => t.id));
  const b = Array.from(new Set((branches || []).map(String))).filter((x) => validBranches.has(x));
  const t = Array.from(new Set((topics || []).map(String))).filter((x) => validTopics.has(x));
  return { branches: b, topics: t, catalogVersion: catalog.version || '' };
}

function requestOrigin(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  return host ? `${proto}://${host}` : '';
}

module.exports = async function handler(req, res) {
  shim(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const query = req.query || {};
  const body = (req.method === 'POST') ? await readBody(req) : {};
  const action = String(body.action || query.action || 'config');
  const origin = requestOrigin(req);

  try {
    // ---------- config：VAPID public key（公開）+ 訂閱字典 ----------
    if (action === 'config') {
      const [cfg, catalog] = await Promise.allSettled([
        upstream('/api/push-config', { origin }),
        loadCatalog()
      ]);
      const cfgJson = cfg.status === 'fulfilled' ? cfg.value.json : null;
      const catalogData = catalog.status === 'fulfilled' ? catalog.value : null;
      return res.status(200).json({
        success: true,
        // vapidPublicKey 係公開嘢：瀏覽器要用佢建立訂閱，綁圖書館 VAPID 身份。
        enabled: !!(cfgJson && cfgJson.enabled),
        vapidPublicKey: (cfgJson && cfgJson.vapidPublicKey) || '',
        library: LIBRARY_BASE,
        source: SOURCE_TAG,
        catalog: catalogData ? {
          version: catalogData.version,
          title: catalogData.title,
          policy: catalogData.policy,
          branches: catalogData.branches || [],
          topics: catalogData.topics || []
        } : null,
        catalogError: catalog.status === 'rejected' ? String(catalog.reason && catalog.reason.message || catalog.reason).slice(0, 160) : null,
        configError: cfg.status === 'rejected' ? String(cfg.reason && cfg.reason.message || cfg.reason).slice(0, 160)
          : (cfgJson ? null : `圖書館 /api/push-config 回應異常 (HTTP ${cfg.value?.status})`)
      });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ success: false, error: `Method ${req.method} not allowed for action=${action}` });
    }

    // ---------- upsert / delete：寫入同一張 Supabase 表 ----------
    if (action === 'upsert' || action === 'sync' || action === 'delete') {
      const clientToken = String(body.clientToken || '').trim();
      if (!clientToken) return res.status(400).json({ success: false, error: 'Missing clientToken' });

      const payload = { action: action === 'sync' ? 'upsert' : action, clientToken, source: SOURCE_TAG };

      if (action !== 'delete') {
        const sub = body.subscription;
        if (!sub || !sub.endpoint || !sub.keys) {
          return res.status(400).json({ success: false, error: 'Missing subscription' });
        }
        let catalog;
        try { catalog = await loadCatalog(); }
        catch (e) { return res.status(502).json({ success: false, error: `訂閱字典讀取失敗：${e.message}` }); }
        const prefs = sanitizePreferences(catalog, body.branches, body.topics);
        if (!prefs.topics.length) {
          return res.status(400).json({ success: false, error: '請至少揀一個訂閱項目' });
        }
        payload.subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
        payload.branches = prefs.branches;
        payload.topics = prefs.topics;
        payload.catalogVersion = prefs.catalogVersion;
      } else if (body.endpoint) {
        payload.endpoint = body.endpoint;
      }

      const up = await upstream('/api/push-subscriptions', { method: 'POST', body: payload, origin });
      if (!up.ok) {
        const code = up.json && up.json.error;
        if (up.status === 403 || code === 'origin_not_allowed') {
          return res.status(502).json({
            success: false,
            error: 'origin_not_allowed',
            message: `圖書館仲未認住本系統網址 ${origin}。請按 BUILD.md §4 在 scout-circulars 的 require_same_origin 加入 origin allowlist（見 docs/ECOSYSTEM.md 附帶 patch）。`,
            origin
          });
        }
        return res.status(502).json({ success: false, error: (up.json && up.json.message) || `圖書館回應 HTTP ${up.status}`, detail: up.raw });
      }
      return res.status(200).json({ success: true, status: (up.json && up.json.status) || 'ok', source: SOURCE_TAG });
    }

    return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: '圖書館連線逾時' });
    console.error('[subscriptions]', String(err && err.message).slice(0, 200));
    return res.status(502).json({ success: false, error: `訂閱橋接失敗: ${err.message}` });
  }
};
