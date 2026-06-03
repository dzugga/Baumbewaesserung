// ─── FIREBASE CONFIG ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBShCcASfAG26EDyax6er6SIiqeSBrFWek",
  authDomain: "baumbewaesserung.firebaseapp.com",
  projectId: "baumbewaesserung",
  storageBucket: "baumbewaesserung.firebasestorage.app",
  messagingSenderId: "1001991004222",
  appId: "1:1001991004222:web:1405d80d0788bd6548f16f"
};
const fbApp = firebase.initializeApp(firebaseConfig);
const db = firebase.firestore(fbApp);

// Firestore Offline-Persistenz aktivieren
db.enablePersistence({ synchronizeTabs: false }).catch(err => {
  if (err.code === 'failed-precondition') console.warn('Offline-Persistenz: mehrere Tabs offen');
  else if (err.code === 'unimplemented') console.warn('Offline-Persistenz: Browser nicht unterstützt');
});

// ─── OFFLINE ──────────────────────────────────────────────────
const CACHE_KEY = 'bwt_erfassung_trees';
const QUEUE_KEY = 'bwt_erfassung_queue';
let isOnline = navigator.onLine;

window.addEventListener('online',  () => { isOnline = true;  updateNetworkBadge(); syncQueue(); });
window.addEventListener('offline', () => { isOnline = false; updateNetworkBadge(); });

function updateNetworkBadge() {
  const badge = document.getElementById('network-badge');
  if (!badge) return;
  const q = getQueue();
  badge.style.display = isOnline ? 'none' : 'flex';
  badge.textContent = q.length > 0 ? `Offline · ${q.length} ausstehend` : 'Offline';
}

function cacheTreesLocal(pid, tid, data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ pid, tid, data, ts: Date.now() })); }
  catch(e) {}
}

function loadCachedTrees(pid, tid) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj.pid === pid && obj.tid === tid) return obj.data;
  } catch(e) {}
  return null;
}

function getQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch(e) { return []; }
}

function addToQueue(entry) {
  const q = getQueue();
  q.push(entry);
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  updateNetworkBadge();
}

