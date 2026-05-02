// =====================================================================
// Abide service worker
// =====================================================================
// Handles:
//  - Offline cache for app shell (so the app loads without internet)
//  - Push notifications (when OneSignal is added later, OneSignal injects
//    its own service worker and this one cooperates with it)
// =====================================================================

const CACHE = 'abide-v1';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Don't cache API calls — always go to network
  const url = new URL(request.url);
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('onesignal.com') ||
    url.hostname.includes('api.bible')
  ) {
    return; // let it pass through normally
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      return (
        cached ||
        fetch(request)
          .then((response) => {
            // Cache successful GETs of same-origin resources
            if (
              response &&
              response.status === 200 &&
              request.method === 'GET' &&
              url.origin === self.location.origin
            ) {
              const clone = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => caches.match('./index.html'))
      );
    })
  );
});

// Listen for messages from the app (e.g., to skip waiting on update)
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
