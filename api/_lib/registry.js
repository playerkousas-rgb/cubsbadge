// Shared registry loader for multi-troop system - v2.1 robust 0082/82 handling (CubBadge aligned with ScoutBadge v5.2)
// Loads troops from data/troops.json, troops.json, and env vars

const fs = require('fs');
const path = require('path');

const DEFAULT_TROOPS = {
  "0082": {
    name: "第 82 旅",
    backend: "https://script.google.com/macros/s/AKfycbw81wLR5NZtRk4m1ptSAoFBueoqwIZ5hcM_apHJa2xMmlVfUvZsS8R45nTIKTOIuBB2KQ/exec"
  }
};

function normalizeToPadded4(id) {
  if (!id) return id;
  const s = String(id).trim().toUpperCase();
  if (/^\d+$/.test(s)) return s.padStart(4, '0');
  const m = s.match(/^(\d+)([A-Z]*)$/);
  if (m) return m[1].padStart(4, '0') + m[2];
  return s;
}

function normalizeStripped(id) {
  if (!id) return id;
  const s = String(id).trim().toUpperCase();
  const m = s.match(/^(0+)(\d+)([A-Z]*)$/);
  if (m) return m[2] + (m[3] || '');
  const stripped = s.replace(/^0+/, '');
  return stripped || s;
}

function loadFileTroops() {
  let fileTroops = {};
  const candidates = [
    path.join(process.cwd(), 'data', 'troops.json'),
    path.join(process.cwd(), 'troops.json'),
    path.join(__dirname, '..', '..', 'data', 'troops.json'),
    path.join(__dirname, '..', '..', 'troops.json'),
    path.join(__dirname, '..', 'data', 'troops.json'),
    path.join(__dirname, '..', '..', 'api', '..', 'data', 'troops.json'),
  ];
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
    } catch (e) {}
  }
  return fileTroops;
}

function getRegistry() {
  const fileTroops = loadFileTroops();
  const combined = { ...DEFAULT_TROOPS, ...fileTroops };

  const envKeys = Object.keys(process.env);
  const idsFromEnv = new Set();
  envKeys.forEach(k => {
    let m = k.match(/^TROOP_(\d+[A-Z]?)_BACKEND$/i);
    if (m) idsFromEnv.add(m[1].toUpperCase());
    let m2 = k.match(/^TROOP_(\d+[A-Z]?)_APIKEY$/i);
    if (m2) idsFromEnv.add(m2[1].toUpperCase());
  });

  const allIds = new Set([
    ...Object.keys(combined).map(id => id.toUpperCase()),
    ...idsFromEnv
  ]);

  const registry = {};

  allIds.forEach(idUpper => {
    const origKey = Object.keys(combined).find(k => k.toUpperCase() === idUpper) || idUpper;
    const fileEntry = combined[origKey] || combined[Object.keys(combined).find(k => normalizeToPadded4(k) === normalizeToPadded4(idUpper)) || ''] || {};

    const idNoZero = normalizeStripped(idUpper);
    const idPadded = normalizeToPadded4(idUpper);

    const backendEnv = process.env[`TROOP_${idUpper}_BACKEND`] ||
                       process.env[`TROOP_${idNoZero}_BACKEND`] ||
                       process.env[`TROOP_${idPadded}_BACKEND`];

    const apikeyEnv = process.env[`TROOP_${idUpper}_APIKEY`] ||
                      process.env[`TROOP_${idNoZero}_APIKEY`] ||
                      process.env[`TROOP_${idPadded}_APIKEY`];

    const backend = backendEnv || fileEntry.backend || '';
    const apikey = apikeyEnv || fileEntry.apikey || '';
    const name = fileEntry.name || `第 ${origKey} 旅`;

    if (backend) {
      const variants = new Set([
        origKey,
        idUpper,
        idNoZero,
        idPadded,
        idUpper.toLowerCase(),
        origKey.toUpperCase(),
        origKey.toLowerCase()
      ]);
      variants.forEach(v => {
        if (v) registry[v] = { name, backend, apikey };
      });
      if (idNoZero) registry[idNoZero] = { name, backend, apikey };
      if (idPadded) registry[idPadded] = { name, backend, apikey };
    }
  });

  Object.keys(DEFAULT_TROOPS).forEach(defId => {
    const def = DEFAULT_TROOPS[defId];
    const padded = normalizeToPadded4(defId);
    const stripped = normalizeStripped(defId);
    [defId, padded, stripped, defId.toUpperCase()].forEach(k => {
      if (k && !registry[k]) {
        registry[k] = { name: def.name, backend: def.backend, apikey: def.apikey || '' };
      }
    });
  });

  return registry;
}

function getTroopsRegistry() {
  return getRegistry();
}

function getTroopConfig(troopId) {
  if (troopId === undefined || troopId === null) return null;
  const cleanId = String(troopId).trim();
  if (!cleanId) return null;
  const reg = getRegistry();
  const candidates = [
    cleanId,
    cleanId.toUpperCase(),
    cleanId.toLowerCase(),
    normalizeStripped(cleanId),
    normalizeToPadded4(cleanId),
    normalizeStripped(cleanId.toUpperCase()),
    normalizeToPadded4(cleanId.toUpperCase()),
    cleanId.replace(/^0+/, '') || cleanId,
    cleanId.toUpperCase().replace(/^0+/, '') || cleanId.toUpperCase()
  ];
  const seen = new Set();
  const uniq = [];
  candidates.forEach(c => { if (c && !seen.has(c)) { seen.add(c); uniq.push(c); } });
  for (const cand of uniq) {
    const entry = reg[cand];
    if (entry) {
      if (!entry.backend || typeof entry.backend !== 'string') continue;
      try {
        const url = new URL(entry.backend);
        if (url.protocol !== 'https:') continue;
        if (url.hostname !== 'script.google.com') continue;
        if (!url.pathname.endsWith('/exec')) continue;
      } catch (e) { continue; }
      return entry;
    }
  }
  return null;
}

function isValidGasUrl(urlString) {
  try {
    const u = new URL(urlString);
    const isLocal = (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1');
    const allowLocal = isLocal && (process.env.NODE_ENV !== 'production' && process.env.VERCEL_ENV !== 'production');
    if (allowLocal) {
      if (u.pathname.includes('/exec') || u.pathname.includes('/mock')) return true;
      return true;
    }
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'script.google.com') return false;
    if (!u.pathname.includes('/macros/s/')) return false;
    if (!u.pathname.endsWith('/exec')) return false;
    const match = u.pathname.match(/\/macros\/s\/([A-Za-z0-9-_]+)\/exec/);
    if (!match) return false;
    if (match[1].length < 10) return false;
    return true;
  } catch { return false; }
}

module.exports = {
  getRegistry,
  getTroopsRegistry,
  getTroopConfig,
  isValidGasUrl,
  normalizeToPadded4,
  normalizeStripped,
  loadFileTroops
};