async function syncQueue() {
  const q = getQueue();
  if (q.length === 0) return;
  const failed = [];
  for (const entry of q) {
    try {
      if (entry.type === 'newTree') {
        await db.collection('projects').doc(entry.projectId).collection('trees').add(entry.data);
      } else if (entry.type === 'updateCoords') {
        await db.collection('projects').doc(entry.projectId).collection('trees').doc(entry.treeId)
          .set(entry.data, { merge: true });
      }
    } catch(e) { failed.push(entry); }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
  if (q.length - failed.length > 0) toast(`✓ ${q.length - failed.length} Einträge synchronisiert`);
  updateNetworkBadge();
}

// ─── STATE ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProjectData = null;
let currentErfasser = null;
let allTrees = [];          // alle Bäume des Projekts
let treesOhneKoords = [];   // Bäume ohne Koordinaten (Modus 2)
let selectedTree = null;    // für Modus 2
let activeMode = 'koord';   // 'koord' | 'neu'
let mapNeu = null;
let mapKoord = null;
let gpsMarkerNeu = null;
let gpsMarkerKoord = null;
let pendingCoords = null;   // {lat, lng} für Formular
let erfassteMarkers = [];        // grüne Marker auf map-neu
let erfassteMarkersUebersicht = []; // grüne Marker auf map-uebersicht
let koordiniertMarkers = [];    // blaue Marker auf map-uebersicht
let erfassteCount = 0;
let koordiniertCount = 0;
let mapUebersicht = null;

// ─── UTILS ────────────────────────────────────────────────────
function toast(msg, dur = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

function hideLoading() {
  const el = document.getElementById('screen-loading');
  if (el) { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }
}

// ─── ERFASSTE MARKER ──────────────────────────────────────────
let _koordiniertData = [];

function makeKoordIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#1e40af;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
    </div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

function addKoordMarker(tree, map, markerList) {
  if (!tree.lat || !tree.lng) return;
  const marker = L.marker([tree.lat, tree.lng], { icon: makeKoordIcon() })
    .addTo(map)
    .bindTooltip(`<b>${tree.name || '–'}</b><br><span style="font-family:monospace">${tree.baumId || ''}</span><br><i style="color:#1e40af">Koordinate gesetzt</i>`, { direction: 'top', offset: [0,-16] });
  markerList.push(marker);
}

function makeErfasstIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:#16a34a;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z"/></svg>
    </div>`,
    iconSize: [28, 28], iconAnchor: [14, 14]
  });
}

function addErfasstMarker(tree, map, markerList) {
  if (!tree.lat || !tree.lng) return;
  const marker = L.marker([tree.lat, tree.lng], { icon: makeErfasstIcon() })
    .addTo(map)
    .bindTooltip(`<b>${tree.name || '–'}</b><br><span style="font-family:monospace">${tree.baumId || ''}</span>`, { direction: 'top', offset: [0, -16] });
  markerList.push(marker);
}

function initMapUebersicht() {
  if (mapUebersicht) return;
  mapUebersicht = L.map('map-uebersicht', { zoomControl: false }).setView([51.05, 13.73], 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a>', maxZoom: 19
  }).addTo(mapUebersicht);
  L.control.zoom({ position: 'topright' }).addTo(mapUebersicht);
}

function updateUebersichtLabel() {
  const el = document.getElementById('uebersicht-label');
  if (!el) return;
  const parts = [];
  if (erfassteCount > 0) parts.push(`${erfassteCount} neu erfasst`);
  if (koordiniertCount > 0) parts.push(`${koordiniertCount} koordiniert`);
  el.textContent = parts.length > 0 ? parts.join(' · ') : 'Noch nichts erfasst';
}

function updateErfasstCounter() {
  const el = document.getElementById('header-erfasst-count');
  if (!el) return;
  el.textContent = `${erfassteCount} erfasst`;
  el.style.display = erfassteCount > 0 ? '' : 'none';
}

let _erfassteData = [];

async function loadErfassteMarkers() {
  try {
    const snap = await db.collection('projects').doc(currentProjectId)
      .collection('trees')
      .where('erfasstVon', '==', currentErfasser)
      .get();
    _erfassteData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    erfassteCount = _erfassteData.length;
    _erfassteData.forEach(t => {
      if (mapNeu) addErfasstMarker(t, mapNeu, erfassteMarkers);
    });
    updateErfasstCounter();
    updateUebersichtLabel();
  } catch(e) { console.warn('loadErfassteMarkers:', e); }
}

async function loadErfassteMarkersUebersicht() {
  // Grüne Marker (neu erfasst)
  erfassteMarkersUebersicht.forEach(m => mapUebersicht.removeLayer(m));
  erfassteMarkersUebersicht.length = 0;
  _erfassteData.forEach(t => addErfasstMarker(t, mapUebersicht, erfassteMarkersUebersicht));

  // Blaue Marker (Koordinaten nacherfasst) aus Firestore laden
  koordiniertMarkers.forEach(m => mapUebersicht.removeLayer(m));
  koordiniertMarkers.length = 0;
  try {
    const snap = await db.collection('projects').doc(currentProjectId)
      .collection('trees')
      .where('koordiniertVon', '==', currentErfasser)
      .get();
    _koordiniertData = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    koordiniertCount = _koordiniertData.length;
    _koordiniertData.forEach(t => addKoordMarker(t, mapUebersicht, koordiniertMarkers));
  } catch(e) { console.warn('loadKoordMarkers:', e); }

  // FitBounds auf alle Marker
  const pts = [
    ..._erfassteData.filter(t=>t.lat&&t.lng).map(t=>[t.lat,t.lng]),
    ..._koordiniertData.filter(t=>t.lat&&t.lng).map(t=>[t.lat,t.lng])
  ];
  if (pts.length > 0) mapUebersicht.fitBounds(L.latLngBounds(pts), { padding: [50,50], maxZoom: 17 });
  updateUebersichtLabel();
}

async function resetUebersicht() {
  if (!confirm('Karte leeren? Die Bäume bleiben erhalten, werden aber beim nächsten Login nicht mehr angezeigt.')) return;

  // Felder in Firestore löschen damit beim nächsten Login nichts mehr erscheint
  // Nur Bäume die wirklich in Firestore existieren (haben echte ID, nicht aus Queue)
  const queueIds = new Set(getQueue().filter(e=>e.type==='newTree').map(e=>e.data?.baumId));
  const deleteField = firebase.firestore.FieldValue.delete();
  const batch = db.batch();

  _erfassteData
    .filter(t => t.id && !queueIds.has(t.baumId))
    .forEach(t => batch.update(
      db.collection('projects').doc(currentProjectId).collection('trees').doc(t.id),
      { erfasstVon: deleteField }
    ));
  _koordiniertData
    .filter(t => t.id)
    .forEach(t => batch.update(
      db.collection('projects').doc(currentProjectId).collection('trees').doc(t.id),
      { koordiniertVon: deleteField }
    ));

  try {
    if (batch._mutations?.length > 0 || batch._writes?.length > 0) await batch.commit();
  } catch(e) { console.warn('Reset batch:', e); }

  // Lokale Marker entfernen
  erfassteMarkers.forEach(m => { try { mapNeu.removeLayer(m); } catch(e){} });
  erfassteMarkers.length = 0;
  erfassteMarkersUebersicht.forEach(m => mapUebersicht.removeLayer(m));
  erfassteMarkersUebersicht.length = 0;
  koordiniertMarkers.forEach(m => mapUebersicht.removeLayer(m));
  koordiniertMarkers.length = 0;
  _erfassteData.length = 0;
  _koordiniertData.length = 0;
  erfassteCount = 0;
  koordiniertCount = 0;
  updateErfasstCounter();
  updateUebersichtLabel();
  toast('✓ Karte geleert');
}

// ─── MAPS ─────────────────────────────────────────────────────
function initMapNeu() {
  if (mapNeu) return;
  mapNeu = L.map('map-neu', { zoomControl: false }).setView([51.05, 13.73], 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a>', maxZoom: 19
  }).addTo(mapNeu);
  L.control.zoom({ position: 'topright' }).addTo(mapNeu);

  // Koordinaten-Anzeige bei Kartenbewegung
  mapNeu.on('move', () => {
    const c = mapNeu.getCenter();
    document.getElementById('neu-coords').textContent =
      `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
  });
}

