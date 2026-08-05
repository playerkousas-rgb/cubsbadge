// Shared registry loader for multi-troop system
// Loads troops from data/troops.json, troops.json, and env vars

function loadFileTroops() {
  let fileTroops = {};
  try {
    const fs = require('fs');
    const path = require('path');
    const candidates = [
      path.join(process.cwd(), 'data', 'troops.json'),
      path.join(process.cwd(), 'troops.json'),
      path.join(__dirname, '..', '..', 'data', 'troops.json'),
      path.join(__dirname, '..', '..', 'troops.json'),
      path.join(__dirname, '..', 'data', 'troops.json'),
      path.join(__dirname, '..', '..', 'api', '..', 'data', 'troops.json'),
    ];
    // Deduplicate
    const seen = new Set();
    for (const p of candidates) {
      if (seen.has(p)) continue;
      seen.add(p);
      try {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf8');
          const json = JSON.parse(raw);
          if (json.troops && typeof json.troops === 'object') {
            fileTroops = { ...fileTroops, ...json.troops };
          }
        }
      } catch (e) {
        // ignore individual file read errors
      }
    }
  } catch (e) {
    // ignore
  }
  return fileTroops;
}

function loadEnvTroops() {
  const idsBackend = new Set();
  const idsApikey = new Set();
  const envKeys = Object.keys(process.env);
  envKeys.forEach(k => {
    let m = k.match(/^TROOP_(\d+[A-Z]?)_BACKEND$/i);
    if (m) idsBackend.add(m[1]);
    let m2 = k.match(/^TROOP_(\d+[A-Z]?)_APIKEY$/i);
    if (m2) idsApikey.add(m2[1]);
  });
  return { idsBackend, idsApikey };
}

function getTroopsRegistry() {
  const fileTroops = loadFileTroops();
  const { idsBackend, idsApikey } = loadEnvTroops();
  const allIds = new Set([
    ...Object.keys(fileTroops),
    ...idsBackend,
    ...idsApikey
  ]);

  const troops = {};

  allIds.forEach(id => {
    const fileEntry = fileTroops[id] || {};
    const backendEnv =
      process.env[`TROOP_${id}_BACKEND`] ||
      process.env[`TROOP_${id.toUpperCase()}_BACKEND`] ||
      process.env[`TROOP_${id.toLowerCase()}_BACKEND`];
    const apikeyEnv =
      process.env[`TROOP_${id}_APIKEY`] ||
      process.env[`TROOP_${id.toUpperCase()}_APIKEY`] ||
      process.env[`TROOP_${id.toLowerCase()}_APIKEY`] ||
      process.env[`TROOP_${id}_APIKEY`.toUpperCase()];

    let apikeyFallback = apikeyEnv;
    if (!apikeyFallback) {
      const idNoZero = id.replace(/^0+/, '') || id;
      apikeyFallback =
        process.env[`TROOP_${idNoZero}_APIKEY`] ||
        process.env[`TROOP_${idNoZero.toUpperCase()}_APIKEY`] ||
        process.env[`TROOP_${idNoZero.toLowerCase()}_APIKEY`];
    }
    let backendFallback = backendEnv;
    if (!backendFallback) {
      const idNoZero = id.replace(/^0+/, '') || id;
      backendFallback = process.env[`TROOP_${idNoZero}_BACKEND`] || process.env[`TROOP_${idNoZero.toUpperCase()}_BACKEND`];
    }

    const backend = backendFallback || fileEntry.backend || '';
    const apikey = apikeyFallback || fileEntry.apikey || '';
    const name = fileEntry.name || `第 ${id} 旅`;

    if (backend) {
      troops[id] = {
        name,
        backend,
        apikey
      };
    }
  });

  // Hard fallback to ensure at least 0082 exists if files missing in some envs (for robustness)
  if (!troops['0082']) {
    // attempt to include from root if not already
    // Do not inject fake if intentionally absent? We only inject if registry is completely empty to avoid breaking prod.
    if (Object.keys(troops).length === 0) {
      // Check if fileTroops has 0082 suppressed; if still empty, leave empty (proxy will return 404)
    }
  }

  return troops;
}

function isValidGasUrl(urlString) {
  try {
    const u = new URL(urlString);
    // Allow localhost for local testing when not in production
    const isLocal = (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1');
    const allowLocal = isLocal && (process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production');
    if (allowLocal) {
      // For local mock, allow http and any path ending with /exec or containing mock
      if (u.pathname.includes('/exec') || u.pathname.includes('/mock')) return true;
      // also allow simple mock paths
      return true;
    }
    if (u.protocol !== 'https:') return false;
    // Only allow script.google.com for initial URL (redirect target will be script.googleusercontent.com, handled by fetch follow)
    if (u.hostname !== 'script.google.com') return false;
    // Must contain /macros/s/ and end with /exec
    if (!u.pathname.includes('/macros/s/')) return false;
    if (!u.pathname.endsWith('/exec')) return false;
    const match = u.pathname.match(/\/macros\/s\/([A-Za-z0-9-_]+)\/exec/);
    if (!match) return false;
    if (match[1].length < 10) return false;
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getTroopsRegistry,
  isValidGasUrl,
  loadFileTroops
};
