// Офлайн-кэш: игра открывается без интернета (кроме онлайн-режима).
const CACHE = 'zaslon-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'game.js', 'ai.js', 'vendor/peerjs.min.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png', 'fonts/fonts.css',
  'fonts/unbounded-cyrillic-700-normal.woff2', 'fonts/unbounded-cyrillic-800-normal.woff2',
  'fonts/unbounded-latin-700-normal.woff2', 'fonts/unbounded-latin-800-normal.woff2',
  'fonts/manrope-cyrillic-500-normal.woff2', 'fonts/manrope-cyrillic-600-normal.woff2', 'fonts/manrope-cyrillic-700-normal.woff2',
  'fonts/manrope-latin-500-normal.woff2', 'fonts/manrope-latin-600-normal.woff2', 'fonts/manrope-latin-700-normal.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// сначала сеть (чтобы обновления приходили сразу), без сети — кэш
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
