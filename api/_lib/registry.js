// Shared registry loader for multi-troop system — 功能變數契約（4樣）
//
// 死規矩：旅團設定淨係「指向」Vercel 環境變數（功能變數），唔讀 JSON、唔內置 URL：
//   SUPER_KEY            — APP ADMIN 設定嘅管理 key（保護 /api/register 等管理 API；Vercel 端唯一來源）
//   TROOP_<id>_BACKEND   — 該旅團 GS /exec URL（後端GS 對應：部署 URL）
//   TROOP_<id>_APIKEY    — 該旅團 GS API Key（後端GS 對應：Script Property API_KEY）
//   TROOP_<id>_NAME      — 該旅團名稱（後端GS 對應：Script Property TROOP_NAME）
//
// data/troops.json / troops.json 已棄用（deprecated stub），程式唔再讀取。
// 之前 URL/name 指向 JSON、超管密碼寫死 —— 已全部更正為指向功能變數。
// 誰設定：全部功能變數由 APP ADMIN（Vercel Project 維護者）設定；旅團只提供編號／部署 URL／API KEY。

const crypto = require('crypto');
// BUILD.md §1：normId 單一實現。registry 唔可以另外寫一套正規化。
const { normId, strippedId } = require('./normid');

// 以下兩個只係 normId 的別名，保留舊名以免散落各處的呼叫點要一次過改。
function normalizeToPadded4(id) {
  if (!id) return id;
  return normId(id);
}

function normalizeStripped(id) {
  if (!id) return id;
  return strippedId(id);
}

// ---------- SUPER_KEY（全 APP 一個；由 APP ADMIN 喺 Vercel 設定）----------
function getSuperKey() {
  return String(process.env.SUPER_KEY || '');
}

function superKeyConfigured() {
  return !!process.env.SUPER_KEY;
}

/** timing-safe 驗證 SUPER_KEY（管理 API 用；值永不外洩、永不回傳）。 */
function verifySuperKey(provided) {
  const expected = getSuperKey();
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- TROOP_<id>_* 功能變數讀取（server-only）----------
function readTroopEnv(idUpper, suffix) {
  const idNoZero = normalizeStripped(idUpper);
  const idPadded = normalizeToPadded4(idUpper);
  return process.env[`TROOP_${idUpper}_${suffix}`] ||
         process.env[`TROOP_${idNoZero}_${suffix}`] ||
         process.env[`TROOP_${idPadded}_${suffix}`] || '';
}

function getRegistry() {
  const registry = {};

  // 淨係掃功能變數：TROOP_<id>_BACKEND / _APIKEY / _NAME（大小寫兼容、0082/82 兼容）
  const idsFromEnv = new Set();
  Object.keys(process.env).forEach(k => {
    const m = k.match(/^TROOP_(\d+[A-Z]?)_(BACKEND|APIKEY|NAME)$/i);
    if (m) idsFromEnv.add(m[1].toUpperCase());
  });

  idsFromEnv.forEach(idUpper => {
    const backendEnv = readTroopEnv(idUpper, 'BACKEND');
    const apikeyEnv = readTroopEnv(idUpper, 'APIKEY');
    const nameEnv = readTroopEnv(idUpper, 'NAME');

    const backend = backendEnv;
    const apikey = apikeyEnv;
    const name = nameEnv || `第 ${normalizeStripped(idUpper)} 旅`;

    // 有 backend 先算有效旅團（backend = 後端GS 嘅 /exec URL）
    if (!backend) return;

    const entry = {
      name,
      backend,
      apikey,
      _env: { backend: !!backendEnv, apikey: !!apikeyEnv, name: !!nameEnv }
    };

    const idNoZero = normalizeStripped(idUpper);
    const idPadded = normalizeToPadded4(idUpper);
    const variants = new Set([
      idUpper,
      idNoZero,
      idPadded,
      idUpper.toLowerCase(),
      String(idUpper).replace(/^0+/, '') || idUpper
    ]);
    variants.forEach(v => {
      if (v) registry[v] = entry;
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
      // 同一條 URL 規則（isValidGasUrl）：生產只認 GAS /exec；
      // 非生產環境（本機／沙盒預覽）容許 localhost mock 後端，方便 devserver 預覽。
      if (!isValidGasUrl(entry.backend)) continue;
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
  getSuperKey,
  verifySuperKey,
  superKeyConfigured
};
