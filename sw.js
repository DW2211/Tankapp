// Offline-Fähigkeit. Mit Internet kommt immer die neueste Version vom Server (network-first),
// der Cache ist nur der Rückfall ohne Netz. So bleibt nach einem Update nie eine alte Version hängen.
const VERSION = 'tankbuch-v10';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/util.js', 'js/store.js', 'js/charts.js', 'js/stats.js', 'js/stations.js', 'js/ocr.js', 'js/sheets.js', 'js/tax.js', 'js/demo.js', 'js/ui.js',
  'vendor/lightweight-charts.standalone.production.js', 'vendor/tesseract.min.js', 'vendor/worker.min.js', 'vendor/jszip.min.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
  'google-apps-script/Code.gs',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den HTTP-Cache des Browsers, sonst landen alte Dateien im neuen Cache
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'tankbuch-ocr').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Tesseract-Kern & Sprachdaten (CDN, versioniert) dauerhaft cachen
  if (url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'tessdata.projectnaptha.com') {
    e.respondWith(caches.open('tankbuch-ocr').then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // Network-first, ohne HTTP-Cache; offline aus dem Cache
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      const r = await fetch(e.request, { cache: 'no-cache' });
      if (r.ok) c.put(e.request, r.clone());
      return r;
    } catch {
      return (await c.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' ? c.match('index.html') : Response.error());
    }
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((list) => (list[0] ? list[0].focus() : self.clients.openWindow('./#stations'))));
});
