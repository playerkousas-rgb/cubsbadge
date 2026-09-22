// ============================================================
// sig.js — BUILD.md §2 上層 sig（三點進入之一）
//
//   sig = HMAC(下級apikey, childId|sub|role|children|target|exp)
//   sub = EMAIL / YMIS，exp 15-30 分鐘，綁 session jti；
//   下級用自己 key 重算驗證，scope 簽死喺 sig 內。
//
// 用途：旅系統 / 平台把一位用戶「送落」本 leaf（進度追蹤）時，
//       唔使傳密碼、唔使傳 apikey，只憑簽名證明身份與 scope。
// 零依賴：原生 node:crypto（BUILD.md §10 體積治理）。
// ============================================================

const crypto = require('crypto');
const { normId } = require('./normid');

const DEFAULT_TTL_SEC = 20 * 60;   // 20 分鐘，落在 §2 規定嘅 15-30 分鐘之內
const MAX_TTL_SEC = 30 * 60;
const CLOCK_SKEW_SEC = 60;

/** 正規化 canonical string —— 兩邊必須逐字一樣，先算得出同一個 HMAC。 */
function canonical({ childId, sub, role, children, target, exp, jti }) {
  const kids = Array.isArray(children) ? children.slice().map((c) => String(c).trim()).filter(Boolean).sort() : [];
  return [
    normId(childId),
    String(sub || '').trim().toLowerCase(),
    String(role || '').trim(),
    kids.join(','),
    String(target || '').trim(),
    String(exp),
    String(jti || '')
  ].join('|');
}

function hmac(key, msg) {
  return crypto.createHmac('sha256', String(key)).update(msg, 'utf8').digest('base64url');
}

/**
 * 簽發 sig。上級（旅系統／平台）用「下級 apikey」簽。
 * @returns {{sig:string, exp:number, jti:string, payload:object}}
 */
function signSig(childApikey, { childId, sub, role, children, target, ttlSec, jti } = {}) {
  if (!childApikey) throw new Error('signSig: missing child apikey');
  if (!childId) throw new Error('signSig: missing childId');
  if (!sub) throw new Error('signSig: missing sub');
  const ttl = Math.min(Math.max(Number(ttlSec) || DEFAULT_TTL_SEC, 60), MAX_TTL_SEC);
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const id = jti || crypto.randomBytes(12).toString('base64url');
  const payload = {
    childId: normId(childId),
    sub: String(sub).trim().toLowerCase(),
    role: String(role || 'member'),
    children: Array.isArray(children) ? children : [],
    target: String(target || ''),
    exp,
    jti: id
  };
  return { sig: hmac(childApikey, canonical(payload)), exp, jti: id, payload };
}

/**
 * 驗證 sig。下級（本 leaf）用自己 apikey 重算。
 * timing-safe 比較；scope（role/children/target）簽死喺 sig 內，唔可以事後加料。
 */
function verifySig(childApikey, payload, sig) {
  if (!childApikey) return { ok: false, error: 'apikey_not_configured' };
  if (!sig || typeof sig !== 'string') return { ok: false, error: 'missing_sig' };
  const exp = Number(payload && payload.exp);
  if (!Number.isFinite(exp)) return { ok: false, error: 'missing_exp' };
  const now = Math.floor(Date.now() / 1000);
  if (exp < now - CLOCK_SKEW_SEC) return { ok: false, error: 'sig_expired' };
  if (exp > now + MAX_TTL_SEC + CLOCK_SKEW_SEC) return { ok: false, error: 'exp_too_far' };

  const expected = hmac(childApikey, canonical(payload));
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  if (a.length !== b.length) return { ok: false, error: 'bad_sig' };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, error: 'bad_sig' };

  return {
    ok: true,
    scope: {
      childId: normId(payload.childId),
      sub: String(payload.sub || '').toLowerCase(),
      role: String(payload.role || 'member'),
      children: Array.isArray(payload.children) ? payload.children : [],
      target: String(payload.target || ''),
      jti: String(payload.jti || ''),
      exp
    }
  };
}

/** 供分享連結／QR 用的短 token —— 不含任何 key，只證明「呢個公開項目可以睇」。 */
function signShareToken(secret, { unit, moduleId, itemId, exp }) {
  const msg = [normId(unit), String(moduleId || ''), String(itemId || ''), String(exp)].join('|');
  return hmac(secret, msg);
}
function verifyShareToken(secret, { unit, moduleId, itemId, exp }, token) {
  if (!secret || !token) return false;
  const now = Math.floor(Date.now() / 1000);
  if (Number(exp) < now) return false;
  const expected = signShareToken(secret, { unit, moduleId, itemId, exp });
  const a = Buffer.from(expected); const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  DEFAULT_TTL_SEC,
  MAX_TTL_SEC,
  canonical,
  signSig,
  verifySig,
  signShareToken,
  verifyShareToken
};
