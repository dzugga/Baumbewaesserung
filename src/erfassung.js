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
const storage = firebase.storage(fbApp);

// HTML-Escape gegen Stored-XSS (Baum-Daten aus Firestore in innerHTML/Tooltips)
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
        const col = db.collection('projects').doc(entry.projectId).collection('trees');
        let treeId = entry.treeId;
        if (treeId) await col.doc(treeId).set(entry.data, { merge: true });
        else { treeId = (await col.add(entry.data)).id; }
        if (entry.hasPhotos) {
          const photos = await idbGetPhotos(treeId);
          if (photos.length) {
            const urls = await uploadPhotos(entry.orgId || entry.data.orgId, entry.projectId, treeId, photos.map(p => p.blob));
            await col.doc(treeId).set({ fotos: firebase.firestore.FieldValue.arrayUnion(...urls) }, { merge: true });
            await idbDeletePhotos(treeId);
          }
        }
      } else if (entry.type === 'updateCoords') {
        await db.collection('projects').doc(entry.projectId).collection('trees').doc(entry.treeId)
          .set(entry.data, { merge: true });
      } else if (entry.type === 'addPhotos') {
        const photos = await idbGetPhotos(entry.treeId);
        if (photos.length) {
          await attachPhotosOnline(entry.orgId, entry.projectId, entry.treeId, photos.map(p => p.blob));
          await idbDeletePhotos(entry.treeId);
        }
      }
    } catch(e) { failed.push(entry); }
  }
  localStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
  if (q.length - failed.length > 0) toast(`✓ ${q.length - failed.length} Einträge synchronisiert`);
  updateNetworkBadge();
}

// ─── FOTOS ────────────────────────────────────────────────────
// Bild im Browser verkleinern/komprimieren (Kosten & Bandbreite gering halten)
function compressImage(file, maxDim = 1280, quality = 0.65) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width, h = img.height;
      if (w > h && w > maxDim) { h = Math.round(h * maxDim / w); w = maxDim; }
      else if (h > maxDim) { w = Math.round(w * maxDim / h); h = maxDim; }
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

