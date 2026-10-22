// FieldApp Test service worker — offline after first load.
// Stale-while-revalidate: serve from cache instantly, refresh the cache in the background.
// Bump CACHE on every deploy: the app sees the new worker take over and reloads itself onto it.
const CACHE = 'fieldapp-test-v6';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the browser HTTP cache (GitHub Pages sends max-age=600),
  // otherwise a new version can get filled with the previous deploy's files.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      // Navigations all resolve to the app shell (hash routing).
      const key = req.mode === 'navigate' ? './index.html' : req;
      const cached = await cache.match(key);
      // Same-origin background refreshes revalidate with GitHub (ETag) instead of trusting the HTTP cache.
      const network = (sameOrigin ? fetch(req.url, { cache: 'no-cache' }) : fetch(req))
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
