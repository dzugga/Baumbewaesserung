// Service Worker Erfassungs-App
// WICHTIG: App-Hülle (HTML/JS) NETWORK-FIRST, damit neue Deploys sofort ankommen.
// (Cache-first hatte iPhones auf einer alten Version festgehalten → Login-Button tot.)
const CACHE = 'erfassung-v2';
const SHELL = ['/erfassung.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

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
  const url = req.url;
  // Firebase/Backend nie cachen
  if (url.includes('firestore.googleapis.com') || url.includes('firebase.googleapis.com')
      || url.includes('identitytoolkit') || url.includes('securetoken')
      || url.includes('cloudfunctions.net')) return;

  const sameOrigin = url.startsWith(self.location.origin);
  const isShell = req.mode === 'navigate'
    || (sameOrigin && (url.endsWith('.html') || url.endsWith('.js') || url.includes('/assets/')));

  if (isShell) {
    // Network-first: immer die aktuelle App-Version laden; Cache nur als Offline-Fallback.
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(cc => cc.put(req, c)); }
        return res;
      }).catch(() => caches.match(req).then(m => m || caches.match('/erfassung.html')))
    );
  } else {
    // Statische Libs/Tiles (versionierte URLs): cache-first.
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && res.ok) { const c = res.clone(); caches.open(CACHE).then(cc => cc.put(req, c)); }
        return res;
      }).catch(() => cached))
    );
  }
});
