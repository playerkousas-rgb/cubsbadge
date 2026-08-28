// Vercel Serverless Function - 旅團配置 API v2.1 - deduplicate 0082/82 (CubBadge aligned with ScoutBadge v5.2)
const { getRegistry, normalizeToPadded4, normalizeStripped } = require('./_lib/registry');

module.exports = function handler(req, res) {
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

  const registry = getRegistry();
  const troops = {};
  const seenNormalized = new Set();

  Object.keys(registry).forEach(id => {
    const padded = normalizeToPadded4(id);
    const stripped = normalizeStripped(id);
    const canonical = /^\d{4}$/.test(padded) ? padded : id;
    if (seenNormalized.has(canonical)) return;
    if (registry[id] && registry[id].backend) {
      if (!troops[canonical]) {
        troops[canonical] = {
          name: registry[id].name,
          backend: registry[id].backend,
          _aliases: [id, padded, stripped].filter((v,i,a)=>a.indexOf(v)===i)
        };
        seenNormalized.add(canonical);
      }
      const strippedKey = stripped;
      if (strippedKey && strippedKey !== canonical && !troops[strippedKey]) {
        troops[strippedKey] = {
          name: registry[id].name,
          backend: registry[id].backend,
          _aliasOf: canonical
        };
      }
    }
  });

  if (!troops['0082'] && !troops['82']) {
    troops['0082'] = {
      name: '第 82 旅',
      backend: 'https://script.google.com/macros/s/AKfycbw81wLR5NZtRk4m1ptSAoFBueoqwIZ5hcM_apHJa2xMmlVfUvZsS8R45nTIKTOIuBB2KQ/exec',
      _fallback: true
    };
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    troops,
    _note: 'backend URL is public configuration; business API requests go through same-origin /api/proxy. 0082 and 82 are treated as same troop.',
    _debug: {
      totalRegistryKeys: Object.keys(registry).length,
      uniqueTroops: Object.keys(troops).length
    }
  });
};
