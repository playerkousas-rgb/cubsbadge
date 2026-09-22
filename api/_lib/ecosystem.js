// ============================================================
// ecosystem.js — BUILD.md §1 兩層 registry + §4 模組註冊表 + 5 分鐘 cache
//
//   平台層 (platform): data/units.json 公開 metadata + Vercel env
//                      TROOP_<id>_BACKEND / TROOP_<id>_APIKEY
//   旅層   (troop)    : TROOP_OPS leaf（旅系統 Sheet）一張表存各支部 key，
//                      Vercel server-to-server 讀 + cache 5 分鐘 + 手動 flush
//
// 公理二：一切接入 = 交俾邊個 + 登記邊個 registry。
// apikey 只存 server（env / OPS 表），永不回前端、永不入 URL、永不入 QR。
// ============================================================

const fs = require('fs');
const path = require('path');
const { normId, strippedId, idVariants, isValidUnitId } = require('./normid');

const CACHE_TTL_MS = 5 * 60 * 1000; // BUILD.md §1：cache 5 分鐘

// ---------- 模組註冊表（BUILD.md §4）----------
// 每個功能 = 模組（名、入口位置、所需權限、開關、說明頁）。
// 導航由註冊表自動生成，最多兩層。分享目標清單亦由此表過濾
// （「分享前設 = 接收方都有該模組」）。
const MODULE_REGISTRY = [
  { id: 'progress', name: '我的進度',   name_en: 'My Progress',      slot: 'main', order: 10, perm: 'member',  core: true,  shareable: false, doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'overview', name: '全團總覽',   name_en: 'Troop Overview',   slot: 'main', order: 20, perm: 'scoped',  core: true,  shareable: false, doc: 'docs/LEADER_GUIDE.md' },
  { id: 'requests', name: '審批中心',   name_en: 'Approvals',        slot: 'main', order: 30, perm: 'leader',  core: true,  shareable: false, doc: 'docs/LEADER_GUIDE.md' },
  { id: 'logs',     name: '活動履歷',   name_en: 'Activity Logs',    slot: 'main', order: 40, perm: 'member',  core: true,  shareable: false, doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'notice',   name: '通告',       name_en: 'Circulars',        slot: 'main', order: 50, perm: 'member',  core: false, shareable: true,  doc: 'docs/ECOSYSTEM.md' },
  { id: 'forms',    name: '金紫荊申請', name_en: 'Golden Bauhinia',  slot: 'main', order: 60, perm: 'member',  core: true,  shareable: false, doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'help',     name: '教學',       name_en: 'Guide',            slot: 'main', order: 70, perm: 'member',  core: true,  shareable: false, doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'info',     name: '資料庫',     name_en: 'Library',          slot: 'main', order: 80, perm: 'member',  core: true,  shareable: false, doc: 'docs/MEMBER_GUIDE.md' },
  { id: 'users',    name: '用戶管理',   name_en: 'Users',            slot: 'main', order: 90, perm: 'leader',  core: true,  shareable: false, doc: 'docs/LEADER_GUIDE.md' },
  { id: 'calendar', name: '行事曆',     name_en: 'Calendar',         slot: 'ops',  order: 55, perm: 'member',  core: false, shareable: true,  doc: 'docs/ECOSYSTEM.md' },
  { id: 'album',    name: '相簿',       name_en: 'Album',            slot: 'ops',  order: 56, perm: 'member',  core: false, shareable: true,  doc: 'docs/ECOSYSTEM.md' },
  { id: 'items',    name: '物資',       name_en: 'Inventory',        slot: 'ops',  order: 57, perm: 'leader',  core: false, shareable: true,  doc: 'docs/ECOSYSTEM.md' },
  { id: 'finance',  name: '財務',       name_en: 'Finance',          slot: 'ops',  order: 58, perm: 'leader',  core: false, shareable: false, doc: 'docs/ECOSYSTEM.md' }
];

// 本 leaf（進度追蹤前端）實際承載的模組；其餘靠旅系統 TROOP_OPS 提供。
const LOCAL_MODULES = ['progress', 'overview', 'requests', 'logs', 'notice', 'forms', 'help', 'info', 'users'];

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

/** 平台層 registry：公開 metadata（永不含 apikey）。 */
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
      _opsEnv: u.ops_env || `TROOP_${id}_OPS_BACKEND`
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

