/* Cub Badge Service Worker - v7.2 offline cache - COPYRIGHT 2026 Scout System */
const CACHE_NAME = 'cubbadge-v7-2-20260912';
const OFFLINE_URL = './index.html';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './data/items.json',
  './assets/cub-logo-128.png',
  './assets/cub-logo-256.png',
  './assets/favicon-32.png',
  './assets/apple-touch-icon.png',
  './assets/logo-192.png',
  './assets/logo-512.png',
  './assets/ymis-parse.js',
  './assets/vs-torch.svg',
  // Manual main
  './assets/manual/official.avif',
  './assets/manual/catalog.avif',
  './assets/manual/handbook.avif',
  './assets/manual/ceremony.avif',
  './assets/manual/games.avif',
  './assets/manual/craft.avif',
  './assets/manual/songs.avif',
  './assets/manual/safety.avif',
  // Details
  './assets/manual/details/six-colors.avif',
  './assets/manual/details/leader-roles.avif',
  './assets/manual/details/tracking-symbols.avif',
  './assets/manual/details/knots.avif',
  './assets/manual/details/first-aid.avif',
  './assets/manual/details/map-compass.avif',
  './assets/manual/details/friendship-bracelet.avif',
  './assets/manual/details/campfire-circle.avif',
  './assets/manual/details/badge-overview.avif',
  './assets/manual/details/flag-steps.avif',
  './assets/manual/details/oath.avif',
  './assets/manual/details/sixer-training.avif',
  './assets/manual/details/badge-positions.avif',
  './assets/manual/details/cooking.avif',
  './assets/manual/details/recycled-paper.avif',
  './assets/manual/details/weather.avif',
  './assets/manual/details/pack-call-hands.avif',
  './assets/manual/details/ram-checklist.avif',
  './assets/manual/details/sfh-principles.avif',
  './assets/manual/details/sharing-circle.avif',
  // Games
  './assets/manual/games/g1-tracking.avif',
  './assets/manual/games/g2-message.avif',
  './assets/manual/games/g3-trust.avif',
  './assets/manual/games/g4-packcall.avif',
  './assets/manual/games/g5-lawcards.avif',
  './assets/manual/games/g6-river.avif',
  './assets/manual/games/g7-smell.avif',
  './assets/manual/games/g8-kim.avif',
  './assets/manual/games/g9-campfire-story.avif',
  './assets/manual/games/g10-safety-quiz.avif',
  // Crafts
  './assets/manual/crafts/c1-knots.avif',
  './assets/manual/crafts/c2-tracking.avif',
  './assets/manual/crafts/c3-map.avif',
  './assets/manual/crafts/c4-sandwich.avif',
  './assets/manual/crafts/c5-bracelet.avif',
  './assets/manual/crafts/c6-paper.avif',
  './assets/manual/crafts/c7-firstaid.avif',
  './assets/manual/crafts/c8-weather.avif'
];

self.addEventListener('install', event => {
  console.log('[SW] Install', CACHE_NAME);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching assets');
        return cache.addAll(ASSETS_TO_CACHE.map(url => new Request(url, {cache: 'reload'}))).catch(err => {
          console.warn('[SW] Cache addAll failed', err);
          // Try individual
          return Promise.allSettled(ASSETS_TO_CACHE.map(u => cache.add(u).catch(e=>console.warn('Failed',u,e))));
        });
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Delete old cache', k);
          return caches.delete(k);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Skip non-GET and API calls (let network handle, but cache fallback for items.json)
  if (req.method !== 'GET') return;

  // For API /api/* - network first, no cache
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // For data/items.json - stale while revalidate
  if (url.pathname.includes('items.json')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(req).then(cached => {
          const fetched = fetch(req).then(networkRes => {
            if (networkRes.ok) cache.put(req, networkRes.clone());
            return networkRes;
          }).catch(()=> cached);
          return cached || fetched;
        });
      })
    );
    return;
  }

  // For assets and pages - cache first, fallback to network, then offline
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkRes => {
        // Cache new assets
        if (networkRes.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('.avif') || url.pathname.endsWith('.png') || url.pathname.endsWith('.js') || url.pathname.endsWith('.json'))) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => {
        // Offline fallback to index.html for navigation
        if (req.mode === 'navigate') {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});
