// Vercel Serverless Function - Same-origin proxy to GAS
// Security: only connects to registry-registered HTTPS GAS /exec URLs
// No frontend-supplied backend URL accepted (SSRF prevention)

const { getTroopsRegistry, isValidGasUrl } = require('./_lib/registry');

const FORBIDDEN_FORWARD_KEYS = new Set([
  'troopId', 'troop', 'u', 'troopId_', 'troopKey',
  'backend', 'backendUrl', 'gasUrl', 'scriptUrl', 'execUrl', 'url',
  'TROOP_BACKEND', 'GAS_URL'
]);

const UPSTREAM_TIMEOUT_MS = 15000;

function sanitizeLog(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = { ...obj };
  ['password', 'old_password', 'new_password', 'token', 'apikey', 'apiKey', 'API_KEY'].forEach(k => {
    if (clone[k]) clone[k] = '[REDACTED]';
    if (clone[k.toLowerCase()]) clone[k.toLowerCase()] = '[REDACTED]';
  });
  return clone;
}

function getTroopIdFromRequest(req) {
  let tid = '';
  if (req.query) {
    tid = req.query.troopId || req.query.troop || req.query.u || req.query.troopKey || '';
  }
  if (!tid && req.body && typeof req.body === 'object') {
    tid = req.body.troopId || req.body.troop || req.body.u || req.body.troopKey || '';
  }
  if (!tid && req.headers && req.headers['x-troop-id']) {
    tid = req.headers['x-troop-id'];
  }
  return String(tid || '').trim();
}

function parseBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body);
  } catch {
    return {};
  }
}

function buildForwardQuery(incomingQuery) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(incomingQuery || {})) {
    if (FORBIDDEN_FORWARD_KEYS.has(k)) continue;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach(val => {
        if (val !== undefined) params.append(k, String(val));
      });
    } else {
      params.append(k, String(v));
    }
  }
  return params;
}

function buildForwardBody(bodyObj) {
  const out = {};
  for (const [k, v] of Object.entries(bodyObj || {})) {
    if (FORBIDDEN_FORWARD_KEYS.has(k)) continue;
    if (k === '_proxyMethod' || k === '_proxyQuery') continue;
    out[k] = v;
  }
  return out;
}

