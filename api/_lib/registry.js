// Shared registry loader for multi-troop system — 功能變數契約（4樣）
//
// 死規矩：旅團設定淨係「指向」Vercel 環境變數（功能變數），唔讀 JSON、唔內置 URL：
//   SUPER_KEY            — APP ADMIN 設定嘅管理 key（/api/proxy 超管登入比對用；Vercel 端唯一來源。
//                          注意：公開「新旅團接入申請」/api/register 唔用 SUPER_KEY，亦絕不轉發此值）
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
/**
 * 清洗功能變數值：APP ADMIN 喺 Vercel 貼值時，好易連埋引號／角括號／前後空白／
 * 換行一齊貼（"https://…/exec"、<https://…/exec>、'…'、…/exec\r\n）。
 * 呢啲字元會令 URL 解析失敗，繼而被當成「未登記旅團」。
 * 只做「明顯唔屬於值」的包裹字元去除，唔會猜測／改寫實際 URL。
 */
function cleanEnvValue(value) {
  let v = String(value == null ? '' : value).trim();
  // 貼上時常見的 Unicode 空白（NBSP / 全角空格 / 零寬）→ 普通空白後再 trim
  v = v.replace(/[\u00A0\u2007\u202F\u3000\u200B\uFEFF]/g, ' ').trim();
  // 去引號／角括號包裹：可以連續幾層（"https://…" 或 <"https://…">）
  for (let i = 0; i < 3; i++) {
    const before = v;
    v = v.replace(/^["'`<>]+/, '').replace(/["'`<>]+$/, '').trim();
    if (v === before) break;
  }
  // 中間夾咗換行（Vercel 貼多行）→ 取第一段非空行
  if (/[\r\n]/.test(v)) v = v.split(/[\r\n]+/).map(s => s.trim()).filter(Boolean)[0] || '';
  return v.trim();
}

function readTroopEnv(idUpper, suffix) {
  const idNoZero = normalizeStripped(idUpper);
  const idPadded = normalizeToPadded4(idUpper);
  const raw = process.env[`TROOP_${idUpper}_${suffix}`] ||
         process.env[`TROOP_${idNoZero}_${suffix}`] ||
         process.env[`TROOP_${idPadded}_${suffix}`] || '';
  const value = cleanEnvValue(raw);
  // 只作診斷用：登記值存在但清洗後變空（例如只填了引號／空白）
  if (raw && !value) return { value: '', rawHadValue: true, emptyAfterClean: true };
  return { value, rawHadValue: !!String(raw || '').trim(), emptyAfterClean: false };
}

// ---------- GAS /exec URL 正規化 ----------
// Google Workspace（例如 xx@scouting.org.hk）部署出嚟嘅 web app，URL 會多一段網域：
//   https://script.google.com/a/scouting.org.hk/macros/s/<id>/exec   ← 網域內網址（形式2）
//   https://script.google.com/a/macros/scouting.org.hk/s/<id>/exec ← 實際 getService().getUrl() 回報形式（形式1）
//   https://script.google.com/macros/s/<id>/exec                     ← 公開網址
// 只將合法 HTTPS 網址轉成相同部署 ID 嘅公開路徑格式；唔代表已核實部署身份，
// 亦唔會改變 Google 存取權限。能否連線仍取決於實際部署及授權設定。
function normalizeGasUrl(urlString) {
  const raw = String(urlString == null ? '' : urlString).trim();
  if (!raw) return '';
  let u;
  try { u = new URL(raw); } catch (e) { return raw; }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com' ||
      u.search || u.hash || u.username || u.password || u.port) return raw;
  let m = u.pathname.match(/^\/a\/[^/]+\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (m) return `https://script.google.com/macros/s/${m[1]}/exec`;
  m = u.pathname.match(/^\/a\/macros\/[^/]+\/s\/([A-Za-z0-9_-]+)\/exec$/);
  if (m) return `https://script.google.com/macros/s/${m[1]}/exec`;
  return raw;
}

/** 係咪 Workspace 網域內網址（/a/<domain>/macros/s/.../exec 或 /a/macros/<domain>/s/.../exec）。 */
function isDomainScopedGasUrl(urlString) {
  try {
    const u = new URL(String(urlString == null ? '' : urlString).trim());
    if (u.hostname !== 'script.google.com') return false;
    return /^\/a\/[^/]+\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) ||
           /^\/a\/macros\/[^/]+\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname);
  } catch (e) { return false; }
}

