// ============================================================
// ecosystem.js — 本 leaf 的接入口（進度追蹤 = 最下游）
//
// 本系統係「幼童軍進度追蹤」,喺生態圈入面係一個 leaf:
//   一張 SHEET + 一支 Apps Script /exec = 一個 leaf。
//
// 呢個檔淨係做兩件事:
//   1. 描述自己 —— 我係邊個單位、我有咩模組、點搵到我;
//   2. 開定接入口 —— 上游（旅系統／地域）要接入時,照住呢個契約嚟接。
//
// 刻意唔做嘅嘢（唔關 leaf 事,唔好加返落嚟）:
//   - 唔會主動打去上游攞 registry（上游要接就上游打落嚟）;
//   - 唔會做通告圖書館、推送訂閱呢啲上游／外部系統嘅嘢;
//   - 唔會代其他 leaf 決定佢哋有咩模組。
//
// 唯一紅線: apikey 只存 server（env）,永不回前端、永不入 URL、永不入 QR。
// 功能變數契約: SUPER_KEY + TROOP_<id>_BACKEND / TROOP_<id>_APIKEY / TROOP_<id>_NAME（全部由 APP ADMIN 喺 Vercel 設定）
//   —— 設定全部指向 Vercel 功能變數（唔讀 JSON）；後端GS 對應 Script Properties。
// ============================================================

const fs = require('fs');
const path = require('path');
const { normId, strippedId, idVariants, isValidUnitId } = require('./normid');

const CACHE_TTL_MS = 5 * 60 * 1000;

// ---------- 模組註冊表 ----------
// 只列本 leaf 自己承載嘅模組。BUILD.md §4 訂明「進度追蹤保留自己嗰套 UI,
// 豁免統一」,所以呢度唔跟旅系統嗰套導航,只係向上游申報「我有咩」。
const MODULE_REGISTRY = [
  { id: 'progress', name: '我的進度',   name_en: 'My Progress',     order: 10, perm: 'member', core: true,  doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'overview', name: '全團總覽',   name_en: 'Troop Overview',  order: 20, perm: 'scoped', core: true,  doc: 'docs/LEADER_GUIDE.md' },
  { id: 'requests', name: '審批中心',   name_en: 'Approvals',       order: 30, perm: 'leader', core: true,  doc: 'docs/LEADER_GUIDE.md' },
  { id: 'logs',     name: '活動履歷',   name_en: 'Activity Logs',   order: 40, perm: 'member', core: true,  doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'forms',    name: '金紫荊申請', name_en: 'Golden Bauhinia', order: 60, perm: 'member', core: true,  doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'help',     name: '教學',       name_en: 'Guide',           order: 70, perm: 'member', core: true,  doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'info',     name: '資料庫',     name_en: 'Library',         order: 80, perm: 'member', core: true,  doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'users',    name: '用戶管理',   name_en: 'Users',           order: 90, perm: 'leader', core: true,  doc: 'docs/LEADER_GUIDE.md' }
];

/** 本 leaf 承載嘅模組 id。 */
const LOCAL_MODULES = MODULE_REGISTRY.map((m) => m.id);

// ---------- units.json ----------
function loadUnitsFile() {
  const candidates = [
    path.join(process.cwd(), 'data', 'units.json'),
    path.join(__dirname, '..', '..', 'data', 'units.json')
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (e) { /* 壞檔不可以拖冧整個 registry */ }
  }
  return { units: {} };
}

/** 本平台登記咗嘅單位（公開 metadata,永不含 apikey）。 */
function getPlatformUnits() {
  const file = loadUnitsFile();
  const out = {};
  Object.keys(file.units || {}).forEach((rawId) => {
    const id = normId(rawId);
    if (!isValidUnitId(id)) return;
    const u = file.units[rawId] || {};
    out[id] = {
      id,
      name: u.name || `第 ${strippedId(id)} 旅`,
      branch: u.branch || '幼童軍',
      sheet: u.sheet || '',
      modules: Array.isArray(u.modules) ? u.modules : [],
      registered_via: u.registered_via || 'admin',
      registered_at: u.registered_at || '',
      _backendEnv: u.backend_env || `TROOP_${id}_BACKEND`,
      _apikeyEnv: u.apikey_env || `TROOP_${id}_APIKEY`,
      _nameEnv: u.name_env || `TROOP_${id}_NAME`,
      _superKeyEnv: u.super_key_env || 'SUPER_KEY'
    };
  });
  return out;
}

// ---------- env 讀取（server-only）----------
function envFor(id, suffix) {
  for (const v of idVariants(id)) {
    const key = `TROOP_${String(v).toUpperCase()}_${suffix}`;
    if (process.env[key]) return process.env[key];
  }
  return '';
}

// ---------- 5 分鐘 cache（含手動 flush）----------
const _cache = new Map(); // key -> { at, value }

function cacheGet(key) {
  const hit = _cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) { _cache.delete(key); return undefined; }
  return hit.value;
}
function cacheSet(key, value) { _cache.set(key, { at: Date.now(), value }); return value; }
function cacheFlush(key) {
  if (key) { const had = _cache.delete(key); return had ? 1 : 0; }
  const n = _cache.size; _cache.clear(); return n;
}
function cacheStats() {
  const now = Date.now();
  return {
    entries: Array.from(_cache.keys()),
    size: _cache.size,
    ttlMs: CACHE_TTL_MS,
    ages: Array.from(_cache.entries()).map(([k, v]) => ({ key: k, ageMs: now - v.at }))
  };
}

/**
 * 本單位啟用咗邊啲模組。
 *
 * leaf 自己話事: units.json 冇特別聲明就係全部模組。
 * 上游想收窄,可以喺 units.json 嘅 modules 明列 —— 但 core 模組永遠開,
 * 否則 leaf 自己都入唔到自己。
 */
function resolveModules(unitId) {
  const platform = getPlatformUnits()[normId(unitId)];
  const declared = (platform && platform.modules.length) ? platform.modules : LOCAL_MODULES;
  const enabled = new Set(declared.filter((m) => LOCAL_MODULES.indexOf(m) >= 0));
  MODULE_REGISTRY.filter((m) => m.core).forEach((m) => enabled.add(m.id));
  return Array.from(enabled);
}

/** 模組清單（供上游知道本 leaf 有咩,唔係用嚟生成本站導航）。 */
function describeModules(enabledModules) {
  const set = new Set(enabledModules);
  return MODULE_REGISTRY
    .filter((m) => set.has(m.id))
    .sort((a, b) => a.order - b.order)
    .map((m) => ({ id: m.id, name: m.name, name_en: m.name_en, perm: m.perm, doc: m.doc }));
}

/** server-side 模組 gate: 停用模組一律拒絕讀寫。 */
function assertModuleEnabled(moduleId, enabledModules) {
  if (!moduleId) return { ok: true };
  if (enabledModules.indexOf(moduleId) >= 0) return { ok: true };
  return { ok: false, error: `模組 ${moduleId} 未為此單位啟用`, code: 'module_disabled' };
}

module.exports = {
  CACHE_TTL_MS,
  MODULE_REGISTRY,
  LOCAL_MODULES,
  getPlatformUnits,
  envFor,
  resolveModules,
  describeModules,
  assertModuleEnabled,
  cacheGet,
  cacheSet,
  cacheFlush,
  cacheStats
};
