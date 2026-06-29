// Service Worker für FCM-Hintergrund-Push (Fahrer-App). Bewusst eigener, schmaler Scope (/fcm/),
// damit er NICHT mit dem Erfassungs-SW (Scope /) kollidiert. Config inline (ist ohnehin öffentlich).
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyBShCcASfAG26EDyax6er6SIiqeSBrFWek',
  authDomain: 'baumbewaesserung.firebaseapp.com',
  projectId: 'baumbewaesserung',
  storageBucket: 'baumbewaesserung.firebasestorage.app',
  messagingSenderId: '1001991004222',
  appId: '1:1001991004222:web:1405d80d0788bd6548f16f'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Neue Nachricht', {
    body: n.body || '',
    tag: 'bwt-msg',
    data: payload.data || {}
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const url = '/mobil.html';
    for (const c of all) { if (c.url.includes('/mobil.html') && 'focus' in c) return c.focus(); }
    if (clients.openWindow) return clients.openWindow(url);
  })());
});
