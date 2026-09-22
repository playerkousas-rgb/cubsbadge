// Vercel Serverless Function - 旅團配置 API（功能變數契約 4 樣）
// 設定淨係指向 Vercel 環境變數：SUPER_KEY + TROOP_<id>_BACKEND / _APIKEY / _NAME（全部由 APP ADMIN 設定；旅團只提供編號／URL／APIKEY）
// troops.json 已棄用，唔再讀取、唔再有內置 fallback URL。
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

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    troops,
    _note: 'Troop config comes ONLY from Vercel env vars: SUPER_KEY + TROOP_<id>_BACKEND / TROOP_<id>_APIKEY / TROOP_<id>_NAME (後端GS 對應). troops.json 已棄用. backend URL is public configuration; business API requests go through same-origin /api/proxy. 0082 and 82 are treated as same troop.',
    _hint: Object.keys(troops).length === 0
      ? '未設定任何旅團功能變數：請 APP ADMIN 喺 Vercel Settings → Environment Variables 加 TROOP_0082_BACKEND / TROOP_0082_APIKEY / TROOP_0082_NAME（另加全 APP 一個 SUPER_KEY），然後 Redeploy。'
      : undefined,
    _debug: {
      totalRegistryKeys: Object.keys(registry).length,
      uniqueTroops: Object.keys(troops).length
    }
  });
};
