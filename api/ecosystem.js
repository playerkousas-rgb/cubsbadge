// ============================================================
// /api/ecosystem — 旅團生態圈接入端點 (BUILD.md §1 §2 §4 §5)
//
//   ?action=registry   兩層 registry 合併結果（公開 metadata，永無 apikey）
//   ?action=modules    TROOP_MODULES 解析後的啟用模組 + 自動導航
//   ?action=share      某模組可分享到邊啲支部（接收方要有該模組）
//   ?action=flush      手動清 5 分鐘 cache（需 EC_FLUSH_KEY）
//   ?action=stats      cache 狀態（診斷用）
//   POST action=sigLogin  上層 sig 換本 leaf session（§2 三點進入之一）
//
// 死規矩：apikey 只存 server（env / OPS 表），永不回前端、永不入 URL、永不入 QR。
// ============================================================

const { normId, strippedId, isValidUnitId } = require('./_lib/normid');
const { getTroopConfig } = require('./_lib/registry');
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
    // ---------- flush：手動清 cache（BUILD.md §1）----------
    if (action === 'flush') {
      const key = String(req.headers['x-ec-flush-key'] || body.flushKey || query.key || '');
      const expected = process.env.EC_FLUSH_KEY || '';
      if (!expected) return res.status(503).json({ success: false, error: 'EC_FLUSH_KEY 未設定，flush endpoint 停用' });
      if (key !== expected) return res.status(403).json({ success: false, error: 'Forbidden' });
      const cleared = eco.cacheFlush(query.scope === 'all' ? null : `ops:${unit}`);
      return res.status(200).json({ success: true, cleared, scope: query.scope === 'all' ? 'all' : unit });
    }

    if (action === 'stats') {
      return res.status(200).json({ success: true, cache: eco.cacheStats() });
    }

    // ---------- sigLogin：上層 sig 換 leaf session（BUILD.md §2）----------
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
      const enabled = eco.resolveModules(unit, (await eco.getTroopRegistry(unit)).modules);
      const target = v.scope.target || 'progress';
      const gate = eco.assertModuleEnabled(target === 'progress' ? 'progress' : target, enabled);
      if (!gate.ok) return res.status(403).json({ success: false, error: gate.error, code: gate.code });
      // 只回 scope，唔回 apikey；前端之後照行 /api/proxy（server 端先 inject key）。
      return res.status(200).json({
        success: true,
        unit,
        scope: v.scope,
        modules: enabled,
        navigation: eco.buildNavigation(enabled),
        note: 'sig 已驗；apikey 永不回傳，業務請求一律經同源 /api/proxy。'
      });
    }

    // ---------- registry / modules / share ----------
    const platform = eco.getPlatformUnits();
    const meta = platform[unit] || null;
    const cfg = getTroopConfig(unit);
    const force = query.force === '1' || body.force === true;
    const troopReg = await eco.getTroopRegistry(unit, { force });
    const enabled = eco.resolveModules(unit, troopReg.modules);

    if (action === 'modules') {
      return res.status(200).json({
        success: true,
        unit,
        modules: enabled,
        navigation: eco.buildNavigation(enabled),
        registryModules: eco.MODULE_REGISTRY,
        opsLinked: troopReg.ok
      });
    }

    if (action === 'share') {
      const moduleId = String(body.module || query.module || 'notice');
      const gate = eco.assertModuleEnabled(moduleId, enabled);
      if (!gate.ok) return res.status(403).json({ success: false, error: gate.error, code: gate.code });
      return res.status(200).json({
        success: true,
        unit,
        module: moduleId,
        targets: eco.shareTargets(moduleId, troopReg.branches),
        note: '分享前設 = 接收方都有該模組；冇該模組嘅支部唔會出現喺清單。'
      });
    }

    // 預設 registry
    return res.status(200).json({
      success: true,
      unit,
      normalized: { padded: unit, stripped: strippedId(unit) },
      identity: { axiom: 'SCOUT_ID + 所在 SHEET' },
      platform: {
        registered: !!meta || !!cfg,
        name: (meta && meta.name) || (cfg && cfg.name) || `第 ${strippedId(unit)} 旅`,
        branch: (meta && meta.branch) || '幼童軍',
        sheet: (meta && meta.sheet) || '',
        backendConfigured: !!(cfg && cfg.backend),
        apikeyConfigured: !!(cfg && cfg.apikey),
        registeredVia: (meta && meta.registered_via) || (cfg ? 'env' : null)
      },
      troop: {
        opsLinked: troopReg.ok,
        reason: troopReg.ok ? null : troopReg.reason,
        opsVersion: troopReg.opsVersion || null,
        branches: troopReg.branches || [],
        fetchedAt: troopReg.fetchedAt || null,
        cacheTtlMs: eco.CACHE_TTL_MS
      },
      modules: enabled,
      navigation: eco.buildNavigation(enabled),
      _note: 'apikey 永不出現喺此回應；一切業務請求經同源 /api/proxy 由伺服器注入。'
    });
  } catch (err) {
    console.error('[ecosystem]', String(err && err.message).slice(0, 200));
    return res.status(500).json({ success: false, error: `ecosystem error: ${err.message}` });
  }
};
