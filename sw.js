// ══════════════════════════════════════════
// TYP Championship — Service Worker
// ══════════════════════════════════════════
// IMPORTANT: bump this version string every time you re-upload the app
// (index.html changed) — otherwise users will keep seeing the old cached
// version even after you update the site.
const CACHE_NAME = 'typ-championship-v1';

// Files that make up the "app shell" — cached on install so the app can
// open instantly (and offline) even before the network responds.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Hosts that should NEVER be served from cache — live tournament data,
// scores, and chat must always come from the network when available.
const NETWORK_ONLY_HOSTS = [
  'firebaseio.com',
  'googleapis.com',
  'firebasestorage.googleapis.com',
  'generativelanguage.googleapis.com' // Gemini API used by the chatbot
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch POST/PUT (Firebase writes)

  const url = new URL(req.url);

  // Live data (Firebase / Gemini): network-first, no caching. If the user
  // is offline, this simply fails — which is correct, since stale
  // standings/scores would be misleading.
  if (NETWORK_ONLY_HOSTS.some((h) => url.hostname.includes(h))) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 503 })));
    return;
  }

  // App shell (the HTML/CSS/JS/fonts/icons): cache-first for instant load,
  // falling back to network, and updating the cache in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached); // offline: fall back to whatever is cached

      return cached || networkFetch;
    })
  );
});
