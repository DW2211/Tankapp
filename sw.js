// Offline-Fähigkeit: App-Dateien aus dem Cache, Live-Preise & Google immer frisch aus dem Netz.
const VERSION = 'tankbuch-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/charts.js', 'js/stats.js', 'js/stations.js', 'js/ocr.js', 'js/sheets.js', 'js/tax.js', 'js/demo.js',
  'vendor/lightweight-charts.standalone.production.js', 'vendor/tesseract.min.js', 'vendor/worker.min.js', 'vendor/jszip.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'google-apps-script/Code.gs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Tesseract-Kern & Sprachdaten (CDN) dauerhaft cachen
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com') {
    e.respondWith(caches.open(VERSION + '-ocr').then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Stale-while-revalidate für die App selbst
  e.respondWith(caches.open(VERSION).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const fresh = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./#stations'))));
});
