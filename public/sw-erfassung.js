// Service Worker Erfassungs-App
// WICHTIG: Scope ist '/' (ganze Origin). Daher NICHT die anderen Apps (index/mobil/navi) abfangen.
// App-Hülle network-first, damit neue Deploys sofort ankommen (cache-first hatte iPhones festgehalten).
const CACHE = 'erfassung-v3';

self.addEventListener('install', e => { e.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url; try { url = new URL(req.url); } catch (_) { return; }

  // Firebase/Backend nie cachen
  if (/firestore\.googleapis|firebase(installations|remoteconfig)?\.googleapis|identitytoolkit|securetoken|cloudfunctions\.net/.test(url.href)) return;

  // Drittanbieter-Libs (Leaflet/Firebase CDN, versionierte URLs): cache-first als Offline-Hilfe
  if (url.origin !== self.location.origin) {
    if (/gstatic\.com|unpkg\.com/.test(url.hostname)) {
      e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => {
        if (r && r.ok) { const cc = r.clone(); caches.open(CACHE).then(x => x.put(req, cc)); } return r;
      }).catch(() => c)));
    }
    return; // sonstige Fremd-Origins normal lassen
  }

  // Navigationen: NUR erfassung.html behandeln; index/mobil/navi nicht abfangen
  if (req.mode === 'navigate') {
    if (url.pathname === '/erfassung.html' || url.pathname.endsWith('/erfassung.html')) {
      e.respondWith(
        fetch(req).then(r => { if (r && r.ok) { const cc = r.clone(); caches.open(CACHE).then(x => x.put('/erfassung.html', cc)); } return r; })
          .catch(() => caches.match('/erfassung.html'))
      );
    }
    return; // andere Seiten dem Browser überlassen
  }

  // Same-origin Assets (JS/CSS/…): network-first (frische Versionen für alle Apps), Cache als Offline-Fallback
  e.respondWith(
    fetch(req).then(r => { if (r && r.ok) { const cc = r.clone(); caches.open(CACHE).then(x => x.put(req, cc)); } return r; })
      .catch(() => caches.match(req))
  );
});
