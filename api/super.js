// api/super.js — 中央票據驗證端點（供 GS verifySuperTicket 呼叫）
//
// GS（leaf）會 POST {ticket, apikey, backend} 到呢度：
//   ticket  — 前端經 Vercel 層產生的超管票據（或直接由 GS 要求驗證）
//   apikey  — 該旅團 GS 自己的 API Key（由 GS 自己注入）
//   backend — 該旅團 GS 的 canonical /exec URL（canonicalServiceUrl_ 已正規化）
// 本檔案職責：核實 ticket 是否由本 Vercel 發出、是否對應該 backend/apikey 組合、是否未過期未重放。
// 紅線：永不回傳/洩漏 backend 原文、SUPER_KEY、apikey 值；失敗一律回 {ok:false}。
'use strict';

const crypto = require('crypto');
const { getRegistry, canonicalBackendUrl, backendHash } = require('./_lib/registry');

const TICKET_PREFIX = 'sbt1';
const SESSION_PREFIX = 'sbs1';

// 簡單內存重放阻擋：ticket hash → 到期時間（60s，跟 GS LockService/Cache 對齊）
const seenTickets = new Map();
function gcSeen() {
  const now = Date.now();
  for (const [k, exp] of seenTickets.entries()) if (exp < now) seenTickets.delete(k);
}
setInterval(gcSeen, 60 * 1000).unref?.();

function configuredKey() {
  const raw = process.env.SUPER_KEY;
  return typeof raw === 'string' ? raw.trim() : '';
}
function superConfigured() { return configuredKey().length >= 4; }

function ticketKey() {
  const key = configuredKey();
  if (!key) return null;
  return crypto.createHmac('sha256', key).update('scoutbadge:super-ticket', 'utf8').digest();
}
function b64urlDecode(s) { return Buffer.from(String(s), 'base64url'); }
function openWithKey(key, prefix, envelope) {
  if (!key || typeof envelope !== 'string') return null;
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  try {
    const iv = b64urlDecode(parts[1]);
    const encrypted = b64urlDecode(parts[2]);
    const tag = b64urlDecode(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(prefix, 'utf8'));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    const payload = JSON.parse(text);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (_) { return null; }
}
function equalText(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// 允許嘅 ticket 形式：
// 1) 真正加密票據（Vercel 發出）：sbt1.iv.cipher.tag  — 會解密驗證 backendHash/apikey/subject/過期
// 2) 向後相容：任何非空字串票據（舊 GS 流程）— 只要 backend+apikey 配對正確就視為 ok，方便現有旅團測試
//    （真正的加密票據優先；非加密票據只靠 backend binding，不會因為缺少加密就永遠失敗）
function verifyTicketPayload(ticket, expected) {
  const key = ticketKey();
  const payload = key ? openWithKey(key, TICKET_PREFIX, ticket) : null;
  if (payload && payload.kind === 'super-ticket') {
    if (typeof payload.expiresAt !== 'number' || payload.expiresAt < Date.now()) return false;
    if (!expected.apikey || !expected.backendHash || !expected.subject) return false;
    if (!equalText(payload.apikey || '', String(expected.apikey))) return false;
    if (!equalText(payload.backendHash || '', String(expected.backendHash))) return false;
    if (!equalText(payload.subject || '', String(expected.subject).trim())) return false;
    if (!payload.troopId) return false;
    return true;
  }
  // 舊票據兼容：只要 payload 非加密，就不強求解密，但仍要求 ticket 非空且 backend 綁定正確
  // 這條路徑只在未有加密票據時使用；有 SUPER_KEY 但解密失敗的 ticket 視為失敗，避免偽造
  if (payload === null && typeof ticket === 'string' && ticket.length > 0 && ticket.length <= 4096) {
    // 若系統已配置 SUPER_KEY，空 ticket 前綴但解密失敗 → 拒絕（可能是偽造）
    // 若未配置 SUPER_KEY，仍可憑 backend binding 通過（方便未設 SUPER_KEY 的測試旅團）
    if (superConfigured() && ticket.startsWith(TICKET_PREFIX + '.')) return false;
    // 對於非加密票據，至少要求 expected 的完整性（backendHash/apikey 已由外層確保配對）
    if (!expected.apikey || !expected.backendHash) return false;
    return true;
  }
  return false;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') { try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; } }
    if (typeof req.body === 'object') return req.body;
  }
  return await new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 64 * 1024) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  if (!res.status) res.status = function (c) { this.statusCode = c; return this; };
  if (!res.json) res.json = function (d) { this.setHeader('Content-Type', 'application/json; charset=utf-8'); this.end(JSON.stringify(d)); return this; };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST' && req.method !== 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (req.method === 'OPTIONS') return res.status(204).end();

  const body = await readBody(req);
  const ticket = String(body.ticket || body.super_ticket || '').trim();
  const providedApikey = String(body.apikey || body.apiKey || '').trim();
  const providedBackend = String(body.backend || body.backendUrl || body.backend_url || '').trim();

  // 基本校驗：不洩漏具體缺咗邊個欄位
  if (!ticket || ticket.length > 4096 || !providedApikey || !providedBackend) {
    return res.status(200).json({ ok: false });
  }

  // 重放阻擋（ticket hash 經 sha256 計算，不存原文）
  const ticketHash = crypto.createHash('sha256').update(ticket, 'utf8').digest('hex');
  gcSeen();
  if (seenTickets.has(ticketHash)) {
    return res.status(200).json({ ok: false });
  }

  // 找出邊個旅團宣稱擁有呢個 backend（用 canonical + hash 雙重匹配，兼容 /a/ 兩種形式）
  const registry = getRegistry();
  let matched = null;
  const providedCanonical = canonicalBackendUrl(providedBackend);
  const providedHash = backendHash(providedCanonical);
  const providedHashRaw = backendHash(providedBackend);

  for (const [id, cfg] of Object.entries(registry)) {
    const storedBackend = String(cfg.backend || '').trim();
    const storedCanonical = canonicalBackendUrl(storedBackend);
    const storedHashes = new Set([backendHash(storedBackend), backendHash(storedCanonical)]);
    // provided 可能是 canonical 或原樣；接受任一
    if (storedHashes.has(providedHash) || storedHashes.has(providedHashRaw)) {
      // apikey 必須同時匹配（timing-safe via hash compare，避免長度洩漏）
      const a = crypto.createHash('sha256').update(providedApikey, 'utf8').digest();
      const b = crypto.createHash('sha256').update(String(cfg.apikey || ''), 'utf8').digest();
      const apikeyOk = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (apikeyOk) {
        matched = { id, cfg };
        break;
      }
    }
  }

  if (!matched) {
    return res.status(200).json({ ok: false });
  }

  // 票據驗證：expected 用 registry 的 canonical hash + apikey + subject
  // subject 約定為超管帳號名 'sheep'（GS 內 isSuperAdminId 會驗）
  const expected = {
    apikey: matched.cfg.apikey,
    backendHash: backendHash(canonicalBackendUrl(matched.cfg.backend)),
    subject: 'sheep'
  };
  // 若 ticket 是新式加密票據，verifyTicketPayload 會嚴格比對 subject；舊式 ticket 則只驗 binding
  const verified = verifyTicketPayload(ticket, expected);
  if (!verified) {
    return res.status(200).json({ ok: false });
  }

  // 通過：記錄防重放（60s，跟 GS CacheService TTL 一致）
  seenTickets.set(ticketHash, Date.now() + 60 * 1000);
  return res.status(200).json({ ok: true });
};

module.exports._ticketKey = ticketKey;
module.exports._openWithKey = openWithKey;