function initMapKoord() {
  if (mapKoord) return;
  mapKoord = L.map('map-koord', { zoomControl: false }).setView([51.05, 13.73], 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://openstreetmap.org">OSM</a>', maxZoom: 19
  }).addTo(mapKoord);
  L.control.zoom({ position: 'topright' }).addTo(mapKoord);
}

// ─── GPS ──────────────────────────────────────────────────────
function centerOnGPS(map, markerRef, onSuccess) {
  if (!navigator.geolocation) { toast('GPS nicht verfügbar'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    map.setView([lat, lng], 18);
    if (onSuccess) onSuccess(lat, lng);
  }, () => toast('GPS-Position nicht verfügbar'), { enableHighAccuracy: true, timeout: 8000 });
}

// ─── LOGIN ────────────────────────────────────────────────────
async function loadProjects() {
  const snap = await db.collection('projects').get();
  const sel = document.getElementById('login-project');
  sel.innerHTML = '<option value="">– Projekt wählen –</option>' +
    snap.docs.map(d => `<option value="${d.id}">${d.data().name}</option>`).join('');
  if (snap.size === 1) {
    sel.value = snap.docs[0].id;
    await onProjectChange();
  }
}

async function onProjectChange() {
  const pid = document.getElementById('login-project').value;
  const erfSel = document.getElementById('login-erfasser');
  erfSel.innerHTML = '<option value="">– Erfasser wählen –</option>';
  if (!pid) return;
  const snap = await db.collection('projects').doc(pid).get();
  const erfasser = snap.data()?.erfasser || [];
  erfSel.innerHTML = '<option value="">– Erfasser wählen –</option>' +
    erfasser.map(n => `<option value="${n}">${n}</option>`).join('');
  if (erfasser.length === 1) erfSel.value = erfasser[0];
}

