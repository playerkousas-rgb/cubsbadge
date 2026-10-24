/* Keep an already-downloaded app shell in sync with the deployed frontend.
 * No service worker, cache deletion, logout, or business-storage migration.
 * A legacy page without this script cannot be retroactively repaired by it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else {
    var guard = factory(root);
    guard.start();
  }
})(typeof window !== 'undefined' ? window : globalThis, function createFrontendFreshness(env) {
  'use strict';
  var APP = 'cubsbadge';
  var KEY = 'cubbadge_frontend_reload:';
  var PARAM = '_frontend';
  var pending = null;
  var checking = null;
  var started = false;
  var stopped = false;
  var timeoutMs = 4000;
  var meta = env.document.querySelector('meta[name="cubsbadge-build"]');
  var build = meta ? meta.getAttribute('content') : '';
  var attempted = new Set();

  function validBuild(value) {
    return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z._-]{0,79}$/.test(value);
  }
  function notify() {
    if (typeof env.showToast !== 'function') return;
    var en = env.document.documentElement.lang === 'en';
    env.showToast(en
      ? 'A newer website version is available. Save your changes first; it will be checked again when you return.'
      : '網站有新版本。請先儲存正在編輯的內容；返回頁面時會再檢查。', 'warning');
  }
  function reloadIfSafe(target) {
    if (stopped || !validBuild(target) || target === build) return false;
    if (typeof env.canReloadFrontend !== 'function' || !env.canReloadFrontend()) {
      pending = target;
      notify();
      return false;
    }
    var url = new URL(env.location.href);
    // The URL is a second loop guard when sessionStorage is unavailable.
    if (url.searchParams.get(PARAM) === target || attempted.has(target)) return false;
    try { if (env.sessionStorage.getItem(KEY + target) === '1') return false; } catch (_) {}
    attempted.add(target);
    try { env.sessionStorage.setItem(KEY + target, '1'); } catch (_) {}
    pending = null;
    // Preserve portal/query parameters and fragment; do not use reload()'s cache semantics.
    url.searchParams.set(PARAM, target);
    env.location.replace(url.toString());
    return true;
  }
  function check() {
    if (stopped || !validBuild(build) || typeof env.fetch !== 'function') return Promise.resolve(false);
    if (checking) return checking;
    var controller = typeof env.AbortController === 'function' ? new env.AbortController() : null;
    var timer;
    var timeout = new Promise(function (resolve) {
      timer = env.setTimeout(function () {
        if (controller) controller.abort();
        resolve(null);
      }, timeoutMs);
    });
    var request = Promise.resolve().then(function () {
      return env.fetch('/api/frontend-version?_=' + Date.now(), {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller ? controller.signal : undefined
      });
    }).then(function (response) {
      if (!response.ok) return null;
      return response.json();
    }).catch(function () { return null; });
    checking = Promise.race([request, timeout]).then(function (release) {
      if (stopped || !release || release.app !== APP || !validBuild(release.build)) return false;
      if (release.build === build) { pending = null; return false; }
      return reloadIfSafe(release.build);
    }).catch(function () {
      // Offline, blocked metadata, or inaccessible browser APIs must not block the app.
      return false;
    }).finally(function () {
      env.clearTimeout(timer);
      checking = null;
    });
    return checking;
  }
  function onPageShow(event) {
    if (event.persisted) check();
  }
  function onVisible() {
    if (env.document.visibilityState === 'visible') check();
  }
  function start() {
    if (started || !validBuild(build)) return;
    started = true;
    env.addEventListener('pageshow', onPageShow);
    env.addEventListener('online', check);
    env.document.addEventListener('visibilitychange', onVisible);
    check();
  }
  function stop() {
    stopped = true;
    if (!started) return;
    env.removeEventListener('pageshow', onPageShow);
    env.removeEventListener('online', check);
    env.document.removeEventListener('visibilitychange', onVisible);
  }
  return { start: start, stop: stop, check: check, getPendingBuild: function () { return pending; } };
});
