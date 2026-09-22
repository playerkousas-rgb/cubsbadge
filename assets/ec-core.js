/* ============================================================
 * ec-core.js — 生態圈前端核心 (BUILD.md §1 §2 §5)
 *
 * 內容：
 *   1. normId 鏡像（同 api/_lib/normid.js 逐字同一套規則）
 *   2. /api/ecosystem 客戶端：registry / 模組 / 導航
 *   3. 分享 (Share) 連結 + QR — 純前端生成，永不帶 key
 *
 * 死規矩（§5 三個概念唔同）：
 *   內部分享 = 揀支部；Share 連結/QR = 開就睇到，唔使密碼；
 *   公開頁 = 要登入先入到。
 * ============================================================ */
(function (global) {
  'use strict';

  // ---------- 1. normId（唯一規則的前端鏡像）----------
  function normId(id) {
    if (id === undefined || id === null) return '';
    var s = String(id).trim().toUpperCase();
    if (!s) return '';
    var m = s.match(/^0*(\d+)([A-Z]*)$/);
    if (!m) return s;
    return ('0000' + m[1]).slice(-Math.max(4, m[1].length)) + (m[2] || '');
  }
  function sameUnit(a, b) { var na = normId(a); return !!na && na === normId(b); }
  function strippedId(id) {
    var n = normId(id);
    var m = n.match(/^0*(\d+)([A-Z]*)$/);
    return m ? (m[1].replace(/^0+(?=\d)/, '') + (m[2] || '')) : n;
  }

  // ---------- 2. registry / 模組 / 導航 ----------
  var _eco = { data: null, at: 0 };
  var ECO_TTL = 5 * 60 * 1000; // 同 server 一樣 5 分鐘

  function loadEcosystem(unit, force) {
    if (!force && _eco.data && _eco.data.unit === normId(unit) && Date.now() - _eco.at < ECO_TTL) {
      return Promise.resolve(_eco.data);
    }
    var qs = 'unit=' + encodeURIComponent(normId(unit)) + (force ? '&force=1' : '');
    return fetch('/api/ecosystem?action=registry&' + qs, { headers: { 'Cache-Control': 'no-store' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.success === false) throw new Error((d && d.error) || 'ecosystem 讀取失敗');
        _eco = { data: d, at: Date.now() };
        return d;
      });
  }

  /** 模組啟用？server-side 一樣有 gate，前端呢個只係唔畫入口。 */
  function moduleEnabled(id) {
    return !!(_eco.data && (_eco.data.modules || []).indexOf(id) >= 0);
  }
  function navigation() { return (_eco.data && _eco.data.navigation) || []; }
  function opsLinked() { return !!(_eco.data && _eco.data.troop && _eco.data.troop.opsLinked); }

  /** 分享目標（接收方都要有該模組，否則根本唔會出現）。 */
  function shareTargets(unit, moduleId) {
    return fetch('/api/ecosystem?action=share&unit=' + encodeURIComponent(normId(unit)) + '&module=' + encodeURIComponent(moduleId))
      .then(function (r) { return r.json(); });
  }

  // ---------- 3. 分享連結 + QR ----------
  /**
   * 生成分享連結。收到嘅人直接開嗰一頁，唔使任何密碼。
   * 連結／QR 永不帶 apikey、永不帶 session token。
   */
  function shareUrl(opts) {
    opts = opts || {};
    var base = global.location.origin + global.location.pathname;
    var p = new URLSearchParams();
    p.set('share', opts.module || 'notice');
    if (opts.unit) p.set('u', normId(opts.unit));
    if (opts.itemId) p.set('id', String(opts.itemId));
    if (opts.title) p.set('t', String(opts.title).slice(0, 120));
    return base + '?' + p.toString();
  }

  function whatsappUrl(url, text) {
    return 'https://wa.me/?text=' + encodeURIComponent((text ? text + '\n' : '') + url);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta); resolve();
      } catch (e) { reject(e); }
    });
  }

  /**
   * 分享 QR（SVG 字串）。內容只係一條公開 URL —— 永不帶 apikey／session token。
   * 實作在 assets/ec-qr.js（零依賴、零網絡，唔會將分享連結送去第三方 QR 服務）。
   */
  function qrSvg(text, opts) {
    if (!global.ECQr) return null;
    // 內容太長（超出 QR v40 容量）時回 null —— 呼叫端改為只顯示連結，唔會畫個壞 QR 出嚟。
    return global.ECQr.toSvg(String(text), opts || { scale: 4, quiet: 4 }) || null;
  }

  global.ECCore = {
    normId: normId,
    sameUnit: sameUnit,
    strippedId: strippedId,
    loadEcosystem: loadEcosystem,
    moduleEnabled: moduleEnabled,
    navigation: navigation,
    opsLinked: opsLinked,
    shareTargets: shareTargets,
    shareUrl: shareUrl,
    whatsappUrl: whatsappUrl,
    copyText: copyText,
    qrSvg: qrSvg
  };
})(typeof window !== 'undefined' ? window : this);
