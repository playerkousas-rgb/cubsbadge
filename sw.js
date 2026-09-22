/* ============================================================
 * cubbadge service worker — 個人化訂閱推送 (BUILD.md §4 ★)
 *
 * 「系統做嘅嘢 = 訂閱設定前端」：
 *   用戶喺系統內揀支部×項目 → 本 service worker（用圖書館 VAPID public
 *   key 訂閱）→ 寫入同一張 Supabase 表。
 * 推送內容由圖書館 notify.py 發出，點擊回圖書館睇通告卡片＋附件。
 *
 * 呢個 SW 只做推送，唔做離線快取 —— 進度資料自己有 LocalStorage staging。
 * ============================================================ */
'use strict';

const LIBRARY_ORIGIN = 'https://scout-circulars.vercel.app';
const FALLBACK = {
  title: '🔔 香港童軍通告',
  body: '點擊查看通告',
  url: `${LIBRARY_ORIGIN}/`,
  tag: 'cubbadge-personal'
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function safeUrl(value) {
  try {
    const parsed = new URL(String(value || ''), LIBRARY_ORIGIN);
    // 只准回圖書館或本系統，杜絕壞 payload 帶人去第三方。
    if (parsed.origin !== LIBRARY_ORIGIN && parsed.origin !== self.location.origin) return FALLBACK.url;
    return parsed.href;
  } catch (e) {
    return FALLBACK.url;
  }
}

function asPayload(raw) {
  if (!raw) return FALLBACK;
  try {
    const v = raw.json();
    if (!v || typeof v !== 'object') return FALLBACK;
    return {
      title: (typeof v.title === 'string' && v.title) ? v.title : FALLBACK.title,
      body: typeof v.body === 'string' ? v.body : FALLBACK.body,
      url: safeUrl(v.url),
      tag: (typeof v.tag === 'string' && v.tag) ? v.tag.slice(0, 120) : FALLBACK.tag,
      count: Number(v.count) || 1,
      batchDate: typeof v.batchDate === 'string' ? v.batchDate : '',
      silent: v.silent === true
    };
  } catch (e) {
    try { return { ...FALLBACK, body: String(raw.text() || '').slice(0, 250) }; }
    catch (e2) { return FALLBACK; }
  }
}

self.addEventListener('push', (event) => {
  const payload = asPayload(event.data);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    renotify: false,
    silent: payload.silent,
    data: { url: payload.url, count: payload.count, batchDate: payload.batchDate },
    icon: '/assets/cub-logo-256.png',
    badge: '/assets/cub-logo-128.png',
    ...(payload.silent ? {} : { vibrate: [100, 40, 100] })
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || FALLBACK.url;
  event.waitUntil((async () => {
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (client.url.startsWith(self.location.origin)) {
        await client.focus();
        if ('navigate' in client) { try { await client.navigate(target); } catch (e) { /* 跨域導航失敗就照開新窗 */ } }
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});

self.addEventListener('pushsubscriptionchange', () => {
  // VAPID 綁定嘅訂閱唔可以喺 SW 內安全重建（要用戶本機設定），叫開住嘅頁面重新同步。
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    clients.forEach((c) => c.postMessage({ type: 'cubbadge-push-subscription-change' }));
  });
});
