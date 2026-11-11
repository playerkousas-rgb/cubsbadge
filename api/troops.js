// Vercel Serverless Function - 旅團配置 API（功能變數契約 4 樣）
// 設定淨係指向 Vercel 環境變數：TROOP_<id>_BACKEND / _APIKEY / _NAME（全部由 APP ADMIN 設定；旅團只提供編號／URL／APIKEY）
// troops.json 已棄用，唔再讀取、唔再有內置 fallback URL。
const { getRegistry, normalizeToPadded4, normalizeStripped, isValidGasUrl } = require('./_lib/registry');

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
    // 「connected」必須同 /api/proxy 用同一條規則（isValidGasUrl），
    // 否則會出現「卡片見到 0042，一按就話 Unregistered」的矛盾：
    // 值有填但格式唔合格（貼錯 /dev、帶引號／query…）唔算接通。
    if (registry[id] && registry[id].backend && registry[id].backendValid !== false &&
        isValidGasUrl(registry[id].backend)) {
      if (!troops[canonical]) {
        troops[canonical] = {
          name: registry[id].name,
          connected: true,          // B（部署 URL）留喺 server 端；前端只需要知「掛咗未」
          _aliases: [id, padded, stripped].filter((v,i,a)=>a.indexOf(v)===i)
        };
        seenNormalized.add(canonical);
      }
      const strippedKey = stripped;
      if (strippedKey && strippedKey !== canonical && !troops[strippedKey]) {
        troops[strippedKey] = {
          name: registry[id].name,
          connected: true,          // 同上：URL 唔入前端
          _aliasOf: canonical
        };
      }
    }
  });

  // 有填功能變數但格式唔合格嘅旅團：唔可以靜靜消失（APP ADMIN 會以為冇填到），
  // 亦要同卡片顯示一致 —— 標記 connected:false + backendConfigured:true，
  // 只講問題代碼／說明，永不回傳 URL 值。
  const problems = registry._backendProblems instanceof Map ? registry._backendProblems : new Map();
  const misconfigured = {};
  problems.forEach((problem, id) => {
    if (troops[id] || misconfigured[id]) return;
    misconfigured[id] = {
      name: (registry[id] && registry[id].name) || `第 ${normalizeStripped(id)} 旅`,
      connected: false,
      backendConfigured: true,
      problemCode: problem.code,
      problem: problem.message
    };
  });

  // The troop registry is derived only from Vercel environment variables. It changes
  // when the project is redeployed, not on every request, so let the edge serve it
  // briefly while revalidating stale entries in the background.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({
    troops,
    ...(Object.keys(misconfigured).length ? { misconfigured } : {}),
    _note: 'Troop config comes ONLY from Vercel env vars: TROOP_<id>_BACKEND / TROOP_<id>_APIKEY / TROOP_<id>_NAME (後端GS 對應). troops.json 已棄用. B (deploy URL) and D (apikey) stay server-side: 前端只收到 connected=true。所有業務請求行同源 /api/proxy。0082 同 82 視為同一團。',
    _hint: Object.keys(troops).length === 0
      ? (Object.keys(misconfigured).length
        ? '有旅團功能變數但格式無效（見 misconfigured）：請修正 TROOP_<id>_BACKEND 為「部署 → 管理部署」的 /exec 網址（不可有引號、空白、/dev、?參數），儲存後 Redeploy。'
        : '未設定任何旅團功能變數：請 APP ADMIN 喺 Vercel Settings → Environment Variables 加 TROOP_0082_BACKEND / TROOP_0082_APIKEY / TROOP_0082_NAME，然後 Redeploy。')
      : undefined,
    _debug: {
      totalRegistryKeys: Object.keys(registry).length,
      uniqueTroops: Object.keys(troops).length
    }
  });
};
