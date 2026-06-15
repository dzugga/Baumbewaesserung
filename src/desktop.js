// App-Version – hier zentral pflegen (wird im Einstellungen-Panel angezeigt)
const APP_VERSION = '1.0';

import { HANDBUCH } from './handbuch-daten.js';
import { SI_DSGVO, SI_STACK, SI_REGIONEN, SI_APPS, SI_SICHERHEIT, SI_DIENSTE } from './systeminfo-daten.js';
import { initAppCheck } from './appcheck.js';
import { basemapLayer, BASEMAP_FARBE, BASEMAP_ATTR } from './basemaps.js';
import { firebaseConfig } from './firebase-config.js';
import { esc as dlEsc } from './esc.js'; // dlEsc = projektweites HTML-Escape (zentral in esc.js)

function initializeApp(cfg){ return firebase.initializeApp(cfg); }
function getFirestore(app){ return firebase.firestore(app); }
function collection(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function doc(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function getDoc(ref){ return ref.get().then(s=>{ _bumpUsage('reads',1,ref); return s; }); }
function getDocs(ref){ return ref.get().then(s=>{ _bumpUsage('reads',Math.max(1,s.size||0),ref); return s; }); }
// Hängt orgId automatisch an Dokumente innerhalb projects/{id}/<sub>/… (denormalisiert für Rules)
function _injectOrg(ref,data){
  if(!data || typeof data!=='object' || Array.isArray(data) || data.orgId!==undefined) return data;
  const path = ref && ref.path || '';
  if(/^projects\/[^/]+\/.+/.test(path) && currentProjectData && currentProjectData.orgId)
    return {...data, orgId: currentProjectData.orgId};
  return data;
}
function addDoc(ref,data){ const p=ref.add(_injectOrg(ref,data)); _bumpUsage('writes',1,ref); return p; }
function setDoc(ref,data,opts){ data=_injectOrg(ref,data); const p=opts?ref.set(data,opts):ref.set(data); _bumpUsage('writes',1,ref); return p; }
function updateDoc(ref,data){ const p=ref.update(data); _bumpUsage('writes',1,ref); return p; }
function deleteDoc(ref){ const p=ref.delete(); _bumpUsage('deletes',1,ref); return p; }
function onSnapshot(ref,cb){ return ref.onSnapshot(snap=>{ try{ const n=snap.docChanges?snap.docChanges().length:1; _bumpUsage('reads',n||1,ref); }catch(_){ _bumpUsage('reads',1,ref); } cb(snap); }); }
function serverTimestamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
function query(ref,...constraints){ constraints.forEach(c=>{ if(typeof c==='function') c(ref); }); return ref; }
function orderBy(field,dir='asc'){ return ref=>ref.orderBy(field,dir); }
function arrayUnion(...items){ return firebase.firestore.FieldValue.arrayUnion(...items); }

// ─── FIREBASE CONFIG (zentral in firebase-config.js) ──────────
const app = initializeApp(firebaseConfig);
initAppCheck();
const db  = getFirestore(app);
const storage = firebase.storage(app);

// ─── NUTZUNGS-ZÄHLUNG je Mandant (Näherung; zählt nur App-Vorgänge) ──────────
let _usageByOrg = {};
let _usageFlushTimer = null;
function _curUsageOrg(){ return (typeof currentProjectData!=='undefined'&&currentProjectData&&currentProjectData.orgId) || (typeof currentOrg!=='undefined'&&currentOrg) || ''; }
function _bumpUsage(kind,n,ref){
  if(!(n>0)) return;
  if(ref && ref.path && ref.path.indexOf('usage')===0) return; // eigene Nutzungs-Dokumente nicht mitzählen
  const org=_curUsageOrg(); if(!org) return;
  (_usageByOrg[org] || (_usageByOrg[org]={reads:0,writes:0,deletes:0}))[kind]+=n;
  if(!_usageFlushTimer) _usageFlushTimer=setTimeout(flushUsage, 45000);
}
function _usageMonth(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0'); }
async function flushUsage(){
  _usageFlushTimer=null;
  const pending=_usageByOrg; _usageByOrg={};
  const ym=_usageMonth(); const inc=firebase.firestore.FieldValue.increment;
  for(const org of Object.keys(pending)){
    const c=pending[org]; if(!c.reads&&!c.writes&&!c.deletes) continue;
    try{ await db.collection('usage').doc(org+'_'+ym).set({orgId:org,monat:ym,reads:inc(c.reads),writes:inc(c.writes),deletes:inc(c.deletes),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true}); }
    catch(e){ /* Näherung: bei Fehler verwerfen */ }
  }
}
// Batch-Vorgänge mitzählen
const _origBatch = db.batch.bind(db);
db.batch = function(){
  const b=_origBatch(); let w=0,d=0;
  const os=b.set.bind(b), ou=b.update.bind(b), od=b.delete.bind(b), oc=b.commit.bind(b);
  b.set=(...a)=>{ if(!(a[0]&&a[0].path&&a[0].path.indexOf('usage')===0)) w++; return os(...a); };
  b.update=(...a)=>{ w++; return ou(...a); };
  b.delete=(...a)=>{ d++; return od(...a); };
  b.commit=()=>{ const org=_curUsageOrg(); if(org&&(w||d)){ const u=(_usageByOrg[org]||(_usageByOrg[org]={reads:0,writes:0,deletes:0})); u.writes+=w; u.deletes+=d; if(!_usageFlushTimer)_usageFlushTimer=setTimeout(flushUsage,45000);} return oc(); };
  return b;
};
window.addEventListener('beforeunload', ()=>{ try{ flushUsage(); }catch(_){} });

// ─── CONSTANTS ────────────────────────────────────────────────
const TOUR_COLORS=[
  '#2d6a4f','#1e40af','#7c3aed','#be123c','#b45309','#0e7490','#064e3b','#b91c1c',
  '#c2410c','#4d7c0f','#15803d','#0f766e','#1d4ed8','#4338ca','#6d28d9','#a21caf',
  '#be185d','#9f1239','#1e3a8a','#166534','#92400e','#155e75','#5b21b6','#374151'
];

// Basis-Durchmesser der Objektkreise auf der Karte (px). Vorher 28 — etwas kleiner gestellt.
let markerSize=23;

// ─── n:m TOUR-HILFSFUNKTIONEN ─────────────────────────────────
// Rückwärtskompatibel: liest tourIds[] oder fällt auf altes tourId zurück
function getTreeTourIds(tree){
  if(Array.isArray(tree.tourIds)) return tree.tourIds.filter(Boolean);
  if(tree.tourId) return [tree.tourId];
  return [];
}
// Übersichtstouren (z.B. Stadtteil-Touren) sind keine „echten" Touren: kein Marker-Zähler,
// keine Routenberechnung, auf der Karte standardmäßig ausgeblendet.
function isOverviewTour(tourId){ const t=tours.find(x=>x.id===tourId); return !!(t&&t.uebersicht); }
function realTourIds(tree){ return getTreeTourIds(tree).filter(id=>!isOverviewTour(id)); } // ohne Übersichtstouren
function treeInTour(tree, tourId){
  return getTreeTourIds(tree).includes(tourId);
}
// Archiv: tree.aktiv===false → inaktiv (gefällt/abgegangen). Default = aktiv.
function isActive(tree){ return !tree || tree.aktiv!==false; }
function primaryTour(tree){
  // Übersichtstouren bestimmen NICHT die Standardfarbe — sonst erschiene ein nur einer
  // Stadtteil-Übersichtstour zugeordnetes (real unverplantes) Objekt eingefärbt statt grau.
  const ids = realTourIds(tree);
  return ids.length>0 ? tours.find(t=>t.id===ids[0]) : null;
}
async function setTreeTourIds(treeId, tourIds){
  await updateDoc(doc(db,'projects',currentProjectId,'trees',treeId),{
    tourIds: tourIds.filter(Boolean),
    tourId: tourIds[0]||''  // Compat-Feld für ältere mobile App
  });
}

// ─── FELDBEZEICHNUNGEN ────────────────────────────────────────
const DEFAULT_LABELS = {
  name:            'Anlage / Straße',
  stadtteil:       'Stadtteil',
  baumnr:          'Objektnummer',
  art:             'Typ / Art',
  pflanzjahr:      'Jahr',
  pflanzzeitpunkt: 'Zeitpunkt',
  zustand:         'Zustand',
  wasser:          'Priorität',
  datum:           'Letzte Bearb.',
  notiz:           'Notiz',
};
let FL = { ...DEFAULT_LABELS }; // aktive Labels

function loadFieldLabels() {
  FL = { ...DEFAULT_LABELS, ...(currentProjectData?.fieldLabels || {}) };
  applyFieldLabels();
}

function applyFieldLabels() {
  // Formular-Labels
  const map = {
    'label-f-name': FL.name + ' *',
    'label-f-stadtteil': FL.stadtteil,
    'label-f-baumnr': FL.baumnr,
    'label-f-art': FL.art,
    'label-f-pflanzjahr': FL.pflanzjahr,
    'label-f-pflanzzeitpunkt': FL.pflanzzeitpunkt,
    'label-f-zustand': FL.zustand,
    'label-f-wasser': FL.wasser,
    'label-f-notiz': FL.notiz,
  };
  Object.entries(map).forEach(([id, txt]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  });
}

// ─── STATE ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProjectData = null;
let currentUser = null;   // Firebase-Auth-Nutzer
let currentRole = '';     // aus Custom Claims (Rollen-Key)
let currentCap  = '';     // aus Custom Claims (Basis-Typ: admin|editor|readonly|driver)
let currentOrg  = '';     // aus Custom Claims
let currentName = '';     // Anzeigename (E-Mail oder PIN-Name)

// ─── ROLLEN & MODULE ──────────────────────────────────────────
const MODULES = [
  {key:'planung',     label:'Planung (Karte)'},
  {key:'disposition', label:'Disposition (automatisiert)'},
  {key:'dashboard',   label:'Dashboard'},
  {key:'controlling', label:'Controlling'},
  {key:'ki',          label:'KI-Analysen'},
  {key:'objekte',     label:'Objekte'},
  {key:'touren',      label:'Touren'},
  {key:'import',      label:'Import'},
  {key:'projekte',    label:'Projekte'},
  {key:'verwaltung',  label:'Verwaltung (Fahrer & Gründe)'},
  {key:'nutzer',      label:'Nutzer & Rollen'},
  {key:'admin',       label:'INFA-Admin (Allgemein/KI-Config)'},
  {key:'erfassung',   label:'Erfassungs-App'},
  {key:'mobil',       label:'Fahrer-App (Mobil)'},
  {key:'einsatzleiter', label:'Einsatzleiter-App'},
];
const BASE_TYPES = [
  {key:'admin',    label:'Verwalten (Admin)'},
  {key:'editor',   label:'Bearbeiten'},
  {key:'readonly', label:'Nur lesen'},
  {key:'driver',   label:'Fahrer (nur Status)'},
];
const _allModKeys = MODULES.map(m=>m.key);
const _mods = (keys)=>Object.fromEntries(_allModKeys.map(k=>[k, keys.includes(k)]));
const BUILTIN_ROLES = {
  superadmin: {name:'Superadmin', baseType:'admin', modules:_mods(_allModKeys), builtin:true},
  orgadmin:   {name:'Org-Admin',  baseType:'admin', modules:_mods(_allModKeys.filter(k=>k!=='admin')), builtin:true},
  planer:     {name:'Planer',     baseType:'editor', modules:_mods(['planung','disposition','dashboard','controlling','ki','objekte','touren','import','projekte','einsatzleiter']), builtin:true},
  erfasser:   {name:'Erfasser',   baseType:'editor', modules:_mods(['erfassung','objekte']), builtin:true},
  fahrer:     {name:'Fahrer',     baseType:'driver', modules:_mods(['mobil']), builtin:true},
};
let rolesCache = {};   // roleKey -> {name, baseType, modules, builtin}
function roleModules(roleKey){ const r=rolesCache[roleKey]||BUILTIN_ROLES[roleKey]; return r?r.modules:{}; }
function canUseModule(key){
  if(currentRole==='superadmin') return true;
  const m=roleModules(currentRole); return !!m[key];
}
let _dataViewProject = null;      // Projekt, für das Controlling/Dashboard zuletzt aufgebaut wurde
let _dataViewSyncQueued = false;  // Debounce für Neuaufbau beim Projektwechsel
let _histListProject = null;      // Projekt, für das die untere Historie-Liste geladen wurde
let tours = [];   // live from Firestore
let trees = [];   // live from Firestore
let unsubTours = null;
let unsubTrees = null;

let currentView = 'karte';
let selectedTreeId = null;
let lassoSelection = new Set(); // Lasso-Vorauswahl (tree-IDs) im Planen-Modus
let filterTour = 'all';
// Eigenschaften-Filter (Planung). objFilterOnMap = optional auch Marker filtern.
let objFilter = {stadtteil:'',art:'',pflanzjahr:'',zustand:'',wasser:'',status:''};
let objFilterOnMap = false;
let routesVisible = true;             // Routenlinien auf der Karte sichtbar?
let activeTours = new Set();          // Mehrfachauswahl: gleichzeitig angezeigte Touren
let showUnplanned = false;            // zusätzlich unverplante Objekte einblenden (additiv zur Tour-Auswahl)
let activeTourOnMap = null;           // abgeleitet: nur gesetzt, wenn GENAU eine Tour gewählt ist (für Detail-Ansicht/Nummern)
function syncActiveTour(){ activeTourOnMap = activeTours.size===1 ? [...activeTours][0] : null; }
function treeInAnyActiveTour(t){ for(const tid of activeTours){ if(treeInTour(t,tid)) return true; } return false; }
// „Nicht verplant" = in keiner ECHTEN Tour (Übersichtstouren zählen nicht als Verplanung)
function treeIsUnplanned(t){ return isActive(t) && realTourIds(t).length===0; }
// Sichtbarkeit nach aktueller Auswahl: nichts gewählt = alles; sonst Tour-Objekte ODER (optional) unverplante
function treeVisibleSel(t){
  if(!activeTours.size && !showUnplanned) return true;
  return (activeTours.size && treeInAnyActiveTour(t)) || (showUnplanned && treeIsUnplanned(t));
}
let placingTree = false;
let placingDepot = false;
let assignMode = false;
let assignTourId = null;
let editingTreeId = null;
let editingTourId = null;
let selectedTourColor = TOUR_COLORS[0];
let mapMarkers = {};
let tourRoutes = {};
let _routesCache = {};       // tourId -> routeData (spart wiederholte Firestore-Reads)
let _routesLoadedFor = null; // projectId, für den der Routen-Cache gilt
let routeCache = {};
let tourOrder = {};
let depotMarker = null;

// ─── MAP ──────────────────────────────────────────────────────
const L = window.L;
const map = L.map('map',{zoomControl:false,attributionControl:true}).setView([52.279,8.047],13);
map.attributionControl.setPosition('bottomright').setPrefix(false);
// Basis-Ebenen: amtliche basemap.de (BKG) in Farbe + Graustufen — kostenfrei, kommerziell/
// kommunal nutzbar (CC BY 4.0), DSGVO-konform. Ersetzt OSM-Kachelserver + Esri-Satellit.
const baseFarbe = basemapLayer('farbe').addTo(map);
const baseGrau  = basemapLayer('grau');

// ── Marker-Zielebene: AUS (Standard) = direkt die Karte (identisch zu bisher);
//    EIN = Cluster-Gruppe (lagert Off-Screen-Marker aus → flüssig bei großen Projekten).
//    Der restliche Marker-Code nutzt nur _mAdd/_mDel und bleibt dadurch unverändert.
let _clusterOn=false, _clusterGroup=null;
function _mAdd(m){ (_clusterOn&&_clusterGroup?_clusterGroup:map).addLayer(m); return m; }
function _mDel(m){ if(_clusterGroup) _clusterGroup.removeLayer(m); if(map.hasLayer(m)) map.removeLayer(m); }
function _makeClusterGroup(){
  if(!(window.L&&L.markerClusterGroup)) return null;
  return L.markerClusterGroup({ chunkedLoading:true, removeOutsideVisibleBounds:true, disableClusteringAtZoom:17, spiderfyOnMaxZoom:false, showCoverageOnHover:false, maxClusterRadius:55 });
}
// Cluster-Modus für das aktuelle Projekt setzen (initial beim Öffnen, oder per Schalter)
function applyClusterMode(on, rebuild){
  Object.values(mapMarkers).forEach(m=>_mDel(m));
  if(_clusterGroup) _clusterGroup.clearLayers();
  _clusterOn=!!on && !!(window.L&&L.markerClusterGroup);
  if(_clusterOn){
    if(!_clusterGroup) _clusterGroup=_makeClusterGroup();
    if(_clusterGroup&&!map.hasLayer(_clusterGroup)) map.addLayer(_clusterGroup);
  } else if(_clusterGroup&&map.hasLayer(_clusterGroup)){
    map.removeLayer(_clusterGroup);
  }
  if(rebuild) refreshMarkers();
}

// ── WMS-Kartenebenen (vom Nutzer verwaltbar, stadtscharf am Mandanten) ──
const WMS_DEFAULTS=[
  {id:'he-dop20', name:'Luftbild Hessen (DOP20)',
   url:'https://www.gds-srv.hessen.de/cgi-bin/lika-services/de-viewer/access/ogc-free-images.ows',
   layers:'he_dop20_rgb', type:'base', format:'image/png', version:'1.3.0', transparent:false, maxZoom:20,
   attribution:'Geobasisdaten © HVBG Hessen'},
  {id:'he-alkis', name:'Liegenschaftskataster',
   url:'https://inspire-hessen.de/ows/services/org.2.d66ec21e-39e7-45c4-bf68-438e8baea882_wms',
   layers:'CP.CadastralParcel', type:'overlay', format:'image/png', version:'1.1.1', transparent:true, maxZoom:20,
   attribution:'Geobasisdaten © HVBG Hessen'},
];
// WMS projektscharf: liegt am Projekt (projects/{id}.wmsLayers) — bewusst NICHT am Mandanten,
// damit Projekte derselben Stadt (z. B. Grünpflege vs. Behälterleerung) eigene Karten haben.
function getWmsLayers(){
  if(Array.isArray(currentProjectData?.wmsLayers)) return currentProjectData.wmsLayers.map(x=>({...x}));
  return []; // keine region-fremden Defaults
}
function saveWmsLayers(arr){
  if(!currentProjectId){ notify('Kein Projekt geöffnet'); return; }
  if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Administratoren'); return; }
  saveProjectSettings({wmsLayers:arr.map(x=>({...x}))}).catch(e=>notify(dlErr(e)));
}
function buildWmsLayer(cfg){
  return L.tileLayer.wms(cfg.url, {
    layers:cfg.layers, format:cfg.format||'image/png', version:cfg.version||'1.3.0',
    transparent:!!cfg.transparent, maxZoom:cfg.maxZoom||20, attribution:cfg.attribution||''});
}

let wmsLayerInstances={}; // id -> aktuelle Leaflet-Ebene
let _basemaps={}, _overlayLayers={}; // Anzeigename -> Leaflet-Ebene (für die Chip-Leiste)
function rebuildLayerControl(){
  // aktive Custom-Ebenen merken, dann alle entfernen
  const active=new Set();
  Object.entries(wmsLayerInstances).forEach(([id,lyr])=>{ if(map.hasLayer(lyr)) active.add(id); map.removeLayer(lyr); });
  wmsLayerInstances={};
  _basemaps={'Karte':baseFarbe,'Graustufen':baseGrau};
  _overlayLayers={};
  let customBaseActive=false;
  getWmsLayers().forEach(c=>{
    const lyr=buildWmsLayer(c); wmsLayerInstances[c.id]=lyr;
    if(c.type==='overlay'){ _overlayLayers[c.name]=lyr; if(active.has(c.id)) lyr.addTo(map); }
    else { _basemaps[c.name]=lyr; if(active.has(c.id)){ lyr.addTo(map); customBaseActive=true; } }
  });
  if(customBaseActive){ map.removeLayer(baseFarbe); map.removeLayer(baseGrau); }
  else if(!map.hasLayer(baseFarbe)&&!map.hasLayer(baseGrau)){ baseFarbe.addTo(map); } // Standard: Karte (Farbe)
  renderBasemapSwitcher();
}
// Karten-Auswahl: aufklappbares Panel über dem Karten-Button unten links
function closeBasemapPanel(){
  const p=document.getElementById('basemap-panel'), b=document.getElementById('basemap-btn');
  if(p) p.style.display='none'; if(b) b.classList.remove('open');
}
function renderBasemapSwitcher(){
  const panel=document.getElementById('basemap-panel'); if(!panel) return;
  const baseNames=Object.keys(_basemaps);
  let activeBase=baseNames.find(n=>map.hasLayer(_basemaps[n]));
  if(!activeBase){ _basemaps['Karte'].addTo(map); activeBase='Karte'; }
  const opt=(label,attr,act)=>`<button ${attr} class="bm-opt${act?' active':''}"><svg class="chk" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(label)}</span></button>`;
  let html=`<div class="bm-plabel">Hintergrundkarte</div>`;
  html+=baseNames.map(n=>opt(n,`data-base="${(n+'').replace(/"/g,'&quot;')}"`,n===activeBase)).join('');
  const ovNames=Object.keys(_overlayLayers);
  if(ovNames.length) html+=`<div class="bm-plabel" style="margin-top:3px;border-top:1px solid var(--border);padding-top:6px;">Zusatz-Ebenen</div>`+ovNames.map(n=>opt(n,`data-overlay="${(n+'').replace(/"/g,'&quot;')}"`,map.hasLayer(_overlayLayers[n]))).join('');
  panel.innerHTML=html;
  panel.onclick=e=>{
    const b=e.target.closest('[data-base]'), o=e.target.closest('[data-overlay]');
    if(b){ const n=b.dataset.base; if(_basemaps[n]){ Object.values(_basemaps).forEach(l=>map.removeLayer(l)); _basemaps[n].addTo(map); renderBasemapSwitcher(); closeBasemapPanel(); } }
    else if(o){ const n=o.dataset.overlay, l=_overlayLayers[n]; if(l){ map.hasLayer(l)?map.removeLayer(l):l.addTo(map); renderBasemapSwitcher(); } }
  };
}
rebuildLayerControl();
// Eigene Zoom-Buttons + Karten-Auswahl-Button verdrahten (statt Leaflet-Standard-Controls)
document.getElementById('map-zoom-in')?.addEventListener('click',()=>map.zoomIn());
document.getElementById('map-zoom-out')?.addEventListener('click',()=>map.zoomOut());
document.getElementById('basemap-btn')?.addEventListener('click',e=>{
  e.stopPropagation();
  const p=document.getElementById('basemap-panel'); const open=p.style.display==='none';
  p.style.display=open?'block':'none'; e.currentTarget.classList.toggle('open',open);
});
map.on('click',closeBasemapPanel); // Klick auf die Karte schließt das Auswahlfeld
// Adress-Suchfeld: Enter sucht (kein Tippen-Sturm), Treffer anklicken springt hin
const _msInput=document.getElementById('map-search-input');
if(_msInput){
  _msInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doMapSearch(); } });
  _msInput.addEventListener('input',()=>{ const c=document.getElementById('map-search-clear'); if(c) c.style.display=_msInput.value?'block':'none'; });
}
document.getElementById('map-search-clear')?.addEventListener('click',clearMapSearch);
document.getElementById('map-search-toggle')?.addEventListener('click',()=>{ document.getElementById('map-search')?.classList.remove('collapsed'); _msInput?.focus(); });
_msInput?.addEventListener('keydown',e=>{ if(e.key==='Escape'){ clearMapSearch(); document.getElementById('map-search')?.classList.add('collapsed'); } });
document.getElementById('map-search-results')?.addEventListener('click',e=>{
  const it=e.target.closest('.ms-item'); if(!it) return;
  const box=document.getElementById('map-search-results'); const r=box._results?.[+it.dataset.idx];
  if(r) gotoSearchResult(r);
});

map.on('click',e=>{
  if(placingTree){ cancelMode(); openAddTree(e.latlng.lat,e.latlng.lng); }
  else if(placingDepot){
    const {lat,lng}=e.latlng;
    saveProjectDepot({lat,lng,address:`${lat.toFixed(5)}, ${lng.toFixed(5)}`});
    cancelMode();
    renderDepotMarker();
    routeCache={};
    notify('Betriebshof gesetzt');
    if(activeTours.size){ applyTourSelection(false); }
  }
});

// ─── SYNC INDICATOR ───────────────────────────────────────────
function setSyncState(state,text){
  const ind=document.getElementById('app-sync');
  const dot=ind?.querySelector('.sync-dot');
  const txt=document.getElementById('app-sync-text');
  if(!dot)return;
  dot.className='sync-dot'+(state==='syncing'?' syncing':state==='error'?' error':'');
  if(txt)txt.textContent=text;
  if(ind&&text)ind.title=text; // Status als Tooltip (Text ausgeblendet)
}

// ─── PROJECT SCREEN ───────────────────────────────────────────
let unsubProjects=null;
let _psOrgNames={}; // orgId -> Anzeigename (für Mandanten-Badges in der Projektliste)
let _psOrgFilter=''; // Superadmin: ausgewählter Mandant ('' = alle)
let _psDocs=[]; // letzter Snapshot, damit der Filter ohne neuen Read rendern kann
function psSetOrgFilter(v){ _psOrgFilter=v; renderPsList(); }
function renderPsList(){
  const psList=document.getElementById('ps-list');
  if(!psList)return;
  const docs=_psOrgFilter?_psDocs.filter(d=>d.data().orgId===_psOrgFilter):_psDocs;
  if(!docs.length){
    psList.innerHTML=`<div class="ps-empty">${_psOrgFilter?'Keine Projekte in diesem Mandanten.':'Noch keine Projekte. Erstelle dein erstes Projekt unten.'}</div>`;
    return;
  }
  // Gespeicherte Zähler nutzen (kein Lesen der Unterkollektionen) — heilen sich beim Öffnen
  psList.innerHTML=docs.map(d=>{
    const data=d.data();
    const meta=(data.treeCount!=null||data.tourCount!=null)
      ? `${data.treeCount??0} Objekte · ${data.tourCount??0} Touren`
      : 'beim Öffnen aktualisieren';
    // Superadmin: Mandant als deutliches Badge (Projektname muss nicht der Stadtname sein)
    const orgBadge=currentRole==='superadmin'
      ? `<span style="flex-shrink:0;font-size:11px;font-weight:700;background:var(--green-light);color:var(--green);padding:3px 10px;border-radius:99px;white-space:nowrap;">${dlEsc(_psOrgNames[data.orgId]||data.orgId||'ohne Mandant')}</span>`
      : '';
    return `<div class="ps-item" onclick="openProject('${d.id}')">
      <div class="ps-item-icon">${data.icon||'🌳'}</div>
      <div class="ps-item-info">
        <div class="ps-item-name">${dlEsc(data.name||'')}</div>
        <div class="ps-item-meta">${meta}</div>
      </div>
      ${orgBadge}
      <svg class="ps-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
    </div>`;
  }).join('');
}
async function initProjectScreen(){
  document.getElementById('project-screen').style.display='flex';
  // Mandant des angemeldeten Nutzers anzeigen
  const mEl=document.getElementById('ps-mandant');
  if(mEl){
    if(currentRole==='superadmin') mEl.textContent='Superadmin — alle Mandanten';
    else if(currentOrg) orgDisplayName(currentOrg).then(n=>{ mEl.textContent='Mandant: '+n; });
    else mEl.textContent='';
  }
  // „Neues Projekt erstellen" nur für Superadmin — inkl. Mandanten-Auswahl
  const psNew=document.getElementById('ps-new');
  if(psNew) psNew.style.display=(currentRole==='superadmin')?'':'none';
  _psOrgNames={};
  _psOrgFilter='';
  const psFilter=document.getElementById('ps-org-filter');
  if(psFilter)psFilter.style.display='none';
  if(currentRole==='superadmin'){
    try{
      const qs=await db.collection('orgs').get(); // vor dem Listen-Render, damit Badges sofort stimmen
      const orgs=qs.docs.map(d=>({id:d.id,name:d.data().name||d.id})).sort((a,b)=>a.name.localeCompare(b.name));
      orgs.forEach(o=>{ _psOrgNames[o.id]=o.name; });
      const psOrg=document.getElementById('ps-new-org');
      if(psOrg){
        psOrg.innerHTML=orgs.map(o=>`<option value="${dlEsc(o.id)}"${o.id===currentOrg?' selected':''}>${dlEsc(o.name)}</option>`).join('');
        psOrg.style.display=orgs.length>1?'':'none';
      }
      // Filter über der Projektliste (nur sinnvoll bei mehreren Mandanten)
      if(psFilter&&orgs.length>1){
        psFilter.innerHTML='<option value="">Alle Mandanten</option>'+orgs.map(o=>`<option value="${dlEsc(o.id)}">${dlEsc(o.name)}</option>`).join('');
        psFilter.style.display='';
      }
    }catch(e){}
  }
  if(unsubProjects)unsubProjects();
  // Superadmin sieht alle Mandanten; sonst nur die eigene Org
  const q = (currentRole==='superadmin')
    ? db.collection('projects').orderBy('createdAt')
    : db.collection('projects').where('orgId','==',currentOrg);
  unsubProjects=onSnapshot(q,snap=>{
    const sync=document.getElementById('ps-sync');
    sync.innerHTML='<div class="sync-dot"></div> Verbunden';
    // bei nicht-Superadmin clientseitig nach createdAt sortieren (vermeidet Composite-Index)
    _psDocs=[...snap.docs];
    if(currentRole!=='superadmin') _psDocs.sort((a,b)=>(a.data().createdAt?.seconds||0)-(b.data().createdAt?.seconds||0));
    renderPsList();
  },err=>{
    document.getElementById('ps-sync').innerHTML='<div class="sync-dot error"></div> Fehler';
    console.error(err);
  });
}

async function createProject(){
  if(currentRole!=='superadmin'){ notify('Nur Superadmin kann neue Städte anlegen'); return; }
  const name=document.getElementById('ps-new-name').value.trim();
  if(!name)return;
  try{
    const targetOrg=document.getElementById('ps-new-org')?.value||currentOrg;
    const ref=await addDoc(collection(db,'projects'),{
      name, treeCount:0, tourCount:0, depot:null, orsKey:'', depotMode:'round',
      createdAt:serverTimestamp(), orgId: targetOrg
    });
    document.getElementById('ps-new-name').value='';
    openProject(ref.id);
  }catch(e){ notify('Fehler: '+e.message); }
}

async function openProject(projectId){
  if(unsubProjects){ unsubProjects(); unsubProjects=null; } // Projekt-Listener stoppen (spart Hintergrund-Reads)
  _routesCache={};_routesLoadedFor=null; // Routen-Cache für neues Projekt verwerfen
  _cityFitDone=false; // Karte beim Öffnen einmal auf die Stadt zoomen
  currentProjectId=projectId;
  window._tourHistoryCache=null;   // Historie des alten Projekts verwerfen
  _dataViewProject=null;           // Controlling/Dashboard für neues Projekt neu aufbauen
  // Suchfelder der vorigen Stadt zurücksetzen
  ['search-input','baeume-search','tour-legend-search'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  tourLegendQuery='';
  const snap=await getDoc(doc(db,'projects',projectId));
  currentProjectData={id:projectId,...snap.data()};
  document.getElementById('active-project-name').textContent=currentProjectData.name;
  // Mandant neben dem Projektnamen (gecacht, max. 1 Read)
  const apOrg=document.getElementById('active-project-org');
  if(apOrg){ apOrg.textContent=''; const _oid=currentProjectData.orgId; if(_oid) orgDisplayName(_oid).then(n=>{ if(n&&currentProjectData?.orgId===_oid) apOrg.textContent='· '+n; }); }
  document.getElementById('project-screen').style.display='none';
  loadFieldLabels();
  loadListValues();
  applyClusterMode(currentProjectData?.clusterAktiv, false); // Marker-Zielebene fürs Projekt (vor erstem Marker-Render)
  await loadOrgSettings(); // KI-Modus + ORS-Key + WMS + Dispo dieser Stadt (1 Org-Read) — vor dem Kartenaufbau
  rebuildLayerControl(); // WMS-Kartenebenen der Stadt laden
  // Subscribe to tours & trees
  subscribeToProject();
  // Gründe des neuen Projekts laden (verhindert projektübergreifendes Hängenbleiben)
  reasons=[]; loadReasons().then(()=>{ if(currentView==='verwaltung') renderReasonsMgmt(); });
  artenList=[]; _artIconMap=null; // Arten-Liste pro Projekt verwerfen (kein projektübergreifendes Hängenbleiben)
  // Arten laden, damit Marker individuelle Art-Symbole zeigen; nur neu rendern, wenn welche gesetzt sind
  loadArten().then(()=>{ _artIconMap=null; if(artenList.some(a=>a.icon)){ refreshMarkers(); renderList(); } });
}

// Baut die aktive datengetriebene Ansicht (Controlling/Dashboard) nach einem
// Projektwechsel neu auf, sobald die ersten trees/tours-Snapshots da sind.
// Debounce, damit nicht jeder einzelne Snapshot einen Neuaufbau auslöst.
function syncDataViewToProject(){
  if(_dataViewProject===currentProjectId) return;
  if(currentView!=='controlling' && currentView!=='dashboard') return;
  if(_dataViewSyncQueued) return;
  _dataViewSyncQueued=true;
  setTimeout(()=>{
    _dataViewSyncQueued=false;
    if(_dataViewProject===currentProjectId) return;
    _dataViewProject=currentProjectId;
    if(currentView==='controlling') initControlling();
    else if(currentView==='dashboard') initDashboard();
  },60);
}

function showProjectScreen(){
  if(unsubTours){unsubTours();unsubTours=null;}
  if(unsubTrees){unsubTrees();unsubTrees=null;}
  // clear map
  if(simState.active) stopSimulation();
  Object.values(mapMarkers).forEach(m=>_mDel(m));mapMarkers={};
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}
  tours=[];trees=[];tourOrder={};activeTours.clear();showUnplanned=false;activeTourOnMap=null;filterTour='all';showOverviewInLegend=false;showOverviewInGrid=false;showOverviewInAssign=false;
  reasons=[]; // Gründe des Projekts verwerfen (kein projektübergreifendes Hängenbleiben)
  _routesCache={};_routesLoadedFor=null; // Routen-Cache verwerfen
  initProjectScreen();
}

function subscribeToProject(){
  if(unsubTours)unsubTours();
  if(unsubTrees)unsubTrees();
  setSyncState('syncing','Lade…');

  const toursRef=collection(db,'projects',currentProjectId,'tours');
  unsubTours=onSnapshot(toursRef,snap=>{
    tours=snap.docs.map(d=>({id:d.id,...d.data()}));
    renderFilters();renderList();renderLegend();
    if(currentView==='touren') renderTourenGrid();
    if(currentView==='benutzer') renderDriverMgmt();
    syncDataViewToProject();
    maybeHealCount('tourCount',tours.length);
    setSyncState('ok','Synchronisiert');
  });

  const treesRef=collection(db,'projects',currentProjectId,'trees');
  unsubTrees=onSnapshot(treesRef,snap=>{
    trees=snap.docs.map(d=>({id:d.id,...d.data()}));
    maybeHealCount('treeCount',trees.length);
    if(_suppressTreeRender){
      _pendingTreeRender=true; // Massen-Schreibvorgang läuft — EIN Render am Ende statt je Batch
    }else{
      const changes=snap.docChanges();
      // Erstladung/Projektwechsel (alles neu) → Voll-Aufbau; sonst nur Geändertes anfassen
      if(Object.keys(mapMarkers).length===0 || changes.length>=snap.size) refreshMarkers();
      else diffMarkers(changes);
      renderListDebounced();
    }
    maybeFitCity(); // beim ersten Laden auf die Stadt zoomen
    if(currentView==='baeume'){
      const artenTab=document.getElementById('baeume-arten');
      if(artenTab && getComputedStyle(artenTab).display!=='none') renderFieldCatalog();
      else renderBaeumeTable();
    }
    syncDataViewToProject();
    setSyncState('ok','Synchronisiert');
    autoMigrateTourIds(); // tourId → tourIds[] still im Hintergrund
  });
}

// Gespeicherten Projekt-Zähler aktualisieren (1 Write nur bei Abweichung; nur Planer/Admin)
function maybeHealCount(field,n){
  if(!currentProjectId || !currentProjectData) return;
  if(!(currentCap==='admin'||currentCap==='editor'||currentRole==='superadmin')) return;
  if(currentProjectData[field]===n) return;
  currentProjectData[field]=n;
  updateDoc(doc(db,'projects',currentProjectId),{[field]:n}).catch(()=>{});
}

// ─── PROJECT SETTINGS ─────────────────────────────────────────
function getDepot(){ return currentProjectData?.depot||null; }
// ORS-Key stadtscharf: liegt am Mandanten (orgs/{orgId}.orsKey). Legacy-Fallback: alter projektweiter Key.
let currentOrgOrsKey = '';
function getOrsKey(){ return currentOrgOrsKey || currentProjectData?.orsKey || ''; }
function getBewDuration(){
  const v=currentProjectData?.bewDuration;               // projektspezifisch
  if(typeof v==='number' && v>0) return v;
  return parseInt(localStorage.getItem('bew_duration_min'))||5;
}

function fmtBewTime(treeCount){
  const mins=treeCount*getBewDuration();
  const h=Math.floor(mins/60);
  const m=mins%60;
  return h>0?`${h}h ${m}min`:`${m} min`;
}

function fmtTotalTime(driveSec,treeCount){
  const driveMin=Math.round(driveSec/60);
  const bewMin=treeCount*getBewDuration();
  const total=driveMin+bewMin;
  const h=Math.floor(total/60);
  const m=total%60;
  return h>0?`${h}h ${m}min`:`${m} min`;
}

function getDepotMode(){ return currentProjectData?.depotMode||'round'; }
// Routen-Optimierung: 'nn' = bisherige Variante (Luftlinie, Nearest-Neighbor)
//                     'matrix' = echte ORS-Fahrzeiten-Matrix + 2-opt
function getRouteOptMode(){ return currentProjectData?.routeOptMode || localStorage.getItem('bwt_route_opt') || 'nn'; }
// KI-Analyse-Modus: 'off' | 'manual' (Prompts kopieren) | 'auto' (Gemini) | 'both'
// Stadtscharf: liegt am Mandanten (orgs/{orgId}.kiMode); beim Projektwechsel geladen.
let currentKiMode = 'manual';
function getKiMode(){ return currentKiMode || 'manual'; }
// Mandanten-Einstellungen (KI-Modus + ORS-Key) in EINEM Org-Read laden — stadtscharf, beim Projektwechsel
async function loadOrgSettings(){
  const org=currentProjectData?.orgId;
  currentKiMode='manual'; currentOrgOrsKey=''; currentDispoConfig=null; currentDispoResources=null;
  if(org){
    try{ const os=await db.collection('orgs').doc(org).get(); if(os.exists){ const d=os.data();
      currentKiMode=d.kiMode||'manual';
      currentOrgOrsKey=d.orsKey||'';
      currentDispoConfig=(d.dispoConfig&&typeof d.dispoConfig==='object')?d.dispoConfig:null;
      currentDispoResources=Array.isArray(d.dispoResources)?d.dispoResources:null;
    } }catch(e){}
  }
  applyKiNavVisibility();
}
async function setKiMode(m){
  const org=currentProjectData?.orgId;
  if(!org){ notify('Kein Mandant aktiv'); return; }
  if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Administratoren'); return; }
  try{ await dlFnCall('setOrgKiMode',{orgId:org,mode:m}); currentKiMode=m; applyKiNavVisibility(); renderKiConfig(); notify('✓ KI-Modus gespeichert'); }
  catch(e){ notify(fnErr(e)); }
}
function kiHasManual(){ const m=getKiMode(); return m==='manual'||m==='both'; }
function kiHasAuto(){ const m=getKiMode(); return m==='auto'||m==='both'; }
// KI-Analysen-Reiter ein-/ausblenden je nach Modus
function applyKiNavVisibility(){
  const off=getKiMode()==='off';
  const btn=document.querySelector('.nav-dropdown button[onclick="switchView(\'ki\')"]');
  if(btn) btn.style.display=off?'none':'';
  if(off && currentView==='ki') switchView('karte');
}

async function saveProjectDepot(depot){
  currentProjectData.depot=depot;
  await updateDoc(doc(db,'projects',currentProjectId),{depot});
}
async function saveProjectSettings(data){
  Object.assign(currentProjectData,data);
  await updateDoc(doc(db,'projects',currentProjectId),data);
}

async function confirmDeleteProject(){
  if(!currentProjectId||!currentProjectData)return;

  // Custom confirm dialog with cancel focused
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9998;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-md);width:420px;max-width:90vw;overflow:hidden;">
    <div style="padding:18px 20px 10px;border-bottom:1px solid var(--border);">
      <div style="font-size:16px;font-weight:700;color:var(--red);">⚠ Projekt löschen</div>
    </div>
    <div style="padding:16px 20px;font-size:13px;color:var(--text2);line-height:1.7;">
      Projekt <b style="color:var(--text);">${currentProjectData.name}</b> wirklich löschen?<br>
      <span style="color:var(--red);">Alle Objekte, Touren, Routen und Historiendaten werden unwiderruflich gelöscht.</span>
    </div>
    <div style="padding:6px 20px 8px;">
      <input id="delete-confirm-input" class="form-control" placeholder='Projektname eingeben zur Bestätigung' style="border-color:var(--red-light);">
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Gib <b>${currentProjectData.name}</b> ein um zu bestätigen</div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="del-proj-cancel" style="padding:8px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button>
      <button id="del-proj-ok" style="padding:8px 16px;border:none;border-radius:6px;background:var(--red);color:#fff;cursor:pointer;font-size:13px;font-weight:600;" disabled>Projekt löschen</button>
    </div>
  </div>`;
  document.body.appendChild(modal);

  // Enable delete button only when name matches
  const input=modal.querySelector('#delete-confirm-input');
  const delBtn=modal.querySelector('#del-proj-ok');
  input.oninput=()=>{
    delBtn.disabled=input.value.trim()!==currentProjectData.name;
    delBtn.style.opacity=delBtn.disabled?'0.4':'1';
  };

  setTimeout(()=>modal.querySelector('#del-proj-cancel').focus(),50);

  const confirmed=await new Promise(resolve=>{
    modal.querySelector('#del-proj-cancel').onclick=()=>{modal.remove();resolve(false);};
    delBtn.onclick=()=>{if(!delBtn.disabled){modal.remove();resolve(true);}};
    modal.onclick=e=>{if(e.target===modal){modal.remove();resolve(false);}};
  });
  if(!confirmed)return;

  // Show progress
  setSyncState('syncing','Projekt wird gelöscht…');
  try{
    const pid=currentProjectId;

    // Alle Unter-Sammlungen löschen — in Sammel-Batches (<=450) statt einzeln
    const subcollections=['trees','tours','routes','reasons','tourHistory'];
    let allDocs=[];
    for(const sub of subcollections){
      const snap=await getDocs(collection(db,'projects',pid,sub));
      allDocs.push(...snap.docs.map(d=>d.ref));
    }
    const CH=450; // Firestore-Batch-Limit 500
    for(let i=0;i<allDocs.length;i+=CH){
      const batch=db.batch();
      allDocs.slice(i,i+CH).forEach(ref=>batch.delete(ref));
      await batch.commit();
    }

    // Projekt-Dokument selbst löschen
    await deleteDoc(doc(db,'projects',pid));

    setSyncState('ok','Synchronisiert');
    notify('Projekt gelöscht');

    // Reset to project screen
    currentProjectId=null;
    currentProjectData=null;
    trees=[];
    tours=[];
    tourRoutes={};
    tourOrder={};
    closeSettings();
    showProjectScreen();
  }catch(e){
    setSyncState('ok','Synchronisiert');
    notify('Fehler beim Löschen: '+e.message);
    console.error(e);
  }
}

// ─── ROUTING ──────────────────────────────────────────────────
// Routes are saved to Firestore per tour and only recalculated on demand.
// savedRoutes: tourId -> {orderIds, geojson|null, km, updatedAt}

function fmtDuration(sec){
  if(!sec)return '–';
  const h=Math.floor(sec/3600);
  const m=Math.round((sec%3600)/60);
  if(h>0)return `${h}h ${m}min`;
  return `${m} min`;
}

function haversine(lat1,lon1,lat2,lon2){
  const R=6371,dLat=(lat2-lat1)*Math.PI/180,dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function nearestNeighborTSP(pts,startLat,startLng){
  if(pts.length===0)return[];
  const visited=new Set();const result=[];
  let curLat=startLat??pts[0].lat,curLng=startLng??pts[0].lng;
  if(startLat==null){result.push(pts[0]);visited.add(pts[0].id);curLat=pts[0].lat;curLng=pts[0].lng;}
  while(result.length<pts.length){
    let best=null,bestD=Infinity;
    for(const p of pts){
      if(visited.has(p.id))continue;
      const d=haversine(curLat,curLng,p.lat,p.lng);
      if(d<bestD){bestD=d;best=p;}
    }
    if(!best)break;
    result.push(best);visited.add(best.id);curLat=best.lat;curLng=best.lng;
  }
  return result;
}

// ─── Reihenfolge-Optimierung (Option B: ORS-Matrix + 2-opt) ──────────
// Echte Fahrzeiten-Matrix von ORS holen (NxN, Sekunden). Limit: 50 Orte.
async function fetchOrsMatrix(coords){
  const key=getOrsKey(); if(!key) return null;
  if(coords.length>50) return null; // ORS-Free: max 50×50
  try{
    const res=await fetch('https://api.openrouteservice.org/v2/matrix/driving-car',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':key},
      body:JSON.stringify({locations:coords, metrics:['duration']})
    });
    if(!res.ok){ console.warn('ORS matrix error:',res.status, await res.text()); return null; }
    const data=await res.json();
    return data.durations||null;
  }catch(e){ console.warn('ORS matrix failed:',e); return null; }
}

// Greedy Nearest-Neighbor anhand einer Kostenmatrix, Start bei startIdx
function nnFromMatrix(pts, matrix, startIdx=0){
  const n=pts.length, visited=new Array(n).fill(false);
  let cur=startIdx; visited[cur]=true; const order=[pts[cur]];
  for(let step=1;step<n;step++){
    let best=-1,bd=Infinity;
    for(let j=0;j<n;j++){ if(visited[j])continue; const d=matrix[cur][j]; if(d<bd){bd=d;best=j;} }
    if(best<0)break; visited[best]=true; order.push(pts[best]); cur=best;
  }
  return order;
}

// 2-opt-Verbesserung. cost(a,b) liefert Kosten zwischen zwei Punkten.
// fixedStart: erstes Element (Depot) bleibt fix. returnToStart: Rundtour zurück zum Start.
function twoOpt(order, cost, fixedStart, returnToStart){
  let best=order.slice();
  const tourLen=arr=>{
    let s=0;
    for(let i=0;i<arr.length-1;i++) s+=cost(arr[i],arr[i+1]);
    if(returnToStart && arr.length>1) s+=cost(arr[arr.length-1],arr[0]);
    return s;
  };
  let bestLen=tourLen(best), improved=true, guard=0;
  const start=fixedStart?1:0;
  while(improved && guard++<60){
    improved=false;
    for(let i=start;i<best.length-1;i++){
      for(let k=i+1;k<best.length;k++){
        const cand=best.slice(0,i).concat(best.slice(i,k+1).reverse(), best.slice(k+1));
        const len=tourLen(cand);
        if(len+1e-6<bestLen){ best=cand; bestLen=len; improved=true; }
      }
    }
  }
  return best;
}

// Liefert die optimierte Reihenfolge der Bäume (ohne Depot) je nach Einstellung.
async function computeTreeOrder(trs, depot){
  const mode=getRouteOptMode();
  const roundTrip = !!depot && getDepotMode()==='round';
  if(mode==='matrix' && getOrsKey() && trs.length>=2){
    const pts = depot ? [{id:'__depot__',lat:depot.lat,lng:depot.lng}, ...trs] : trs.slice();
    const matrix = await fetchOrsMatrix(pts.map(p=>[p.lng,p.lat]));
    if(matrix){
      const idx=new Map(pts.map((p,i)=>[p,i]));
      const cost=(a,b)=>matrix[idx.get(a)][idx.get(b)];
      const seed=nnFromMatrix(pts, matrix, 0);
      const opt=twoOpt(seed, cost, !!depot, roundTrip);
      return opt.filter(p=>p.id!=='__depot__');
    }
    notify('ORS-Matrix nicht verfügbar (>50 Stopps oder Limit) — Luftlinie genutzt');
  }
  // Fallback / bisherige Variante: Nearest-Neighbor (Luftlinie)
  let ordered=nearestNeighborTSP(trs, depot?.lat, depot?.lng);
  if(mode==='matrix'){
    // Im Matrix-Modus wenigstens 2-opt auf Luftlinie als Fallback
    const arr = depot ? [{id:'__depot__',lat:depot.lat,lng:depot.lng}, ...ordered] : ordered.slice();
    const cost=(a,b)=>haversine(a.lat,a.lng,b.lat,b.lng);
    ordered=twoOpt(arr, cost, !!depot, roundTrip).filter(p=>p.id!=='__depot__');
  }
  return ordered;
}

async function fetchOrsRoute(coords){
  const key=getOrsKey();if(!key)return null;
  const CHUNK=48; // ORS max is 50, use 48 to be safe with overlap

  try{
    // If fits in one request, send directly
    if(coords.length<=CHUNK){
      const res=await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':key},
        body:JSON.stringify({coordinates:coords,instructions:false})
      });
      if(!res.ok){console.warn('ORS error:',res.status,await res.text());return null;}
      return await res.json();
    }

    // Split into overlapping chunks and merge GeoJSON
    const chunks=[];
    for(let i=0;i<coords.length-1;i+=CHUNK-1){
      chunks.push(coords.slice(i,i+CHUNK));
    }

    let mergedCoords=[];
    let totalDistance=0;
    let totalDuration=0;

    for(const chunk of chunks){
      if(chunk.length<2)continue;
      const res=await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':key},
        body:JSON.stringify({coordinates:chunk,instructions:false})
      });
      if(!res.ok){console.warn('ORS chunk error:',res.status);continue;}
      const geo=await res.json();
      if(!geo?.features?.[0])continue;
      const lineCoords=geo.features[0].geometry.coordinates;
      // Avoid duplicate junction point
      if(mergedCoords.length>0) mergedCoords.push(...lineCoords.slice(1));
      else mergedCoords.push(...lineCoords);
      totalDistance+=geo.features[0].properties.summary.distance||0;
      totalDuration+=geo.features[0].properties.summary.duration||0;
    }

    if(mergedCoords.length<2)return null;

    // Return merged GeoJSON
    return {
      features:[{
        type:'Feature',
        geometry:{type:'LineString',coordinates:mergedCoords},
        properties:{summary:{distance:totalDistance,duration:totalDuration}}
      }]
    };
  }catch(e){console.warn('ORS fetch failed:',e);return null;}
}

// ─── ROUTENLINIEN EIN-/AUSBLENDEN ─────────────────────────────
function applyRouteVisibility(){
  Object.values(tourRoutes).forEach(r=>{
    if(!r.layer) return;
    if(routesVisible){ if(!map.hasLayer(r.layer)) map.addLayer(r.layer); }
    else if(map.hasLayer(r.layer)) map.removeLayer(r.layer);
  });
}
function updateRouteToggleBtn(){
  const btn=document.getElementById('btn-toggle-routes');
  const icon=document.getElementById('btn-toggle-routes-icon');
  if(!btn) return;
  btn.title = routesVisible ? 'Routenlinien ausblenden' : 'Routenlinien einblenden';
  btn.style.color = routesVisible ? 'var(--text2)' : 'var(--text3)';
  btn.style.background = routesVisible ? 'var(--surface)' : 'var(--surface2)';
  if(icon) icon.innerHTML = routesVisible
    ? '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'
    : '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';
}
function toggleRouteLines(){ routesVisible=!routesVisible; applyRouteVisibility(); updateRouteToggleBtn(); }

// Draw a saved route on the map (from Firestore data, no ORS call)
function drawSavedRoute(tourId, routeData){
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  if(tourRoutes[tourId]){map.removeLayer(tourRoutes[tourId].layer);delete tourRoutes[tourId];}

  // Restore order
  if(routeData.orderIds) tourOrder[tourId]=routeData.orderIds;

  // Parse geojson from string (stored as string to avoid Firestore nested array limit)
  const geojson=routeData.geojsonStr?JSON.parse(routeData.geojsonStr):routeData.geojson||null;

  let layer;
  if(geojson){
    // Draw real street route from saved geojson
    layer=L.geoJSON(geojson,{style:{color:tour.color,weight:4,opacity:.85}}).addTo(map);
  } else {
    // Draw straight-line fallback from saved order
    const orderedTrees=routeData.orderIds
      .map(id=>trees.find(t=>t.id===id))
      .filter(Boolean);
    const depot=getDepot();
    let pts=orderedTrees.map(t=>[t.lat,t.lng]);
    if(depot){const dp=[depot.lat,depot.lng];pts=getDepotMode()==='round'?[dp,...pts,dp]:[dp,...pts];}
    layer=L.polyline(pts,{color:tour.color,weight:3,opacity:.7,dashArray:'8 5'}).addTo(map);
  }
  tourRoutes[tourId]={layer,km:routeData.km||0,durationSec:routeData.durationSec||0};
  if(!routesVisible) map.removeLayer(layer);
  if(currentView==='touren') renderTourenGrid();
}

// Load and display all saved routes from Firestore (no recalculation)
async function loadSavedRoutes(force=false){
  if(!getRoutePlanningEnabled()) return;
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
  const useCache = !force && _routesLoadedFor===currentProjectId;
  if(!useCache){ _routesCache={}; }
  for(const tour of tours){
    let data = useCache ? _routesCache[tour.id] : null;
    if(!useCache){
      const routeSnap=await getDoc(doc(db,'projects',currentProjectId,'routes',tour.id));
      if(routeSnap.exists){ data=routeSnap.data(); _routesCache[tour.id]=data; }
    }
    if(data){
      // Linie nur für ausgewählte Touren zeichnen (Routen folgen der Auswahl; keine Auswahl → keine Linien)
      if(activeTours.has(tour.id)) drawSavedRoute(tour.id, data);
      // Kennzahlen am Tour-Doc nachziehen, falls noch nicht gespeichert (Routen vor dieser Änderung)
      if(typeof tour.routeKm!=='number' && !isReadonly() && (currentCap==='admin'||currentCap==='editor'||currentRole==='superadmin')){
        const km=data.km||0, dr=data.durationSec||0;
        updateDoc(doc(db,'projects',currentProjectId,'tours',tour.id),{routeKm:km, routeDriveSec:dr})
          .then(()=>{ const _t=tours.find(t=>t.id===tour.id); if(_t){ _t.routeKm=km; _t.routeDriveSec=dr; } }).catch(()=>{});
      }
    } else if(activeTours.has(tour.id)) {
      // Ausgewählte Tour ohne gespeicherte Route — Reihenfolge für Nummerierung berechnen (kein Read)
      const trs=trees.filter(t=>treeInTour(t,tour.id)&&t.lat&&t.lng&&t.aktiv!==false);
      if(trs.length>0){
        const depot=getDepot();
        const ordered=nearestNeighborTSP(trs,depot?.lat,depot?.lng);
        tourOrder[tour.id]=ordered.map(t=>t.id);
      }
    }
  }
  if(!useCache) _routesLoadedFor=currentProjectId;
  rebuildMarkersWithNumbers();renderList();renderLegend();
  document.getElementById('route-info-bar').classList.remove('visible');
}

// Manually triggered: recalculate + save route for one tour via ORS
async function calculateAndSaveRoute(tourId){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  if(!getRoutePlanningEnabled()){ notify('Reihenfolgeplanung ist deaktiviert'); return; }
  if(isOverviewTour(tourId)){ notify('Übersichtstouren erhalten keine Route'); return; }
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  const trs=trees.filter(t=>treeInTour(t,tourId)&&t.lat&&t.lng&&t.aktiv!==false);
  if(trs.length<1){notify('Keine Objekte in dieser Tour');return;}

  setSyncState('syncing','Route wird berechnet…');
  document.getElementById('route-spinner').classList.add('visible');
  document.getElementById('route-info-text').textContent='Route wird berechnet…';
  document.getElementById('route-info-bar').classList.add('visible');

  const depot=getDepot();
  const ordered=await computeTreeOrder(trs, depot);
  tourOrder[tourId]=ordered.map(t=>t.id);

  const treePart=ordered.map(t=>[t.lng,t.lat]);
  let coords=treePart;
  if(depot){
    const dp=[depot.lng,depot.lat];
    coords=getDepotMode()==='round'?[dp,...treePart,dp]:[dp,...treePart];
  }

  const geo=await fetchOrsRoute(coords);
  document.getElementById('route-spinner').classList.remove('visible');

  let km=0,geojsonToSave=null;
  if(geo?.features?.[0]){
    km=geo.features[0].properties.summary.distance/1000;
    geojsonToSave=geo;
  } else {
    // Haversine fallback km
    let pts=ordered.map(t=>[t.lat,t.lng]);
    if(depot){const dp=[depot.lat,depot.lng];pts=getDepotMode()==='round'?[dp,...pts,dp]:[dp,...pts];}
    for(let i=0;i<pts.length-1;i++)km+=haversine(pts[i][0],pts[i][1],pts[i+1][0],pts[i+1][1]);
    if(!getOrsKey()) notify('Kein ORS-Key — Luftlinie gespeichert. Key in Einstellungen eintragen für Straßenrouting.');
  }

  // Extract duration from ORS
  let durationSec=0;
  if(geo?.features?.[0]?.properties?.summary?.duration){
    durationSec=geo.features[0].properties.summary.duration;
  } else {
    // Estimate: avg 30 km/h in city
    durationSec=km/30*3600;
  }
  // Save to Firestore — geojson serialized as string (Firestore doesn't support nested arrays)
  const routeData={
    orderIds:tourOrder[tourId],
    geojsonStr:geojsonToSave?JSON.stringify(geojsonToSave):null,
    km,durationSec,updatedAt:serverTimestamp()
  };
  await setDoc(doc(db,'projects',currentProjectId,'routes',tourId),routeData);
  _routesCache[tourId]=routeData; // Cache aktuell halten (spart Re-Read)
  // Kennzahlen aufs Tour-Dokument speichern → in der Touren-Tabelle dauerhaft sichtbar,
  // ohne dass die Route in den Speicher geladen sein muss. Ändert sich nur bei Neuberechnung.
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'tours',tourId),{routeKm:km, routeDriveSec:durationSec, routeComputedAt:new Date().toISOString()});
    const _t=tours.find(t=>t.id===tourId); if(_t){ _t.routeKm=km; _t.routeDriveSec=durationSec; }
  }catch(e){ console.warn('Tour-Kennzahlen speichern:',e); }

  // Draw on map
  drawSavedRoute(tourId, routeData);
  rebuildMarkersWithNumbers();renderList();renderLegend();
  updateRouteInfoBar();
  setSyncState('ok','Route gespeichert');
  notify(`✓ Route gespeichert — ${km.toFixed(1)} km`);
}

// Calculate all tours at once
async function calculateAllRoutes(){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  if(!getRoutePlanningEnabled()){ notify('Reihenfolgeplanung ist deaktiviert'); return; }
  for(const tour of tours){
    if(tour.uebersicht) continue; // Übersichtstouren überspringen
    await calculateAndSaveRoute(tour.id);
  }
}

async function rebuildActiveRoute(){
  if(!getRoutePlanningEnabled()) return;
  // Just reload saved routes — no auto-recalculation
  await loadSavedRoutes();
  if(activeTourOnMap){
    const data=_routesCache[activeTourOnMap];
    if(data) drawSavedRoute(activeTourOnMap,data);
    updateRouteInfoBar();
  }
}

async function refreshAllRoutes(){
  await loadSavedRoutes();
  document.getElementById('route-info-bar').classList.remove('visible');
}

// Kennzahlen einer Tour: bevorzugt geladene Route (tourRoutes), sonst persistierte Tour-Werte
function tourMetrics(tid){
  const rt=tourRoutes[tid];
  if(rt) return {km:rt.km||0, durationSec:rt.durationSec||0};
  const t=tours.find(x=>x.id===tid);
  if(t && typeof t.routeKm==='number') return {km:t.routeKm, durationSec:t.routeDriveSec||0};
  return null;
}
function updateRouteInfoBar(){
  const bar=document.getElementById('route-info-bar');
  const txt=document.getElementById('route-info-text');
  const sidePanel=document.getElementById('sidebar-route-info');
  if(bar) bar.classList.remove('visible'); // schwebende Routen-Info-Leiste entfernt — Infos im Seitenpanel
  // Mehrere Touren ausgewählt → kompakte Summe
  if(activeTours.size>1){
    let km=0,dur=0; activeTours.forEach(tid=>{ const m=tourMetrics(tid); if(m){ km+=m.km; dur+=m.durationSec; } });
    const cnt=trees.filter(t=>treeInAnyActiveTour(t)&&t.lat&&t.lng).length;
    txt.textContent=`${activeTours.size} Touren · ${cnt} Objekte${km?` · Σ ${km.toFixed(1)} km${dur?' · '+fmtDuration(dur)+' Fahrt':''}`:''}`;
    if(sidePanel){
      document.getElementById('sidebar-route-tour-name').textContent=`${activeTours.size} Touren`;
      document.getElementById('sidebar-route-km').textContent=km?km.toFixed(1)+' km':'–';
      document.getElementById('sidebar-route-drive').textContent=dur?fmtDuration(dur):'–';
      document.getElementById('sidebar-route-taet').textContent=cnt?fmtBewTime(cnt):'–';
      document.getElementById('sidebar-route-total').textContent=km?fmtTotalTime(dur,cnt):'–';
      document.getElementById('sidebar-route-cnt').textContent=cnt+' Objekte';
      sidePanel.style.display='block';
    }
    return;
  }
  const _activeM=activeTourOnMap?tourMetrics(activeTourOnMap):null;
  if(_activeM){
    const {km,durationSec}=_activeM;
    const tour=tours.find(t=>t.id===activeTourOnMap);
    const cnt=trees.filter(t=>treeInTour(t,activeTourOnMap)&&t.lat&&t.lng).length;
    const depot=getDepot();
    const _bewT=fmtBewTime(cnt);
    const _totT=fmtTotalTime(durationSec,cnt);
    txt.textContent=`${tour?.name||''} · ${cnt} Objekte · ${km.toFixed(1)} km · ${fmtDuration(durationSec)} Fahrt + ${_bewT} Bew. = ${_totT}${depot?' (inkl. Depot)':''}`;
    const bewTime=fmtBewTime(cnt);
    const totalTime=fmtTotalTime(durationSec,cnt);
    document.getElementById('sidebar-route-tour-name').textContent=tour?.name||'';
    document.getElementById('sidebar-route-km').textContent=km.toFixed(1)+' km';
    document.getElementById('sidebar-route-drive').textContent=fmtDuration(durationSec);
    document.getElementById('sidebar-route-taet').textContent=bewTime;
    document.getElementById('sidebar-route-total').textContent=totalTime;
    document.getElementById('sidebar-route-cnt').textContent=cnt+' Objekte';
    sidePanel.style.display='block';
  } else {
    bar.classList.remove('visible');
    if(sidePanel) sidePanel.style.display='none';
  }
}

// ─── MARKERS ──────────────────────────────────────────────────
// Perf: Route-Nummern einmal als Map vorberechnen statt pro Zeile/Marker über tourOrder zu suchen (O(1) statt O(n)).
let _routeNumMap=null;
function buildRouteNumMap(){
  const m=new Map();
  if(activeTours.size>1) return m; // bei Mehrfachauswahl keine (kollidierenden) Nummern
  if(activeTourOnMap && tourOrder[activeTourOnMap]) tourOrder[activeTourOnMap].forEach((id,i)=>{ if(!m.has(id)) m.set(id,i+1); });
  for(const [tid,order] of Object.entries(tourOrder)){ if(tid===activeTourOnMap) continue; order.forEach((id,i)=>{ if(!m.has(id)) m.set(id,i+1); }); }
  return m;
}
function getRouteNum(treeId){
  if(_routeNumMap) return _routeNumMap.get(treeId) ?? null; // vorberechnete Map während Bulk-Renders
  if(activeTours.size>1) return null;
  if(activeTourOnMap && tourOrder[activeTourOnMap]){
    const idx=tourOrder[activeTourOnMap].indexOf(treeId);
    if(idx!==-1) return idx+1;
  }
  for(const [,order] of Object.entries(tourOrder)){
    const idx=order.indexOf(treeId);
    if(idx!==-1)return idx+1;
  }
  return null;
}

function makeMarker(tree){
  const treeTourIds=getTreeTourIds(tree);
  const realIds=realTourIds(tree);                            // Übersichtstouren zählen nicht mit
  const isMulti=realIds.length>1;                             // mehrere ECHTE Tourzuordnungen → Zähler
  const activeForTree=treeTourIds.filter(id=>activeTours.has(id));
  const multiActive=activeForTree.length>=2;                  // mehrere gleichzeitig eingeblendet → gelb
  // Farbe: mehrere gleichzeitig aktive Touren → gelb; sonst aktive/Primär-Tourfarbe
  let color;
  if(multiActive){
    color='#eab308';
  } else {
    let tour;
    if(activeTourOnMap && treeTourIds.includes(activeTourOnMap)) tour=tours.find(t=>t.id===activeTourOnMap);
    else { const activeId=treeTourIds.find(id=>activeTours.has(id)); tour=activeId?tours.find(t=>t.id===activeId):primaryTour(tree); }
    color=tour?tour.color:'#6b6760';
  }
  const num=getRouteNum(tree.id);
  const isHighlighted=selectedTreeId===tree.id;
  const isPreselected=lassoSelection.size>0 && lassoSelection.has(tree.id); // Lasso-Vorauswahl
  const numColor=multiActive?'#a16207':color; // lesbarer Reihenfolge-Zähler auf Gelb

  const badge=num!=null
    ?`<div style="position:absolute;bottom:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#fff;border:1.5px solid ${numColor};color:${numColor};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:monospace;padding:0 2px;">${num}</div>`:'';

  const ring=isHighlighted
    ?`<div style="position:absolute;inset:-5px;border-radius:50%;border:3px solid ${color};animation:pulse-ring .8s ease-in-out infinite;opacity:.7;"></div>`
    :'';

  const sz=isHighlighted?Math.round(markerSize*1.3):markerSize; // Basisgröße zentral in markerSize
  const fs=Math.round(sz*0.46); // Symbolgröße proportional
  const shadow=isHighlighted?'0 0 0 3px '+color+', 0 4px 12px rgba(0,0,0,.4)':'0 2px 6px rgba(0,0,0,.3)';

  const circleHtml=`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:${isHighlighted?4:3}px solid white;box-shadow:${shadow};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:${fs}px;transform:${isHighlighted?'scale(1.15)':'scale(1)'};transition:all .2s;">${objIcon(tree)}</div>`;

  // Tour-Zähler = Anzahl der Tourzuordnungen (fix), per Button nur ausblendbar
  const multiBadge=isMulti
    ?`<div class="tour-count-badge" style="position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#f59e0b;border:2px solid #fff;color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 2px;z-index:10;">${realIds.length}</div>`:'';

  // Lasso-Vorauswahl: deutlicher durchgehender Ring (Akzent), zusätzlich zum evtl. Highlight
  const selRing=isPreselected
    ?`<div style="position:absolute;inset:-6px;border-radius:50%;border:3px solid #7c3aed;box-shadow:0 0 0 2px #fff;"></div>`
    :'';

  const icon=L.divIcon({
    className:'',
    html:`<div style="position:relative;width:${sz}px;height:${sz}px;transition:all .2s;">
      ${ring}${selRing}
      ${circleHtml}
      ${badge}${multiBadge}</div>`,
    iconSize:[sz,sz], iconAnchor:[sz/2,sz/2]
  });
  const m=L.marker([tree.lat,tree.lng],{icon,zIndexOffset:isHighlighted?500:(isPreselected?300:0)})
    .on('click',()=>{ if(assignMode&&!lassoDrawing) toggleLassoSelect(tree.id); else if(!assignMode) selectTree(tree.id,false); })
    .on('contextmenu', e=>showTreeTourContextMenu(tree, e));
  return _mAdd(m);
}

function setMarkerVisibility(){
  trees.forEach(tree=>{
    const m=mapMarkers[tree.id];if(!m)return;
    let show=treeVisibleSel(tree);
    // Optional: Eigenschaften-Filter auch auf der Karte anwenden
    if(show && objFilterOnMap && !objMatchesPropFilter(tree)) show=false;
    if(show) _mAdd(m); else _mDel(m);
  });
}

// ── Eigenschaften-Filter (Planung) ────────────────────────────
function objMatchesPropFilter(t){
  const f=objFilter;
  if(f.stadtteil && (t.stadtteil||'')!==f.stadtteil) return false;
  if(f.art && (t.art||'')!==f.art) return false;
  if(f.pflanzjahr && (t.pflanzjahr??'').toString()!==f.pflanzjahr) return false;
  if(f.zustand && (t.zustand||'')!==f.zustand) return false;
  if(f.wasser && (t.wasser||'')!==f.wasser) return false;
  for(const c of customFields){ if(f[c.key] && (t[c.key]||'')!==f[c.key]) return false; }
  if(f.status==='offen' && t.lastStatus) return false;
  if(f.status==='bewaessert' && t.lastStatus!=='bewaessert') return false;
  if(f.status==='nicht' && t.lastStatus!=='nicht') return false;
  return true;
}
function objFilterActive(){ return Object.values(objFilter).some(Boolean); }
function applyObjFilter(){ renderList(); setMarkerVisibility(); updateObjFilterCount(); }
function resetObjFilter(){ objFilter={stadtteil:'',art:'',pflanzjahr:'',zustand:'',wasser:'',status:''}; renderObjFilterUI(); applyObjFilter(); }
function updateObjFilterCount(){
  const active=objFilterActive();
  const fb=document.getElementById('btn-toggle-filter'); if(fb) fb.style.borderColor=active?'var(--green)':'var(--border)';
  const el=document.getElementById('obj-filter-count'); if(!el)return;
  const act=trees.filter(isActive);
  el.textContent = active? `${act.filter(objMatchesPropFilter).length}/${act.length}` : '';
}
function renderObjFilterUI(){
  const el=document.getElementById('obj-filter'); if(!el)return;
  const act=trees.filter(isActive);
  const distinct=k=>[...new Set(act.map(t=>(t[k]??'').toString()).filter(Boolean))].sort();
  const esc=s=>String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const opt=(vals,sel,all)=>`<option value="">${all}</option>`+vals.map(v=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(v)}</option>`).join('');
  const optRank=(fk,sel,all)=>`<option value="">${all}</option>`+rankList(fk).map(e=>`<option value="${esc(e.id)}"${e.id===sel?' selected':''}>${esc(e.label)}</option>`).join('');
  const ss='padding:4px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);min-width:0;width:100%;font-family:inherit;';
  const active=objFilterActive();
  el.innerHTML=`<div style="padding:10px 12px;">
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);">Filter</span>
      ${active?`<button data-action="reset-objfilter" style="border:none;background:none;color:#1d4ed8;font-size:11px;cursor:pointer;padding:0;">zurücksetzen</button>`:''}
      <span id="obj-filter-count" style="margin-left:auto;font-size:11px;color:${active?'var(--green)':'var(--text3)'};font-weight:${active?'600':'400'};"></span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
      <select id="of-stadtteil" style="${ss}">${opt(distinct('stadtteil'),objFilter.stadtteil,'Alle Stadtteile')}</select>
      <select id="of-art" style="${ss}">${opt(distinct('art'),objFilter.art,'Alle Typen')}</select>
      <select id="of-pflanzjahr" style="${ss}">${opt(distinct('pflanzjahr'),objFilter.pflanzjahr,'Alle Jahre')}</select>
      <select id="of-zustand" style="${ss}">${optRank('zustand',objFilter.zustand,'Alle '+FL.zustand)}</select>
      <select id="of-wasser" style="${ss}">${optRank('wasser',objFilter.wasser,'Alle '+FL.wasser)}</select>
      <select id="of-status" style="${ss}"><option value="">Alle Status</option><option value="bewaessert"${objFilter.status==='bewaessert'?' selected':''}>✓ Erledigt</option><option value="nicht"${objFilter.status==='nicht'?' selected':''}>✕ Nicht erledigt</option><option value="offen"${objFilter.status==='offen'?' selected':''}>○ Offen</option></select>
      ${customFields.map(c=>`<select id="of-cf-${c.key}" style="${ss}">${opt(distinct(c.key),objFilter[c.key]||'','Alle: '+esc(c.label))}</select>`).join('')}
    </div>
    <label style="display:flex;align-items:center;gap:6px;margin-top:7px;font-size:11px;cursor:pointer;color:var(--text2);">
      <input type="checkbox" id="of-map"${objFilterOnMap?' checked':''}> Nur gefilterte auf der Karte zeigen
    </label>
  </div>`;
  const wire={stadtteil:'of-stadtteil',art:'of-art',pflanzjahr:'of-pflanzjahr',zustand:'of-zustand',wasser:'of-wasser',status:'of-status'};
  Object.entries(wire).forEach(([k,id])=>{ const s=document.getElementById(id); if(s) s.onchange=()=>{ objFilter[k]=s.value; applyObjFilter(); renderObjFilterUI(); }; });
  customFields.forEach(c=>{ const s=document.getElementById('of-cf-'+c.key); if(s) s.onchange=()=>{ objFilter[c.key]=s.value; applyObjFilter(); renderObjFilterUI(); }; });
  const mp=document.getElementById('of-map'); if(mp) mp.onchange=()=>{ objFilterOnMap=mp.checked; setMarkerVisibility(); };
  const rb=el.querySelector('[data-action="reset-objfilter"]'); if(rb) rb.onclick=()=>resetObjFilter();
  const fb=document.getElementById('btn-toggle-filter'); if(fb) fb.style.borderColor=active?'var(--green)':'var(--border)';
  updateObjFilterCount();
}
// Filter-Panel auf der Karte ein-/ausblenden (Knopf unter dem Auge)
function toggleMapFilter(){
  const p=document.getElementById('map-filter-panel'); if(!p) return;
  const open=getComputedStyle(p).display==='none';
  p.style.display=open?'block':'none';
  const btn=document.getElementById('btn-toggle-filter');
  if(btn) btn.style.background=open?'var(--green-light)':'var(--surface)';
}
// Tour-Zähler (orange Badges) ein-/ausblenden — Farbdarstellung bleibt eindeutig
let showTourCounts=true;
function toggleTourCounts(){
  showTourCounts=!showTourCounts;
  document.body.classList.toggle('hide-tour-counts',!showTourCounts);
  const btn=document.getElementById('btn-toggle-counts');
  if(btn) btn.style.background=showTourCounts?'var(--green-light)':'var(--surface)';
}

function refreshMarkers(){
  Object.values(mapMarkers).forEach(m=>_mDel(m));mapMarkers={};
  if(_clusterOn&&_clusterGroup) _clusterGroup.clearLayers();
  _routeNumMap=buildRouteNumMap();
  try{ trees.forEach(tree=>{ if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[tree.id]=makeMarker(tree); }); }
  finally{ _routeNumMap=null; }
  setMarkerVisibility();
  renderObjFilterUI();
  loadSavedRoutes();  // load from Firestore, never auto-recalculate
  renderDepotMarker();
  renderLegend();
}

// Render-Pause bei Massen-Schreibvorgängen (z.B. Lasso-Zuweisung): Snapshots kommen je
// Batch-Commit — ohne Pause würde die Karte pro Paket komplett neu aufgebaut (n × alle Marker).
let _suppressTreeRender=false,_pendingTreeRender=false;

// Nur die GEÄNDERTEN Marker anfassen statt alle neu zu bauen — entscheidend bei großen
// Projekten (z.B. 3.400 Objekte): eine Statusmeldung ändert 1 Marker, nicht 3.400.
function diffMarkers(changes){
  _routeNumMap=buildRouteNumMap();
  try{
    changes.forEach(c=>{
      const id=c.doc.id;
      if(mapMarkers[id]){ _mDel(mapMarkers[id]); delete mapMarkers[id]; }
      if(c.type!=='removed'){
        const tree={id,...c.doc.data()};
        if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[id]=makeMarker(tree);
      }
    });
  } finally { _routeNumMap=null; }
  setMarkerVisibility();
  renderLegend(); // Zähler/Zeiten je Tour können sich geändert haben
}

function rebuildMarkersWithNumbers(){
  Object.values(mapMarkers).forEach(m=>_mDel(m));mapMarkers={};
  // makeMarker uses selectedTreeId for highlight — always passes current state
  _routeNumMap=buildRouteNumMap();
  try{ trees.forEach(tree=>{ if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[tree.id]=makeMarker(tree); }); }
  finally{ _routeNumMap=null; }
  setMarkerVisibility();
}

function renderDepotMarker(){
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}
  const depot=getDepot();if(!depot?.lat)return;
  const icon=L.divIcon({
    className:'',
    html:`<div class="depot-marker-wrap"><div class="depot-pulse"></div>
      <div style="width:36px;height:36px;border-radius:10px;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px;">🏭</div></div>`,
    iconSize:[36,36],iconAnchor:[18,18]
  });
  depotMarker=L.marker([depot.lat,depot.lng],{icon,zIndexOffset:1000}).addTo(map)
    .bindTooltip(`<b>Betriebshof</b><br>${dlEsc(depot.address||'')}`,{direction:'top',offset:[0,-20]});
}

// ─── TOUR FOCUS / MEHRFACHAUSWAHL ─────────────────────────────
async function focusTour(tourId){
  // Genau eine Tour fokussieren (ersetzt die Auswahl); null = alle anzeigen
  activeTours.clear();
  showUnplanned=false;
  if(tourId) activeTours.add(tourId);
  await applyTourSelection(true);
}
async function toggleTourSelection(tourId){
  // Checkbox/Zeile: Tour zur Anzeige hinzufügen oder entfernen
  if(activeTours.has(tourId)) activeTours.delete(tourId); else activeTours.add(tourId);
  await applyTourSelection(true);
}
async function toggleUnplanned(){
  // Unverplante Objekte zusätzlich ein-/ausblenden (additiv zu gewählten Touren)
  showUnplanned=!showUnplanned;
  await applyTourSelection(false);           // Tour-Ansicht nicht neu einpassen
  if(showUnplanned && !activeTours.size) zoomToUnplanned();   // nur Unverplant allein → darauf zoomen
}
function zoomToUnplanned(){
  const unplanned=trees.filter(t=>treeIsUnplanned(t)&&t.lat&&t.lng);
  if(!unplanned.length) return;
  const lats=unplanned.map(t=>t.lat).sort((a,b)=>a-b);
  const lngs=unplanned.map(t=>t.lng).sort((a,b)=>a-b);
  const q=(arr,p)=>arr[Math.min(arr.length-1,Math.max(0,Math.floor(arr.length*p)))];
  map.fitBounds(L.latLngBounds([[q(lats,0.05),q(lngs,0.05)],[q(lats,0.95),q(lngs,0.95)]]),{padding:[60,60],maxZoom:15});
}
// Auf die ganze Stadt (alle aktiven Objekte + Depot) zoomen
let _cityFitDone=false;
function fitToCity(){
  if(!map) return;
  const pts=trees.filter(t=>isActive(t)&&t.lat&&t.lng).map(t=>[t.lat,t.lng]);
  const depot=getDepot(); if(depot?.lat&&depot?.lng) pts.push([depot.lat,depot.lng]);
  if(!pts.length) return;
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(pts),{padding:[50,50],maxZoom:16});
}
// Einmaliges Auto-Fit beim Öffnen eines Projekts (Standardansicht ohne Tour-Auswahl)
function maybeFitCity(){
  if(_cityFitDone || currentView!=='karte') return;
  if(activeTours.size || showUnplanned){ _cityFitDone=true; return; } // Auswahl bringt eigenen Zoom
  if(trees.some(t=>isActive(t)&&t.lat&&t.lng)){ fitToCity(); _cityFitDone=true; }
}
async function applyTourSelection(fit){
  if(simState.active) stopSimulation();
  syncActiveTour();
  filterTour = activeTours.size ? 'tour' : (showUnplanned ? 'none' : 'all');

  // Bestehende Routen-Layer entfernen
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));
  tourRoutes={};

  if(activeTours.size){
    if(getRoutePlanningEnabled()){
      let missing=0;
      for(const tid of activeTours){
        try{
          const routeSnap=await getDoc(doc(db,'projects',currentProjectId,'routes',tid));
          if(routeSnap.exists){
            drawSavedRoute(tid,routeSnap.data());
          } else {
            const trs=trees.filter(t=>treeInTour(t,tid)&&t.lat&&t.lng);
            const depot=getDepot();
            tourOrder[tid]=nearestNeighborTSP(trs,depot?.lat,depot?.lng).map(t=>t.id);
            missing++;
          }
        }catch(e){ console.warn('applyTourSelection load error:',e); }
      }
      if(missing&&activeTours.size===1) notify('Noch keine Route berechnet — Rechtsklick auf Karte zum Berechnen');
    }
    // Karte auf alle ausgewählten Touren einpassen
    if(fit){
      const trs=trees.filter(t=>treeInAnyActiveTour(t)&&t.lat&&t.lng);
      if(trs.length>0){
        const pts=trs.map(t=>[t.lat,t.lng]);
        const depot=getDepot();
        if(depot?.lat&&depot?.lng) pts.push([depot.lat,depot.lng]);
        map.fitBounds(L.latLngBounds(pts),{padding:[60,60],maxZoom:16});
      }
    }
  } else if(showUnplanned){
    // nur Unverplant: keine Tour-Routenlinien zeichnen
  } else {
    if(getRoutePlanningEnabled()) await loadSavedRoutes();
  }

  setMarkerVisibility();
  rebuildMarkersWithNumbers();
  updateRouteInfoBar();
  renderLegend();
  renderFilters();
  renderList();
}

// ─── LEGEND ───────────────────────────────────────────────────
let tourLegendQuery='';
let legendExpanded=new Set(); // je Tour aufgeklappte Detail-Zeile (Session)
let showOverviewInLegend=false; // Übersichtstouren in der Legende eingeblendet? (Session, Standard: aus)
let showOverviewInGrid=false;   // Übersichtstouren im Touren-Reiter eingeblendet? (Session, Standard: aus)
let showOverviewInAssign=false; // Übersichtstouren in der Ziel-Tour-Auswahl (Planen) eingeblendet?
function applyTourLegendFilter(){
  const q=(tourLegendQuery||'').trim().toLowerCase();
  document.querySelectorAll('#tour-legend .legend-item[data-tourname]').forEach(row=>{
    row.style.display = (!q || row.dataset.tourname.includes(q)) ? '' : 'none';
  });
}
function renderLegend(){
  const el=document.getElementById('tour-legend');if(!el)return;
  if(tours.length===0){el.style.display='none';return;}
  el.style.display='block';
  const echteTouren=tours.filter(t=>!t.uebersicht);
  const overviewTouren=tours.filter(t=>t.uebersicht);
  if(echteTouren.length<8) tourLegendQuery='';

  const selCount=activeTours.size;
  const activeTour=selCount===1?tours.find(t=>t.id===[...activeTours][0]):null;

  // ── Header row: always visible ──────────────────────────────
  let html=`<div style="display:flex;align-items:center;gap:6px;padding:6px 14px;cursor:pointer;" data-action="toggle-legend">
    <span style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);flex:1;">Touren</span>`;

  // Header: aktive Tour bzw. Mehrfachauswahl-Zähler
  const unpTag=showUnplanned?` <span style="color:var(--text3);font-weight:500;">+ offen</span>`:'';
  if(activeTour){
    html+=`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${activeTour.color};">
      <span style="width:14px;height:3px;border-radius:2px;background:${activeTour.color};display:inline-block;"></span>
      ${activeTour.name}
    </span>${unpTag}`;
  } else if(selCount>1){
    html+=`<span style="font-size:11px;font-weight:600;color:var(--green);">${selCount} ausgewählt</span>${unpTag}`;
  } else if(showUnplanned){
    html+=`<span style="font-size:11px;font-weight:600;color:var(--green);">Nicht verplant</span>`;
  } else {
    html+=`<span style="font-size:11px;color:var(--text3);">${echteTouren.length} Touren</span>`;
  }
  const isOpen=el.dataset.open!=='false';
  html+=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3);transition:transform .2s;transform:rotate(${isOpen?'180':'0'}deg);flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
  </div>`;

  // ── Collapsible body ─────────────────────────────────────────
  html+=`<div id="legend-body" style="display:${isOpen?'block':'none'};">`;

  // Tour-Suchfeld — erst ab vielen Touren
  if(echteTouren.length>=8){
    html+=`<div style="padding:2px 8px 6px;"><input id="tour-legend-search" type="text" placeholder="Tour suchen…" style="width:100%;padding:4px 8px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;box-sizing:border-box;"></div>`;
  }

  // Tour rows — kompakt: Name + Gesamtzeit; Details je Tour aufklappbar (Pfeil)
  function tourRow(t){
    const _tm=tourMetrics(t.id);
    const cnt=trees.filter(x=>treeInTour(x,t.id)&&x.lat&&x.lng&&isActive(x)).length;
    const total=_tm?fmtTotalTime(_tm.durationSec,cnt):'';
    const isSel=activeTours.has(t.id);
    const isExp=legendExpanded.has(t.id);
    // Übersichtstouren: kein Aufklapp-Pfeil (keine Route/Zeiten), nur Objektzahl
    const ov=!!t.uebersicht;
    let r=`<div class="legend-item${isSel?' active-tour':''}" data-tourid="${t.id}" data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="padding:3px 6px;margin-bottom:1px;">
      <input type="checkbox" class="tour-check"${isSel?' checked':''} style="margin:0 4px 0 0;cursor:pointer;flex-shrink:0;accent-color:${t.color};">
      <div class="legend-line" style="background:${t.color};width:16px;height:3px;"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${dlEsc(t.name)}</span>
      <span class="legend-km" style="font-size:10px;">${ov?cnt:total}</span>
      ${ov?'':`<svg data-expand="${t.id}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2.5" style="flex-shrink:0;cursor:pointer;padding:1px;transition:transform .15s;transform:rotate(${isExp?180:0}deg);"><path d="M6 9l6 6 6-6"/></svg>`}
    </div>`;
    if(isExp && !ov){
      if(_tm){
        const driveMin=Math.round(_tm.durationSec/60), bewMin=cnt*getBewDuration();
        const base=Math.max(driveMin+bewMin,1), dw=Math.round(driveMin/base*100);
        r+=`<div data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="margin:0 6px 4px 30px;padding:5px 8px;background:var(--surface2);border-radius:6px;">
          <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;margin-bottom:4px;">
            <div style="width:${dw}%;background:${t.color};"></div>
            <div style="width:${100-dw}%;background:var(--green-mid);"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);">
            <span>Fahrt ${fmtDuration(_tm.durationSec)}</span><span>Tätigkeit ${fmtBewTime(cnt)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:1px;">
            <span>${_tm.km.toFixed(1)} km</span><span>${cnt} Objekte</span>
          </div>
        </div>`;
      } else {
        r+=`<div data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="margin:0 6px 4px 30px;padding:5px 8px;background:var(--surface2);border-radius:6px;font-size:10px;color:var(--text3);">
          ${cnt} Objekte — noch keine Route berechnet
        </div>`;
      }
    }
    return r;
  }
  html+=`<div style="padding:0 8px 4px;">`;
  echteTouren.forEach(t=>{ html+=tourRow(t); });
  // Übersichtstouren (z.B. Stadtteile): standardmäßig eingeklappt, per Klick einblendbar
  if(overviewTouren.length){
    html+=`<div data-action="toggle-overview" style="display:flex;align-items:center;gap:6px;padding:5px 6px;margin-top:3px;border-top:1px solid var(--border);cursor:pointer;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2.5" style="flex-shrink:0;transition:transform .15s;transform:rotate(${showOverviewInLegend?90:0}deg);"><path d="M9 18l6-6-6-6"/></svg>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      <span style="font-size:11px;font-weight:600;color:var(--text2);flex:1;">Übersichtstouren</span>
      <span style="font-size:10px;color:var(--text3);">${overviewTouren.length}</span>
    </div>`;
    if(showOverviewInLegend) overviewTouren.forEach(t=>{ html+=tourRow(t); });
  }
  // All tours row — aktiv nur wenn weder Tour noch Unverplant gewählt
  html+=`<div class="legend-item${(!activeTours.size&&!showUnplanned)?' active-tour':''}" data-tourid="__all__" style="padding:3px 6px;margin-top:2px;border-top:1px solid var(--border);">
    <div style="width:16px;height:3px;border-radius:2px;background:#ccc;flex-shrink:0;"></div>
    <span style="color:var(--text3);flex:1;font-size:12px;">Alle anzeigen</span>
  </div>`;
  // Nicht verplant — Objekte ohne Tour (Checkbox: additiv zu gewählten Touren einblendbar)
  const unplannedCount=trees.filter(t=>treeIsUnplanned(t)).length;
  html+=`<div class="legend-item${showUnplanned?' active-tour':''}" data-tourid="__none__" style="padding:3px 6px;">
    <input type="checkbox" class="unplanned-check"${showUnplanned?' checked':''} style="margin:0 4px 0 0;cursor:pointer;flex-shrink:0;">
    <div style="width:16px;height:3px;border-radius:2px;background:repeating-linear-gradient(90deg,#9c9890 0 3px,transparent 3px 6px);flex-shrink:0;"></div>
    <span style="color:var(--text3);flex:1;font-size:12px;">Nicht verplant</span>
    <span class="legend-km" style="font-size:10px;">${unplannedCount}</span>
  </div>`;
  html+=`</div>`;

  // Kein „Route berechnen"-Button mehr — Berechnung läuft über Rechtsklick auf die Karte (spart Platz)
  html+=`</div>`; // end legend-body

  el.innerHTML=html;

  // Tour-Suche verdrahten
  const ts=document.getElementById('tour-legend-search');
  if(ts){
    ts.value=tourLegendQuery;
    ts.oninput=()=>{ tourLegendQuery=ts.value; applyTourLegendFilter(); };
    ts.onclick=e=>e.stopPropagation();
  }
  applyTourLegendFilter();

  // Event delegation
  el.onclick=e=>{
    if(e.target.closest('[data-action="toggle-legend"]')){
      const body=document.getElementById('legend-body');
      const svg=el.querySelector('[data-action="toggle-legend"] svg');
      const open=body.style.display==='none';
      body.style.display=open?'block':'none';
      el.dataset.open=open?'true':'false';
      if(svg)svg.style.transform=`rotate(${open?180:0}deg)`;
      return;
    }
    if(e.target.closest('[data-action="toggle-overview"]')){ // Übersichtstouren ein-/ausklappen
      showOverviewInLegend=!showOverviewInLegend; renderLegend(); return;
    }
    const exp=e.target.closest('[data-expand]');
    if(exp){ // Pfeil: Detailzeile der Tour auf-/zuklappen (ohne die Auswahl zu ändern)
      const tid=exp.dataset.expand;
      if(legendExpanded.has(tid)) legendExpanded.delete(tid); else legendExpanded.add(tid);
      renderLegend();
      return;
    }
    const item=e.target.closest('[data-tourid]');
    if(item){const tid=item.dataset.tourid;
      if(tid==='__all__')focusTour(null);
      else if(tid==='__none__')toggleUnplanned();
      else toggleTourSelection(tid);
      return;}
  };
  updateSimButton();
}
// Karten-Knopf „Tour simulieren" (oben rechts unter dem Filter) — nur bei genau 1 Tour mit Route
function updateSimButton(){
  const btn=document.getElementById('btn-sim-tour'); if(!btn) return;
  const one=[...activeTours][0];
  btn.style.display=(activeTours.size===1 && one && tourRoutes[one] && !simState.active)?'flex':'none';
}
function simulateActiveTour(){
  if(activeTours.size!==1) return;
  const tid=[...activeTours][0];
  if(tid && tourRoutes[tid]) startSimulation(tid);
}

// ─── ABFAHR-SIMULATION (Route-Playback) ───────────────────────
let simState = { active:false };
const SIM_PLAY = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z"/></svg>';
const SIM_PAUSE = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';

function fmtClock(sec){
  sec=Math.max(0,Math.round(sec));
  const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), s=sec%60;
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function simNearestVertex(pts,coord,from){
  let best=from,bd=Infinity;
  for(let i=from;i<pts.length;i++){ const d=haversine(pts[i][0],pts[i][1],coord[0],coord[1]); if(d<bd){bd=d;best=i;} }
  return best;
}
function simPosAtDist(d){
  const {pts,cum}=simState; const last=cum.length-1;
  if(d<=0) return {pt:pts[0],k:0};
  if(d>=cum[last]) return {pt:pts[last],k:last};
  let lo=0,hi=last;
  while(lo<hi){ const mid=(lo+hi)>>1; if(cum[mid]<d) lo=mid+1; else hi=mid; }
  const k=Math.max(1,lo); const segLen=(cum[k]-cum[k-1])||1; const f=(d-cum[k-1])/segLen;
  const a=pts[k-1],b=pts[k];
  return {pt:[a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f], k:k-1};
}
function simPositionAt(elapsed){
  let acc=0; const segs=simState.segments;
  for(let i=0;i<segs.length;i++){
    const seg=segs[i], local=elapsed-acc;
    if(elapsed<acc+seg.dur || i===segs.length-1){
      if(seg.type==='drive'){
        const from=simState.cum[seg.fromIdx], to=simState.cum[seg.toIdx];
        const f=seg.dur?Math.min(1,Math.max(0,local/seg.dur)):1;
        const d=from+(to-from)*f; const {pt,k}=simPosAtDist(d);
        return {pt,k,phase:'Fahrt',type:'drive'};
      }
      return {pt:simState.pts[seg.idx],k:seg.idx,phase:'Tätigkeit'+(seg.tree?.name?' — '+seg.tree.name:''),type:'water'};
    }
    acc+=seg.dur;
  }
  const last=simState.pts.length-1;
  return {pt:simState.pts[last],k:last,phase:'Ziel erreicht',type:'end'};
}
function buildSimModel(route,skipBew){
  let pts=[];
  const geojson=route.geojsonStr?JSON.parse(route.geojsonStr):(route.geojson||null);
  if(geojson?.features?.[0]?.geometry?.coordinates){
    pts=geojson.features[0].geometry.coordinates.map(c=>[c[1],c[0]]);
  } else if(route.orderIds){
    const depot=getDepot();
    const ot=route.orderIds.map(id=>trees.find(t=>t.id===id)).filter(t=>t&&t.lat&&t.lng);
    pts=ot.map(t=>[t.lat,t.lng]);
    if(depot){ const dp=[depot.lat,depot.lng]; pts=getDepotMode()==='round'?[dp,...pts,dp]:[dp,...pts]; }
  }
  if(pts.length<2) return null;
  const cum=[0];
  for(let i=1;i<pts.length;i++) cum[i]=cum[i-1]+haversine(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1])*1000;
  const totalGeo=cum[cum.length-1]||1;
  const totalDrive=route.durationSec||(totalGeo/1000/30*3600);
  const waterSec=skipBew?0:getBewDuration()*60;
  const depot=getDepot();
  const ot=(route.orderIds||[]).map(id=>trees.find(t=>t.id===id)).filter(t=>t&&t.lat&&t.lng);
  if(ot.length===0) return null;
  const wp=[];
  if(depot) wp.push({type:'depot',coord:[depot.lat,depot.lng]});
  ot.forEach(t=>wp.push({type:'water',coord:[t.lat,t.lng],tree:t}));
  if(depot&&getDepotMode()==='round') wp.push({type:'depot',coord:[depot.lat,depot.lng]});
  let prev=0;
  wp.forEach((w,i)=>{ let idx=simNearestVertexLocal(pts,w.coord,i===0?0:prev); if(idx<prev) idx=prev; w.idx=idx; prev=idx; });
  const segments=[];
  for(let i=0;i<wp.length;i++){
    if(i>0){
      const from=wp[i-1].idx,to=wp[i].idx;
      const legDist=Math.max(0,cum[to]-cum[from]);
      segments.push({type:'drive',dur:totalDrive*(legDist/totalGeo),fromIdx:from,toIdx:to});
    }
    if(wp[i].type==='water') segments.push({type:'water',dur:waterSec,idx:wp[i].idx,tree:wp[i].tree});
  }
  const total=segments.reduce((s,x)=>s+x.dur,0)||1;
  return {pts,cum,segments,total};
}
function simNearestVertexLocal(pts,coord,from){ return simNearestVertex(pts,coord,from); }
function simIcon(color){
  return L.divIcon({ className:'', iconSize:[34,34], iconAnchor:[17,17],
    html:`<div style="width:34px;height:34px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;font-size:18px;">🚚</div>` });
}
async function startSimulation(tourId){
  if(simState.active) stopSimulation();
  const tour=tours.find(t=>t.id===tourId); if(!tour) return;
  let route=null;
  try{ const snap=await getDoc(doc(db,'projects',currentProjectId,'routes',tourId)); if(snap.exists) route=snap.data(); }catch(e){ console.warn('sim route load:',e); }
  if(!route){ notify('Bitte zuerst die Route berechnen'); return; }
  const model=buildSimModel(route,false);
  if(!model){ notify('Keine ausreichenden Routendaten für die Simulation'); return; }
  simState={ active:true, tourId, tour, playing:true, speed:10, elapsed:0, lastTs:0, seeking:false, _route:route, skipBew:false, ...model };
  simState.marker=L.marker(model.pts[0],{icon:simIcon(tour.color),zIndexOffset:2000}).addTo(map);
  simState.trail=L.polyline([model.pts[0]],{color:tour.color,weight:6,opacity:.95}).addTo(map);
  document.getElementById('sim-bar').style.display='flex';
  const sb=document.getElementById('btn-sim-tour'); if(sb) sb.style.display='none';
  renderSimBar();
  simState.raf=requestAnimationFrame(simTick);
}
function stopSimulation(){
  if(simState.raf) cancelAnimationFrame(simState.raf);
  if(simState.marker) map.removeLayer(simState.marker);
  if(simState.trail) map.removeLayer(simState.trail);
  const bar=document.getElementById('sim-bar'); if(bar){ bar.style.display='none'; bar.innerHTML=''; }
  simState={active:false};
  updateSimButton();
}
function simTick(ts){
  if(!simState.active) return;
  if(simState.playing && !simState.seeking && simState.lastTs){
    const dt=Math.min(0.25,(ts-simState.lastTs)/1000); // dt kappen → kein Sprung nach Tab-Wechsel (rAF-Pause)
    simState.elapsed+=dt*simState.speed;
    if(simState.elapsed>=simState.total){ simState.elapsed=simState.total; simState.playing=false; renderSimBar(); }
  }
  simState.lastTs=ts;
  renderSimFrame();
  simState.raf=requestAnimationFrame(simTick);
}
function renderSimFrame(){
  if(!simState.active) return;
  const p=simPositionAt(simState.elapsed);
  simState.marker.setLatLng(p.pt);
  const trail=simState.pts.slice(0,p.k+1); trail.push(p.pt);
  simState.trail.setLatLngs(trail);
  const ph=document.getElementById('sim-playhead'); if(ph) ph.style.left=(simState.elapsed/simState.total*100)+'%';
  const tt=document.getElementById('sim-time'); if(tt) tt.textContent=`${fmtClock(simState.elapsed)} / ${fmtClock(simState.total)}`;
  const lab=document.getElementById('sim-phase'); if(lab){ lab.textContent=p.phase; lab.style.color=p.type==='water'?'#16a34a':p.type==='drive'?'#2563eb':'var(--text3)'; }
}
function simSeekFromEvent(e){
  const track=document.getElementById('sim-track'); if(!track) return;
  const r=track.getBoundingClientRect();
  const frac=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
  simState.elapsed=frac*simState.total; simState.lastTs=0;
  renderSimFrame();
}
function renderSimBar(){
  const bar=document.getElementById('sim-bar'); if(!bar||!simState.active) return;
  let segHtml='',acc=0;
  simState.segments.forEach(s=>{
    const w=s.dur/simState.total*100;
    segHtml+=`<div style="position:absolute;top:0;bottom:0;left:${acc}%;width:${w}%;background:${s.type==='water'?'#16a34a':'#2563eb'};"></div>`;
    acc+=s.dur;
  });
  segHtml+=`<div style="position:absolute;top:0;bottom:0;left:0;width:3px;background:#f97316;"></div><div style="position:absolute;top:0;bottom:0;right:0;width:3px;background:#f97316;"></div>`;
  const ended=simState.elapsed>=simState.total;
  bar.innerHTML=`
    <button data-sim="play" style="width:40px;height:40px;border-radius:50%;border:none;background:#2563eb;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${(simState.playing&&!ended)?SIM_PAUSE:SIM_PLAY}</button>
    <div style="display:flex;flex-direction:column;gap:5px;min-width:230px;flex:1;">
      <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--text2);">
        <span id="sim-time" style="font-variant-numeric:tabular-nums;">${fmtClock(simState.elapsed)} / ${fmtClock(simState.total)}</span>
        <span style="font-size:11px;font-weight:700;color:${simState.tour.color};">${simState.tour.name}</span>
        <span id="sim-phase" style="font-weight:600;"></span>
      </div>
      <div id="sim-track" style="position:relative;height:14px;border-radius:7px;overflow:hidden;background:var(--surface2);cursor:pointer;touch-action:none;">
        ${segHtml}
        <div id="sim-playhead" style="position:absolute;top:-3px;width:3px;height:20px;background:var(--text);left:${simState.elapsed/simState.total*100}%;border-radius:2px;pointer-events:none;box-shadow:0 0 0 2px var(--surface);"></div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:7px;flex-shrink:0;">
      <input type="range" min="1" max="200" step="1" value="${simState.speed}" oninput="setSimSpeed(this.value)" title="Geschwindigkeit (×)" style="width:110px;accent-color:var(--green);cursor:pointer;">
      <span id="sim-speed-label" style="font-size:11px;font-weight:700;color:var(--text2);min-width:40px;">${simState.speed}×</span>
    </div>
    <label title="Bei Tätigkeit nicht anhalten — direkt zum nächsten Punkt weiterfahren" style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text2);cursor:pointer;flex-shrink:0;white-space:nowrap;">
      <input type="checkbox" ${simState.skipBew?'checked':''} onchange="toggleSimSkipBew()" style="cursor:pointer;accent-color:var(--green);"> Tätigkeit überspringen
    </label>
    <div style="display:flex;gap:9px;font-size:10px;color:var(--text3);flex-shrink:0;">
      <span style="display:flex;align-items:center;gap:3px;"><i style="width:9px;height:9px;border-radius:2px;background:#16a34a;display:inline-block;"></i>Tätigkeit</span>
      <span style="display:flex;align-items:center;gap:3px;"><i style="width:9px;height:9px;border-radius:2px;background:#2563eb;display:inline-block;"></i>Fahrt</span>
      <span style="display:flex;align-items:center;gap:3px;"><i style="width:9px;height:9px;border-radius:2px;background:#f97316;display:inline-block;"></i>Depot</span>
    </div>
    <button data-sim="close" title="Simulation beenden" style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border);background:var(--surface);cursor:pointer;flex-shrink:0;font-size:15px;color:var(--text3);line-height:1;">✕</button>`;
  bar.onclick=e=>{
    const b=e.target.closest('[data-sim]'); if(!b) return;
    const a=b.dataset.sim;
    if(a==='play'){
      if(simState.elapsed>=simState.total) simState.elapsed=0;
      simState.playing=!simState.playing; simState.lastTs=0; renderSimBar();
    }
    else if(a==='close'){ stopSimulation(); }
  };
  const track=document.getElementById('sim-track');
  if(track){
    track.onpointerdown=e=>{ simState.seeking=true; try{track.setPointerCapture(e.pointerId);}catch(_){} simSeekFromEvent(e); };
    track.onpointermove=e=>{ if(simState.seeking) simSeekFromEvent(e); };
    track.onpointerup=track.onpointercancel=()=>{ simState.seeking=false; simState.lastTs=0; };
  }
  renderSimFrame();
}
// Geschwindigkeit per Schieberegler (1–200×) — nur Label aktualisieren, Bar nicht neu rendern (flüssiger Regler)
function setSimSpeed(v){
  if(!simState.active) return;
  simState.speed=Math.max(1,Math.min(200,parseFloat(v)||1));
  simState.lastTs=0;
  const l=document.getElementById('sim-speed-label'); if(l) l.textContent=simState.speed+'×';
}
// Schalter: bei Tätigkeit nicht anhalten → Modell neu bauen (Position als Fortschritt erhalten)
function toggleSimSkipBew(){
  if(!simState.active||!simState._route) return;
  const frac = simState.total ? Math.min(1, simState.elapsed/simState.total) : 0;
  simState.skipBew=!simState.skipBew;
  const m=buildSimModel(simState._route, simState.skipBew);
  if(m){ simState.segments=m.segments; simState.total=m.total; simState.pts=m.pts; simState.cum=m.cum; simState.elapsed=frac*simState.total; simState.lastTs=0; }
  renderSimBar();
}

// ─── LIST ─────────────────────────────────────────────────────
function renderFilters(){} // removed — legend handles filtering
function setFilter(f,el){
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el?.classList.add('active');
  if(f==='none'){
    activeTours.clear(); showUnplanned=true;
    applyTourSelection(false); zoomToUnplanned();
  } else if(f==='all'){
    activeTours.clear(); showUnplanned=false;
    applyTourSelection(false);
  } else {
    focusTour(f);
  }
}

// Perf: Suche entprellen → kein voller Listen-/Tabellen-Rebuild bei jedem Tastendruck
function _debounce(fn,ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),ms); }; }
const renderListDebounced=_debounce(()=>renderList(),160);
const filterBaeumeTableDebounced=_debounce(v=>filterBaeumeTable(v),160);
const filterDetailTableDebounced=_debounce(v=>filterDetailTable(v),160);

function renderList(){
  const q=document.getElementById('search-input')?.value.toLowerCase()||'';
  let filtered=trees.filter(t=>{
    const mq=!q||t.name?.toLowerCase().includes(q)||(t.art||'').toLowerCase().includes(q);
    const mf = treeVisibleSel(t);
    return mq&&mf&&objMatchesPropFilter(t);
  });
  // Sort by route number when a tour is active
  if(activeTourOnMap&&tourOrder[activeTourOnMap]){
    const order=tourOrder[activeTourOnMap];
    filtered.sort((a,b)=>{
      const ia=order.indexOf(a.id);
      const ib=order.indexOf(b.id);
      if(ia===-1&&ib===-1)return 0;
      if(ia===-1)return 1;
      if(ib===-1)return -1;
      return ia-ib;
    });
  }
  const list=document.getElementById('tree-list');if(!list)return;
  if(filtered.length===0){list.innerHTML=`<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22V12"/><path d="M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7z"/></svg><p>Keine Objekte gefunden</p></div>`;
  } else {
    const tourMap=new Map(tours.map(t=>[t.id,t]));   // Perf: 1× statt tours.find pro Zeile
    const prevRn=_routeNumMap; _routeNumMap=buildRouteNumMap();
    try{
    list.innerHTML=filtered.map(tree=>{
      const treeTours=getTreeTourIds(tree).map(id=>tourMap.get(id)).filter(Boolean);
      // Bei angezeigter Tour deren Farbe bevorzugen
      const primaryT=(activeTourOnMap&&treeTours.find(t=>t.id===activeTourOnMap))||treeTours[0]||null;
      const color=primaryT?.color||null;
      const zEntry=tree.zustand?rankEntry('zustand',tree.zustand):null;
      const bg=color?color+'22':'#f0ede6';
      const rNum=getRouteNum(tree.id);
      const numBadge=rNum!=null?`<span class="badge" style="background:${color||'#6b6760'}22;color:${color||'#6b6760'};font-family:monospace;">#${rNum}</span>`:'';
      const sel=selectedTreeId===tree.id?' selected':'';
      const tourBadges=treeTours.map(t=>`<span class="badge" style="background:${t.color}22;color:${t.color};">${dlEsc(t.name)}</span>`).join('');
      return `<div class="tree-item${sel}" data-treeid="${tree.id}">
        <div class="tree-icon" style="background:${bg};">${objIcon(tree)}</div>
        <div class="tree-info">
          <div class="tree-name">${dlEsc(tree.name||'–')}</div>
          <div class="tree-meta">${dlEsc(tree.art||'Unbekannt')} · ${dlEsc(tree.stadtteil||'')}</div>
          <div class="tree-badges">
            ${numBadge}
            ${tourBadges}
            ${zEntry?`<span class="badge" style="background:${zEntry.farbe}22;color:${zEntry.farbe};">${dlEsc(zEntry.label)}</span>`:''}
          </div>
        </div>
      </div>`;
    }).join('');
    } finally { _routeNumMap=prevRn; }
    // Event delegation — reliable, no escaping issues
    list.onclick=e=>{
      const item=e.target.closest('[data-treeid]');
      if(item) selectTree(item.dataset.treeid);
    };
  }
  document.getElementById('list-count').textContent=`${filtered.length} Objekte`;
}

function selectTree(id, pan=true){
  const prev=selectedTreeId;
  selectedTreeId=id;

  // Rebuild only the two affected markers
  if(prev&&prev!==id&&mapMarkers[prev]){
    _mDel(mapMarkers[prev]);
    const pt=trees.find(t=>t.id===prev);
    if(pt&&pt.lat&&pt.lng) mapMarkers[prev]=makeMarker(pt);
  }
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  if(mapMarkers[id]) _mDel(mapMarkers[id]);
  if(tree.lat&&tree.lng) mapMarkers[id]=makeMarker(tree);

  renderList();

  const wasOnMap = currentView==='karte';
  if(!wasOnMap) switchView('karte');

  if(pan && tree.lat&&tree.lng){
    // Pan/zentrieren (beim Listen-Klick); beim Karten-Klick nicht nötig
    setTimeout(()=>{
      map.invalidateSize();
      map.panTo([tree.lat,tree.lng],{animate:true,duration:0.5});
    }, wasOnMap ? 0 : 200);
  }

  // Open detail panel after potential view switch
  setTimeout(()=>openDetail(id), wasOnMap ? 0 : 50);
}

// ─── DETAIL PANEL ─────────────────────────────────────────────
// Detail-Leiste in die GERADE AKTIVE Ansicht einhängen (Karte ODER Disposition),
// damit sie z. B. in der Füllstandsplanung ohne Ansichtswechsel erscheint.
// In der Karte „wohnt" sie weiter an ihrem Ursprungsort → dort unverändertes Verhalten.
let _detailHome=null;
function _mountDetailPanel(){
  const p=document.getElementById('detail-panel'); if(!p) return;
  if(!_detailHome) _detailHome=p.parentNode;
  const target=(currentView==='disposition')?document.getElementById('view-disposition'):_detailHome;
  if(target && p.parentNode!==target) target.appendChild(p);
}
function openDetail(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  _mountDetailPanel();
  selectedTreeId=id;renderList();
  const tour=primaryTour(tree);
  const _zE=tree.zustand?rankEntry('zustand',tree.zustand):null;
  const statusBg=_zE?_zE.farbe+'22':'';
  const statusColor=_zE?_zE.farbe:'';
  const zLabel=_zE?_zE.label:'';
  const rNum=getRouteNum(tree.id);
  document.getElementById('panel-title').textContent=tree.name;
  const _meta=document.getElementById('panel-meta');
  if(_meta) _meta.textContent=`${tree.baumnr?'Nr. '+tree.baumnr+' · ':''}${tree.art||''}${tree.stadtteil?' · '+tree.stadtteil:''}`;
  // Build tour options for inline select
  const currentTourIds=getTreeTourIds(tree);
  const tourOptions=tours.map(t=>`<option value="${t.id}"${currentTourIds.includes(t.id)?' selected':''}>${t.name}</option>`).join('');

  // Kompakt: leere Felder ausblenden (kein „–"-Rauschen), Koordinaten ganz raus
  const drow=(k,v,vs)=>v?`<div class="detail-field" style="padding:5px 0;"><span class="detail-key">${k}</span><span class="detail-val"${vs?` style="${vs}"`:''}>${dlEsc(''+v)}</span></div>`:'';
  let body=`
    ${_zE?`<div class="status-bar" style="background:${statusBg};color:${statusColor};">${dlEsc(zLabel)} — ${dlEsc(FL.zustand)}</div>`:''}

    <div class="form-section">Identifikation</div>
    <div class="detail-field" style="padding:5px 0;"><span class="detail-key">Objekt-ID</span><span class="detail-val" style="font-family:monospace;font-weight:700;color:var(--green);">${tree.baumId||'–'}</span></div>
    ${drow(FL.baumnr||'Baumnummer',tree.baumnr)}
    ${drow(FL.stadtteil,tree.stadtteil)}
    ${drow(FL.art,tree.art,'font-style:italic;')}
    ${drow(FL.pflanzjahr,tree.pflanzjahr)}
    ${drow(FL.pflanzzeitpunkt||'Pflanzzeitpunkt',tree.pflanzzeitpunkt)}
    ${customFields.map(c=>drow(c.label,tree[c.key])).join('')}

    <div class="form-section">Pflege</div>
    <div class="detail-field" style="padding:4px 0;">
      <span class="detail-key">${FL.wasser}</span>
      <select class="form-control" id="inline-wasser" style="width:auto;padding:3px 8px;font-size:12px;">
        ${rankList('wasser').map(e=>`<option value="${dlEsc(e.id)}"${tree.wasser===e.id?' selected':''}>${dlEsc(e.label)}</option>`).join('')}
      </select>
    </div>
    <div class="detail-field" style="padding:4px 0;">
      <span class="detail-key">${FL.zustand}</span>
      <select class="form-control" id="inline-zustand" style="width:auto;padding:3px 8px;font-size:12px;">
        ${rankList('zustand').map(e=>`<option value="${dlEsc(e.id)}"${tree.zustand===e.id?' selected':''}>${dlEsc(e.label)}</option>`).join('')}
      </select>
    </div>

    <div class="form-section">Touren (Mehrfachauswahl)</div>
    <div style="padding:6px 0 4px;">
      <div id="inline-tour-chips" style="max-height:170px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;">
        ${tours.length===0?'<div style="padding:10px;font-size:12px;color:var(--text3);">Keine Touren angelegt</div>':tours.map(t=>{
          const sel=currentTourIds.includes(t.id);
          return `<label data-tourid="${t.id}" style="display:flex;align-items:center;gap:9px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border);font-size:13px;background:${sel?t.color+'14':'transparent'};">
            <input type="checkbox"${sel?' checked':''} style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:${t.color};">
            <span style="width:11px;height:11px;border-radius:50%;background:${t.color};flex-shrink:0;"></span>
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.name}</span>
          </label>`;
        }).join('')}
      </div>
      <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;width:100%;${isReadonly()?'opacity:.45;cursor:not-allowed;':''}" ${isReadonly()?'disabled title="Nur Lesezugriff"':`onclick="saveInlineFields('${id}')"`}>Touren speichern</button>
    </div>

    ${tree.notiz?`<div style="margin:8px 0;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);font-size:12px;color:var(--text2);">${dlEsc(tree.notiz)}</div>`:''}

    ${(tree.fotos&&tree.fotos.length)?`
    <div class="form-section">Fotos (${tree.fotos.length})</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;padding:4px 0 8px;">
      ${tree.fotos.map((f,i)=>`<img src="${f.u}" loading="lazy" onclick="openFoto('${id}',${i})" title="Foto öffnen" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;">`).join('')}
    </div>`:''}

    <div class="form-section">Dokumente${(tree.dokumente&&tree.dokumente.length)?` (${tree.dokumente.length})`:''}</div>
    <div style="display:flex;flex-direction:column;gap:5px;padding:4px 0 8px;">
      ${(tree.dokumente||[]).map((d,i)=>`<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:7px 10px;">
        <span style="flex-shrink:0;">${d.typ==='link'?'🔗':docIcon(d.name)}</span>
        <a href="${dlEsc(d.u)}" target="_blank" rel="noopener" title="${dlEsc(d.name||'')}" style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(d.name||'Dokument')}</a>
        ${d.size?`<span style="font-size:10px;color:var(--text3);flex-shrink:0;">${fmtBytes(d.size)}</span>`:''}
        ${isReadonly()?'':`<button onclick="docDelete('${id}',${i})" title="Entfernen" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:15px;line-height:1;padding:0 2px;flex-shrink:0;">×</button>`}
      </div>`).join('')}
      ${isReadonly()?((tree.dokumente&&tree.dokumente.length)?'':'<div style="font-size:11px;color:var(--text3);">Keine Dokumente.</div>'):`<div style="display:flex;gap:6px;">
        <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docUploadStart('${id}')">📎 Datei hochladen</button>
        <button class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docAddLink('${id}')">🔗 Link hinzufügen</button>
      </div>`}
    </div>

`;
  document.getElementById('panel-body').innerHTML=body;
  const noCoords = !tree.lat || !tree.lng;
  document.getElementById('panel-actions').innerHTML=`
    ${noCoords ? `<button class="btn btn-secondary" style="flex:1;border-color:var(--amber);color:var(--amber);" onclick="startGpsPlacement('${id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z"/></svg>
      Position setzen
    </button>` : ''}
    ${(!noCoords && canEditObjects()) ? `<button class="btn btn-secondary" style="flex:1;" onclick="startMoveObject('${id}')" title="Standort auf der Karte korrigieren">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>
      Verschieben
    </button>` : ''}
    <button class="btn btn-secondary" style="flex:1;" onclick="openEditTree('${id}')">Bearbeiten</button>`;
  switchDetailTab('details');
  const _vb = document.getElementById('panel-body-verlauf');
  if(_vb) _vb._treeId = id;
  document.getElementById('detail-panel').classList.add('open');
  // Tourenauswahl: Zeilen-Highlight bei Checkbox-Änderung
  document.getElementById('inline-tour-chips')?.addEventListener('change',e=>{
    const cb=e.target.closest('input[type=checkbox]');if(!cb)return;
    const label=cb.closest('[data-tourid]');
    const tour=tours.find(t=>t.id===label?.dataset.tourid);
    if(label&&tour) label.style.background=cb.checked?tour.color+'14':'transparent';
  });
}

function switchDetailTab(tab) {
  const bodyDetails = document.getElementById('panel-body');
  const bodyVerlauf = document.getElementById('panel-body-verlauf');
  const actions = document.getElementById('panel-actions');
  const tabD = document.getElementById('dtab-details');
  const tabV = document.getElementById('dtab-verlauf');
  if(tab === 'details') {
    bodyDetails.style.display = ''; bodyVerlauf.style.display = 'none'; actions.style.display = '';
    tabD.style.cssText += ';font-weight:600;color:var(--text);border-bottom:2px solid var(--green)';
    tabV.style.cssText += ';font-weight:400;color:var(--text3);border-bottom:2px solid transparent';
  } else {
    bodyDetails.style.display = 'none'; bodyVerlauf.style.display = ''; actions.style.display = 'none';
    tabD.style.cssText += ';font-weight:400;color:var(--text3);border-bottom:2px solid transparent';
    tabV.style.cssText += ';font-weight:600;color:var(--text);border-bottom:2px solid var(--green)';
    renderVerlaufDesktop(bodyVerlauf._treeId);
  }
}

function renderVerlaufDesktop(id, targetEl) {
  const tree = trees.find(t => t.id === id);
  const body = targetEl || document.getElementById('panel-body-verlauf');
  if(!tree || !body) return;
  const history = [...(tree.history || [])].reverse();
  const bew = history.filter(e => e.status === 'bewaessert' || (!e.status && e.note)).length;
  const nicht = history.filter(e => e.status === 'nicht').length;
  const total = history.length;
  let html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px;">
    <div style="background:var(--green-light);border-radius:var(--radius-sm);padding:10px 0;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#16a34a;">${bew}</div>
      <div style="font-size:11px;color:#16a34a;margin-top:2px;">Erledigt</div>
    </div>
    <div style="background:var(--red-light);border-radius:var(--radius-sm);padding:10px 0;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:#991b1b;">${nicht}</div>
      <div style="font-size:11px;color:#991b1b;margin-top:2px;">Nicht bew.</div>
    </div>
    <div style="background:var(--surface2);border-radius:var(--radius-sm);padding:10px 0;text-align:center;">
      <div style="font-size:20px;font-weight:700;color:var(--text);">${total}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">Gesamt</div>
    </div>
  </div>`;
  if(history.length === 0) {
    html += `<div style="text-align:center;padding:32px 0;color:var(--text3);font-size:13px;">Noch keine Einträge vorhanden</div>`;
  } else {
    html += `<div style="font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--text3);margin-bottom:10px;">Einträge</div><div style="position:relative;">`;
    history.forEach((e, i) => {
      const isNicht = e.status === 'nicht';
      const dot = isNicht ? 'background:#fee2e2;border:1.5px solid #991b1b;' : 'background:#dcfce7;border:1.5px solid #16a34a;';
      const label = isNicht ? 'Nicht erledigt' : 'Erledigt';
      const color = isNicht ? '#991b1b' : '#16a34a';
      const date = (e.date||'').split('-').reverse().join('.');
      const sub = [e.driver||e.note, e.tourName, e.reason].filter(Boolean).join(' · ');
      const isLast = i === history.length - 1;
      html += `<div style="position:relative;padding-left:20px;padding-bottom:${isLast?4:14}px;">
        <div style="position:absolute;left:0;top:4px;width:9px;height:9px;border-radius:50%;${dot}"></div>
        ${!isLast ? '<div style="position:absolute;left:4px;top:13px;bottom:0;width:1px;background:var(--border);"></div>' : ''}
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;">
          <span style="font-size:13px;font-weight:600;color:${color};">${label}</span>
          <span style="font-size:11px;color:var(--text3);white-space:nowrap;">${date}</span>
        </div>
        ${sub ? `<div style="font-size:12px;color:var(--text3);margin-top:1px;">${sub}</div>` : ''}
      </div>`;
    });
    html += '</div>';
  }
  body.innerHTML = html;
}

function closePanel(){
  document.getElementById('detail-panel').classList.remove('open');
  const prev=selectedTreeId;
  selectedTreeId=null;
  renderList();
  // Un-highlight marker
  if(prev&&mapMarkers[prev]){
    _mDel(mapMarkers[prev]);
    const pt=trees.find(t=>t.id===prev);
    if(pt&&pt.lat&&pt.lng) mapMarkers[prev]=makeMarker(pt);
  }
}

// ─── FOTO-LIGHTBOX ───────────────────────────────────────────────────────────
let _fotoState=null; // {treeId, idx}
function openFoto(treeId, idx){
  const tree=trees.find(t=>t.id===treeId); if(!tree||!tree.fotos||!tree.fotos[idx]) return;
  _fotoState={treeId, idx}; renderFotoLightbox();
}
function stepFoto(d){ if(_fotoState){ _fotoState.idx+=d; renderFotoLightbox(); } }
function closeFoto(){ _fotoState=null; document.getElementById('foto-lightbox')?.remove(); }
function renderFotoLightbox(){
  if(!_fotoState) return;
  const tree=trees.find(t=>t.id===_fotoState.treeId);
  if(!tree||!tree.fotos||!tree.fotos.length){ closeFoto(); return; }
  const n=tree.fotos.length; let i=((_fotoState.idx%n)+n)%n; _fotoState.idx=i;
  const f=tree.fotos[i]; const dateStr=f.t?new Date(f.t).toLocaleDateString('de-DE'):'';
  let ov=document.getElementById('foto-lightbox');
  if(!ov){ ov=document.createElement('div'); ov.id='foto-lightbox'; document.body.appendChild(ov); }
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;';
  ov.innerHTML=`
    <div style="position:absolute;inset:0;" onclick="closeFoto()"></div>
    <div style="position:relative;max-width:92vw;max-height:90vh;display:flex;flex-direction:column;align-items:center;gap:12px;">
      <img src="${f.u}" style="max-width:92vw;max-height:78vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <div style="display:flex;align-items:center;gap:14px;color:#fff;font-size:13px;">
        ${n>1?`<button onclick="stepFoto(-1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;">‹</button>`:''}
        <span>${i+1} / ${n}${dateStr?' · '+dateStr:''}</span>
        ${n>1?`<button onclick="stepFoto(1)" style="background:rgba(255,255,255,.15);border:none;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:18px;">›</button>`:''}
        <a href="${f.u}" target="_blank" rel="noopener" style="color:#fff;">Original ↗</a>
        ${isReadonly()?'':`<button onclick="deleteFoto()" style="background:var(--red);border:none;color:#fff;padding:6px 12px;border-radius:6px;cursor:pointer;">Löschen</button>`}
      </div>
    </div>
    <button onclick="closeFoto()" style="position:absolute;top:18px;right:22px;background:rgba(255,255,255,.15);border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:22px;">×</button>`;
}
async function deleteFoto(){
  if(!_fotoState) return;
  const tree=trees.find(t=>t.id===_fotoState.treeId); if(!tree||!tree.fotos) return;
  const f=tree.fotos[_fotoState.idx]; if(!f) return;
  if(!confirm('Dieses Foto endgültig löschen?')) return;
  try{
    try{ await storage.refFromURL(f.u).delete(); }catch(e){ if(e.code!=='storage/object-not-found') throw e; }
    await db.collection('projects').doc(currentProjectId).collection('trees').doc(tree.id)
      .set({fotos: firebase.firestore.FieldValue.arrayRemove(f)},{merge:true});
    tree.fotos=tree.fotos.filter(x=>x.u!==f.u);
    notify('✓ Foto gelöscht');
    if(!tree.fotos.length) closeFoto(); else renderFotoLightbox();
    refreshMediaViews(tree.id);
  }catch(e){ notify('Fehler beim Löschen: '+(e.message||e.code)); }
}
document.addEventListener('keydown',e=>{
  if(!_fotoState) return;
  if(e.key==='Escape') closeFoto();
  else if(e.key==='ArrowLeft') stepFoto(-1);
  else if(e.key==='ArrowRight') stepFoto(1);
});

// ─── DOKUMENTE AM OBJEKT (Storage-Upload wie Fotos + externe Links) ─────────
const DOC_MAX_BYTES=20*1024*1024;
const DOC_TYPES={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',txt:'text/plain',csv:'text/csv'};
function docIcon(n){ const e=(n||'').split('.').pop().toLowerCase(); return {pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',csv:'📊',png:'🖼️',jpg:'🖼️',jpeg:'🖼️',txt:'📃'}[e]||'📎'; }
function fmtBytes(b){ if(!b)return''; return b>1048576?(b/1048576).toFixed(1)+' MB':Math.max(1,Math.round(b/1024))+' KB'; }
function docUploadStart(treeId){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const inp=document.createElement('input');
  inp.type='file'; inp.multiple=true;
  inp.accept='.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.txt,.csv';
  inp.onchange=()=>docUploadFiles(treeId,[...inp.files]);
  inp.click();
}
async function docUploadFiles(treeId,files){
  const tree=trees.find(t=>t.id===treeId); if(!tree||!files.length) return;
  const org=currentProjectData?.orgId||currentOrg;
  const added=[];
  for(const f of files){
    const ext=(f.name.split('.').pop()||'').toLowerCase();
    if(!DOC_TYPES[ext]){ notify(`„${f.name}": Dateityp nicht erlaubt (PDF, Word, Excel, Bild, Text)`); continue; }
    if(f.size>DOC_MAX_BYTES){ notify(`„${f.name}" ist größer als 20 MB`); continue; }
    notify(`Lade „${f.name}" hoch…`);
    try{
      const safe=f.name.replace(/[^\w.\-äöüÄÖÜß ]+/g,'_').slice(0,80);
      const ref=storage.ref(`objektdokumente/${org}/${currentProjectId}/${treeId}/${Date.now().toString(36)}_${safe}`);
      await ref.put(f,{contentType:DOC_TYPES[ext],cacheControl:'public, max-age=31536000, immutable'});
      added.push({u:await ref.getDownloadURL(),name:f.name,size:f.size,typ:'file',t:Date.now()});
    }catch(e){ notify(`Fehler bei „${f.name}": `+(e.message||e.code)); }
  }
  if(!added.length) return;
  await db.collection('projects').doc(currentProjectId).collection('trees').doc(treeId)
    .set({dokumente:firebase.firestore.FieldValue.arrayUnion(...added)},{merge:true});
  tree.dokumente=[...(tree.dokumente||[]),...added];
  notify(`✓ ${added.length} Dokument(e) hinzugefügt`);
  refreshMediaViews(treeId);
}
async function docAddLink(treeId){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const tree=trees.find(t=>t.id===treeId); if(!tree) return;
  const url=(prompt('Web-Adresse des Dokuments (https://…):')||'').trim();
  if(!url) return;
  if(!/^https:\/\/.+/i.test(url)){ notify('Bitte eine vollständige https://-Adresse angeben'); return; }
  const name=(prompt('Bezeichnung des Dokuments:','')||'').trim()||url.replace(/^https:\/\//i,'').slice(0,60);
  const entry={u:url,name,typ:'link',t:Date.now()};
  try{
    await db.collection('projects').doc(currentProjectId).collection('trees').doc(treeId)
      .set({dokumente:firebase.firestore.FieldValue.arrayUnion(entry)},{merge:true});
    tree.dokumente=[...(tree.dokumente||[]),entry];
    notify('✓ Link hinzugefügt');
    refreshMediaViews(treeId);
  }catch(e){ notify('Fehler: '+(e.message||e.code)); }
}
// Reiter „Objekt | Verlauf" im Bearbeiten-Formular (Verlauf wie im Detail-Panel)
function switchModalTab(t){
  const form=document.getElementById('modal-body-form'), verlauf=document.getElementById('modal-verlauf');
  const tf=document.getElementById('mtab-form'), tv=document.getElementById('mtab-verlauf');
  const on=el=>{ el.style.borderBottom='2px solid var(--green)'; el.style.color='var(--text)'; el.style.fontWeight='600'; };
  const off=el=>{ el.style.borderBottom='2px solid transparent'; el.style.color='var(--text3)'; el.style.fontWeight='400'; };
  if(t==='verlauf'){
    form.style.display='none'; verlauf.style.display='';
    off(tf); on(tv);
    renderVerlaufDesktop(editingTreeId, verlauf);
  } else {
    form.style.display=''; verlauf.style.display='none';
    on(tf); off(tv);
  }
}

// Fotos & Dokumente im Bearbeiten-Formular („Objekt bearbeiten") — gleiche Funktionen wie im Detail-Panel
function renderModalMedia(treeId){
  const el=document.getElementById('modal-media'); if(!el) return;
  const tree=treeId?trees.find(t=>t.id===treeId):null;
  if(!tree){ el.style.display='none'; el.innerHTML=''; return; }
  el.style.display='';
  const fotos=tree.fotos||[], docs=tree.dokumente||[];
  el.innerHTML=`
    <div class="form-section">Fotos${fotos.length?` (${fotos.length})`:''}</div>
    ${fotos.length
      ?`<div style="display:flex;gap:8px;flex-wrap:wrap;padding:2px 0 6px;">${fotos.map((f,i)=>`<img src="${f.u}" loading="lazy" onclick="openFoto('${dlEsc(treeId)}',${i})" title="Foto ansehen" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;">`).join('')}</div>`
      :'<div style="font-size:11px;color:var(--text3);padding:2px 0 6px;">Keine Fotos vorhanden (Aufnahme über die Erfassungs-App).</div>'}
    <div class="form-section">Dokumente${docs.length?` (${docs.length})`:''}</div>
    <div style="display:flex;flex-direction:column;gap:5px;padding:2px 0 4px;">
      ${docs.map((d,i)=>`<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:7px 10px;">
        <span style="flex-shrink:0;">${d.typ==='link'?'🔗':docIcon(d.name)}</span>
        <a href="${dlEsc(d.u)}" target="_blank" rel="noopener" title="${dlEsc(d.name||'')}" style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(d.name||'Dokument')}</a>
        ${d.size?`<span style="font-size:10px;color:var(--text3);flex-shrink:0;">${fmtBytes(d.size)}</span>`:''}
        ${isReadonly()?'':`<button type="button" onclick="docDelete('${dlEsc(treeId)}',${i})" title="Entfernen" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:15px;line-height:1;padding:0 2px;flex-shrink:0;">×</button>`}
      </div>`).join('')}
      ${isReadonly()?(docs.length?'':'<div style="font-size:11px;color:var(--text3);">Keine Dokumente.</div>'):`<div style="display:flex;gap:6px;">
        <button type="button" class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docUploadStart('${dlEsc(treeId)}')">📎 Datei hochladen</button>
        <button type="button" class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docAddLink('${dlEsc(treeId)}')">🔗 Link hinzufügen</button>
      </div>`}
    </div>`;
}
// Nach Medien-Änderungen offene Ansichten aktualisieren (Detail-Panel + Bearbeiten-Formular)
function refreshMediaViews(treeId){
  if(selectedTreeId===treeId) openDetail(treeId);
  if(editingTreeId===treeId) renderModalMedia(treeId);
}

async function docDelete(treeId,idx){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const tree=trees.find(t=>t.id===treeId); const d=tree?.dokumente?.[idx]; if(!d) return;
  if(!confirm(`„${d.name||'Dokument'}" entfernen?${d.typ==='link'?'':' Die Datei wird endgültig gelöscht.'}`)) return;
  try{
    if(d.typ!=='link'){ try{ await storage.refFromURL(d.u).delete(); }catch(e){ if(e.code!=='storage/object-not-found') throw e; } }
    await db.collection('projects').doc(currentProjectId).collection('trees').doc(treeId)
      .set({dokumente:firebase.firestore.FieldValue.arrayRemove(d)},{merge:true});
    tree.dokumente=tree.dokumente.filter((_,i)=>i!==idx);
    notify('✓ Entfernt');
    refreshMediaViews(treeId);
  }catch(e){ notify('Fehler: '+(e.message||e.code)); }
}

async function saveInlineFields(id){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const wasser=document.getElementById('inline-wasser')?.value;
  const zustand=document.getElementById('inline-zustand')?.value;
  // Touren aus Checkbox-Auswahl lesen
  const rows=document.querySelectorAll('#inline-tour-chips [data-tourid]');
  const selectedTourIds=[...rows].filter(r=>r.querySelector('input[type=checkbox]')?.checked).map(r=>r.dataset.tourid);
  const updates={};
  if(wasser)updates.wasser=wasser;
  if(zustand)updates.zustand=zustand;
  updates.tourIds=selectedTourIds;
  updates.tourId=selectedTourIds[0]||''; // Compat
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',id),updates);
    routeCache={};
    notify('Gespeichert');
    openDetail(id);
  }catch(e){notify('Fehler: '+e.message);}
}

async function logWatering(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  const date=document.getElementById('water-date').value;
  const history=[...(tree.history||[]),{date,note:'Bewässerung'}];
  await updateDoc(doc(db,'projects',currentProjectId,'trees',id),{datum:date,history});
  notify('Bewässerung erfasst');
}

// ─── TREE CRUD ────────────────────────────────────────────────
function fillTourSelect(sel){
  document.getElementById('f-tour').innerHTML='<option value="">– Keine Tour –</option>'+
    tours.map(t=>`<option value="${t.id}"${t.id===sel?' selected':''}>${t.name}</option>`).join('');
}

function openAddTree(lat,lng){
  editingTreeId=null;
  document.getElementById('modal-tree-title').textContent='Objekt hinzufügen';
  renderModalMedia(null); // Medien erst nach dem Anlegen (kein Objekt vorhanden)
  const tabs=document.getElementById('modal-tree-tabs'); if(tabs) tabs.style.display='none'; // kein Verlauf bei Neuanlage
  switchModalTab('form');
  ['f-name','f-baumnr','f-notiz'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  fillArtSelect('');
  fillListSelect('stadtteil','');
  fillListSelect('pflanzjahr','');
  fillListSelect('pflanzzeitpunkt','');
  renderCustomFieldInputs(null);
  fillRankSelect('wasser', rankEntry('wasser','mittel')?'mittel':(rankList('wasser')[0]?.id||''));
  fillRankSelect('zustand', rankEntry('zustand','mittel')?'mittel':(rankList('zustand')[0]?.id||''));
  document.getElementById('f-datum').value='';
  document.getElementById('f-lat').value=lat?lat.toFixed(6):'';
  document.getElementById('f-lng').value=lng?lng.toFixed(6):'';
  const info=document.getElementById('modal-coord-info');
  if(lat&&lng){info.textContent=`📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;info.style.display='block';}
  else info.style.display='none';
  fillTourSelect(activeTourOnMap||'');
  const danger=document.getElementById('tree-danger'); if(danger) danger.style.display='none';
  document.getElementById('tree-modal').classList.add('open');
}

// Typ/Art-Dropdown aus der projekteigenen Arten-Liste füllen (keine Freitexteingabe)
async function fillArtSelect(current){
  const sel=document.getElementById('f-art'); if(!sel) return;
  if(artenList.length===0) await loadArten();
  let names=[...new Set(artenList.map(a=>a.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  current=(current||'').trim();
  if(current && !names.includes(current)) names.unshift(current); // bestehenden Wert nicht verlieren
  sel.innerHTML=`<option value="">— bitte wählen —</option>`+names.map(n=>`<option value="${dlEsc(n)}"${n===current?' selected':''}>${dlEsc(n)}</option>`).join('');
  sel.value=current||'';
}

// Generisches Listen-Dropdown aus listValues füllen (bestehenden Wert nie verlieren)
function _listOptions(fieldKey,current){
  let labels=[...new Set((listValues[fieldKey]||[]).map(e=>e.label).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  current=(current||'').trim();
  if(current && !labels.includes(current)) labels.unshift(current);
  return `<option value="">— bitte wählen —</option>`+labels.map(n=>`<option value="${dlEsc(n)}"${n===current?' selected':''}>${dlEsc(n)}</option>`).join('');
}
function fillListSelect(fieldKey,current){
  const sel=document.getElementById('f-'+fieldKey); if(!sel) return;
  sel.innerHTML=_listOptions(fieldKey,current);
  sel.value=(current||'').trim();
}
// Kundenfelder dynamisch ins Formular rendern (je Feld ein Dropdown)
function renderCustomFieldInputs(tree){
  const wrap=document.getElementById('f-custom-fields'); if(!wrap) return;
  wrap.innerHTML=customFields.map(c=>{
    const cur=((tree?tree[c.key]:'')||'');
    return `<div class="form-group"><label class="form-label">${dlEsc(c.label)}</label><select class="form-control" id="f-${c.key}">${_listOptions(c.key,cur)}</select></div>`;
  }).join('');
}

async function openEditTree(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  editingTreeId=id;
  document.getElementById('modal-tree-title').textContent='Objekt bearbeiten';
  renderModalMedia(id); // Fotos ansehen + Dokumente öffnen/hinterlegen direkt im Formular
  const tabs=document.getElementById('modal-tree-tabs'); if(tabs) tabs.style.display='flex';
  switchModalTab('form');
  document.getElementById('f-name').value=tree.name||'';
  fillListSelect('stadtteil',tree.stadtteil||'');
  document.getElementById('f-baumnr').value=tree.baumnr||'';
  fillArtSelect(tree.art||'');
  fillListSelect('pflanzjahr',tree.pflanzjahr||'');
  fillListSelect('pflanzzeitpunkt',tree.pflanzzeitpunkt||'');
  renderCustomFieldInputs(tree);
  document.getElementById('f-lat').value=tree.lat||'';
  document.getElementById('f-lng').value=tree.lng||'';
  fillRankSelect('wasser', tree.wasser||'');
  fillRankSelect('zustand', tree.zustand||'');
  document.getElementById('f-datum').value=tree.datum||'';
  document.getElementById('f-notiz').value=tree.notiz||'';
  document.getElementById('modal-coord-info').style.display='none';
  fillTourSelect(tree.tourId||'');
  // Gefahrenzone (Archiv/Löschen) einblenden
  const danger=document.getElementById('tree-danger');
  const archBtn=document.getElementById('btn-tree-archive');
  if(danger) danger.style.display='flex';
  if(!isActive(tree)){
    document.getElementById('modal-tree-title').textContent='Objekt bearbeiten (inaktiv)';
    if(archBtn){ archBtn.textContent='Reaktivieren'; archBtn.onclick=reactivateTreeFromModal; }
  } else {
    if(archBtn){ archBtn.textContent='Inaktiv setzen'; archBtn.onclick=archiveTreeFromModal; }
  }
  document.getElementById('tree-modal').classList.add('open');
}
function closeTreeModal(){ document.getElementById('tree-modal').classList.remove('open');editingTreeId=null;
  const danger=document.getElementById('tree-danger'); if(danger) danger.style.display='none'; }

async function saveTree(){
  const name=document.getElementById('f-name').value.trim();
  if(!name){alert('Bitte einen Namen eingeben.');return;}
  setSyncState('syncing','Speichert…');
  const artVal=(document.getElementById('f-art').value||'').trim();
  const artIdVal=artenList.find(a=>a.name===artVal)?.id||null;
  const data={
    name,
    stadtteil:document.getElementById('f-stadtteil').value,
    baumnr:document.getElementById('f-baumnr').value,
    art:artVal,
    artId:artIdVal,
    pflanzjahr:document.getElementById('f-pflanzjahr').value,
    pflanzzeitpunkt:document.getElementById('f-pflanzzeitpunkt').value,
    lat:parseFloat(document.getElementById('f-lat').value)||null,
    lng:parseFloat(document.getElementById('f-lng').value)||null,
    wasser:document.getElementById('f-wasser').value,
    zustand:document.getElementById('f-zustand').value,
    datum:document.getElementById('f-datum').value,
    tourId:document.getElementById('f-tour').value,
    tourIds:document.getElementById('f-tour').value?[document.getElementById('f-tour').value]:[],
    notiz:document.getElementById('f-notiz').value,
  };
  customFields.forEach(c=>{ const el=document.getElementById('f-'+c.key); data[c.key]=el?el.value:''; });
  try{
    if(editingTreeId){
      await updateDoc(doc(db,'projects',currentProjectId,'trees',editingTreeId),data);
      notify('Baum aktualisiert');
    } else {
      const baumId=await getNextBaumId();
      await addDoc(collection(db,'projects',currentProjectId,'trees'),{
        ...data,
        baumId, // eindeutige fortlaufende ID z.B. B-00042
        history:[],
        createdAt:serverTimestamp()
      });
      notify('Baum hinzugefügt');
    }
    routeCache={};closeTreeModal();
  }catch(e){ notify('Fehler: '+e.message); }
}

// Objekt-ID aus allen Routen-Reihenfolgen entfernen (sonst tote Referenzen)
async function removeTreeFromRoutes(treeId){
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'routes'));
    for(const d of snap.docs){
      const data=d.data()||{};
      if(Array.isArray(data.orderIds)&&data.orderIds.includes(treeId)){
        await updateDoc(doc(db,'projects',currentProjectId,'routes',d.id),
          {orderIds:data.orderIds.filter(x=>x!==treeId)});
      }
    }
  }catch(e){ console.warn('removeTreeFromRoutes:',e); }
  routeCache={};
}

// Hat der Baum eine Bewässerungs-Historie (eigene history[] oder tourHistory-Treffer)?
async function treeHasHistory(tree){
  if((tree.history||[]).length>0) return true;
  if(tree.lastStatus && tree.lastStatus!=='offen') return true;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
    return snap.docs.some(d=>(d.data().trees||[]).some(x=>x.id===tree.id));
  }catch(e){ console.warn('treeHasHistory:',e); return true; } // im Zweifel schützen
}

async function archiveTree(id){
  const tree=trees.find(t=>t.id===id); if(!tree) return;
  const tourCnt=getTreeTourIds(tree).length;
  if(!confirm(`„${tree.name||'Baum'}" als INAKTIV markieren?\n\n`+
    `• Wird aus Karte, Tourplanung und „offen"-Zahlen ausgeblendet`+
    (tourCnt?`\n• Wird aus ${tourCnt} Tour(en) entfernt`:'')+
    `\n• Historie bleibt erhalten, jederzeit reaktivierbar`)) return;
  setSyncState('syncing','Speichert…');
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',id),
      {aktiv:false, archiviertAm:serverTimestamp(), tourIds:[], tourId:''});
    await removeTreeFromRoutes(id);
    notify('Baum inaktiv gesetzt');
  }catch(e){ notify('Fehler: '+e.message); }
}

async function reactivateTree(id){
  if(!trees.find(t=>t.id===id)) return;
  setSyncState('syncing','Speichert…');
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',id),{aktiv:true});
    notify('Baum reaktiviert — bei Bedarf wieder einer Tour zuweisen');
  }catch(e){ notify('Fehler: '+e.message); }
}

async function deleteTree(id){
  const tree=trees.find(t=>t.id===id);
  if(!tree){ await deleteDoc(doc(db,'projects',currentProjectId,'trees',id)); closePanel(); return; }
  // Schutz: Objekte mit Historie nicht endgültig löschen → Archiv anbieten
  if(await treeHasHistory(tree)){
    if(confirm(`„${tree.name||'Baum'}" hat eine Bewässerungs-Historie und kann nicht endgültig `+
      `gelöscht werden (Historie/Controlling würde verfälscht).\n\nStattdessen als INAKTIV archivieren?`)){
      await archiveTree(id);
    }
    return;
  }
  const tourCnt=getTreeTourIds(tree).length;
  if(!confirm(`„${tree.name||'Baum'}" ENDGÜLTIG löschen?\n\n`+
    (tourCnt?`• Wird aus ${tourCnt} Tour(en) entfernt\n`:'')+
    `• Kann nicht rückgängig gemacht werden`)) return;
  setSyncState('syncing','Löscht…');
  try{
    await removeTreeFromRoutes(id);
    await deleteDoc(doc(db,'projects',currentProjectId,'trees',id));
    closePanel(); closeTreeModal(); notify('Baum gelöscht');
  }catch(e){ notify('Fehler: '+e.message); }
}

// Modal-Wrapper (nutzen editingTreeId)
function showTreeOnMapFromModal(){ const id=editingTreeId; closeTreeModal(); if(id) selectTree(id); }
function archiveTreeFromModal(){ const id=editingTreeId; closeTreeModal(); if(id) archiveTree(id); }
function reactivateTreeFromModal(){ const id=editingTreeId; closeTreeModal(); if(id) reactivateTree(id); }
function deleteTreeFromModal(){ if(editingTreeId) deleteTree(editingTreeId); }

// ─── PLACEMENT & ASSIGN ───────────────────────────────────────
function startPlacement(){
  if(currentView!=='karte'){switchView('karte');setTimeout(startPlacement,80);return;}
  placingTree=true;placingDepot=false;
  map.getContainer().style.cursor='crosshair';
  document.getElementById('mode-text').textContent='Auf Karte klicken zum Platzieren';
  document.getElementById('mode-banner').classList.add('visible');
}

let _gpsPlacingTreeId = null;
function startGpsPlacement(treeId){
  _gpsPlacingTreeId = treeId;
  if(currentView!=='karte'){switchView('karte');setTimeout(()=>startGpsPlacement(treeId),80);return;}
  const tree = trees.find(t=>t.id===treeId);
  placingTree=false;placingDepot=false;
  map.getContainer().style.cursor='crosshair';
  document.getElementById('mode-text').textContent=`Position für „${tree?.name||'Baum'}" klicken`;
  document.getElementById('mode-banner').classList.add('visible');
  // Einmaliger Klick-Handler für GPS-Platzierung
  map.once('click', async e=>{
    cancelMode();
    const lat=parseFloat(e.latlng.lat.toFixed(7));
    const lng=parseFloat(e.latlng.lng.toFixed(7));
    await updateDoc(doc(db,'projects',currentProjectId,'trees',treeId),{lat,lng});
    notify(`✓ Koordinaten gesetzt: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
    _gpsPlacingTreeId=null;
  });
}
function setDepotOnMap(){
  closeSettings();placingDepot=true;placingTree=false;
  map.getContainer().style.cursor='crosshair';
  document.getElementById('mode-text').textContent='Betriebshof-Standort auf Karte klicken';
  document.getElementById('mode-banner').classList.add('visible');
}
function cancelMode(){
  placingTree=false;placingDepot=false;
  map.getContainer().style.cursor='';
  document.getElementById('mode-banner').classList.remove('visible');
}

// ─── OBJEKT VERSCHIEBEN (sensibel: zweistufig — Position wählen, dann bestätigen) ──
let _moveState=null;
function startMoveObject(treeId){
  if(currentView!=='karte'){ switchView('karte'); setTimeout(()=>startMoveObject(treeId),80); return; }
  const tree=trees.find(t=>t.id===treeId);
  if(!tree||!tree.lat||!tree.lng){ notify('Objekt hat noch keine Position'); return; }
  if(_moveState) _cleanupMove();
  closePanel();
  const old=[tree.lat,tree.lng];
  if(mapMarkers[treeId]) _mDel(mapMarkers[treeId]); // echten Marker während des Verschiebens ausblenden
  const tour=primaryTour(tree); const color=tour?tour.color:'#6b6760';
  const sz=Math.round(markerSize*1.25);
  const ic=L.divIcon({className:'',html:`<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 3px ${color},0 4px 12px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:${Math.round(sz*0.5)}px;cursor:move;">${objIcon(tree)}</div>`,iconSize:[sz,sz],iconAnchor:[sz/2,sz/2]});
  const ghost=L.circleMarker(old,{radius:9,color:'#6b6760',fillColor:'#6b6760',fillOpacity:.3,weight:2,opacity:.5,interactive:false}).addTo(map);
  const preview=L.marker(old,{draggable:true,zIndexOffset:1500,icon:ic}).addTo(map);
  _moveState={treeId,old,name:tree.name||'Objekt',ghost,preview,line:null,cur:old};
  preview.on('drag',()=>_setMovePreview(preview.getLatLng(),true));
  preview.on('dragend',()=>_setMovePreview(preview.getLatLng()));
  map.on('click',_moveMapClick);
  map.getContainer().style.cursor='crosshair';
  renderMoveBar();
}
function _moveMapClick(e){ if(!_moveState) return; _moveState.preview.setLatLng(e.latlng); _setMovePreview(e.latlng); }
function _setMovePreview(latlng,dragging){
  if(!_moveState) return;
  _moveState.cur=[latlng.lat,latlng.lng];
  const pts=[_moveState.old,_moveState.cur];
  if(_moveState.line) _moveState.line.setLatLngs(pts);
  else _moveState.line=L.polyline(pts,{color:'#374151',weight:2,dashArray:'5 4',opacity:.7,interactive:false}).addTo(map);
  if(!dragging) renderMoveBar();
}
function renderMoveBar(){
  const bar=document.getElementById('move-bar'); if(!bar||!_moveState) return;
  const moved=_moveState.cur[0]!==_moveState.old[0]||_moveState.cur[1]!==_moveState.old[1];
  if(!moved){
    bar.innerHTML=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/></svg>
      <span>Neue Position für „${dlEsc(_moveState.name)}" — auf die Karte klicken oder Marker ziehen</span>
      <button onclick="cancelMoveObject()" style="padding:3px 11px;font-size:12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;border-radius:6px;cursor:pointer;font-family:inherit;">Abbrechen</button>`;
  } else {
    const d=map.distance(_moveState.old,_moveState.cur);
    const dTxt=d<1000?Math.round(d)+' m':(d/1000).toFixed(2)+' km';
    bar.innerHTML=`<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 3 3 21M21 3v6M21 3h-6"/></svg>
      <span>Verschoben um <b style="font-weight:700;">${dTxt}</b></span>
      <button onclick="saveMoveObject()" style="padding:4px 13px;font-size:12px;font-weight:600;border:none;background:var(--green-mid);color:#fff;border-radius:6px;cursor:pointer;font-family:inherit;">Speichern</button>
      <button onclick="cancelMoveObject()" style="padding:4px 11px;font-size:12px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;border-radius:6px;cursor:pointer;font-family:inherit;">Abbrechen</button>`;
  }
  bar.style.display='flex';
}
async function saveMoveObject(){
  if(!_moveState) return;
  const {treeId,cur,old}=_moveState;
  if(cur[0]===old[0]&&cur[1]===old[1]){ cancelMoveObject(); return; }
  const lat=parseFloat(cur[0].toFixed(7)), lng=parseFloat(cur[1].toFixed(7));
  const tree=trees.find(t=>t.id===treeId); if(tree){ tree.lat=lat; tree.lng=lng; } // sofort lokal, damit der Marker direkt richtig sitzt
  _cleanupMove();
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',treeId),{lat,lng});
    notify(`✓ Standort verschoben: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }catch(e){ console.warn('Verschieben',e); notify('Fehler beim Speichern: '+(e.message||e)); }
  // Dispo-Füllstandsplanung (Echtmodus) sofort mitziehen, damit Position identisch bleibt
  if(dispoMap){ const _b=dispoGetBins(); if(_dispoSyncReal(_b)){ dispoSetBins(_b); dispoRenderMap(); } }
}
function cancelMoveObject(){ if(!_moveState) return; _cleanupMove(); notify('Verschieben abgebrochen'); }
function _cleanupMove(){
  if(!_moveState) return;
  const {treeId,ghost,preview,line}=_moveState;
  [ghost,preview,line].forEach(l=>{ if(l) map.removeLayer(l); });
  map.off('click',_moveMapClick);
  map.getContainer().style.cursor='';
  const bar=document.getElementById('move-bar'); if(bar) bar.style.display='none';
  _moveState=null;
  remakeMarkers([treeId]); // echten Marker wiederherstellen (an alter bzw. bereits aktualisierter Position)
}
function canEditObjects(){ return currentCap==='admin'||currentCap==='editor'||currentRole==='superadmin'; }

// ─── ADRESS-/STRASSENSUCHE auf der Karte ──────────────────────
// GEKAPSELT: nutzt aktuell den OpenStreetMap-Dienst Nominatim (kostenfrei, nur Einzelsuchen
// bei Enter — policy-konform). Soll eine Kommune später den amtlichen BKG-Geokodierungsdienst
// nutzen, wird NUR diese eine Funktion umgestellt — die Oberfläche bleibt gleich.
let _searchMarker=null, _searching=false;
async function _nomFetch(url){
  const res=await fetch(url,{headers:{'Accept-Language':'de'}});
  if(!res.ok) throw new Error('Suchdienst nicht erreichbar ('+res.status+')');
  return res.json();
}
async function geocodeSearch(query, m){
  m=m||map;
  const b=m.getBounds();
  const vb=`${b.getWest().toFixed(5)},${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)},${b.getSouth().toFixed(5)}`;
  const base=`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=de&limit=8`;
  // 1) Strikt im aktuellen Kartenausschnitt (bounded) → lokale Treffer, auch kleine Orte
  let rs=await _nomFetch(`${base}&bounded=1&viewbox=${encodeURIComponent(vb)}&q=${encodeURIComponent(query)}`);
  // 2) Falls nichts im Ausschnitt: deutschlandweit, mit Ausschnitt als Vorrang (Fallback)
  if(!rs.length) rs=await _nomFetch(`${base}&viewbox=${encodeURIComponent(vb)}&q=${encodeURIComponent(query)}`);
  return rs;
}
async function doMapSearch(){
  const inp=document.getElementById('map-search-input'); const q=(inp?.value||'').trim();
  const box=document.getElementById('map-search-results'); if(!box) return;
  if(q.length<3){ box.style.display='none'; return; }
  if(_searching) return; _searching=true;
  box.innerHTML='<div class="ms-empty">Suche…</div>'; box.style.display='block';
  try{
    const rs=await geocodeSearch(q);
    // Treffer nach Nähe zum aktuellen Kartenausschnitt sortieren → lokaler Treffer zuerst,
    // ferne (gleichnamige) Straßen bleiben als Fallback in der Liste.
    try{ const c=map.getCenter(); rs.sort((a,b)=>map.distance(c,[+a.lat,+a.lon])-map.distance(c,[+b.lat,+b.lon])); }catch(_){}
    if(!rs.length){ box.innerHTML=`<div class="ms-empty">Keine Treffer für „${dlEsc(q)}"</div>`; }
    else{
      box.innerHTML=rs.map((r,i)=>{
        const a=r.address||{};
        const main=[a.road,a.house_number].filter(Boolean).join(' ') || (r.display_name||'').split(',')[0];
        const sub=[a.postcode,(a.city||a.town||a.village||a.municipality||a.county)].filter(Boolean).join(' ') || (r.display_name||'').split(',').slice(1,3).join(',').trim();
        return `<div class="ms-item" data-idx="${i}"><div class="ms-main">${dlEsc(main)}</div><div class="ms-sub">${dlEsc(sub)}</div></div>`;
      }).join('')+`<div class="ms-foot">Adressdaten © OpenStreetMap-Mitwirkende (ODbL)</div>`;
      box._results=rs;
    }
  }catch(e){ console.warn('Adresssuche',e); box.innerHTML='<div class="ms-empty">Suche momentan nicht verfügbar</div>'; }
  finally{ _searching=false; }
}
function gotoSearchResult(r){
  const lat=parseFloat(r.lat), lng=parseFloat(r.lon); if(isNaN(lat)||isNaN(lng)) return;
  map.setView([lat,lng], 18);
  if(_searchMarker) map.removeLayer(_searchMarker);
  _searchMarker=L.marker([lat,lng],{zIndexOffset:2000,icon:L.divIcon({className:'',html:`<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:var(--blue);border:2.5px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 7px rgba(0,0,0,.45);"></div>`,iconSize:[24,24],iconAnchor:[12,24]})}).addTo(map);
  document.getElementById('map-search-results').style.display='none';
  document.getElementById('map-search')?.classList.add('collapsed');
}
function clearMapSearch(){
  const inp=document.getElementById('map-search-input'); if(inp) inp.value='';
  const box=document.getElementById('map-search-results'); if(box) box.style.display='none';
  const cl=document.getElementById('map-search-clear'); if(cl) cl.style.display='none';
  if(_searchMarker){ map.removeLayer(_searchMarker); _searchMarker=null; }
}


let _lassoActive = false;
function toggleLassoMode() {
  _lassoActive = !_lassoActive;
  const btn = document.getElementById('lasso-toggle-btn');
  const canvas = document.getElementById('lasso-canvas');
  if(_lassoActive) {
    // Canvas ist ein replaced element — CSS left/right/bottom strecken es NICHT, daher
    // explizit auf Kartengröße setzen (auch Schutz gegen zwischenzeitliches Fenster-Resize)
    const mc = map.getContainer();
    canvas.width = mc.offsetWidth; canvas.height = mc.offsetHeight;
    canvas.style.pointerEvents = 'all';
    map.getContainer().style.cursor = 'crosshair';
    if(btn) { btn.style.background = 'rgba(255,255,255,.35)'; btn.style.borderColor = '#fff'; }
  } else {
    canvas.style.pointerEvents = 'none';
    map.getContainer().style.cursor = '';
    if(btn) { btn.style.background = 'rgba(255,255,255,.1)'; btn.style.borderColor = 'rgba(255,255,255,.4)'; }
    if(lassoCtx) lassoCtx.clearRect(0,0,canvas.width,canvas.height);
    lassoPoints=[];lassoDrawing=false;
  }
}

function startAssignMode(){
  if(!currentProjectId){notify('Bitte zuerst ein Projekt öffnen');return;}
  if(tours.length===0){notify('Bitte zuerst eine Tour anlegen');return;}
  showOverviewInAssign=false;
  const startTour=(tours.find(t=>!t.uebersicht)||tours[0]).id; // bevorzugt erste ECHTE Tour
  assignMode=true;lassoMode=false;assignTourId=startTour;lassoTourId=startTour;
  lassoPoints=[];lassoDrawing=false;
  _lassoActive=false;

  // Setup lasso canvas (hidden until user activates)
  // Canvas ist ein replaced element — CSS streckt es nicht, Größe explizit = Kartengröße
  const canvas=document.getElementById('lasso-canvas');
  const mapEl=document.getElementById('map');
  canvas.width=mapEl.offsetWidth;canvas.height=mapEl.offsetHeight;
  lassoCtx=canvas.getContext('2d');
  canvas.classList.add('active');
  canvas.style.pointerEvents='none';

  // Build unified pills
  rebuildAssignPills();
  document.getElementById('assign-lasso-banner').classList.add('visible');
  map.getContainer().style.cursor='crosshair';
  closePanel();

  // Lasso canvas events
  // Allow map pan when not actively drawing
  canvas.style.pointerEvents='none';
  canvas.onmousedown=e=>{
    if(!_lassoActive)return;
    lassoDrawing=true;lassoPoints=[];
    const r=canvas.getBoundingClientRect();
    lassoPoints.push({x:e.clientX-r.left,y:e.clientY-r.top});
  };
  canvas.onmousemove=e=>{
    if(!lassoDrawing)return;
    const r=canvas.getBoundingClientRect();
    lassoPoints.push({x:e.clientX-r.left,y:e.clientY-r.top});
    drawLasso();
  };
  canvas.onmouseup=e=>{
    if(!lassoDrawing)return;
    lassoDrawing=false;
    canvas.style.pointerEvents='none'; // allow map interaction again
    // If barely moved → treat as click, not lasso
    const dist=lassoPoints.length>1?Math.hypot(
      lassoPoints[lassoPoints.length-1].x-lassoPoints[0].x,
      lassoPoints[lassoPoints.length-1].y-lassoPoints[0].y):0;
    if(dist<5){
      // Single click: find nearest marker — Klickpunkt relativ zur KARTE (nicht zum versetzten Canvas)
      const mr=map.getContainer().getBoundingClientRect();
      const clickPt=map.containerPointToLatLng(L.point(e.clientX-mr.left,e.clientY-mr.top));
      let nearestTree=null,nearestDist=Infinity;
      trees.forEach(tree=>{
        if(!tree.lat||!tree.lng)return;
        const d=map.distance(clickPt,[tree.lat,tree.lng]);
        if(d<nearestDist&&d<80){nearestDist=d;nearestTree=tree;}
      });
      lassoCtx.clearRect(0,0,canvas.width,canvas.height);
      lassoPoints=[];
      if(nearestTree) toggleLassoSelect(nearestTree.id); // Einzelklick toggelt die Vorauswahl
    } else {
      applyLasso();
      // Auto-deactivate after draw so map is pannable again
      _lassoActive=false;
      canvas.style.pointerEvents='none';
      map.getContainer().style.cursor='';
      const _lb=document.getElementById('lasso-toggle-btn');
      if(_lb){_lb.style.background='rgba(255,255,255,.1)';_lb.style.borderColor='rgba(255,255,255,.4)';}
    }
  };
  canvas.ontouchstart=e=>{
    lassoDrawing=true;lassoPoints=[];
    canvas.style.pointerEvents='all';
    const r=canvas.getBoundingClientRect(),t=e.touches[0];
    lassoPoints.push({x:t.clientX-r.left,y:t.clientY-r.top});
  };
  canvas.ontouchmove=e=>{e.preventDefault();if(!lassoDrawing)return;const r=canvas.getBoundingClientRect(),t=e.touches[0];lassoPoints.push({x:t.clientX-r.left,y:t.clientY-r.top});drawLasso();};
  canvas.ontouchend=e=>{
    if(!lassoDrawing)return;
    lassoDrawing=false;
    canvas.style.pointerEvents='none';
    applyLasso();
  };
}

function rebuildAssignPills(){
  const sel = document.getElementById('assign-tour-select');
  if(!sel) return;
  const echte=tours.filter(t=>!t.uebersicht);
  const ueb=tours.filter(t=>t.uebersicht);
  const opt=t=>`<option value="${t.id}" style="color:#111;background:#fff;">${dlEsc(t.name)}</option>`;
  let html=echte.map(opt).join('');
  // Übersichtstouren nur nach Bedarf (eigene Gruppe), per Umschalt-Eintrag ein-/ausblendbar
  if(showOverviewInAssign && ueb.length) html+=`<optgroup label="Übersichtstouren" style="color:#111;">${ueb.map(opt).join('')}</optgroup>`;
  if(ueb.length) html+=`<option value="__toggle_overview__" style="color:#2d6a4f;background:#fff;">${showOverviewInAssign?'− Übersichtstouren ausblenden':'+ Übersichtstouren einblenden…'}</option>`;
  sel.innerHTML=html;
  // Gültige Auswahl sicherstellen (keine ausgeblendete Übersichtstour aktiv lassen)
  const valid=tours.some(t=>t.id===assignTourId) && (showOverviewInAssign || !isOverviewTour(assignTourId));
  if(!valid) assignTourId=(echte[0]||ueb[0])?.id||null;
  lassoTourId=assignTourId;
  if(assignTourId) sel.value=assignTourId;
  updateAssignSwatch();
}

function setAssignTour(id){
  if(id==='__toggle_overview__'){ // Umschalt-Eintrag: Übersichtstouren ein-/ausblenden, Auswahl behalten
    showOverviewInAssign=!showOverviewInAssign;
    rebuildAssignPills(); renderLassoActions();
    return;
  }
  assignTourId=id;lassoTourId=id;
  const sel=document.getElementById('assign-tour-select');
  if(sel) sel.value=id;
  updateAssignSwatch();
  renderLassoActions(); // Ziel-Tour-Name in den Aktions-Buttons aktualisieren
}

function updateAssignSwatch(){
  const tour=tours.find(t=>t.id===assignTourId);
  const sw=document.getElementById('assign-tour-swatch');
  if(sw&&tour) sw.style.background=tour.color||'#888';
}

function cancelAssign(){
  _lassoActive=false;
  assignMode=false;lassoMode=false;lassoDrawing=false;lassoPoints=[];
  assignTourId=null;lassoTourId=null;
  // Vorauswahl verwerfen + Auswahl-Ringe entfernen
  if(lassoSelection.size){ const ids=[...lassoSelection]; lassoSelection.clear(); remakeMarkers(ids); }
  document.getElementById('lasso-action-bar')?.classList.remove('visible');
  const canvas=document.getElementById('lasso-canvas');
  if(lassoCtx)lassoCtx.clearRect(0,0,canvas.width,canvas.height);
  canvas.classList.remove('active');
  canvas.onmousedown=null;canvas.onmousemove=null;canvas.onmouseup=null;
  canvas.ontouchstart=null;canvas.ontouchmove=null;canvas.ontouchend=null;
  document.getElementById('assign-lasso-banner').classList.remove('visible');
  map.getContainer().style.cursor='';
}

// Hinweisdialog, wenn ein Baum bereits anderen Touren zugeordnet ist.
// Liefert: 'move' (aus bisherigen entfernen) | 'add' (zusätzlich) | 'cancel'
function showTourConflictDialog(tree, currentTour, otherTourIds){
  return new Promise(resolve=>{
    const otherNames=otherTourIds.map(id=>tours.find(t=>t.id===id)?.name||'Tour');
    const namesStr=otherNames.map(n=>`„${n}"`).join(', ');
    const curName=currentTour?.name||'aktuelle Tour';
    const plural=otherNames.length>1;
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;';
    const done=v=>{ modal.remove(); resolve(v); };
    const opt=(id,title,desc,color)=>`<button id="${id}" style="display:block;width:100%;text-align:left;padding:11px 13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;font-family:inherit;transition:background .12s;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='var(--surface)'">
      <div style="font-size:13px;font-weight:600;color:${color};">${title}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">${desc}</div></button>`;
    modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:460px;max-width:92vw;overflow:hidden;">
      <div style="padding:18px 20px 12px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;color:var(--amber);">⚠ Objekt bereits verplant</div>
      <div style="padding:16px 20px;font-size:13px;color:var(--text2);line-height:1.6;">
        Das ausgewählte Objekt <b style="color:var(--text);">${tree.name||''}</b> ist bereits ${plural?'den Touren':'der Tour'} ${namesStr} zugeordnet.<br><br>
        Möchten Sie das Objekt in die Tour <b style="color:var(--text);">„${curName}"</b> übernehmen?
      </div>
      <div style="padding:0 20px 18px;display:flex;flex-direction:column;gap:8px;">
        ${opt('tc-move','Übernehmen und aus bisheriger Tour entfernen',`Wird „${curName}" zugeordnet und aus ${namesStr} entfernt.`,'var(--green)')}
        ${opt('tc-add','Zusätzlich zur aktuellen Tour zuordnen',`Bleibt in ${namesStr} und wird zusätzlich „${curName}" zugeordnet.`,'var(--text)')}
        ${opt('tc-cancel','Abbrechen','Es werden keine Änderungen vorgenommen.','var(--text2)')}
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#tc-move').onclick=()=>done('move');
    modal.querySelector('#tc-add').onclick=()=>done('add');
    modal.querySelector('#tc-cancel').onclick=()=>done('cancel');
    modal.addEventListener('click',e=>{ if(e.target===modal) done('cancel'); });
  });
}

async function assignTreeToTour(treeId,tourId,skipConflictCheck=false){
  const tree=trees.find(t=>t.id===treeId);
  const tour=tours.find(t=>t.id===tourId);
  if(!tree)return;

  const currentIds=getTreeTourIds(tree);
  // Bereits in dieser Tour?
  if(currentIds.includes(tourId)){
    notify(`${tree.name} ist bereits in ${tour?.name||'Tour'}`);
    return;
  }
  // Bereits anderen Tour(en) zugeordnet → Hinweisdialog
  const otherIds=currentIds.filter(id=>id!==tourId);
  if(otherIds.length>0 && !skipConflictCheck){
    const choice=await showTourConflictDialog(tree, tour, otherIds);
    if(choice==='cancel') return;
    if(choice==='move'){
      await setTreeTourIds(treeId, [tourId]); // aus bisherigen Touren entfernen
      notify(`${tree.name} → ${tour?.name||'Tour'} (aus bisheriger Tour entfernt)`);
      routeCache={}; rebuildAssignPills();
      return;
    }
    // choice==='add' → additiv (unten)
  }
  const newIds=[...currentIds, tourId];
  await setTreeTourIds(treeId, newIds);
  notify(`${tree.name} → ${tour?.name||'Tour'} hinzugefügt`);
  routeCache={};
  rebuildAssignPills();
}

// ─── TOUR CRUD ────────────────────────────────────────────────
function buildColorSwatches(sel){
  document.getElementById('color-swatches').innerHTML=TOUR_COLORS.map(c=>
    `<div class="color-swatch${c===sel?' selected':''}" style="background:${c};" onclick="pickColor('${c}')"></div>`).join('');
  selectedTourColor=sel||TOUR_COLORS[0];
}
function pickColor(c){ selectedTourColor=c;document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('selected',s.style.background===c||s.style.backgroundColor===c)); }

function openTourModal(id){
  editingTourId=id||null;
  if(id){
    const t=tours.find(x=>x.id===id);
    document.getElementById('tour-modal-title').textContent='Tour bearbeiten';
    document.getElementById('t-name').value=t.name;
    document.getElementById('t-desc').value=t.desc||'';
    buildColorSwatches(t.color);
  } else {
    document.getElementById('tour-modal-title').textContent='Neue Tour';
    document.getElementById('t-name').value='';document.getElementById('t-desc').value='';
    const free=TOUR_COLORS.find(c=>!tours.map(t=>t.color).includes(c))||TOUR_COLORS[0];
    buildColorSwatches(free);
  }
  document.getElementById('tour-modal').classList.add('open');
}
function closeTourModal(){ document.getElementById('tour-modal').classList.remove('open');editingTourId=null; }

async function saveTour(){
  const name=document.getElementById('t-name').value.trim();
  if(!name){alert('Bitte einen Namen eingeben.');return;}
  const data={name,desc:document.getElementById('t-desc').value,color:selectedTourColor};
  try{
    if(editingTourId){
      await updateDoc(doc(db,'projects',currentProjectId,'tours',editingTourId),data);
      notify('Tour aktualisiert');
    } else {
      await addDoc(collection(db,'projects',currentProjectId,'tours'),{...data,createdAt:serverTimestamp()});
      await updateDoc(doc(db,'projects',currentProjectId),{tourCount:tours.length+1});
      notify('Tour erstellt');
    }
    routeCache={};closeTourModal();
  }catch(e){ notify('Fehler: '+e.message); }
}

// Übersichtstouren im Touren-Reiter ein-/ausblenden
function toggleOverviewInGrid(){ showOverviewInGrid=!showOverviewInGrid; renderTourenGrid(); }

// Übersichtstour-Markierung umschalten (Inline-Checkbox im Touren-Reiter)
async function toggleTourUebersicht(id,checked){
  const t=tours.find(x=>x.id===id); if(t) t.uebersicht=!!checked; // sofort lokal wirksam
  refreshMarkers(); renderLegend(); if(currentView==='touren') renderTourenGrid();
  try{ await updateDoc(doc(db,'projects',currentProjectId,'tours',id),{uebersicht:!!checked}); }
  catch(e){ console.warn('toggleTourUebersicht',e); notify('Fehler: '+(e.message||e)); }
}

async function deleteTour(id){
  const tour=tours.find(t=>t.id===id);
  const name=tour?.name||'';
  const cnt=trees.filter(t=>treeInTour(t,id)).length;
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:390px;max-width:90vw;overflow:hidden;">
    <div style="padding:18px 20px 10px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;color:var(--red);">⚠ Tour löschen</div>
    <div style="padding:14px 20px 6px;font-size:13px;color:var(--text2);line-height:1.6;">Tour <b style="color:var(--text);">${name}</b> löschen?<br>${cnt?`${cnt} Baum/Objekte werden aus der Tour entfernt (bleiben erhalten).`:'Objekte bleiben erhalten.'}</div>
    <div style="padding:6px 20px 10px;">
      <input id="del-tour-input" class="form-control" placeholder="Tournamen eingeben zur Bestätigung" style="border-color:var(--red-light);" autocomplete="off">
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Gib <b>${name}</b> ein um zu bestätigen</div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="del-cancel" style="padding:7px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button>
      <button id="del-ok" style="padding:7px 16px;border:none;border-radius:6px;background:var(--red);color:#fff;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4;" disabled>Löschen</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const input=modal.querySelector('#del-tour-input');
  const delBtn=modal.querySelector('#del-ok');
  input.oninput=()=>{
    delBtn.disabled=input.value.trim()!==name;
    delBtn.style.opacity=delBtn.disabled?'0.4':'1';
  };
  setTimeout(()=>input.focus(),50);
  const confirmed=await new Promise(resolve=>{
    modal.querySelector('#del-cancel').onclick=()=>{modal.remove();resolve(false);};
    delBtn.onclick=()=>{if(!delBtn.disabled){modal.remove();resolve(true);}};
    input.onkeydown=e=>{if(e.key==='Enter'&&!delBtn.disabled){modal.remove();resolve(true);}};
    modal.onclick=e=>{if(e.target===modal){modal.remove();resolve(false);}};
  });
  if(!confirmed)return;
  for(const tree of trees.filter(t=>treeInTour(t,id))){
    const newIds=getTreeTourIds(tree).filter(tid=>tid!==id);
    await setTreeTourIds(tree.id, newIds);
  }
  await deleteDoc(doc(db,'projects',currentProjectId,'tours',id));
  if(activeTours.has(id)){ activeTours.delete(id); syncActiveTour(); if(!activeTours.size) filterTour='all'; }
  routeCache={};notify('Tour gelöscht');
}

// ─── SETTINGS ─────────────────────────────────────────────────

function getRoutePlanningEnabled(){
  const v = currentProjectData?.routePlanning;          // projektspezifisch
  if(v===true||v===false) return v;
  const ls = localStorage.getItem('bwt_route_planning'); // Fallback (alte globale Einstellung)
  return ls === null ? true : ls === 'true';
}
// Nur-Lesezugriff: keine Planungs-/Speicher-Aktionen
function isReadonly(){ return currentCap==='readonly'; }
// Routen-Berechnen-Buttons deaktivieren, wenn Reihenfolgeplanung aus ist ODER nur Lesezugriff
function rpDisAttr(){ return isReadonly() ? ' disabled title="Nur Lesezugriff"' : (getRoutePlanningEnabled() ? '' : ' disabled title="Reihenfolgeplanung ist deaktiviert"'); }
function rpDisStyle(){ return (isReadonly()||!getRoutePlanningEnabled()) ? 'opacity:.45;cursor:not-allowed;' : ''; }

function toggleRoutePlanning(){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const newVal = !getRoutePlanningEnabled();
  if(currentProjectId) saveProjectSettings({routePlanning:newVal}).catch(()=>{}); // projektspezifisch
  else localStorage.setItem('bwt_route_planning', newVal);
  const btn = document.getElementById('s-toggle-route');
  const knob = document.getElementById('s-toggle-knob');
  const sub = document.getElementById('s-routing-sub');
  if(btn) btn.style.background = newVal ? '#2d6a4f' : '#d1d5db';
  if(knob) knob.style.transform = newVal ? 'translateX(16px)' : 'translateX(0)';
  if(sub){ sub.style.opacity = newVal ? '1' : '0.4'; sub.style.pointerEvents = newVal ? '' : 'none'; }
  // Apply immediately to map
  if(!newVal){
    // Routen-Linien ausblenden
    Object.values(tourRoutes).forEach(r=>{ if(r){ try{ map.removeLayer(r.layer||r); }catch(e){} } });
    Object.keys(tourRoutes).forEach(k=>delete tourRoutes[k]);
    // Reihenfolge-Nummern von Markern entfernen
    tourOrder={};
    rebuildMarkersWithNumbers();
    renderList();
    document.getElementById('route-info-bar')?.classList.remove('visible');
    if(document.getElementById('sidebar-route-info')) document.getElementById('sidebar-route-info').style.display='none';
  } else {
    loadSavedRoutes();
  }
  // Button-Zustände (aktiv/inaktiv) aktualisieren
  renderLegend();
  if(document.getElementById('touren-grid')) renderTourenGrid();
}

// ─── OBJEKT-SYMBOLE (je Projekt-Standard, je Typ/Art überschreibbar) ─────────
const PROJ_ICON_DEFAULT='🌳';
const ICON_CHOICES=['🌳','🌲','🌴','🌿','🍀','🌸','🌷','🌻','🪴','🍂','🗑️','🚮','🪣','♻️','🧹','🐕','💧','⛲','🚿','🪑','🛝','⚽','🚏','🅷','🅿️','🚧','💡','📍','⭐'];
function projIcon(){ return currentProjectData?.icon||PROJ_ICON_DEFAULT; }
let _artIconMap=null; // Art-Name -> Symbol (aus artenList)
function objIcon(tree){
  if(!_artIconMap){ _artIconMap={}; artenList.forEach(a=>{ if(a.icon&&a.name) _artIconMap[a.name]=a.icon; }); }
  return (tree&&tree.art&&_artIconMap[tree.art])||projIcon();
}
// Symbol-Auswahl: Raster + freie Eingabe; allowDefault → „Projekt-Standard verwenden" (= Symbol entfernen)
function pickIcon(current,cb,allowDefault){
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:340px;max-width:94vw;padding:16px 18px;">
    <div style="font-size:14px;font-weight:700;margin-bottom:10px;">Symbol wählen</div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:5px;margin-bottom:12px;">
      ${ICON_CHOICES.map(i=>`<button type="button" data-ic="${i}" style="height:34px;font-size:17px;padding:0;border:1.5px solid ${i===current?'var(--green)':'var(--border)'};border-radius:8px;background:${i===current?'var(--green-light)':'var(--bg)'};cursor:pointer;">${i}</button>`).join('')}
    </div>
    <div style="display:flex;gap:6px;align-items:center;margin-bottom:12px;">
      <input id="ic-free" placeholder="Eigenes Symbol…" maxlength="4" style="flex:1;padding:7px 10px;font-size:14px;border:1px solid var(--border);border-radius:8px;background:var(--bg);font-family:inherit;">
      <button type="button" id="ic-free-ok" class="btn btn-secondary" style="padding:7px 12px;font-size:12px;">Übernehmen</button>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      ${allowDefault?'<button type="button" id="ic-default" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;margin-right:auto;">Projekt-Standard verwenden</button>':''}
      <button type="button" id="ic-cancel" class="btn btn-secondary" style="padding:6px 12px;font-size:12px;">Abbrechen</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#ic-cancel').onclick=close;
  m.querySelectorAll('[data-ic]').forEach(b=>{ b.onclick=()=>{ close(); cb(b.dataset.ic); }; });
  m.querySelector('#ic-free-ok').onclick=()=>{ const v=m.querySelector('#ic-free').value.trim(); if(!v){ notify('Bitte ein Symbol eingeben'); return; } close(); cb(v); };
  const def=m.querySelector('#ic-default'); if(def) def.onclick=()=>{ close(); cb(null); };
}
function pickProjIcon(){
  const btn=document.getElementById('s-proj-icon'); if(!btn) return;
  pickIcon(btn.textContent.trim(),ic=>{ if(ic) btn.textContent=ic; },false);
}

function openSettings(){
  // Hide bottom route bar to avoid overlap
  document.getElementById('route-info-bar')?.classList.remove('visible');
  const depot=getDepot();
  document.getElementById('s-depot-addr').value=depot?.address||'';
  document.getElementById('s-depot-lat').value=depot?.lat||'';
  document.getElementById('s-depot-lng').value=depot?.lng||'';
  document.getElementById('s-depot-mode').value=getDepotMode();
  const _pi=document.getElementById('s-proj-icon'); if(_pi) _pi.textContent=projIcon();
  const _ro=document.getElementById('s-route-opt'); if(_ro) _ro.value=getRouteOptMode();
  const _routeOn = getRoutePlanningEnabled();
  const _rtBtn = document.getElementById('s-toggle-route');
  if(_rtBtn){ _rtBtn.style.background = _routeOn ? '#2d6a4f' : '#d1d5db'; }
  const _rtKnob = document.getElementById('s-toggle-knob');
  if(_rtKnob) _rtKnob.style.transform = _routeOn ? 'translateX(16px)' : 'translateX(0)';
  const _rtSub = document.getElementById('s-routing-sub');
  if(_rtSub){ _rtSub.style.opacity = _routeOn ? '1' : '0.4'; _rtSub.style.pointerEvents = _routeOn ? '' : 'none'; }
  // Projektname wird unter Verwaltung → Projekte verwaltet
  document.getElementById('s-bew-duration').value=getBewDuration();
  const _fg=document.getElementById('s-fuellgrad'); if(_fg) _fg.checked=!!currentProjectData?.fuellgradAktiv;
  const _cl=document.getElementById('s-cluster'); if(_cl) _cl.checked=!!currentProjectData?.clusterAktiv;
  loadReasons();
  renderDriverAssignment();
  const el=document.getElementById('depot-status');
  el.textContent=depot?.lat?`✓ ${depot.address||depot.lat.toFixed(5)+', '+depot.lng.toFixed(5)}`:'Noch kein Betriebshof gesetzt';
  el.style.color=depot?.lat?'var(--green)':'var(--text3)';
  document.getElementById('geocode-result').style.display='none';
  document.getElementById('geocode-error').style.display='none';
  renderWmsList();
  document.getElementById('settings-panel').classList.add('open');
}
function closeSettings(){
  // Restore route bar
  updateRouteInfoBar(); document.getElementById('settings-panel').classList.remove('open'); }

// Import (Excel) – eigenes Menü unter „Verwaltung“
function openImport(){
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:440px;max-width:94vw;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">Import / Export<button id="imp-x" style="border:none;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--text3);">×</button></div>
    <div style="padding:18px 20px;">
      <button class="btn btn-secondary" id="imp-tpl" style="width:100%;margin-bottom:8px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 3v12"/><polyline points="7 10 12 15 17 10"/><path d="M5 21h14"/></svg>
        Importvorlage herunterladen
      </button>
      <button class="btn btn-secondary" id="imp-btn" style="width:100%;margin-bottom:8px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Excel importieren
      </button>
      <button class="btn btn-secondary" id="imp-export" style="width:100%;margin-bottom:8px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 15V3"/><polyline points="7 8 12 3 17 8"/><path d="M5 21h14"/></svg>
        Alle Objekte exportieren (Excel)
      </button>
      <div style="font-size:11px;color:var(--text3);line-height:1.6;">Die <b>erste Zeile</b> muss Spaltenüberschriften enthalten — Reihenfolge egal. Am einfachsten die Vorlage herunterladen, ausfüllen und importieren. Erkannt werden u. a. ${dlEsc(FL.name)}, ${dlEsc(FL.stadtteil)}, ${dlEsc(FL.art)}, ${dlEsc(FL.baumnr)}, ${dlEsc(FL.pflanzjahr)}, ${dlEsc(FL.pflanzzeitpunkt)}, ${dlEsc(FL.zustand)}, ${dlEsc(FL.wasser)}, ${dlEsc(FL.notiz)}, Kundenfelder sowie Koordinaten (Lat/Lng oder ETRS89/UTM).</div>
    </div></div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#imp-x').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#imp-btn').onclick=()=>{ close(); document.getElementById('excel-import-input').click(); };
  m.querySelector('#imp-tpl').onclick=()=>{ downloadImportTemplate(); };
  m.querySelector('#imp-export').onclick=()=>{ downloadObjectsExport(); };
}

// Allgemein (ORS API-Key) – eigenes Menü unter „INFA-Admin“
function openAllgemein(){
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:460px;max-width:94vw;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">Allgemein<button id="alg-x" style="border:none;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--text3);">×</button></div>
    <div style="padding:18px 20px;">
      <div class="form-section" style="margin-top:0;">ORS API-Key (Straßen-Routing)</div>
      <div class="form-group">
        <label class="form-label">API-Key <span style="font-weight:400;color:var(--text3);">— gilt für diese Stadt</span></label>
        <input class="form-control" id="alg-apikey" placeholder="ors_…">
        <div style="margin-top:6px;font-size:11px;color:var(--text3);">Kostenlos: <a href="https://openrouteservice.org/dev/#/signup" target="_blank" style="color:var(--green);">openrouteservice.org</a></div>
      </div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="alg-cancel" class="btn btn-secondary">Abbrechen</button>
      <button id="alg-save" class="btn btn-primary">Speichern</button>
    </div></div>`;
  document.body.appendChild(m);
  m.querySelector('#alg-apikey').value=getOrsKey();
  const close=()=>m.remove();
  m.querySelector('#alg-x').onclick=close;
  m.querySelector('#alg-cancel').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#alg-save').onclick=async()=>{
    const key=m.querySelector('#alg-apikey').value.trim();
    if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Administratoren'); return; }
    const org=currentProjectData?.orgId; if(!org){ notify('Kein Mandant aktiv'); return; }
    try{ await dlFnCall('setOrgOrsKey',{orgId:org,orsKey:key}); currentOrgOrsKey=key; close(); notify('✓ API-Key gespeichert (für diese Stadt)'); }
    catch(e){ notify(fnErr(e)); }
  };
}

// ── WMS-Verwaltung (Einstellungen) ──
let editingWmsId=null; // beim Bearbeiten gesetzt
function renderWmsList(){
  const el=document.getElementById('wms-list'); if(!el) return;
  const list=getWmsLayers();
  let html=`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px;">Vorhandene Kartenebenen${list.length?' ('+list.length+')':''}</div>`;
  if(!list.length){
    el.innerHTML=html+'<div style="font-size:12px;color:var(--text3);padding:4px 0 14px;">Für dieses Projekt sind noch keine eigenen Kartenebenen hinterlegt. Unten eine hinzufügen.</div>';
    return;
  }
  html+=list.map(l=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;background:var(--surface);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(l.name)}</div>
      <div style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.type==='overlay'?'Overlay':'Basiskarte'} · Layer: ${dlEsc(l.layers||'')}</div>
    </div>
    <button onclick="editWmsLayer('${l.id}')" style="border:1px solid var(--border);background:var(--surface);cursor:pointer;color:var(--text2);padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;font-family:inherit;flex-shrink:0;">Bearbeiten</button>
    <button onclick="deleteWmsLayer('${l.id}')" title="Löschen" style="border:1px solid var(--red-light);background:var(--surface);cursor:pointer;color:var(--red);padding:5px 8px;border-radius:6px;flex-shrink:0;display:flex;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>
  </div>`).join('');
  el.innerHTML=html;
}
function editWmsLayer(id){
  const l=getWmsLayers().find(x=>x.id===id); if(!l) return;
  editingWmsId=id;
  const set=(i,v)=>{ const e=document.getElementById(i); if(e) e.value=v; };
  set('wms-add-name',l.name||''); set('wms-add-url',l.url||''); set('wms-add-layers',l.layers||'');
  set('wms-add-type',l.type||'overlay'); set('wms-add-version',l.version||'1.3.0');
  const t=document.getElementById('wms-form-title'); if(t) t.textContent='Ebene bearbeiten';
  const b=document.getElementById('wms-add-btn'); if(b) b.textContent='Änderungen speichern';
  const c=document.getElementById('wms-cancel-btn'); if(c) c.style.display='';
  document.getElementById('wms-add-name')?.scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelWmsEdit(){
  editingWmsId=null;
  ['wms-add-name','wms-add-url','wms-add-layers'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  const t=document.getElementById('wms-form-title'); if(t) t.textContent='Neue Ebene hinzufügen';
  const b=document.getElementById('wms-add-btn'); if(b) b.textContent='+ WMS-Ebene hinzufügen';
  const c=document.getElementById('wms-cancel-btn'); if(c) c.style.display='none';
}
function addWmsLayer(){
  const v=id=>document.getElementById(id)?.value.trim()||'';
  const name=v('wms-add-name'), url=v('wms-add-url'), layers=v('wms-add-layers'),
        type=v('wms-add-type')||'overlay', version=v('wms-add-version')||'1.3.0';
  if(!name||!url||!layers){ notify('Name, URL und Layer-Name sind erforderlich'); return; }
  const list=getWmsLayers();
  if(editingWmsId){ // bestehende Ebene aktualisieren
    const l=list.find(x=>x.id===editingWmsId);
    if(l){ Object.assign(l,{name,url,layers,type,version,transparent:type==='overlay'}); }
    saveWmsLayers(list); rebuildLayerControl(); cancelWmsEdit(); renderWmsList();
    notify('WMS-Ebene aktualisiert'); return;
  }
  list.push({ id:(window.crypto?.randomUUID?crypto.randomUUID():'w'+Date.now()),
    name, url, layers, type, format:'image/png', version, transparent:type==='overlay', maxZoom:20, attribution:'' });
  saveWmsLayers(list); rebuildLayerControl(); renderWmsList();
  ['wms-add-name','wms-add-url','wms-add-layers'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  notify('WMS-Ebene hinzugefügt');
}
function deleteWmsLayer(id){
  if(editingWmsId===id) cancelWmsEdit();
  saveWmsLayers(getWmsLayers().filter(l=>l.id!==id));
  rebuildLayerControl(); renderWmsList();
  notify('WMS-Ebene gelöscht');
}

async function geocodeDepot(){
  const addr=document.getElementById('s-depot-addr').value.trim();if(!addr)return;
  const ok=document.getElementById('geocode-result');const err=document.getElementById('geocode-error');
  ok.style.display='none';err.style.display='none';
  try{
    const res=await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(addr)}`,{headers:{'Accept-Language':'de'}});
    const data=await res.json();
    if(!data?.length){err.textContent='Adresse nicht gefunden.';err.style.display='block';return;}
    const {lat,lon,display_name}=data[0];
    document.getElementById('s-depot-lat').value=parseFloat(lat).toFixed(6);
    document.getElementById('s-depot-lng').value=parseFloat(lon).toFixed(6);
    ok.textContent='✓ '+display_name.split(',').slice(0,3).join(',');ok.style.display='block';
  }catch(e){err.textContent='Fehler: '+e.message;err.style.display='block';}
}

async function applySettings(){
  const lat=parseFloat(document.getElementById('s-depot-lat').value)||null;
  const lng=parseFloat(document.getElementById('s-depot-lng').value)||null;
  const addr=document.getElementById('s-depot-addr').value.trim();
  const updates={
    depotMode:document.getElementById('s-depot-mode').value,
    icon:document.getElementById('s-proj-icon')?.textContent.trim()||PROJ_ICON_DEFAULT,
    routeOptMode:document.getElementById('s-route-opt')?.value||getRouteOptMode(),
    bewDuration:parseInt(document.getElementById('s-bew-duration')?.value)||5,
    fuellgradAktiv:document.getElementById('s-fuellgrad')?.checked||false,
    clusterAktiv:document.getElementById('s-cluster')?.checked||false,
    routePlanning:getRoutePlanningEnabled(),
    name:currentProjectData?.name||'', // Projektname wird unter Verwaltung → Projekte verwaltet
  };
  if(lat&&lng) updates.depot={lat,lng,address:addr||`${lat.toFixed(5)}, ${lng.toFixed(5)}`};
  await saveProjectSettings(updates);
  document.getElementById('active-project-name').textContent=updates.name;
  closeSettings();renderDepotMarker();
  await loadSavedRoutes();
  applyClusterMode(updates.clusterAktiv, false); // Cluster-Modus umschalten (Marker werden gleich neu gebaut)
  refreshMarkers();renderList(); // neues Standard-Symbol sofort auf Karte/Liste anwenden
  notify('Einstellungen gespeichert — Route neu berechnen wenn gewünscht');
}

// Projekte – eigenes Menü unter „Verwaltung"
function openProjekte(){
  if(!currentProjectId){ notify('Kein Projekt geöffnet'); return; }
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:460px;max-width:94vw;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">
      Projekte<button id="prj-x" style="border:none;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--text3);">×</button>
    </div>
    <div style="padding:18px 20px;">
      <div class="form-section" style="margin-top:0;">Projekt</div>
      <div class="form-group">
        <label class="form-label">Projektname</label>
        <input class="form-control" id="prj-name" value="${currentProjectData?.name||''}">
      </div>
      <div style="margin-top:12px;padding:10px;background:var(--green-light);border-radius:var(--radius-sm);font-size:12px;color:var(--green);">
        📱 Mobile App URL:<br>
        <a href="mobil.html" target="_blank" style="color:var(--green);font-weight:600;">mobil.html</a>
        &nbsp;·&nbsp;
        <span style="cursor:pointer;text-decoration:underline;color:var(--green);" id="prj-fahrer-link">Fahrer &amp; Gründe verwalten →</span>
      </div>
      <button class="btn btn-danger" id="prj-del" style="width:100%;margin-top:16px;">Projekt löschen</button>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="prj-cancel" class="btn btn-secondary">Abbrechen</button>
      <button id="prj-save" class="btn btn-primary">Speichern</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#prj-x').onclick=close;
  m.querySelector('#prj-cancel').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#prj-fahrer-link').onclick=()=>{ close(); switchView('verwaltung'); };
  m.querySelector('#prj-del').onclick=()=>{ close(); confirmDeleteProject(); };
  m.querySelector('#prj-save').onclick=async()=>{
    const name=m.querySelector('#prj-name').value.trim();
    if(!name){ notify('Projektname darf nicht leer sein'); return; }
    await saveProjectSettings({name});
    document.getElementById('active-project-name').textContent=name;
    close(); notify('Projektname gespeichert');
  };
}

// ─── VIEWS ────────────────────────────────────────────────────
function switchView(v){
  currentView=v;
  // Nav buttons
  document.querySelectorAll('.nav-btn, .nav-dropdown button').forEach(b=>b.classList.remove('active'));
  const navEl=document.querySelector(`[onclick="switchView('${v}')"]`);
  if(navEl){
    navEl.classList.add('active');
    const grp=navEl.closest('.nav-group');
    if(grp) grp.querySelector('.nav-parent')?.classList.add('active'); // Eltern-Menü hervorheben
  }
  // Show/hide fullscreen overlays
  const baeume=document.getElementById('view-baeume');
  const touren=document.getElementById('view-touren');
  const controlling=document.getElementById('view-controlling');
  const dashboard=document.getElementById('view-dashboard');
  const ki=document.getElementById('view-ki');
  const kiconfig=document.getElementById('view-kiconfig');
  const handbuch=document.getElementById('view-handbuch'); if(handbuch) handbuch.style.display=v==='handbuch'?'flex':'none';
  const wmskarten=document.getElementById('view-wmskarten'); if(wmskarten) wmskarten.style.display=v==='wmskarten'?'flex':'none';
  const mandanten=document.getElementById('view-mandanten'); if(mandanten) mandanten.style.display=v==='mandanten'?'flex':'none';
  const systeminfo=document.getElementById('view-systeminfo'); if(systeminfo) systeminfo.style.display=v==='systeminfo'?'flex':'none';
  const disposition=document.getElementById('view-disposition');
  const verwaltung=document.getElementById('view-verwaltung');
  const usage=document.getElementById('view-usage'); if(usage) usage.style.display=v==='usage'?'block':'none';
  const feldbez=document.getElementById('view-feldbezeichnungen');
  const benutzer=document.getElementById('view-benutzer');
  if(feldbez) feldbez.style.display=v==='feldbezeichnungen'?'block':'none';
  if(benutzer) benutzer.style.display=v==='benutzer'?'block':'none';
  if(baeume) baeume.style.display=v==='baeume'?'flex':'none';
  if(touren) touren.style.display=v==='touren'?'block':'none';
  if(controlling) controlling.style.display=v==='controlling'?'flex':'none';
  if(dashboard) dashboard.style.display=v==='dashboard'?'flex':'none';
  if(ki) ki.style.display=v==='ki'?'flex':'none';
  if(kiconfig) kiconfig.style.display=v==='kiconfig'?'flex':'none';
  if(disposition) disposition.style.display=v==='disposition'?'flex':'none';
  if(verwaltung) verwaltung.style.display=v==='verwaltung'?'block':'none';
  // „Planen“-Button nur im manuellen Planungs-Modus (Karte) zeigen
  const planenBtn=document.getElementById('btn-planen');
  if(planenBtn) planenBtn.style.display=v==='karte'?'flex':'none';
  // Karte: always visible underneath, just hidden by overlays
  if(v==='karte') setTimeout(()=>{ map.invalidateSize(); maybeFitCity(); },10);
  if(v==='baeume'){ switchBaeumeTab('objekte'); renderBaeumeTable(); }
  if(v==='touren'){
    document.getElementById('view-touren').style.display='flex';
    // Load routes if not yet loaded
    if(Object.keys(tourRoutes).length===0) loadSavedRoutes().then(()=>renderTourenGrid());
    else renderTourenGrid();
  }
  if(v==='controlling'){
    // Lädt tourHistory einmalig beim Öffnen; Aktualisieren danach nur per Button.
    _dataViewProject=currentProjectId;
    initControlling();
    updateCtrlLastUpdated();
  }
  if(v==='dashboard'){ _dataViewProject=currentProjectId; initDashboard(); } // einmaliges Laden; danach nur per Refresh-Button
  if(v==='ki') renderKi();
  if(v==='kiconfig') renderKiConfig();
  if(v==='handbuch') renderHandbuch();
  if(v==='wmskarten') renderWmsList();
  if(v==='mandanten') renderMandanten();
  if(v==='systeminfo') renderSystemInfo();
  if(v==='disposition') initDispo();
  if(v==='verwaltung') initVerwaltung();
  if(v==='feldbezeichnungen') initFeldbezeichnungen();
  if(v==='usage') initUsage();
  if(v==='benutzer') initBenutzer();
}
async function initBenutzer(){
  if(currentRole!=='superadmin' && currentCap!=='admin') return;
  await initBenutzerOrgSelector(); // zentraler Stadt-/Mandanten-Umschalter (setzt benutzerOrg)
  const stepRollen=document.getElementById('benutzer-step-rollen');
  if(stepRollen) stepRollen.style.display=''; // Rollen sind mandantenscharf — auch Stadt-Admins pflegen ihre
  await renderRollenView(); // lädt rolesCache der gewählten Stadt (für Rollen-Dropdowns darunter)
  renderDriverLogins();   // Schritt 2
  renderUserMgmt();       // Schritt 3
  renderDriverMgmt();     // Schritt 4: Tour-Zuweisung
}
// Zentraler Mandanten-Umschalter: füllt #benutzer-org, setzt benutzerOrg + die Schritt-Orgs
async function initBenutzerOrgSelector(){
  const sel=document.getElementById('benutzer-org');
  const wrap=document.getElementById('benutzer-org-wrap');
  let orgs=[];
  if(currentRole==='superadmin'){ try{ const qs=await db.collection('orgs').get(); qs.forEach(d=>orgs.push({id:d.id,name:d.data().name||d.id})); }catch(e){} }
  else if(currentOrg){ orgs=[{id:currentOrg,name:currentOrg}]; }
  orgs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(!benutzerOrg || !orgs.find(o=>o.id===benutzerOrg)){
    benutzerOrg = (orgs.find(o=>o.id===currentProjectData?.orgId)?.id) || orgs[0]?.id || currentOrg || '';
  }
  driverLoginsOrg=benutzerOrg; userMgmtOrg=benutzerOrg;
  if(sel) sel.innerHTML=orgs.map(o=>`<option value="${dlEsc(o.id)}"${o.id===benutzerOrg?' selected':''}>${dlEsc(o.name)}</option>`).join('');
  // Umschalter nur für Superadmin mit mehreren Mandanten zeigen
  if(wrap) wrap.style.display = (currentRole==='superadmin' && orgs.length>1) ? '' : 'none';
}
// Zentrale Stadtwahl → alle Schritte (1/2/3/4) auf die Stadt umschalten
async function changeBenutzerOrg(oid){
  benutzerOrg=oid; driverLoginsOrg=oid; userMgmtOrg=oid; dtaProjectId='';
  await renderRollenView(); // Rollen der neuen Stadt laden (mandantenscharf)
  renderDriverLogins(); renderUserMgmt(); renderDriverMgmt();
}
function changeDtaProject(pid){ dtaProjectId=pid; renderDriverMgmt(); }
function toggleBenutzerRollen(){
  const body=document.getElementById('rollen-content');
  const chev=document.getElementById('benutzer-rollen-chevron');
  if(!body) return;
  const open=body.style.display==='none';
  body.style.display=open?'block':'none';
  if(chev) chev.style.transform=open?'rotate(180deg)':'rotate(0)';
}
function toggleBenutzerTouren(){
  const body=document.getElementById('touren-content');
  const chev=document.getElementById('benutzer-touren-chevron');
  if(!body) return;
  const open=body.style.display==='none';
  body.style.display=open?'block':'none';
  if(chev) chev.style.transform=open?'rotate(180deg)':'rotate(0)';
}

let _baeumeAllTrees = []; // cache for search
let _baeumeNoGpsFilter = false;
let _baeumeShowInactive = false;

function toggleFilterNoGps(btn){
  _baeumeNoGpsFilter = !_baeumeNoGpsFilter;
  updateBtnFilterNoGps();
  filterBaeumeTable(document.getElementById('baeume-search')?.value||'');
}
function toggleShowInactive(btn){
  _baeumeShowInactive = !_baeumeShowInactive;
  if(btn){
    btn.style.background = _baeumeShowInactive ? 'var(--text2)' : '';
    btn.style.color = _baeumeShowInactive ? '#fff' : '';
    btn.style.borderColor = _baeumeShowInactive ? 'var(--text2)' : '';
  }
  filterBaeumeTable(document.getElementById('baeume-search')?.value||'');
}
function updateBtnFilterNoGps(){
  const btn = document.getElementById('btn-filter-nogps');
  if(!btn) return;
  btn.style.background = _baeumeNoGpsFilter ? 'var(--amber)' : '';
  btn.style.color = _baeumeNoGpsFilter ? '#fff' : '';
  btn.style.borderColor = _baeumeNoGpsFilter ? 'var(--amber)' : '';
}

function filterBaeumeTable(q){
  const countEl = document.getElementById('baeume-search-count');
  const lower = q.toLowerCase();
  let filtered = _baeumeAllTrees.filter(tree=>
    !q.trim() ||
    (tree.name||'').toLowerCase().includes(lower) ||
    (tree.art||'').toLowerCase().includes(lower) ||
    (tree.stadtteil||'').toLowerCase().includes(lower) ||
    (tree.baumnr||'').toLowerCase().includes(lower) ||
    (tree.baumId||'').toLowerCase().includes(lower) ||
    (tree.pflanzjahr||'').toLowerCase().includes(lower)
  );
  if(_baeumeNoGpsFilter) filtered = filtered.filter(t => !t.lat || !t.lng);
  if(!_baeumeShowInactive) filtered = filtered.filter(isActive);
  const hasFilter = q.trim() || _baeumeNoGpsFilter;
  if(countEl) countEl.textContent = hasFilter ? `${filtered.length} Ergebnisse` : '';
  renderBaeumeTableWith(filtered);
}

function renderBaeumeTable(){
  _baeumeAllTrees = [...trees]; // cache all trees
  document.getElementById('baeume-search-count').textContent = '';
  renderBaeumeTableWith(_baeumeShowInactive ? trees : trees.filter(isActive));
}

// ─── ARTEN-STAMMDATEN (Typ/Art als pflegbare Liste je Projekt) ───────
let artenList=[];
let _artenMountId='arten-mount';     // Ziel-Container der Arten-Tabelle (im Felder-&-Listen-Bildschirm)
let listValues={}, customFields=[];  // generische Wertelisten + Kundenfelder (am Projekt-Doc)
async function loadArten(){
  artenList=[];
  if(!currentProjectId) return;
  try{ const qs=await getDocs(collection(db,'projects',currentProjectId,'arten')); artenList=qs.docs.map(d=>({id:d.id,...d.data()})); }catch(e){ console.warn('loadArten',e); }
  _artIconMap=null; // Symbol-Zuordnung neu aufbauen
}
function artCountById(){
  const m={}; trees.forEach(t=>{ if(t.artId) m[t.artId]=(m[t.artId]||0)+1; }); return m;
}
function switchBaeumeTab(tab){
  const o=document.getElementById('baeume-objekte'), a=document.getElementById('baeume-arten');
  const to=document.getElementById('tab-objekte'), ta=document.getElementById('tab-arten');
  const isArten=tab==='arten';
  if(o) o.style.display=isArten?'none':'flex';
  if(a) a.style.display=isArten?'block':'none';
  [to,ta].forEach(b=>{ if(!b) return; b.style.borderBottomColor='transparent'; b.style.color='var(--text3)'; b.style.fontWeight='600'; });
  const act=isArten?ta:to; if(act){ act.style.borderBottomColor='var(--green)'; act.style.color='var(--green)'; act.style.fontWeight='700'; }
  if(isArten) renderFieldCatalogView();
  else renderBaeumeTable();
}
async function renderArtenView(){
  const el=document.getElementById('baeume-arten'); if(!el) return;
  el.innerHTML='<div style="color:var(--text3);font-size:13px;">Lade…</div>';
  await loadArten();
  renderArtenList();
}
function renderArtenList(){
  const el=document.getElementById(_artenMountId); if(!el) return;
  const byId=artCountById();
  const validIds=new Set(artenList.map(a=>a.id));
  const unmapped=trees.filter(t=>(t.art||'').trim() && !(t.artId&&validIds.has(t.artId))).length;
  const ro=isReadonly();
  const sorted=[...artenList].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const rows=sorted.map(a=>{
    const c=byId[a.id]||0;
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:4px 8px 4px 12px;width:46px;">
        <button type="button" ${ro?'disabled':`onclick="artSetIcon('${dlEsc(a.id)}')"`} title="${a.icon?'Eigenes Symbol — ändern':'Projekt-Standard — eigenes Symbol setzen'}" style="width:32px;height:32px;font-size:16px;padding:0;border:1.5px solid ${a.icon?'var(--green-mid)':'var(--border)'};border-radius:8px;background:${a.icon?'var(--green-light)':'var(--bg)'};cursor:${ro?'default':'pointer'};${a.icon?'':'opacity:.55;'}">${a.icon||projIcon()}</button>
      </td>
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(a.name)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:7px 12px;white-space:nowrap;text-align:right;">${ro?'<span style="font-size:11px;color:var(--text3);">nur Lesezugriff</span>':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="renameArt('${a.id}')">Umbenennen</button>
        <select onchange="if(this.value)mergeArt('${a.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <option value="">→ zusammenführen…</option>${sorted.filter(x=>x.id!==a.id).map(x=>`<option value="${dlEsc(x.id)}">${dlEsc(x.name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;${c===0?'color:#c0392b;':'opacity:.45;cursor:not-allowed;'}" ${c===0?`onclick="deleteArt('${a.id}')"`:'disabled title="Nur löschbar bei Häufigkeit 0"'}>Löschen</button>`}
      </td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div style="max-width:780px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="font-size:15px;font-weight:700;">Arten – ${FL.art}</div>
      <span style="font-size:12px;color:var(--text3);">${artenList.length} Einträge · ${trees.length} Objekte</span>
      ${ro?'':`<button class="btn btn-primary" style="margin-left:auto;padding:5px 11px;font-size:12px;" onclick="buildArten()">Liste aus Objekten aufbauen/aktualisieren</button>`}
    </div>
    ${unmapped?`<div style="background:#fef3c7;border:1px solid #b45309;color:#7a4a06;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px;">${unmapped} Objekte noch keiner Art-ID zugeordnet — „aufbauen/aktualisieren" klicken.</div>`:''}
    ${artenList.length===0?'<div style="color:var(--text3);font-size:13px;padding:10px 0;">Noch keine Arten-Liste. Klicke „aufbauen/aktualisieren", um sie aus den Objekten zu erzeugen.</div>':`
    <table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:13px;">
      <thead><tr style="background:var(--surface2);">
        <th style="padding:8px 8px 8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Symbol</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">${FL.art}</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Häufigkeit</th>
        <th style="padding:8px 12px;"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`}
    ${ro?'':`<div style="display:flex;gap:6px;margin-top:10px;">
      <input id="art-new-name" class="form-control" placeholder="Neue Art (${FL.art})…" style="flex:1;padding:6px 10px;font-size:13px;" onkeydown="if(event.key==='Enter')addArt()">
      <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;white-space:nowrap;" onclick="addArt()">+ Hinzufügen</button>
    </div>`}
  </div>`;
}
async function artSetIcon(id){
  if(isReadonly()) return;
  const art=artenList.find(a=>a.id===id); if(!art) return;
  pickIcon(art.icon||null, async ic=>{
    try{
      await updateDoc(doc(db,'projects',currentProjectId,'arten',id), ic?{icon:ic}:{icon:firebase.firestore.FieldValue.delete()});
      await loadArten(); _artIconMap=null;
      renderArtenList(); refreshMarkers(); renderList();
      notify(ic?'✓ Symbol gesetzt':'✓ Symbol entfernt — Projekt-Standard gilt');
    }catch(e){ notify(dlErr(e)); }
  }, true);
}
async function addArt(){
  if(isReadonly()) return;
  if(!currentProjectId) return;
  const inp=document.getElementById('art-new-name');
  const name=(inp?.value||'').trim();
  if(!name) return;
  await loadArten();
  if(artenList.some(a=>a.name===name)){ notify('„'+name+'" existiert bereits'); return; }
  await addDoc(collection(db,'projects',currentProjectId,'arten'),{name,orgId:currentProjectData?.orgId||currentOrg||null,createdAt:serverTimestamp()});
  await loadArten(); renderArtenList();
  notify('✓ Art hinzugefügt');
}
async function _chunkedTreeUpdate(updates){
  for(let i=0;i<updates.length;i+=400){
    const batch=db.batch();
    updates.slice(i,i+400).forEach(u=>batch.update(doc(db,'projects',currentProjectId,'trees',u.id),u.data));
    await batch.commit();
  }
}
async function buildArten(){
  if(isReadonly()) return notify('Nur Lesezugriff');
  if(!currentProjectId) return;
  notify('Arten-Liste wird aktualisiert…');
  await loadArten();
  const byName=new Map(artenList.map(a=>[a.name,a.id]));
  const names=[...new Set(trees.map(t=>(t.art||'').trim()).filter(Boolean))];
  for(const nm of names){
    if(!byName.has(nm)){
      const ref=await addDoc(collection(db,'projects',currentProjectId,'arten'),{name:nm,orgId:currentProjectData?.orgId||currentOrg||null,createdAt:serverTimestamp()});
      byName.set(nm,ref.id);
    }
  }
  const ups=[];
  trees.forEach(t=>{ const nm=(t.art||'').trim(); const id=nm?byName.get(nm):''; if((t.artId||'')!==(id||'')){ ups.push({id:t.id,data:{artId:id||null}}); t.artId=id||null; } });
  await _chunkedTreeUpdate(ups);
  await loadArten(); renderArtenList();
  notify(`✓ ${byName.size} Arten · ${ups.length} Objekte zugeordnet`);
}
async function renameArt(id){
  if(isReadonly()) return;
  const a=artenList.find(x=>x.id===id); if(!a) return;
  const neu=prompt('Neuer Name für „'+a.name+'":',a.name); if(neu==null) return;
  const name=neu.trim(); if(!name||name===a.name) return;
  const dup=artenList.find(x=>x.id!==id && x.name===name);
  if(dup){ if(confirm('„'+name+'" existiert bereits — stattdessen zusammenführen?')) return mergeArt(id,dup.id); return; }
  await updateDoc(doc(db,'projects',currentProjectId,'arten',id),{name});
  const ups=trees.filter(t=>t.artId===id).map(t=>{t.art=name;return {id:t.id,data:{art:name}};});
  await _chunkedTreeUpdate(ups);
  await loadArten(); renderArtenList();
  notify(`✓ Umbenannt — ${ups.length} Objekte aktualisiert`);
}
async function mergeArt(srcId,tgtId){
  if(isReadonly()) return;
  if(srcId===tgtId) return;
  const src=artenList.find(x=>x.id===srcId), tgt=artenList.find(x=>x.id===tgtId);
  if(!src||!tgt) return;
  if(!confirm(`„${src.name}" in „${tgt.name}" zusammenführen? Zugehörige Objekte werden umgehängt.`)) return;
  const ups=trees.filter(t=>t.artId===srcId).map(t=>{t.artId=tgtId;t.art=tgt.name;return {id:t.id,data:{artId:tgtId,art:tgt.name}};});
  await _chunkedTreeUpdate(ups);
  await deleteDoc(doc(db,'projects',currentProjectId,'arten',srcId));
  await loadArten(); renderArtenList();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function deleteArt(id){
  if(isReadonly()) return;
  const a=artenList.find(x=>x.id===id); if(!a) return;
  if((artCountById()[id]||0)>0){ notify('Nur löschbar bei Häufigkeit 0'); return; }
  if(!confirm('„'+a.name+'" löschen?')) return;
  await deleteDoc(doc(db,'projects',currentProjectId,'arten',id));
  await loadArten(); renderArtenList();
  notify('✓ Gelöscht');
}

// ─── GENERISCHE WERTELISTEN (Listenfelder am Projekt-Doc) ────────────
// art bleibt in eigener Subcollection (oben). Die übrigen Listenfelder
// (stadtteil, pflanzjahr, pflanzzeitpunkt, Kundenfelder feld1..feld5)
// liegen kompakt unter projects/{id}.listValues[fieldKey] = [{id,label}].
// Der Wert wird am Objekt als Label gespeichert (wie heute Freitext) →
// keine Datenmigration nötig, „Aus Objekten aufbauen" sammelt Bestand ein.
function loadListValues(){
  listValues = JSON.parse(JSON.stringify(currentProjectData?.listValues || {}));
  customFields = (currentProjectData?.customFields || []).map(c=>({...c}));
}
function listFor(fieldKey){ return listValues[fieldKey] || []; }
function _genId(){ return 'v'+Math.random().toString(36).slice(2,9); }
function _treesUsing(fieldKey,label){ const l=(label||'').trim(); return trees.filter(t=>(t[fieldKey]||'').trim()===l); }
async function saveListValues(){
  if(!currentProjectId) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId), {listValues, customFields});
    if(currentProjectData){ currentProjectData.listValues=listValues; currentProjectData.customFields=customFields; }
  }catch(e){ console.warn('saveListValues',e); notify(dlErr(e)); }
}
async function addListVal(fieldKey){
  if(isReadonly()) return;
  const inp=document.getElementById('lv-new-'+fieldKey); const name=(inp?.value||'').trim();
  if(!name) return;
  if((listValues[fieldKey]||[]).some(e=>e.label===name)){ notify('„'+name+'" existiert bereits'); return; }
  (listValues[fieldKey]=listValues[fieldKey]||[]).push({id:_genId(),label:name});
  await saveListValues(); renderFieldCatalog(); notify('✓ Wert hinzugefügt');
}
async function renameListVal(fieldKey,id){
  if(isReadonly()) return;
  const e=(listValues[fieldKey]||[]).find(x=>x.id===id); if(!e) return;
  const neu=prompt('Neuer Wert für „'+e.label+'":',e.label); if(neu==null) return;
  const name=neu.trim(); if(!name||name===e.label) return;
  const dup=(listValues[fieldKey]||[]).find(x=>x.id!==id&&x.label===name);
  if(dup){ if(confirm('„'+name+'" existiert bereits — stattdessen zusammenführen?')) return mergeListVal(fieldKey,id,dup.id); return; }
  const old=e.label; e.label=name;
  const ups=_treesUsing(fieldKey,old).map(t=>{ t[fieldKey]=name; return {id:t.id,data:{[fieldKey]:name}}; });
  await _chunkedTreeUpdate(ups); await saveListValues(); renderFieldCatalog();
  notify(`✓ Umbenannt — ${ups.length} Objekte aktualisiert`);
}
async function mergeListVal(fieldKey,srcId,tgtId){
  if(isReadonly()||srcId===tgtId) return;
  const src=(listValues[fieldKey]||[]).find(x=>x.id===srcId), tgt=(listValues[fieldKey]||[]).find(x=>x.id===tgtId);
  if(!src||!tgt) return;
  if(!confirm(`„${src.label}" in „${tgt.label}" zusammenführen? Zugehörige Objekte werden umgehängt.`)) return;
  const ups=_treesUsing(fieldKey,src.label).map(t=>{ t[fieldKey]=tgt.label; return {id:t.id,data:{[fieldKey]:tgt.label}}; });
  await _chunkedTreeUpdate(ups);
  listValues[fieldKey]=(listValues[fieldKey]||[]).filter(x=>x.id!==srcId);
  await saveListValues(); renderFieldCatalog();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function deleteListVal(fieldKey,id){
  if(isReadonly()) return;
  const e=(listValues[fieldKey]||[]).find(x=>x.id===id); if(!e) return;
  if(_treesUsing(fieldKey,e.label).length>0){ notify('Nur löschbar, wenn kein Objekt den Wert nutzt'); return; }
  if(!confirm('„'+e.label+'" löschen?')) return;
  listValues[fieldKey]=(listValues[fieldKey]||[]).filter(x=>x.id!==id);
  await saveListValues(); renderFieldCatalog(); notify('✓ Gelöscht');
}
async function buildListFromObjects(fieldKey){
  if(isReadonly()) return notify('Nur Lesezugriff');
  const have=new Set((listValues[fieldKey]||[]).map(e=>e.label));
  const found=[...new Set(trees.map(t=>(t[fieldKey]||'').trim()).filter(Boolean))];
  let added=0;
  found.forEach(lbl=>{ if(!have.has(lbl)){ (listValues[fieldKey]=listValues[fieldKey]||[]).push({id:_genId(),label:lbl}); have.add(lbl); added++; } });
  await saveListValues(); renderFieldCatalog();
  notify(`✓ ${added} Wert(e) aus Objekten ergänzt`);
}
// Kundenfelder (max. 5, frei benennbar; ebenfalls Wertelisten)
async function addCustomField(){
  if(isReadonly()) return;
  if(customFields.length>=5){ notify('Maximal 5 Kundenfelder'); return; }
  const label=(prompt('Bezeichnung des neuen Kundenfeldes:','')||'').trim(); if(!label) return;
  const used=new Set(customFields.map(c=>c.key));
  let key=''; for(let i=1;i<=5;i++){ if(!used.has('feld'+i)){ key='feld'+i; break; } }
  if(!key){ notify('Maximal 5 Kundenfelder'); return; }
  customFields.push({key,label,aktiv:true});
  await saveListValues(); renderFieldCatalog(); notify('✓ Kundenfeld angelegt');
}
async function renameCustomField(key){
  if(isReadonly()) return;
  const c=customFields.find(x=>x.key===key); if(!c) return;
  const neu=prompt('Neue Bezeichnung für „'+c.label+'":',c.label); if(neu==null) return;
  const l=neu.trim(); if(!l||l===c.label) return;
  c.label=l; await saveListValues(); renderFieldCatalog(); notify('✓ Umbenannt');
}
async function removeCustomField(key){
  if(isReadonly()) return;
  const c=customFields.find(x=>x.key===key); if(!c) return;
  if(!confirm(`Kundenfeld „${c.label}" entfernen? Die Werteliste wird gelöscht; bereits an Objekten gespeicherte Werte bleiben erhalten, das Feld wird ausgeblendet.`)) return;
  customFields=customFields.filter(x=>x.key!==key);
  delete listValues[key];
  _fieldDetailKey=null;
  await saveListValues(); renderFieldCatalog(); notify('✓ Kundenfeld entfernt');
}

// ─── GEORDNETE LISTEN (Zustand/Priorität: Rang + Farbe) ──────────────
// Objekt speichert den stabilen Schlüssel (id), nicht das Label → Bestandsdaten
// (gut/mittel/schlecht bzw. gering/mittel/hoch) laufen unverändert weiter.
const RANK_SEED={
  zustand:[{id:'gut',label:'Gut',rang:1,farbe:'#16a34a'},{id:'mittel',label:'Mittel',rang:2,farbe:'#d97706'},{id:'schlecht',label:'Schlecht',rang:3,farbe:'#dc2626'}],
  wasser:[{id:'gering',label:'Gering',rang:1,farbe:'#16a34a'},{id:'mittel',label:'Mittel',rang:2,farbe:'#d97706'},{id:'hoch',label:'Hoch',rang:3,farbe:'#dc2626'}],
};
function isRankField(fieldKey){ return fieldKey==='zustand'||fieldKey==='wasser'; }
function rankList(fieldKey){
  let l=listValues[fieldKey];
  if(!l||!l.length) l=RANK_SEED[fieldKey]||[];
  return [...l].sort((a,b)=>(a.rang||0)-(b.rang||0));
}
function rankEntry(fieldKey,id){ return rankList(fieldKey).find(e=>e.id===id)||null; }
function rankLabel(fieldKey,id){ const e=rankEntry(fieldKey,id); return e?e.label:(id||''); }
function rankColor(fieldKey,id){ const e=rankEntry(fieldKey,id); return e?(e.farbe||'#9ca3af'):'#9ca3af'; }
function _rankUseCount(fieldKey,id){ return trees.filter(t=>(t[fieldKey]||'')===id).length; }
function _materializeRank(fieldKey){ if(!listValues[fieldKey]||!listValues[fieldKey].length){ listValues[fieldKey]=rankList(fieldKey).map(e=>({...e})); } }
async function rankAdd(fieldKey){
  if(isReadonly()) return;
  const inp=document.getElementById('lv-new-'+fieldKey); const name=(inp?.value||'').trim(); if(!name) return;
  _materializeRank(fieldKey);
  if(listValues[fieldKey].some(e=>e.label===name)){ notify('„'+name+'" existiert bereits'); return; }
  const maxR=Math.max(0,...listValues[fieldKey].map(e=>e.rang||0));
  listValues[fieldKey].push({id:_genId(),label:name,rang:maxR+1,farbe:'#9ca3af'});
  await saveListValues(); renderFieldCatalog(); notify('✓ Wert hinzugefügt');
}
async function rankRename(fieldKey,id){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  const neu=prompt('Neue Bezeichnung für „'+e.label+'":',e.label); if(neu==null) return;
  const l=neu.trim(); if(!l||l===e.label) return;
  e.label=l; await saveListValues(); _afterRankChange();
  notify('✓ Umbenannt');
}
async function rankSetColor(fieldKey,id,color){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  e.farbe=color; await saveListValues(); _afterRankChange();
}
async function rankMove(fieldKey,id,dir){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const arr=[...listValues[fieldKey]].sort((a,b)=>(a.rang||0)-(b.rang||0));
  const i=arr.findIndex(e=>e.id===id); if(i<0) return;
  const j=i+dir; if(j<0||j>=arr.length) return;
  [arr[i],arr[j]]=[arr[j],arr[i]];
  arr.forEach((e,k)=>e.rang=k+1);
  listValues[fieldKey]=arr;
  await saveListValues(); _afterRankChange();
}
async function rankMerge(fieldKey,srcId,tgtId){
  if(isReadonly()||srcId===tgtId) return; _materializeRank(fieldKey);
  const src=listValues[fieldKey].find(x=>x.id===srcId), tgt=listValues[fieldKey].find(x=>x.id===tgtId);
  if(!src||!tgt) return;
  if(!confirm(`„${src.label}" in „${tgt.label}" zusammenführen? Zugehörige Objekte werden umgehängt.`)) return;
  const ups=trees.filter(t=>(t[fieldKey]||'')===srcId).map(t=>{ t[fieldKey]=tgtId; return {id:t.id,data:{[fieldKey]:tgtId}}; });
  await _chunkedTreeUpdate(ups);
  listValues[fieldKey]=listValues[fieldKey].filter(x=>x.id!==srcId);
  await saveListValues(); _afterRankChange();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function rankDelete(fieldKey,id){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  if(_rankUseCount(fieldKey,id)>0){ notify('Nur löschbar, wenn kein Objekt den Wert nutzt'); return; }
  if(!confirm('„'+e.label+'" löschen?')) return;
  listValues[fieldKey]=listValues[fieldKey].filter(x=>x.id!==id);
  await saveListValues(); _afterRankChange(); notify('✓ Gelöscht');
}
// Nach Farb-/Label-/Rang-Änderung: Detail + abhängige Ansichten aktualisieren
function _afterRankChange(){ renderFieldCatalog(); try{ renderList(); }catch(_){} }

function _rankFieldCard(fieldKey,title){
  const vals=rankList(fieldKey);
  const ro=isReadonly();
  const rows=vals.map((e,i)=>{
    const c=_rankUseCount(fieldKey,e.id);
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 4px 6px 12px;white-space:nowrap;">
        <button class="btn btn-secondary" style="padding:1px 7px;font-size:11px;${i===0?'opacity:.3;':''}" ${i===0||ro?'disabled':`onclick="rankMove('${fieldKey}','${e.id}',-1)"`}>▲</button>
        <button class="btn btn-secondary" style="padding:1px 7px;font-size:11px;${i===vals.length-1?'opacity:.3;':''}" ${i===vals.length-1||ro?'disabled':`onclick="rankMove('${fieldKey}','${e.id}',1)"`}>▼</button>
      </td>
      <td style="padding:6px 8px;"><input type="color" value="${e.farbe||'#9ca3af'}" ${ro?'disabled':''} onchange="rankSetColor('${fieldKey}','${e.id}',this.value)" style="width:34px;height:24px;border:1px solid var(--border);border-radius:5px;padding:0;background:none;cursor:${ro?'default':'pointer'};"></td>
      <td style="padding:6px 12px;"><span style="display:inline-block;padding:2px 9px;border-radius:6px;background:${e.farbe||'#9ca3af'}22;color:${e.farbe||'#777'};font-size:12px;font-weight:600;">${dlEsc(e.label)}</span></td>
      <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:6px 12px;white-space:nowrap;text-align:right;">${ro?'':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="rankRename('${fieldKey}','${e.id}')">Umbenennen</button>
        <select onchange="if(this.value)rankMerge('${fieldKey}','${e.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;"><option value="">→ zusammenführen…</option>${vals.filter(x=>x.id!==e.id).map(x=>`<option value="${x.id}">${dlEsc(x.label)}</option>`).join('')}</select>
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;${c===0?'color:#c0392b;':'opacity:.45;cursor:not-allowed;'}" ${c===0?`onclick="rankDelete('${fieldKey}','${e.id}')"`:'disabled title="Nur löschbar bei Häufigkeit 0"'}>Löschen</button>`}
      </td></tr>`;
  }).join('');
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><div style="font-size:14px;font-weight:700;">${dlEsc(title)}</div><span style="font-size:11px;color:var(--text3);background:var(--surface2);padding:2px 7px;border-radius:5px;">Geordnete Liste · ${vals.length}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;">Mit ▲▼ die Reihenfolge (Rang) festlegen — bestimmt Sortierung und Auswertung. Die Farbe färbt die Anzeige in Tabelle und Detail.</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface2);"><th style="padding:6px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Rang</th><th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Farbe</th><th style="padding:6px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Wert</th><th style="padding:6px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Häufigkeit</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${ro?'':`<div style="display:flex;gap:6px;margin-top:8px;"><input id="lv-new-${fieldKey}" class="form-control" placeholder="Neuer Wert…" style="flex:1;padding:6px 10px;font-size:13px;" onkeydown="if(event.key==='Enter')rankAdd('${fieldKey}')"><button class="btn btn-primary" style="padding:6px 12px;font-size:12px;white-space:nowrap;" onclick="rankAdd('${fieldKey}')">+ Hinzufügen</button></div>`}
  </div>`;
}
// Rang-Dropdown fürs Objekt-Formular (Wert = stabile id, Anzeige = Label)
function fillRankSelect(fieldKey,current){
  const sel=document.getElementById('f-'+fieldKey); if(!sel) return;
  const vals=rankList(fieldKey);
  current=(current||'').trim();
  sel.innerHTML=vals.map(e=>`<option value="${dlEsc(e.id)}"${e.id===current?' selected':''}>${dlEsc(e.label)}</option>`).join('');
  if(current && vals.some(e=>e.id===current)) sel.value=current;
}

// Eine Karte für ein Listenfeld (anlegen/umbenennen/mergen/löschen/aufbauen)
function _fieldCatalogCard(fieldKey, title, opts={}){
  const vals=[...(listValues[fieldKey]||[])].sort((a,b)=>(a.label||'').localeCompare(b.label||''));
  const ro=isReadonly();
  const rows=vals.map(e=>{
    const c=_treesUsing(fieldKey,e.label).length;
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(e.label)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:7px 12px;white-space:nowrap;text-align:right;">${ro?'':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="renameListVal('${fieldKey}','${e.id}')">Umbenennen</button>
        <select onchange="if(this.value)mergeListVal('${fieldKey}','${e.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <option value="">→ zusammenführen…</option>${vals.filter(x=>x.id!==e.id).map(x=>`<option value="${x.id}">${dlEsc(x.label)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;${c===0?'color:#c0392b;':'opacity:.45;cursor:not-allowed;'}" ${c===0?`onclick="deleteListVal('${fieldKey}','${e.id}')"`:'disabled title="Nur löschbar bei Häufigkeit 0"'}>Löschen</button>`}
      </td></tr>`;
  }).join('');
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:14px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
      <div style="font-size:14px;font-weight:700;">${dlEsc(title)}</div>
      <span style="font-size:11px;color:var(--text3);background:var(--surface2);padding:2px 7px;border-radius:5px;">Liste · ${vals.length}</span>
      ${opts.custom&&!ro?`<button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="renameCustomField('${fieldKey}')">Feld umbenennen</button><button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;color:#c0392b;" onclick="removeCustomField('${fieldKey}')">Feld entfernen</button>`:''}
      ${ro?'':`<button class="btn btn-secondary" style="margin-left:auto;padding:4px 10px;font-size:11px;" onclick="buildListFromObjects('${fieldKey}')">Aus Objekten aufbauen</button>`}
    </div>
    ${vals.length?`<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface2);"><th style="padding:6px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Wert</th><th style="padding:6px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Häufigkeit</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`:`<div style="color:var(--text3);font-size:12px;padding:4px 0;">Noch keine Werte. „Aus Objekten aufbauen" oder unten hinzufügen.</div>`}
    ${ro?'':`<div style="display:flex;gap:6px;margin-top:8px;">
      <input id="lv-new-${fieldKey}" class="form-control" placeholder="Neuer Wert…" style="flex:1;padding:6px 10px;font-size:13px;" onkeydown="if(event.key==='Enter')addListVal('${fieldKey}')">
      <button class="btn btn-primary" style="padding:6px 12px;font-size:12px;white-space:nowrap;" onclick="addListVal('${fieldKey}')">+ Hinzufügen</button>
    </div>`}
  </div>`;
}

let _fieldDetailKey=null;   // null = Kachel-Übersicht; sonst fieldKey/'art' = Detailansicht
function openFieldDetail(key){ _fieldDetailKey=key; renderFieldCatalog(); const el=document.getElementById('baeume-arten'); if(el) el.scrollTop=0; }
function closeFieldDetail(){ _fieldDetailKey=null; renderFieldCatalog(); }

async function renderFieldCatalogView(){
  const el=document.getElementById('baeume-arten'); if(!el) return;
  el.innerHTML='<div style="color:var(--text3);font-size:13px;">Lade…</div>';
  _fieldDetailKey=null;
  loadListValues();
  await loadArten();
  renderFieldCatalog();
}
function renderFieldCatalog(){
  const el=document.getElementById('baeume-arten'); if(!el) return;
  if(_fieldDetailKey) renderFieldDetail(el);
  else renderFieldOverview(el);
}
// Eine Kachel in der Übersicht
function _fieldTile(key,label,opts={}){
  const isArt=key==='art';
  const vCount=isArt?artenList.length:(isRankField(key)?rankList(key).length:(listValues[key]||[]).length);
  const oCount=trees.filter(t=>((isArt?t.art:t[key])||'').toString().trim()).length;
  const locked=!!opts.locked;
  const hover=locked?'':`onmouseover="this.style.borderColor='var(--green-mid)';this.style.boxShadow='0 2px 8px rgba(0,0,0,.06)'" onmouseout="this.style.borderColor='var(--border)';this.style.boxShadow='none'"`;
  return `<div ${locked?'':`onclick="openFieldDetail('${key}')"`} style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;${locked?'opacity:.55;':'cursor:pointer;'}transition:border-color .12s,box-shadow .12s;" ${hover}>
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="font-size:14px;font-weight:700;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(label)}</div>
      ${opts.badge?`<span style="font-size:10px;color:var(--text3);background:var(--surface2);padding:2px 6px;border-radius:5px;white-space:nowrap;">${opts.badge}</span>`:''}
    </div>
    <div style="font-size:12px;color:var(--text3);margin-top:8px;">${locked?'Rang &amp; Farbe — folgt im nächsten Schritt':`${vCount} Wert${vCount===1?'':'e'} · ${oCount} Objekt${oCount===1?'':'e'}`}</div>
    ${locked?'':`<div style="font-size:11px;color:var(--green);margin-top:6px;font-weight:600;">Öffnen →</div>`}
  </div>`;
}
function renderFieldOverview(el){
  const ro=isReadonly();
  let tiles='';
  tiles+=_fieldTile('art', FL.art, {badge:'mit Symbol'});
  tiles+=_fieldTile('stadtteil', FL.stadtteil);
  tiles+=_fieldTile('pflanzjahr', FL.pflanzjahr);
  tiles+=_fieldTile('pflanzzeitpunkt', FL.pflanzzeitpunkt);
  customFields.forEach(c=>{ tiles+=_fieldTile(c.key, c.label, {badge:'Kundenfeld'}); });
  tiles+=_fieldTile('zustand', FL.zustand, {badge:'Rang & Farbe'});
  tiles+=_fieldTile('wasser', FL.wasser, {badge:'Rang & Farbe'});
  el.innerHTML=`<div style="max-width:880px;margin:0 auto;">
    <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Felder & Listen</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:16px;">Wähle ein Feld, um seine Auswahlliste zu pflegen. Freitext-Felder (${dlEsc(FL.name)}, ${dlEsc(FL.baumnr)}, ${dlEsc(FL.notiz)}) haben keine Liste.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">${tiles}</div>
    ${!ro && customFields.length<5?`<button class="btn btn-secondary" style="padding:7px 14px;font-size:12px;margin-top:16px;" onclick="addCustomField()">+ Kundenfeld hinzufügen (${customFields.length}/5)</button>`:''}
  </div>`;
}
function renderFieldDetail(el){
  const key=_fieldDetailKey;
  const back=`<button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;margin-bottom:14px;" onclick="closeFieldDetail()">← Alle Felder</button>`;
  if(key==='art'){
    el.innerHTML=`<div style="max-width:820px;margin:0 auto;">${back}<div id="arten-mount"></div></div>`;
    _artenMountId='arten-mount';
    renderArtenList();
    return;
  }
  if(isRankField(key)){
    el.innerHTML=`<div style="max-width:820px;margin:0 auto;">${back}${_rankFieldCard(key, key==='zustand'?FL.zustand:FL.wasser)}</div>`;
    return;
  }
  const cf=customFields.find(c=>c.key===key);
  if(!cf && !['stadtteil','pflanzjahr','pflanzzeitpunkt'].includes(key)){ closeFieldDetail(); return; }
  const label=cf?cf.label:({stadtteil:FL.stadtteil,pflanzjahr:FL.pflanzjahr,pflanzzeitpunkt:FL.pflanzzeitpunkt}[key]);
  el.innerHTML=`<div style="max-width:820px;margin:0 auto;">${back}${_fieldCatalogCard(key,label,{custom:!!cf})}</div>`;
}

function renderBaeumeTableWith(treeList){
  const wrap=document.getElementById('baeume-table-wrap');
  if(trees.length===0){
    wrap.innerHTML=`<div class="empty-state" style="margin-top:60px;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22V12"/><path d="M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7z"/></svg>
      <p>Noch keine Objekte</p></div>`;
    return;
  }

  // Sort: if a tour active, sort by route number; else alphabetical
  let sorted=[...treeList];
  if(activeTourOnMap&&tourOrder[activeTourOnMap]){
    const order=tourOrder[activeTourOnMap];
    sorted.sort((a,b)=>{
      const ia=order.indexOf(a.id),ib=order.indexOf(b.id);
      if(ia===-1&&ib===-1)return 0;
      if(ia===-1)return 1;if(ib===-1)return -1;
      return ia-ib;
    });
  } else {
    sorted.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  }

  const cols=[
    {label:'#',        w:'40px'},
    {label:'Objekt-ID',  w:'80px'},
    {label:FL.name,          w:'200px'},
    {label:FL.stadtteil,     w:'110px'},
    {label:FL.baumnr,        w:'130px'},
    {label:FL.art,           w:'180px'},
    {label:FL.pflanzjahr,    w:'100px'},
    {label:FL.pflanzzeitpunkt,w:'140px'},
    ...customFields.map(c=>({label:c.label,w:'120px'})),
    {label:FL.zustand,       w:'80px'},
    {label:'Tour',           w:'110px'},
    {label:FL.wasser,        w:'100px'},
    {label:FL.datum,         w:'110px'},
    {label:'GPS',      w:'70px'},
    {label:'',         w:'100px'},
  ];

  const th=cols.map(col=>
    `<th style="position:sticky;top:0;z-index:2;padding:9px 12px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);background:var(--surface2);white-space:nowrap;min-width:${col.w};">${col.label}</th>`
  ).join('');

  let rows='';
  const tourMap=new Map(tours.map(t=>[t.id,t]));   // Perf: 1× statt tours.find pro Zeile
  const prevRn=_routeNumMap; _routeNumMap=buildRouteNumMap();
  sorted.forEach(tree=>{
    const inact=!isActive(tree);
    const zE=tree.zustand?rankEntry('zustand',tree.zustand):null;
    const zBadge=zE?`<span class="badge" style="background:${zE.farbe}22;color:${zE.farbe};">${dlEsc(zE.label)}</span>`:'<span style="color:var(--text3);">–</span>';
    const wLbl=tree.wasser?rankLabel('wasser',tree.wasser):'–';
    const rNum=getRouteNum(tree.id);
    const pzt=tree.pflanzzeitpunkt||'–';
    const rowTours=getTreeTourIds(tree).map(id=>tourMap.get(id)).filter(Boolean);
    rows+=`<tr style="border-top:1px solid var(--border);transition:background .1s;cursor:pointer;${inact?'opacity:.55;':''}" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''" data-treeid="${tree.id}">
      <td style="padding:8px 12px;font-family:'DM Mono',monospace;color:var(--text3);font-size:11px;white-space:nowrap;">${rNum!=null?'<b style=color:var(--green)>#'+rNum+'</b>':'–'}</td>
      <td style="padding:8px 12px;font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${dlEsc(tree.baumId||'–')}</td>
      <td style="padding:8px 12px;font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(tree.name||'')}">${inact?'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);margin-right:5px;">INAKTIV</span>':''}${dlEsc(tree.name||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.stadtteil||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${dlEsc(tree.baumnr||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(tree.art||'')}">${dlEsc(tree.art||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.pflanzjahr||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;font-size:12px;">${dlEsc(pzt)}</td>
      ${customFields.map(c=>`<td style="padding:8px 12px;color:var(--text2);white-space:nowrap;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;" title="${dlEsc(tree[c.key]||'')}">${dlEsc(tree[c.key]||'–')}</td>`).join('')}
      <td style="padding:8px 12px;">${zBadge}</td>
      <td style="padding:8px 12px;white-space:nowrap;">${rowTours.length?rowTours.map(t=>`<span style="font-size:11px;font-weight:600;color:${t.color};">${dlEsc(t.name)}</span>`).join('<br>'):'<span style="color:var(--text3);font-size:12px;">–</span>'}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${wLbl}</td>
      <td style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${tree.datum||'–'}</td>
      <td style="padding:8px 12px;">${!tree.lat||!tree.lng?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#fef3c7;color:#b45309;white-space:nowrap;">Kein GPS</span>':''}</td>
      <td style="padding:8px 12px;">
        <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;" data-editid="${tree.id}">Bearbeiten</button>
      </td>
    </tr>`;
  });
  _routeNumMap=prevRn;
  const _atOnMap=tourMap.get(activeTourOnMap);

  wrap.innerHTML=`
    <div style="padding:12px 20px 8px;display:flex;align-items:center;gap:16px;flex-shrink:0;border-bottom:1px solid var(--border);background:var(--surface);">
      <span style="font-size:13px;font-weight:600;color:var(--text);">${sorted.length} Objekte${activeTourOnMap&&_atOnMap?' — <span style=color:'+_atOnMap.color+';font-weight:700>'+dlEsc(_atOnMap.name)+'</span>':''}</span>
      <span style="font-size:12px;color:var(--text3);">Klick auf Zeile → Karte</span>
    </div>
    <div style="overflow:auto;flex:1;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);">
        <thead><tr>${th}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  // Event delegation: map/edit button or row click
  wrap.onclick=e=>{
    const mapBtn=e.target.closest('[data-mapid]');
    if(mapBtn){ selectTree(mapBtn.dataset.mapid); return; }
    const editBtn=e.target.closest('[data-editid]');
    if(editBtn){ openEditTree(editBtn.dataset.editid); return; }
    const row=e.target.closest('[data-treeid]');
    if(row) selectTree(row.dataset.treeid);
  };
}

let _tourenSearch='';
function filterTourenGrid(q){ _tourenSearch=q||''; renderTourenGrid(); }

function renderTourenGrid(){
  const grid=document.getElementById('touren-grid');
  const countEl=document.getElementById('touren-count');
  if(!grid)return;

  if(tours.length===0){
    grid.innerHTML=`<tr><td colspan="8" style="padding:60px;text-align:center;color:var(--text3);">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 12px;opacity:.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      Noch keine Touren angelegt</td></tr>`;
    if(countEl)countEl.textContent='Touren';
    return;
  }

  const ovCount=tours.filter(t=>t.uebersicht).length, echtCount=tours.length-ovCount;
  // Standardmäßig nur echte Touren; Übersichtstouren erst nach Klick auf den Umschalter
  const base=showOverviewInGrid ? tours : tours.filter(t=>!t.uebersicht);
  const q=(_tourenSearch||'').trim().toLowerCase();
  const list=q ? base.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.desc||'').toLowerCase().includes(q)) : base;
  if(countEl)countEl.textContent=q?`${list.length} von ${tours.length} Touren`:`${echtCount} Touren${ovCount?` · ${ovCount} Übersicht`:''}`;
  // Umschalter nur zeigen, wenn es überhaupt Übersichtstouren gibt
  const ovBtn=document.getElementById('btn-toggle-overview-grid');
  if(ovBtn){
    ovBtn.style.display=ovCount?'':'none';
    const lbl=document.getElementById('toggle-overview-grid-label');
    if(lbl) lbl.textContent=showOverviewInGrid?'Übersichtstouren ausblenden':`Übersichtstouren anzeigen (${ovCount})`;
    ovBtn.style.background=showOverviewInGrid?'var(--green-light)':'';
    ovBtn.style.color=showOverviewInGrid?'var(--green)':'';
  }

  if(list.length===0){
    const msg=q ? `Keine Tour gefunden für „${_tourenSearch}"`
                : 'Nur Übersichtstouren vorhanden — über „Übersichtstouren anzeigen" oben rechts einblenden.';
    grid.innerHTML=`<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--text3);">${msg}</td></tr>`;
    return;
  }

  grid.innerHTML=list.map(tour=>{
    const treesInTour=trees.filter(t=>treeInTour(t,tour.id));
    const cnt=treesInTour.length;
    const zCounts=rankList('zustand').map(e=>({label:e.label,farbe:e.farbe,n:treesInTour.filter(t=>(t.zustand||'')===e.id).length}));
    const rt=tourRoutes[tour.id];
    // In-Memory-Route bevorzugen (frisch nach Neuberechnung), sonst gespeicherte Tour-Kennzahlen
    const kmVal   = rt ? rt.km          : (typeof tour.routeKm==='number'      ? tour.routeKm      : null);
    const driveVal= rt ? rt.durationSec : (typeof tour.routeDriveSec==='number'? tour.routeDriveSec : null);
    const km=kmVal!=null?kmVal.toFixed(1)+' km':'–';
    const driveZeit=driveVal?fmtDuration(driveVal):'–';
    const bewZeit=kmVal!=null?fmtBewTime(cnt):'–';
    const gesamtZeit=driveVal?fmtTotalTime(driveVal,cnt):'–';
    const bar=cnt>0?`<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px;width:120px;">
      ${zCounts.filter(z=>z.n>0).map(z=>`<div style="flex:${z.n};background:${z.farbe};" title="${z.n} ${dlEsc(z.label)}"></div>`).join('')}
      </div><div style="font-size:10px;color:var(--text3);margin-top:2px;">${zCounts.filter(z=>z.n>0).map(z=>z.n+' '+dlEsc(z.label)).join(' · ')||'–'}</div>`
      :'<span style="color:var(--text3);font-size:12px;">–</span>';
    return `<tr style="border-top:1px solid var(--border);" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
      <td style="padding:10px 16px;"><div style="width:14px;height:14px;border-radius:3px;background:${tour.color};flex-shrink:0;"></div></td>
      <td style="padding:10px 16px;font-weight:600;white-space:nowrap;">${tour.name}${tour.uebersicht?' <span style="font-size:10px;font-weight:600;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:1px 5px;vertical-align:middle;">Übersicht</span>':''}</td>
      <td style="padding:10px 16px;color:var(--text2);font-size:12px;">${tour.desc||'–'}</td>
      <td style="padding:10px 16px;text-align:center;"><input type="checkbox" ${tour.uebersicht?'checked':''} onchange="toggleTourUebersicht('${tour.id}',this.checked)" style="cursor:pointer;width:16px;height:16px;" title="Als Übersichtstour markieren (keine echte Tour)"></td>
      <td style="padding:10px 16px;text-align:right;font-weight:600;">${cnt}</td>
      <td style="padding:10px 16px;text-align:right;color:var(--text2);font-size:12px;">${km}</td>
      <td style="padding:10px 16px;text-align:right;font-size:12px;">
        <div style="color:var(--text2);">${driveZeit} <span style="color:var(--text3);font-size:10px;">Fahrt</span></div>
        <div style="color:var(--text2);">${bewZeit} <span style="color:var(--text3);font-size:10px;">Bew.</span></div>
        <div style="font-weight:600;color:var(--text);">${gesamtZeit} <span style="color:var(--text3);font-size:10px;">Gesamt</span></div>
      </td>
      <td style="padding:10px 16px;">
        <div style="display:flex;gap:5px;justify-content:flex-end;align-items:center;">
          <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" data-action="karte" data-tid="${tour.id}">Karte</button>
          ${tour.uebersicht?'':`<button class="btn btn-primary" style="padding:3px 9px;font-size:11px;${rpDisStyle()}" data-action="route" data-tid="${tour.id}"${rpDisAttr()}>Route</button>`}
          <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" data-action="edit" data-tid="${tour.id}">✎</button>
          <button class="btn btn-danger" style="padding:3px 9px;font-size:11px;" data-action="delete" data-tid="${tour.id}">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  grid.onclick=e=>{
    const btn=e.target.closest('[data-action]');if(!btn)return;
    const tid=btn.dataset.tid,action=btn.dataset.action;
    if(action==='karte')focusTourAndSwitch(tid);
    else if(action==='route')calculateAndSaveRoute(tid);
    else if(action==='edit')openTourModal(tid);
    else if(action==='delete')deleteTour(tid);
  };

  // "Alle Routen berechnen"-Toolbar-Button je nach Reihenfolgeplanung
  const allBtn=document.getElementById('btn-calc-all-toolbar');
  if(allBtn){ const off=!getRoutePlanningEnabled()||isReadonly(); allBtn.disabled=off; allBtn.style.opacity=off?'0.45':''; allBtn.style.cursor=off?'not-allowed':''; allBtn.title=isReadonly()?'Nur Lesezugriff':(off?'Reihenfolgeplanung ist deaktiviert':''); }
}

async function focusTourAndSwitch(id){ switchView('karte');setTimeout(()=>focusTour(id),80); }

// ─── UTILS ────────────────────────────────────────────────────
function notify(msg){
  const el=document.getElementById('notification');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2400);
}

// ─── VERWALTUNG (Fahrer + Gründe) ───────────────────────────
let reasons=[];

async function saveFieldLabels(){
  const keys = ['name','stadtteil','baumnr','art','pflanzjahr','pflanzzeitpunkt','zustand','wasser','datum'];
  const labels = {};
  keys.forEach(k => {
    const val = document.getElementById('fl-'+k)?.value.trim();
    if(val) labels[k] = val;
  });
  await updateDoc(doc(db,'projects',currentProjectId),{fieldLabels:labels});
  currentProjectData.fieldLabels = labels;
  loadFieldLabels();
  notify('✓ Feldbezeichnungen gespeichert');
}

async function migrateTourIds(){
  if(!confirm(`tourIds-Migration für alle ${trees.length} Objekte durchführen? Einmalig nötig.`)) return;
  notify('Migration läuft…');
  let migrated=0;
  const BATCH=400;
  for(let i=0;i<trees.length;i+=BATCH){
    const batch=db.batch();
    trees.slice(i,i+BATCH).forEach(tree=>{
      if(!Array.isArray(tree.tourIds)){
        const ids=tree.tourId?[tree.tourId]:[];
        batch.update(
          db.collection('projects').doc(currentProjectId).collection('trees').doc(tree.id),
          {tourIds:ids}
        );
        tree.tourIds=ids;
        migrated++;
      }
    });
    await batch.commit();
  }
  notify(`✓ Migration abgeschlossen — ${migrated} Objekte aktualisiert`);
}

// Automatische Hintergrund-Migration: tourId → tourIds[] (still, idempotent)
let _migratingTourIds=false;
async function autoMigrateTourIds(){
  if(!currentProjectId || _migratingTourIds) return;
  const pending=trees.filter(t=>!Array.isArray(t.tourIds));
  if(pending.length===0) return;
  _migratingTourIds=true;
  try{
    const BATCH=400;
    for(let i=0;i<pending.length;i+=BATCH){
      const batch=db.batch();
      pending.slice(i,i+BATCH).forEach(tree=>{
        const ids=tree.tourId?[tree.tourId]:[];
        batch.update(doc(db,'projects',currentProjectId,'trees',tree.id),{tourIds:ids});
        tree.tourIds=ids;
      });
      await batch.commit();
    }
    console.log(`tourIds-Migration (auto): ${pending.length} Objekte aktualisiert`);
  }catch(e){ console.warn('Auto-Migration fehlgeschlagen, erneuter Versuch beim nächsten Laden:',e); }
  finally{ _migratingTourIds=false; }
}

async function initVerwaltung(){
  // Nur noch Gründe (Fahrer→Benutzer, Feldbezeichnungen→eigener INFA-Admin-Punkt)
  if(!currentProjectId)return;
  await loadReasons();
  // Kein Auto-Seed: Gründe sind streng pro Projekt (leere Projekte → seedDefaultReasons-Button).
  renderReasonsMgmt();
}

function initFeldbezeichnungen(){
  const flGrid = document.getElementById('fl-grid-container');
  if(!flGrid) return;
  const fields = [
    ['name','Anlage / Straße'],['stadtteil','Stadtteil'],['baumnr','Objektnummer'],
    ['art','Typ / Art'],['pflanzjahr','Jahr'],['pflanzzeitpunkt','Zeitpunkt'],
    ['zustand','Zustand'],['wasser','Prioritaet'],['datum','Letzte Bearb.'],
  ];
  flGrid.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border);';
  flGrid.innerHTML = fields.map(([k,def]) =>
    `<div style="background:var(--surface);padding:8px 10px;">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:4px;">${def}</div>
      <input class="form-control" id="fl-${k}" placeholder="${DEFAULT_LABELS[k]||def}" value="${FL[k]||''}" style="padding:5px 8px;font-size:12px;">
    </div>`
  ).join('');
}

// ─── NUTZUNG JE STADT (Admin) ────────────────────────────────────────────────
let _usageRows=[];
async function initUsage(){
  await flushUsage().catch(()=>{}); // aktuelle Zähler erst persistieren
  const sel=document.getElementById('usage-month');
  if(sel && !sel.options.length){
    const now=new Date(); const opts=[];
    for(let i=0;i<6;i++){ const d=new Date(now.getFullYear(),now.getMonth()-i,1); opts.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')); }
    sel.innerHTML=opts.map(m=>`<option value="${m}">${m}</option>`).join('');
  }
  renderUsage();
}
async function renderUsage(){
  const el=document.getElementById('usage-body'); if(!el) return;
  if(!(currentRole==='superadmin'||currentCap==='admin')){ el.innerHTML='<div style="color:var(--text3);font-size:13px;">Nur Administratoren.</div>'; return; }
  el.innerHTML='<div style="color:var(--text3);font-size:13px;">Lade…</div>';
  const ym=document.getElementById('usage-month')?.value || _usageMonth();
  const orgNames={};
  try{ if(currentRole==='superadmin'){ const qs=await db.collection('orgs').get(); qs.forEach(d=>orgNames[d.id]=d.data().name||d.id); } else { orgNames[currentOrg]=currentOrg; } }catch(e){}
  let docs=[];
  try{
    if(currentRole==='superadmin'){ const qs=await db.collection('usage').where('monat','==',ym).get(); docs=qs.docs.map(d=>d.data()); }
    else { const s=await db.collection('usage').doc(currentOrg+'_'+ym).get(); if(s.exists) docs=[s.data()]; }
  }catch(e){ el.innerHTML='<div style="color:var(--red);font-size:13px;">Fehler beim Laden: '+(e.message||e.code)+'</div>'; return; }
  docs.sort((a,b)=>(orgNames[a.orgId]||a.orgId).localeCompare(orgNames[b.orgId]||b.orgId));
  _usageRows=docs.map(d=>({stadt:orgNames[d.orgId]||d.orgId, orgId:d.orgId, reads:d.reads||0, writes:d.writes||0, deletes:d.deletes||0}));
  const fmt=n=>(n||0).toLocaleString('de-DE');
  if(_usageRows.length===0){ el.innerHTML=`<div style="color:var(--text3);font-size:13px;padding:10px 0;">Noch keine Nutzungsdaten für ${ym}. (Werden gesammelt, sobald die App genutzt wird.)</div>`; return; }
  const sum=_usageRows.reduce((a,r)=>({reads:a.reads+r.reads,writes:a.writes+r.writes,deletes:a.deletes+r.deletes}),{reads:0,writes:0,deletes:0});
  const th='padding:9px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);';
  el.innerHTML=`<table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:13px;">
    <thead><tr style="background:var(--surface2);">
      <th style="${th}text-align:left;">Stadt</th><th style="${th}">Reads</th><th style="${th}">Writes</th><th style="${th}">Deletes</th>
    </tr></thead>
    <tbody>${_usageRows.map(r=>`<tr style="border-top:1px solid var(--border);">
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(r.stadt)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.reads)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.writes)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.deletes)}</td>
    </tr>`).join('')}
    <tr style="border-top:2px solid var(--border);font-weight:700;background:var(--surface2);">
      <td style="padding:8px 12px;">Summe</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.reads)}</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.writes)}</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.deletes)}</td>
    </tr></tbody></table>`;
}
function exportUsageCSV(){
  const ym=document.getElementById('usage-month')?.value||_usageMonth();
  const rows=[['Stadt','orgId','Reads','Writes','Deletes','Monat'],..._usageRows.map(r=>[r.stadt,r.orgId,r.reads,r.writes,r.deletes,ym])];
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nutzung_'+ym+'.csv'; a.click();
}

// ─── FAHRER-LOGINS & PINs (Mehrmandanten — nutzbar nach Auth-Aktivierung) ─────
let driverLoginsOrg = '';
let benutzerOrg = ''; // zentraler Stadt-/Mandanten-Umschalter (Benutzer-Seite)
let dtaProjectId = ''; // Schritt 4: gewähltes Projekt für Tour-Zuweisung
let dlPinEdit = null;
function dlFnCall(name,data){
  try{
    if(!window.firebase?.app || !firebase.app().functions) return Promise.reject({code:'unavailable'});
    return firebase.app().functions('europe-west3').httpsCallable(name)(data);
  }catch(e){ return Promise.reject(e); }
}
function dlErr(e){
  const c=(e&&e.code)||'';
  if(/unauthenticated|unavailable|not-found|internal|permission-denied/.test(c))
    return '⚠ Noch nicht aktiv/angemeldet — siehe Runbook (docs/auth-mandanten.md)';
  return 'Fehler: '+((e&&e.message)||c||e);
}
function dlEditPin(id){ dlPinEdit=id; renderDriverLogins(); }
function dlCancelPin(){ dlPinEdit=null; renderDriverLogins(); }

async function renderDriverLogins(){
  const body=document.getElementById('driver-logins-body');
  if(!body) return;
  if(!(currentRole==='superadmin'||currentCap==='admin')){
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);">${currentRole?'Nur Administratoren können Personen verwalten.':'Mehrmandanten/Auth noch nicht aktiviert — siehe <code>docs/auth-mandanten.md</code>.'}</div>`;
    return;
  }
  const org = driverLoginsOrg || currentOrg;
  if(!org){
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);line-height:1.6;">Kein Mandant gewählt (siehe <code>docs/auth-mandanten.md</code>).</div>`;
    return;
  }
  let drivers=[];
  try{ const qs=await db.collection('drivers').where('orgId','==',org).get(); qs.forEach(d=>drivers.push({id:d.id,...d.data()})); }catch(e){}
  drivers.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  let orgCode=''; try{ const os=await db.collection('orgs').doc(org).get(); if(os.exists) orgCode=os.data().code||''; }catch(e){}
  body.innerHTML=`
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
      <span style="font-size:12px;font-weight:600;">Stadt-Code</span>
      <input id="dl-org-code" class="form-control" placeholder="z. B. RUESSEL" maxlength="12" value="${dlEsc(orgCode)}" style="width:140px;padding:5px 8px;font-size:12px;text-transform:uppercase;">
      <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="saveOrgCode()">Speichern</button>
      <span style="font-size:11px;color:var(--text3);">Fallback, falls Name+PIN in mehreren Städten gleich sind.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      ${drivers.length?drivers.map(dlRow).join(''):`<div style="font-size:12px;color:var(--text3);">Noch keine Personen in diesem Mandanten.</div>`}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;">
      <input id="dl-new-name" class="form-control" placeholder="Name…" style="flex:1;min-width:130px;padding:5px 8px;font-size:12px;">
      <select id="dl-new-role" style="padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">${personRoleOptionsHtml('fahrer')}</select>
      <input id="dl-new-pin" class="form-control" placeholder="6-stellige PIN" inputmode="numeric" maxlength="6" style="width:120px;padding:5px 8px;font-size:12px;">
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px;white-space:nowrap;" onclick="addDriverLogin()">+ Person + PIN</button>
    </div>`;
}
function personRoleOptionsHtml(selected){
  let entries=Object.entries(rolesCache).filter(([k])=> k!=='superadmin' || selected==='superadmin' || currentRole==='superadmin');
  if(selected && !entries.find(([k])=>k===selected)) entries.unshift([selected,{name:selected}]);
  return entries.sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0]))
    .map(([k,r])=>`<option value="${dlEsc(k)}"${k===selected?' selected':''}>${dlEsc(r.name||k)}</option>`).join('');
}
function dlRow(d){
  const active=d.active!==false, editing=dlPinEdit===d.id;
  const roleSel=`<select onchange="changeDriverRole('${dlEsc(d.id)}',this.value)" title="Rolle ändern" style="font-size:11px;padding:2px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">${personRoleOptionsHtml(d.role||'fahrer')}</select>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;flex-wrap:wrap;">
    <span style="flex:1;min-width:120px;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(d.name)}</span>
    ${roleSel}
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="dl-pin-${dlEsc(d.id)}" class="form-control" placeholder="neue PIN" inputmode="numeric" maxlength="6" style="width:110px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveDriverPin('${dlEsc(d.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlCancelPin()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlEditPin('${dlEsc(d.id)}')">PIN setzen</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleDriverLoginActive('${dlEsc(d.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;color:#c0392b;" onclick="deleteDriverUi('${dlEsc(d.id)}','${dlEsc(d.name||'')}')">Löschen</button>`}
  </div>`;
}
async function addDriverLogin(){
  const name=(document.getElementById('dl-new-name')?.value||'').trim();
  const pin=(document.getElementById('dl-new-pin')?.value||'').trim();
  const personRole=document.getElementById('dl-new-role')?.value||'fahrer';
  if(!name){ notify('Bitte Name eingeben'); return; }
  if(!/^\d{6}$/.test(pin)){ notify('PIN muss 6-stellig sein'); return; }
  try{ await dlFnCall('setDriverPin',{name,orgId:driverLoginsOrg,pin,personRole}); notify('✓ Person angelegt'); renderDriverLogins(); }
  catch(e){ notify(fnErr(e)); }
}
async function saveOrgCode(){
  const org=driverLoginsOrg||currentOrg;
  const code=(document.getElementById('dl-org-code')?.value||'').trim().toUpperCase();
  if(!/^[A-Z0-9]{2,12}$/.test(code)){ notify('Code: 2–12 Zeichen, nur A–Z und 0–9'); return; }
  try{ await dlFnCall('setOrgCode',{orgId:org,code}); notify('✓ Stadt-Code gespeichert'); renderDriverLogins(); }
  catch(e){ notify(fnErr(e)); }
}
async function changeDriverRole(driverId,personRole){
  try{ await dlFnCall('setDriverPin',{driverId,orgId:driverLoginsOrg,personRole}); notify('✓ Rolle geändert'); renderDriverLogins(); }
  catch(e){ notify(fnErr(e)); renderDriverLogins(); }
}
async function saveDriverPin(driverId){
  const pin=(document.getElementById('dl-pin-'+driverId)?.value||'').trim();
  if(!/^\d{6}$/.test(pin)){ notify('PIN muss 6-stellig sein'); return; }
  try{ await dlFnCall('setDriverPin',{driverId,orgId:driverLoginsOrg,pin}); dlPinEdit=null; notify('✓ PIN gesetzt'); renderDriverLogins(); }
  catch(e){ notify(dlErr(e)); }
}
async function toggleDriverLoginActive(driverId,currentlyActive){
  try{ await db.collection('drivers').doc(driverId).set({active:!currentlyActive},{merge:true}); renderDriverLogins(); }
  catch(e){ notify(dlErr(e)); }
}

// ─── NUTZER & ROLLEN (E-Mail-Konten — nutzbar nach Auth-Aktivierung) ─────────
let userMgmtOrg='';
let urPassEdit=null;
function fnErr(e){
  const c=(e&&e.code)||'', m=(e&&e.message)||'';
  if(/unavailable|deadline/.test(c)) return '⚠ Funktion nicht erreichbar — ist sie deployt? (docs/auth-mandanten.md)';
  return m || ('Fehler: '+(c||'unbekannt'));
}
function urEditPass(id){ urPassEdit=id; renderUserMgmt(); }
function urCancelPass(){ urPassEdit=null; renderUserMgmt(); }

async function renderUserMgmt(){
  const body=document.getElementById('user-mgmt-body');
  if(!body) return;
  if(!(currentRole==='superadmin'||currentCap==='admin')){
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);">Nur Administratoren können Nutzer verwalten.</div>`;
    return;
  }
  const org = userMgmtOrg || currentOrg;
  if(!org){ body.innerHTML=`<div style="font-size:12px;color:var(--text3);">Kein Mandant gewählt (siehe docs/auth-mandanten.md).</div>`; return; }
  let users=[];
  try{ const qs=await db.collection('users').where('orgId','==',org).get(); qs.forEach(d=>users.push({id:d.id,...d.data()})); }catch(e){}
  users.sort((a,b)=>(a.email||'').localeCompare(b.email||''));
  body.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      ${users.length?users.map(urRow).join(''):`<div style="font-size:12px;color:var(--text3);">Noch keine Nutzer in diesem Mandanten.</div>`}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;">
      <input id="ur-new-email" class="form-control" type="email" placeholder="E-Mail" style="flex:1;min-width:150px;padding:5px 8px;font-size:12px;">
      <input id="ur-new-pass" class="form-control" type="text" placeholder="Start-Passwort (min. 6)" style="width:170px;padding:5px 8px;font-size:12px;">
      <select id="ur-new-role" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
        ${roleOptionsHtml('planer')}
      </select>
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px;white-space:nowrap;" onclick="addOrgUser()">+ Nutzer anlegen</button>
    </div>`;
}
function roleOptionsHtml(selected){
  let entries=Object.entries(rolesCache).filter(([k,r])=> k!=='fahrer' && (r.baseType!=='driver'));
  entries=entries.filter(([k])=> k!=='superadmin' || selected==='superadmin' || currentRole==='superadmin');
  if(selected && !entries.find(([k])=>k===selected)) entries.unshift([selected,{name:selected}]);
  return entries.sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0]))
    .map(([k,r])=>`<option value="${dlEsc(k)}"${k===selected?' selected':''}>${dlEsc(r.name||k)}</option>`).join('');
}
function urRow(u){
  const active=u.active!==false, editing=urPassEdit===u.id;
  const roleSel=`<select onchange="changeUserRole('${dlEsc(u.id)}',this.value)" title="Rolle ändern" style="font-size:11px;padding:2px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">
    ${roleOptionsHtml(u.role)}</select>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;flex-wrap:wrap;">
    <span style="flex:1;min-width:140px;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(u.email||u.id)}</span>
    ${roleSel}
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="ur-pass-${dlEsc(u.id)}" class="form-control" type="text" placeholder="neues Passwort" style="width:150px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveUserPass('${dlEsc(u.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urCancelPass()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urEditPass('${dlEsc(u.id)}')">Passwort</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleUserActive('${dlEsc(u.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;color:#c0392b;" onclick="deleteOrgUserUi('${dlEsc(u.id)}','${dlEsc(u.email||'')}')">Löschen</button>`}
  </div>`;
}
async function addOrgUser(){
  const email=(document.getElementById('ur-new-email')?.value||'').trim();
  const password=(document.getElementById('ur-new-pass')?.value||'').trim();
  const newRole=document.getElementById('ur-new-role')?.value||'planer';
  if(!email){ notify('Bitte E-Mail eingeben'); return; }
  if(password.length<6){ notify('Start-Passwort min. 6 Zeichen'); return; }
  try{ await dlFnCall('createOrgUser',{email,password,newRole,orgId:userMgmtOrg}); notify('✓ Nutzer angelegt'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function saveUserPass(uid){
  const password=(document.getElementById('ur-pass-'+uid)?.value||'').trim();
  if(password.length<6){ notify('Passwort min. 6 Zeichen'); return; }
  try{ await dlFnCall('setUserPassword',{uid,password}); urPassEdit=null; notify('✓ Passwort gesetzt'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function toggleUserActive(uid,currentlyActive){
  try{ await dlFnCall('setUserActive',{uid,active:!currentlyActive}); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function changeUserRole(uid,newRole){
  try{ await dlFnCall('setUserRole',{targetUid:uid,orgId:userMgmtOrg,role:newRole}); notify('✓ Rolle geändert'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); renderUserMgmt(); }
}
async function deleteOrgUserUi(uid,email){
  if(!confirm(`Konto „${email||uid}" endgültig löschen?\n\nDer Login wird entfernt. Erfasste Daten und Historie bleiben erhalten.`)) return;
  try{ await dlFnCall('deleteOrgUser',{uid}); notify('✓ Konto gelöscht'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function deleteDriverUi(driverId,name){
  if(!confirm(`Fahrer „${name||driverId}" löschen?\n\nDer PIN-Login wird entfernt. Tour-Historie bleibt erhalten.`)) return;
  try{ await db.collection('drivers').doc(driverId).delete(); notify('✓ Fahrer gelöscht'); renderDriverLogins(); }
  catch(e){ notify(dlErr(e)); }
}

// ─── ROLLEN & MODULE — laden, säen, verwalten ─────────────────
// Rollen sind mandantenscharf: orgs/{orgId}/roles. Fallback: alter globaler Katalog (Migration).
function rolesOrg(){ return benutzerOrg||currentOrg; }
let _orgNameCache={};
async function orgDisplayName(oid){
  if(_orgNameCache[oid]) return _orgNameCache[oid];
  try{ const s=await db.collection('orgs').doc(oid).get(); _orgNameCache[oid]=(s.exists&&s.data().name)||oid; }
  catch(_){ _orgNameCache[oid]=oid; }
  return _orgNameCache[oid];
}
function rolesCol(org){ return db.collection('orgs').doc(org).collection('roles'); }
async function loadRoles(org){
  rolesCache={};
  const o=org||rolesOrg();
  let found=false;
  if(o){ try{ const qs=await rolesCol(o).get(); qs.forEach(d=>{ rolesCache[d.id]={...d.data()}; found=true; }); }catch(e){} }
  if(!found){ try{ const qs=await db.collection('roles').get(); qs.forEach(d=>{ rolesCache[d.id]={...d.data()}; }); }catch(e){} } // Legacy global
  Object.entries(BUILTIN_ROLES).forEach(([k,v])=>{ if(!rolesCache[k]) rolesCache[k]={...v}; });
}
async function seedBuiltinRoles(org){
  if(!(currentRole==='superadmin'||currentCap==='admin')||!org) return;
  for(const [k,v] of Object.entries(BUILTIN_ROLES)){
    try{
      const ref=rolesCol(org).doc(k); const s=await ref.get();
      if(!s.exists){ await ref.set(v); }
      else {
        // fehlende (neue) Modul-Keys mit Vorlagen-Default ergänzen, Bestehendes nicht überschreiben
        const cur=s.data().modules||{}; const patch={};
        _allModKeys.forEach(mk=>{ if(cur[mk]===undefined) patch['modules.'+mk]=!!v.modules[mk]; });
        if(Object.keys(patch).length) await ref.update(patch);
      }
    }catch(e){}
  }
}
async function renderRollenView(){
  const el=document.getElementById('rollen-content'); if(!el) return;
  if(!(currentRole==='superadmin'||currentCap==='admin')){ el.innerHTML=`<div style="padding:24px;color:var(--text3);font-size:13px;">Nur Administratoren können Rollen verwalten.</div>`; return; }
  const org=rolesOrg();
  if(!org){ el.innerHTML=`<div style="padding:24px;color:var(--text3);font-size:13px;">Kein Mandant gewählt.</div>`; return; }
  await seedBuiltinRoles(org);
  await loadRoles(org);
  const cityName=await orgDisplayName(org);
  const roles=Object.entries(rolesCache).sort((a,b)=>(a[1].name||a[0]).localeCompare(b[1].name||b[0]));
  el.innerHTML=`<div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:10px;">Rollen der Stadt: ${dlEsc(cityName)} — Änderungen gelten nur für diesen Mandanten.</div>`+
    roles.map(([k,r])=>roleCard(k,r)).join('')+newRoleCard();
}
function roleCard(key,r){
  const bt=r.baseType||'editor';
  return `<div class="role-card" data-rolekey="${dlEsc(key)}" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:12px;">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
      <input class="form-control rc-name" value="${dlEsc(r.name||key)}" style="font-weight:700;font-size:14px;max-width:220px;padding:5px 8px;">
      <span style="font-size:11px;color:var(--text3);">Schlüssel: ${dlEsc(key)}</span>
      ${r.builtin?`<span style="font-size:10px;font-weight:700;color:var(--green);background:var(--green-light);padding:2px 8px;border-radius:99px;">Vorlage</span>`:''}
      <label style="font-size:12px;margin-left:auto;display:flex;align-items:center;gap:6px;">Basis-Typ
        <select class="rc-basetype" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          ${BASE_TYPES.map(b=>`<option value="${b.key}"${bt===b.key?' selected':''}>${b.label}</option>`).join('')}
        </select>
      </label>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 14px;margin-bottom:10px;">
      ${MODULES.map(m=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
        <input type="checkbox" class="rc-mod" data-mod="${m.key}"${r.modules&&r.modules[m.key]?' checked':''}> ${m.label}</label>`).join('')}
    </div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;" onclick="saveRole('${dlEsc(key)}')">Speichern</button>
      ${r.builtin?'':`<button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;color:#c0392b;" onclick="deleteRole('${dlEsc(key)}')">Löschen</button>`}
    </div>
  </div>`;
}
function newRoleCard(){
  return `<div style="background:var(--surface);border:1px dashed var(--border);border-radius:12px;padding:14px 16px;">
    <div style="font-size:13px;font-weight:700;margin-bottom:10px;">+ Neue Rolle</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px;">
      <input id="nr-name" class="form-control" placeholder="Rollenname (z.B. Sachbearbeiter)" style="max-width:260px;padding:5px 8px;font-size:13px;">
      <label style="font-size:12px;display:flex;align-items:center;gap:6px;">Basis-Typ
        <select id="nr-basetype" style="font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          ${BASE_TYPES.map(b=>`<option value="${b.key}">${b.label}</option>`).join('')}
        </select>
      </label>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:4px 14px;margin-bottom:10px;">
      ${MODULES.map(m=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;">
        <input type="checkbox" class="nr-mod" data-mod="${m.key}"> ${m.label}</label>`).join('')}
    </div>
    <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;" onclick="addRole()">Rolle anlegen</button>
  </div>`;
}
async function saveRole(key){
  const card=document.querySelector(`.role-card[data-rolekey="${CSS.escape(key)}"]`); if(!card) return;
  const name=card.querySelector('.rc-name').value.trim()||key;
  const baseType=card.querySelector('.rc-basetype').value;
  const modules={}; card.querySelectorAll('.rc-mod').forEach(c=>{ modules[c.dataset.mod]=c.checked; });
  const builtin=!!(rolesCache[key]&&rolesCache[key].builtin);
  try{ await rolesCol(rolesOrg()).doc(key).set({name,baseType,modules,builtin},{merge:true}); notify('✓ Rolle gespeichert (für diese Stadt)'); renderRollenView(); }
  catch(e){ notify(dlErr(e)); }
}
async function addRole(){
  const name=(document.getElementById('nr-name')?.value||'').trim();
  if(!name){ notify('Bitte Rollenname eingeben'); return; }
  const baseType=document.getElementById('nr-basetype').value;
  let key=name.toLowerCase().replace(/[äöü]/g,m=>({'ä':'ae','ö':'oe','ü':'ue'}[m])).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);
  if(!key) key='rolle_'+Math.floor(performance.now());
  if(rolesCache[key]){ notify('Eine Rolle mit diesem Schlüssel existiert bereits'); return; }
  const modules={}; document.querySelectorAll('.nr-mod').forEach(c=>{ modules[c.dataset.mod]=c.checked; });
  try{ await rolesCol(rolesOrg()).doc(key).set({name,baseType,modules,builtin:false}); notify('✓ Rolle angelegt (für diese Stadt)'); renderRollenView(); }
  catch(e){ notify(dlErr(e)); }
}
async function deleteRole(key){
  if(BUILTIN_ROLES[key]){ notify('Vorlagen können nicht gelöscht werden'); return; }
  if(!confirm(`Rolle „${rolesCache[key]?.name||key}" löschen?`)) return;
  try{ await rolesCol(rolesOrg()).doc(key).delete(); notify('✓ Rolle gelöscht'); renderRollenView(); }
  catch(e){ notify(dlErr(e)); }
}

// Module-Sichtbarkeit auf die Navigation anwenden
function applyModulePermissions(){
  const isSuper=currentRole==='superadmin';
  document.querySelectorAll('[data-module]').forEach(el=>{
    const mods=el.dataset.module.split(',').map(s=>s.trim());
    let ok;
    if(mods.includes('__superadmin__')) ok=isSuper;
    else if(mods.includes('__admin__')) ok=isSuper||currentCap==='admin';
    else ok=isSuper||mods.some(m=>canUseModule(m));
    el.style.display = ok ? '' : 'none';
  });
  // leere Nav-Gruppen ausblenden
  document.querySelectorAll('.topbar-nav .nav-group').forEach(g=>{
    const btns=[...g.querySelectorAll('.nav-dropdown button')];
    if(btns.length){ const any=btns.some(b=>b.style.display!=='none'); g.style.display=any?'':'none'; }
  });
}

async function seedDefaultReasons(){
  if(!currentProjectId)return;
  const defaults=['Zugang gesperrt','Baum krank / abgestorben','Gerät defekt','Kein Wasser verfügbar','Baum bereits bewässert','Baum nicht auffindbar','Witterung (Starkregen)','Sonstiges'];
  for(const text of defaults){
    await addDoc(collection(db,'projects',currentProjectId,'reasons'),{text,createdAt:serverTimestamp()});
  }
  await loadReasons();
  renderReasonsMgmt();
  notify('Standard-Gründe hinzugefügt');
}

// ── FAHRER MANAGEMENT ─────────────────────────────────────────
async function renderDriverMgmt(){
  const el=document.getElementById('driver-mgmt-list');if(!el)return;
  const org = driverLoginsOrg || currentOrg; // Mandant aus Schritt 2
  // Projekte des Mandanten laden → Projekt-Dropdown (Schritt 4)
  const projSel=document.getElementById('dta-project');
  let projs=[];
  if(org){ try{ const qs=await db.collection('projects').where('orgId','==',org).get(); projs=qs.docs.map(d=>({id:d.id,name:d.data().name||d.id})); }catch(e){} }
  projs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(!dtaProjectId || !projs.find(p=>p.id===dtaProjectId)){
    dtaProjectId = (projs.find(p=>p.id===currentProjectId)?.id) || projs[0]?.id || '';
  }
  if(projSel) projSel.innerHTML=projs.map(p=>`<option value="${dlEsc(p.id)}"${p.id===dtaProjectId?' selected':''}>${dlEsc(p.name)}</option>`).join('');
  if(!dtaProjectId){
    el.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--text3);">Kein Projekt in diesem Mandanten.</div>';return;
  }
  // Touren des gewählten Projekts + Personen des Mandanten laden
  let tlist=[],persons=[];
  try{ const ts=await db.collection('projects').doc(dtaProjectId).collection('tours').get(); tlist=ts.docs.map(d=>({id:d.id,...d.data()})); }catch(e){}
  try{ if(org){ const qs=await db.collection('drivers').where('orgId','==',org).get(); qs.forEach(d=>{ if(d.data().active!==false) persons.push(d.data().name); }); } }catch(e){}
  persons=[...new Set(persons.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  if(tlist.length===0){
    el.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--text3);">Dieses Projekt hat noch keine Touren.</div>';return;
  }
  // Spaltenanzahl: 3 bei ≥4 Touren, 2 bei 2-3, 1 bei 1
  const cols = tlist.length >= 4 ? 3 : tlist.length >= 2 ? 2 : 1;
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(${cols},1fr);">`+
    tlist.map((t,idx)=>{
      const isLastRow = idx >= tlist.length - (tlist.length % cols || cols);
      const borderRight = (idx+1) % cols !== 0 ? '1px solid var(--border)' : 'none';
      const borderBottom = !isLastRow ? '1px solid var(--border)' : 'none';
      const drivers=(t.drivers||[t.assignedDriver].filter(Boolean));
      const tags=drivers.map((d,i)=>
        `<span style="display:inline-flex;align-items:center;gap:3px;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:2px 8px;font-size:11px;">
          ${d}<button onclick="removeDriver('${t.id}',${i})" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;line-height:1;padding:0;">×</button>
        </span>`
      ).join('');
      return `<div style="background:var(--surface);padding:10px 12px;border-right:${borderRight};border-bottom:${borderBottom};">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${t.color};flex-shrink:0;"></div>
          <span style="font-size:12px;font-weight:600;">${t.name}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px;min-height:20px;">
          ${tags||'<span style="font-size:11px;color:var(--text3);">Kein Fahrer</span>'}
        </div>
        ${(()=>{ const avail=persons.filter(p=>!drivers.includes(p));
          if(persons.length===0) return `<div style="font-size:11px;color:var(--text3);">Keine Personen — unter „Personen &amp; PINs" anlegen.</div>`;
          if(avail.length===0) return `<div style="font-size:11px;color:var(--text3);">Alle Personen zugewiesen.</div>`;
          return `<div style="display:flex;gap:4px;">
            <select id="new-driver-${t.id}" style="flex:1;padding:4px 6px;font-size:11px;min-width:0;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
              <option value="">+ Person zuweisen…</option>${avail.map(p=>`<option value="${dlEsc(p)}">${dlEsc(p)}</option>`).join('')}
            </select>
            <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="addDriver('${t.id}')">+</button>
          </div>`; })()}
      </div>`;
    }).join('')+`</div>`;
}

async function addDriver(tourId){
  const inp=document.getElementById('new-driver-'+tourId);
  const name=inp?.value.trim();if(!name||!dtaProjectId)return;
  const ref=doc(db,'projects',dtaProjectId,'tours',tourId);
  const snap=await getDoc(ref); const d=snap.data()||{};
  const drivers=[...(d.drivers||[d.assignedDriver].filter(Boolean))];
  if(drivers.includes(name)){notify('Fahrer bereits vorhanden');return;}
  drivers.push(name);
  await updateDoc(ref,{drivers,assignedDriver:drivers[0]});
  notify('Fahrer hinzugefügt');
  renderDriverMgmt();
}

async function removeDriver(tourId,idx){
  if(!dtaProjectId)return;
  const ref=doc(db,'projects',dtaProjectId,'tours',tourId);
  const snap=await getDoc(ref); const d=snap.data()||{};
  const drivers=[...(d.drivers||[d.assignedDriver].filter(Boolean))];
  drivers.splice(idx,1);
  await updateDoc(ref,{drivers,assignedDriver:drivers[0]||''});
  notify('Fahrer entfernt');
  renderDriverMgmt();
}

// ── GRÜNDE MANAGEMENT ─────────────────────────────────────────
function renderReasonsMgmt(){
  const el=document.getElementById('reasons-mgmt-list');if(!el)return;
  if(reasons.length===0){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px 0 8px;">Noch keine Gründe für dieses Projekt.</div>'+
      '<button class="btn btn-secondary" style="font-size:12px;padding:5px 11px;" onclick="seedDefaultReasons()">+ Standard-Gründe hinzufügen</button>';
    return;
  }
  el.innerHTML=reasons.map(r=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:12px;">
      <span>${r.text}</span>
      <button onclick="deleteReasonMgmt('${r.id}')" style="border:none;background:none;color:var(--text3);cursor:pointer;font-size:15px;line-height:1;padding:0 4px;">×</button>
    </div>`).join('');
}

async function addReasonMgmt(){
  const inp=document.getElementById('new-reason-mgmt');
  const text=inp?.value.trim();
  if(!text||!currentProjectId)return;
  await addDoc(collection(db,'projects',currentProjectId,'reasons'),{text,createdAt:serverTimestamp()});
  inp.value='';
  await loadReasons();
  renderReasonsMgmt();
  notify('Grund hinzugefügt');
}

async function deleteReasonMgmt(id){
  if(!currentProjectId)return;
  await deleteDoc(doc(db,'projects',currentProjectId,'reasons',id));
  await loadReasons();
  renderReasonsMgmt();
  notify('Grund entfernt');
}

// ─── REASONS (Gründe Nicht-Bewässerung) ─────────────────────

async function loadReasons(){
  if(!currentProjectId)return;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'reasons'));
    reasons=snap.docs.map(d=>({id:d.id,...d.data()}));
  }catch(e){reasons=[];}
  renderReasonsList();
}

function renderReasonsList(){
  const el=document.getElementById('reasons-list');if(!el)return;
  if(reasons.length===0){
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px 0;">Noch keine Gründe. Standard-Gründe werden in der App verwendet.</div>';
    return;
  }
  el.innerHTML=reasons.map(r=>`
    <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border);">
      <span style="flex:1;font-size:13px;">${r.text}</span>
      <button class="btn btn-danger" style="padding:2px 8px;font-size:11px;" data-rid="${r.id}" onclick="deleteReason('${r.id}')">✕</button>
    </div>`).join('');
}

async function addReason(){
  const inp=document.getElementById('new-reason-input');
  const text=inp?.value.trim();
  if(!text||!currentProjectId)return;
  await addDoc(collection(db,'projects',currentProjectId,'reasons'),{text,createdAt:serverTimestamp()});
  inp.value='';
  await loadReasons();
  notify('Grund hinzugefügt');
}

async function deleteReason(id){
  if(!currentProjectId)return;
  await deleteDoc(doc(db,'projects',currentProjectId,'reasons',id));
  await loadReasons();
}

// ─── DRIVER ASSIGNMENT ────────────────────────────────────────
async function renderDriverAssignment(){
  const el=document.getElementById('driver-assignment');if(!el)return;
  if(tours.length===0){el.innerHTML='<div style="font-size:12px;color:var(--text3);">Noch keine Touren.</div>';return;}
  el.innerHTML=tours.map(t=>`
    <div style="display:flex;align-items:center;gap:8px;">
      <div style="width:10px;height:10px;border-radius:50%;background:${t.color};flex-shrink:0;"></div>
      <span style="font-size:12px;font-weight:600;min-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${t.name}</span>
      <input class="form-control" style="flex:1;padding:5px 8px;font-size:12px;" placeholder="Fahrername…" value="${t.assignedDriver||''}" data-tourid="${t.id}" onchange="saveDriverAssignment('${t.id}',this.value)">
    </div>`).join('');
}

async function saveDriverAssignment(tourId,driver){
  if(!currentProjectId)return;
  await updateDoc(doc(db,'projects',currentProjectId,'tours',tourId),{assignedDriver:driver.trim()});
  notify('Fahrer zugewiesen');
}

// ─── EXCEL IMPORT (mit Vorschau/Koordinaten-Kontrolle) ───────
let _importRows=[], _importSwap=false, _impMap=null, _impLayer=null, _importNew={};
// Spaltenüberschriften normalisieren (Umlaute/Sonderzeichen/Groß-klein egal)
function _normH(s){ return String(s==null?'':s).toLowerCase().replace(/ß/g,'ss').replace(/ä/g,'a').replace(/ö/g,'o').replace(/ü/g,'u').replace(/[^a-z0-9]/g,''); }
// Excel-Spaltenüberschriften → Feldschlüssel (Reihenfolge egal, Label ODER Alias erlaubt)
function buildImportMapping(headerRow){
  const map={}, coordCols=[];
  const labelFor={name:FL.name,stadtteil:FL.stadtteil,art:FL.art,baumnr:FL.baumnr,pflanzjahr:FL.pflanzjahr,pflanzzeitpunkt:FL.pflanzzeitpunkt,notiz:FL.notiz,zustand:FL.zustand,wasser:FL.wasser};
  const aliases={
    name:['name','anlage','anlagestrasse','strasse','objekt','objektname'],
    stadtteil:['stadtteil','bezirk','ortsteil','ortsbezirk'],
    art:['art','typ','typart','baumart','objektart'],
    baumnr:['baumnr','baumnummer','objektnummer','objektnr','nummer','nr'],
    pflanzjahr:['pflanzjahr','jahr'],
    pflanzzeitpunkt:['pflanzzeitpunkt','zeitpunkt'],
    notiz:['notiz','notizen','bemerkung','bemerkungen'],
    zustand:['zustand'],
    wasser:['wasser','wasserbedarf','prioritat','bedarf'],
  };
  const coordAliases=['lat','lng','latitude','longitude','breite','breitengrad','lange','langengrad','koordinate1','koordinate2','koordinate','rechtswert','hochwert','ostwert','nordwert','easting','northing','east','north','utm','gps','x','y','e','n'];
  const baumIdAliases=['objektid','baumid','interneid'];
  (headerRow||[]).forEach((h,i)=>{
    const n=_normH(h); if(!n) return;
    if(baumIdAliases.includes(n)){ if(map.baumId==null) map.baumId=i; return; }
    if(coordAliases.includes(n)){ coordCols.push(i); return; }
    for(const k of Object.keys(labelFor)){ if(n===_normH(labelFor[k]) || (aliases[k]||[]).includes(n)){ if(map[k]==null) map[k]=i; return; } }
    for(const c of customFields){ if(n===_normH(c.label)){ if(map[c.key]==null) map[c.key]=i; return; } }
  });
  map._coord=coordCols.slice(0,2);
  return map;
}
// Zustand/Priorität-Zelle (Label oder Schlüssel) → stabile id; leer/unbekannt → 'mittel'
function mapRankImport(fk,val){
  const v=_normH(val); if(!v) return 'mittel';
  const e=rankList(fk).find(x=>_normH(x.id)===v||_normH(x.label)===v);
  return e?e.id:'mittel';
}
// Welche Listenwerte aus dem Import sind neu (würden angelegt)?
function detectNewListValues(parsed){
  const res={};
  ['stadtteil','pflanzjahr','pflanzzeitpunkt',...customFields.map(c=>c.key)].forEach(k=>{
    const have=new Set((listValues[k]||[]).map(e=>e.label));
    const news=[...new Set(parsed.map(r=>(r[k]||'').toString().trim()).filter(Boolean))].filter(v=>!have.has(v));
    if(news.length) res[k]=news;
  });
  const haveArt=new Set(artenList.map(a=>a.name));
  const newArt=[...new Set(parsed.map(r=>(r.art||'').trim()).filter(Boolean))].filter(v=>!haveArt.has(v));
  if(newArt.length) res.art=newArt;
  return res;
}
// Importvorlage (Excel) mit aktuellen Überschriften + Beispielzeile
function downloadImportTemplate(){
  const XLSX=window.XLSX; if(!XLSX){ notify('SheetJS nicht geladen'); return; }
  const headers=[FL.name,FL.stadtteil,FL.baumnr,FL.art,FL.pflanzjahr,FL.pflanzzeitpunkt,FL.zustand,FL.wasser,...customFields.map(c=>c.label),FL.notiz,'Koordinate 1','Koordinate 2'];
  const ex=['Berliner Platz 23','Innenstadt','118-0044','Ahorn','2020','Frühjahr',(rankList('zustand')[0]?.label||'Gut'),(rankList('wasser')[0]?.label||'Gering'),...customFields.map(()=>''),'Beispiel-Notiz','49.4830','8.4450'];
  const ws=XLSX.utils.aoa_to_sheet([headers,ex]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Objekte');
  XLSX.writeFile(wb,'Importvorlage.xlsx');
}
// Voll-Export aller (aktiven) Objekte — spiegelbildlich zur Vorlage; Objekt-ID ermöglicht Re-Import als Update
function downloadObjectsExport(){
  const XLSX=window.XLSX; if(!XLSX){ notify('SheetJS nicht geladen'); return; }
  const headers=[FL.name,FL.stadtteil,FL.baumnr,FL.art,FL.pflanzjahr,FL.pflanzzeitpunkt,FL.zustand,FL.wasser,...customFields.map(c=>c.label),FL.notiz,'Koordinate 1','Koordinate 2','Objekt-ID'];
  const list=trees.filter(isActive);
  const rows=list.map(t=>[
    t.name||'', t.stadtteil||'', t.baumnr||'', t.art||'', t.pflanzjahr||'', t.pflanzzeitpunkt||'',
    rankLabel('zustand',t.zustand), rankLabel('wasser',t.wasser),
    ...customFields.map(c=>t[c.key]||''),
    t.notiz||'', (t.lat==null?'':t.lat), (t.lng==null?'':t.lng), t.baumId||'',
  ]);
  const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Objekte');
  XLSX.writeFile(wb, ((currentProjectData?.name||'Objekte').replace(/[^\w-]+/g,'_'))+'_Export.xlsx');
  notify(`✓ ${list.length} Objekte exportiert`);
}
// Zahl robust parsen (auch Dezimal-Komma "52,28")
function impNum(v){ if(v==null)return NaN; if(typeof v==='number')return v; return parseFloat(String(v).trim().replace(',','.')); }
// Plausibel in Deutschland?
function impInDE(la,lo){ return la>47&&la<55.5&&lo>5&&lo<16; }
// ETRS89/UTM (EPSG:25832/25833) -> WGS84 (Snyder-Inverse, GRS80≈WGS84)
function utmToLatLng(easting,northing,zone){
  const a=6378137.0,f=1/298.257223563,e2=f*(2-f);
  const e1=(1-Math.sqrt(1-e2))/(1+Math.sqrt(1-e2)),k0=0.9996;
  const x=easting-500000.0,y=northing;
  const M=y/k0,mu=M/(a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
  const phi1=mu+(3*e1/2-27*e1**3/32)*Math.sin(2*mu)+(21*e1*e1/16-55*e1**4/32)*Math.sin(4*mu)+(151*e1**3/96)*Math.sin(6*mu)+(1097*e1**4/512)*Math.sin(8*mu);
  const ep2=e2/(1-e2),C1=ep2*Math.cos(phi1)**2,T1=Math.tan(phi1)**2;
  const N1=a/Math.sqrt(1-e2*Math.sin(phi1)**2),R1=a*(1-e2)/Math.pow(1-e2*Math.sin(phi1)**2,1.5),D=x/(N1*k0);
  const lat=phi1-(N1*Math.tan(phi1)/R1)*(D*D/2-(5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24+(61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720);
  const lon0=(zone*6-183)*Math.PI/180;
  const lon=lon0+(D-(1+2*T1+C1)*D**3/6+(5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120)/Math.cos(phi1);
  return {lat:lat*180/Math.PI,lng:lon*180/Math.PI};
}
// Zwei Zahlen -> {lat,lng}: Grad direkt, sonst als ETRS89/UTM erkennen (Werte weit außerhalb des Gradbereichs)
function impCoords(a,b){
  if(isNaN(a)||isNaN(b)) return {lat:null,lng:null};
  if(Math.abs(a)<=1000 && Math.abs(b)<=1000) return {lat:a,lng:b}; // Dezimalgrad
  const A=Math.abs(a), B=Math.abs(b);
  // Northing = Wert im DE-Bereich (~5,2–6,1 Mio); der andere ist Easting (egal welche Spalte)
  let northing,easting;
  if(A>=4000000&&A<=7000000){ northing=A; easting=B; }
  else if(B>=4000000&&B<=7000000){ northing=B; easting=A; }
  else { northing=Math.max(A,B); easting=Math.min(A,B); }
  let zone=32; // Standard DE-West (EPSG:25832)
  if(easting>=1000000){ const z=Math.floor(easting/1000000); if(z===32||z===33){ zone=z; easting=easting%1000000; } } // Zonen-Präfix (z. B. 32460696)
  const r=utmToLatLng(easting,northing,zone);
  if(impInDE(r.lat,r.lng)) return {lat:r.lat,lng:r.lng};
  const r2=utmToLatLng(easting,northing,zone===32?33:32); // andere Zone probieren (Ost-DE)
  return impInDE(r2.lat,r2.lng)?{lat:r2.lat,lng:r2.lng}:{lat:r.lat,lng:r.lng};
}

async function importExcel(input){
  if(!currentProjectId){notify('Bitte zuerst ein Projekt öffnen');return;}
  const file=input.files[0];if(!file)return;
  notify('Excel wird eingelesen…');
  const XLSX=window.XLSX;
  if(!XLSX){notify('SheetJS nicht geladen');return;}
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1});
  input.value='';
  if(rows.length<2){ notify('Keine Datenzeilen gefunden'); return; }
  const map=buildImportMapping(rows[0]);
  if(map.name==null){ notify('Spalte „'+FL.name+'" nicht gefunden — bitte Überschriften prüfen (Vorlage nutzen).'); return; }
  const [c0,c1]=map._coord;
  const get=(row,k)=> map[k]!=null ? row[map[k]] : undefined;
  const parsed=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i]; if(!row||!row.length) continue;
    if(row.every(c=>c==null||String(c).trim()==='')) continue; // Leerzeile
    const {lat,lng}=(c0!=null&&c1!=null)?impCoords(impNum(row[c0]),impNum(row[c1])):{lat:null,lng:null};
    const o={
      name:(get(row,'name')??'')||'Unbekannt',
      stadtteil:String(get(row,'stadtteil')??'').trim(),
      art:String(get(row,'art')??'').trim(),
      baumnr:String(get(row,'baumnr')??'').trim(),
      pflanzjahr:String(get(row,'pflanzjahr')??'').trim(),
      pflanzzeitpunkt:String(get(row,'pflanzzeitpunkt')??'').trim(),
      notiz:get(row,'notiz')??'',
      zustand:mapRankImport('zustand',get(row,'zustand')),
      wasser:mapRankImport('wasser',get(row,'wasser')),
      baumId:String(get(row,'baumId')??'').trim(),
      lat, lng,
    };
    customFields.forEach(c=>{ if(map[c.key]!=null) o[c.key]=String(row[map[c.key]]??'').trim(); });
    parsed.push(o);
  }
  if(!parsed.length){ notify('Keine Datenzeilen gefunden'); return; }
  _importRows=parsed;
  _importNew=detectNewListValues(parsed);
  // Auto-Empfehlung: tauschen, wenn dadurch mehr Punkte in DE liegen
  let normalIn=0, swapIn=0;
  parsed.forEach(r=>{ if(r.lat!=null&&r.lng!=null){ if(impInDE(r.lat,r.lng))normalIn++; if(impInDE(r.lng,r.lat))swapIn++; } });
  _importSwap = swapIn>normalIn;
  showImportPreview();
}

function closeImportPreview(){
  if(_impMap){ try{_impMap.remove();}catch(e){} _impMap=null; _impLayer=null; }
  document.getElementById('import-preview-modal')?.remove();
}

function showImportPreview(){
  closeImportPreview();
  const m=document.createElement('div');
  m.id='import-preview-modal';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-md);width:760px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
      <div style="flex:1;"><div style="font-size:15px;font-weight:700;">Import-Vorschau — Koordinaten prüfen</div>
        <div id="imp-summary" style="font-size:12px;color:var(--text3);margin-top:2px;">–</div></div>
      <button id="imp-x" style="border:none;background:none;font-size:22px;color:var(--text2);cursor:pointer;line-height:1;">×</button>
    </div>
    <div id="imp-warn" style="display:none;padding:8px 18px;background:var(--red-light);color:var(--red);font-size:12px;font-weight:600;"></div>
    <div id="imp-newvals" style="display:none;padding:8px 18px;background:var(--green-light);color:var(--text2);font-size:11px;line-height:1.5;border-bottom:1px solid var(--border);"></div>
    <div style="padding:10px 18px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);">
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">
        <input type="checkbox" id="imp-swap"> Längen-/Breitengrad tauschen (lat ↔ lng)
      </label>
      <span style="margin-left:auto;font-size:11px;color:var(--text3);">Blaue Punkte = Lage nach Import</span>
    </div>
    <div id="imp-map" style="flex:1;min-height:320px;"></div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="imp-cancel" style="padding:8px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-weight:600;">Abbrechen</button>
      <button id="imp-go" style="padding:8px 18px;border:none;border-radius:6px;background:var(--green);color:#fff;cursor:pointer;font-weight:700;">Importieren</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  // Hinweis auf neue Listenwerte, die beim Import angelegt werden
  const nv=document.getElementById('imp-newvals');
  if(nv){
    const lblFor=k=> k==='art'?FL.art:(customFields.find(c=>c.key===k)?.label||({stadtteil:FL.stadtteil,pflanzjahr:FL.pflanzjahr,pflanzzeitpunkt:FL.pflanzzeitpunkt}[k]||k));
    const parts=Object.entries(_importNew||{}).map(([k,vals])=>`<b>${dlEsc(lblFor(k))}</b>: ${vals.slice(0,8).map(dlEsc).join(', ')}${vals.length>8?` … (+${vals.length-8})`:''}`);
    if(parts.length){ nv.style.display='block'; nv.innerHTML='Neue Listenwerte, die beim Import automatisch angelegt werden:<br>'+parts.join('<br>'); }
  }
  const sw=document.getElementById('imp-swap'); sw.checked=_importSwap;
  sw.onchange=()=>{ _importSwap=sw.checked; renderImportPreview(); };
  document.getElementById('imp-x').onclick=closeImportPreview;
  document.getElementById('imp-cancel').onclick=closeImportPreview;
  document.getElementById('imp-go').onclick=doImport;
  m.onclick=e=>{ if(e.target===m)closeImportPreview(); };
  // Karte initialisieren
  try{
    _impMap=L.map('imp-map',{zoomControl:true}).setView([51,9],5);
    L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18,attribution:BASEMAP_ATTR}).addTo(_impMap);
    _impLayer=L.layerGroup().addTo(_impMap);
    setTimeout(()=>{ try{_impMap.invalidateSize();}catch(e){} renderImportPreview(); },200);
  }catch(e){ renderImportPreview(); }
}

function renderImportPreview(){
  const withC=_importRows.filter(r=>r.lat!=null&&r.lng!=null);
  let inDE=0; const pts=[];
  if(_impLayer) _impLayer.clearLayers();
  withC.forEach(r=>{
    const la=_importSwap?r.lng:r.lat, lo=_importSwap?r.lat:r.lng;
    if(impInDE(la,lo)) inDE++;
    if(_impLayer){ L.circleMarker([la,lo],{radius:4,color:'#1d4ed8',fillColor:'#1d4ed8',fillOpacity:.6,weight:1}).addTo(_impLayer); }
    pts.push([la,lo]);
  });
  const out=withC.length-inDE;
  const sum=document.getElementById('imp-summary');
  if(sum) sum.textContent=`${_importRows.length} Zeilen · ${withC.length} mit Koordinaten · ${_importRows.length-withC.length} ohne · ${inDE} in Deutschland`;
  const warn=document.getElementById('imp-warn');
  if(warn){
    if(out>0){ warn.style.display='block'; warn.textContent=`⚠ ${out} Objekt(e) liegen außerhalb Deutschlands — Koordinaten evtl. vertauscht. Schalter oben nutzen und Karte prüfen.`; }
    else { warn.style.display='none'; }
  }
  if(_impMap && pts.length){ try{ _impMap.fitBounds(L.latLngBounds(pts),{padding:[30,30],maxZoom:15}); }catch(e){} }
}

async function doImport(){
  const btn=document.getElementById('imp-go'); if(btn){ btn.textContent='Importiert…'; btn.disabled=true; }
  let imported=0, updated=0;
  try{
    // Baum-Zähler EINMAL lesen, lokal hochzählen, am Ende EINMAL schreiben (statt pro Objekt)
    const projRef=doc(db,'projects',currentProjectId);
    const projSnap=await getDoc(projRef);
    let counter=projSnap.data()?.lastBaumId||0;
    const colRef=collection(db,'projects',currentProjectId,'trees');
    // Bestehende Objekt-IDs → Dok-ID (für Re-Import als Update aus dem Export-Kreislauf)
    const byBaumId=new Map(trees.filter(t=>t.baumId).map(t=>[t.baumId,t.id]));
    const CH=450; // Firestore-Batch-Limit ist 500
    for(let i=0;i<_importRows.length;i+=CH){
      const batch=db.batch();
      for(const r of _importRows.slice(i,i+CH)){
        const la=_importSwap?r.lng:r.lat, lo=_importSwap?r.lat:r.lng;
        const fields={
          name:r.name, stadtteil:r.stadtteil, art:r.art, baumnr:r.baumnr,
          pflanzjahr:r.pflanzjahr, pflanzzeitpunkt:r.pflanzzeitpunkt, notiz:r.notiz,
          lat:(la==null?null:la), lng:(lo==null?null:lo),
          wasser:r.wasser||'mittel', zustand:r.zustand||'mittel',
        };
        customFields.forEach(c=>{ if(r[c.key]!=null) fields[c.key]=r[c.key]; });
        const existId = r.baumId && byBaumId.get(r.baumId);
        if(existId){ batch.update(colRef.doc(existId), fields); updated++; }
        else {
          counter++;
          batch.set(colRef.doc(),{
            ...fields, datum:'',tourId:'',tourIds:[],history:[],
            baumId:'B-'+String(counter).padStart(5,'0'), createdAt:serverTimestamp(),
            orgId: currentProjectData?.orgId || currentOrg,
          });
          imported++;
        }
      }
      if(btn) btn.textContent=`Verarbeitet… ${Math.min(imported+updated,_importRows.length)}/${_importRows.length}`;
      await batch.commit();
    }
    await updateDoc(projRef,{lastBaumId:counter}); // Zähler einmal final setzen
    // Neue Listenwerte (außer Typ/Art — das übernimmt buildArten) anlegen
    let lvChanged=false;
    Object.entries(_importNew||{}).forEach(([k,vals])=>{
      if(k==='art') return;
      listValues[k]=listValues[k]||[];
      const have=new Set(listValues[k].map(e=>e.label));
      vals.forEach(v=>{ if(!have.has(v)){ listValues[k].push({id:_genId(),label:v}); have.add(v); lvChanged=true; } });
    });
    if(lvChanged) await saveListValues();
  }catch(e){ notify('Import-Fehler: '+e.message); }
  closeImportPreview();
  notify(`✓ ${imported} neu${updated?` · ${updated} aktualisiert`:''}${_importSwap?' · Koordinaten getauscht':''}`);
  // Arten-Liste nachziehen (neue Typen bekommen IDs); verzögert, bis Snapshot da ist
  if(!isReadonly()) setTimeout(()=>{ if(currentProjectId) buildArten().catch(()=>{}); }, 1800);
}

// ─── BAUM ID ──────────────────────────────────────────────────
async function getNextBaumId(){
  // Read current counter from project, increment atomically
  const projRef=doc(db,'projects',currentProjectId);
  const projSnap=await getDoc(projRef);
  const current=projSnap.data()?.lastBaumId||0;
  const next=current+1;
  await updateDoc(projRef,{lastBaumId:next});
  // Format: B-00001, B-00002, ...
  return 'B-'+String(next).padStart(5,'0');
}

// ─── CONTROLLING ─────────────────────────────────────────────
// Cache tourHistory for controlling (authoritative source)
window._tourHistoryCache = null;

async function loadTourHistoryForControlling(){
  if(!currentProjectId)return;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
    window._tourHistoryCache={
      projectId:currentProjectId,
      entries:snap.docs.map(d=>normalizeHistory({id:d.id,...d.data()}))
    };
    // Re-render controlling with fresh data
    if(currentView==='controlling') renderControlling();
  }catch(e){ console.warn('tourHistory load error:',e); }
}

// ─── CONTROLLING ─────────────────────────────────────────────
async function refreshControlling(silent=false){
  // Manuelles Aktualisieren: tourHistory frisch aus Firestore laden + neu rendern
  const icon=document.getElementById('ctrl-refresh-icon');
  if(icon) icon.style.animation='spin .7s linear infinite';

  await loadTourHistoryForControlling();
  updateCtrlLastUpdated();

  if(icon) setTimeout(()=>icon.style.animation='',700);
  if(!silent) notify('Controlling aktualisiert');
}

function updateCtrlLastUpdated(){
  const el=document.getElementById('ctrl-last-updated');
  if(!el)return;
  const now=new Date();
  const t=now.toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  el.textContent=`Letzte Aktualisierung: ${t}`;
}

// ─── CONTROLLING ─────────────────────────────────────────────
let ctrlPeriod='month';
let ctrlCharts={};

function setCtrlPeriod(p,el){
  ctrlPeriod=p;
  document.querySelectorAll('.ctrl-period-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  const customDiv=document.getElementById('ctrl-custom-dates');
  if(customDiv) customDiv.style.display=p==='custom'?'flex':'none';
  if(p!=='custom') renderControlling();
}

function getCtrlDateRange(){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(ctrlPeriod==='today'){
    return {from:today,to:new Date(today.getTime()+86400000-1)};
  } else if(ctrlPeriod==='week'){
    const isoDow=(today.getDay()+6)%7; // Mo=0 … So=6
    const mon=new Date(today);mon.setDate(today.getDate()-isoDow);
    return {from:mon,to:new Date(mon.getTime()+7*86400000-1)};
  } else if(ctrlPeriod==='month'){
    return {from:new Date(now.getFullYear(),now.getMonth(),1),
            to:new Date(now.getFullYear(),now.getMonth()+1,0)};
  } else {
    const f=document.getElementById('ctrl-date-from')?.value;
    const t=document.getElementById('ctrl-date-to')?.value;
    return {from:f?new Date(f):new Date(0),to:t?new Date(t+'T23:59:59'):new Date()};
  }
}

function inCtrlRange(dateStr){
  if(!dateStr)return false;
  // Normalize: take only date part (YYYY-MM-DD) for comparison
  const datePart = typeof dateStr==='string' ? dateStr.slice(0,10) : new Date(dateStr).toISOString().slice(0,10);
  const d = new Date(datePart + 'T00:00:00');
  const {from,to} = getCtrlDateRange();
  return d >= from && d <= to;
}

function initControlling(){
  // Refresh tourHistory cache on every open
  window._tourHistoryCache=null;
  loadTourHistoryForControlling();
  // Untere Historie-Liste bei Projektwechsel automatisch neu laden,
  // falls sie für ein anderes Projekt bereits geladen war.
  if(_histListProject && _histListProject!==currentProjectId) loadTourHistory();
  const prev=(id)=>document.getElementById(id)?.value||'';

  // Tours
  const tourSel=document.getElementById('ctrl-filter-tour');
  if(tourSel) tourSel.innerHTML='<option value="">Alle Touren</option>'+
    tours.map(t=>`<option value="${t.id}"${t.id===prev('ctrl-filter-tour')?' selected':''}>${t.name}</option>`).join('');

  // Stadtteile
  const stadtSel=document.getElementById('ctrl-filter-stadtteil');
  if(stadtSel){
    const vals=[...new Set(trees.map(t=>t.stadtteil).filter(Boolean))].sort();
    stadtSel.innerHTML='<option value="">Alle Stadtteile</option>'+
      vals.map(v=>`<option value="${v}"${v===prev('ctrl-filter-stadtteil')?' selected':''}>${v}</option>`).join('');
  }

  // Pflanzjahr
  const jahrSel=document.getElementById('ctrl-filter-pflanzjahr');
  if(jahrSel){
    const vals=[...new Set(trees.map(t=>t.pflanzjahr).filter(Boolean))].sort();
    jahrSel.innerHTML='<option value="">Alle Pflanzjahre</option>'+
      vals.map(v=>`<option value="${v}"${v===prev('ctrl-filter-pflanzjahr')?' selected':''}>${v}</option>`).join('');
  }

  // Fahrer
  const fahrerSel=document.getElementById('ctrl-filter-fahrer');
  if(fahrerSel){
    const vals=[...new Set(trees.map(t=>t.lastDriver).filter(Boolean))].sort();
    fahrerSel.innerHTML='<option value="">Alle Fahrer</option>'+
      vals.map(v=>`<option value="${v}"${v===prev('ctrl-filter-fahrer')?' selected':''}>${v}</option>`).join('');
  }

  // Baumart
  const baumartSel=document.getElementById('ctrl-filter-baumart');
  if(baumartSel){
    const vals=[...new Set(trees.map(t=>t.art).filter(Boolean))].sort();
    baumartSel.innerHTML='<option value="">Alle Baumarten</option>'+
      vals.map(v=>`<option value="${v}"${v===prev('ctrl-filter-baumart')?' selected':''}>${v}</option>`).join('');
  }

  renderControlling();
}

function resetCtrlFilters(){
  ['ctrl-filter-tour','ctrl-filter-stadtteil','ctrl-filter-pflanzjahr',
   'ctrl-filter-status','ctrl-filter-fahrer','ctrl-filter-baumart',
   'ctrl-date-from','ctrl-date-to'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.value='';
  });
  // Reset period to month
  ctrlPeriod='month';
  document.querySelectorAll('.ctrl-period-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector('.ctrl-period-btn[data-period="month"]')?.classList.add('active');
  document.getElementById('ctrl-custom-dates').style.display='none';
  renderControlling();
}

function getCtrlFilteredTrees(){
  const tourId=document.getElementById('ctrl-filter-tour')?.value||'';
  const stadtteil=document.getElementById('ctrl-filter-stadtteil')?.value||'';
  const pflanzjahr=document.getElementById('ctrl-filter-pflanzjahr')?.value||'';
  const status=document.getElementById('ctrl-filter-status')?.value||'';
  const fahrer=document.getElementById('ctrl-filter-fahrer')?.value||'';
  const baumart=document.getElementById('ctrl-filter-baumart')?.value||'';

  return trees.filter(t=>{
    if(!isActive(t))return false; // archivierte Objekte nicht in Controlling-Gesamt/offen
    if(tourId&&!treeInTour(t,tourId))return false;
    if(stadtteil&&t.stadtteil!==stadtteil)return false;
    if(pflanzjahr&&t.pflanzjahr!==pflanzjahr)return false;
    if(baumart&&t.art!==baumart)return false;
    if(fahrer&&t.lastDriver!==fahrer)return false;
    // Status filter: only filter trees, actual report filtering happens on allReported
    // (status filter applied post-build in renderControlling)
    return true;
  });
}

function renderControlling(){
  if(!currentProjectId){ document.getElementById('ctrl-kpis').innerHTML='<div style="padding:20px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; }
  const filtered=getCtrlFilteredTrees();
  const {from,to}=getCtrlDateRange();

  // Show active filter summary
  const activeFilters=[];
  const fTour=document.getElementById('ctrl-filter-tour')?.value;
  const fStadt=document.getElementById('ctrl-filter-stadtteil')?.value;
  const fJahr=document.getElementById('ctrl-filter-pflanzjahr')?.value;
  const fStatus=document.getElementById('ctrl-filter-status')?.value;
  const fFahrer=document.getElementById('ctrl-filter-fahrer')?.value;
  const fBaumart=document.getElementById('ctrl-filter-baumart')?.value;
  if(fTour) activeFilters.push(`Tour: ${tours.find(t=>t.id===fTour)?.name||fTour}`);
  if(fStadt) activeFilters.push(`Stadtteil: ${fStadt}`);
  if(fJahr) activeFilters.push(`Pflanzjahr: ${fJahr}`);
  if(fStatus) activeFilters.push(`Status: ${{bewaessert:'✓ Erledigt',nicht:'✕ Nicht erledigt',offen:'○ Offen'}[fStatus]}`);
  if(fFahrer) activeFilters.push(`Fahrer: ${fFahrer}`);
  if(fBaumart) activeFilters.push(`Baumart: ${fBaumart}`);
  const summaryEl=document.getElementById('ctrl-filter-summary');
  const summaryTxt=document.getElementById('ctrl-filter-summary-text');
  if(summaryEl&&summaryTxt){
    if(activeFilters.length>0){
      summaryEl.style.display='flex';
      summaryTxt.textContent=`Aktive Filter: ${activeFilters.join(' · ')} — ${filtered.length} Objekte`;
    } else {
      summaryEl.style.display='none';
    }
  }

  // PRIMARY SOURCE: tourHistory snapshots (authoritative, manually editable)
  // These are loaded async — we use cached version if available
  const allReported=[];

  if(window._tourHistoryCache&&window._tourHistoryCache.projectId===currentProjectId){
    // Use cached tourHistory
    window._tourHistoryCache.entries.forEach(h=>{
      if(!inCtrlRange(h.date))return;
      (h.trees||[]).forEach(tree=>{
        if(!tree.lastStatus||tree.lastStatus==='offen')return;
        // Tour-Zuordnung liegt im tourHistory-Kopf (h.tourId), nicht im Baum-Snapshot
        const repTourId=h.tourId||tree.tourId||null;
        // Only include trees that match current filters
        const tourId=document.getElementById('ctrl-filter-tour')?.value||'';
        const stadtteil=document.getElementById('ctrl-filter-stadtteil')?.value||'';
        const pflanzjahr=document.getElementById('ctrl-filter-pflanzjahr')?.value||'';
        const fahrer=document.getElementById('ctrl-filter-fahrer')?.value||'';
        const baumart=document.getElementById('ctrl-filter-baumart')?.value||'';
        if(tourId&&repTourId!==tourId&&!treeInTour(tree,tourId))return;
        if(stadtteil&&tree.stadtteil!==stadtteil)return;
        if(pflanzjahr&&tree.pflanzjahr!==pflanzjahr)return;
        if(fahrer&&tree.lastDriver!==fahrer)return;
        if(baumart&&tree.art!==baumart)return;
        allReported.push({
          ...tree,
          tourId:repTourId,
          _fromHistory:true,
          _tourHistoryId:h.id,
          _tourHistoryDate:h.date,
          lastReportAt:tree.lastReportAt||h.date,
          _projectName:currentProjectData?.name||currentProjectId,
        });
      });
    });
  } else {
    // Fallback: use tree.history[] while tourHistory loads in background
    filtered.forEach(tree=>{
      (tree.history||[]).forEach(h=>{
        if(!h.date||!inCtrlRange(h.date))return;
        if(!h.status||h.status==='offen')return;
        allReported.push({
          ...tree,_fromHistory:true,
          lastStatus:h.status,lastReason:h.reason||null,
          lastNote:h.note||null,lastDriver:h.driver||null,
          lastReportAt:h.date,
          _projectName:currentProjectData?.name||currentProjectId,
        });
      });
      // Current status if not in history
      if(tree.lastStatus&&tree.lastStatus!=='offen'&&tree.lastReportAt){
        const d=tree.lastReportAt.slice?tree.lastReportAt.slice(0,10):tree.lastReportAt;
        if(inCtrlRange(d)){
          const inHist=(tree.history||[]).some(h=>h.date===d&&h.status===tree.lastStatus);
          if(!inHist) allReported.push({...tree,_fromHistory:false,_projectName:currentProjectData?.name||currentProjectId});
        }
      }
    });
    // Trigger background load of tourHistory
    loadTourHistoryForControlling();
  }

  allReported.sort((a,b)=>(b.lastReportAt||'').localeCompare(a.lastReportAt||''));

  // Apply status filter to allReported AFTER building (handles history entries too)
  const statusFilter=document.getElementById('ctrl-filter-status')?.value||'';
  const finalReported = statusFilter
    ? allReported.filter(r=>{
        if(statusFilter==='bewaessert') return r.lastStatus==='bewaessert';
        if(statusFilter==='nicht') return r.lastStatus==='nicht';
        if(statusFilter==='offen') return false; // offen = no report = not in table
        return true;
      })
    : allReported;

  // For KPI counters: use current status if set, else look at today's history
  const today=new Date().toISOString().slice(0,10);
  // KPIs: count unique trees reported in range (from current status + history)
  // ── Jede Meldung zählt einzeln — keine Gruppierung ──────────────
  const bewaessert=allReported.filter(r=>r.lastStatus==='bewaessert');
  const nicht=allReported.filter(r=>r.lastStatus==='nicht');
  const reportedTreeIds=new Set(allReported.map(r=>r.id));
  const offen=filtered.filter(t=>!reportedTreeIds.has(t.id));
  const totalReported=bewaessert.length+nicht.length;
  const pct=totalReported>0?Math.round(bewaessert.length/totalReported*100):0;

  // ── KPI Cards ─────────────────────────────────────────────────
  const activeFahrer=[...new Set(allReported.map(r=>r.lastDriver).filter(Boolean))].length;
  const kpiEl=document.getElementById('ctrl-kpis');
  if(kpiEl) kpiEl.innerHTML=[
    {val:filtered.length,lbl:'Gesamt',sub:'Objekte im Projekt',color:'var(--text)'},
    {val:bewaessert.length,lbl:'Erledigt',sub:`${pct}% der Meldungen`,color:'#16a34a'},
    {val:nicht.length,lbl:'Nicht erledigt',sub:'Einzelmeldungen',color:'var(--red)'},
    {val:totalReported,lbl:'Meldungen gesamt',sub:'im Zeitraum',color:'var(--text2)'},
    {val:activeFahrer,lbl:'Aktive Fahrer',sub:'im Zeitraum',color:'var(--blue)'},
  ].map(k=>`<div class="kpi-card">
    <div class="kpi-val" style="color:${k.color};">${k.val}</div>
    <div class="kpi-info">
      <div class="kpi-lbl">${k.lbl}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>
  </div>`).join('');

  // ── Charts ─────────────────────────────────────────────────────
  // Charts use finalReported so status filter applies everywhere
  const finalBew=finalReported.filter(r=>r.lastStatus==='bewaessert').length;
  const finalNicht=finalReported.filter(r=>r.lastStatus==='nicht').length;
  // Charts: use unique tree counts for pie, all reports for bar/timeline
  const finalBewCount=finalReported.filter(r=>r.lastStatus==='bewaessert').length;
  const finalNichtCount=finalReported.filter(r=>r.lastStatus==='nicht').length;
  renderPieChart(finalBewCount,finalNichtCount);
  renderBarChart(filtered,finalReported);
  renderTimelineChart(finalReported,from,to);
  renderStadtteilChart(filtered,finalReported);
  renderReasonsBar(finalReported.filter(r=>r.lastStatus==='nicht'));
  renderDetailTable(finalReported);
  updateCtrlLastUpdated();
}

function destroyChart(id){
  if(ctrlCharts[id]){try{ctrlCharts[id].destroy();}catch(e){}delete ctrlCharts[id];}
}

function renderPieChart(bew,nicht){
  destroyChart('pie');
  const canvas=document.getElementById('ctrl-pie');if(!canvas)return;
  if(!window.Chart){setTimeout(()=>renderControlling(),500);return;}
  const total=bew+nicht;
  ctrlCharts['pie']=new Chart(canvas,{
    type:'doughnut',
    data:{
      labels:['Erledigt','Nicht erledigt'],
      datasets:[{data:[bew,nicht],backgroundColor:['#16a34a','#991b1b'],borderWidth:0,hoverOffset:6}]
    },
    options:{responsive:false,cutout:'65%',plugins:{
      legend:{position:'bottom',labels:{font:{size:11},padding:12}},
      tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.parsed} (${total>0?Math.round(ctx.parsed/total*100):0}%)`}}
    }}
  });
}

function renderBarChart(filtered,allReported){
  destroyChart('bar');
  const canvas=document.getElementById('ctrl-bar');if(!canvas||!window.Chart)return;
  const tourMap={};
  tours.forEach(t=>{tourMap[t.id]={name:t.name,color:t.color,bew:0,nicht:0,offen:0};});
  // Count from allReported (includes history)
  allReported.forEach(r=>{
    const tm=tourMap[r.tourId];if(!tm)return;
    if(r.lastStatus==='bewaessert')tm.bew++;
    else if(r.lastStatus==='nicht')tm.nicht++;
  });
  // No 'offen' category — all trees must have a status per app rules
  const labels=Object.values(tourMap).map(t=>t.name);
  ctrlCharts['bar']=new Chart(canvas,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Erledigt',data:Object.values(tourMap).map(t=>t.bew),backgroundColor:'#16a34a',borderRadius:4},
        {label:'Nicht erledigt',data:Object.values(tourMap).map(t=>t.nicht),backgroundColor:'#991b1b',borderRadius:4},
      ]
    },
    options:{responsive:false,plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:8}}},
      scales:{x:{stacked:true,ticks:{font:{size:11}}},y:{stacked:true,ticks:{font:{size:11},stepSize:1}}}}
  });
}

function renderTimelineChart(reported,from,to){
  destroyChart('timeline');
  const canvas=document.getElementById('ctrl-timeline');if(!canvas||!window.Chart)return;
  // Build daily buckets (lokale Datums-Keys, nicht UTC — sonst Off-by-one ggü. Report-Strings)
  const fmtLocal=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const days={};
  const cur=new Date(from);
  while(cur<=to){
    days[fmtLocal(cur)]={bew:0,nicht:0};
    cur.setDate(cur.getDate()+1);
  }
  // Aus denselben Meldungen wie KPIs/Charts zählen (keine Doppelzählung über tree.history)
  reported.forEach(r=>{
    if(!r.lastReportAt)return;
    const d=r.lastReportAt.slice?r.lastReportAt.slice(0,10):r.lastReportAt;
    if(!days[d])return;
    if(r.lastStatus==='bewaessert')days[d].bew++;
    else if(r.lastStatus==='nicht')days[d].nicht++;
  });
  const labels=Object.keys(days).map(d=>{const dt=new Date(d+'T00:00:00');return `${dt.getDate()}.${dt.getMonth()+1}.`;});
  ctrlCharts['timeline']=new Chart(canvas,{
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Erledigt',data:Object.values(days).map(d=>d.bew),borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',fill:true,tension:.3,pointRadius:3},
        {label:'Nicht erledigt',data:Object.values(days).map(d=>d.nicht),borderColor:'#991b1b',backgroundColor:'rgba(153,27,27,.07)',fill:true,tension:.3,pointRadius:3},
      ]
    },
    options:{responsive:false,plugins:{legend:{position:'bottom',labels:{font:{size:11}}}},
      scales:{x:{ticks:{font:{size:10}}},y:{ticks:{font:{size:11},stepSize:1},beginAtZero:true}}}
  });
}

function renderStadtteilChart(filtered,allReported){
  destroyChart('stadtteil');
  const canvas=document.getElementById('ctrl-stadtteil');if(!canvas||!window.Chart)return;
  const map={};
  allReported.forEach(r=>{
    const s=r.stadtteil||'Unbekannt';
    if(!map[s])map[s]={bew:0,nicht:0,offen:0};
    if(r.lastStatus==='bewaessert')map[s].bew++;
    else if(r.lastStatus==='nicht')map[s].nicht++;
  });

  const labels=Object.keys(map);
  ctrlCharts['stadtteil']=new Chart(canvas,{
    type:'bar',
    data:{
      labels,
      datasets:[
        {label:'Erledigt',data:labels.map(l=>map[l].bew),backgroundColor:'#16a34a',borderRadius:3},
        {label:'Nicht erledigt',data:labels.map(l=>map[l].nicht),backgroundColor:'#991b1b',borderRadius:3},
      ]
    },
    options:{responsive:false,indexAxis:'y',plugins:{legend:{display:false}},
      scales:{x:{stacked:true,ticks:{font:{size:10}}},y:{stacked:true,ticks:{font:{size:10}}}}}
  });
}

function renderReasonsBar(nichtTrees){
  const el=document.getElementById('ctrl-reasons');if(!el)return;
  const map={};
  nichtTrees.forEach(t=>{
    const r=t.lastReason||'Kein Grund angegeben';
    map[r]=(map[r]||0)+1;
  });
  const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  const max=sorted[0]?.[1]||1;
  if(sorted.length===0){el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:8px 0;">Keine Einträge im Zeitraum</div>';return;}
  el.innerHTML=sorted.map(([reason,cnt])=>`
    <div style="margin-bottom:10px;">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;">
        <span style="color:var(--text2);">${reason}</span>
        <span style="font-weight:600;color:var(--red);">${cnt}</span>
      </div>
      <div style="height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">
        <div style="height:100%;background:var(--red);border-radius:3px;width:${Math.round(cnt/max*100)}%;transition:width .4s;"></div>
      </div>
    </div>`).join('');
}

function renderDetailTable(reported,skipCache){
  if(!skipCache) _allReportedCache=[...reported];
  const head=document.getElementById('ctrl-table-head');
  const body=document.getElementById('ctrl-table-body');
  const count=document.getElementById('ctrl-table-count');
  if(!head||!body)return;

  const cols=['#','Projekt','Anlage/Straße','Baumnr.','Stadtteil','Tour','Status','Grund','Fahrer','Datum',''];
  head.innerHTML=cols.map(h=>`<th style="padding:8px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${h}</th>`).join('');
  if(count) count.textContent=`${reported.length} Meldungen`;

  if(reported.length===0){
    body.innerHTML=`<tr><td colspan="${cols.length}" style="padding:24px;text-align:center;color:var(--text3);font-size:13px;">Keine Meldungen im gewählten Zeitraum</td></tr>`;
    return;
  }

  const tourMap=new Map(tours.map(t=>[t.id,t]));   // Perf: 1× statt tours.find pro Zeile
  body.innerHTML=reported.map((tree,idx)=>{
    const tour=tourMap.get(tree.tourId);
    const st=tree.lastStatus;
    const stHtml=st==='bewaessert'
      ?'<span style="color:#16a34a;font-weight:600;">✓ Erledigt</span>'
      :st==='nicht'
      ?'<span style="color:var(--red);font-weight:600;">✕ Nicht erledigt</span>'
      :'<span style="color:var(--text3);">○ Offen</span>';
    // Format date + time — use stored string directly to avoid timezone issues
    let dateDisplay='–';
    if(tree.lastReportAt){
      const raw=tree.lastReportAt;
      if(raw.length>=16&&raw.includes('T')){
        // ISO string e.g. 2026-05-31T10:43:00 — parse parts directly
        const [datePart,timePart]=raw.split('T');
        const [y,m,d]=datePart.split('-');
        const time=timePart.slice(0,5);
        dateDisplay=`${d}.${m}.${y} ${time}`;
      } else if(raw.length===10){
        const [y,m,d]=raw.split('-');
        dateDisplay=`${d}.${m}.${y}`;
      } else {
        dateDisplay=raw.slice(0,16).replace('T',' ');
      }
    }
    const rowBg=tree._fromHistory?'background:var(--surface2);':'';
    return `<tr style="border-top:1px solid var(--border);${rowBg}" onmouseenter="this.style.background='#f0ede6'" onmouseleave="this.style.background='${tree._fromHistory?'var(--surface2)':''}'"  >
      <td style="padding:8px 12px;font-size:11px;color:var(--text3);font-family:monospace;">${idx+1}</td>
      <td style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${dlEsc(tree._projectName||currentProjectData?.name||'–')}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(tree.name||'')}">${dlEsc(tree.name||'–')}</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--text2);font-family:monospace;white-space:nowrap;">${dlEsc(tree.baumnr||'–')}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.stadtteil||'–')}</td>
      <td style="padding:8px 12px;font-size:12px;">${tour?`<span style="font-weight:600;color:${tour.color};">${dlEsc(tour.name)}</span>`:'–'}</td>
      <td style="padding:8px 12px;font-size:12px;white-space:nowrap;">${stHtml}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(tree.lastReason||'')}">${dlEsc(tree.lastReason||'–')}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.lastDriver||'–')}</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--text2);white-space:nowrap;">${dateDisplay}</td>
      <td style="padding:6px 10px;">
        <button onclick="ctrlShowOnMap('${tree.id}')" style="padding:3px 9px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;display:flex;align-items:center;gap:4px;white-space:nowrap;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>Karte
        </button>
      </td>
    </tr>`;
  }).join('');
}

async function loadTourHistory(){
  if(!currentProjectId)return;
  const el=document.getElementById('ctrl-history-list');
  el.innerHTML='<div style="padding:16px 20px;font-size:13px;color:var(--text3);">Lädt…</div>';
  const loadingForProject=currentProjectId;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
    _histListProject=loadingForProject; // Liste spiegelt jetzt dieses Projekt
    if(snap.empty){
      el.innerHTML='<div style="padding:16px 20px;font-size:13px;color:var(--text3);">Noch keine abgeschlossenen Touren.</div>';
      return;
    }
    const histories=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>b.date.localeCompare(a.date));

    // ── Summenzeile berechnen ──────────────────────────────────
    const totalBew=histories.reduce((s,h)=>s+(h.stats?.bewaessert||0),0);
    const totalNicht=histories.reduce((s,h)=>s+(h.stats?.nicht||0),0);
    const totalOffen=histories.reduce((s,h)=>s+(h.stats?.offen||0),0);
    const totalAll=totalBew+totalNicht+totalOffen;
    const totalPct=totalAll>0?Math.round(totalBew/totalAll*100):0;

    const summaryRow=`<div style="padding:12px 20px;background:var(--green-light);border-bottom:2px solid var(--green-mid);display:flex;align-items:center;gap:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--green);flex:1;">
        Gesamt: ${histories.length} Touren
      </div>
      <div style="display:flex;gap:16px;align-items:center;">
        <span style="font-size:13px;font-weight:700;color:#16a34a;">${totalBew} ✓</span>
        <span style="font-size:13px;font-weight:700;color:var(--red);">${totalNicht} ✕</span>
        <span style="font-size:13px;font-weight:700;color:var(--amber);">${totalOffen} ○</span>
        <div style="width:80px;height:8px;background:var(--border);border-radius:4px;overflow:hidden;">
          <div style="height:100%;background:#16a34a;width:${totalPct}%;border-radius:4px;"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:var(--green);min-width:36px;">${totalPct}%</span>
      </div>
    </div>`;

    el.innerHTML=summaryRow+histories.map(h=>{
      const tour=tours.find(t=>t.id===h.tourId);
      const color=h.tourColor||tour?.color||'#6b6760';
      const bew=h.stats?.bewaessert||0;
      const nicht=h.stats?.nicht||0;
      const offen=h.stats?.offen||0;
      const total=h.stats?.total||0;
      const pct=total>0?Math.round(bew/total*100):0;
      return `<div style="padding:12px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:16px;">
        <div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${h.tourName} <span style="font-weight:400;color:var(--text3);font-size:12px;">· ${h.date}</span></div>
          <div style="font-size:11px;color:var(--text3);">Fahrer: ${h.closedBy||'–'}</div>
        </div>
        <div style="display:flex;gap:12px;align-items:center;flex-shrink:0;">
          <span style="font-size:12px;color:#16a34a;font-weight:600;">${bew} ✓</span>
          <span style="font-size:12px;color:var(--red);font-weight:600;">${nicht} ✕</span>
          <span style="font-size:12px;color:var(--amber);font-weight:600;">${offen} ○</span>
          <div style="width:60px;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden;">
            <div style="height:100%;background:#16a34a;width:${pct}%;border-radius:3px;"></div>
          </div>
          <span style="font-size:11px;color:var(--text3);min-width:28px;">${pct}%</span>
          <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;" onclick="showHistoryDetail('${h.id}')">Detail</button>
          <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;" onclick="exportHistoryCSV('${h.id}')">CSV</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    el.innerHTML=`<div style="padding:16px 20px;font-size:13px;color:var(--red);">Fehler: ${e.message}</div>`;
  }
}

// Cache loaded histories
let historyCache={};

// Ältere tourHistory-Docs speichern die Baumliste als `results` (Felder status/reason/driver/note)
// statt als `trees` (lastStatus/lastReason/...). In einheitliches trees-Schema überführen.
function normalizeHistory(h){
  if(h&&!Array.isArray(h.trees)){
    h.trees=Array.isArray(h.results)?h.results.map(r=>({
      id:r.id, name:r.name, baumnr:r.baumnr,
      stadtteil:r.stadtteil, art:r.art, pflanzjahr:r.pflanzjahr,
      zustand:r.zustand, wasser:r.wasser,
      lastStatus:r.status||null, lastReason:r.reason||null,
      lastDriver:r.driver||null, lastNote:r.note||null,
      lastReportAt:r.reportAt||null,
    })):[];
  }
  return h;
}

async function showHistoryDetail(histId){
  if(!historyCache[histId]){
    const snap=await getDoc(doc(db,'projects',currentProjectId,'tourHistory',histId));
    historyCache[histId]={id:snap.id,...snap.data()};
  }
  if(!reasons.length) await loadReasons(); // Gründe für Dropdown sicherstellen
  const h=normalizeHistory(historyCache[histId]);
  const existing=document.getElementById('history-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='history-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';

  const statusOpts=['bewaessert','nicht'].map(s=>
    `<option value="${s}">${s==='bewaessert'?'✓ Erledigt':'✕ Nicht erledigt'}</option>`
  ).join('');

  const rows=h.trees.map((t,ti)=>{
    const st=t.lastStatus;
    const stSel=`<select data-ti="${ti}" class="hist-status-sel" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);">
      <option value="">○ Offen</option>
      <option value="bewaessert"${st==='bewaessert'?' selected':''}>✓ Erledigt</option>
      <option value="nicht"${st==='nicht'?' selected':''}>✕ Nicht erledigt</option>
    </select>`;
    const escAttr=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
    const curReason=t.lastReason||'';
    const reasonOpts=['<option value="">— kein Grund —</option>']
      .concat(reasons.map(r=>`<option value="${escAttr(r.text)}"${r.text===curReason?' selected':''}>${escAttr(r.text)}</option>`));
    if(curReason && !reasons.some(r=>r.text===curReason))
      reasonOpts.push(`<option value="${escAttr(curReason)}" selected>${escAttr(curReason)} (alt)</option>`);
    const reasonInp=`<select data-ri="${ti}" class="hist-reason-inp" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;width:100%;background:var(--bg);">${reasonOpts.join('')}</select>`;
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:6px 10px;font-size:12px;font-weight:500;">${t.name||'–'}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text2);">${t.baumnr||'–'}</td>
      <td style="padding:6px 10px;">${stSel}</td>
      <td style="padding:6px 10px;min-width:120px;">${reasonInp}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text2);">${t.lastDriver||'–'}</td>
    </tr>`;
  }).join('');

  modal.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-md);width:860px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;">${h.tourName} — ${h.date}</div>
        <div style="font-size:12px;color:var(--text3);">Fahrer: ${h.closedBy||'–'} · ${h.stats?.bewaessert||0} erledigt · ${h.stats?.nicht||0} nicht erledigt</div>
      </div>
      <button id="hist-save-btn" onclick="saveHistoryEdits('${histId}')" style="padding:6px 14px;background:var(--green);color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">Speichern</button>
      <button id="hist-delete-btn" onclick="deleteHistoryEntry('${histId}')" style="padding:6px 14px;background:var(--red-light);color:var(--red);border:1px solid #fca5a5;border-radius:6px;font-size:13px;cursor:pointer;">Löschen</button>
      <button onclick="document.getElementById('history-modal').remove()" style="border:none;background:none;cursor:pointer;font-size:20px;color:var(--text2);line-height:1;">×</button>
    </div>
    <div style="overflow:auto;flex:1;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead style="background:var(--surface2);position:sticky;top:0;">
          <tr>${['Anlage/Straße','Baumnr.','Status','Grund','Fahrer'].map(h=>`<th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text2);">${h}</th>`).join('')}</tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
}

function uiConfirm(msg,okLabel='Übernehmen',okColor='var(--green)'){
  return new Promise(resolve=>{
    const m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    m.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);padding:24px;width:400px;max-width:92vw;box-shadow:var(--shadow-md);">
      <div style="font-size:14px;color:var(--text);margin-bottom:20px;line-height:1.5;">${msg}</div>
      <div style="display:flex;gap:8px;justify-content:flex-end;">
        <button id="uc-no" style="padding:7px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-weight:600;">Abbrechen</button>
        <button id="uc-yes" style="padding:7px 16px;border:none;border-radius:6px;background:${okColor};color:#fff;cursor:pointer;font-weight:600;">${okLabel}</button>
      </div></div>`;
    document.body.appendChild(m);
    const done=v=>{m.remove();resolve(v);};
    m.querySelector('#uc-no').onclick=()=>done(false);
    m.querySelector('#uc-yes').onclick=()=>done(true);
    m.onclick=e=>{if(e.target===m)done(false);};
  });
}

async function saveHistoryEdits(histId){
  const btn=document.getElementById('hist-save-btn');
  if(btn){btn.textContent='Speichert…';btn.disabled=true;}
  const h=normalizeHistory(historyCache[histId]);
  // Ausgangswerte für Änderungs-Erkennung merken
  const before=h.trees.map(t=>({status:t.lastStatus,reason:t.lastReason||null}));
  // Read edited values from modal
  document.querySelectorAll('.hist-status-sel').forEach(sel=>{
    const ti=parseInt(sel.dataset.ti);
    h.trees[ti].lastStatus=sel.value||null;
  });
  document.querySelectorAll('.hist-reason-inp').forEach(inp=>{
    const ti=parseInt(inp.dataset.ri);
    h.trees[ti].lastReason=inp.value||null;
  });
  // Recalculate stats
  h.stats={
    total:h.trees.length,
    bewaessert:h.trees.filter(t=>t.lastStatus==='bewaessert').length,
    nicht:h.trees.filter(t=>t.lastStatus==='nicht').length,
    offen:h.trees.filter(t=>!t.lastStatus).length,
  };
  // Save to Firestore
  await setDoc(doc(db,'projects',currentProjectId,'tourHistory',histId),h);
  historyCache[histId]=h;
  window._tourHistoryCache=null; // invalidate controlling cache
  document.getElementById('history-modal')?.remove();

  // Geänderte Bäume ermitteln (Status oder Grund)
  const changed=[];
  h.trees.forEach((t,i)=>{
    if(before[i].status!==t.lastStatus || before[i].reason!==(t.lastReason||null)){
      changed.push({id:t.id,name:t.name,newStatus:t.lastStatus,newReason:t.lastReason||null,snapReportAt:t.lastReportAt||null});
    }
  });

  if(changed.length>0){
    const ok=await uiConfirm(
      `<b>${changed.length} Korrektur(en)</b> in der Tour-Historie gespeichert.<br><br>`+
      `Auch in die <b>Live-Ansicht & Karte</b> übernehmen (Objekt-Status & Grund aktualisieren)?<br><br>`+
      `<span style="color:var(--text2);font-size:12px;">Objekte mit einer neueren Meldung aus einer späteren Tour werden dabei nicht überschrieben.</span>`,
      'In Live-Ansicht übernehmen');
    if(ok){
      let applied=0,skipped=0;
      for(const c of changed){
        const live=trees.find(t=>t.id===c.id);
        // Schutz: keine neuere Meldung überschreiben
        if(live && live.lastReportAt && c.snapReportAt && live.lastReportAt>c.snapReportAt){ skipped++; continue; }
        try{
          await updateDoc(doc(db,'projects',currentProjectId,'trees',c.id),
            {lastStatus:c.newStatus,lastReason:c.newReason});
          applied++;
        }catch(e){ skipped++; }
      }
      notify(`✓ ${applied} in Live-Ansicht übernommen`+(skipped?` · ${skipped} übersprungen (neuere Meldung)`:''));
    } else {
      notify('✓ Historie gespeichert (Live-Ansicht unverändert)');
    }
  } else {
    notify('✓ Historie gespeichert');
  }
  loadTourHistory(); // refresh list
}

async function deleteHistoryEntry(histId){
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;';
  modal.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);padding:24px;width:340px;box-shadow:var(--shadow-md);">
    <div style="font-size:15px;font-weight:600;margin-bottom:8px;">Eintrag löschen?</div>
    <div style="font-size:13px;color:var(--text2);margin-bottom:20px;">Dieser historische Tour-Eintrag wird dauerhaft gelöscht.</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;">
      <button id="dc" style="padding:7px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-weight:600;">Abbrechen</button>
      <button id="dok" style="padding:7px 16px;border:none;border-radius:6px;background:var(--red);color:#fff;cursor:pointer;">Löschen</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  setTimeout(()=>modal.querySelector('#dc').focus(),50);
  const ok=await new Promise(r=>{
    modal.querySelector('#dc').onclick=()=>{modal.remove();r(false);};
    modal.querySelector('#dok').onclick=()=>{modal.remove();r(true);};
  });
  if(!ok)return;
  await deleteDoc(doc(db,'projects',currentProjectId,'tourHistory',histId));
  delete historyCache[histId];
  document.getElementById('history-modal')?.remove();
  notify('Eintrag gelöscht');
  loadTourHistory();
}

async function exportHistoryCSV(histId){
  if(!historyCache[histId]){
    const snap=await getDoc(doc(db,'projects',currentProjectId,'tourHistory',histId));
    historyCache[histId]={id:snap.id,...snap.data()};
  }
  const h=normalizeHistory(historyCache[histId]);
  const header='Tour;Datum;Fahrer;Anlage/Straße;Stadtteil;Baumart;Baumnr.;Status;Grund;Notiz;Zustand;Wasserbedarf';
  const rows=h.trees.map(t=>[
    h.tourName,h.date,t.lastDriver||'',t.name||'',t.stadtteil||'',t.art||'',t.baumnr||'',
    t.lastStatus||'offen',t.lastReason||'',t.lastNote||'',rankLabel('zustand',t.zustand),rankLabel('wasser',t.wasser)
  ].map(v=>`"${(v||'').replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob=new Blob(['\uFEFF'+header+'\n'+rows],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`tour_${h.tourName}_${h.date}.csv`;a.click();
}

// Store full reported list for client-side filtering
let _allReportedCache=[];

function filterDetailTable(q){
  const filtered=q
    ?_allReportedCache.filter(t=>
        (t.name||'').toLowerCase().includes(q.toLowerCase())||
        (t.baumnr||'').toLowerCase().includes(q.toLowerCase())||
        (t.stadtteil||'').toLowerCase().includes(q.toLowerCase())
      )
    :_allReportedCache;
  renderDetailTable(filtered,true); // skipCache=true
}

function ctrlShowOnMap(treeId){
  // Switch to map view, select tree, and pan to it
  switchView('karte');
  setTimeout(()=>{
    selectTree(treeId);
    const tree=trees.find(t=>t.id===treeId);
    if(tree?.lat&&tree?.lng) map.panTo([tree.lat,tree.lng],{animate:true,duration:0.5});
  },100);
}

function exportCtrlCSV(){
  const filtered=getCtrlFilteredTrees();
  const {from,to}=getCtrlDateRange();
  const reported=filtered.filter(t=>t.lastReportAt&&inCtrlRange(t.lastReportAt.slice?t.lastReportAt.slice(0,10):t.lastReportAt));
  const header='Anlage/Straße;Stadtteil;Baumart;Baumnr.;Tour;Status;Grund;Fahrer;Datum';
  const rows=reported.map(t=>{
    const tour=tours.find(x=>x.id===t.tourId);
    return [t.name,t.stadtteil,t.art,t.baumnr,tour?.name||'',t.lastStatus,t.lastReason||'',t.lastDriver||'',t.lastReportAt?.slice(0,10)||'']
      .map(v=>`"${(v||'').replace(/"/g,'""')}"`)
      .join(';');
  });
  const blob=new Blob(['\uFEFF'+header+'\n'+rows.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=`controlling_${new Date().toISOString().slice(0,10)}.csv`;a.click();
}

// ─── INIT ─────────────────────────────────────────────────────
// Make functions global for onclick handlers
// ─── LASSO SELECTION ─────────────────────────────────────────
let lassoMode=false;
let lassoTourId=null;
let lassoPoints=[];
let lassoCtx=null;
let lassoDrawing=false;

function startLassoMode(){
  if(!currentProjectId){notify('Bitte zuerst ein Projekt öffnen');return;}
  if(tours.length===0){notify('Bitte zuerst eine Tour anlegen');return;}
  lassoMode=true;
  lassoTourId=tours[0].id;
  lassoPoints=[];

  // Setup canvas — Canvas ist ein replaced element, CSS streckt es nicht: Größe = Kartengröße
  const canvas=document.getElementById('lasso-canvas');
  const mapEl=document.getElementById('map');
  canvas.width=mapEl.offsetWidth;
  canvas.height=mapEl.offsetHeight;
  lassoCtx=canvas.getContext('2d');
  canvas.classList.add('active');

  // Build tour pills
  const pills=document.getElementById('lasso-tour-pills');
  pills.innerHTML=tours.map(t=>
    `<span class="lasso-tour-pill${t.id===lassoTourId?' selected':''}" style="background:${t.color};" onclick="setLassoTour('${t.id}',this)">${t.name}</span>`
  ).join('');
  document.getElementById('lasso-banner').classList.add('visible');
  // map dragging stays enabled — canvas pointer-events handles drawing

  // Canvas mouse events
  canvas.onmousedown=e=>{
    lassoDrawing=true;lassoPoints=[];
    const r=canvas.getBoundingClientRect();
    lassoPoints.push({x:e.clientX-r.left,y:e.clientY-r.top});
  };
  canvas.onmousemove=e=>{
    if(!lassoDrawing)return;
    const r=canvas.getBoundingClientRect();
    lassoPoints.push({x:e.clientX-r.left,y:e.clientY-r.top});
    drawLasso();
  };
  canvas.onmouseup=e=>{
    if(!lassoDrawing)return;
    lassoDrawing=false;
    canvas.style.pointerEvents='none'; // allow map interaction again
    applyLasso();
  };
  // Touch support
  canvas.ontouchstart=e=>{
    e.preventDefault();lassoDrawing=true;lassoPoints=[];
    const r=canvas.getBoundingClientRect(),t=e.touches[0];
    lassoPoints.push({x:t.clientX-r.left,y:t.clientY-r.top});
  };
  canvas.ontouchmove=e=>{
    e.preventDefault();if(!lassoDrawing)return;
    const r=canvas.getBoundingClientRect(),t=e.touches[0];
    lassoPoints.push({x:t.clientX-r.left,y:t.clientY-r.top});
    drawLasso();
  };
  canvas.ontouchend=e=>{
    if(!lassoDrawing)return;
    lassoDrawing=false;
    canvas.style.pointerEvents='none';
    applyLasso();
  };
}

function setLassoTour(id,el){
  lassoTourId=id;
  document.querySelectorAll('.lasso-tour-pill').forEach(p=>p.classList.remove('selected'));
  el.classList.add('selected');
}

function drawLasso(){
  if(!lassoCtx||lassoPoints.length<2)return;
  const canvas=document.getElementById('lasso-canvas');
  lassoCtx.clearRect(0,0,canvas.width,canvas.height);
  lassoCtx.beginPath();
  lassoCtx.moveTo(lassoPoints[0].x,lassoPoints[0].y);
  lassoPoints.forEach(p=>lassoCtx.lineTo(p.x,p.y));
  lassoCtx.closePath();
  lassoCtx.fillStyle='rgba(124,58,237,0.15)';
  lassoCtx.fill();
  lassoCtx.strokeStyle='rgba(124,58,237,0.8)';
  lassoCtx.lineWidth=2;
  lassoCtx.setLineDash([5,4]);
  lassoCtx.stroke();
}

function pointInPolygon(px,py,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
    if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi))inside=!inside;
  }
  return inside;
}

async function applyLasso(){
  const canvas=document.getElementById('lasso-canvas');
  lassoCtx.clearRect(0,0,canvas.width,canvas.height);
  if(lassoPoints.length<3){lassoPoints=[];return;}

  const tourId=assignTourId||lassoTourId;
  const tour=tours.find(t=>t.id===tourId);

  // Find trees inside OR touching lasso polygon
  const selected=[];

  // Helper: minimum distance from point to lasso boundary segment
  function ptSegDist(px,py,ax,ay,bx,by){
    const dx=bx-ax,dy=by-ay;
    const lenSq=dx*dx+dy*dy;
    if(lenSq===0) return Math.hypot(px-ax,py-ay);
    const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/lenSq));
    return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
  }
  function touchesLasso(px,py,r){
    // 1. Center inside polygon
    if(pointInPolygon(px,py,lassoPoints)) return true;
    // 2. Any lasso segment within marker radius
    for(let i=0;i<lassoPoints.length;i++){
      const a=lassoPoints[i],b=lassoPoints[(i+1)%lassoPoints.length];
      if(ptSegDist(px,py,a.x,a.y,b.x,b.y)<=r) return true;
    }
    return false;
  }

  const MARKER_RADIUS=20; // px — generous touch zone
  // Lasso-Punkte sind relativ zum CANVAS erfasst, Marker-Punkte relativ zum KARTEN-Container.
  // Das Canvas sitzt per CSS versetzt über der Karte (top:55px) — ohne Versatz-Korrektur
  // verschiebt sich die Treffer-Zone gegenüber der gezeichneten Fläche.
  const _mr=map.getContainer().getBoundingClientRect(), _cr=canvas.getBoundingClientRect();
  const offX=_mr.left-_cr.left, offY=_mr.top-_cr.top;
  trees.forEach(tree=>{
    if(!tree.lat||!tree.lng)return;
    const pt=map.latLngToContainerPoint(L.latLng(tree.lat,tree.lng));
    if(touchesLasso(pt.x+offX,pt.y+offY,MARKER_RADIUS)) selected.push(tree);
  });

  lassoPoints=[];
  if(selected.length===0){notify('Keine Objekte im Lasso-Bereich');return;}

  // NEU: Lasso trifft nur eine VORAUSWAHL — mehrere Lassos addieren sich. Geschrieben wird
  // erst, wenn der Nutzer in der Aktionsleiste Hinzufügen/Verschieben/Entfernen wählt.
  let added=0;
  selected.forEach(t=>{ if(!lassoSelection.has(t.id)){ lassoSelection.add(t.id); added++; } });
  remakeMarkers(selected.map(t=>t.id)); // Auswahl-Ringe zeigen
  renderLassoActions();
  notify(`${lassoSelection.size} Objekte ausgewählt${added<selected.length?` (${added} neu)`:''}`);
}

// Nur die genannten Marker neu zeichnen (für Auswahl-Ring) — Routen-Nummern-Map einmal vorberechnen
function remakeMarkers(ids){
  _routeNumMap=buildRouteNumMap();
  try{
    ids.forEach(id=>{
      if(mapMarkers[id]){ _mDel(mapMarkers[id]); delete mapMarkers[id]; }
      const tree=trees.find(t=>t.id===id);
      if(tree&&isActive(tree)&&tree.lat&&tree.lng) mapMarkers[id]=makeMarker(tree);
    });
  } finally { _routeNumMap=null; }
  setMarkerVisibility();
}

// Einzelnes Objekt in die Vorauswahl auf-/abwählen (Marker-Klick im Planen-Modus)
function toggleLassoSelect(id){
  if(lassoSelection.has(id)) lassoSelection.delete(id); else lassoSelection.add(id);
  remakeMarkers([id]);
  renderLassoActions();
}

function clearLassoSelection(){
  if(!lassoSelection.size){ renderLassoActions(); return; }
  const ids=[...lassoSelection]; lassoSelection.clear();
  remakeMarkers(ids);
  renderLassoActions();
}

// Aktionsleiste unter dem Planen-Banner: erscheint, sobald etwas ausgewählt ist
function renderLassoActions(){
  const bar=document.getElementById('lasso-action-bar'); if(!bar) return;
  const n=lassoSelection.size;
  if(n===0){ bar.classList.remove('visible'); bar.innerHTML=''; return; }
  const tour=tours.find(t=>t.id===(assignTourId||lassoTourId));
  const tn=dlEsc(tour?.name||'Tour');
  const btn=(act,label,bg)=>`<button onclick="lassoAction('${act}')" style="padding:4px 11px;font-size:12px;font-weight:600;border:none;border-radius:var(--radius-sm);background:${bg};color:#fff;cursor:pointer;white-space:nowrap;">${label}</button>`;
  bar.innerHTML=`<span style="font-weight:700;">${n} ausgewählt</span>
    ${btn('add','➕ Zu „'+tn+'“ hinzufügen','rgba(255,255,255,.18)')}
    ${btn('move','➡ Nach „'+tn+'“ verschieben','rgba(255,255,255,.18)')}
    ${btn('unplan','⊘ Aus Tour(en) entfernen','rgba(255,255,255,.18)')}
    <button onclick="clearLassoSelection()" style="padding:4px 11px;font-size:12px;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;">Auswahl aufheben</button>`;
  bar.classList.add('visible');
}

// Aktion auf die Vorauswahl anwenden: 'add' | 'move' | 'unplan'
async function lassoAction(mode){
  const targets=[...lassoSelection].map(id=>trees.find(t=>t.id===id)).filter(Boolean);
  if(!targets.length){ renderLassoActions(); return; }
  const tourId=assignTourId||lassoTourId;
  const tour=tours.find(t=>t.id===tourId);
  if((mode==='add'||mode==='move')&&!tourId){ notify('Bitte zuerst eine Ziel-Tour wählen'); return; }
  const verbing=mode==='add'?'hinzufügen':mode==='move'?'verschieben':'aus Tour(en) entfernen';
  notify(`${targets.length} Objekte – ${verbing}…`);
  setSyncState('syncing',`${verbing}… 0/${targets.length}`);
  // Batch + Render-Pause (wie bei der früheren Zuweisung): grosse Mengen flüssig, kein Teilabbruch
  _suppressTreeRender=true;
  try{
    for(let i=0;i<targets.length;i+=400){
      const chunk=targets.slice(i,i+400);
      const batch=db.batch();
      chunk.forEach(tree=>{
        let newIds;
        if(mode==='add') newIds=[...new Set([...getTreeTourIds(tree),tourId])];
        else if(mode==='move') newIds=[tourId];
        else newIds=[]; // unplan → unverplant
        newIds=newIds.filter(Boolean);
        batch.update(doc(db,'projects',currentProjectId,'trees',tree.id),{tourIds:newIds,tourId:newIds[0]||''});
      });
      await batch.commit();
      _bumpUsage('writes',chunk.length);
      setSyncState('syncing',`${verbing}… ${Math.min(i+400,targets.length)}/${targets.length}`);
    }
  }catch(e){
    console.warn('Lasso-Aktion',e);
    setSyncState('error','Fehler');
    notify(`⚠ Fehlgeschlagen — bitte erneut versuchen (${e.message||e})`);
    return; // Auswahl bleibt erhalten, damit man es erneut versuchen kann
  }finally{
    _suppressTreeRender=false;
  }
  routeCache={};
  const doneIds=[...lassoSelection]; lassoSelection.clear();
  if(_pendingTreeRender){ _pendingTreeRender=false; refreshMarkers(); renderList(); }
  else remakeMarkers(doneIds); // Auswahl-Ringe weg + neue Farben sofort
  rebuildAssignPills();
  renderLassoActions();
  setSyncState('ok','Synchronisiert');
  const verb=mode==='add'?`→ „${tour?.name||'Tour'}“ hinzugefügt`:mode==='move'?`→ „${tour?.name||'Tour'}“ verschoben`:'aus Tour(en) entfernt';
  notify(`✓ ${targets.length} Objekte ${verb}`);
}

// cancelLasso merged into cancelAssign
// (Lasso-Konfliktdialog entfällt — Hinzufügen/Verschieben/Entfernen wählt der Nutzer
//  jetzt direkt über die Aktionsleiste der Vorauswahl.)

// ─── CONTEXT MENU ────────────────────────────────────────────
let ctxPendingLat=null,ctxPendingLng=null;

function closeCtxMenu(){
  document.getElementById('ctx-menu').classList.remove('open');
  document.getElementById('tree-tour-popup')?.remove();
  document.removeEventListener('click',closeCtxMenu);
}

function showTreeTourContextMenu(tree, e){
  // Vorhandenes Popup entfernen
  document.getElementById('tree-tour-popup')?.remove();

  const treeTourList=getTreeTourIds(tree).map(id=>tours.find(t=>t.id===id)).filter(Boolean);
  if(treeTourList.length===0) return; // kein Popup wenn keine Tour

  // Position aus Leaflet-Event
  const pt=e.containerPoint||{x:0,y:0};
  const mapEl=document.getElementById('map');
  const rect=mapEl?.getBoundingClientRect()||{left:0,top:0};

  const popup=document.createElement('div');
  popup.id='tree-tour-popup';
  popup.style.cssText=`
    position:fixed;
    left:${rect.left+pt.x+10}px;
    top:${rect.top+pt.y-10}px;
    background:var(--surface);
    border:1px solid var(--border);
    border-radius:var(--radius-sm);
    box-shadow:var(--shadow-md);
    padding:10px 14px;
    z-index:9000;
    min-width:180px;
    font-size:13px;
  `;
  popup.innerHTML=`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px;">
      ${tree.name||'–'} — Touren
    </div>
    ${treeTourList.map(t=>`
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);">
        <div style="width:10px;height:10px;border-radius:50%;background:${t.color};flex-shrink:0;"></div>
        <span style="font-weight:600;color:${t.color};">${t.name}</span>
      </div>`).join('')}
    <div style="margin-top:8px;font-size:11px;color:var(--text3);">${treeTourList.length} Tour${treeTourList.length!==1?'en':''}</div>
  `;
  document.body.appendChild(popup);

  // Schließen bei Klick außerhalb
  setTimeout(()=>document.addEventListener('click',()=>{
    popup.remove();
  },{once:true}),50);

  // Sicherstellen dass Popup im Viewport bleibt
  const popupRect=popup.getBoundingClientRect();
  if(popupRect.right>window.innerWidth) popup.style.left=(rect.left+pt.x-popupRect.width-10)+'px';
  if(popupRect.bottom>window.innerHeight) popup.style.top=(rect.top+pt.y-popupRect.height+10)+'px';
}

function ctxCalcActive(){
  closeCtxMenu();
  if(activeTourOnMap)calculateAndSaveRoute(activeTourOnMap);
}

// Right-click on map
map.on('contextmenu',e=>{
  e.originalEvent.preventDefault();
  ctxPendingLat=e.latlng.lat;ctxPendingLng=e.latlng.lng;
  const menu=document.getElementById('ctx-menu');
  const calcItem=document.getElementById('ctx-calc-active');
  const calcAll=document.getElementById('ctx-calc-all');
  const rpOn=getRoutePlanningEnabled();
  if(calcAll) calcAll.style.display=rpOn?'flex':'none'; // ohne Reihenfolgeplanung keine Routenberechnung
  if(activeTourOnMap && rpOn && !isOverviewTour(activeTourOnMap)){
    const t=tours.find(x=>x.id===activeTourOnMap);
    calcItem.style.display='flex';
    calcItem.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>Route berechnen: ${t?.name||''}`;
  } else {
    calcItem.style.display='none';
  }
  // Position menu
  const mx=e.originalEvent.clientX,my=e.originalEvent.clientY;
  menu.style.left=(mx+menu.offsetWidth>window.innerWidth?mx-menu.offsetWidth:mx)+'px';
  menu.style.top=(my+menu.offsetHeight>window.innerHeight?my-menu.offsetHeight:my)+'px';
  menu.classList.add('open');
  setTimeout(()=>document.addEventListener('click',closeCtxMenu),10);
});

async function loadErfasser(){
  if(!currentProjectId)return;
  const el=document.getElementById('erfasser-list');
  if(!el)return;
  const projSnap=await getDoc(doc(db,'projects',currentProjectId));
  const erfasser=projSnap.data()?.erfasser||[];
  el.innerHTML=erfasser.length===0
    ?'<div style="padding:10px 16px;font-size:13px;color:var(--text3);">Noch keine Erfasser hinterlegt.</div>'
    :erfasser.map(n=>`<div style="padding:8px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);">
        <span style="font-size:13px;">${n}</span>
        <button onclick="removeErfasser('${n}')" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:13px;">×</button>
      </div>`).join('');
}

async function addErfasser(){
  const input=document.getElementById('new-erfasser-input');
  const name=input.value.trim();
  if(!name)return;
  const projSnap=await getDoc(doc(db,'projects',currentProjectId));
  const erfasser=[...(projSnap.data()?.erfasser||[])];
  if(erfasser.includes(name)){notify('Name bereits vorhanden');return;}
  erfasser.push(name);
  await updateDoc(doc(db,'projects',currentProjectId),{erfasser});
  input.value='';
  loadErfasser();
}

async function removeErfasser(name){
  const projSnap=await getDoc(doc(db,'projects',currentProjectId));
  const erfasser=(projSnap.data()?.erfasser||[]).filter(n=>n!==name);
  await updateDoc(doc(db,'projects',currentProjectId),{erfasser});
  loadErfasser();
}

// ─── DASHBOARD (Live-Lagebild, identisch zur Einsatzleiter-App) ──
let dashPeriod='month';
let dashTimelineChart=null;
let dashNichtMap=null;
let dashNichtLayer=null;
let dashTourHistory=[];
let dashTourHistoryLoaded=false;

function dashGetDateRange(){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(dashPeriod==='today') return {from:today,to:new Date(today.getTime()+86400000-1)};
  if(dashPeriod==='week'){ const mon=new Date(today); mon.setDate(today.getDate()-((today.getDay()+6)%7)); return {from:mon,to:new Date(mon.getTime()+7*86400000-1)}; }
  if(dashPeriod==='month') return {from:new Date(now.getFullYear(),now.getMonth(),1),to:new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59)};
  if(dashPeriod==='all') return {from:new Date(0),to:new Date(now.getTime())};
  const f=document.getElementById('dash-date-from')?.value;
  const t=document.getElementById('dash-date-to')?.value;
  return {from:f?new Date(f+'T00:00:00'):new Date(0),to:t?new Date(t+'T23:59:59'):new Date()};
}
function dashDayStr(dateStr){ if(!dateStr)return null; return typeof dateStr==='string'?dateStr.slice(0,10):new Date(dateStr).toISOString().slice(0,10); }
function dashInRange(dateStr){ const ds=dashDayStr(dateStr); if(!ds)return false; const d=new Date(ds+'T12:00:00'); const {from,to}=dashGetDateRange(); return d>=from&&d<=to; }
function dashFmtDE(d){ return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}); }

function dashBuildReported(){
  const out=[]; const seen=new Set();
  if(dashTourHistoryLoaded){
    dashTourHistory.forEach(h=>{
      if(!dashInRange(h.date))return;
      (h.trees||[]).forEach(tree=>{
        if(!tree.lastStatus||tree.lastStatus==='offen')return;
        const at=tree.lastReportAt||h.date;
        out.push({...tree,lastReportAt:at,_tourId:h.tourId});
        seen.add((tree.id||'')+'|'+dashDayStr(at));
      });
    });
  } else {
    trees.forEach(tree=>{
      (tree.history||[]).forEach(h=>{
        if(!h.date||!dashInRange(h.date))return;
        if(!h.status||h.status==='offen')return;
        out.push({...tree,lastStatus:h.status,lastReason:h.reason||null,lastDriver:h.driver||null,lastReportAt:h.date});
        seen.add((tree.id||'')+'|'+dashDayStr(h.date));
      });
    });
  }
  trees.forEach(tree=>{
    if(!tree.lastStatus||tree.lastStatus==='offen'||!tree.lastReportAt)return;
    const d=dashDayStr(tree.lastReportAt);
    if(!dashInRange(d))return;
    const key=(tree.id||'')+'|'+d;
    if(seen.has(key))return;
    seen.add(key); out.push({...tree});
  });
  return out;
}

function renderDashboard(){
  if(!currentProjectId){ const g=document.getElementById('dash-kpi-grid'); if(g) g.innerHTML='<div style="padding:20px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; }
  const {from,to}=dashGetDateRange();
  const reported=dashBuildReported();
  const rl=document.getElementById('dash-range-label');
  if(rl) rl.textContent = dashPeriod==='all'?'Gesamter Zeitraum':`${dashFmtDE(from)} – ${dashFmtDE(to)}`;
  const bew=reported.filter(r=>r.lastStatus==='bewaessert');
  const nicht=reported.filter(r=>r.lastStatus==='nicht');
  const meldungen=bew.length+nicht.length;
  const pct=meldungen>0?Math.round(bew.length/meldungen*100):0;
  const aktiveFahrer=new Set(reported.map(r=>r.lastDriver).filter(Boolean)).size;
  const aktive=trees.filter(isActive);
  // Offen = Summe der offenen je Tour (exakt wie "Fortschritt je Tour"); nicht verplante zählen hier nicht
  const offen=dashTourStats(reported).reduce((s,x)=>s+x.offen,0);
  const grid=document.getElementById('dash-kpi-grid');
  if(grid) grid.innerHTML=[
    {val:aktive.length,lbl:'Objekte gesamt',sub:'im Projekt',color:'var(--text)'},
    {val:bew.length,lbl:'Erledigt',sub:`${pct}% der Meldungen`,color:'var(--green)'},
    {val:nicht.length,lbl:'Nicht erledigt',sub:'im Zeitraum',color:'var(--red)'},
    {val:offen,lbl:'Offen',sub:'offen in Touren',color:'var(--text2)'},
    {val:meldungen,lbl:'Meldungen',sub:'gesamt im Zeitraum',color:'var(--blue)'},
    {val:aktiveFahrer,lbl:'Aktive Fahrer',sub:'im Zeitraum',color:'var(--amber)'},
  ].map(k=>`<div class="dsh-tile"><div class="dsh-val" style="color:${k.color};">${k.val}</div><div class="dsh-lbl">${k.lbl}</div><div class="dsh-sub">${k.sub}</div></div>`).join('');
  dashRenderTourProgress(reported);
  dashRenderReasons(nicht);
  dashRenderNichtMap(nicht);
  dashRenderTimeline(reported,from,to);
  const u=document.getElementById('dash-updated');
  if(u) u.textContent='Stand: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}

// Pro-Tour-Statistik (geteilte Quelle für KPI "Offen" und "Fortschritt je Tour")
function dashTourStats(reported){
  return tours.map(t=>{
    // Nur Meldungen zu aktuell AKTIVEN Tour-Objekten zählen -> Fortschritt nie >100%
    // (bewässerte, danach deaktivierte/entfernte Objekte verzerren sonst den Zähler).
    const activeIds=new Set(trees.filter(x=>treeInTour(x,t.id)&&isActive(x)).map(x=>x.id));
    const total=activeIds.size;
    const rep=reported.filter(r=>activeIds.has(r.id));
    const bewIds=new Set(rep.filter(r=>r.lastStatus==='bewaessert').map(r=>r.id));
    const nichtIds=new Set(rep.filter(r=>r.lastStatus==='nicht'&&!bewIds.has(r.id)).map(r=>r.id));
    const bewN=bewIds.size, nichtN=nichtIds.size;
    return {t, total, bewN, nichtN, offen:Math.max(0,total-bewN-nichtN)};
  });
}

function dashFilterTours(q){
  q=(q||'').toLowerCase().trim();
  document.querySelectorAll('#dash-tour-progress .dsh-tour-row').forEach(row=>{
    row.style.display = !q || (row.dataset.name||'').includes(q) ? '' : 'none';
  });
}
function dashRenderTourProgress(reported){
  const el=document.getElementById('dash-tour-progress'); if(!el)return;
  const cntEl=document.getElementById('dash-tour-count');
  if(tours.length===0){ el.innerHTML='<div class="dsh-empty">Keine Touren angelegt</div>'; if(cntEl)cntEl.textContent=''; return; }
  const stats=dashTourStats(reported);
  if(cntEl) cntEl.textContent=`(${stats.length})`;
  el.innerHTML=stats.map(({t,total,bewN,nichtN,offen})=>{
    const base=Math.max(total,bewN+nichtN,1);
    const bewW=bewN/base*100,nichtW=nichtN/base*100,offenW=offen/base*100;
    const pct=total>0?Math.round(bewN/total*100):(bewN+nichtN>0?Math.round(bewN/(bewN+nichtN)*100):0);
    const color=t.color||TOUR_COLORS[0];
    return `<div class="dsh-tour-row" data-name="${(t.name||'Tour').toLowerCase().replace(/"/g,'')}">
      <div class="dsh-tour-head">
        <span class="dsh-dot" style="background:${color};"></span>
        <span class="dsh-tour-name">${t.name||'Tour'}</span>
        <span class="dsh-tour-pct">${pct}%</span>
      </div>
      <div class="dsh-bar">
        <div class="seg" style="width:${bewW}%;background:var(--green);"></div>
        <div class="seg" style="width:${nichtW}%;background:var(--dsh-red-mid);"></div>
        <div class="seg" style="width:${offenW}%;background:transparent;"></div>
      </div>
      <div class="dsh-tour-meta">
        <span><b style="color:var(--green);">${bewN}</b> bew.</span>
        <span><b style="color:var(--red);">${nichtN}</b> nicht</span>
        <span><b>${offen}</b> offen</span>
        <span style="margin-left:auto;">${total} Objekte</span>
      </div>
    </div>`;
  }).join('');
  const s=document.getElementById('dash-tour-search'); if(s&&s.value) dashFilterTours(s.value);
}

function dashRenderReasons(nichtTrees){
  const el=document.getElementById('dash-reasons'); if(!el)return;
  const map={};
  nichtTrees.forEach(t=>{ const r=t.lastReason||'Kein Grund angegeben'; map[r]=(map[r]||0)+1; });
  const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(sorted.length===0){ el.innerHTML='<div class="dsh-empty">Keine Ausfälle im Zeitraum 🎉</div>'; return; }
  const max=sorted[0][1];
  el.innerHTML=sorted.map(([reason,cnt])=>`
    <div class="dsh-reason-row">
      <div class="dsh-reason-head"><span>${reason}</span><b>${cnt}</b></div>
      <div class="dsh-reason-bar"><div class="fill" style="width:${Math.round(cnt/max*100)}%;"></div></div>
    </div>`).join('');
}

function dashNichtIcon(){
  return window.L.divIcon({ className:'',
    html:'<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>',
    iconSize:[18,18], iconAnchor:[9,9] });
}

function dashRenderNichtMap(nichtReports){
  const L=window.L; const wrap=document.getElementById('dash-nicht-map');
  if(!L||!wrap)return;
  if(!dashNichtMap){
    dashNichtMap=L.map('dash-nicht-map',{zoomControl:true,attributionControl:false}).setView([50.0,8.42],12);
    L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18}).addTo(dashNichtMap);
    dashNichtLayer=L.layerGroup().addTo(dashNichtMap);
    setTimeout(()=>dashNichtMap.invalidateSize(),200);
  }
  dashNichtLayer.clearLayers();
  const byId={};
  nichtReports.forEach(r=>{ const k=r.id||(r.lat+','+r.lng); if(!byId[k]||(r.lastReportAt||'')>(byId[k].lastReportAt||'')) byId[k]=r; });
  const uniq=Object.values(byId);
  const withCoords=uniq.filter(r=>r.lat&&r.lng);
  const ohne=uniq.length-withCoords.length;
  const countEl=document.getElementById('dash-map-count'); if(countEl) countEl.textContent=uniq.length>0?`${uniq.length} Objekte`:'';
  const noteEl=document.getElementById('dash-map-note'); if(noteEl) noteEl.textContent=ohne>0?`${ohne} ohne Koordinaten (nicht auf der Karte)`:'';
  const emptyEl=document.getElementById('dash-map-empty'); if(emptyEl) emptyEl.classList.toggle('show', uniq.length===0);
  const pts=[];
  withCoords.forEach(r=>{
    const d=r.lastReportAt?new Date(r.lastReportAt).toLocaleDateString('de-DE'):'–';
    const meta=[r.stadtteil,r.baumnr].filter(Boolean).map(dlEsc).join(' · ');
    const popup=`<b>${dlEsc(r.name||'Baum')}</b>`+(meta?`<br>${meta}`:'')+(r.art?`<br><i>${dlEsc(r.art)}</i>`:'')+
      `<br>Grund: <b style="color:#dc2626;">${dlEsc(r.lastReason||'nicht angegeben')}</b>`+
      (r.lastNote?`<br>Notiz: ${dlEsc(r.lastNote)}`:'')+(r.lastDriver?`<br>Fahrer: ${dlEsc(r.lastDriver)}`:'')+`<br>${d}`;
    L.marker([r.lat,r.lng],{icon:dashNichtIcon()}).bindPopup(popup).addTo(dashNichtLayer);
    pts.push([r.lat,r.lng]);
  });
  if(pts.length>0) dashNichtMap.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:16});
  setTimeout(()=>dashNichtMap.invalidateSize(),100);
}

function dashRenderTimeline(reported, from, to){
  const canvas=document.getElementById('dash-timeline-chart');
  if(!canvas||!window.Chart)return;
  let start=from,end=to;
  if(dashPeriod==='all'){
    const dates=reported.map(r=>dashDayStr(r.lastReportAt)).filter(Boolean).sort();
    start=dates.length?new Date(dates[0]+'T00:00:00'):new Date(to.getTime()-30*86400000);
    end=new Date();
  }
  const spanDays=Math.round((end-start)/86400000)+1;
  const monthly=spanDays>92;
  const buckets={}; const order=[];
  const pad=n=>String(n).padStart(2,'0');
  const keyOf=(d)=> monthly?`${d.getFullYear()}-${pad(d.getMonth()+1)}`:`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const cur=new Date(start.getFullYear(),start.getMonth(),monthly?1:start.getDate());
  let guard=0;
  while(cur<=end&&guard++<2000){
    const k=keyOf(cur);
    if(!(k in buckets)){ buckets[k]={bew:0,nicht:0}; order.push(k); }
    if(monthly) cur.setMonth(cur.getMonth()+1); else cur.setDate(cur.getDate()+1);
  }
  reported.forEach(r=>{
    if(!r.lastReportAt)return;
    const rd=new Date(r.lastReportAt); if(isNaN(rd))return;
    const k=keyOf(rd); if(!buckets[k])return;
    if(r.lastStatus==='bewaessert') buckets[k].bew++;
    else if(r.lastStatus==='nicht') buckets[k].nicht++;
  });
  const labels=order.map(k=>{ if(monthly){ const[y,m]=k.split('-'); return `${m}/${y.slice(2)}`; } const d=new Date(k+'T12:00:00'); return `${d.getDate()}.${d.getMonth()+1}.`; });
  if(dashTimelineChart) dashTimelineChart.destroy();
  dashTimelineChart=new Chart(canvas,{
    type:'line',
    data:{ labels, datasets:[
      {label:'Erledigt', data:order.map(k=>buckets[k].bew), borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,.12)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
      {label:'Nicht erledigt', data:order.map(k=>buckets[k].nicht), borderColor:'#dc2626', backgroundColor:'rgba(220,38,38,.08)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:12,boxWidth:14}}},
      scales:{ x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12}, grid:{display:false}},
               y:{beginAtZero:true,ticks:{font:{size:11},precision:0}}}
    }
  });
}

async function loadDashTourHistory(){
  if(!currentProjectId)return;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
    dashTourHistory=snap.docs.map(d=>({id:d.id,...d.data()}));
    dashTourHistoryLoaded=true;
    if(currentView==='dashboard') renderDashboard();
  }catch(e){ console.warn('dashboard tourHistory:',e); }
}

function dashSetPeriod(p,el){
  dashPeriod=p;
  document.querySelectorAll('.dsh-period-btn').forEach(b=>b.classList.remove('active'));
  if(el) el.classList.add('active');
  const cd=document.getElementById('dash-custom-dates'); if(cd) cd.style.display=p==='custom'?'flex':'none';
  if(p!=='custom') renderDashboard();
}

async function refreshDashboard(){
  const icon=document.getElementById('dash-refresh-icon'); if(icon) icon.style.animation='dsh-spin .7s linear infinite';
  await loadDashTourHistory();
  renderDashboard();
  if(icon) setTimeout(()=>icon.style.animation='',700);
}

function initDashboard(){
  dashTourHistoryLoaded=false;
  renderDashboard();        // sofort mit Live-Daten (tree.history/lastStatus)
  loadDashTourHistory();    // dann autoritativ aus tourHistory nachladen
  setTimeout(()=>{ if(dashNichtMap) dashNichtMap.invalidateSize(); },200);
}

// ─── DISPOSITION (Papierkorb-Tagesplanung, MVP) ──────────────
// Alles lokal (localStorage) – verändert keine echten Projektdaten.
const DISPO_BINS_KEY='dispo_bins'; // nur Bins lokal (transient); Config/Resources liegen am Mandanten
let dispoMap=null, dispoLayer=null, dispoPickCleanup=null, dispoMarkers={};
// Karten-Steuerung der Dispo (wie in der manuellen Planung: Zoom + Ebenen-Umschalter)
let dispoBaseFarbe=null, dispoBaseGrau=null, dispoBasemaps={}, dispoOverlays={}, dispoWmsInstances={}, _dispoControlsReady=false;
function closeDispoBasemapPanel(){ const p=document.getElementById('dispo-basemap-panel'),b=document.getElementById('dispo-basemap-btn'); if(p)p.style.display='none'; if(b)b.classList.remove('open'); }
function dispoRebuildLayers(){
  if(!dispoMap) return;
  const active=new Set();
  Object.entries(dispoWmsInstances).forEach(([id,lyr])=>{ if(dispoMap.hasLayer(lyr)) active.add(id); dispoMap.removeLayer(lyr); });
  dispoWmsInstances={};
  dispoBasemaps={'Karte':dispoBaseFarbe,'Graustufen':dispoBaseGrau};
  dispoOverlays={};
  let customBase=false;
  getWmsLayers().forEach(c=>{
    const lyr=buildWmsLayer(c); dispoWmsInstances[c.id]=lyr;
    if(c.type==='overlay'){ dispoOverlays[c.name]=lyr; if(active.has(c.id)) lyr.addTo(dispoMap); }
    else { dispoBasemaps[c.name]=lyr; if(active.has(c.id)){ lyr.addTo(dispoMap); customBase=true; } }
  });
  if(customBase){ dispoMap.removeLayer(dispoBaseFarbe); dispoMap.removeLayer(dispoBaseGrau); }
  else if(!dispoMap.hasLayer(dispoBaseFarbe)&&!dispoMap.hasLayer(dispoBaseGrau)){ dispoBaseFarbe.addTo(dispoMap); }
  dispoRenderBasemapSwitcher();
}
function dispoRenderBasemapSwitcher(){
  const panel=document.getElementById('dispo-basemap-panel'); if(!panel) return;
  const baseNames=Object.keys(dispoBasemaps);
  let activeBase=baseNames.find(n=>dispoMap.hasLayer(dispoBasemaps[n]));
  if(!activeBase){ dispoBasemaps['Karte'].addTo(dispoMap); activeBase='Karte'; }
  const opt=(label,attr,act)=>`<button ${attr} class="bm-opt${act?' active':''}"><svg class="chk" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(label)}</span></button>`;
  let html=`<div class="bm-plabel">Hintergrundkarte</div>`;
  html+=baseNames.map(n=>opt(n,`data-base="${(n+'').replace(/"/g,'&quot;')}"`,n===activeBase)).join('');
  const ovNames=Object.keys(dispoOverlays);
  if(ovNames.length) html+=`<div class="bm-plabel" style="margin-top:3px;border-top:1px solid var(--border);padding-top:6px;">Zusatz-Ebenen</div>`+ovNames.map(n=>opt(n,`data-overlay="${(n+'').replace(/"/g,'&quot;')}"`,dispoMap.hasLayer(dispoOverlays[n]))).join('');
  panel.innerHTML=html;
  panel.onclick=e=>{
    const b=e.target.closest('[data-base]'),o=e.target.closest('[data-overlay]');
    if(b){ const n=b.dataset.base; if(dispoBasemaps[n]){ Object.values(dispoBasemaps).forEach(l=>dispoMap.removeLayer(l)); dispoBasemaps[n].addTo(dispoMap); dispoRenderBasemapSwitcher(); closeDispoBasemapPanel(); } }
    else if(o){ const n=o.dataset.overlay,l=dispoOverlays[n]; if(l){ dispoMap.hasLayer(l)?dispoMap.removeLayer(l):l.addTo(dispoMap); dispoRenderBasemapSwitcher(); } }
  };
}
function _initDispoControls(){
  if(_dispoControlsReady||!dispoMap) return;
  const cont=dispoMap.getContainer();
  const el=document.createElement('div'); el.id='dispo-controls';
  el.innerHTML=`<div class="map-zoom"><button id="dispo-zoom-in" type="button" aria-label="Vergrößern"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg></button><button id="dispo-zoom-out" type="button" aria-label="Verkleinern"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14"/></svg></button></div><div class="map-picker"><div id="dispo-basemap-panel" style="display:none;"></div><button id="dispo-basemap-btn" type="button" aria-label="Karte wählen" title="Karte wählen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg></button></div>`;
  cont.appendChild(el);
  L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el);
  document.getElementById('dispo-zoom-in').onclick=()=>dispoMap.zoomIn();
  document.getElementById('dispo-zoom-out').onclick=()=>dispoMap.zoomOut();
  document.getElementById('dispo-basemap-btn').onclick=e=>{ const p=document.getElementById('dispo-basemap-panel'); const open=p.style.display==='none'; p.style.display=open?'block':'none'; e.currentTarget.classList.toggle('open',open); };
  dispoMap.on('click',closeDispoBasemapPanel);
  // Werkzeuge oben links: Adresssuche (einklappbar) + Stadt-Zoom + Routenlinien (nur Dispo-Karte)
  const tools=document.createElement('div'); tools.id='dispo-tools';
  tools.innerHTML=`<div id="dispo-search" class="collapsed">
      <button id="dispo-search-toggle" type="button" class="ms-toggle" title="Adresse oder Straße suchen" aria-label="Suchen"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg></button>
      <div class="ms-box"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2.2" style="flex-shrink:0;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input id="dispo-search-input" type="text" placeholder="Adresse oder Straße suchen…" autocomplete="off"><button class="ms-clear" id="dispo-search-clear" type="button" aria-label="Leeren"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>
      <div id="dispo-search-results"></div>
    </div>
    <button id="dispo-fit" class="ms-toggle" type="button" title="Auf ganze Stadt zoomen" aria-label="Auf ganze Stadt zoomen"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><circle cx="12" cy="12" r="2.5"/></svg></button>
    <button id="dispo-routes" class="ms-toggle" type="button" title="Routenlinien ein/aus" aria-label="Routenlinien ein/aus"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
  cont.appendChild(tools);
  L.DomEvent.disableClickPropagation(tools); L.DomEvent.disableScrollPropagation(tools);
  document.getElementById('dispo-search-toggle').onclick=()=>{ document.getElementById('dispo-search').classList.remove('collapsed'); document.getElementById('dispo-search-input').focus(); };
  const di=document.getElementById('dispo-search-input');
  di.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); doDispoSearch(); } else if(e.key==='Escape'){ clearDispoSearch(); document.getElementById('dispo-search').classList.add('collapsed'); } });
  di.addEventListener('input',()=>{ const c=document.getElementById('dispo-search-clear'); if(c) c.style.display=di.value?'block':'none'; });
  document.getElementById('dispo-search-clear').onclick=clearDispoSearch;
  document.getElementById('dispo-search-results').addEventListener('click',e=>{ const it=e.target.closest('.ms-item'); if(!it) return; const box=document.getElementById('dispo-search-results'); const r=box._results?.[+it.dataset.idx]; if(r) gotoDispoResult(r); });
  document.getElementById('dispo-fit').onclick=dispoFitBins;
  document.getElementById('dispo-routes').onclick=toggleDispoRoutes;
  _dispoControlsReady=true;
}
let dispoVisible=null; // null = alle Fahrzeuge sichtbar; sonst Set sichtbarer Ressourcen-IDs
function dispoResVisible(id){ return !dispoVisible || dispoVisible.has(id); }
function dispoFocusVehicle(id){ // Klick auf Fahrzeug: isolieren – erneuter Klick: wieder alle
  if(dispoVisible && dispoVisible.size===1 && dispoVisible.has(id)) dispoVisible=null;
  else dispoVisible=new Set([id]);
  dispoRenderResults(); dispoRenderMap();
}
function dispoToggleVehicle(id){ // 👁 additiv ein-/ausblenden
  const ids=(window.__dispoPlan?window.__dispoPlan.R:[]).map(r=>r.id);
  if(!dispoVisible) dispoVisible=new Set(ids);
  if(dispoVisible.has(id)) dispoVisible.delete(id); else dispoVisible.add(id);
  if(dispoVisible.size>=ids.length) dispoVisible=null;
  dispoRenderResults(); dispoRenderMap();
}
function dispoShowAllVehicles(){ dispoVisible=null; dispoRenderResults(); dispoRenderMap(); }

// Dispo-Konfig stadtscharf: orgs/{orgId}.dispoConfig + .dispoResources (in loadOrgSettings geladen).
// Bins bleiben lokal (transiente Simulations-Ausgabe, wird je Lauf neu erzeugt).
const DISPO_DEFAULT_CFG={kritisch:80, planbar:50, aus:50, emptyMin:3, reservePct:10, speedKmh:25, binCount:40, defaultRate:10};
const DISPO_DEFAULT_RES=[
  {id:'r1', name:'Fahrzeug 1', arbeitszeitMin:420, depot:null, maxBins:0},
  {id:'r2', name:'Fahrzeug 2', arbeitszeitMin:420, depot:null, maxBins:0},
];
let currentDispoConfig=null, currentDispoResources=null, _dispoPersistTimer=null;
function dispoGetConfig(){ return {...DISPO_DEFAULT_CFG, ...(currentDispoConfig||{})}; }
function dispoSetConfig(c){ currentDispoConfig={...c}; dispoPersist(); }
function dispoGetBins(){ try{ return JSON.parse(localStorage.getItem(DISPO_BINS_KEY)||'[]'); }catch(e){ return []; } }
function dispoSetBins(a){ localStorage.setItem(DISPO_BINS_KEY, JSON.stringify(a)); }
// Stadtweit speichern (nur Admin; debounced, damit Einzeländerungen gebündelt 1 Write ergeben)
function dispoPersist(){
  const org=currentProjectData?.orgId; if(!org) return;
  if(!(currentRole==='superadmin'||currentCap==='admin')) return; // Nicht-Admins: nur Session, kein stadtweiter Write
  clearTimeout(_dispoPersistTimer);
  _dispoPersistTimer=setTimeout(()=>{
    dlFnCall('setOrgDispo',{orgId:org, config:dispoGetConfig(), resources:currentDispoResources||DISPO_DEFAULT_RES})
      .catch(e=>notify(fnErr(e)));
  }, 500);
}
function dispoDefaultDepot(){
  const d=getDepot(); if(d?.lat) return {lat:d.lat, lng:d.lng, adresse:d.address||'Betriebshof'};
  const pts=(dispoGetBins().length?dispoGetBins():trees.filter(t=>t.lat&&t.lng));
  if(pts.length){ const la=pts.reduce((s,p)=>s+p.lat,0)/pts.length, lo=pts.reduce((s,p)=>s+p.lng,0)/pts.length; return {lat:la, lng:lo, adresse:'Zentrum'}; }
  return {lat:50.0, lng:8.42, adresse:'Betriebshof'};
}
function dispoGetResources(){
  return (Array.isArray(currentDispoResources)&&currentDispoResources.length)
    ? currentDispoResources.map(x=>({...x}))
    : DISPO_DEFAULT_RES.map(x=>({...x})); // depot null = Standard-Betriebshof, maxBins 0 = unbegrenzt
}
function dispoSetResources(a){ currentDispoResources=a.map(x=>({...x})); dispoPersist(); }
// depot null/leer oder == Projekt-Betriebshof → Standard
function dispoIsStandardDepot(d){ if(!d||d.lat==null) return true; const dp=dispoDefaultDepot(); return Math.abs(d.lat-dp.lat)<1e-5 && Math.abs(d.lng-dp.lng)<1e-5; }
function dispoResolveDepot(r){ return (r.depot&&r.depot.lat!=null)?r.depot:dispoDefaultDepot(); }

function dispoSimulate(){
  const cfg=dispoGetConfig();
  const src=trees.filter(t=>t.lat&&t.lng);
  if(src.length<5){ notify('Keine Standorte verfügbar – bitte Projekt mit Objekten öffnen'); return; }
  // Gewünschte Anzahl IMMER liefern: erst echte Standorte, darüber hinaus gestreute
  // Punkte rund um vorhandene Standorte (Simulation ist ohnehin fiktiv).
  const n=Math.max(1,cfg.binCount|0);
  const shuffled=[...src].sort(()=>Math.random()-0.5);
  const bins=[];
  for(let i=0;i<n;i++){
    const base=shuffled[i%shuffled.length];
    const extra=i>=shuffled.length; // über die echten Standorte hinaus → Position streuen (~±600 m)
    const lat=base.lat+(extra?(Math.random()-0.5)*0.011:0);
    const lng=base.lng+(extra?(Math.random()-0.5)*0.017:0);
    bins.push({
      id:'pk'+i, name:'Papierkorb '+(i+1), stadtteil:base.stadtteil||'', lat:+lat.toFixed(6), lng:+lng.toFixed(6),
      fuellstand:Math.floor(Math.random()*101),
      fillRate:5+Math.floor(Math.random()*26), // %/Tag (simuliert)
    });
  }
  dispoSetBins(bins);
  window.__dispoPlan=null;
  dispoRenderResults(); dispoRenderMap();
  notify(`${bins.length} Papierkörbe simuliert`);
}

// ── Echtdaten-Modus: Bins aus realen Objekten + gelernter Füllrate ──────
// Letztes Melde-/Verlaufsdatum eines Objekts
function _dispoLastDate(t){
  let d=t.lastReportAt||null;
  if(!d){ const h=(t.history||[]).filter(x=>x.date); if(h.length) d=h[h.length-1].date; }
  if(!d) return null; const dt=new Date(d); return isNaN(dt)?null:dt;
}
// Gelernte Füllrate (%/Tag) aus der history-Zeitreihe: zwischen zwei Leerungen (status erledigt)
// füllt sich der Korb von ~0 auf den gemeldeten Wert → Rate = Füllgrad / Tage. Mittel über letzte 5.
function _dispoFillRate(t){
  const ev=(t.history||[]).filter(h=>typeof h.fuellgrad==='number' && h.date && (h.status==='bewaessert' || /^Bewässert/.test(h.note||'')))
    .map(h=>({d:new Date(h.date), f:h.fuellgrad})).filter(x=>!isNaN(+x.d)).sort((a,b)=>a.d-b.d);
  if(ev.length<2) return null;
  const rates=[];
  for(let i=1;i<ev.length;i++){ const days=(ev[i].d-ev[i-1].d)/86400000; if(days>=0.5 && ev[i].f>0) rates.push(ev[i].f/days); }
  if(!rates.length) return null;
  const last=rates.slice(-5);
  return last.reduce((s,x)=>s+x,0)/last.length;
}
function dispoLoadReal(){
  const cfg=dispoGetConfig();
  const src=trees.filter(t=>isActive(t)&&t.lat&&t.lng);
  if(!src.length){ notify('Keine Objekte mit Koordinaten – bitte Projekt mit Objekten öffnen'); return; }
  // Eigene Raten + Typ/Art-Schnitt für Kaltstart
  const rateById={}, ratesByArt={};
  src.forEach(t=>{ const r=_dispoFillRate(t); if(r!=null){ rateById[t.id]=r; const a=(t.art||'').trim(); (ratesByArt[a]=ratesByArt[a]||[]).push(r); } });
  const artAvg={}; Object.entries(ratesByArt).forEach(([a,arr])=>{ artAvg[a]=arr.reduce((s,x)=>s+x,0)/arr.length; });
  const allRates=Object.values(rateById);
  const globalAvg=allRates.length?allRates.reduce((s,x)=>s+x,0)/allRates.length:(cfg.defaultRate||10);
  const now=Date.now();
  const bins=src.map(t=>{
    let rate=rateById[t.id];
    if(rate==null){ const a=(t.art||'').trim(); rate=(artAvg[a]!=null?artAvg[a]:globalAvg); }
    rate=Math.max(1, Math.min(60, rate));
    const base=(typeof t.lastFuellgrad==='number')?t.lastFuellgrad:0;
    const last=_dispoLastDate(t);
    const days=last?Math.max(0,(now-last.getTime())/86400000):0;
    const fuell=Math.max(0, Math.min(130, Math.round(base + rate*days)));
    return { id:t.id, name:t.name||t.baumId||'Objekt', stadtteil:t.stadtteil||'', lat:t.lat, lng:t.lng, fuellstand:fuell, fillRate:Math.round(rate), _real:true };
  });
  dispoSetBins(bins);
  window.__dispoPlan=null; dispoRenderResults(); dispoRenderMap();
  notify(`${bins.length} Objekte aus echten Daten · ${Object.keys(rateById).length} mit gelernter Füllrate (Rest Kaltstart)`);
}

function dispoTravelMin(a,b,speed){ return haversine(a.lat,a.lng,b.lat,b.lng)/speed*60; }
function dispoNNOrder(depot, list, speed){
  const rem=[...list], out=[]; let cur=depot;
  while(rem.length){
    let bi=0,bd=Infinity;
    rem.forEach((p,i)=>{ const d=dispoTravelMin(cur,p,speed); if(d<bd){bd=d;bi=i;} });
    cur=rem[bi]; out.push(cur); rem.splice(bi,1);
  }
  return out;
}

// ORS-Matrix (Fahrzeit + Strecke) – wie im Planung-Reiter, max 50 Punkte
async function dispoOrsMatrix(coords){
  const key=getOrsKey(); if(!key) return null; if(coords.length>50) return null;
  try{
    const res=await fetch('https://api.openrouteservice.org/v2/matrix/driving-car',{
      method:'POST', headers:{'Content-Type':'application/json','Authorization':key},
      body:JSON.stringify({locations:coords, metrics:['duration','distance'], units:'m'})
    });
    if(!res.ok){ console.warn('dispo matrix error:',res.status); return null; }
    const d=await res.json();
    return {dur:d.durations, dist:d.distances};
  }catch(e){ console.warn('dispo matrix failed:',e); return null; }
}

// Reihenfolge + Zeit einer Ressourcen-Tour: ORS-Matrix+2-opt (Einstellung „Optimiert"),
// sonst Luftlinie/Nearest-Neighbor.
async function dispoOptimizeRoute(r, speed, empty){
  if(getRouteOptMode()==='matrix' && getOrsKey() && r.route.length>=1 && r.route.length<=49){
    const pts=[r.depot, ...r.route];
    const M=await dispoOrsMatrix(pts.map(p=>[p.lng,p.lat]));
    if(M&&M.dur){
      const idx=new Map(pts.map((p,i)=>[p,i]));
      const cost=(a,b)=>M.dur[idx.get(a)][idx.get(b)];
      const seed=nnFromMatrix(pts, M.dur, 0);
      const opt=twoOpt(seed, cost, true, true); // Depot fix, Rundtour
      r.route=opt.filter(p=>p!==r.depot);
      const seq=[r.depot, ...r.route, r.depot];
      let durS=0, distM=0;
      for(let i=0;i<seq.length-1;i++){ const a=idx.get(seq[i]), b=idx.get(seq[i+1]); durS+=M.dur[a][b]; if(M.dist) distM+=M.dist[a][b]; }
      r.minFahrt=Math.round(durS/60); r.km=distM/1000; r.minLeerung=r.route.length*empty; r.minGesamt=r.minFahrt+r.minLeerung; r._ors=true;
      // Echte Straßen-Geometrie für die Karte (wie im Planung-Reiter)
      r.geo=await fetchOrsRoute(seq.map(p=>[p.lng,p.lat]));
      return;
    }
  }
  // Fallback Luftlinie
  r.route=dispoNNOrder(r.depot, r.route, speed);
  let drive=0,km=0,prev=r.depot;
  r.route.forEach(s=>{ drive+=dispoTravelMin(prev,s,speed); km+=haversine(prev.lat,prev.lng,s.lat,s.lng); prev=s; });
  if(r.route.length){ drive+=dispoTravelMin(prev,r.depot,speed); km+=haversine(prev.lat,prev.lng,r.depot.lat,r.depot.lng); }
  r.minFahrt=Math.round(drive); r.minLeerung=r.route.length*empty; r.minGesamt=Math.round(drive)+r.route.length*empty; r.km=km; r._ors=false; r.geo=null;
}

async function dispoPlan(){
  const cfg=dispoGetConfig();
  const bins=dispoGetBins();
  if(_dispoSyncReal(bins)) dispoSetBins(bins); // echte Körbe an aktuelle Objektpositionen koppeln
  const resources=dispoGetResources();
  if(!bins.length){ notify('Keine Papierkörbe – zuerst „Füllstände simulieren"'); return; }
  if(!resources.length){ notify('Keine Ressourcen – in Einstellungen anlegen'); return; }
  const speed=cfg.speedKmh||25, empty=cfg.emptyMin||3, ROAD=1.3; // Umwegfaktor (Luftlinie→Straße) für Budget
  const begr={}; const cand=[];
  bins.forEach(b=>{
    if(b.fuellstand>=cfg.kritisch) cand.push({...b,_muss:true,_score:b.fuellstand+1000});
    else if(b.fuellstand>=cfg.planbar) cand.push({...b,_muss:false,_score:b.fuellstand});
    else begr[b.id]={status:'ausgelassen', grund:`${b.fuellstand}% unter Schwelle ${cfg.aus}%`};
  });
  cand.sort((a,b)=> (b._muss-a._muss) || (b._score-a._score));
  const R=resources.map(r=>{ const depot=dispoResolveDepot(r); return {...r, depot, route:[], cur:depot, t:0, budget:(r.arbeitszeitMin||420)*(1-(cfg.reservePct||10)/100)}; });
  // Zuordnung (Luftlinie × Umwegfaktor als konservative Schätzung)
  cand.forEach(c=>{
    let best=null, bestCost=Infinity;
    R.forEach(r=>{
      const cap=r.maxBins>0?r.maxBins:Infinity;
      if(r.route.length>=cap) return; // max. Körbe je Tour erreicht
      const add=dispoTravelMin(r.cur,c,speed)*ROAD, ret=dispoTravelMin(c,r.depot,speed)*ROAD;
      if(r.t+add+empty+ret<=r.budget && add<bestCost){ best=r; bestCost=add; }
    });
    if(best){ best.route.push(c); best.t+=bestCost+empty; best.cur=c;
      begr[c.id]={status:'eingeplant', grund:c._muss?`kritisch ≥${cfg.kritisch}%`:'planbar, effizient erreichbar', resourceId:best.id};
    } else {
      const allCapped=R.length>0 && R.every(r=>r.maxBins>0 && r.route.length>=r.maxBins);
      begr[c.id]={status:'verschoben', grund: allCapped?'Max. Körbe je Tour erreicht':(c._muss?'Kapazität erschöpft (kritisch!)':'Tageskapazität erschöpft')};
    }
  });
  setSyncState('syncing','Tagesplanung wird berechnet…');
  // Reihenfolge + Zeit je Ressource (ORS „Optimiert" oder Luftlinie)
  for(const r of R){ await dispoOptimizeRoute(r, speed, empty); }
  const usedOrs=R.some(r=>r._ors);
  setSyncState('ok','Synchronisiert');
  window.__dispoPlan={R, begr, cfg, ts:new Date(), usedOrs};
  dispoVisible=null; // bei neuer Planung alle Fahrzeuge zeigen
  dispoRenderResults(); dispoRenderMap();
  notify('Tagesplanung erstellt');
}

function dispoFmtH(min){ const h=Math.floor(min/60), m=Math.round(min%60); return h>0?`${h}h ${m}min`:`${m} min`; }
function dispoResColor(i){ return TOUR_COLORS[i%TOUR_COLORS.length]; }

function dispoToggle(id, head){
  const el=document.getElementById(id); if(!el) return;
  const open=getComputedStyle(el).display==='none';
  el.style.display=open?'block':'none';
  const chev=head.querySelector('.dispo-chev'); if(chev) chev.textContent=open?'▾':'▸';
}
const DISPO_BADGE={eingeplant:'background:#dcfce7;color:#15803d;', verschoben:'background:#fef3c7;color:#b45309;', ausgelassen:'background:#f0ede6;color:#6b6760;'};
function dispoProg(b){ return b.fillRate?` · voll in ~${Math.max(0,Math.ceil((100-b.fuellstand)/b.fillRate))} T`:''; }
function dispoRow(b,v,idx,opts){
  opts=opts||{};
  const plan=window.__dispoPlan;
  const assignSel=(opts.assign && plan && plan.R && plan.R.length)
    ? `<select onchange="if(this.value){dispoAssign('${b.id}',this.value);}" style="flex-basis:100%;margin-top:4px;font-size:11px;padding:3px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text2);">
        <option value="">＋ einer Ressource zuteilen…</option>
        ${plan.R.map(r=>`<option value="${r.id}">${r.name}</option>`).join('')}
      </select>`
    : '';
  const removeBtn=opts.remove
    ? `<button onclick="event.stopPropagation();dispoUnassign('${b.id}')" title="Aus Tour entfernen" style="flex-shrink:0;border:none;background:none;color:var(--text3);cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;">✕</button>`
    : '';
  return `<div class="dispo-list-row" data-bin="${b.id}" onclick="dispoFocusPoint('${b.id}',event)" style="cursor:pointer;">
    ${idx!=null?`<span style="flex-shrink:0;min-width:18px;height:18px;border-radius:9px;background:var(--surface2);color:var(--text2);font-size:10px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;">${idx}</span>`:''}
    <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${b.name} <b>${b.fuellstand}%</b></span>
    <span class="dispo-badge" style="${DISPO_BADGE[v.status]||''}">${v.status}${v._manual?' ✋':''}</span>
    ${removeBtn}
    <span style="flex-basis:100%;font-size:11px;color:var(--text3);">${v.grund}${dispoProg(b)}</span>
    ${assignSel}
  </div>`;
}

async function dispoAssign(binId, resId){
  const plan=window.__dispoPlan; if(!plan) return;
  const b=dispoGetBins().find(x=>x.id===binId);
  const r=plan.R.find(x=>x.id===resId);
  if(!b||!r) return;
  const cfg=plan.cfg, speed=cfg.speedKmh||25, empty=cfg.emptyMin||3;
  plan.R.forEach(x=>{ x.route=x.route.filter(s=>s.id!==binId); });
  r.route.push({...b});
  setSyncState('syncing','Route wird neu berechnet…');
  await dispoOptimizeRoute(r, speed, empty);
  setSyncState('ok','Synchronisiert');
  plan.begr[binId]={status:'eingeplant', grund:'manuell zugeteilt', resourceId:resId, _manual:true};
  plan.usedOrs=plan.R.some(x=>x._ors);
  dispoRenderResults(); dispoRenderMap();
  const budget=(r.arbeitszeitMin||420)*(1-(cfg.reservePct||10)/100);
  const overCap=r.maxBins>0 && r.route.length>r.maxBins;
  notify(overCap?`Zugeteilt – ${r.name} über Max. Körbe (${r.maxBins})`:r.minGesamt>budget?`Zugeteilt – ${r.name} überschreitet jetzt das Zeitbudget`:`Zu ${r.name} zugeteilt`);
}

function dispoConfirm(title, msg, okLabel){
  return new Promise(resolve=>{
    const m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
    m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:380px;max-width:92vw;overflow:hidden;">
      <div style="padding:16px 20px 6px;font-size:15px;font-weight:700;">${title}</div>
      <div style="padding:0 20px 16px;font-size:13px;color:var(--text2);line-height:1.6;">${msg}</div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button id="dc-no" class="btn btn-secondary">Abbrechen</button>
        <button id="dc-yes" class="btn btn-danger">${okLabel||'Entfernen'}</button>
      </div></div>`;
    document.body.appendChild(m);
    const done=v=>{ m.remove(); resolve(v); };
    m.querySelector('#dc-no').onclick=()=>done(false);
    m.querySelector('#dc-yes').onclick=()=>done(true);
    m.addEventListener('click',e=>{ if(e.target===m) done(false); });
  });
}

async function dispoUnassign(binId){
  const plan=window.__dispoPlan; if(!plan) return;
  const cfg=plan.cfg, speed=cfg.speedKmh||25, empty=cfg.emptyMin||3;
  const b0=dispoGetBins().find(x=>x.id===binId);
  const ok=await dispoConfirm('Korb aus Tour entfernen?', `„${b0?b0.name:'Papierkorb'}" wirklich aus der Tour entfernen? Er wandert zurück nach „Nicht eingeplant".`);
  if(!ok) return;
  let affected=null;
  plan.R.forEach(r=>{ if(r.route.some(s=>s.id===binId)){ r.route=r.route.filter(s=>s.id!==binId); affected=r; } });
  if(!affected) return;
  const b=dispoGetBins().find(x=>x.id===binId);
  plan.begr[binId]= b && b.fuellstand>=cfg.planbar
    ? {status:'verschoben', grund:'manuell entfernt'}
    : {status:'ausgelassen', grund:'manuell entfernt'};
  setSyncState('syncing','Route wird neu berechnet…');
  await dispoOptimizeRoute(affected, speed, empty);
  setSyncState('ok','Synchronisiert');
  plan.usedOrs=plan.R.some(x=>x._ors);
  dispoRenderResults(); dispoRenderMap();
  notify('Aus Tour entfernt');
}

function dispoRenderResults(){
  const bins=dispoGetBins();
  const plan=window.__dispoPlan;
  const kpiEl=document.getElementById('dispo-kpis');
  const resEl=document.getElementById('dispo-resources');
  const listEl=document.getElementById('dispo-list');
  const secEl=document.getElementById('dispo-list-sec');
  if(!kpiEl) return;
  const cfg=dispoGetConfig();
  if(!plan){
    const krit=bins.filter(b=>b.fuellstand>=cfg.kritisch).length;
    kpiEl.innerHTML=`<div class="dispo-kpi"><div class="v">${bins.length}</div><div class="l">Papierkörbe</div></div>
      <div class="dispo-kpi"><div class="v" style="color:var(--red);">${krit}</div><div class="l">kritisch</div></div>
      <div class="dispo-kpi"><div class="v">–</div><div class="l">geplant</div></div>`;
    resEl.innerHTML='<div class="dispo-empty">Noch nicht geplant. „Tag automatisch planen" klicken.</div>';
    listEl.innerHTML=''; if(secEl) secEl.style.display='none';
    return;
  }
  const vals=Object.values(plan.begr);
  const geplant=vals.filter(v=>v.status==='eingeplant').length;
  const verschoben=vals.filter(v=>v.status==='verschoben').length;
  const ausgelassen=vals.filter(v=>v.status==='ausgelassen').length;
  const orsNote=plan.usedOrs?'Routen: <b>Optimiert (ORS-Fahrstrecken)</b>':'Routen: Schnell (Luftlinie)';
  kpiEl.innerHTML=`<div class="dispo-kpi"><div class="v" style="color:var(--green);">${geplant}</div><div class="l">geplant</div></div>
    <div class="dispo-kpi"><div class="v" style="color:var(--amber);">${verschoben}</div><div class="l">verschoben</div></div>
    <div class="dispo-kpi"><div class="v" style="color:var(--text3);">${ausgelassen}</div><div class="l">ausgelassen</div></div>
    <div style="grid-column:1/-1;font-size:11px;color:var(--text3);margin-top:2px;">${orsNote}</div>`;

  const binById={}; bins.forEach(b=>binById[b.id]=b);

  // Ressourcen-Karten mit aufklappbarer Begründungsliste je Tour
  const filterBar = dispoVisible ? `<button onclick="dispoShowAllVehicles()" class="btn btn-secondary" style="width:100%;margin-bottom:8px;font-size:12px;padding:6px;">👁 Alle Fahrzeuge anzeigen</button>` : '';
  resEl.innerHTML=filterBar+plan.R.map((r,i)=>{
    const budget=(r.arbeitszeitMin||420)*(1-(plan.cfg.reservePct||10)/100);
    const pct=budget>0?Math.min(100,Math.round(r.minGesamt/budget*100)):0;
    const id='dres'+i;
    const binsOfR=r.route.map((s,idx)=>({b:binById[s.id]||s, v:plan.begr[s.id], idx:idx+1})).filter(x=>x.v);
    const vis=dispoResVisible(r.id);
    const isolated=dispoVisible && dispoVisible.size===1 && dispoVisible.has(r.id);
    return `<div class="dispo-res" style="${vis?'':'opacity:.5;'}${isolated?`box-shadow:inset 3px 0 0 ${dispoResColor(i)};`:''}">
      <div class="dispo-res-head" style="cursor:pointer;" onclick="dispoFocusVehicle('${r.id}')" title="${isolated?'Klick: alle Fahrzeuge zeigen':'Klick: nur diese Route zeigen'}">
        <span class="dispo-res-dot" style="background:${dispoResColor(i)};${vis?'':'opacity:.4;'}"></span>${r.name}
        <span style="margin-left:auto;font-size:11px;color:var(--text3);display:flex;align-items:center;gap:6px;">
          <button onclick="event.stopPropagation();dispoToggleVehicle('${r.id}')" title="Auf Karte ein-/ausblenden" style="border:none;background:none;cursor:pointer;font-size:13px;line-height:1;padding:0;">${vis?'👁':'🙈'}</button>
          ${r.route.length} Körbe
          <span class="dispo-chev" onclick="event.stopPropagation();dispoToggle('${id}',this.parentElement.parentElement)" style="cursor:pointer;padding:0 2px;">▸</span>
        </span>
      </div>
      <div class="dispo-bar"><div class="fill" style="width:${pct}%;background:${pct>=100?'var(--red)':dispoResColor(i)};"></div></div>
      <div class="dispo-res-meta">Auslastung ${dispoFmtH(r.minGesamt)} / ${dispoFmtH(Math.round(budget))}${r.maxBins>0?` · ${r.route.length}/${r.maxBins} Körbe`:''}</div>
      <table class="dispo-leistung">
        <tr class="h"><th>Leistung</th><th>Strecke</th><th>Dauer</th></tr>
        <tr><td>Fahrt</td><td>${r.km.toFixed(1)} km</td><td>${dispoFmtH(r.minFahrt)}</td></tr>
        <tr><td>Leerung</td><td>–</td><td>${dispoFmtH(r.minLeerung)}</td></tr>
        <tr class="g"><td>Gesamt</td><td>${r.km.toFixed(1)} km</td><td>${dispoFmtH(r.minGesamt)}</td></tr>
      </table>
      <div id="${id}" style="display:none;margin-top:8px;border-top:1px dashed var(--border);padding-top:4px;">
        ${binsOfR.length? binsOfR.map(x=>dispoRow(x.b,x.v,x.idx,{remove:true})).join('') : '<div class="dispo-empty">Keine Körbe</div>'}
      </div>
    </div>`;
  }).join('');

  // Nicht eingeplant (verschoben + ausgelassen)
  const order={verschoben:0, ausgelassen:1};
  const notPlanned=Object.entries(plan.begr).map(([id,v])=>({b:binById[id], v})).filter(x=>x.b && x.v.status!=='eingeplant')
    .sort((a,b)=> (order[a.v.status]-order[b.v.status]) || (b.b.fuellstand-a.b.fuellstand));
  if(secEl) secEl.style.display='';
  listEl.innerHTML = notPlanned.length
    ? notPlanned.map(x=>dispoRow(x.b,x.v,null,{assign:true})).join('')
    : '<div class="dispo-empty">Alle relevanten Körbe eingeplant 🎉</div>';
}

function dispoFocusPoint(id, ev){
  if(ev && ev.target.closest('select,button')) return;
  const m=dispoMarkers[id]; if(!m||!dispoMap) return;
  dispoMap.setView(m.getLatLng(), Math.max(dispoMap.getZoom(),16), {animate:true});
  m.openPopup();
}

function dispoFocusBin(id){
  const row=document.querySelector(`.dispo-list-row[data-bin="${id}"]`);
  if(!row) return;
  const coll=row.closest('[id^="dres"]');
  if(coll && getComputedStyle(coll).display==='none'){
    coll.style.display='block';
    const chev=coll.parentElement.querySelector('.dispo-chev'); if(chev) chev.textContent='▾';
  }
  row.scrollIntoView({behavior:'smooth',block:'center'});
  const prev=row.style.background;
  row.style.transition='background .25s';
  row.style.background='rgba(34,197,94,.28)';
  setTimeout(()=>{ row.style.background=prev||''; }, 1300);
}

// Betriebshöfe zeichnen: gleiche Standorte zu EINEM Marker gruppieren,
// Namen als dauerhaftes Label, eigene Höfe per Popup auf Standard zurücksetzbar.
function dispoDrawDepots(L, plan, pts){
  const stdName=dispoDefaultDepot().adresse||'Betriebshof';
  const list = (plan
    ? plan.R.map((r,i)=>({id:r.id, name:r.name, depot:r.depot, std:dispoIsStandardDepot(r.depot), col:dispoResColor(i)}))
    : dispoGetResources().map((r,i)=>({id:r.id, name:r.name, depot:dispoResolveDepot(r), std:dispoIsStandardDepot(r.depot), col:dispoResColor(i)})))
    .filter(it=>dispoResVisible(it.id)); // nur sichtbare Fahrzeuge
  const groups={};
  list.forEach(it=>{ const k=it.depot.lat.toFixed(5)+','+it.depot.lng.toFixed(5); (groups[k]||(groups[k]={depot:it.depot, items:[]})).items.push(it); });
  Object.values(groups).forEach(g=>{
    const allStd=g.items.every(it=>it.std);
    const col=allStd?'#475569':g.items.find(it=>!it.std).col;
    const label=allStd?stdName:(g.depot.adresse||'Eigener Hof');
    const pop=`<b>${allStd?'Standard-Betriebshof':'Betriebshof'}</b><br><span style="font-size:11px;color:#666;">${label}</span><div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px;font-size:12px;">`
      + g.items.map(it=>`<div style="display:flex;align-items:center;gap:6px;margin:2px 0;"><span style="width:9px;height:9px;border-radius:3px;background:${it.col};flex-shrink:0;"></span>${it.name}: ${it.std?'<i>Standard</i>':'Eigener Hof'}${it.std?'':` <button onclick="dispoResetDepot('${it.id}')" style="margin-left:auto;border:none;background:#fee2e2;color:#b91c1c;border-radius:5px;padding:2px 7px;cursor:pointer;font-size:11px;">✕ Standard</button>`}</div>`).join('')
      + `</div>`;
    // Darstellung wie in der manuellen Planung: 🏭-Symbol, Name nur als Tooltip (nicht dauerhaft)
    const icon=L.divIcon({className:'',html:`<div class="depot-marker-wrap"><div class="depot-pulse"></div><div style="width:36px;height:36px;border-radius:10px;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:18px;">🏭</div></div>`,iconSize:[36,36],iconAnchor:[18,18]});
    const m=L.marker([g.depot.lat,g.depot.lng],{icon,zIndexOffset:1000}).addTo(dispoLayer);
    m.bindTooltip(`<b>${allStd?'Standard-Betriebshof':'Betriebshof'}</b><br>${dlEsc(label)}`,{direction:'top',offset:[0,-20]});
    m.bindPopup(pop);
    if(pts) pts.push([g.depot.lat,g.depot.lng]);
  });
}

function dispoResetDepot(id){
  const res=dispoGetResources(); const t=res.find(x=>x.id===id); if(!t) return;
  t.depot=null; dispoSetResources(res);
  window.__dispoPlan=null; dispoRenderResults(); dispoRenderMap();
  notify('Betriebshof auf Standard zurückgesetzt');
}

// Echte Körbe immer an die aktuelle Objektposition koppeln (z. B. nach „Standort verschieben"),
// damit Füllstandsplanung und Objekt identisch bleiben. Füllstand/Rate (Momentaufnahme) bleiben unberührt.
function _dispoSyncReal(bins){
  let changed=false;
  (bins||[]).forEach(b=>{
    if(!b._real) return;
    const t=trees.find(x=>x.id===b.id); if(!t) return;
    if(t.lat!=null && t.lng!=null && (b.lat!==t.lat || b.lng!==t.lng)){ b.lat=t.lat; b.lng=t.lng; changed=true; }
    if(t.name && b.name!==t.name){ b.name=t.name; changed=true; }
  });
  return changed;
}
// Echtmodus: Objekt-Eigenschaften wie in der manuellen Planung öffnen (echte Körbe = echte Objekte)
function dispoOpenObjectDetail(id){
  if(!trees.find(t=>t.id===id)){ notify('Objekt nicht gefunden (nur bei echten Füllständen verfügbar)'); return; }
  try{ openDetail(id); }catch(e){ console.warn('dispoOpenObjectDetail',e); } // Leiste erscheint in der Dispo (kein Ansichtswechsel)
}
// ── Werkzeuge NUR für die Füllstandskarte: Adresssuche, Stadt-Zoom, Routenlinien ──
let _dispoSearchMarker=null, _dispoSearching=false, _dispoRoutesVisible=true;
async function doDispoSearch(){
  const inp=document.getElementById('dispo-search-input'); const q=(inp?.value||'').trim();
  const box=document.getElementById('dispo-search-results'); if(!box||!dispoMap) return;
  if(q.length<3){ box.style.display='none'; return; }
  if(_dispoSearching) return; _dispoSearching=true;
  box.innerHTML='<div class="ms-empty">Suche…</div>'; box.style.display='block';
  try{
    const rs=await geocodeSearch(q, dispoMap);
    try{ const c=dispoMap.getCenter(); rs.sort((a,b)=>dispoMap.distance(c,[+a.lat,+a.lon])-dispoMap.distance(c,[+b.lat,+b.lon])); }catch(_){}
    if(!rs.length){ box.innerHTML=`<div class="ms-empty">Keine Treffer für „${dlEsc(q)}"</div>`; }
    else{
      box.innerHTML=rs.map((r,i)=>{ const a=r.address||{}; const main=[a.road,a.house_number].filter(Boolean).join(' ')||(r.display_name||'').split(',')[0]; const sub=[a.postcode,(a.city||a.town||a.village||a.municipality||a.county)].filter(Boolean).join(' ')||(r.display_name||'').split(',').slice(1,3).join(',').trim(); return `<div class="ms-item" data-idx="${i}"><div class="ms-main">${dlEsc(main)}</div><div class="ms-sub">${dlEsc(sub)}</div></div>`; }).join('')+`<div class="ms-foot">Adressdaten © OpenStreetMap-Mitwirkende (ODbL)</div>`;
      box._results=rs;
    }
  }catch(e){ console.warn('Dispo-Adresssuche',e); box.innerHTML='<div class="ms-empty">Suche momentan nicht verfügbar</div>'; }
  finally{ _dispoSearching=false; }
}
function gotoDispoResult(r){
  const lat=parseFloat(r.lat),lng=parseFloat(r.lon); if(isNaN(lat)||isNaN(lng)||!dispoMap) return;
  dispoMap.setView([lat,lng],18);
  if(_dispoSearchMarker) dispoMap.removeLayer(_dispoSearchMarker);
  _dispoSearchMarker=L.marker([lat,lng],{zIndexOffset:2000,icon:L.divIcon({className:'',html:`<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:var(--blue);border:2.5px solid #fff;transform:rotate(-45deg);box-shadow:0 2px 7px rgba(0,0,0,.45);"></div>`,iconSize:[24,24],iconAnchor:[12,24]})}).addTo(dispoMap);
  document.getElementById('dispo-search-results').style.display='none';
  document.getElementById('dispo-search')?.classList.add('collapsed');
}
function clearDispoSearch(){
  const inp=document.getElementById('dispo-search-input'); if(inp) inp.value='';
  const box=document.getElementById('dispo-search-results'); if(box) box.style.display='none';
  const cl=document.getElementById('dispo-search-clear'); if(cl) cl.style.display='none';
  if(_dispoSearchMarker&&dispoMap){ dispoMap.removeLayer(_dispoSearchMarker); _dispoSearchMarker=null; }
}
function dispoFitBins(){
  if(!dispoMap) return;
  const pts=dispoGetBins().filter(b=>b.lat&&b.lng).map(b=>[b.lat,b.lng]);
  if(!pts.length) return;
  dispoMap.invalidateSize();
  dispoMap.fitBounds(L.latLngBounds(pts),{padding:[50,50],maxZoom:16});
}
function toggleDispoRoutes(){ _dispoRoutesVisible=!_dispoRoutesVisible; const b=document.getElementById('dispo-routes'); if(b) b.classList.toggle('off',!_dispoRoutesVisible); dispoRenderMap(); }
function dispoRenderMap(){
  const L=window.L, wrap=document.getElementById('dispo-map'); if(!L||!wrap) return;
  if(!dispoMap){
    dispoMap=L.map('dispo-map',{zoomControl:false,attributionControl:false}).setView([50.0,8.42],12);
    dispoBaseFarbe=basemapLayer('farbe').addTo(dispoMap);
    dispoBaseGrau=basemapLayer('grau');
    dispoLayer=L.layerGroup().addTo(dispoMap);
    _initDispoControls();   // Zoom + Ebenen-Umschalter wie in der manuellen Planung
    dispoRebuildLayers();   // Karte/Graustufen + Projekt-WMS-Ebenen
    setTimeout(()=>dispoMap.invalidateSize(),150);
  }
  dispoLayer.clearLayers();
  dispoMarkers={};
  const bins=dispoGetBins(), cfg=dispoGetConfig(), plan=window.__dispoPlan;
  if(_dispoSyncReal(bins)) dispoSetBins(bins); // echte Körbe an aktuelle Objektpositionen koppeln
  const pts=[];
  const filtered=plan && dispoVisible; // Sichtbarkeitsfilter aktiv?
  // Welche Körbe gehören zu sichtbaren Touren?
  let visBinIds=null;
  if(filtered){ visBinIds=new Set(); plan.R.forEach(r=>{ if(dispoResVisible(r.id)) r.route.forEach(s=>visBinIds.add(s.id)); }); }
  // Routen (nur sichtbare Fahrzeuge)
  if(plan && _dispoRoutesVisible){
    plan.R.forEach((r,i)=>{
      if(!dispoResVisible(r.id)) return;
      const col=dispoResColor(i);
      if(r.geo?.features?.[0]){
        L.geoJSON(r.geo,{style:{color:col,weight:4,opacity:.8}}).addTo(dispoLayer); // echte Straßenroute
      } else if(r.route.length){
        const line=[[r.depot.lat,r.depot.lng], ...r.route.map(s=>[s.lat,s.lng]), [r.depot.lat,r.depot.lng]];
        L.polyline(line,{color:col,weight:3,opacity:.6,dashArray:'6 4'}).addTo(dispoLayer); // Fallback Luftlinie
      }
    });
  }
  dispoDrawDepots(L, plan, pts); // Betriebshöfe: gruppiert, benannt, entfernbar (nur sichtbare)
  // Reihenfolge-Nummern je Fahrzeug-Route (wie in der manuellen Planung)
  const ordMap={}, ordCol={};
  if(plan){ plan.R.forEach((r,i)=>{ const c=dispoResColor(i); (r.route||[]).forEach((s,k)=>{ ordMap[s.id]=k+1; ordCol[s.id]=c; }); }); }
  bins.forEach(b=>{
    let col='#9c9890';
    if(plan){ const st=plan.begr[b.id]?.status; col= st==='eingeplant'?'#16a34a': st==='verschoben'?'#b45309':'#9c9890'; }
    else { col= b.fuellstand>=cfg.kritisch?'#dc2626': b.fuellstand>=cfg.planbar?'#f59e0b':'#9c9890'; }
    // Bei aktivem Filter: Körbe fremder/ausgeblendeter Touren gedämpft darstellen
    const dim = filtered && plan.begr[b.id]?.status==='eingeplant' && !visBinIds.has(b.id);
    const ord=ordMap[b.id];
    let m;
    if(ord!=null && !dim){
      const bc=ordCol[b.id]||col;
      m=L.marker([b.lat,b.lng],{zIndexOffset:400,icon:L.divIcon({className:'',html:`<div style="width:21px;height:21px;border-radius:50%;background:${bc};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;line-height:1;">${ord}</div>`,iconSize:[21,21],iconAnchor:[10,10]})}).addTo(dispoLayer);
    } else {
      m=L.circleMarker([b.lat,b.lng],{radius:dim?4:7,color:'#fff',weight:1.5,fillColor:col,fillOpacity:dim?0.25:0.95}).addTo(dispoLayer);
    }
    m.bindPopup(`<b>${dlEsc(b.name)}</b><br>Füllstand: <b>${b.fuellstand}%</b>${b.fillRate?`<br>~voll in ${Math.max(0,Math.ceil((100-b.fuellstand)/b.fillRate))} Tagen`:''}${plan?`<br>Status: ${plan.begr[b.id]?.status||'-'}`:''}${b._real?`<br><button onclick="dispoOpenObjectDetail('${b.id}')" style="margin-top:7px;padding:4px 9px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-family:inherit;">Objekt-Details ansehen →</button>`:''}`);
    m.on('click',()=>dispoFocusBin(b.id));
    dispoMarkers[b.id]=m;
    if(!filtered || !dim) pts.push([b.lat,b.lng]); // Zoom nur auf sichtbare Elemente
  });
  if(pts.length) dispoMap.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:15});
  setTimeout(()=>dispoMap.invalidateSize(),100);
}

function dispoOpenSettings(){
  const cfg=dispoGetConfig(); const res=dispoGetResources();
  const stdName=dispoDefaultDepot().adresse||'Betriebshof';
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  const rowHtml=(r,i)=>{
    const std=dispoIsStandardDepot(r.depot);
    const dAttr=std?'':JSON.stringify({lat:r.depot.lat,lng:r.depot.lng});
    const hof=std?`Standard: ${stdName}`:`Eigener Hof (${r.depot.lat.toFixed(4)}, ${r.depot.lng.toFixed(4)})`;
    return `<div class="ds-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;" data-depot='${dAttr}'>
      <input class="form-control ds-r-name" style="flex:1;min-width:0;padding:5px 8px;font-size:12px;" value="${r.name||('Fahrzeug '+(i+1))}">
      <input class="form-control ds-r-time" type="number" style="width:56px;padding:5px 8px;font-size:12px;" value="${Math.round((r.arbeitszeitMin||420)/60*10)/10}"><span style="font-size:11px;color:var(--text3);">h</span>
      <input class="form-control ds-r-max" type="number" min="0" title="Max. Körbe je Tour (0 = unbegrenzt)" style="width:56px;padding:5px 8px;font-size:12px;" value="${r.maxBins||0}">
      <span class="ds-r-hof" style="flex:1;min-width:0;font-size:11px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${hof}</span>
      <button class="btn btn-secondary ds-r-pick" style="padding:4px 8px;font-size:11px;white-space:nowrap;">📍 Karte</button>
      <button class="btn btn-secondary ds-r-std" style="padding:4px 8px;font-size:11px;${std?'display:none;':''}">Standard</button>
      <button class="btn btn-danger ds-r-del" style="padding:4px 8px;font-size:12px;">✕</button>
    </div>`;
  };
  modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:680px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">Disposition – Einstellungen</div>
    <div style="padding:16px 20px;overflow:auto;">
      <div class="dispo-sec" style="margin-top:0;">Schwellen & Zeiten</div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
        <label style="font-size:12px;">Kritisch ab (%)<input id="ds-krit" type="number" class="form-control" value="${cfg.kritisch}" style="padding:6px 8px;"></label>
        <label style="font-size:12px;">Planbar ab (%)<input id="ds-plan" type="number" class="form-control" value="${cfg.planbar}" style="padding:6px 8px;"></label>
        <label style="font-size:12px;">Ø Leerungsdauer (min)<input id="ds-empty" type="number" class="form-control" value="${cfg.emptyMin}" style="padding:6px 8px;"></label>
        <label style="font-size:12px;">Reservepuffer (%)<input id="ds-res" type="number" class="form-control" value="${cfg.reservePct}" style="padding:6px 8px;"></label>
        <label style="font-size:12px;">Ø Tempo (km/h)<input id="ds-speed" type="number" class="form-control" value="${cfg.speedKmh}" style="padding:6px 8px;"></label>
        <label style="font-size:12px;">Anzahl Körbe (Simulation)<input id="ds-count" type="number" class="form-control" value="${cfg.binCount}" style="padding:6px 8px;"></label>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;">Hinweis: „Auslassen" = alles unter „Planbar ab".</div>
      <div class="dispo-sec">Ressourcen <button id="ds-add" class="btn btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:6px;">+ Ressource</button></div>
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);">
        <span style="flex:1;">Name</span>
        <span style="width:56px;text-align:center;">Arbeitsz.</span>
        <span style="width:12px;"></span>
        <span style="width:56px;text-align:center;">Max. Körbe</span>
        <span style="flex:1;">Betriebshof</span>
        <span style="width:175px;"></span>
      </div>
      <div id="ds-res-list">${res.map(rowHtml).join('')}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:4px;">Standard = Betriebshof aus dem Planung-Reiter. „📍 Karte" setzt einen eigenen Hof per Klick auf die Karte. <b>Max. Körbe</b> = höchstens so viele Körbe je Tour (0 = unbegrenzt).</div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="ds-cancel" class="btn btn-secondary">Abbrechen</button>
      <button id="ds-save" class="btn btn-primary">Speichern</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('#ds-cancel').onclick=close;
  modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
  const listEl=modal.querySelector('#ds-res-list');
  const num=(id,def)=>{ const v=parseFloat(modal.querySelector('#'+id).value); return isNaN(v)?def:v; };
  function collectSave(){
    const newCfg={...cfg, kritisch:num('ds-krit',80), planbar:num('ds-plan',50), aus:num('ds-plan',50), emptyMin:num('ds-empty',3), reservePct:num('ds-res',10), speedKmh:num('ds-speed',25), binCount:Math.round(num('ds-count',40))};
    dispoSetConfig(newCfg);
    const newRes=[...listEl.querySelectorAll('.ds-row')].map((row,i)=>{
      let depot=null; const da=row.getAttribute('data-depot'); if(da){ try{ depot=JSON.parse(da); }catch(e){} }
      return { id:'r'+(i+1), name:row.querySelector('.ds-r-name').value.trim()||('Fahrzeug '+(i+1)),
        arbeitszeitMin:Math.round((parseFloat(row.querySelector('.ds-r-time').value)||7)*60),
        maxBins:Math.max(0, Math.round(parseFloat(row.querySelector('.ds-r-max').value)||0)), depot };
    });
    dispoSetResources(newRes.length?newRes:dispoGetResources());
  }
  modal.querySelector('#ds-add').onclick=()=>{
    const tmp=document.createElement('div');
    tmp.innerHTML=rowHtml({name:'Fahrzeug '+(listEl.children.length+1), arbeitszeitMin:420, depot:null, maxBins:0}, listEl.children.length);
    listEl.appendChild(tmp.firstElementChild);
  };
  listEl.onclick=e=>{
    const row=e.target.closest('.ds-row'); if(!row) return;
    if(e.target.closest('.ds-r-del')){ row.remove(); return; }
    if(e.target.closest('.ds-r-std')){ row.setAttribute('data-depot',''); row.querySelector('.ds-r-hof').textContent='Standard: '+stdName; e.target.closest('.ds-r-std').style.display='none'; return; }
    if(e.target.closest('.ds-r-pick')){ const idx=[...listEl.children].indexOf(row); collectSave(); close(); dispoPickDepot(idx); return; }
  };
  modal.querySelector('#ds-save').onclick=()=>{
    collectSave(); close();
    window.__dispoPlan=null; dispoRenderResults(); dispoRenderMap();
    notify('Einstellungen gespeichert');
  };
}

// Eigenen Betriebshof per Klick auf die Karte setzen
function dispoPickDepot(i){
  if(!dispoMap){ notify('Disposition-Karte nicht bereit'); return; }
  if(dispoPickCleanup){ dispoPickCleanup(); } // evtl. laufende Auswahl beenden
  const name=dispoGetResources()[i]?.name||'Ressource';
  document.getElementById('dispo-pick-banner')?.remove();
  const ban=document.createElement('div'); ban.id='dispo-pick-banner';
  ban.style.cssText='position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9000;background:var(--blue);color:#fff;padding:8px 14px;border-radius:8px;box-shadow:var(--shadow-md);font-size:13px;display:flex;align-items:center;gap:12px;';
  ban.innerHTML=`🏢 Auf die Karte klicken: Betriebshof für „${name}" <button id="dpb-cancel" style="background:rgba(255,255,255,.25);border:none;color:#fff;border-radius:6px;padding:3px 8px;cursor:pointer;">Abbrechen</button>`;
  document.body.appendChild(ban);
  dispoMap.getContainer().style.cursor='crosshair';
  const cleanup=()=>{ dispoMap.off('click',onClick); dispoMap.getContainer().style.cursor=''; ban.remove(); dispoPickCleanup=null; };
  dispoPickCleanup=cleanup;
  const onClick=(e)=>{
    const r=dispoGetResources();
    if(r[i]){ r[i].depot={lat:e.latlng.lat, lng:e.latlng.lng, adresse:'Eigener Hof'}; dispoSetResources(r); }
    cleanup(); window.__dispoPlan=null; dispoRenderResults(); dispoRenderMap(); notify('Betriebshof gesetzt'); dispoOpenSettings();
  };
  dispoMap.on('click', onClick);
  ban.querySelector('#dpb-cancel').onclick=()=>{ cleanup(); dispoOpenSettings(); };
}

function initDispo(){
  dispoGetResources(); // Defaults sicherstellen
  if(dispoGetBins().length===0) dispoSimulate(); else { dispoRenderResults(); dispoRenderMap(); }
  setTimeout(()=>{ if(dispoMap) dispoMap.invalidateSize(); },200);
}

// ─── KI-AUSWERTUNG (Prompt-Bibliothek) ───────────────────────
// Zeitraum-Auswahl: Meldungen (history[] + Live-Status) werden auf den Zeitraum gefiltert
function kiComputeRange(period,from,to){
  const today=new Date(); const day=d=>d.toISOString().slice(0,10);
  const first=new Date(today.getFullYear(),today.getMonth(),1);
  if(period==='7'){ const f=new Date(today); f.setDate(f.getDate()-6); return {from:day(f),to:day(today),label:'Letzte 7 Tage'}; }
  if(period==='30'){ const f=new Date(today); f.setDate(f.getDate()-29); return {from:day(f),to:day(today),label:'Letzte 30 Tage'}; }
  if(period==='month') return {from:day(first),to:day(today),label:'Dieser Monat'};
  if(period==='prev'){ const pf=new Date(today.getFullYear(),today.getMonth()-1,1), pt=new Date(today.getFullYear(),today.getMonth(),0); return {from:day(pf),to:day(pt),label:'Letzter Monat'}; }
  if(period==='custom'&&(from||to)) return {from:from||'2000-01-01',to:to||day(today),label:`${from?fmtDateDE(from):'Anfang'} – ${to?fmtDateDE(to):'heute'}`};
  return {from:null,to:null,label:'Gesamter Zeitraum'};
}
function fmtDateDE(iso){ const [y,m,d]=(iso||'').split('-'); return d&&m&&y?`${d}.${m}.${y}`:iso; }
// Alle Meldungen (Datum/Status/Grund) je aktivem Objekt im Zeitraum — Quelle: history[] + Live-Status
function kiReports(from,to){
  const out=[], seen=new Set();
  const inR=d=>d&&(!from||d>=from)&&(!to||d<=to);
  trees.filter(isActive).forEach(t=>{
    (t.history||[]).forEach(h=>{
      if(!h.date||!h.status||h.status==='offen') return;
      const d=(''+h.date).slice(0,10);
      if(inR(d)){ out.push({t,date:d,status:h.status,reason:h.reason||null}); seen.add(t.id+'|'+d); }
    });
    if(t.lastStatus&&t.lastStatus!=='offen'&&t.lastReportAt){
      const d=(''+t.lastReportAt).slice(0,10);
      if(inR(d)&&!seen.has(t.id+'|'+d)) out.push({t,date:d,status:t.lastStatus,reason:t.lastReason||null});
    }
  });
  return out;
}
function buildKiContext(range){
  if(!currentProjectId) return 'Kein Projekt geöffnet.';
  const active=trees.filter(isActive);
  const grp=(arr,key,top)=>{ const m={}; arr.forEach(t=>{const v=key(t)||'—';m[v]=(m[v]||0)+1;}); let e=Object.entries(m).sort((a,b)=>b[1]-a[1]); if(top)e=e.slice(0,top); return e.map(([k,n])=>`${k}: ${n}`).join(', '); };
  const r=range||kiComputeRange('all');
  const reps=kiReports(r.from,r.to);
  const bew=reps.filter(x=>x.status==='bewaessert').length;
  const nicht=reps.filter(x=>x.status==='nicht').length;
  const objMitMeldung=new Set(reps.map(x=>x.t.id)).size;
  const gruende=grp(reps.filter(x=>x.status==='nicht'), x=>x.reason)||'keine';
  const nichtStadtteil=grp(reps.filter(x=>x.status==='nicht'), x=>x.t.stadtteil)||'keine';
  const tourStr=tours.map(t=>{ const c=active.filter(x=>treeInTour(x,t.id)).length; const rt=tourRoutes[t.id]; return `${t.name}: ${c} Objekte${rt?`, ${rt.km.toFixed(1)} km`:''}`; }).join(' | ')||'keine';
  return [
    `Projekt: ${currentProjectData?.name||currentProjectId}`,
    `Auswertungszeitraum: ${r.label}${r.from?` (${fmtDateDE(r.from)} bis ${fmtDateDE(r.to)})`:''}`,
    `Objekte gesamt (aktiv): ${active.length}`,
    `${FL.zustand} (Bestand): ${rankList('zustand').map(e=>`${e.label} ${active.filter(t=>(t.zustand||'')===e.id).length}`).join(', ')}`,
    `Meldungen im Zeitraum: ${reps.length} gesamt — bewässert ${bew}, nicht bewässert ${nicht}; betroffene Objekte: ${objMitMeldung}; ohne Meldung im Zeitraum: ${active.length-objMitMeldung}`,
    `Gründe „nicht bewässert" (Zeitraum): ${gruende}`,
    `„Nicht bewässert" je Stadtteil (Zeitraum): ${nichtStadtteil}`,
    `Objekte je Stadtteil (Bestand): ${grp(active,t=>t.stadtteil)}`,
    `Top-Baumarten: ${grp(active,t=>t.art,8)}`,
    `Pflanzjahre: ${grp(active,t=>t.pflanzjahr,8)}`,
    `Touren (${tours.length}): ${tourStr}`,
  ].join('\n');
}

const KI_PROMPTS=[
  {id:'ausfall',icon:'⚠️',title:'Ausfallanalyse',desc:'Warum werden Objekte nicht versorgt? Muster & Maßnahmen.',
   build:c=>`Du bist Experte für kommunales Grünflächen- und Baumbewässerungsmanagement. Analysiere die folgenden Daten. Finde Muster bei den nicht bewässerten Objekten (Gründe, Stadtteile, Touren), nenne die 3 wichtigsten Ursachen und konkrete, umsetzbare Maßnahmen zur Reduzierung der Ausfälle.\n\nDaten:\n${c}`},
  {id:'touren',icon:'🚐',title:'Tour-Effizienz',desc:'Ineffiziente Touren erkennen, Objekte sinnvoll umverteilen.',
   build:c=>`Analysiere die Touren hinsichtlich Effizienz (Anzahl Objekte je Tour, Streckenlänge). Identifiziere unausgewogene oder ineffiziente Touren und schlage eine bessere Aufteilung der Objekte vor, um den Fahraufwand zu minimieren. Begründe kurz.\n\nDaten:\n${c}`},
  {id:'risiko',icon:'🌡️',title:'Zustands-Risiko',desc:'Objekte/Stadtteile mit schlechtem Zustand priorisieren.',
   build:c=>`Bewerte das Risiko für Trockenstress. Welche Stadtteile oder Objektgruppen mit schlechtem Zustand und geringer Bewässerung sind besonders gefährdet? Erstelle eine priorisierte Handlungsliste für die kommende Woche.\n\nDaten:\n${c}`},
  {id:'abdeckung',icon:'🗺️',title:'Abdeckungs-Lücken',desc:'Wo fehlt Versorgung? Abdeckungsgrad je Gebiet.',
   build:c=>`Ermittle Versorgungslücken: Welche Objekte/Stadtteile sind „offen" (keine Meldung)? Wie hoch ist der Abdeckungsgrad je Stadtteil und Tour? Wo besteht der größte Handlungsbedarf?\n\nDaten:\n${c}`},
  {id:'jung',icon:'🌱',title:'Jungbaum-Check',desc:'Werden frisch gepflanzte Objekte ausreichend versorgt?',
   build:c=>`Jung gepflanzte Bäume benötigen besonders viel Wasser. Prüfe anhand der Pflanzjahre, ob die jüngsten Objekte ausreichend bewässert werden, und gib konkrete Empfehlungen für deren Pflege.\n\nDaten:\n${c}`},
  {id:'bericht',icon:'📋',title:'Management-Bericht',desc:'Kompakter Wochenbericht für die Amtsleitung.',
   build:c=>`Erstelle einen prägnanten Management-Wochenbericht (max. 1 Seite) zur Baumbewässerung: aktuelle Lage, Fortschritt, Ausfälle, Risiken und 3 Empfehlungen. Sachlicher Ton, für die Amtsleitung.\n\nDaten:\n${c}`},
  {id:'frei',icon:'💬',title:'Eigene Frage',desc:'Freie Frage an die KI – Projektdaten als Kontext.',
   build:c=>`Beantworte die folgende Frage zur Baumbewässerung anhand der Daten.\n\nFRAGE: [hier deine Frage eintragen]\n\nDaten:\n${c}`},
];

function renderKi(){
  const grid=document.getElementById('ki-grid'); if(!grid) return;
  grid.innerHTML=KI_PROMPTS.map(p=>`<button class="ki-card" onclick="openKiPrompt('${p.id}')">
    <div class="ki-ic">${p.icon}</div>
    <div class="ki-tt">${p.title}</div>
    <div class="ki-dd">${p.desc}</div>
  </button>`).join('');
}

// Markdown (Gemini-Antwort) → HTML für Anzeige & Bericht
function mdToHtml(md){
  const E=s=>(''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline=s=>E(s).replace(/\*\*(.+?)\*\*/g,'<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g,'$1<i>$2</i>').replace(/`([^`]+)`/g,'<code>$1</code>');
  const L=(''+md).split(/\r?\n/); let h='',i=0;
  while(i<L.length){
    const l=L[i];
    if(/^\s*$/.test(l)){i++;continue;}
    const hm=l.match(/^(#{1,4})\s+(.*)/);
    if(hm){ const lv=Math.min(hm[1].length+1,5); h+=`<h${lv}>${inline(hm[2])}</h${lv}>`; i++; continue; }
    if(/^\s*[-*]\s+/.test(l)){ h+='<ul>'; while(i<L.length&&/^\s*[-*]\s+/.test(L[i])){ h+='<li>'+inline(L[i].replace(/^\s*[-*]\s+/,''))+'</li>'; i++; } h+='</ul>'; continue; }
    if(/^\s*\d+[.)]\s+/.test(l)){ h+='<ol>'; while(i<L.length&&/^\s*\d+[.)]\s+/.test(L[i])){ h+='<li>'+inline(L[i].replace(/^\s*\d+[.)]\s+/,''))+'</li>'; i++; } h+='</ol>'; continue; }
    if(/^\s*\|.*\|\s*$/.test(l)){
      const rows=[]; while(i<L.length&&/^\s*\|.*\|\s*$/.test(L[i])){ rows.push(L[i]); i++; }
      const cells=r=>r.trim().replace(/^\||\|$/g,'').split('|').map(c=>c.trim());
      let first=true; h+='<table>';
      rows.forEach(r=>{ if(/^\s*\|[\s:|-]+\|\s*$/.test(r)) return; const tag=first?'th':'td'; first=false; h+='<tr>'+cells(r).map(c=>`<${tag}>${inline(c)}</${tag}>`).join('')+'</tr>'; });
      h+='</table>'; continue;
    }
    if(/^\s*(---+|\*\*\*+)\s*$/.test(l)){ h+='<hr>'; i++; continue; }
    const par=[]; while(i<L.length&&!/^\s*$/.test(L[i])&&!/^#{1,4}\s|^\s*[-*]\s|^\s*\d+[.)]\s|^\s*\|/.test(L[i])){ par.push(L[i]); i++; }
    h+='<p>'+inline(par.join(' '))+'</p>';
  }
  return h;
}
// Druck-/Word-fertiger Bericht aus der Gemini-Antwort
function kiReportHtml(title,ans,periodLabel){
  const proj=dlEsc(currentProjectData?.name||''), today=new Date().toLocaleDateString('de-DE');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${dlEsc(title)} – ${proj}</title><style>
    body{font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;margin:0;padding:34px 40px;font-size:12.5px;line-height:1.6;}
    h1{font-size:21px;margin:0 0 3px;color:#2d6a4f;} h2{font-size:15px;color:#2d6a4f;border-bottom:1px solid #d9d4c8;padding-bottom:3px;margin:20px 0 8px;}
    h3{font-size:13.5px;margin:15px 0 6px;} h4,h5{font-size:12.5px;margin:12px 0 4px;}
    p{margin:6px 0;} ul,ol{margin:6px 0;padding-left:22px;} li{margin:3px 0;}
    table{border-collapse:collapse;width:100%;margin:10px 0;} th,td{border:1px solid #cfcabd;padding:5px 9px;text-align:left;font-size:11.5px;} th{background:#eef2ee;}
    code{background:#f1efe9;padding:1px 4px;border-radius:3px;font-size:11.5px;}
    .meta{color:#6b7280;font-size:11.5px;margin:2px 0 16px;padding-bottom:10px;border-bottom:2px solid #2d6a4f;}
    .disc{margin-top:26px;padding-top:8px;border-top:1px solid #d9d4c8;color:#9ca3af;font-size:10.5px;}
    @page{margin:18mm 16mm;} @media print{body{padding:0;}}
  </style></head><body>
    <h1>${dlEsc(title)}</h1>
    <div class="meta">Stadt/Projekt: ${proj} &nbsp;·&nbsp; Auswertungszeitraum: ${dlEsc(periodLabel)} &nbsp;·&nbsp; Erstellt am: ${today} &nbsp;·&nbsp; Quelle: KI-Analyse (Google Gemini)</div>
    ${mdToHtml(ans)}
    <div class="disc">Automatisch erstellter KI-Bericht — Inhalte vor Verwendung fachlich prüfen.</div>
  </body></html>`;
}
function kiExportPdf(html){
  const w=window.open('','_blank','width=920,height=720');
  if(!w){ notify('Popup blockiert — bitte Popups für diese Seite erlauben'); return; }
  w.document.write(html); w.document.close();
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(_){} },450);
}
function kiExportWord(html,title){
  const blob=new Blob(['﻿'+html],{type:'application/msword'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`KI-Bericht_${(title||'Analyse').replace(/[^\wäöüÄÖÜß-]+/g,'_')}_${new Date().toISOString().slice(0,10)}.doc`;
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

function openKiPrompt(id){
  const p=KI_PROMPTS.find(x=>x.id===id); if(!p) return;
  if(!currentProjectId){ notify('Bitte zuerst ein Projekt öffnen'); return; }
  const esc=s=>(''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const auto=kiHasAuto(), manual=kiHasManual();
  let curRange=kiComputeRange('30');
  const buildText=()=>p.build(buildKiContext(curRange))+
    '\n\nFormatiere die Antwort als übersichtlichen Bericht in Markdown: ## Überschriften, kurze Absätze, Aufzählungen, wo sinnvoll eine Tabelle. Beginne mit einer Zusammenfassung (2–3 Sätze).';
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  const footer=[
    auto?`<button id="ki-gemini" class="btn btn-primary">🤖 Mit Gemini auswerten</button>`:'',
    manual?`<button id="ki-copy" class="btn ${auto?'btn-secondary':'btn-primary'}">📋 Prompt kopieren</button>`:'',
    manual?`<a href="https://chatgpt.com/" target="_blank" rel="noopener" class="btn btn-secondary">ChatGPT ↗</a>`:'',
    manual?`<a href="https://copilot.microsoft.com/" target="_blank" rel="noopener" class="btn btn-secondary">Copilot ↗</a>`:'',
  ].filter(Boolean).join('');
  modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:860px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${p.icon}</span>
      <div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:700;">${p.title}</div><div style="font-size:12px;color:var(--text3);">${p.desc}</div></div>
      <button id="ki-close" style="border:none;background:none;cursor:pointer;color:var(--text2);font-size:22px;line-height:1;">×</button>
    </div>
    <div style="padding:14px 20px;overflow:auto;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:600;">Zeitraum:</span>
        <select id="ki-period" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <option value="7">Letzte 7 Tage</option>
          <option value="30" selected>Letzte 30 Tage</option>
          <option value="month">Dieser Monat</option>
          <option value="prev">Letzter Monat</option>
          <option value="all">Gesamter Zeitraum</option>
          <option value="custom">Eigener Zeitraum…</option>
        </select>
        <span id="ki-custom" style="display:none;align-items:center;gap:6px;">
          <input type="date" id="ki-from" style="padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <span style="font-size:12px;color:var(--text3);">bis</span>
          <input type="date" id="ki-to" style="padding:4px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
        </span>
        <span style="font-size:11px;color:var(--text3);">— filtert die Meldungsdaten im Prompt</span>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Prompt (editierbar)${auto?' – „Mit Gemini auswerten" oder ':' – '}kopieren und in einen KI-Dienst einfügen:</div>
      <textarea id="ki-text" style="width:100%;height:${auto?'200px':'300px'};font-family:'DM Mono',monospace;font-size:12px;line-height:1.5;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;resize:vertical;background:var(--bg);color:var(--text);outline:none;">${esc(buildText())}</textarea>
      <div style="font-size:11px;color:var(--amber);margin-top:8px;">⚠ Die Projektdaten sind im Prompt enthalten.${auto?' Bei „Mit Gemini auswerten" werden sie über die Cloud Function an Google Gemini gesendet.':' Beim Einfügen in einen externen KI-Dienst verlassen sie die App.'}</div>
      <div id="ki-result" style="display:none;margin-top:14px;"></div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">${footer}</div>
  </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('#ki-close').onclick=close;
  modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
  // Zeitraum ändern → Prompt neu aufbauen (überschreibt manuelle Änderungen am Prompt)
  const refresh=()=>{
    const per=modal.querySelector('#ki-period').value;
    modal.querySelector('#ki-custom').style.display=per==='custom'?'inline-flex':'none';
    curRange=kiComputeRange(per, modal.querySelector('#ki-from').value, modal.querySelector('#ki-to').value);
    modal.querySelector('#ki-text').value=buildText();
  };
  modal.querySelector('#ki-period').onchange=refresh;
  modal.querySelector('#ki-from').onchange=refresh;
  modal.querySelector('#ki-to').onchange=refresh;
  const copyBtn=modal.querySelector('#ki-copy');
  if(copyBtn) copyBtn.onclick=()=>{
    const ta=modal.querySelector('#ki-text');
    const ok=()=>notify('Prompt kopiert');
    if(navigator.clipboard?.writeText) navigator.clipboard.writeText(ta.value).then(ok).catch(()=>{ta.select();document.execCommand('copy');ok();});
    else { ta.select(); document.execCommand('copy'); ok(); }
  };
  const gemBtn=modal.querySelector('#ki-gemini');
  if(gemBtn) gemBtn.onclick=async ()=>{
    const res=modal.querySelector('#ki-result');
    const promptText=modal.querySelector('#ki-text').value;
    const old=gemBtn.textContent; gemBtn.disabled=true; gemBtn.textContent='⏳ Gemini denkt…';
    res.style.display='block'; res.innerHTML='<div style="color:var(--text3);font-size:12px;">Antwort wird generiert…</div>';
    try{
      const idToken=await firebase.auth().currentUser?.getIdToken();
      const r=await fetch('/api/gemini',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+(idToken||'')},body:JSON.stringify({prompt:promptText})});
      let data={}; try{ data=await r.json(); }catch(_){}
      if(!r.ok){
        const det=data.detail?(' – '+esc(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail))):'';
        res.innerHTML=`<div style="color:var(--red);font-size:12px;">Fehler (${r.status}): ${esc(data.error||'unbekannt')}${det}</div>`;
      } else {
        const ans=data.text||'(leere Antwort)';
        res.innerHTML=`<style>.ki-md h2{font-size:14px;margin:12px 0 6px;color:var(--green);}.ki-md h3{font-size:13px;margin:10px 0 4px;}.ki-md p{margin:6px 0;}.ki-md ul,.ki-md ol{margin:6px 0;padding-left:20px;}.ki-md li{margin:2px 0;}.ki-md table{border-collapse:collapse;margin:8px 0;width:100%;}.ki-md th,.ki-md td{border:1px solid var(--green-mid);padding:4px 8px;font-size:12px;text-align:left;}.ki-md th{background:rgba(45,106,79,.08);}</style>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap;">
            <span style="font-size:11px;font-weight:700;color:var(--green);">🤖 GEMINI-ANTWORT</span>
            <span style="margin-left:auto;display:flex;gap:6px;">
              <button id="ki-rep-pdf" class="btn btn-primary" style="padding:3px 10px;font-size:11px;">🖨️ Bericht als PDF</button>
              <button id="ki-rep-word" class="btn btn-secondary" style="padding:3px 10px;font-size:11px;">📄 Als Word</button>
              <button id="ki-ans-copy" class="btn btn-secondary" style="padding:3px 10px;font-size:11px;">Kopieren</button>
            </span></div>
          <div class="ki-md" style="font-size:13px;line-height:1.6;background:var(--green-light);border:1px solid var(--green-mid);border-radius:var(--radius-sm);padding:14px;max-height:380px;overflow:auto;">${mdToHtml(ans)}</div>`;
        const ac=res.querySelector('#ki-ans-copy'); if(ac) ac.onclick=()=>{ navigator.clipboard?.writeText(ans); notify('Antwort kopiert'); };
        const rp=res.querySelector('#ki-rep-pdf'); if(rp) rp.onclick=()=>kiExportPdf(kiReportHtml(p.title,ans,curRange.label));
        const rw=res.querySelector('#ki-rep-word'); if(rw) rw.onclick=()=>kiExportWord(kiReportHtml(p.title,ans,curRange.label),p.title);
      }
    }catch(e){
      res.innerHTML=`<div style="color:var(--red);font-size:12px;">Netzwerkfehler: ${esc(String(e))}<br>Läuft die Cloud Function bereits? (Lokal über Vite ist „/api/gemini" nicht verfügbar – nur auf der deployten Seite.)</div>`;
    }
    gemBtn.disabled=false; gemBtn.textContent=old;
  };
}

function renderKiConfig(){
  const el=document.getElementById('kiconfig-options'); if(!el) return;
  const cur=getKiMode();
  const cityEl=document.getElementById('kiconfig-city');
  if(cityEl) cityEl.textContent=currentProjectData?.name?`Stadt: ${currentProjectData.name}`:'';
  const opts=[
    {v:'off',t:'Aus',d:'KI-Analyse ist für Nutzer komplett ausgeblendet (kein Reiter „KI-Analysen").'},
    {v:'manual',t:'Manuell – Prompts kopieren',d:'Fertige Prompts zum Kopieren in ChatGPT/Claude. Kein Server, kein Key nötig.'},
    {v:'auto',t:'Automatisch – Gemini',d:'Antwort direkt in der App über die Cloud Function. Voraussetzung: Function deployt + Gemini-Key als Secret gesetzt.'},
    {v:'both',t:'Beide',d:'Nutzer kann den Prompt kopieren ODER direkt mit Gemini auswerten lassen.'},
  ];
  el.innerHTML=opts.map(o=>`<button onclick="setKiMode('${o.v}')" style="display:block;width:100%;text-align:left;padding:12px 14px;border:2px solid ${cur===o.v?'var(--green)':'var(--border)'};border-radius:var(--radius-sm);background:${cur===o.v?'var(--green-light)':'var(--surface)'};cursor:pointer;font-family:inherit;margin-bottom:8px;transition:all .12s;">
    <div style="font-size:14px;font-weight:700;color:${cur===o.v?'var(--green)':'var(--text)'};">${cur===o.v?'● ':'○ '}${o.t}</div>
    <div style="font-size:12px;color:var(--text3);margin-top:3px;">${o.d}</div>
  </button>`).join('');
}

// ─── MANDANTEN-VERWALTUNG (nur Superadmin) ───────────────────────────────────
async function renderMandanten(){
  const el=document.getElementById('mandanten-body'); if(!el) return;
  if(currentRole!=='superadmin'){ el.innerHTML='<div style="padding:24px;color:var(--text3);font-size:13px;">Nur der Superadmin kann Mandanten verwalten.</div>'; return; }
  el.innerHTML='<div style="color:var(--text3);font-size:13px;">Lade…</div>';
  let orgs=[],projs=[],drvCount={};
  try{
    const [oq,pq,dq]=await Promise.all([db.collection('orgs').get(),db.collection('projects').get(),db.collection('drivers').get()]);
    orgs=oq.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.name||a.id).localeCompare(b.name||b.id));
    projs=pq.docs.map(d=>({id:d.id,...d.data()}));
    dq.forEach(d=>{ const o=d.data().orgId; drvCount[o]=(drvCount[o]||0)+1; });
  }catch(e){ el.innerHTML='<div style="color:var(--red);font-size:13px;">Fehler beim Laden: '+dlEsc(e.message||'')+'</div>'; return; }
  const orgIds=new Set(orgs.map(o=>o.id));
  const orphan=projs.filter(p=>!orgIds.has(p.orgId));
  const projRow=(p,org)=>`<div style="display:flex;align-items:center;gap:8px;padding:5px 10px;background:var(--bg);border-radius:6px;margin-bottom:4px;">
      <span style="font-size:14px;">${p.icon||'🌳'}</span>
      <span style="flex:1;font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(p.name||p.id)}</span>
      <span style="font-size:11px;color:var(--text3);">${p.treeCount??'–'} Objekte</span>
      <select onchange="if(this.value){moveProjectUi('${dlEsc(p.id)}','${dlEsc(p.name||'')}',this.value);this.selectedIndex=0;}" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">
        <option value="">→ verschieben…</option>
        ${orgs.filter(o=>o.id!==org).map(o=>`<option value="${dlEsc(o.id)}">${dlEsc(o.name||o.id)}</option>`).join('')}
      </select>
    </div>`;
  el.innerHTML=`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 16px;margin-bottom:16px;">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px;">+ Neuen Mandanten anlegen</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <input id="org-new-name" class="form-control" placeholder="Name (z. B. Ahlen)" style="flex:1;min-width:160px;padding:7px 10px;font-size:13px;">
        <input id="org-new-code" class="form-control" placeholder="Stadt-Code (z. B. AHLEN)" maxlength="12" style="width:170px;padding:7px 10px;font-size:13px;text-transform:uppercase;">
        <button class="btn btn-primary" style="padding:7px 14px;font-size:13px;" onclick="createOrgUi()">Anlegen</button>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px;">Danach unter Admin → Benutzer Personen für den neuen Mandanten anlegen.</div>
    </div>
    ${orgs.map(o=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-size:14px;font-weight:700;">${dlEsc(o.name||o.id)}</span>
        ${o.code?`<span style="font-size:10px;font-weight:700;background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:99px;">${dlEsc(o.code)}</span>`:''}
        <span style="font-size:11px;color:var(--text3);margin-left:auto;">${drvCount[o.id]||0} Personen · ${projs.filter(p=>p.orgId===o.id).length} Projekte</span>
      </div>
      ${projs.filter(p=>p.orgId===o.id).map(p=>projRow(p,o.id)).join('')||'<div style="font-size:12px;color:var(--text3);padding:2px 0;">Keine Projekte.</div>'}
    </div>`).join('')}
    ${orphan.length?`<div style="background:#fef3c7;border:1px solid #b45309;border-radius:12px;padding:12px 16px;">
      <div style="font-size:12px;font-weight:700;color:#7a4a06;margin-bottom:6px;">Projekte ohne gültigen Mandanten</div>
      ${orphan.map(p=>projRow(p,p.orgId)).join('')}
    </div>`:''}`;
}
async function createOrgUi(){
  const name=(document.getElementById('org-new-name')?.value||'').trim();
  const code=(document.getElementById('org-new-code')?.value||'').trim().toUpperCase();
  if(!name){ notify('Bitte Name eingeben'); return; }
  if(!/^[A-Z0-9]{2,12}$/.test(code)){ notify('Stadt-Code: 2–12 Zeichen, nur A–Z und 0–9'); return; }
  const id='org_'+name.toLowerCase().replace(/[äöüß]/g,m=>({'ä':'ae','ö':'oe','ü':'ue','ß':'ss'}[m])).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40);
  try{
    const ex=await db.collection('orgs').doc(id).get();
    if(ex.exists){ notify('Ein Mandant mit diesem Namen existiert bereits'); return; }
    await db.collection('orgs').doc(id).set({name});
    await dlFnCall('setOrgCode',{orgId:id,code}); // prüft Eindeutigkeit des Codes
    notify('✓ Mandant „'+name+'" angelegt');
    renderMandanten();
  }catch(e){ notify(fnErr(e)); }
}
async function moveProjectUi(projectId,projectName,targetOrgId){
  if(!confirm(`Projekt „${projectName}" wirklich in einen anderen Mandanten verschieben?\nAlle Objekte, Touren und Verläufe ziehen mit um.`)){ renderMandanten(); return; }
  notify('Verschiebe Projekt…');
  try{
    const r=await dlFnCall('moveProjectToOrg',{projectId,targetOrgId});
    notify(`✓ Projekt verschoben (${r.data?.moved??'?'} Einträge aktualisiert)`);
  }catch(e){ notify(fnErr(e)); }
  renderMandanten();
}

// ─── SYSTEM & COMPLIANCE (nur Superadmin, Avatar-Menü) ────────
let _siTab='dsgvo', _siAppVersions=null, _siStand=null;
const SI_TABS=[
  {id:'dsgvo',label:'DSGVO-Checkliste'},
  {id:'stack',label:'Technik-Stack'},
  {id:'regionen',label:'Datenstandorte'},
  {id:'apps',label:'Apps & Versionen'},
  {id:'sicherheit',label:'Sicherheit'},
  {id:'dienste',label:'Lizenzen & Dienste'},
];
function setSiTab(t){ _siTab=t; renderSystemInfo(); }
// Live-Versionen der eingebundenen Bibliotheken — passen sich bei Updates automatisch an
function siLibVersion(key){
  try{
    if(key==='leaflet') return window.L?.version||'';
    if(key==='chartjs') return window.Chart?.version||'';
    if(key==='sheetjs') return window.XLSX?.version||'';
    if(key==='firebase') return window.firebase?.SDK_VERSION?('SDK '+window.firebase.SDK_VERSION):'';
  }catch(_){}
  return '';
}
async function siLoadDynamic(){
  if(_siStand===null){
    _siStand='';
    try{ const cl=await fetch('/changelog.json').then(r=>r.json()); _siStand=cl?.[0]?.d||''; }catch(_){}
    const el=document.getElementById('si-stand');
    if(el&&_siStand) el.textContent='Letzte Aktualisierung: '+_siStand;
  }
  if(!_siAppVersions){
    const v={};
    await Promise.all(SI_APPS.map(async a=>{
      try{
        const t=await fetch('/'+a.file,{cache:'no-store'}).then(r=>r.text());
        const m=t.slice(0,300).match(/<!--[^>]*?\b(v-?\d[^\s·>]*)/); // Versions-Kommentar im Kopf der HTML-Datei (z.B. „v7.3", „v-35", „erfassung v1.0")
        v[a.file]=m?m[1]:'';
      }catch(_){ v[a.file]=''; }
    }));
    _siAppVersions=v;
    if(_siTab==='apps') renderSystemInfo(); // Versionen nachtragen, sobald geladen
  }
}
function siVerBadge(txt){
  return txt?`<span style="flex-shrink:0;font-size:11px;font-weight:700;font-family:'DM Mono',monospace;background:var(--surface2);color:var(--text2);padding:3px 10px;border-radius:99px;white-space:nowrap;">${dlEsc(txt)}</span>`:'';
}
function siRow(title,note,badge){
  return `<div style="display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:6px;">
    <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">${dlEsc(title)}</div>
    <div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5;">${dlEsc(note)}</div></div>
    ${badge||''}
  </div>`;
}
function renderSystemInfo(){
  if(currentRole!=='superadmin') return;
  const tabs=document.getElementById('si-tabs'), cont=document.getElementById('si-content');
  if(!tabs||!cont) return;
  tabs.innerHTML=SI_TABS.map(t=>{
    const on=_siTab===t.id;
    return `<button onclick="setSiTab('${t.id}')" style="border:none;border-radius:6px;padding:5px 12px;font-size:12px;font-weight:600;font-family:inherit;cursor:pointer;background:${on?'var(--surface)':'transparent'};color:${on?'var(--text)':'var(--text3)'};box-shadow:${on?'0 1px 2px rgba(0,0,0,.08)':'none'};">${t.label}</button>`;
  }).join('');
  siLoadDynamic();
  if(_siTab==='dsgvo'){
    const ok=SI_DSGVO.filter(i=>i.status==='ok').length;
    cont.innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">Stand der Umsetzung: <b>${ok} von ${SI_DSGVO.length}</b> Punkten technisch umgesetzt — offene Punkte sind organisatorisch durch den Betreiber zu erledigen.</div>`
      +SI_DSGVO.map(i=>`<div style="display:flex;gap:10px;align-items:flex-start;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:6px;">
        <span style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${i.status==='ok'?'var(--green-light)':'var(--amber-light)'};color:${i.status==='ok'?'var(--green)':'var(--amber)'};">${i.status==='ok'?'✓ umgesetzt':'⏳ offen'}</span>
        <div><div style="font-size:13px;font-weight:600;">${dlEsc(i.label)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px;line-height:1.5;">${dlEsc(i.note)}</div></div>
      </div>`).join('');
  }else if(_siTab==='stack'){
    cont.innerHTML=SI_STACK.map(g=>`
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:14px 0 8px;">${dlEsc(g.gruppe)}</div>
      ${g.items.map(it=>siRow(it.name,it.zweck,siVerBadge(it.versionKey?siLibVersion(it.versionKey):''))).join('')}`).join('');
  }else if(_siTab==='regionen'){
    cont.innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:14px;">Alle Nutzdaten werden in der EU verarbeitet und gespeichert.</div>`
      +SI_REGIONEN.map(r=>siRow(r.dienst,r.ort,siVerBadge(r.region))).join('');
  }else if(_siTab==='apps'){
    cont.innerHTML=SI_APPS.map(a=>siRow(a.name,a.zweck,siVerBadge(_siAppVersions?.[a.file]||''))).join('')
      +`<div style="font-size:11px;color:var(--text3);margin-top:10px;">Versionen werden live aus den ausgelieferten Apps gelesen.</div>`;
  }else if(_siTab==='sicherheit'){
    cont.innerHTML=SI_SICHERHEIT.map(s=>siRow(s.label,s.note)).join('');
  }else if(_siTab==='dienste'){
    const all=SI_DIENSTE.flatMap(g=>g.items);
    const n=k=>all.filter(i=>i.status===k).length;
    const map={ok:['✓ unbedenklich','var(--green-light)','var(--green)'],achtung:['⚠ Bedingung beachten','var(--amber-light)','var(--amber)'],risiko:['⚠ vor Produktiv klären','var(--red-light)','var(--red)']};
    cont.innerHTML=`<div style="font-size:13px;color:var(--text2);margin-bottom:6px;">Überblick über alle extern genutzten Komponenten und Dienste — Lizenz, Kostenrahmen und rechtliche Einordnung für den kommerziellen/kommunalen Einsatz.</div>
      <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:var(--green-light);color:var(--green);">${n('ok')}× unbedenklich</span>
        <span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:var(--amber-light);color:var(--amber);">${n('achtung')}× Bedingung beachten</span>
        <span style="font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px;background:var(--red-light);color:var(--red);">${n('risiko')}× vor Produktiv klären</span>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:16px;">Hinweis: Diese Übersicht ist eine Hilfestellung, keine Rechtsberatung. Im Zweifel die jeweiligen Nutzungsbedingungen prüfen.</div>`
      +SI_DIENSTE.map(g=>`
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:16px 0 8px;">${dlEsc(g.gruppe)}</div>
        ${g.items.map(it=>{const m=map[it.status]||map.ok;return `<div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid ${m[2]};border-radius:var(--radius-sm);padding:11px 14px;margin-bottom:7px;">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;">${dlEsc(it.name)}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:1px;">${dlEsc(it.zweck)}</div></div>
            <span style="flex-shrink:0;font-size:11px;font-weight:700;padding:3px 9px;border-radius:99px;background:${m[1]};color:${m[2]};white-space:nowrap;">${m[0]}</span>
          </div>
          <div style="font-size:12px;color:var(--text2);margin-top:7px;line-height:1.55;">
            <div><b>Lizenz/Recht:</b> ${dlEsc(it.lizenz)}</div>
            <div><b>Kostenlos:</b> ${dlEsc(it.frei)}</div>
            <div style="margin-top:3px;color:${it.status==='ok'?'var(--text2)':m[2]};">${dlEsc(it.hinweis)}</div>
          </div>
        </div>`;}).join('')}`).join('');
  }
}

// ─── HANDBUCH (durchsuchbar; „Aktualisierungen" automatisch aus Git-Historie) ──
let _hbTab='handbuch', _hbChangelog=null;
const hbSearchDebounced=_debounce(()=>renderHandbuch(),140);
function setHbTab(t){ _hbTab=t; renderHandbuch(); }
function hbMark(s,q){
  const e=dlEsc(s);
  if(!q) return e;
  try{ return e.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark style="background:#fde68a;border-radius:3px;padding:0 1px;">$1</mark>'); }
  catch(_){ return e; }
}
function renderHandbuch(){
  const cont=document.getElementById('hb-content'); if(!cont) return;
  const q=(document.getElementById('hb-search')?.value||'').trim();
  // Tab-Optik
  const tb=document.getElementById('hb-tab-handbuch'), tu=document.getElementById('hb-tab-updates');
  if(tb&&tu){
    const apply=(el,on)=>{ el.style.background=on?'var(--surface)':'transparent'; el.style.color=on?'var(--text)':'var(--text3)'; el.style.boxShadow=on?'0 1px 2px rgba(0,0,0,.08)':'none'; };
    apply(tb,_hbTab==='handbuch'); apply(tu,_hbTab==='updates');
  }
  if(_hbTab==='updates'){ renderHbUpdates(q); return; }
  const ql=q.toLowerCase();
  const groups=HANDBUCH.map(g=>({
    g, secs:g.sections.filter(s=>!ql || (s.title+' '+s.text+' '+(s.keywords||[]).join(' ')).toLowerCase().includes(ql))
  })).filter(x=>x.secs.length);
  if(!groups.length){ cont.innerHTML=`<div style="text-align:center;padding:48px 0;color:var(--text3);font-size:13px;">Keine Treffer für „${dlEsc(q)}" — anderen Begriff probieren.</div>`; return; }
  cont.innerHTML=groups.map(({g,secs})=>`
    <div style="margin-bottom:22px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:8px;display:flex;align-items:center;gap:8px;">${g.icon} ${dlEsc(g.app)}
        <span style="font-size:11px;font-weight:600;color:var(--text3);">${secs.length} ${secs.length===1?'Thema':'Themen'}</span></div>
      ${secs.map(s=>`
        <details ${q?'open':''} style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;overflow:hidden;">
          <summary style="padding:10px 14px;font-size:13px;font-weight:600;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2.5" style="flex-shrink:0;transition:transform .15s;"><path d="M9 18l6-6-6-6"/></svg>
            ${hbMark(s.title,q)}</summary>
          <div style="padding:2px 14px 12px 34px;font-size:13px;line-height:1.65;color:var(--text2);">
            <div style="white-space:pre-line;">${hbMark(s.text,q)}</div>
            ${(s.imgs||[]).map(im=>`<figure style="margin:12px 0 4px;">
              <img src="${im.src}" loading="lazy" onclick="openHbImg('${im.src}','${dlEsc(im.cap||'')}')" alt="${dlEsc(im.cap||'')}" style="max-width:100%;max-height:420px;width:auto;border:1px solid var(--border);border-radius:8px;cursor:zoom-in;box-shadow:0 1px 4px rgba(0,0,0,.10);">
              <figcaption style="font-size:11px;color:var(--text3);margin-top:4px;">🔍 ${dlEsc(im.cap||'Zum Vergrößern klicken')}</figcaption>
            </figure>`).join('')}
          </div>
        </details>`).join('')}
    </div>`).join('');
  // Pfeil drehen bei offenen Abschnitten
  cont.querySelectorAll('details').forEach(d=>{
    const sync=()=>{ const sv=d.querySelector('summary svg'); if(sv) sv.style.transform=d.open?'rotate(90deg)':''; };
    d.addEventListener('toggle',sync); sync();
  });
}
// Großansicht für Handbuch-Bilder
function openHbImg(src,cap){
  let ov=document.getElementById('hb-img-overlay');
  if(!ov){ ov=document.createElement('div'); ov.id='hb-img-overlay'; document.body.appendChild(ov); }
  ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  ov.innerHTML=`<div style="max-width:94vw;max-height:92vh;display:flex;flex-direction:column;align-items:center;gap:10px;">
    <img src="${src}" style="max-width:94vw;max-height:84vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);">
    ${cap?`<div style="color:#fff;font-size:13px;">${dlEsc(cap)}</div>`:''}</div>
    <button style="position:absolute;top:18px;right:22px;background:rgba(255,255,255,.15);border:none;color:#fff;width:38px;height:38px;border-radius:50%;cursor:pointer;font-size:22px;">×</button>`;
  ov.onclick=()=>closeHbImg();
}
function closeHbImg(){ document.getElementById('hb-img-overlay')?.remove(); }
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeHbImg(); });

async function renderHbUpdates(q){
  const cont=document.getElementById('hb-content'); if(!cont) return;
  if(!_hbChangelog){
    cont.innerHTML='<div style="padding:24px 0;color:var(--text3);font-size:13px;text-align:center;">Lädt…</div>';
    try{ const r=await fetch('/changelog.json'); _hbChangelog=r.ok?await r.json():[]; }catch(_){ _hbChangelog=[]; }
    if(_hbTab!=='updates') return; // Nutzer hat inzwischen den Tab gewechselt
  }
  const ql=(q||'').toLowerCase();
  const list=_hbChangelog.filter(e=>!ql||e.t.toLowerCase().includes(ql));
  if(!list.length){ cont.innerHTML='<div style="text-align:center;padding:48px 0;color:var(--text3);font-size:13px;">Keine Einträge gefunden.</div>'; return; }
  // Nach Datum gruppieren
  const byDay={}; list.forEach(e=>{ (byDay[e.d]=byDay[e.d]||[]).push(e.t); });
  cont.innerHTML=`<div style="font-size:12px;color:var(--text3);margin-bottom:14px;">Automatisch erzeugte Liste aller Software-Änderungen (neueste zuerst). Wird mit jeder Veröffentlichung aktualisiert.</div>`+
    Object.entries(byDay).map(([d,items])=>`
    <div style="margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:var(--green);margin-bottom:6px;">${dlEsc(d)}</div>
      ${items.map(t=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:9px 14px;margin-bottom:5px;font-size:13px;line-height:1.5;color:var(--text2);">${hbMark(t,q)}</div>`).join('')}
    </div>`).join('');
}

Object.assign(window,{
  openKiPrompt,renderKi,setKiMode,renderKiConfig,
  renderHandbuch,setHbTab,hbSearchDebounced,openHbImg,closeHbImg,
  dispoSimulate,dispoLoadReal,dispoPlan,dispoOpenObjectDetail,dispoOpenSettings,dispoToggle,dispoAssign,dispoUnassign,dispoFocusBin,dispoFocusPoint,dispoResetDepot,dispoFocusVehicle,dispoToggleVehicle,dispoShowAllVehicles,
  dashSetPeriod,renderDashboard,refreshDashboard,dashFilterTours,
  saveInlineFields,filterDetailTable,filterBaeumeTable,switchBaeumeTab,buildArten,addArt,renameArt,mergeArt,deleteArt,
  renderFieldCatalogView,openFieldDetail,closeFieldDetail,addListVal,renameListVal,mergeListVal,deleteListVal,buildListFromObjects,addCustomField,renameCustomField,removeCustomField,
  rankAdd,rankRename,rankSetColor,rankMove,rankMerge,rankDelete,
  saveHistoryEdits,deleteHistoryEntry,refreshControlling,loadTourHistoryForControlling,loadErfasser,addErfasser,removeErfasser,addReason,deleteReason,saveDriverAssignment,setCtrlPeriod,renderControlling,exportCtrlCSV,initControlling,initVerwaltung,addDriver,removeDriver,addReasonMgmt,deleteReasonMgmt,seedDefaultReasons,resetObjFilter,loadTourHistory,showHistoryDetail,exportHistoryCSV,resetCtrlFilters,ctrlShowOnMap,
  importExcel,calculateAndSaveRoute,calculateAllRoutes,closeCtxMenu,ctxCalcActive,cancelAssign,setAssignTour,startAssignMode,rebuildAssignPills,lassoAction,clearLassoSelection,
  createProject,openProject,showProjectScreen,psSetOrgFilter,setSiTab,
  switchView,openDetail,closePanel,logWatering,applyClusterMode,
  openFoto,stepFoto,closeFoto,deleteFoto,
  docUploadStart,docUploadFiles,docAddLink,docDelete,switchModalTab,
  openAddTree,openEditTree,closeTreeModal,saveTree,deleteTree,
  archiveTree,reactivateTree,archiveTreeFromModal,reactivateTreeFromModal,deleteTreeFromModal,toggleShowInactive,showTreeOnMapFromModal,
  openTourModal,closeTourModal,saveTour,deleteTour,toggleTourUebersicht,toggleOverviewInGrid,filterTourenGrid,
  focusTour,focusTourAndSwitch,
  startPlacement,cancelMode,setDepotOnMap,
  startAssignMode,setAssignTour,cancelAssign,assignTreeToTour,
  openSettings,closeSettings,geocodeDepot,applySettings,confirmDeleteProject,openImport,openAllgemein,openProjekte,
  pickProjIcon,artSetIcon,
  renderMandanten,createOrgUi,moveProjectUi,
  addWmsLayer,deleteWmsLayer,editWmsLayer,cancelWmsEdit,renderWmsList,
  setFilter,pickColor,renderList,renderListDebounced,filterBaeumeTableDebounced,filterDetailTableDebounced,
  toggleLassoMode,switchDetailTab,toggleRoutePlanning,setLassoTour,toggleRouteLines,toggleMapFilter,toggleTourCounts,simulateActiveTour,fitToCity,setSimSpeed,toggleSimSkipBew,
  renderDriverLogins,addDriverLogin,saveDriverPin,toggleDriverLoginActive,dlEditPin,dlCancelPin,changeDriverRole,saveOrgCode,
  renderUserMgmt,addOrgUser,saveUserPass,toggleUserActive,urEditPass,urCancelPass,
  changeUserRole,deleteOrgUserUi,deleteDriverUi,
  renderRollenView,saveRole,addRole,deleteRole,toggleBenutzerRollen,toggleBenutzerTouren,changeBenutzerOrg,changeDtaProject,renderUsage,exportUsageCSV,
  startGpsPlacement,startMoveObject,saveMoveObject,cancelMoveObject,toggleFilterNoGps,updateBtnFilterNoGps,
  saveFieldLabels, migrateTourIds,
  doLogin, doLogout, toggleLoginMode,
});

// ─── AUTH-GATE ────────────────────────────────────────────────
function showLogin(msg){
  const ls=document.getElementById('login-screen'); if(ls) ls.style.display='flex';
  const ps=document.getElementById('project-screen'); if(ps) ps.style.display='none';
  const e=document.getElementById('login-error'); if(e) e.textContent=msg||'';
  const b=document.getElementById('login-btn'); if(b){ b.disabled=false; b.textContent='Anmelden'; }
  try{ const oc=localStorage.getItem('bwt_desktop_orgcode'); const e2=document.getElementById('login-orgcode'); if(oc&&e2&&!e2.value) e2.value=oc;
       const nm=localStorage.getItem('bwt_desktop_name'); const e3=document.getElementById('login-name'); if(nm&&e3&&!e3.value) e3.value=nm; }catch(_){}
}
function hideLogin(){ const ls=document.getElementById('login-screen'); if(ls) ls.style.display='none'; }
function updateUserChip(){
  const roleLbl=(rolesCache[currentRole]?.name)||currentRole||'';
  const base=(currentName||currentUser?.email||'').trim();
  const el=document.getElementById('user-chip-text'); if(el) el.textContent=base+(roleLbl?(' · '+roleLbl):'');
  const av=document.getElementById('user-avatar');
  if(av){ let ini='–';
    if(base){ if(/\s/.test(base)){ const p=base.split(/\s+/).filter(Boolean); ini=(p[0][0]+(p[1]?.[0]||'')).toUpperCase(); } else { ini=base.split('@')[0].slice(0,2).toUpperCase(); } }
    av.textContent=ini; }
  const nm=document.getElementById('user-menu-name'); if(nm) nm.textContent=(currentUser?.email||currentName||'–');
  const rl=document.getElementById('user-menu-role'); if(rl) rl.textContent=roleLbl||'–';
}
let loginMode='pin';
function toggleLoginMode(){
  loginMode = loginMode==='pin' ? 'email' : 'pin';
  const pm=document.getElementById('login-pin-mode'), em=document.getElementById('login-email-mode'), tg=document.getElementById('login-toggle');
  if(pm) pm.style.display=loginMode==='pin'?'':'none';
  if(em) em.style.display=loginMode==='email'?'':'none';
  if(tg) tg.textContent=loginMode==='pin'?'Admin-Anmeldung (E-Mail)':'Anmeldung mit Stadt-Code + PIN';
  const e=document.getElementById('login-error'); if(e) e.textContent='';
  const b=document.getElementById('login-btn'); if(b){ b.disabled=false; b.textContent='Anmelden'; }
}
async function doLogin(){
  const err=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  if(err) err.textContent='';
  if(loginMode==='email'){
    const email=(document.getElementById('login-email')?.value||'').trim();
    const pass=document.getElementById('login-pass')?.value||'';
    if(!email||!pass){ if(err) err.textContent='Bitte E-Mail und Passwort eingeben'; return; }
    if(btn){ btn.disabled=true; btn.textContent='Anmelden…'; }
    try{ await firebase.auth().signInWithEmailAndPassword(email,pass); }
    catch(e){ const c=e&&e.code||''; if(err) err.textContent=/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)?'E-Mail oder Passwort falsch':('Fehler: '+((e&&e.message)||c)); if(btn){ btn.disabled=false; btn.textContent='Anmelden'; } }
    return;
  }
  // PIN: Stadt-Code + Name + PIN
  const orgcode=(document.getElementById('login-orgcode')?.value||'').trim();
  const name=(document.getElementById('login-name')?.value||'').trim();
  const pin=(document.getElementById('login-pin')?.value||'').trim();
  if(!name||!pin){ if(err) err.textContent='Bitte Name und PIN ausfüllen'; return; }
  if(!/^\d{6}$/.test(pin)){ if(err) err.textContent='PIN muss 6-stellig sein'; return; }
  if(btn){ btn.disabled=true; btn.textContent='Anmelden…'; }
  try{
    const res=await firebase.app().functions('europe-west3').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(),name,pin});
    try{ localStorage.setItem('bwt_desktop_orgcode',orgcode.toUpperCase()); localStorage.setItem('bwt_desktop_name',name); }catch(_){}
    await firebase.auth().signInWithCustomToken(res.data.token);
  }catch(e){ const c=e&&e.code||'',m=e&&e.message||''; if(err) err.textContent=/permission-denied|not-found|unauthenticated|resource-exhausted/.test(c)?(m||'Name oder PIN falsch'):('Fehler: '+(m||c)); if(btn){ btn.disabled=false; btn.textContent='Anmelden'; } }
}
async function doLogout(){ try{ await flushUsage(); }catch(_){} try{ await firebase.auth().signOut(); }catch(e){} location.reload(); }

firebase.auth().onAuthStateChanged(async (user)=>{
  if(user){
    try{ const tok=await user.getIdTokenResult(); currentUser=user; currentRole=tok.claims.role||''; currentCap=tok.claims.cap||''; currentOrg=tok.claims.orgId||''; currentName=tok.claims.name||user.email||''; }
    catch(e){ currentRole=''; currentCap=''; currentOrg=''; }
    if(!currentRole){ showLogin('Dieses Konto hat keine Berechtigung. Bitte an den Administrator wenden.'); return; }
    await loadRoles();
    hideLogin(); updateUserChip(); applyModulePermissions(); initProjectScreen();
  } else {
    currentUser=null; currentRole=''; currentCap=''; currentOrg='';
    showLogin('');
  }
});

(()=>{ const el=document.getElementById('app-version'); if(el) el.textContent=`Version ${APP_VERSION}`; })();

applyKiNavVisibility(); // KI-Reiter je nach Einstellung ein-/ausblenden