async function doLogin() {
  const pid = document.getElementById('login-project').value;
  const erfasser = document.getElementById('login-erfasser').value;
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  if (!pid || !erfasser) {
    errEl.textContent = 'Bitte alle Felder ausfüllen.';
    errEl.style.display = 'block';
    return;
  }
  const snap = await db.collection('projects').doc(pid).get();
  currentProjectData = { id: pid, ...snap.data() };
  currentProjectId = pid;
  currentErfasser = erfasser;

  // Alle Bäume laden (Firestore-Cache greift automatisch wenn offline)
  try {
    const treesSnap = await db.collection('projects').doc(pid).collection('trees').get();
    allTrees = treesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    cacheTreesLocal(pid, erfasser, allTrees); // lokal sichern
  } catch(e) {
    // Offline-Fallback: aus localStorage
    const cached = loadCachedTrees(pid, erfasser);
    allTrees = cached || [];
    if (allTrees.length > 0) toast('📦 Offline — lokale Daten geladen');
  }
  treesOhneKoords = allTrees.filter(t => !t.lat || !t.lng);

  // UI aufbauen
  document.getElementById('header-project').textContent = currentProjectData.name;
  document.getElementById('header-erfasser').textContent = erfasser;
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  renderKoordList('');
  initMapNeu();
  initMapKoord();
  setTimeout(() => loadErfassteMarkers(), 500); // nach Map-Init

  // Auf Stadtmitte zoomen — Median-Koordinate für Robustheit gegen Ausreißer
  const withCoords = allTrees.filter(t => t.lat && t.lng && t.lat > 40 && t.lat < 55 && t.lng > 5 && t.lng < 15);
  if (withCoords.length > 0) {
    const sortedLats = [...withCoords.map(t => t.lat)].sort((a,b)=>a-b);
    const sortedLngs = [...withCoords.map(t => t.lng)].sort((a,b)=>a-b);
    const mid = Math.floor(sortedLats.length / 2);
    const centerLat = sortedLats[mid];
    const centerLng = sortedLngs[mid];
    mapNeu.setView([centerLat, centerLng], 14);
    mapKoord.setView([centerLat, centerLng], 14);
  }
}

function doLogout() {
  if (!confirm('Abmelden?')) return;
  location.reload();
}

// Lokalen Cache leeren + frisch neu laden (behebt hängende/veraltete Zustände)
async function hardReload() {
  if (!confirm('App neu laden und lokalen Cache leeren?\nHolt die aktuellen Daten frisch vom Server. (Nicht synchronisierte Offline-Änderungen können dabei verloren gehen.)')) return;
  toast('Cache wird geleert…');
  try {
    localStorage.removeItem(CACHE_KEY); // Baum-Cache (Queue bleibt erhalten)
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    // Firestore-Offline-Cache (IndexedDB) leeren — entfernt hängende Writes
    try { await db.terminate(); await db.clearPersistence(); } catch (e) { console.warn('clearPersistence:', e); }
  } catch (e) { console.warn('hardReload:', e); }
  location.reload(true);
}