function canonicalBackendUrl(backend) {
  const raw = String(backend || '').trim();
  try {
    const target = new URL(raw);
    if (target.hostname !== 'script.google.com') return raw;
    const match = target.pathname.match(/^\/a\/macros\/[^/]+(\/s\/.+)$/);
    if (match) {
      target.pathname = `/macros${match[1]}`;
      return target.toString();
    }
    const alt = target.pathname.match(/^\/a\/[^/]+(\/macros\/s\/.+)$/);
    if (alt) {
      target.pathname = alt[1];
      return target.toString();
    }
    return target.toString();
  } catch (_) {
    return raw;
  }
}

function backendHash(backend) {
  return crypto.createHash('sha256').update(String(backend), 'utf8').digest('hex');
}

function backendHashes(backend) {
  const canonical = canonicalBackendUrl(backend);
  return new Set([backendHash(String(backend)), backendHash(canonical)]);
}

function backendMatches(storedBackend, providedBackend) {
  const sHashes = backendHashes(storedBackend);
  const pHashes = backendHashes(providedBackend);
  for (const h of pHashes) if (sHashes.has(h)) return true;
  return false;
}

function getRegistry() {
  const registry = {};
  const backendProblems = new Map();   // padded id → 問題清單（唔含 URL 值，只講「哪一部分唔合格」）

  // 淨係掃功能變數：TROOP_<id>_BACKEND / _APIKEY / _NAME（大小寫兼容、0082/82 兼容）
  const idsFromEnv = new Set();
  Object.keys(process.env).forEach(k => {
    const m = k.match(/^TROOP_(\d+[A-Z]?)_(BACKEND|APIKEY|NAME)$/i);
    if (m) idsFromEnv.add(m[1].toUpperCase());
  });

  idsFromEnv.forEach(idUpper => {
    const backendRaw = readTroopEnv(idUpper, 'BACKEND');
    const apikeyRaw = readTroopEnv(idUpper, 'APIKEY');
    const nameRaw = readTroopEnv(idUpper, 'NAME');

    const backend = normalizeGasUrl(backendRaw.value);
    const apikey = apikeyRaw.value;
    const name = nameRaw.value || `第 ${normalizeStripped(idUpper)} 旅`;

    // 有 backend 先算有效旅團（backend = 後端GS 嘅 /exec URL）
    if (!backend) {
      // 有填但清洗後為空（只填了引號／空白／換行）也要講清楚，唔可以當成「完全冇填」。
      const hadRaw = backendRaw.rawHadValue || apikeyRaw.rawHadValue || nameRaw.rawHadValue;
      if (hadRaw) {
        backendProblems.set(
          normalizeToPadded4(idUpper),
          backendRaw.rawHadValue
            ? diagnoseGasUrl(backendRaw.value || ' ')
            : { code: 'NO_BACKEND', message: `只設定了 APIKEY／NAME，但沒有 TROOP_${normalizeToPadded4(idUpper)}_BACKEND；系統需要後端 /exec 網址才可以連線。` }
        );
      }
      return;
    }

    const entry = {
      name,
      backend,
      apikey,
      _env: {
        backend: !!backendRaw.value,
        apikey: !!apikeyRaw.value,
        name: !!nameRaw.value,
        // 診斷用：功能變數填咗 Workspace 網域內網址（/a/<domain>/…），已自動轉公開網址。
        domainScoped: isDomainScopedGasUrl(backendRaw.value)
      },
      // 診斷用：登記了但 URL 不合格（例如貼成 /dev、帶路徑／query、或根本不是 GAS URL）。
      // 這類旅團唔會出現在可用清單，但仍然要講得出「你的功能變數有填，只是格式不對」。
      backendValid: isValidGasUrl(backend)
    };
    if (!entry.backendValid) {
      backendProblems.set(normalizeToPadded4(idUpper), diagnoseGasUrl(backendRaw.value));
    }

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

  // 非列舉屬性：唔會影響 `for (const id in reg)` 或 Object.keys(...)，
  // 只有診斷路徑（proxy 404、/api/health）會讀。
  Object.defineProperty(registry, '_backendProblems', {
    value: backendProblems, enumerable: false, configurable: true, writable: true
  });

  return registry;
}

function getTroopsRegistry() {
  return getRegistry();
}

/**
 * 診斷一個「有填但用唔到」的 TROOP_<id>_BACKEND 值。
 * 只回問題代碼／中文說明，永不回傳值本身（同 health 一樣：只講「有冇設定」）。
 * @returns {{code:string, message:string}}
 */
function diagnoseGasUrl(rawValue) {
  const raw = cleanEnvValue(rawValue);
  const original = String(rawValue == null ? '' : rawValue);
  if (!original.trim()) return { code: 'EMPTY', message: 'TROOP_<id>_BACKEND 是空的（或只有引號／空白）。' };
  if (!raw) return { code: 'EMPTY_AFTER_CLEAN', message: '功能變數值只有引號／空白／換行，清洗後是空的。' };
  let u;
  try { u = new URL(raw); } catch (e) {
    return { code: 'NOT_A_URL', message: '不是有效網址：請貼上完整的 https://script.google.com/macros/s/…/exec（勿加說明文字或空格）。' };
  }
  if (u.protocol !== 'https:') return { code: 'NOT_HTTPS', message: '必須用 https://（http:// 會被拒）。' };
  if (u.hostname !== 'script.google.com') {
    return { code: 'WRONG_HOST', message: `主機必須是 script.google.com，但填了 ${u.hostname}。請用「部署 → 管理部署」提供的網址。` };
  }
  if (u.search || u.hash) return { code: 'HAS_QUERY_OR_HASH', message: '網址帶了 ? 參數或 # 片段，請只保留結尾為 /exec 的網址。' };
  if (u.username || u.password || u.port) return { code: 'HAS_CREDENTIALS_OR_PORT', message: '網址含帳密或自訂 port，請用 Google 提供的原網址。' };
  if (!/\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) &&
      !/^\/a\/[^/]+\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname) &&
      !/^\/a\/macros\/[^/]+\/s\/[A-Za-z0-9_-]+\/exec$/.test(u.pathname)) {
    if (/\/dev$/.test(u.pathname)) {
      return { code: 'DEV_URL', message: '這是 /dev（測試部署）網址；系統只認 /exec（正式部署）。請貼 /exec 那條。' };
    }
    return { code: 'NOT_EXEC_PATH', message: '路徑必須是 /macros/s/<部署ID>/exec；請在「部署 → 管理部署」複製 Web 應用程式網址。' };
  }
  const m = u.pathname.match(/[A-Za-z0-9_-]{10,}/g);
  if (!m) return { code: 'SHORT_DEPLOY_ID', message: '部署 ID 太短，似是被截斷；請重新複製完整網址。' };
  return { code: 'UNKNOWN', message: '格式未能通過檢查；請重新複製「部署 → 管理部署」的 /exec 網址。' };
}

