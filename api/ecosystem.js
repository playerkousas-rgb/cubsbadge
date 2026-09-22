// ============================================================
// /api/ecosystem — 本 leaf 嘅接入口
//
// 本系統 = 幼童軍進度追蹤,生態圈最下游嘅 leaf。
// 呢個端點淨係做「自我描述」同「收上游接入」,唔會主動打上游。
//
//   ?action=registry      我係邊個單位、我有咩模組、點搵到我（公開,永無 apikey）
//   ?action=modules       本單位啟用咗嘅模組
//   ?action=flush         清 cache（需 EC_FLUSH_KEY）
//   ?action=stats         cache 狀態（診斷用）
//   POST action=sigLogin  上層簽發嘅 sig 換本 leaf session（BUILD.md §2 三點進入之一）
//
// 死規矩: apikey 只存 server（env）,永不回前端、永不入 URL、永不入 QR。
// ============================================================

const { normId, strippedId, isValidUnitId } = require('./_lib/normid');
const { getTroopConfig, superKeyConfigured } = require('./_lib/registry');
const eco = require('./_lib/ecosystem');
const { verifySig } = require('./_lib/sig');

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
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  shim(res);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const query = req.query || {};
  const body = (req.method === 'POST') ? await readBody(req) : {};
  const action = String(body.action || query.action || 'registry');
  const rawUnit = body.unit || body.troopId || query.unit || query.troopId || query.u || '0082';
  const unit = normId(rawUnit);

  if (!isValidUnitId(unit)) {
    return res.status(400).json({ success: false, error: `Invalid unit id: ${rawUnit}` });
  }

  try {
    if (action === 'flush') {
      const key = String(req.headers['x-ec-flush-key'] || body.flushKey || query.key || '');
      const expected = process.env.EC_FLUSH_KEY || '';
      if (!expected) return res.status(503).json({ success: false, error: 'EC_FLUSH_KEY 未設定，flush endpoint 停用' });
      if (key !== expected) return res.status(403).json({ success: false, error: 'Forbidden' });
      const cleared = eco.cacheFlush(query.scope === 'all' ? null : `unit:${unit}`);
      return res.status(200).json({ success: true, cleared, scope: query.scope === 'all' ? 'all' : unit });
    }

    if (action === 'stats') {
      return res.status(200).json({ success: true, cache: eco.cacheStats() });
    }

    // ---------- sigLogin：上層 sig 換 leaf session（BUILD.md §2）----------
    // 呢度係接入口嘅核心:上游（旅系統／地域）簽張飛落嚟,本 leaf 認得就俾入。
    // 本 leaf 唔會反過來打上游 —— 要接入係上游打落嚟。
    if (action === 'sigLogin') {
      const cfg = getTroopConfig(unit);
      if (!cfg) return res.status(404).json({ success: false, error: `Unregistered unit: ${unit}` });
      if (!cfg.apikey) {
        // key 未設定 = 拒絕敏感 action（BUILD.md §10 施工次序 1）
        return res.status(503).json({ success: false, error: 'SIG 未啟用：此單位未設定 apikey（TROOP_<id>_APIKEY）' });
      }
      const payload = body.payload || {};
      const v = verifySig(cfg.apikey, payload, body.sig);
      if (!v.ok) return res.status(401).json({ success: false, error: `SIG 驗證失敗: ${v.error}` });
      if (normId(v.scope.childId) !== unit) {
        return res.status(401).json({ success: false, error: 'SIG childId 與請求單位不符' });
      }
      const enabled = eco.resolveModules(unit);
      const target = v.scope.target || 'progress';
      const gate = eco.assertModuleEnabled(target, enabled);
      if (!gate.ok) return res.status(403).json({ success: false, error: gate.error, code: gate.code });
      // 只回 scope，唔回 apikey；前端之後照行 /api/proxy（server 端先 inject key）。
      return res.status(200).json({
        success: true,
        unit,
        scope: v.scope,
        modules: enabled,
        note: 'sig 已驗；apikey 永不回傳，業務請求一律經同源 /api/proxy。'
      });
    }

    // ---------- registry / modules ----------
    const platform = eco.getPlatformUnits();
    const meta = platform[unit] || null;
    const cfg = getTroopConfig(unit);
    const enabled = eco.resolveModules(unit);

    if (action === 'modules') {
      return res.status(200).json({
        success: true,
        unit,
        modules: enabled,
        detail: eco.describeModules(enabled)
      });
    }

    // 預設 registry：本 leaf 嘅自我描述
    return res.status(200).json({
      success: true,
      unit,
      normalized: { padded: unit, stripped: strippedId(unit) },
      identity: { axiom: 'SCOUT_ID + 所在 SHEET' },
      role: 'leaf',
      system: 'cub-progress',
      platform: {
        registered: !!meta || !!cfg,
        // v3.0：NAME 指向功能變數 TROOP_<id>_NAME（registry cfg 先行；units.json 只係後備）
        name: (cfg && cfg.name) || (meta && meta.name) || `第 ${strippedId(unit)} 旅`,
        branch: (meta && meta.branch) || '幼童軍',
        sheet: (meta && meta.sheet) || '',
        backendConfigured: !!(cfg && cfg.backend),
        apikeyConfigured: !!(cfg && cfg.apikey),
        superKeyConfigured: superKeyConfigured(),
        // 後端GS 對應：Vercel 功能變數名（只有名，永無值）
        envNames: {
          superKey: (meta && meta._superKeyEnv) || 'SUPER_KEY',
          backend: (meta && meta._backendEnv) || `TROOP_${unit}_BACKEND`,
          apikey: (meta && meta._apikeyEnv) || `TROOP_${unit}_APIKEY`,
          name: (meta && meta._nameEnv) || `TROOP_${unit}_NAME`
        },
        registeredVia: (meta && meta.registered_via) || (cfg ? 'env' : null)
      },
      modules: enabled,
      detail: eco.describeModules(enabled),
      upstream: {
        // 開定俾上游嘅接入口。本 leaf 唔會主動打出去。
        sigLogin: 'POST /api/ecosystem {action:"sigLogin", unit, payload, sig}',
        sigAlgorithm: 'HMAC-SHA256(本單位 apikey, canonical(payload))',
        payloadFields: ['childId', 'sub', 'role', 'children', 'target', 'exp'],
        maxTtlSec: 1800,
        doc: 'docs/ECOSYSTEM.md'
      },
      _note: 'apikey 永不出現喺此回應；一切業務請求經同源 /api/proxy 由伺服器注入。'
    });
  } catch (err) {
    console.error('[ecosystem]', String(err && err.message).slice(0, 200));
    return res.status(500).json({ success: false, error: `ecosystem error: ${err.message}` });
  }
};
