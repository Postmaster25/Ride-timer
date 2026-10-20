// Offline support. Bump VERSION on every change so phones pick up the new
// code on their next open (the page reloads when the new worker takes over).
const VERSION = '2026.10.20-2';
const CACHE = `ride-timer-${VERSION}`;
const SHELL = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/plan.js', 'js/cues.js', 'js/audio.js',
  'media/wake.mp4', 'media/keepalive.mp3',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'clips/manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    const manifest = await (await cache.match('clips/manifest.json')).json();
    const clips = [...new Set(Object.values(manifest))].map(f => new Request(`clips/${f}`, { cache: 'reload' }));
    await cache.addAll(clips);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      if (req.mode === 'navigate') return cache.match('index.html');
      throw e;
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data === 'version') event.source.postMessage({ version: VERSION });
});