// ─── MODUS 2: KOORDINATEN NACHERFASSEN ───────────────────────
function renderKoordList(q) {
  const lower = q.toLowerCase();
  let list = treesOhneKoords.filter(t =>
    !q ||
    (t.name || '').toLowerCase().includes(lower) ||
    (t.art || '').toLowerCase().includes(lower) ||
    (t.stadtteil || '').toLowerCase().includes(lower) ||
    (t.baumnr || '').toLowerCase().includes(lower) ||
    (t.baumId || '').toLowerCase().includes(lower)
  );

  const countEl = document.getElementById('koord-count');
  countEl.textContent = `${list.length} Baum${list.length !== 1 ? 'bäume' : ''} ohne Koordinaten`;

  const el = document.getElementById('koord-list');
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 6L9 17l-5-5"/><circle cx="12" cy="12" r="10"/></svg>
      <p>${q ? 'Keine Bäume gefunden' : 'Alle Bäume haben bereits Koordinaten 🎉'}</p>
    </div>`;
    return;
  }

  el.innerHTML = list.map(t => `
    <div class="koord-item" data-id="${t.id}">
      <div class="koord-item-num">${t.baumId || '–'}</div>
      <div class="koord-item-info">
        <div class="koord-item-name">${t.name || '–'}</div>
        <div class="koord-item-meta">${t.art || '–'}${t.stadtteil ? ' · ' + t.stadtteil : ''}${t.baumnr ? ' · ' + t.baumnr : ''}</div>
      </div>
      <span class="koord-item-badge">Kein GPS</span>
    </div>
  `).join('');

  el.onclick = e => {
    const item = e.target.closest('[data-id]');
    if (item) openKoordMap(item.dataset.id);
  };
}

function openKoordMap(treeId) {
  selectedTree = treesOhneKoords.find(t => t.id === treeId);
  if (!selectedTree) return;
  document.getElementById('koord-list-wrap').style.display = 'none';
  const wrap = document.getElementById('map-koord-wrap');
  wrap.classList.add('active');
  document.getElementById('koord-tree-name').textContent =
    `${selectedTree.name || '–'}${selectedTree.baumnr ? ' · ' + selectedTree.baumnr : ''}`;
  setTimeout(() => { mapKoord.invalidateSize(); }, 100);
}

function closeKoordMap() {
  document.getElementById('koord-list-wrap').style.display = '';
  document.getElementById('map-koord-wrap').classList.remove('active');
  selectedTree = null;
}

// Optimistische lokale Übernahme (Baum aus „ohne Koordinaten"-Liste nehmen)
function applyCoordLocally(treeId, lat, lng) {
  const t = treesOhneKoords.find(x => x.id === treeId) || allTrees.find(x => x.id === treeId) || { id: treeId };
  allTrees = allTrees.map(x => x.id === treeId ? { ...x, lat, lng } : x);
  treesOhneKoords = treesOhneKoords.filter(x => x.id !== treeId);
  if (!_koordiniertData.some(x => x.id === treeId)) {
    const k = { ...t, lat, lng };
    _koordiniertData.push(k);
    if (mapUebersicht) addKoordMarker(k, mapUebersicht, koordiniertMarkers);
  }
  koordiniertCount = _koordiniertData.length;
  updateUebersichtLabel();
  renderKoordList(document.getElementById('koord-search')?.value || '');
}

async function saveKoordPosition() {
  if (!selectedTree) return;
  const center = mapKoord.getCenter();
  const lat = parseFloat(center.lat.toFixed(7));
  const lng = parseFloat(center.lng.toFixed(7));
  const treeId = selectedTree.id;
  const coordUpdate = { lat, lng, koordiniertVon: currentErfasser };
  const ref = db.collection('projects').doc(currentProjectId).collection('trees').doc(treeId);

  closeKoordMap();

  // Offline: in Queue, lokal übernehmen, klar als „ausstehend" kennzeichnen
  if (!isOnline) {
    addToQueue({ type: 'updateCoords', projectId: currentProjectId, treeId, data: coordUpdate });
    applyCoordLocally(treeId, lat, lng);
    toast('📦 Offline gespeichert — wird synchronisiert sobald online');
    return;
  }

  toast('Speichern…');
  try {
    // set+merge ist robust (scheitert nicht an Doc-Edgecases)
    await ref.set(coordUpdate, { merge: true });
    // ENTSCHEIDEND: auf Server-Bestätigung warten (max. 10s). Ein Write, der
    // nur im Geräte-Cache liegt, gilt NICHT als Erfolg.
    const synced = await Promise.race([
      db.waitForPendingWrites().then(() => true),
      new Promise(r => setTimeout(() => r(false), 10000)),
    ]);
    if (synced) {
      applyCoordLocally(treeId, lat, lng);
      toast(`✓ Gespeichert & synchronisiert — ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    } else {
      // Nicht bestätigt → Baum BLEIBT in der Liste, klare Warnung
      toast('⚠ Nicht synchronisiert — Verbindung prüfen und erneut speichern. Baum bleibt in der Liste.');
    }
  } catch (e) {
    addToQueue({ type: 'updateCoords', projectId: currentProjectId, treeId, data: coordUpdate });
    console.warn('Koordinaten-Save fehlgeschlagen:', e);
    toast(`⚠ Fehler: ${e.code || e.message} — in Warteschlange, Baum bleibt in der Liste`);
  }
}

