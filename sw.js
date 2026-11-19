// Minimal service worker so the site can be installed as an app.
// Network first (your files must always be fresh); the cached page is only an offline fallback.
const CACHE = 'velaryn-shell-v2';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'logo.png']))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match('index.html')));
});