/** 該旅團的 backend 功能變數「有填但唔合格」時的診斷（冇問題回 null）。 */
function getBackendProblem(troopId) {
  if (troopId === undefined || troopId === null) return null;
  const reg = getRegistry();
  const problems = reg._backendProblems;
  if (!problems || !problems.size) return null;
  const padded = normalizeToPadded4(troopId);
  return problems.get(padded) || problems.get(normalizeStripped(troopId)) || null;
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
  const raw = cleanEnvValue(urlString);
  if (!raw) return false;
  // 本機 mock 後端（只限非生產環境，方便 devserver 預覽）
  try {
    const probe = new URL(raw);
    if (probe.hostname === 'localhost' || probe.hostname === '127.0.0.1' || probe.hostname === '::1') {
      return !(process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production');
    }
  } catch (e) { return false; }
  // Workspace 網域內網址（/a/<domain>/…）先轉公開網址再驗；兩者同樣只認 GAS /exec。
  try {
    const u = new URL(normalizeGasUrl(raw));
    if (u.protocol !== 'https:') return false;
    if (u.hostname !== 'script.google.com') return false;
    if (u.search || u.hash || u.username || u.password || u.port) return false;
    const match = u.pathname.match(/^\/macros\/s\/([A-Za-z0-9_-]+)\/exec$/);
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
  normalizeGasUrl,
  isDomainScopedGasUrl,
  canonicalBackendUrl,
  backendHash,
  backendHashes,
  backendMatches,
  normalizeToPadded4,
  normalizeStripped,
  cleanEnvValue,
  diagnoseGasUrl,
  getBackendProblem,
  getSuperKey,
  verifySuperKey,
  superKeyConfigured
};