// ─── MODUS 1: NEUER BAUM ─────────────────────────────────────
function openFormSheet() {
  const center = mapNeu.getCenter();
  pendingCoords = { lat: parseFloat(center.lat.toFixed(7)), lng: parseFloat(center.lng.toFixed(7)) };
  document.getElementById('form-coords-display').textContent =
    `📍 ${pendingCoords.lat.toFixed(5)}, ${pendingCoords.lng.toFixed(5)}`;
  // Felder leeren
  ['f-name','f-stadtteil','f-baumnr','f-art','f-pflanzjahr','f-pflanzzeitpunkt','f-notiz'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-zustand').value = 'mittel';
  document.getElementById('f-wasser').value = 'mittel';
  document.getElementById('form-backdrop').classList.add('open');
  document.getElementById('form-sheet').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 400);
}

function closeFormSheet() {
  document.getElementById('form-backdrop').classList.remove('open');
  document.getElementById('form-sheet').classList.remove('open');
  pendingCoords = null;
}

async function saveNewTree() {
  const name = document.getElementById('f-name').value.trim();
  if (!name) { toast('⚠ Bitte einen Namen eingeben'); return; }
  if (!pendingCoords) { toast('⚠ Keine Koordinaten'); return; }

  const btn = document.getElementById('btn-form-save');
  btn.disabled = true; btn.textContent = 'Speichert…';

  // BaumId lokal generieren — kein Firestore-Read nötig (offline-sicher)
  const localCounter = parseInt(localStorage.getItem('bwt_local_baumid') || '0') + 1;
  localStorage.setItem('bwt_local_baumid', String(localCounter));
  const baumId = 'B-' + String(localCounter).padStart(5, '0') + '-L'; // -L = lokal

  // Daten VOR dem try-Block aufbauen (damit catch darauf zugreifen kann)
  const data = {
    baumId, name,
    stadtteil: document.getElementById('f-stadtteil').value,
    baumnr: document.getElementById('f-baumnr').value,
    art: document.getElementById('f-art').value,
    pflanzjahr: document.getElementById('f-pflanzjahr').value,
    pflanzzeitpunkt: document.getElementById('f-pflanzzeitpunkt').value,
    zustand: document.getElementById('f-zustand').value,
    wasser: document.getElementById('f-wasser').value,
    notiz: document.getElementById('f-notiz').value,
    lat: pendingCoords.lat,
    lng: pendingCoords.lng,
    tourId: '', datum: '', history: [],
    erfasstVon: currentErfasser,
    createdAt: new Date().toISOString(),
  };

  // UI sofort aktualisieren (optimistic)
  _erfassteData.push(data);
  addErfasstMarker(data, mapNeu, erfassteMarkers);
  if (mapUebersicht) addErfasstMarker(data, mapUebersicht, erfassteMarkersUebersicht);
  erfassteCount++;
  updateErfasstCounter();
  closeFormSheet();

  try {
    if (!isOnline) throw new Error('offline');
    await db.collection('projects').doc(currentProjectId).collection('trees').add({
      ...data,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast(`✓ ${name} gespeichert`);
  } catch (e) {
    addToQueue({ type: 'newTree', projectId: currentProjectId, data });
    toast(`📦 Offline gespeichert — wird synchronisiert`);
    console.warn(e);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Speichern';
  }
}

// ─── TABS ─────────────────────────────────────────────────────
function switchMode(mode) {
  activeMode = mode;
  ['koord','neu','uebersicht'].forEach(m => {
    document.getElementById('tab-'+m)?.classList.toggle('active', mode === m);
    document.getElementById('mode-'+m)?.classList.toggle('active', mode === m);
  });
  if (mode === 'neu') setTimeout(() => { if (mapNeu) mapNeu.invalidateSize(); }, 100);
  if (mode === 'uebersicht') {
    if (!mapUebersicht) {
      initMapUebersicht();
      // Karte auf gleiche Position wie map-neu setzen
      if (mapNeu) mapUebersicht.setView(mapNeu.getCenter(), mapNeu.getZoom());
      // Bestehende erfasste Marker laden
      loadErfassteMarkersUebersicht();
    }
    setTimeout(() => { if (mapUebersicht) mapUebersicht.invalidateSize(); }, 100);
    updateUebersichtLabel();
  }
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Login
  document.getElementById('login-project').addEventListener('change', onProjectChange);
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-reload')?.addEventListener('click', hardReload);

  // Mode tabs
  document.getElementById('tab-koord').addEventListener('click', () => switchMode('koord'));
  document.getElementById('tab-neu').addEventListener('click', () => switchMode('neu'));
  document.getElementById('tab-uebersicht').addEventListener('click', () => switchMode('uebersicht'));
  document.getElementById('btn-gps-uebersicht').addEventListener('click', () => {
    centerOnGPS(mapUebersicht, null, null);
  });
  document.getElementById('btn-reset-uebersicht').addEventListener('click', resetUebersicht);

  // Modus 2
  document.getElementById('koord-search').addEventListener('input', e => renderKoordList(e.target.value));
  document.getElementById('btn-back-list').addEventListener('click', closeKoordMap);
  document.getElementById('btn-save-koord').addEventListener('click', saveKoordPosition);
  document.getElementById('btn-gps-koord').addEventListener('click', () => {
    centerOnGPS(mapKoord, null, null);
  });

  // Modus 1
  document.getElementById('btn-erfassen').addEventListener('click', openFormSheet);
  document.getElementById('btn-gps-neu').addEventListener('click', () => {
    centerOnGPS(mapNeu, null, null);
  });

  // Form
  document.getElementById('btn-form-cancel').addEventListener('click', closeFormSheet);
  document.getElementById('btn-form-save').addEventListener('click', saveNewTree);
  document.getElementById('form-backdrop').addEventListener('click', closeFormSheet);

  // Service Worker registrieren
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-erfassung.js').catch(e => console.warn('SW:', e));
  }

  // Netzwerk-Badge initial setzen + Queue sync
  updateNetworkBadge();
  if (isOnline) syncQueue();

  // Projekte laden + Loading ausblenden + Login zeigen
  loadProjects().then(() => {
    hideLoading();
    document.getElementById('screen-login').classList.add('active');
  }).catch(e => {
    console.error(e);
    hideLoading();
    document.getElementById('screen-login').classList.add('active');
  });
});
