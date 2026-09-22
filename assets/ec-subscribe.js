/* ============================================================
 * ec-subscribe.js — 個人化訂閱前端 (BUILD.md §4 ★ 重中之重)
 *
 * 定位：「push 內建咗就唔使『拉落嚟』、領袖唔使多理一樣嘢，
 *        通告自動去到啱嘅人手上。」
 *
 * 每個用戶（領袖／成員／家長）喺自己系統管理自己訂閱：
 *   揀支部（小童軍/幼童軍/童軍/深資/樂行/領袖/家長/會務委員）
 *   × 分類（訓練/服務/活動/比賽/未分類）
 * 設定存本機 LocalStorage，命中即推，同一通告只推一次。
 *
 * 零身份外洩：只有 endpoint + keys + branch_ids + topic_ids 上行，
 * 冇 YMIS、冇 email、冇姓名。館方知「幾多人訂、訂咩」，唔知「邊個」。
 * ============================================================ */
(function (global) {
  'use strict';

  var LS_PREFS = 'ec_sub_prefs_v1';
  var LS_TOKEN = 'ec_sub_client_token_v1';
  var SW_PATH = '/sw.js';

  var state = {
    config: null,      // { enabled, vapidPublicKey, catalog, library }
    loading: null,
    lastError: ''
  };

  // ---------- 本機設定 ----------
  function loadPrefs() {
    try {
      var raw = localStorage.getItem(LS_PREFS);
      if (!raw) return { branches: [], topics: [], pushEnabled: false };
      var p = JSON.parse(raw);
      return {
        branches: Array.isArray(p.branches) ? p.branches : [],
        topics: Array.isArray(p.topics) ? p.topics : [],
        pushEnabled: !!p.pushEnabled
      };
    } catch (e) { return { branches: [], topics: [], pushEnabled: false }; }
  }
  function savePrefs(p) {
    try { localStorage.setItem(LS_PREFS, JSON.stringify(p)); } catch (e) {}
    return p;
  }
  function clientToken() {
    var t = '';
    try { t = localStorage.getItem(LS_TOKEN) || ''; } catch (e) {}
    if (!t) {
      var bytes = new Uint8Array(24);
      (global.crypto || {}).getRandomValues ? global.crypto.getRandomValues(bytes)
        : bytes.forEach(function (_, i) { bytes[i] = Math.floor(Math.random() * 256); });
      t = Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      try { localStorage.setItem(LS_TOKEN, t); } catch (e) {}
    }
    return t;
  }

  // ---------- 字典 ----------
  function loadConfig(force) {
    if (state.config && !force) return Promise.resolve(state.config);
    if (state.loading && !force) return state.loading;
    state.loading = fetch('/api/subscriptions?action=config', { headers: { 'Cache-Control': 'no-store' } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || d.success === false) throw new Error((d && d.error) || '訂閱設定讀取失敗');
        state.config = d;
        state.lastError = d.catalogError || d.configError || '';
        return d;
      })
      .catch(function (e) { state.lastError = e.message; throw e; })
      .finally(function () { state.loading = null; });
    return state.loading;
  }

  /** 把字典拆成 支部 → 分組 → 項目，供設定介面直接渲染。 */
  function groupTopics(catalog, branchIds) {
    var out = [];
    if (!catalog) return out;
    var selected = branchIds && branchIds.length ? branchIds : (catalog.branches || []).map(function (b) { return b.id; });
    (catalog.branches || []).forEach(function (b) {
      if (selected.indexOf(b.id) < 0) return;
      var groups = {};
      (catalog.topics || []).forEach(function (t) {
        if (t.kind === 'all') return;
        var scope = t.branches || [];
        if (scope.indexOf('*') < 0 && scope.indexOf(b.id) < 0) return;
        var g = t.group || '其他';
        (groups[g] = groups[g] || []).push({ id: t.id, label: t.label });
      });
      var groupList = Object.keys(groups).map(function (g) { return { group: g, topics: groups[g] }; });
      if (groupList.length) out.push({ branch: b.id, label: b.label, groups: groupList });
    });
    return out;
  }

  // ---------- Web Push ----------
  function pushSupported() {
    return ('serviceWorker' in navigator) && ('PushManager' in global) && ('Notification' in global);
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var raw = global.atob(base64);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function registerSW() {
    return navigator.serviceWorker.register(SW_PATH).then(function (reg) {
      return navigator.serviceWorker.ready.then(function () { return reg; });
    });
  }

  /** 建立／更新訂閱：SW 用圖書館 VAPID public key 訂閱，再寫入同一張 Supabase 表。 */
  function enablePush(prefs) {
    if (!pushSupported()) return Promise.reject(new Error('此瀏覽器不支援推播通知（iOS 需先「加到主畫面」）'));
    return loadConfig().then(function (cfg) {
      if (!cfg.enabled || !cfg.vapidPublicKey) throw new Error('通告圖書館未開啟推播服務');
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('未授權通知權限');
        return registerSW();
      }).then(function (reg) {
        return reg.pushManager.getSubscription().then(function (existing) {
          if (existing) return existing;
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey)
          });
        });
      }).then(function (sub) {
        var json = sub.toJSON();
        return fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'upsert',
            clientToken: clientToken(),
            subscription: { endpoint: json.endpoint, keys: json.keys },
            branches: prefs.branches,
            topics: prefs.topics
          })
        }).then(function (r) { return r.json(); }).then(function (d) {
          if (!d || d.success === false) {
            var e = new Error((d && (d.message || d.error)) || '訂閱寫入失敗');
            e.code = d && d.error;
            throw e;
          }
          savePrefs({ branches: prefs.branches, topics: prefs.topics, pushEnabled: true });
          return d;
        });
      });
    });
  }

  function disablePush() {
    var p = loadPrefs();
    savePrefs({ branches: p.branches, topics: p.topics, pushEnabled: false });
    if (!pushSupported()) return Promise.resolve({ success: true });
    return navigator.serviceWorker.getRegistration(SW_PATH).then(function (reg) {
      if (!reg) return null;
      return reg.pushManager.getSubscription();
    }).then(function (sub) {
      var endpoint = sub ? sub.endpoint : '';
      var done = sub ? sub.unsubscribe() : Promise.resolve(true);
      return done.then(function () {
        return fetch('/api/subscriptions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'delete', clientToken: clientToken(), endpoint: endpoint })
        }).then(function (r) { return r.json(); }).catch(function () { return { success: true, offline: true }; });
      });
    });
  }

  /** 通告頁：本單位通告 + 已訂閱嘅圖書館通告（同頁同列表）。 */
  function fetchSubscribedNotices(unit) {
    var prefs = loadPrefs();
    if (!prefs.topics.length) return Promise.resolve({ success: true, items: [], subscribed: false });
    return fetch('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unit: unit, branches: prefs.branches, topics: prefs.topics })
    }).then(function (r) { return r.json(); });
  }

  // SW 叫我哋重新同步（endpoint 被瀏覽器換咗）
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', function (event) {
      if (event.data && event.data.type === 'cubbadge-push-subscription-change') {
        var p = loadPrefs();
        if (p.pushEnabled && p.topics.length) enablePush(p).catch(function () {});
      }
    });
  }

  global.ECSubscribe = {
    loadPrefs: loadPrefs,
    savePrefs: savePrefs,
    loadConfig: loadConfig,
    groupTopics: groupTopics,
    pushSupported: pushSupported,
    enablePush: enablePush,
    disablePush: disablePush,
    fetchSubscribedNotices: fetchSubscribedNotices,
    lastError: function () { return state.lastError; }
  };
})(typeof window !== 'undefined' ? window : this);