async function handleUpstreamResponse(upstreamResp, res, troopId) {
  const contentType = upstreamResp.headers.get('content-type') || '';
  let text;
  try {
    text = await upstreamResp.text();
  } catch (e) {
    console.error(`[proxy] Failed to read upstream body troop=${troopId}`);
    return res.status(502).json({ success: false, error: 'Failed to read upstream response' });
  }

  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!upstreamResp.ok) {
    console.warn(`[proxy] Upstream non-2xx troop=${troopId} status=${upstreamResp.status}`);
    if (json) {
      return res.status(upstreamResp.status).json(json);
    } else {
      return res.status(upstreamResp.status).json({
        success: false,
        error: `Upstream error ${upstreamResp.status}`,
        details: text.slice(0,500)
      });
    }
  }

  if (json) {
    return res.status(upstreamResp.status).json(json);
  } else {
    console.warn(`[proxy] Upstream returned non-JSON troop=${troopId} ct=${contentType} len=${text.length}`);
    return res.status(502).json({
      success: false,
      error: 'Invalid upstream response format',
      details: text.slice(0,500)
    });
  }
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const troopIdRaw = getTroopIdFromRequest(req);
  if (!troopIdRaw) {
    return res.status(400).json({ success: false, error: 'Missing troopId' });
  }

  if (!/^[A-Za-z0-9_\-]{1,32}$/.test(troopIdRaw)) {
    return res.status(400).json({ success: false, error: 'Invalid troopId format' });
  }

  const registry = getTroopsRegistry();
  const lookupKeys = [troopIdRaw, troopIdRaw.toUpperCase(), troopIdRaw.toLowerCase()];
  let troopEntry = null;
  let resolvedId = troopIdRaw;
  for (const key of lookupKeys) {
    if (registry[key]) {
      troopEntry = registry[key];
      resolvedId = key;
      break;
    }
  }
  if (!troopEntry) {
    const noZero = troopIdRaw.replace(/^0+/, '') || troopIdRaw;
    for (const key of [noZero, noZero.toUpperCase(), noZero.toLowerCase()]) {
      if (registry[key]) {
        troopEntry = registry[key];
        resolvedId = key;
        break;
      }
    }
  }
  if (!troopEntry) {
    const withZeros = troopIdRaw.padStart(4, '0');
    if (registry[withZeros]) {
      troopEntry = registry[withZeros];
      resolvedId = withZeros;
    }
  }

  if (!troopEntry || !troopEntry.backend) {
    return res.status(404).json({ success: false, error: 'Troop not found or not registered', troopId: troopIdRaw });
  }

  const backendUrl = troopEntry.backend;
  if (!isValidGasUrl(backendUrl)) {
    console.warn(`[proxy] Rejected invalid backend URL for troop ${resolvedId}`);
    return res.status(403).json({ success: false, error: 'Invalid backend URL - not trusted' });
  }

  let upstreamUrl = backendUrl;
  let upstreamMethod = req.method;

  const bodyParsed = req.method === 'POST' ? parseBody(req) : {};
  const proxyMethodOverride = (req.query._proxyMethod || bodyParsed._proxyMethod || '').toString().toUpperCase();
  if (proxyMethodOverride === 'GET' || proxyMethodOverride === 'POST') {
    upstreamMethod = proxyMethodOverride;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    if (upstreamMethod === 'GET') {
      let forwardParams;
      if (req.method === 'GET') {
        forwardParams = buildForwardQuery(req.query);
      } else {
        const queryObj = {};
        if (bodyParsed._proxyQuery && typeof bodyParsed._proxyQuery === 'object') {
          Object.assign(queryObj, bodyParsed._proxyQuery);
        } else {
          ['action', 'apikey', 'apiKey', 'token', 'ymis'].forEach(k => {
            if (bodyParsed[k] !== undefined) queryObj[k] = bodyParsed[k];
          });
          if (bodyParsed.params && typeof bodyParsed.params === 'object') {
            Object.assign(queryObj, bodyParsed.params);
          }
        }
        forwardParams = buildForwardQuery(queryObj);
      }

      if (!forwardParams.has('apikey') && !forwardParams.has('apiKey') && troopEntry.apikey) {
        forwardParams.set('apikey', troopEntry.apikey);
      }

      if (forwardParams.toString()) {
        upstreamUrl += (upstreamUrl.includes('?') ? '&' : '?') + forwardParams.toString();
      }

      console.log(`[proxy] GET troop=${resolvedId} action=${forwardParams.get('action') || '-'} -> upstream`);

      const upstreamResp = await fetch(upstreamUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'cubsbadge-proxy/1.0'
        }
      });

      clearTimeout(timeoutId);
      return await handleUpstreamResponse(upstreamResp, res, resolvedId);

    } else {
      const forwardBody = buildForwardBody(bodyParsed);

      if (!forwardBody.apikey && troopEntry.apikey) {
        forwardBody.apikey = troopEntry.apikey;
      }

      const loggedAction = forwardBody.action || 'unknown';
      console.log(`[proxy] POST troop=${resolvedId} action=${loggedAction} payload=${JSON.stringify(sanitizeLog(forwardBody)).slice(0,200)}`);

      const upstreamResp = await fetch(upstreamUrl, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
          'User-Agent': 'cubsbadge-proxy/1.0'
        },
        body: JSON.stringify(forwardBody)
      });

      clearTimeout(timeoutId);
      return await handleUpstreamResponse(upstreamResp, res, resolvedId);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[proxy] Timeout troop=${resolvedId}`);
      return res.status(504).json({ success: false, error: 'Upstream timeout - please retry', code: 'TIMEOUT' });
    }
    console.error(`[proxy] Upstream fetch error troop=${resolvedId} err=${err.message}`);
    return res.status(502).json({ success: false, error: 'Upstream connection failed', details: err.message.slice(0,200) });
  }
}

module.exports = handler;
