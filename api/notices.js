// ============================================================
// /api/notices — 通告頁資料源 (BUILD.md §4)
//
// 「通告頁 = 本單位通告 + 用戶已訂閱嘅圖書館通告，同頁同列表
//  （來源標示），附件指返圖書館。」
//
// 本單位通告：經 /api/proxy → leaf 後端（有 notice 模組先至有）
// 圖書館通告：讀公開 cache（GitHub Raw CDN，同圖書館前端同一份），
//            按用戶本機訂閱設定（由前端傳上嚟）做命中過濾。
//
// 訂閱設定存用戶本機 LocalStorage，唔經 server 長存；
// 呢度只係「即傳即算」，算完唔留底。
// ============================================================

const { normId, isValidUnitId } = require('./_lib/normid');
const eco = require('./_lib/ecosystem');

const CACHE_RAW = process.env.CIRCULAR_CACHE_URL
  || 'https://raw.githubusercontent.com/playerkousas-rgb/scout-circulars/main/cache.json';
const ENRICH_RAW = process.env.CIRCULAR_ENRICH_URL
  || 'https://raw.githubusercontent.com/playerkousas-rgb/scout-circulars/main/enrich.json';
const CATALOG_RAW = process.env.CIRCULAR_CATALOG_URL
  || 'https://raw.githubusercontent.com/playerkousas-rgb/scout-circulars/main/subscription_catalog.json';
const LIBRARY_BASE = (process.env.CIRCULAR_LIBRARY_URL || 'https://scout-circulars.vercel.app').replace(/\/+$/, '');

const TTL_MS = 10 * 60 * 1000;
const MAX_ITEMS = 60;

const _mem = new Map(); // url -> { at, data }

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

async function getJson(url, ttl = TTL_MS) {
  const hit = _mem.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(url, { redirect: 'follow', signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _mem.set(url, { at: Date.now(), data });
    return data;
  } finally { clearTimeout(timer); }
}

function noticeUrl(item) { return item.url || item.pdf_url || ''; }

/**
 * subscription_matches 的 JS 版 —— 規則同 notify.py 一模一樣：
 *   all:new 全收；否則「支部 AND 項目」，唔同選項取 OR，唔會交叉命中。
 */
function matches(prefs, meta, topicById) {
  const topics = new Set(prefs.topics || []);
  if (topics.has('all:new')) return true;
  const branches = new Set(prefs.branches || []);
  const noticeBranches = new Set(meta.branch_tags || []);
  const noticeTopics = new Set(meta.topic_tags || []);
  for (const topicId of topics) {
    const topic = topicById[topicId];
    if (!topic) continue;
    const scope = new Set(topic.branches || []);
    let eligible = [...branches].filter((b) => noticeBranches.has(b));
    if (!scope.has('*')) eligible = eligible.filter((b) => scope.has(b));
    if (eligible.length && noticeTopics.has(topic.match_topic || topicId)) return true;
  }
  return false;
}

function labelFor(catalog, prefs) {
  const byId = {};
  (catalog.topics || []).forEach((t) => { byId[t.id] = t; });
  return (prefs.topics || []).map((id) => (byId[id] ? `${byId[id].group} · ${byId[id].label}` : id));
}

module.exports = async function handler(req, res) {
  shim(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const query = req.query || {};
  const body = (req.method === 'POST') ? await readBody(req) : {};
  const rawUnit = body.unit || body.troopId || query.unit || query.troopId || query.u || '0082';
  const unit = normId(rawUnit);
  if (!isValidUnitId(unit)) return res.status(400).json({ success: false, error: `Invalid unit: ${rawUnit}` });

  // server-side 模組 gate：notice 模組停用 → 拒絕（BUILD.md §4）
  const troopReg = await eco.getTroopRegistry(unit);
  const enabled = eco.resolveModules(unit, troopReg.modules);
  const gate = eco.assertModuleEnabled('notice', enabled);
  if (!gate.ok) return res.status(403).json({ success: false, error: gate.error, code: gate.code });

  const prefs = {
    branches: Array.isArray(body.branches) ? body.branches : String(query.branches || '').split(',').filter(Boolean),
    topics: Array.isArray(body.topics) ? body.topics : String(query.topics || '').split(',').filter(Boolean)
  };

  if (!prefs.topics.length) {
    return res.status(200).json({
      success: true, unit, items: [], subscribed: false,
      hint: '未設定個人化訂閱。喺「通告」頁揀支部×項目即可，設定只存喺你部機。'
    });
  }

  try {
    const [cacheData, catalog] = await Promise.all([getJson(CACHE_RAW), getJson(CATALOG_RAW, 60 * 60 * 1000)]);
    let enrich = {};
    try { enrich = await getJson(ENRICH_RAW); } catch (e) { /* enrich 係錦上添花，冇都照行 */ }

    const topicById = {};
    (catalog.topics || []).forEach((t) => { topicById[t.id] = t; });

    const notices = Array.isArray(cacheData.notices) ? cacheData.notices : [];
    const out = [];
    for (const item of notices) {
      const url = noticeUrl(item);
      const ex = (enrich && enrich[url]) || {};
      const meta = {
        branch_tags: ex.branch_tags || [],
        topic_tags: ex.subscription_tags || []
      };
      if (!matches(prefs, meta, topicById)) continue;
      out.push({
        title: item.title || '',
        source: item.source_site || item.region || '',
        region: item.region || '',
        date: item.captured_date || item.date || '',
        url: url,
        attachment: item.pdf_url || url,   // 附件指返圖書館
        deadline: ex.deadline || '',
        audience: ex.audience || '',
        fee: ex.fee || '',
        branches: meta.branch_tags,
        topics: meta.topic_tags,
        origin: 'library'                   // 同頁同列表，來源標示
      });
      if (out.length >= MAX_ITEMS) break;
    }

    return res.status(200).json({
      success: true,
      unit,
      subscribed: true,
      catalogVersion: catalog.version || '',
      lastUpdated: cacheData.last_updated || '',
      library: LIBRARY_BASE,
      selection: labelFor(catalog, prefs),
      total: out.length,
      items: out,
      _note: '圖書館通告為公開 cache；訂閱設定存喺用戶本機，未有傳送任何身份資料。'
    });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: '通告圖書館連線逾時' });
    console.error('[notices]', String(err && err.message).slice(0, 200));
    return res.status(502).json({ success: false, error: `通告讀取失敗: ${err.message}` });
  }
};