// Upload nach Storage; gibt [{u:downloadURL, t:ts}] zurück (1-Jahr-Cache → erneutes Ansehen kostet nichts)
async function uploadPhotos(orgId, projectId, treeId, blobs) {
  const urls = [];
  for (const blob of blobs) {
    const fn = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + '.jpg';
    const ref = storage.ref(`objektfotos/${orgId}/${projectId}/${treeId}/${fn}`);
    await ref.put(blob, { contentType: 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' });
    urls.push({ u: await ref.getDownloadURL(), t: Date.now() });
  }
  return urls;
}

// Fotos an ein bestehendes Objekt anhängen (online: Upload + arrayUnion; gibt URLs zurück)
async function attachPhotosOnline(orgId, projectId, treeId, blobs) {
  const urls = await uploadPhotos(orgId, projectId, treeId, blobs);
  await db.collection('projects').doc(projectId).collection('trees').doc(treeId)
    .set({ fotos: firebase.firestore.FieldValue.arrayUnion(...urls) }, { merge: true });
  return urls;
}

// Offline-Fotospeicher (IndexedDB — localStorage wäre für Bild-Blobs zu klein)
const PHOTO_DB = 'bwt_fotos', PHOTO_STORE = 'pending';
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(PHOTO_DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(PHOTO_STORE)) r.result.createObjectStore(PHOTO_STORE, { keyPath: 'key' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbPutPhotos(treeId, blobs) {
  const dbi = await idbOpen();
  return new Promise((res, rej) => {
    const tx = dbi.transaction(PHOTO_STORE, 'readwrite'), st = tx.objectStore(PHOTO_STORE);
    blobs.forEach((b, i) => st.put({ key: `${treeId}|${i}`, treeId, blob: b }));
    tx.oncomplete = () => { dbi.close(); res(); }; tx.onerror = () => { dbi.close(); rej(tx.error); };
  });
}
async function idbGetPhotos(treeId) {
  const dbi = await idbOpen();
  return new Promise((res) => {
    const tx = dbi.transaction(PHOTO_STORE, 'readonly'), rq = tx.objectStore(PHOTO_STORE).getAll();
    rq.onsuccess = () => { dbi.close(); res((rq.result || []).filter(p => p.treeId === treeId)); };
    rq.onerror = () => { dbi.close(); res([]); };
  });
}
async function idbDeletePhotos(treeId) {
  const photos = await idbGetPhotos(treeId); if (!photos.length) return;
  const dbi = await idbOpen();
  return new Promise((res) => {
    const tx = dbi.transaction(PHOTO_STORE, 'readwrite'), st = tx.objectStore(PHOTO_STORE);
    photos.forEach(p => st.delete(p.key));
    tx.oncomplete = () => { dbi.close(); res(); }; tx.onerror = () => { dbi.close(); res(); };
  });
}

// Foto-Aufnahme im Formular (nur „Neues Objekt")
let pendingPhotos = []; // {blob, preview}
function renderFotoStrip() {
  const strip = document.getElementById('foto-strip'); if (!strip) return;
  strip.innerHTML = pendingPhotos.map((p, i) => `
    <div style="position:relative;width:64px;height:64px;border-radius:8px;overflow:hidden;border:1px solid var(--border);">
      <img src="${p.preview}" style="width:100%;height:100%;object-fit:cover;">
      <button type="button" data-i="${i}" class="foto-rm" style="position:absolute;top:2px;right:2px;width:18px;height:18px;border:none;border-radius:50%;background:rgba(0,0,0,.6);color:#fff;font-size:13px;line-height:1;cursor:pointer;padding:0;">×</button>
    </div>`).join('');
}
function clearPendingPhotos() {
  pendingPhotos.forEach(p => { try { URL.revokeObjectURL(p.preview); } catch (e) {} });
  pendingPhotos = []; renderFotoStrip();
}
async function onFotoSelected(e) {
  const files = [...(e.target.files || [])]; e.target.value = '';
  for (const f of files) {
    try { const blob = await compressImage(f); pendingPhotos.push({ blob, preview: URL.createObjectURL(blob) }); }
    catch (err) { toast('Foto konnte nicht verarbeitet werden'); }
  }
  renderFotoStrip();
}

// ─── STATE ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProjectData = null;
let currentErfasser = null;
let currentUser = null;     // Firebase-Auth-Nutzer
let currentRole = '';       // Custom Claims
let currentCap  = '';       // Custom Claims (Basis-Typ)
let currentOrg  = '';       // Custom Claims
let erfLoginMode = 'pin';
let erfRoles = {};          // roleKey -> {modules,...}
function canUseErfassung(){
  if(currentRole==='superadmin' || currentCap==='admin') return true;
  const r=erfRoles[currentRole];
  return !!(r && r.modules && r.modules.erfassung);
}
let allTrees = [];          // alle Bäume des Projekts
let treesOhneKoords = [];   // Bäume ohne Koordinaten (Modus 2)
let selectedTree = null;    // für Modus 2
let activeMode = 'koord';   // 'koord' | 'neu'
let formMode = 'new';       // 'new' (Neues Objekt) | 'edit' (Koordinaten-Reiter) | 'overview' (Übersicht: direkt speichern)
let overviewEditTree = null;
let overviewEditMarker = null;
let overviewEditType = 'erfasst';
let mapNeu = null;
let mapKoord = null;
let gpsMarkerNeu = null;
let gpsMarkerKoord = null;
let pendingCoords = null;   // {lat, lng} für Formular
let erfassteMarkers = [];        // grüne Marker auf map-neu
let erfassteMarkersUebersicht = []; // grüne Marker auf map-uebersicht
let koordiniertMarkers = [];    // blaue Marker auf map-uebersicht
let bestandMarkers = [];        // rote Marker (DB-Bestand) auf map-uebersicht
let bestandShown = false;       // Bestandsobjekte aktuell eingeblendet?
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

// Tooltip-Inhalt für einen Baum je Marker-Typ
function treeTooltipHtml(tree, type) {
  const id = type === 'bestand' ? (tree.baumnr || '') : (tree.baumId || '');
  let tag = '';
  if (type === 'koord') tag = '<br><i style="color:#1e40af">Koordinate gesetzt</i>';
  else if (type === 'bestand') tag = '<br><i style="color:#dc2626">Bestand</i>';
  return `<b>${esc(tree.name || '–')}</b><br><span style="font-family:monospace">${esc(id)}</span>${tag}`;
}

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
    .bindTooltip(treeTooltipHtml(tree, 'koord'), { direction: 'top', offset: [0,-16] });
  if (map === mapUebersicht) marker.on('click', () => openOverviewEditSheet(tree, marker, 'koord'));
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
    .bindTooltip(treeTooltipHtml(tree, 'erfasst'), { direction: 'top', offset: [0, -16] });
  if (map === mapUebersicht) marker.on('click', () => openOverviewEditSheet(tree, marker, 'erfasst'));
  markerList.push(marker);
}

// ─── BESTANDSOBJEKTE (DB) – rote Marker ───────────────────────
function makeBestandIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="width:24px;height:24px;border-radius:50%;background:#dc2626;border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z"/></svg>
    </div>`,
    iconSize: [24, 24], iconAnchor: [12, 12]
  });
}

function addBestandMarker(tree) {
  if (!tree.lat || !tree.lng) return;
  const marker = L.marker([tree.lat, tree.lng], { icon: makeBestandIcon() })
    .addTo(mapUebersicht)
    .bindTooltip(treeTooltipHtml(tree, 'bestand'), { direction: 'top', offset: [0, -14] });
  marker.on('click', () => openOverviewEditSheet(tree, marker, 'bestand'));
  bestandMarkers.push(marker);
}

function updateBestandBtn() {
  const btn = document.getElementById('btn-bestand-toggle');
  if (!btn) return;
  const dot = btn.querySelector('.bestand-dot');
  const lbl = btn.querySelector('.bestand-label');
  if (dot) dot.style.opacity = bestandShown ? '1' : '.4';
  if (lbl) lbl.textContent = bestandShown ? 'Bestandsobjekte ausblenden' : 'Bestandsobjekte anzeigen';
  btn.style.color = bestandShown ? '#dc2626' : '#991b1b';
  btn.style.background = bestandShown ? '#fef2f2' : 'var(--surface)';
}

function hideBestand() {
  bestandMarkers.forEach(m => { try { mapUebersicht.removeLayer(m); } catch(e){} });
  bestandMarkers.length = 0;
  bestandShown = false;
  updateBestandBtn();
}

async function toggleBestand() {
  if (bestandShown) { hideBestand(); return; }
  if (!mapUebersicht) return;
  try {
    // allTrees ist durch den Trees-Listener immer aktuell — kein erneuter Collection-Read nötig
    // Session-Objekte ausschließen – sie bleiben grün/blau
    const sessionIds = new Set([..._erfassteData.map(t => t.id), ..._koordiniertData.map(t => t.id)]);
    const bestand = allTrees.filter(t => !sessionIds.has(t.id) && t.lat && t.lng);
    bestand.forEach(addBestandMarker);
    bestandShown = true;
    updateBestandBtn();
    toast(`${bestand.length} Bestandsobjekte angezeigt`);
  } catch(e) {
    console.warn('toggleBestand:', e);
    toast('Fehler beim Anzeigen der Bestandsobjekte');
  }
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

// Lokale Marker + Zähler der Übersicht leeren
function clearOverviewLocal() {
  erfassteMarkers.forEach(m => { try { mapNeu.removeLayer(m); } catch(e){} });
  erfassteMarkers.length = 0;
  if (mapUebersicht) {
    erfassteMarkersUebersicht.forEach(m => { try { mapUebersicht.removeLayer(m); } catch(e){} });
    koordiniertMarkers.forEach(m => { try { mapUebersicht.removeLayer(m); } catch(e){} });
  }
  erfassteMarkersUebersicht.length = 0;
  koordiniertMarkers.length = 0;
  if (mapUebersicht) hideBestand();
  _erfassteData.length = 0;
  _koordiniertData.length = 0;
  erfassteCount = 0;
  koordiniertCount = 0;
  updateErfasstCounter();
  updateUebersichtLabel();
}

async function resetUebersicht() {
  if (!confirm('Karte leeren?\nEntfernt deine Erfassungs-Markierungen aus der Übersicht. Bäume und Koordinaten bleiben erhalten.')) return;
  toast('Karte wird geleert…');
  try {
    const col = db.collection('projects').doc(currentProjectId).collection('trees');
    // Alle eigenen Markierungen FRISCH vom Server holen (nicht nur lokal Geladenes)
    const [erfSnap, koordSnap] = await Promise.all([
      col.where('erfasstVon', '==', currentErfasser).get(),
      col.where('koordiniertVon', '==', currentErfasser).get(),
    ]);
    const deleteField = firebase.firestore.FieldValue.delete();
    // Pro Dokument zusammenfassen (falls beide Felder gesetzt)
    const updates = {};
    erfSnap.docs.forEach(d => { (updates[d.id] = updates[d.id] || { ref: d.ref, data: {} }).data.erfasstVon = deleteField; });
    koordSnap.docs.forEach(d => { (updates[d.id] = updates[d.id] || { ref: d.ref, data: {} }).data.koordiniertVon = deleteField; });
    const ops = Object.values(updates);

    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(o => batch.update(o.ref, o.data));
      await batch.commit();
    }
    // Auf Server-Bestätigung warten (max. 10s)
    const synced = await Promise.race([
      db.waitForPendingWrites().then(() => true),
      new Promise(r => setTimeout(() => r(false), 10000)),
    ]);

    clearOverviewLocal();
    if (ops.length === 0) toast('✓ Übersicht ist bereits leer');
    else if (synced) toast(`✓ Karte geleert — ${ops.length} Markierungen entfernt`);
    else toast('⚠ Teilweise nicht synchronisiert — bei Verbindung „Karte leeren" erneut tippen');
  } catch (e) {
    console.warn('resetUebersicht:', e);
    toast(`⚠ Fehler beim Leeren: ${e.code || e.message}`);
  }
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
// ─── AUTH / LOGIN (E-Mail -> Projektauswahl) ──────────────────
function _erfErr(m){ const e=document.getElementById('login-error'); if(e){ e.textContent=m; e.style.display=m?'block':'none'; } }
function _erfBtn(txt,dis){ const b=document.getElementById('btn-login'),l=document.getElementById('btn-login-label'); if(l)l.textContent=txt; if(b)b.disabled=!!dis; }

function _setMode(){
  const pm=document.getElementById('lg-pin-mode'), em=document.getElementById('lg-email-mode');
  if(pm) pm.style.display=erfLoginMode==='pin'?'':'none';
  if(em) em.style.display=erfLoginMode==='email'?'':'none';
}
function toggleLoginMode(){
  erfLoginMode = erfLoginMode==='pin'?'email':'pin';
  _setMode();
  const tg=document.getElementById('login-toggle'); if(tg) tg.textContent=erfLoginMode==='pin'?'Admin-Anmeldung (E-Mail)':'Anmeldung mit Stadt-Code + PIN';
  _erfErr('');
}
function showLoginStep1(msg){
  document.getElementById('screen-app')?.classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  _setMode();
  const pg=document.getElementById('lg-project'); if(pg) pg.style.display='none';
  const tg=document.getElementById('login-toggle'); if(tg) tg.style.display='';
  _erfBtn('Anmelden', false); _erfErr(msg||'');
  try{ const oc=localStorage.getItem('bwt_mobile_orgcode'); const e2=document.getElementById('login-orgcode'); if(oc&&e2&&!e2.value)e2.value=oc;
       const nm=localStorage.getItem('bwt_mobile_name'); const e3=document.getElementById('login-name'); if(nm&&e3&&!e3.value)e3.value=nm; }catch(_){}
}
async function showProjectStep(){
  document.getElementById('screen-login').classList.add('active');
  const pm=document.getElementById('lg-pin-mode'), em=document.getElementById('lg-email-mode');
  if(pm) pm.style.display='none'; if(em) em.style.display='none';
  const tg=document.getElementById('login-toggle'); if(tg) tg.style.display='none';
  const pg=document.getElementById('lg-project'); if(pg) pg.style.display='';
  _erfBtn('Starten', false); _erfErr('');
  await loadProjects();
}

async function loadProjects() {
  const ref=db.collection('projects');
  const snap = currentRole==='superadmin' ? await ref.get() : await ref.where('orgId','==',currentOrg).get();
  const sel = document.getElementById('login-project');
  const docs=snap.docs;
  sel.innerHTML = '<option value="">– Projekt wählen –</option>' +
    docs.map(d => `<option value="${esc(d.id)}">${esc(d.data().name)}</option>`).join('');
  if (docs.length === 1) sel.value = docs[0].id;
}

async function doLogin() {
  _erfErr('');
  const projGroup=document.getElementById('lg-project');
  // Schritt 2: Projekt gewählt -> starten
  if(currentUser && projGroup && projGroup.style.display!=='none'){
    const pid=document.getElementById('login-project').value;
    if(!pid){ _erfErr('Bitte Projekt wählen.'); return; }
    await startErfassung(pid);
    return;
  }
  // Schritt 1: anmelden
  if(erfLoginMode==='email'){
    const email=(document.getElementById('login-email')?.value||'').trim();
    const pass=document.getElementById('login-pass')?.value||'';
    if(!email||!pass){ _erfErr('Bitte E-Mail und Passwort eingeben.'); return; }
    _erfBtn('Anmelden…', true);
    try{ await firebase.auth().signInWithEmailAndPassword(email,pass); }
    catch(e){ const c=e&&e.code||''; _erfErr(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)?'E-Mail oder Passwort falsch':('Fehler: '+(e.message||c))); _erfBtn('Anmelden',false); }
    return;
  }
  const orgcode=(document.getElementById('login-orgcode')?.value||'').trim();
  const name=(document.getElementById('login-name')?.value||'').trim();
  const pin=(document.getElementById('login-pin')?.value||'').trim();
  if(!name||!pin){ _erfErr('Bitte Name und PIN ausfüllen.'); return; }
  if(!/^\d{6}$/.test(pin)){ _erfErr('PIN muss 6-stellig sein.'); return; }
  _erfBtn('Anmelden…', true);
  try{
    const res=await firebase.app().functions('us-central1').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(),name,pin});
    try{ localStorage.setItem('bwt_mobile_orgcode',orgcode.toUpperCase()); localStorage.setItem('bwt_mobile_name',name); }catch(_){}
    await firebase.auth().signInWithCustomToken(res.data.token);
  }catch(e){ const c=e&&e.code||'',m=e&&e.message||''; _erfErr(/permission-denied|not-found|unauthenticated|resource-exhausted/.test(c)?(m||'Name oder PIN falsch'):('Fehler: '+(m||c))); _erfBtn('Anmelden',false); }
}

// Bäume per Listener statt Einmal-Read: Firestore-Persistenz (IndexedDB) liefert beim
// Re-Login einen Resume-Token → Server sendet nur GEÄNDERTE Dokumente (Delta-Reads statt
// kompletter Collection). Nebeneffekt: „ohne Koordinaten"-Liste aktualisiert sich live,
// wenn Kollegen Koordinaten setzen (kein Doppel-Erfassen).
let unsubTreesErf = null;
function watchTrees(pid){
  if (unsubTreesErf) { try{ unsubTreesErf(); }catch(_){} unsubTreesErf = null; }
  return new Promise(resolve => {
    let first = true;
    unsubTreesErf = db.collection('projects').doc(pid).collection('trees').onSnapshot(snap => {
      // Optimistische lokale Writes ignorieren: die Save-Logik (waitForPendingWrites +
      // applyCoordLocally) steuert die Liste selbst — „Baum bleibt bis Server-Bestätigung".
      if (!first && snap.metadata.hasPendingWrites) return;
      allTrees = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      treesOhneKoords = allTrees.filter(t => !t.lat || !t.lng);
      cacheTreesLocal(pid, currentErfasser, allTrees);
      if (first) { first = false; resolve(); }
      else renderKoordList(document.getElementById('koord-search')?.value || '');
    }, err => { console.warn('trees-listen:', err); if (first) { first = false; resolve(); } });
  });
}

async function startErfassung(pid){
  const snap = await db.collection('projects').doc(pid).get();
  currentProjectData = { id: pid, ...snap.data() };
  currentProjectId = pid;

  await watchTrees(pid);
  if (!allTrees.length) {
    // Erster Login offline ohne Firestore-Cache → localStorage-Fallback
    const cached = loadCachedTrees(pid, currentErfasser);
    if (cached && cached.length) {
      allTrees = cached;
      treesOhneKoords = allTrees.filter(t => !t.lat || !t.lng);
      toast('📦 Offline — lokale Daten geladen');
    }
  }

  document.getElementById('header-project').textContent = currentProjectData.name;
  document.getElementById('header-erfasser').textContent = currentErfasser;
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  renderKoordList('');
  initMapNeu();
  initMapKoord();
  setTimeout(() => loadErfassteMarkers(), 500);

  const withCoords = allTrees.filter(t => t.lat && t.lng && t.lat > 40 && t.lat < 55 && t.lng > 5 && t.lng < 15);
  if (withCoords.length > 0) {
    const sortedLats = [...withCoords.map(t => t.lat)].sort((a,b)=>a-b);
    const sortedLngs = [...withCoords.map(t => t.lng)].sort((a,b)=>a-b);
    const mid = Math.floor(sortedLats.length / 2);
    mapNeu.setView([sortedLats[mid], sortedLngs[mid]], 14);
    mapKoord.setView([sortedLats[mid], sortedLngs[mid]], 14);
  }
}

async function doLogout() {
  if (!confirm('Abmelden?')) return;
  try{ await firebase.auth().signOut(); }catch(_){}
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
    (t.stadtteil || '').toLowerCase().includes(lower) ||
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
      <div class="koord-item-num">${esc(t.baumId || '–')}</div>
      <div class="koord-item-info">
        <div class="koord-item-name">${esc(t.name || '–')}</div>
        <div class="koord-item-meta">${esc(t.art || '–')}${t.stadtteil ? ' · ' + esc(t.stadtteil) : ''}${t.baumnr ? ' · ' + esc(t.baumnr) : ''}</div>
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
  // Im Koordinaten-Reiter bearbeitete Eigenschaften mitschreiben
  if (selectedTree._edited) {
    ['name','stadtteil','baumnr','art','pflanzjahr','pflanzzeitpunkt','zustand','wasser','notiz'].forEach(k => {
      if (selectedTree[k] !== undefined) coordUpdate[k] = selectedTree[k];
    });
  }
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
  formMode = 'new';
  document.querySelector('#form-sheet .sheet-title').textContent = 'Neues Objekt';
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
  clearPendingPhotos();
  const ff = document.getElementById('foto-field'); if (ff) ff.style.display = '';
  document.getElementById('form-backdrop').classList.add('open');
  document.getElementById('form-sheet').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 400);
}

function closeFormSheet() {
  document.getElementById('form-backdrop').classList.remove('open');
  document.getElementById('form-sheet').classList.remove('open');
  clearPendingPhotos();
  pendingCoords = null;
  formMode = 'new';
  overviewEditTree = null;
  overviewEditMarker = null;
}

// Formularfelder aus einem Baum befüllen / auslesen (gemeinsam für alle Edit-Modi)
function fillFormFromTree(t) {
  document.getElementById('f-name').value = t.name || '';
  document.getElementById('f-stadtteil').value = t.stadtteil || '';
  document.getElementById('f-baumnr').value = t.baumnr || '';
  document.getElementById('f-art').value = t.art || '';
  document.getElementById('f-pflanzjahr').value = t.pflanzjahr || '';
  document.getElementById('f-pflanzzeitpunkt').value = t.pflanzzeitpunkt || '';
  document.getElementById('f-zustand').value = t.zustand || 'mittel';
  document.getElementById('f-wasser').value = t.wasser || t.wasserbedarf || 'mittel';
  document.getElementById('f-notiz').value = t.notiz || '';
}
function collectFormEdits() {
  return {
    name: document.getElementById('f-name').value.trim(),
    stadtteil: document.getElementById('f-stadtteil').value,
    baumnr: document.getElementById('f-baumnr').value,
    art: document.getElementById('f-art').value,
    pflanzjahr: document.getElementById('f-pflanzjahr').value,
    pflanzzeitpunkt: document.getElementById('f-pflanzzeitpunkt').value,
    zustand: document.getElementById('f-zustand').value,
    wasser: document.getElementById('f-wasser').value,
    notiz: document.getElementById('f-notiz').value,
  };
}

// Eigenschaften des gewählten Baums bearbeiten (Koordinaten-Reiter) –
// nutzt dieselbe Maske wie „Neues Objekt“.
function openKoordEditSheet() {
  if (!selectedTree) return;
  formMode = 'edit';
  document.querySelector('#form-sheet .sheet-title').textContent = 'Eigenschaften bearbeiten';
  document.getElementById('form-coords-display').textContent = selectedTree.baumId || 'Eigenschaften';
  fillFormFromTree(selectedTree);
  clearPendingPhotos();
  const ff = document.getElementById('foto-field'); if (ff) ff.style.display = '';
  document.getElementById('form-backdrop').classList.add('open');
  document.getElementById('form-sheet').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 400);
}

// Bearbeitete Eigenschaften in den Speicher übernehmen (werden beim
// „Position speichern“ zusammen mit der Koordinate persistiert).
async function saveKoordEdits() {
  if (!selectedTree) { closeFormSheet(); return; }
  const edits = collectFormEdits();
  if (!edits.name) { toast('⚠ Bitte einen Namen eingeben'); return; }
  const tree = selectedTree;
  const orgId = tree.orgId || currentProjectData?.orgId || currentOrg;
  const photoBlobs = pendingPhotos.map(p => p.blob);
  clearPendingPhotos();
  Object.assign(tree, edits, { _edited: true });
  document.getElementById('koord-tree-name').textContent =
    `${tree.name || '–'}${tree.baumnr ? ' · ' + tree.baumnr : ''}`;
  closeFormSheet();
  // Fotos hängen direkt am bestehenden Objekt (unabhängig vom Positions-Speichern)
  if (photoBlobs.length && tree.id) {
    if (!isOnline) {
      try { await idbPutPhotos(tree.id, photoBlobs); } catch (_) {}
      addToQueue({ type: 'addPhotos', projectId: currentProjectId, treeId: tree.id, orgId });
      toast('Eigenschaften übernommen · 📦 Foto(s) offline — werden synchronisiert. Jetzt Position setzen.');
    } else {
      try { await attachPhotosOnline(orgId, currentProjectId, tree.id, photoBlobs); toast(`Eigenschaften übernommen · ${photoBlobs.length} Foto(s) gespeichert — jetzt Position setzen.`); }
      catch (e) { try { await idbPutPhotos(tree.id, photoBlobs); } catch (_) {} addToQueue({ type: 'addPhotos', projectId: currentProjectId, treeId: tree.id, orgId }); toast('Eigenschaften übernommen · Foto(s) in Warteschlange. Jetzt Position setzen.'); }
    }
  } else {
    toast('Eigenschaften übernommen — jetzt Position setzen & speichern');
  }
}

// Eigenschaften nachträglich bearbeiten (Übersicht: Klick auf Marker) –
// speichert direkt in die Datenbank.
function openOverviewEditSheet(tree, marker, type) {
  if (!tree) return;
  formMode = 'overview';
  overviewEditTree = tree;
  overviewEditMarker = marker || null;
  overviewEditType = type || 'erfasst';
  document.querySelector('#form-sheet .sheet-title').textContent = 'Eigenschaften bearbeiten';
  document.getElementById('form-coords-display').textContent =
    (type === 'bestand' ? (tree.baumnr || '') : (tree.baumId || '')) || (tree.name || '');
  fillFormFromTree(tree);
  clearPendingPhotos();
  const ff = document.getElementById('foto-field'); if (ff) ff.style.display = '';
  document.getElementById('form-backdrop').classList.add('open');
  document.getElementById('form-sheet').classList.add('open');
  setTimeout(() => document.getElementById('f-name').focus(), 400);
}

async function saveOverviewEdits() {
  const tree = overviewEditTree, marker = overviewEditMarker, type = overviewEditType;
  if (!tree) { closeFormSheet(); return; }
  const edits = collectFormEdits();
  if (!edits.name) { toast('⚠ Bitte einen Namen eingeben'); return; }
  if (!tree.id) { toast('⚠ Objekt noch nicht synchronisiert — bitte später bearbeiten'); return; }
  const orgId = tree.orgId || currentProjectData?.orgId || currentOrg;
  const photoBlobs = pendingPhotos.map(p => p.blob);
  clearPendingPhotos();
  // In-Memory aktualisieren
  Object.assign(tree, edits);
  allTrees = allTrees.map(x => x.id === tree.id ? { ...x, ...edits } : x);
  if (marker) marker.setTooltipContent(treeTooltipHtml(tree, type));
  closeFormSheet();
  // Direkt persistieren (Offline → Queue)
  if (!isOnline) {
    addToQueue({ type: 'updateCoords', projectId: currentProjectId, treeId: tree.id, data: edits });
    if (photoBlobs.length) { try { await idbPutPhotos(tree.id, photoBlobs); } catch (_) {} addToQueue({ type: 'addPhotos', projectId: currentProjectId, treeId: tree.id, orgId }); }
    toast('📦 Offline gespeichert — wird synchronisiert');
    return;
  }
  toast('Speichern…');
  try {
    await db.collection('projects').doc(currentProjectId).collection('trees').doc(tree.id).set(edits, { merge: true });
    if (photoBlobs.length) await attachPhotosOnline(orgId, currentProjectId, tree.id, photoBlobs);
    const synced = await Promise.race([
      db.waitForPendingWrites().then(() => true),
      new Promise(r => setTimeout(() => r(false), 10000)),
    ]);
    toast(synced ? `✓ Eigenschaften gespeichert${photoBlobs.length ? ` · ${photoBlobs.length} Foto(s)` : ''}` : '⚠ Nicht synchronisiert — erneut versuchen');
  } catch (e) {
    addToQueue({ type: 'updateCoords', projectId: currentProjectId, treeId: tree.id, data: edits });
    if (photoBlobs.length) { try { await idbPutPhotos(tree.id, photoBlobs); } catch (_) {} addToQueue({ type: 'addPhotos', projectId: currentProjectId, treeId: tree.id, orgId }); }
    console.warn('Overview-Edit-Save:', e);
    toast(`⚠ Fehler — in Warteschlange: ${e.code || e.message}`);
  }
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

  // Dokument-ID vorab erzeugen → Foto-Pfad steht vor dem Speichern fest (1 Write inkl. Foto-URLs)
  const colRef = db.collection('projects').doc(currentProjectId).collection('trees');
  const ref = colRef.doc();
  const treeId = ref.id;
  const orgId = currentProjectData?.orgId || currentOrg;

  // Daten VOR dem try-Block aufbauen (damit catch darauf zugreifen kann)
  const data = {
    id: treeId, baumId, name,
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
    orgId,
  };

  // Fotos übernehmen (Strip leeren, damit nächstes Objekt sauber startet)
  const photoBlobs = pendingPhotos.map(p => p.blob);
  clearPendingPhotos();

  // UI sofort aktualisieren (optimistic)
  _erfassteData.push(data);
  addErfasstMarker(data, mapNeu, erfassteMarkers);
  if (mapUebersicht) addErfasstMarker(data, mapUebersicht, erfassteMarkersUebersicht);
  erfassteCount++;
  updateErfasstCounter();
  closeFormSheet();

  try {
    if (!isOnline) throw new Error('offline');
    if (photoBlobs.length) data.fotos = await uploadPhotos(orgId, currentProjectId, treeId, photoBlobs);
    await ref.set({ ...data, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    toast(`✓ ${name} gespeichert${photoBlobs.length ? ` · ${photoBlobs.length} Foto(s)` : ''}`);
  } catch (e) {
    if (photoBlobs.length) { try { await idbPutPhotos(treeId, photoBlobs); } catch (_) {} }
    addToQueue({ type: 'newTree', projectId: currentProjectId, treeId, data, orgId, hasPhotos: photoBlobs.length > 0 });
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
    // Bestandsobjekte beim Öffnen der Ansicht standardmäßig ausgeblendet
    hideBestand();
    setTimeout(() => { if (mapUebersicht) mapUebersicht.invalidateSize(); }, 100);
    updateUebersichtLabel();
  }
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Login (E-Mail -> Projektauswahl)
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
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
  document.getElementById('btn-bestand-toggle')?.addEventListener('click', toggleBestand);

  // Modus 2
  document.getElementById('koord-search').addEventListener('input', e => renderKoordList(e.target.value));
  document.getElementById('btn-back-list').addEventListener('click', closeKoordMap);
  document.getElementById('btn-save-koord').addEventListener('click', saveKoordPosition);
  document.getElementById('btn-gps-koord').addEventListener('click', () => {
    centerOnGPS(mapKoord, null, null);
  });

  // Fotos
  document.getElementById('btn-foto-add')?.addEventListener('click', () => document.getElementById('foto-input')?.click());
  document.getElementById('foto-input')?.addEventListener('change', onFotoSelected);
  document.getElementById('foto-strip')?.addEventListener('click', e => {
    const rm = e.target.closest('.foto-rm'); if (!rm) return;
    const i = +rm.dataset.i; if (pendingPhotos[i]) { try { URL.revokeObjectURL(pendingPhotos[i].preview); } catch (_) {} pendingPhotos.splice(i, 1); renderFotoStrip(); }
  });

  // Modus 1
  document.getElementById('btn-erfassen').addEventListener('click', openFormSheet);
  document.getElementById('btn-gps-neu').addEventListener('click', () => {
    centerOnGPS(mapNeu, null, null);
  });

  // Form
  document.getElementById('btn-form-cancel').addEventListener('click', closeFormSheet);
  document.getElementById('btn-form-save').addEventListener('click', () => {
    if (formMode === 'overview') saveOverviewEdits();
    else if (formMode === 'edit') saveKoordEdits();
    else saveNewTree();
  });
  document.getElementById('form-backdrop').addEventListener('click', closeFormSheet);
  document.getElementById('btn-koord-edit')?.addEventListener('click', openKoordEditSheet);

  // Service Worker registrieren
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-erfassung.js').catch(e => console.warn('SW:', e));
  }

  // Netzwerk-Badge initial setzen + Queue sync
  updateNetworkBadge();
  if (isOnline) syncQueue();

  // Auth-Gate: entscheidet Login vs. Projektauswahl
  const tgl=document.getElementById('login-toggle'); if(tgl) tgl.addEventListener('click', toggleLoginMode);
  document.getElementById('login-pin')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  firebase.auth().onAuthStateChanged(async (user) => {
    hideLoading();
    if (user) {
      try { const tok = await user.getIdTokenResult(); currentUser = user; currentRole = tok.claims.role || ''; currentCap = tok.claims.cap || ''; currentOrg = tok.claims.orgId || ''; currentErfasser = tok.claims.name || user.email || user.uid; }
      catch (e) { currentRole = ''; currentCap=''; currentOrg = ''; }
      if (!currentRole) { showLoginStep1('Dieses Konto hat keine Berechtigung.'); return; }
      try { const rs = await db.collection('roles').doc(currentRole).get(); if (rs.exists) erfRoles[currentRole] = rs.data(); } catch(e){}
      if (!canUseErfassung()) { showLoginStep1('Diese Rolle hat keinen Zugriff auf die Erfassungs-App.'); return; }
      showProjectStep();
    } else {
      currentUser = null; currentRole = ''; currentCap=''; currentOrg = '';
      showLoginStep1('');
    }
  });
});
