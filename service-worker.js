// =====================================================================
// Abide service worker
// =====================================================================
// Strategy: NETWORK-FIRST with cache fallback.
//   - When online: always fetch the latest from GitHub Pages
//   - When offline: fall back to whatever is cached
//   - Bumping CACHE_VERSION below forces old caches to be deleted
//
// This means: deploying new code to GitHub will be picked up the
// next time you open the app online — no PWA reinstall needed.
// =====================================================================

const CACHE_VERSION = 'abide-v3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  // Pre-cache the shell so first-time offline use works.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  // Activate the new SW immediately rather than waiting for tabs to close.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clear out any caches from previous versions.
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls — always go straight to network.
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.hostname.includes('api.bible')
  ) {
    return;
  }

  // Only handle GETs.
  if (request.method !== 'GET') return;

  // Network-first: try the network, fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Cache fresh successful same-origin responses for offline fallback.
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => {
        // Network failed (offline) — serve from cache.
        return caches.match(request).then((cached) => {
          // For navigation requests, fall back to the index shell so the SPA
          // can route locally even when offline.
          return cached || (request.mode === 'navigate' ? caches.match('./index.html') : undefined);
        });
      })
  );
});

// Allow the app to message the SW to take over immediately.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