/** 旅系統 (TROOP_OPS) leaf 的 /exec；冇設定即係該單位未接入旅系統。 */
function getOpsBackend(unitId) {
  return envFor(unitId, 'OPS_BACKEND') || process.env.TROOP_OPS_BACKEND || '';
}
function getOpsApikey(unitId) {
  return envFor(unitId, 'OPS_APIKEY') || process.env.TROOP_OPS_APIKEY || '';
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

// ---------- 旅層 registry：server-to-server 讀 TROOP_OPS ----------
async function fetchJson(url, { timeoutMs = 10000, method = 'GET', body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: body ? { 'Content-Type': 'text/plain;charset=utf-8' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await resp.text();
    try { return { ok: resp.ok, status: resp.status, json: JSON.parse(text) }; }
    catch (e) { return { ok: false, status: resp.status, json: null, raw: text.slice(0, 300) }; }
  } finally { clearTimeout(timer); }
}

/**
 * 讀旅層 registry（TROOP_OPS Sheet 一張表存各支部 key）。
 * 回傳只含公開欄位；apikey 留喺 server 內部 map，永不外洩。
 * cache 5 分鐘，可經 /api/ecosystem?action=flush 手動清。
 */
async function getTroopRegistry(unitId, { force = false } = {}) {
  const id = normId(unitId);
  const key = `ops:${id}`;
  if (!force) {
    const hit = cacheGet(key);
    if (hit) return hit;
  }
  const backend = getOpsBackend(id);
  if (!backend) {
    return cacheSet(key, { ok: false, reason: 'ops_not_configured', unit: id, branches: [], modules: null });
  }
  try {
    const url = new URL(backend);
    url.searchParams.set('action', 'opsRegistry');
    url.searchParams.set('unit', id);
    const apikey = getOpsApikey(id);
    if (apikey) url.searchParams.set('apikey', apikey);
    const res = await fetchJson(url.toString(), { timeoutMs: 10000 });
    if (!res.ok || !res.json || res.json.success === false) {
      return cacheSet(key, { ok: false, reason: 'ops_unreachable', unit: id, branches: [], modules: null, detail: res.json?.error || res.raw || `HTTP ${res.status}` });
    }
    const branches = (res.json.branches || []).map((b) => ({
      id: normId(b.id || b.branchId || ''),
      name: b.name || '',
      branch: b.branch || '',
      modules: Array.isArray(b.modules) ? b.modules : [],
      hasKey: !!(b.apikey || b.hasKey)
      // 注意：b.apikey 刻意唔放入回傳物件 —— apikey 永不出 server。
    }));
    return cacheSet(key, {
      ok: true,
      unit: id,
      opsVersion: res.json.version || '',
      branches,
      modules: res.json.modules || null, // TROOP_MODULES 全模組開關
      fetchedAt: new Date().toISOString()
    });
  } catch (e) {
    return cacheSet(key, { ok: false, reason: 'ops_error', unit: id, branches: [], modules: null, detail: String(e.message || e).slice(0, 200) });
  }
}

/**
 * TROOP_MODULES 開關解析（BUILD.md §4）。
 * 旅長／管理員設定，可全旅或指定支部；server-side 拒絕停用模組讀寫。
 */
function resolveModules(unitId, opsModules) {
  const platform = getPlatformUnits()[normId(unitId)];
  const declared = (platform && platform.modules.length) ? platform.modules : LOCAL_MODULES;
  const enabled = new Set(declared.filter((m) => LOCAL_MODULES.indexOf(m) >= 0 || MODULE_REGISTRY.some((x) => x.id === m)));
  if (opsModules && typeof opsModules === 'object') {
    Object.keys(opsModules).forEach((m) => {
      const on = opsModules[m] === true || opsModules[m] === 'true' || opsModules[m] === 1;
      if (on) enabled.add(m); else enabled.delete(m);
    });
  }
  // core 模組唔可以被關掉（否則 leaf 自己都入唔到）
  MODULE_REGISTRY.filter((m) => m.core && LOCAL_MODULES.indexOf(m.id) >= 0).forEach((m) => enabled.add(m.id));
  return Array.from(enabled);
}

/** 導航（最多兩層）：由模組註冊表自動生成，掣位統一。 */
function buildNavigation(enabledModules) {
  const set = new Set(enabledModules);
  return MODULE_REGISTRY
    .filter((m) => set.has(m.id))
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      id: m.id, name: m.name, name_en: m.name_en,
      slot: m.slot, perm: m.perm, local: LOCAL_MODULES.indexOf(m.id) >= 0, doc: m.doc
    }));
}

/** 可分享目標：接收方都要有該模組，否則分享唔入去（BUILD.md §4）。 */
function shareTargets(moduleId, branches) {
  const mod = MODULE_REGISTRY.find((m) => m.id === moduleId);
  if (!mod || !mod.shareable) return [];
  return (branches || [])
    .filter((b) => (b.modules || []).indexOf(moduleId) >= 0)
    .map((b) => ({ id: b.id, name: b.name, branch: b.branch }));
}

/** server-side 模組 gate：停用模組一律拒絕讀寫。 */
function assertModuleEnabled(moduleId, enabledModules) {
  if (!moduleId) return { ok: true };
  if (enabledModules.indexOf(moduleId) >= 0) return { ok: true };
  return { ok: false, error: `模組 ${moduleId} 未為此單位啟用（TROOP_MODULES 已停用）`, code: 'module_disabled' };
}

module.exports = {
  CACHE_TTL_MS,
  MODULE_REGISTRY,
  LOCAL_MODULES,
  getPlatformUnits,
  getOpsBackend,
  getOpsApikey,
  getTroopRegistry,
  resolveModules,
  buildNavigation,
  shareTargets,
  assertModuleEnabled,
  cacheGet,
  cacheSet,
  cacheFlush,
  cacheStats
};
