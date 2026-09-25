/* SmartTube WEB service worker: офлайн-шелл + stale-while-revalidate статики + автообновление. */
const CACHE = 'stfw-v1';
const PRECACHE = ['/', '/offline.html', '/manifest.webmanifest', '/favicon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function shouldCache(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false; // динамика/медиа — только сеть
  return (
    url.pathname.startsWith('/assets/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname.startsWith('/src/')
  );
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const origin = self.location.origin;
  if (url.origin !== origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) || caches.match('/offline.html'))
    );
    return;
  }

  if (shouldCache(url)) {
    e.respondWith(
      caches.match(req).then((cached) => {
        const net = fetch(req)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches
                .open(CACHE)
                .then((c) => c.put(req, copy))
                .then(() => trimCache());
            }
            return res;
          })
          .catch(() => cached);
        return cached || net;
      })
    );
  }
});

async function trimCache() {
  const c = await caches.open(CACHE);
  const keys = await c.keys();
  const MAX = 120;
  if (keys.length > MAX) {
    await Promise.all(keys.slice(0, keys.length - MAX).map((k) => c.delete(k)));
  }
}