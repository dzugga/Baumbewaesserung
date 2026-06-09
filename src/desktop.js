// App-Version – hier zentral pflegen (wird im Einstellungen-Panel angezeigt)
const APP_VERSION = '1.0';

function initializeApp(cfg){ return firebase.initializeApp(cfg); }
function getFirestore(app){ return firebase.firestore(app); }
function collection(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function doc(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function getDoc(ref){ return ref.get(); }
function getDocs(ref){ return ref.get(); }
// Hängt orgId automatisch an Dokumente innerhalb projects/{id}/<sub>/… (denormalisiert für Rules)
function _injectOrg(ref,data){
  if(!data || typeof data!=='object' || Array.isArray(data) || data.orgId!==undefined) return data;
  const path = ref && ref.path || '';
  if(/^projects\/[^/]+\/.+/.test(path) && currentProjectData && currentProjectData.orgId)
    return {...data, orgId: currentProjectData.orgId};
  return data;
}
function addDoc(ref,data){ return ref.add(_injectOrg(ref,data)); }
function setDoc(ref,data,opts){ data=_injectOrg(ref,data); return opts?ref.set(data,opts):ref.set(data); }
function updateDoc(ref,data){ return ref.update(data); }
function deleteDoc(ref){ return ref.delete(); }
function onSnapshot(ref,cb){ return ref.onSnapshot(cb); }
function serverTimestamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
function query(ref,...constraints){ constraints.forEach(c=>{ if(typeof c==='function') c(ref); }); return ref; }
function orderBy(field,dir='asc'){ return ref=>ref.orderBy(field,dir); }
function arrayUnion(...items){ return firebase.firestore.FieldValue.arrayUnion(...items); }

// ─── FIREBASE CONFIG ──────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBShCcASfAG26EDyax6er6SIiqeSBrFWek",
  authDomain: "baumbewaesserung.firebaseapp.com",
  projectId: "baumbewaesserung",
  storageBucket: "baumbewaesserung.firebasestorage.app",
  messagingSenderId: "1001991004222",
  appId: "1:1001991004222:web:1405d80d0788bd6548f16f"
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── CONSTANTS ────────────────────────────────────────────────
const TOUR_COLORS=[
  '#2d6a4f','#1e40af','#7c3aed','#be123c','#b45309','#0e7490','#064e3b','#b91c1c',
  '#c2410c','#4d7c0f','#15803d','#0f766e','#1d4ed8','#4338ca','#6d28d9','#a21caf',
  '#be185d','#9f1239','#1e3a8a','#166534','#92400e','#155e75','#5b21b6','#374151'
];

// ─── n:m TOUR-HILFSFUNKTIONEN ─────────────────────────────────
// Rückwärtskompatibel: liest tourIds[] oder fällt auf altes tourId zurück
function getTreeTourIds(tree){
  if(Array.isArray(tree.tourIds)) return tree.tourIds.filter(Boolean);
  if(tree.tourId) return [tree.tourId];
  return [];
}
function treeInTour(tree, tourId){
  return getTreeTourIds(tree).includes(tourId);
}
// Archiv: tree.aktiv===false → inaktiv (gefällt/abgegangen). Default = aktiv.
function isActive(tree){ return !tree || tree.aktiv!==false; }
function primaryTour(tree){
  const ids = getTreeTourIds(tree);
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
let currentRole = '';     // aus Custom Claims
let currentOrg  = '';     // aus Custom Claims
let _dataViewProject = null;      // Projekt, für das Controlling/Dashboard zuletzt aufgebaut wurde
let _dataViewSyncQueued = false;  // Debounce für Neuaufbau beim Projektwechsel
let _histListProject = null;      // Projekt, für das die untere Historie-Liste geladen wurde
let tours = [];   // live from Firestore
let trees = [];   // live from Firestore
let unsubTours = null;
let unsubTrees = null;

let currentView = 'karte';
let selectedTreeId = null;
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
function treeIsUnplanned(t){ return isActive(t) && getTreeTourIds(t).length===0; }
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
let routeCache = {};
let tourOrder = {};
let depotMarker = null;

// ─── MAP ──────────────────────────────────────────────────────
const L = window.L;
const map = L.map('map',{zoomControl:false,attributionControl:true}).setView([52.279,8.047],13);
map.attributionControl.setPosition('bottomleft').setPrefix(false);
// Basis-Ebenen: Karte (OSM) + Satellit (Esri World Imagery, kein API-Key)
const baseOSM = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  {maxZoom:19, attribution:'© OpenStreetMap'}).addTo(map);
const baseSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  {maxZoom:19, attribution:'© Esri, Maxar, Earthstar Geographics'});

// ── WMS-Kartenebenen (vom Nutzer verwaltbar, in localStorage) ──
const WMS_STORE_KEY='wms_layers_v1';
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
function getWmsLayers(){
  try{ const raw=localStorage.getItem(WMS_STORE_KEY); if(raw) return JSON.parse(raw); }catch(e){}
  saveWmsLayers(WMS_DEFAULTS); return WMS_DEFAULTS.map(x=>({...x}));
}
function saveWmsLayers(arr){ try{ localStorage.setItem(WMS_STORE_KEY, JSON.stringify(arr)); }catch(e){} }
function buildWmsLayer(cfg){
  return L.tileLayer.wms(cfg.url, {
    layers:cfg.layers, format:cfg.format||'image/png', version:cfg.version||'1.3.0',
    transparent:!!cfg.transparent, maxZoom:cfg.maxZoom||20, attribution:cfg.attribution||''});
}

let layerControl=null;
let wmsLayerInstances={}; // id -> aktuelle Leaflet-Ebene
function rebuildLayerControl(){
  // aktive Custom-Ebenen merken, dann alle entfernen
  const active=new Set();
  Object.entries(wmsLayerInstances).forEach(([id,lyr])=>{ if(map.hasLayer(lyr)) active.add(id); map.removeLayer(lyr); });
  wmsLayerInstances={};
  if(layerControl){ map.removeControl(layerControl); layerControl=null; }
  const bases={'Karte':baseOSM,'Satellit':baseSat};
  const overlays={};
  let customBaseActive=false;
  getWmsLayers().forEach(c=>{
    const lyr=buildWmsLayer(c); wmsLayerInstances[c.id]=lyr;
    if(c.type==='overlay'){ overlays[c.name]=lyr; if(active.has(c.id)) lyr.addTo(map); }
    else { bases[c.name]=lyr; if(active.has(c.id)){ lyr.addTo(map); customBaseActive=true; } }
  });
  if(customBaseActive){ map.removeLayer(baseOSM); map.removeLayer(baseSat); }
  else if(!map.hasLayer(baseOSM)&&!map.hasLayer(baseSat)){ baseOSM.addTo(map); } // Standard: Karte
  layerControl=L.control.layers(bases, overlays, {position:'topleft', collapsed:true}).addTo(map);
}
rebuildLayerControl();
L.control.zoom({position:'bottomleft'}).addTo(map);

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
  const dot=document.getElementById('app-sync')?.querySelector('.sync-dot');
  const txt=document.getElementById('app-sync-text');
  if(!dot)return;
  dot.className='sync-dot'+(state==='syncing'?' syncing':state==='error'?' error':'');
  if(txt)txt.textContent=text;
}

// ─── PROJECT SCREEN ───────────────────────────────────────────
let unsubProjects=null;
function initProjectScreen(){
  document.getElementById('project-screen').style.display='flex';
  if(unsubProjects)unsubProjects();
  // Superadmin sieht alle Mandanten; sonst nur die eigene Org
  const q = (currentRole==='superadmin')
    ? db.collection('projects').orderBy('createdAt')
    : db.collection('projects').where('orgId','==',currentOrg);
  unsubProjects=onSnapshot(q,snap=>{
    const psList=document.getElementById('ps-list');
    const sync=document.getElementById('ps-sync');
    sync.innerHTML='<div class="sync-dot"></div> Verbunden';
    if(snap.empty){
      psList.innerHTML='<div class="ps-empty">Noch keine Projekte. Erstelle dein erstes Projekt unten.</div>';
      return;
    }
    // bei nicht-Superadmin clientseitig nach createdAt sortieren (vermeidet Composite-Index)
    const docs=[...snap.docs];
    if(currentRole!=='superadmin') docs.sort((a,b)=>(a.data().createdAt?.seconds||0)-(b.data().createdAt?.seconds||0));
    // Use async IIFE to allow await inside onSnapshot callback
    (async()=>{
      const projectsWithCounts = await Promise.all(docs.map(async d=>{
        const data=d.data();
        const treesSnap=await getDocs(collection(db,'projects',d.id,'trees'));
        const toursSnap=await getDocs(collection(db,'projects',d.id,'tours'));
        return {id:d.id, data, treeCount:treesSnap.size, tourCount:toursSnap.size};
      }));
      psList.innerHTML=projectsWithCounts.map(({id,data,treeCount,tourCount})=>{
      return `<div class="ps-item" onclick="openProject('${id}')">
        <div class="ps-item-icon">🌳</div>
        <div class="ps-item-info">
          <div class="ps-item-name">${data.name}</div>
          <div class="ps-item-meta">${treeCount} Objekte · ${tourCount} Touren</div>
        </div>
        <svg class="ps-item-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
      </div>`;
    }).join('');
    })();
  },err=>{
    document.getElementById('ps-sync').innerHTML='<div class="sync-dot error"></div> Fehler';
    console.error(err);
  });
}

async function createProject(){
  const name=document.getElementById('ps-new-name').value.trim();
  if(!name)return;
  try{
    const ref=await addDoc(collection(db,'projects'),{
      name, treeCount:0, tourCount:0, depot:null, orsKey:'', depotMode:'round',
      createdAt:serverTimestamp(), orgId: currentOrg
    });
    document.getElementById('ps-new-name').value='';
    openProject(ref.id);
  }catch(e){ notify('Fehler: '+e.message); }
}

async function openProject(projectId){
  currentProjectId=projectId;
  window._tourHistoryCache=null;   // Historie des alten Projekts verwerfen
  _dataViewProject=null;           // Controlling/Dashboard für neues Projekt neu aufbauen
  const snap=await getDoc(doc(db,'projects',projectId));
  currentProjectData={id:projectId,...snap.data()};
  document.getElementById('active-project-name').textContent=currentProjectData.name;
  document.getElementById('project-screen').style.display='none';
  loadFieldLabels();
  // Subscribe to tours & trees
  subscribeToProject();
  // Gründe des neuen Projekts laden (verhindert projektübergreifendes Hängenbleiben)
  reasons=[]; loadReasons().then(()=>{ if(currentView==='verwaltung') renderReasonsMgmt(); });
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
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));mapMarkers={};
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}
  tours=[];trees=[];tourOrder={};activeTours.clear();showUnplanned=false;activeTourOnMap=null;filterTour='all';
  reasons=[]; // Gründe des Projekts verwerfen (kein projektübergreifendes Hängenbleiben)
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
    if(currentView==='verwaltung') renderDriverMgmt();
    syncDataViewToProject();
    setSyncState('ok','Synchronisiert');
  });

  const treesRef=collection(db,'projects',currentProjectId,'trees');
  unsubTrees=onSnapshot(treesRef,snap=>{
    trees=snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshMarkers();renderList();
    if(currentView==='baeume')renderBaeumeTable();
    syncDataViewToProject();
    setSyncState('ok','Synchronisiert');
    autoMigrateTourIds(); // tourId → tourIds[] still im Hintergrund
  });
}

// ─── PROJECT SETTINGS ─────────────────────────────────────────
function getDepot(){ return currentProjectData?.depot||null; }
function getOrsKey(){ return currentProjectData?.orsKey||localStorage.getItem('bwt_ors_key')||''; }
function getBewDuration(){
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
function getRouteOptMode(){ return localStorage.getItem('bwt_route_opt')||'nn'; }
// KI-Analyse-Modus: 'off' | 'manual' (Prompts kopieren) | 'auto' (Gemini) | 'both'
function getKiMode(){ return localStorage.getItem('bwt_ki_mode')||'manual'; }
function setKiMode(m){ localStorage.setItem('bwt_ki_mode', m); applyKiNavVisibility(); renderKiConfig(); }
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
async function loadSavedRoutes(){
  if(!getRoutePlanningEnabled()) return;
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
  for(const tour of tours){
    const routeSnap=await getDoc(doc(db,'projects',currentProjectId,'routes',tour.id));
    if(routeSnap.exists){
      drawSavedRoute(tour.id, routeSnap.data());
    } else {
      // No saved route yet — just compute order for numbering, no line drawn
      const trs=trees.filter(t=>treeInTour(t,tour.id)&&t.lat&&t.lng&&t.aktiv!==false);
      if(trs.length>0){
        const depot=getDepot();
        const ordered=nearestNeighborTSP(trs,depot?.lat,depot?.lng);
        tourOrder[tour.id]=ordered.map(t=>t.id);
      }
    }
  }
  rebuildMarkersWithNumbers();renderList();renderLegend();
  document.getElementById('route-info-bar').classList.remove('visible');
}

// Manually triggered: recalculate + save route for one tour via ORS
async function calculateAndSaveRoute(tourId){
  if(!getRoutePlanningEnabled()){ notify('Reihenfolgeplanung ist deaktiviert'); return; }
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

  // Draw on map
  drawSavedRoute(tourId, routeData);
  rebuildMarkersWithNumbers();renderList();renderLegend();
  updateRouteInfoBar();
  setSyncState('ok','Route gespeichert');
  notify(`✓ Route gespeichert — ${km.toFixed(1)} km`);
}

// Calculate all tours at once
async function calculateAllRoutes(){
  if(!getRoutePlanningEnabled()){ notify('Reihenfolgeplanung ist deaktiviert'); return; }
  for(const tour of tours){
    await calculateAndSaveRoute(tour.id);
  }
}

async function rebuildActiveRoute(){
  if(!getRoutePlanningEnabled()) return;
  // Just reload saved routes — no auto-recalculation
  await loadSavedRoutes();
  if(activeTourOnMap){
    const routeSnap=await getDoc(doc(db,'projects',currentProjectId,'routes',activeTourOnMap));
    if(routeSnap.exists) drawSavedRoute(activeTourOnMap,routeSnap.data());
    updateRouteInfoBar();
  }
}

async function refreshAllRoutes(){
  await loadSavedRoutes();
  document.getElementById('route-info-bar').classList.remove('visible');
}

function updateRouteInfoBar(){
  const bar=document.getElementById('route-info-bar');
  const txt=document.getElementById('route-info-text');
  const sidePanel=document.getElementById('sidebar-route-info');
  if(bar) bar.classList.remove('visible'); // schwebende Routen-Info-Leiste entfernt — Infos im Seitenpanel
  // Mehrere Touren ausgewählt → kompakte Summe
  if(activeTours.size>1){
    let km=0,dur=0; activeTours.forEach(tid=>{ if(tourRoutes[tid]){ km+=tourRoutes[tid].km; dur+=tourRoutes[tid].durationSec||0; } });
    const cnt=trees.filter(t=>treeInAnyActiveTour(t)&&t.lat&&t.lng).length;
    txt.textContent=`${activeTours.size} Touren · ${cnt} Objekte${km?` · Σ ${km.toFixed(1)} km${dur?' · '+fmtDuration(dur)+' Fahrt':''}`:''}`;
    if(sidePanel){
      document.getElementById('sidebar-route-tour-name').textContent=`${activeTours.size} Touren`;
      document.getElementById('sidebar-route-km').textContent=km?km.toFixed(1)+' km':'–';
      document.getElementById('sidebar-route-drive').textContent=dur?fmtDuration(dur):'–';
      document.getElementById('sidebar-route-total').textContent=km?fmtTotalTime(dur,cnt):'–';
      document.getElementById('sidebar-route-cnt').textContent=cnt+' Objekte';
      sidePanel.style.display='block';
    }
    return;
  }
  if(activeTourOnMap&&tourRoutes[activeTourOnMap]){
    const {km,durationSec}=tourRoutes[activeTourOnMap];
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
    document.getElementById('sidebar-route-total').textContent=totalTime;
    document.getElementById('sidebar-route-cnt').textContent=cnt+' Objekte';
    sidePanel.style.display='block';
  } else {
    bar.classList.remove('visible');
    if(sidePanel) sidePanel.style.display='none';
  }
}

// ─── MARKERS ──────────────────────────────────────────────────
function getRouteNum(treeId){
  if(activeTours.size>1) return null;   // bei Mehrfachauswahl keine (kollidierenden) Nummern
  // Bei angezeigter Tour deren Reihenfolge bevorzugen (Objekt kann mehreren Touren angehören)
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
  // Bei angezeigter Tour deren Farbe verwenden, wenn das Objekt zu ihr gehört
  const tour=(activeTourOnMap && treeTourIds.includes(activeTourOnMap))
    ? tours.find(t=>t.id===activeTourOnMap)
    : primaryTour(tree);
  const color=tour?tour.color:'#6b6760';
  const num=getRouteNum(tree.id);
  const isHighlighted=selectedTreeId===tree.id;
  const isMultiTour=treeTourIds.length>1;

  const badge=num!=null
    ?`<div style="position:absolute;bottom:-5px;right:-5px;min-width:16px;height:16px;border-radius:8px;background:#fff;border:1.5px solid ${color};color:${color};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center;font-family:monospace;padding:0 2px;">${num}</div>`:'';

  // Multi-Tour-Badge: Anzahl der Touren oben rechts
  const multiBadge=isMultiTour
    ?`<div style="position:absolute;top:-6px;right:-6px;min-width:16px;height:16px;border-radius:8px;background:#f59e0b;border:2px solid #fff;color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 2px;z-index:10;">${treeTourIds.length}</div>`:'';

  // Doppelring für Multi-Tour-Marker
  const multiRing=isMultiTour&&!isHighlighted
    ?`<div style="position:absolute;inset:-4px;border-radius:50%;border:2px dashed ${color};opacity:.6;"></div>`:'';

  const ring=isHighlighted
    ?`<div style="position:absolute;inset:-5px;border-radius:50%;border:3px solid ${color};animation:pulse-ring .8s ease-in-out infinite;opacity:.7;"></div>`
    :'';

  const sz=isHighlighted?36:28;
  const icon=L.divIcon({
    className:'',
    html:`<div style="position:relative;width:${sz}px;height:${sz}px;transition:all .2s;">
      ${ring}${multiRing}
      <div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:${isHighlighted?4:3}px solid white;box-shadow:${isHighlighted?'0 0 0 3px '+color+', 0 4px 12px rgba(0,0,0,.4)':'0 2px 6px rgba(0,0,0,.3)'};display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:${isHighlighted?16:13}px;transform:${isHighlighted?'scale(1.15)':'scale(1)'};transition:all .2s;">🌳</div>
      ${badge}${multiBadge}</div>`,
    iconSize:[sz,sz], iconAnchor:[sz/2,sz/2]
  });
  return L.marker([tree.lat,tree.lng],{icon,zIndexOffset:isHighlighted?500:0}).addTo(map)
    .on('click',()=>{ if(assignMode&&!lassoDrawing) assignTreeToTour(tree.id,assignTourId); else if(!assignMode) selectTree(tree.id,false); })
    .on('contextmenu', e=>showTreeTourContextMenu(tree, e));
}

function setMarkerVisibility(){
  trees.forEach(tree=>{
    const m=mapMarkers[tree.id];if(!m)return;
    let show=treeVisibleSel(tree);
    // Optional: Eigenschaften-Filter auch auf der Karte anwenden
    if(show && objFilterOnMap && !objMatchesPropFilter(tree)) show=false;
    if(show) map.addLayer(m); else map.removeLayer(m);
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
  if(f.status==='offen' && t.lastStatus) return false;
  if(f.status==='bewaessert' && t.lastStatus!=='bewaessert') return false;
  if(f.status==='nicht' && t.lastStatus!=='nicht') return false;
  return true;
}
function objFilterActive(){ return Object.values(objFilter).some(Boolean); }
function applyObjFilter(){ renderList(); setMarkerVisibility(); updateObjFilterCount(); }
function resetObjFilter(){ objFilter={stadtteil:'',art:'',pflanzjahr:'',zustand:'',wasser:'',status:''}; renderObjFilterUI(); applyObjFilter(); }
function updateObjFilterCount(){
  const el=document.getElementById('obj-filter-count'); if(!el)return;
  const act=trees.filter(isActive);
  el.textContent = objFilterActive()? `${act.filter(objMatchesPropFilter).length}/${act.length}` : '';
}
function renderObjFilterUI(){
  const el=document.getElementById('obj-filter'); if(!el)return;
  const act=trees.filter(isActive);
  const distinct=k=>[...new Set(act.map(t=>(t[k]??'').toString()).filter(Boolean))].sort();
  const esc=s=>String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const opt=(vals,sel,all)=>`<option value="">${all}</option>`+vals.map(v=>`<option value="${esc(v)}"${v===sel?' selected':''}>${esc(v)}</option>`).join('');
  const ss='padding:4px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);min-width:0;width:100%;font-family:inherit;';
  const isOpen=el.dataset.open==='true';   // standardmäßig zugeklappt
  const active=objFilterActive();
  el.innerHTML=`<div style="padding:8px 16px;border-bottom:1px solid var(--border);">
    <div data-action="toggle-objfilter" style="display:flex;align-items:center;gap:6px;cursor:pointer;${isOpen?'margin-bottom:6px;':''}">
      <span style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);">Filter</span>
      ${active?`<button data-action="reset-objfilter" style="border:none;background:none;color:#1d4ed8;font-size:11px;cursor:pointer;padding:0;">zurücksetzen</button>`:''}
      <span id="obj-filter-count" style="margin-left:auto;font-size:11px;color:${active?'var(--green)':'var(--text3)'};font-weight:${active?'600':'400'};"></span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3);transition:transform .2s;transform:rotate(${isOpen?180:0}deg);flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
    </div>
    <div id="objfilter-body" style="display:${isOpen?'block':'none'};">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
        <select id="of-stadtteil" style="${ss}">${opt(distinct('stadtteil'),objFilter.stadtteil,'Alle Stadtteile')}</select>
        <select id="of-art" style="${ss}">${opt(distinct('art'),objFilter.art,'Alle Typen')}</select>
        <select id="of-pflanzjahr" style="${ss}">${opt(distinct('pflanzjahr'),objFilter.pflanzjahr,'Alle Jahre')}</select>
        <select id="of-zustand" style="${ss}">${opt(['gut','mittel','schlecht'],objFilter.zustand,'Alle Zustände')}</select>
        <select id="of-wasser" style="${ss}">${opt(['gering','mittel','hoch'],objFilter.wasser,'Alle Prioritäten')}</select>
        <select id="of-status" style="${ss}"><option value="">Alle Status</option><option value="bewaessert"${objFilter.status==='bewaessert'?' selected':''}>✓ Erledigt</option><option value="nicht"${objFilter.status==='nicht'?' selected':''}>✕ Nicht erledigt</option><option value="offen"${objFilter.status==='offen'?' selected':''}>○ Offen</option></select>
      </div>
      <label style="display:flex;align-items:center;gap:6px;margin-top:7px;font-size:11px;cursor:pointer;color:var(--text2);">
        <input type="checkbox" id="of-map"${objFilterOnMap?' checked':''}> Nur gefilterte auf der Karte zeigen
      </label>
    </div>
  </div>`;
  const wire={stadtteil:'of-stadtteil',art:'of-art',pflanzjahr:'of-pflanzjahr',zustand:'of-zustand',wasser:'of-wasser',status:'of-status'};
  Object.entries(wire).forEach(([k,id])=>{ const s=document.getElementById(id); if(s) s.onchange=()=>{ objFilter[k]=s.value; applyObjFilter(); }; });
  const mp=document.getElementById('of-map'); if(mp) mp.onchange=()=>{ objFilterOnMap=mp.checked; setMarkerVisibility(); };
  const hdr=el.querySelector('[data-action="toggle-objfilter"]');
  if(hdr) hdr.onclick=e=>{
    if(e.target.closest('[data-action="reset-objfilter"]')){ resetObjFilter(); return; }
    el.dataset.open=isOpen?'false':'true';
    renderObjFilterUI();
  };
  updateObjFilterCount();
}

function refreshMarkers(){
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));mapMarkers={};
  trees.forEach(tree=>{ if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[tree.id]=makeMarker(tree); });
  setMarkerVisibility();
  renderObjFilterUI();
  loadSavedRoutes();  // load from Firestore, never auto-recalculate
  renderDepotMarker();
  renderLegend();
}

function rebuildMarkersWithNumbers(){
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));mapMarkers={};
  // makeMarker uses selectedTreeId for highlight — always passes current state
  trees.forEach(tree=>{ if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[tree.id]=makeMarker(tree); });
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
    .bindTooltip(`<b>Betriebshof</b><br>${depot.address||''}`,{direction:'top',offset:[0,-20]});
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
  if(tours.length<8) tourLegendQuery='';

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
      ${tourRoutes[activeTour.id]?'· '+tourRoutes[activeTour.id].km.toFixed(1)+' km':''}
    </span>${unpTag}`;
  } else if(selCount>1){
    html+=`<span style="font-size:11px;font-weight:600;color:var(--green);">${selCount} ausgewählt</span>${unpTag}`;
  } else if(showUnplanned){
    html+=`<span style="font-size:11px;font-weight:600;color:var(--green);">Nicht verplant</span>`;
  } else {
    html+=`<span style="font-size:11px;color:var(--text3);">${tours.length} Touren</span>`;
  }
  const isOpen=el.dataset.open!=='false';
  html+=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3);transition:transform .2s;transform:rotate(${isOpen?'180':'0'}deg);flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
  </div>`;

  // ── Collapsible body ─────────────────────────────────────────
  html+=`<div id="legend-body" style="display:${isOpen?'block':'none'};">`;

  // Tour-Suchfeld — erst ab vielen Touren
  if(tours.length>=8){
    html+=`<div style="padding:2px 8px 6px;"><input id="tour-legend-search" type="text" placeholder="Tour suchen…" style="width:100%;padding:4px 8px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;box-sizing:border-box;"></div>`;
  }

  // Tour rows — compact
  html+=`<div style="padding:0 8px 4px;">`;
  tours.forEach(t=>{
    const km=tourRoutes[t.id]?tourRoutes[t.id].km.toFixed(1):'–';
    const isSel=activeTours.has(t.id);
    html+=`<div class="legend-item${isSel?' active-tour':''}" data-tourid="${t.id}" data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="padding:3px 6px;margin-bottom:1px;">
      <input type="checkbox" class="tour-check"${isSel?' checked':''} style="margin:0 4px 0 0;cursor:pointer;flex-shrink:0;accent-color:${t.color};">
      <div class="legend-line" style="background:${t.color};width:16px;height:3px;"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${t.name}</span>
      <span class="legend-km" style="font-size:10px;">${km} km</span>
    </div>`;
  });
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

  // Route berechnen button — compact
  if(activeTours.size===1){
    const onlyTid=[...activeTours][0];
    html+=`<div style="padding:4px 8px 8px;display:flex;flex-direction:column;gap:6px;">
      <button data-action="calc-active"${rpDisAttr()} style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;${rpDisStyle()}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
        Route berechnen
      </button>
      ${tourRoutes[onlyTid]?`<button data-action="simulate" style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--surface2);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
        Abfahrt simulieren
      </button>`:''}
    </div>`;
  } else if(activeTours.size>1){
    html+=`<div style="padding:4px 8px 8px;">
      <button data-action="calc-selected"${rpDisAttr()} style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;${rpDisStyle()}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
        Routen berechnen (${activeTours.size})
      </button>
    </div>`;
  } else {
    html+=`<div style="padding:4px 8px 8px;">
      <button data-action="calc-all"${rpDisAttr()} style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:6px;cursor:pointer;${rpDisStyle()}">
        Alle Routen berechnen
      </button>
    </div>`;
  }
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
    const item=e.target.closest('[data-tourid]');
    if(item){const tid=item.dataset.tourid;
      if(tid==='__all__')focusTour(null);
      else if(tid==='__none__')toggleUnplanned();
      else toggleTourSelection(tid);
      return;}
    const btn=e.target.closest('[data-action]');
    if(btn){
      if(btn.dataset.action==='calc-active'&&activeTourOnMap)calculateAndSaveRoute(activeTourOnMap);
      else if(btn.dataset.action==='calc-selected'){ (async()=>{ for(const tid of [...activeTours]) await calculateAndSaveRoute(tid); })(); }
      else if(btn.dataset.action==='calc-all')calculateAllRoutes();
      else if(btn.dataset.action==='simulate'){ const tid=[...activeTours][0]; if(tid) startSimulation(tid); }
    }
  };
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
      return {pt:simState.pts[seg.idx],k:seg.idx,phase:'Bewässerung'+(seg.tree?.name?' — '+seg.tree.name:''),type:'water'};
    }
    acc+=seg.dur;
  }
  const last=simState.pts.length-1;
  return {pt:simState.pts[last],k:last,phase:'Ziel erreicht',type:'end'};
}
function buildSimModel(route){
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
  const waterSec=getBewDuration()*60;
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
  const model=buildSimModel(route);
  if(!model){ notify('Keine ausreichenden Routendaten für die Simulation'); return; }
  simState={ active:true, tourId, tour, playing:true, speed:1, elapsed:0, lastTs:0, seeking:false, ...model };
  simState.marker=L.marker(model.pts[0],{icon:simIcon(tour.color),zIndexOffset:2000}).addTo(map);
  simState.trail=L.polyline([model.pts[0]],{color:tour.color,weight:6,opacity:.95}).addTo(map);
  document.getElementById('sim-bar').style.display='flex';
  renderSimBar();
  simState.raf=requestAnimationFrame(simTick);
}
function stopSimulation(){
  if(simState.raf) cancelAnimationFrame(simState.raf);
  if(simState.marker) map.removeLayer(simState.marker);
  if(simState.trail) map.removeLayer(simState.trail);
  const bar=document.getElementById('sim-bar'); if(bar){ bar.style.display='none'; bar.innerHTML=''; }
  simState={active:false};
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
  const speeds=[0.5,1,2,4,8];
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
    <div style="display:flex;gap:3px;flex-shrink:0;">${speeds.map(s=>`<button data-sim="speed" data-speed="${s}" style="padding:3px 7px;font-size:11px;border-radius:6px;border:1px solid var(--border);background:${simState.speed===s?'var(--green)':'var(--surface)'};color:${simState.speed===s?'#fff':'var(--text2)'};cursor:pointer;font-weight:600;">${s}×</button>`).join('')}</div>
    <div style="display:flex;gap:9px;font-size:10px;color:var(--text3);flex-shrink:0;">
      <span style="display:flex;align-items:center;gap:3px;"><i style="width:9px;height:9px;border-radius:2px;background:#16a34a;display:inline-block;"></i>Bewässerung</span>
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
    } else if(a==='speed'){ simState.speed=parseFloat(b.dataset.speed); simState.lastTs=0; renderSimBar(); }
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
    list.innerHTML=filtered.map(tree=>{
      const treeTours=getTreeTourIds(tree).map(id=>tours.find(t=>t.id===id)).filter(Boolean);
      // Bei angezeigter Tour deren Farbe bevorzugen
      const primaryT=(activeTourOnMap&&treeTours.find(t=>t.id===activeTourOnMap))||treeTours[0]||null;
      const color=primaryT?.color||null;
      const zBadge={gut:'badge-ok',mittel:'badge-warn',schlecht:'badge-crit'}[tree.zustand]||'badge-gray';
      const bg=color?color+'22':'#f0ede6';
      const rNum=getRouteNum(tree.id);
      const numBadge=rNum!=null?`<span class="badge" style="background:${color||'#6b6760'}22;color:${color||'#6b6760'};font-family:monospace;">#${rNum}</span>`:'';
      const sel=selectedTreeId===tree.id?' selected':'';
      const tourBadges=treeTours.map(t=>`<span class="badge" style="background:${t.color}22;color:${t.color};">${t.name}</span>`).join('');
      return `<div class="tree-item${sel}" data-treeid="${tree.id}">
        <div class="tree-icon" style="background:${bg};">🌳</div>
        <div class="tree-info">
          <div class="tree-name">${tree.name||'–'}</div>
          <div class="tree-meta">${tree.art||'Unbekannt'} · ${tree.stadtteil||''}</div>
          <div class="tree-badges">
            ${numBadge}
            ${tourBadges}
            <span class="badge ${zBadge}">${{gut:'Gut',mittel:'Mittel',schlecht:'Schlecht'}[tree.zustand]||''}</span>
          </div>
        </div>
      </div>`;
    }).join('');
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
    map.removeLayer(mapMarkers[prev]);
    const pt=trees.find(t=>t.id===prev);
    if(pt&&pt.lat&&pt.lng) mapMarkers[prev]=makeMarker(pt);
  }
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  if(mapMarkers[id]) map.removeLayer(mapMarkers[id]);
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
function openDetail(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  selectedTreeId=id;renderList();
  const tour=primaryTour(tree);
  const statusBg={gut:'var(--green-light)',mittel:'var(--amber-light)',schlecht:'var(--red-light)'}[tree.zustand];
  const statusColor={gut:'var(--green)',mittel:'var(--amber)',schlecht:'var(--red)'}[tree.zustand];
  const zLabel={gut:'Gut ✓',mittel:'Mittel ⚠',schlecht:'Schlecht ✕'}[tree.zustand]||'';
  const rNum=getRouteNum(tree.id);
  document.getElementById('panel-title').textContent=tree.name;
  const _meta=document.getElementById('panel-meta');
  if(_meta) _meta.textContent=`${tree.baumnr?'Nr. '+tree.baumnr+' · ':''}${tree.art||''}${tree.stadtteil?' · '+tree.stadtteil:''}`;
  // Build tour options for inline select
  const currentTourIds=getTreeTourIds(tree);
  const tourOptions=tours.map(t=>`<option value="${t.id}"${currentTourIds.includes(t.id)?' selected':''}>${t.name}</option>`).join('');

  let body=`
    <div class="status-bar" style="background:${statusBg};color:${statusColor};">${zLabel} — Zustand</div>

    <div class="form-section">Identifikation</div>
    <div class="detail-field"><span class="detail-key">Objekt-ID</span><span class="detail-val" style="font-family:monospace;font-weight:700;color:var(--green);">${tree.baumId||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">Baumnummer</span><span class="detail-val">${tree.baumnr||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">${FL.stadtteil}</span><span class="detail-val">${tree.stadtteil||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">${FL.art}</span><span class="detail-val" style="font-style:italic;">${tree.art||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">${FL.pflanzjahr}</span><span class="detail-val">${tree.pflanzjahr||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">Pflanzzeitpunkt</span><span class="detail-val">${tree.pflanzzeitpunkt||'–'}</span></div>
    <div class="detail-field"><span class="detail-key">Koordinaten</span><span class="detail-val" style="font-size:11px;font-family:monospace;">${tree.lat?`${tree.lat.toFixed(5)}, ${tree.lng.toFixed(5)}`:'–'}</span></div>

    <div class="form-section">Pflege</div>
    <div class="detail-field">
      <span class="detail-key">${FL.wasser}</span>
      <select class="form-control" id="inline-wasser" style="width:auto;padding:3px 8px;font-size:12px;">
        <option value="gering"${tree.wasser==='gering'?' selected':''}>Gering</option>
        <option value="mittel"${tree.wasser==='mittel'?' selected':''}>Mittel</option>
        <option value="hoch"${tree.wasser==='hoch'?' selected':''}>Hoch</option>
      </select>
    </div>
    <div class="detail-field">
      <span class="detail-key">Zustand</span>
      <select class="form-control" id="inline-zustand" style="width:auto;padding:3px 8px;font-size:12px;">
        <option value="gut"${tree.zustand==='gut'?' selected':''}>Gut</option>
        <option value="mittel"${tree.zustand==='mittel'?' selected':''}>Mittel</option>
        <option value="schlecht"${tree.zustand==='schlecht'?' selected':''}>Schlecht</option>
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
      <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;width:100%;" onclick="saveInlineFields('${id}')">Touren speichern</button>
    </div>

    ${tree.notiz?`<div style="margin:8px 0;padding:10px;background:var(--surface2);border-radius:var(--radius-sm);font-size:12px;color:var(--text2);">${tree.notiz}</div>`:''}

`;
  document.getElementById('panel-body').innerHTML=body;
  const noCoords = !tree.lat || !tree.lng;
  document.getElementById('panel-actions').innerHTML=`
    ${noCoords ? `<button class="btn btn-secondary" style="flex:1;border-color:var(--amber);color:var(--amber);" onclick="startGpsPlacement('${id}')">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="10" r="3"/><path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z"/></svg>
      Position setzen
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

function renderVerlaufDesktop(id) {
  const tree = trees.find(t => t.id === id);
  const body = document.getElementById('panel-body-verlauf');
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
    map.removeLayer(mapMarkers[prev]);
    const pt=trees.find(t=>t.id===prev);
    if(pt&&pt.lat&&pt.lng) mapMarkers[prev]=makeMarker(pt);
  }
}

async function saveInlineFields(id){
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
  document.getElementById('modal-tree-title').textContent='Baum hinzufügen';
  ['f-name','f-stadtteil','f-baumnr','f-art','f-pflanzjahr','f-pflanzzeitpunkt','f-notiz'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('f-wasser').value='mittel';
  document.getElementById('f-zustand').value='mittel';
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

function openEditTree(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  editingTreeId=id;
  document.getElementById('modal-tree-title').textContent='Baum bearbeiten';
  document.getElementById('f-name').value=tree.name||'';
  document.getElementById('f-stadtteil').value=tree.stadtteil||'';
  document.getElementById('f-baumnr').value=tree.baumnr||'';
  document.getElementById('f-art').value=tree.art||'';
  document.getElementById('f-pflanzjahr').value=tree.pflanzjahr||'';
  document.getElementById('f-pflanzzeitpunkt').value=tree.pflanzzeitpunkt||'';
  document.getElementById('f-lat').value=tree.lat||'';
  document.getElementById('f-lng').value=tree.lng||'';
  document.getElementById('f-wasser').value=tree.wasser||'mittel';
  document.getElementById('f-zustand').value=tree.zustand||'mittel';
  document.getElementById('f-datum').value=tree.datum||'';
  document.getElementById('f-notiz').value=tree.notiz||'';
  document.getElementById('modal-coord-info').style.display='none';
  fillTourSelect(tree.tourId||'');
  // Gefahrenzone (Archiv/Löschen) einblenden
  const danger=document.getElementById('tree-danger');
  const archBtn=document.getElementById('btn-tree-archive');
  if(danger) danger.style.display='flex';
  if(!isActive(tree)){
    document.getElementById('modal-tree-title').textContent='Baum bearbeiten (inaktiv)';
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
  const data={
    name,
    stadtteil:document.getElementById('f-stadtteil').value,
    baumnr:document.getElementById('f-baumnr').value,
    art:document.getElementById('f-art').value,
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


let _lassoActive = false;
function toggleLassoMode() {
  _lassoActive = !_lassoActive;
  const btn = document.getElementById('lasso-toggle-btn');
  const canvas = document.getElementById('lasso-canvas');
  if(_lassoActive) {
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
  assignMode=true;lassoMode=false;assignTourId=tours[0].id;lassoTourId=tours[0].id;
  lassoPoints=[];lassoDrawing=false;
  _lassoActive=false;

  // Setup lasso canvas (hidden until user activates)
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
      // Single click: find nearest marker
      const r=canvas.getBoundingClientRect();
      const clickPt=map.containerPointToLatLng(L.point(e.clientX-r.left,e.clientY-r.top));
      let nearestTree=null,nearestDist=Infinity;
      trees.forEach(tree=>{
        if(!tree.lat||!tree.lng)return;
        const d=map.distance(clickPt,[tree.lat,tree.lng]);
        if(d<nearestDist&&d<80){nearestDist=d;nearestTree=tree;}
      });
      lassoCtx.clearRect(0,0,canvas.width,canvas.height);
      lassoPoints=[];
      if(nearestTree) assignTreeToTour(nearestTree.id,assignTourId);
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
  sel.innerHTML = tours.map(t =>
    `<option value="${t.id}" style="color:#111;background:#fff;">${t.name}</option>`
  ).join('');
  // Set initial value
  if(assignTourId) sel.value = assignTourId;
  else if(tours.length) { sel.value = tours[0].id; assignTourId = tours[0].id; }
  updateAssignSwatch();
}

function setAssignTour(id){
  assignTourId=id;lassoTourId=id;
  const sel=document.getElementById('assign-tour-select');
  if(sel) sel.value=id;
  updateAssignSwatch();
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
  const v = localStorage.getItem('bwt_route_planning');
  return v === null ? true : v === 'true';
}
// Routen-Berechnen-Buttons deaktivieren, wenn Reihenfolgeplanung aus ist
function rpDisAttr(){ return getRoutePlanningEnabled() ? '' : ' disabled title="Reihenfolgeplanung ist deaktiviert"'; }
function rpDisStyle(){ return getRoutePlanningEnabled() ? '' : 'opacity:.45;cursor:not-allowed;'; }

function toggleRoutePlanning(){
  const newVal = !getRoutePlanningEnabled();
  localStorage.setItem('bwt_route_planning', newVal);
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

function openSettings(){
  // Hide bottom route bar to avoid overlap
  document.getElementById('route-info-bar')?.classList.remove('visible');
  const depot=getDepot();
  document.getElementById('s-depot-addr').value=depot?.address||'';
  document.getElementById('s-depot-lat').value=depot?.lat||'';
  document.getElementById('s-depot-lng').value=depot?.lng||'';
  document.getElementById('s-depot-mode').value=getDepotMode();
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
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;">Import<button id="imp-x" style="border:none;background:none;cursor:pointer;font-size:20px;line-height:1;color:var(--text3);">×</button></div>
    <div style="padding:18px 20px;">
      <button class="btn btn-secondary" id="imp-btn" style="width:100%;margin-bottom:8px;">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Import (Excel)
      </button>
      <div style="font-size:11px;color:var(--text3);line-height:1.6;">A=Anlage/Str. · B=Stadtteil · C=Baumart · D=Baumnr. · E=Pflanzjahr · F=Pflanzzeitpunkt · G=Bemerkung · H=Lat · I=Lng</div>
    </div></div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#imp-x').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#imp-btn').onclick=()=>{ close(); document.getElementById('excel-import-input').click(); };
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
        <label class="form-label">API-Key</label>
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
    localStorage.setItem('bwt_ors_key', key);
    if(currentProjectId){ try{ await saveProjectSettings({orsKey:key}); }catch(e){} }
    close(); notify('API-Key gespeichert');
  };
}

// ── WMS-Verwaltung (Einstellungen) ──
function renderWmsList(){
  const el=document.getElementById('wms-list'); if(!el) return;
  const list=getWmsLayers();
  if(!list.length){ el.innerHTML='<div style="font-size:12px;color:var(--text3);">Noch keine WMS-Ebenen.</div>'; return; }
  el.innerHTML=list.map(l=>`<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;background:var(--surface);">
    <span style="flex:1;min-width:0;font-size:12px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.name}</span>
    <span style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;flex-shrink:0;">${l.type==='overlay'?'Overlay':'Basis'}</span>
    <button onclick="deleteWmsLayer('${l.id}')" title="Löschen" style="border:none;background:none;cursor:pointer;color:var(--red);padding:2px 4px;flex-shrink:0;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>
    </button>
  </div>`).join('');
}
function addWmsLayer(){
  const v=id=>document.getElementById(id)?.value.trim()||'';
  const name=v('wms-add-name'), url=v('wms-add-url'), layers=v('wms-add-layers'),
        type=v('wms-add-type')||'overlay', version=v('wms-add-version')||'1.3.0';
  if(!name||!url||!layers){ notify('Name, URL und Layer-Name sind erforderlich'); return; }
  const list=getWmsLayers();
  list.push({ id:(window.crypto?.randomUUID?crypto.randomUUID():'w'+Date.now()),
    name, url, layers, type, format:'image/png', version, transparent:type==='overlay', maxZoom:20, attribution:'' });
  saveWmsLayers(list); rebuildLayerControl(); renderWmsList();
  ['wms-add-name','wms-add-url','wms-add-layers'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  notify('WMS-Ebene hinzugefügt');
}
function deleteWmsLayer(id){
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
    orsKey:getOrsKey(),
    depotMode:document.getElementById('s-depot-mode').value,
    name:currentProjectData?.name||'', // Projektname wird unter Verwaltung → Projekte verwaltet
  };
  if(lat&&lng) updates.depot={lat,lng,address:addr||`${lat.toFixed(5)}, ${lng.toFixed(5)}`};
  await saveProjectSettings(updates);
  localStorage.setItem('bwt_ors_key',updates.orsKey);
  document.getElementById('active-project-name').textContent=updates.name;
  closeSettings();renderDepotMarker();
  await loadSavedRoutes();
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
  const disposition=document.getElementById('view-disposition');
  const verwaltung=document.getElementById('view-verwaltung');
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
  if(planenBtn) planenBtn.style.display=v==='karte'?'':'none';
  // Karte: always visible underneath, just hidden by overlays
  if(v==='karte') setTimeout(()=>map.invalidateSize(),10);
  if(v==='baeume') renderBaeumeTable();
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
  if(v==='disposition') initDispo();
  if(v==='verwaltung') initVerwaltung();
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
  sorted.forEach(tree=>{
    const tour=tours.find(t=>t.id===tree.tourId);
    const inact=!isActive(tree);
    const zCl={gut:'badge-ok',mittel:'badge-warn',schlecht:'badge-crit'}[tree.zustand]||'badge-gray';
    const zLbl={gut:'Gut',mittel:'Mittel',schlecht:'Schlecht'}[tree.zustand]||tree.zustand||'–';
    const wLbl={gering:'Gering',mittel:'Mittel',hoch:'Hoch'}[tree.wasser]||'–';
    const rNum=getRouteNum(tree.id);
    const pzt=tree.pflanzzeitpunkt||'–';
    const rowTours=getTreeTourIds(tree).map(id=>tours.find(t=>t.id===id)).filter(Boolean);
    rows+=`<tr style="border-top:1px solid var(--border);transition:background .1s;cursor:pointer;${inact?'opacity:.55;':''}" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''" data-treeid="${tree.id}">
      <td style="padding:8px 12px;font-family:'DM Mono',monospace;color:var(--text3);font-size:11px;white-space:nowrap;">${rNum!=null?'<b style=color:var(--green)>#'+rNum+'</b>':'–'}</td>
      <td style="padding:8px 12px;font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${tree.baumId||'–'}</td>
      <td style="padding:8px 12px;font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${tree.name||''}">${inact?'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);margin-right:5px;">INAKTIV</span>':''}${tree.name||'–'}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${tree.stadtteil||'–'}</td>
      <td style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${tree.baumnr||'–'}</td>
      <td style="padding:8px 12px;color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${tree.art||''}">${tree.art||'–'}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${tree.pflanzjahr||'–'}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;font-size:12px;">${pzt}</td>
      <td style="padding:8px 12px;"><span class="badge ${zCl}">${zLbl}</span></td>
      <td style="padding:8px 12px;white-space:nowrap;">${rowTours.length?rowTours.map(t=>`<span style="font-size:11px;font-weight:600;color:${t.color};">${t.name}</span>`).join('<br>'):'<span style="color:var(--text3);font-size:12px;">–</span>'}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${wLbl}</td>
      <td style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${tree.datum||'–'}</td>
      <td style="padding:8px 12px;">${!tree.lat||!tree.lng?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#fef3c7;color:#b45309;white-space:nowrap;">Kein GPS</span>':''}</td>
      <td style="padding:8px 12px;">
        <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;" data-editid="${tree.id}">Bearbeiten</button>
      </td>
    </tr>`;
  });

  wrap.innerHTML=`
    <div style="padding:12px 20px 8px;display:flex;align-items:center;gap:16px;flex-shrink:0;border-bottom:1px solid var(--border);background:var(--surface);">
      <span style="font-size:13px;font-weight:600;color:var(--text);">${sorted.length} Objekte${activeTourOnMap?' — <span style=color:'+tours.find(t=>t.id===activeTourOnMap)?.color+';font-weight:700>'+tours.find(t=>t.id===activeTourOnMap)?.name+'</span>':''}</span>
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
    grid.innerHTML=`<tr><td colspan="7" style="padding:60px;text-align:center;color:var(--text3);">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 12px;opacity:.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      Noch keine Touren angelegt</td></tr>`;
    if(countEl)countEl.textContent='Touren';
    return;
  }

  const q=(_tourenSearch||'').trim().toLowerCase();
  const list=q ? tours.filter(t=>(t.name||'').toLowerCase().includes(q)||(t.desc||'').toLowerCase().includes(q)) : tours;
  if(countEl)countEl.textContent=q?`${list.length} von ${tours.length} Touren`:`${tours.length} Touren`;

  if(list.length===0){
    grid.innerHTML=`<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--text3);">Keine Tour gefunden für „${_tourenSearch}"</td></tr>`;
    return;
  }

  grid.innerHTML=list.map(tour=>{
    const treesInTour=trees.filter(t=>treeInTour(t,tour.id));
    const cnt=treesInTour.length;
    const gut=treesInTour.filter(t=>t.zustand==='gut').length;
    const mittel=treesInTour.filter(t=>t.zustand==='mittel').length;
    const schlecht=treesInTour.filter(t=>t.zustand==='schlecht').length;
    const rt=tourRoutes[tour.id];
    const km=rt?rt.km.toFixed(1)+' km':'–';
    const driveZeit=rt&&rt.durationSec?fmtDuration(rt.durationSec):'–';
    const bewZeit=rt?fmtBewTime(cnt):'–';
    const gesamtZeit=rt&&rt.durationSec?fmtTotalTime(rt.durationSec,cnt):'–';
    const bar=cnt>0?`<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px;width:120px;">
      ${gut>0?`<div style="flex:${gut};background:var(--green);" title="${gut} gut"></div>`:''}
      ${mittel>0?`<div style="flex:${mittel};background:var(--amber);" title="${mittel} mittel"></div>`:''}
      ${schlecht>0?`<div style="flex:${schlecht};background:var(--red);" title="${schlecht} schlecht"></div>`:''}
      </div><div style="font-size:10px;color:var(--text3);margin-top:2px;">${gut}g · ${mittel}m · ${schlecht}s</div>`
      :'<span style="color:var(--text3);font-size:12px;">–</span>';
    return `<tr style="border-top:1px solid var(--border);" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
      <td style="padding:10px 16px;"><div style="width:14px;height:14px;border-radius:3px;background:${tour.color};flex-shrink:0;"></div></td>
      <td style="padding:10px 16px;font-weight:600;white-space:nowrap;">${tour.name}</td>
      <td style="padding:10px 16px;color:var(--text2);font-size:12px;">${tour.desc||'–'}</td>
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
          <button class="btn btn-primary" style="padding:3px 9px;font-size:11px;${rpDisStyle()}" data-action="route" data-tid="${tour.id}"${rpDisAttr()}>Route</button>
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
  if(allBtn){ const off=!getRoutePlanningEnabled(); allBtn.disabled=off; allBtn.style.opacity=off?'0.45':''; allBtn.style.cursor=off?'not-allowed':''; allBtn.title=off?'Reihenfolgeplanung ist deaktiviert':''; }
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
  // Migration läuft automatisch im Hintergrund → Banner nicht mehr nötig
  const needsMigration=false;
  let migBanner=document.getElementById('migration-banner');
  if(!migBanner){
    migBanner=document.createElement('div');
    migBanner.id='migration-banner';
    const vw=document.getElementById('view-verwaltung');
    vw?.children[0]?.insertBefore(migBanner, vw.children[0].firstChild);
  }
  migBanner.style.display=needsMigration?'flex':'none';
  migBanner.style.cssText=`display:${needsMigration?'flex':'none'};align-items:center;justify-content:space-between;gap:12px;background:#fef3c7;border:1px solid #b45309;border-radius:10px;padding:10px 14px;margin-bottom:10px;`;
  migBanner.innerHTML=`
    <div>
      <span style="font-size:12px;font-weight:700;color:#b45309;">⚠ Einmalige Migration erforderlich</span>
      <span style="font-size:11px;color:#6b6760;margin-left:8px;">Konvertiert tourId → tourIds[] — danach funktioniert die Fahrer-App wieder korrekt</span>
    </div>
    <button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;white-space:nowrap;border-color:#b45309;color:#b45309;" onclick="migrateTourIds()">Jetzt migrieren</button>`;
  loadErfasser();
  // Feldbezeichnungen-Grid dynamisch rendern
  const flGrid = document.getElementById('fl-grid-container');
  if(flGrid) {
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
  renderDriverLogins(); // org-level, unabhängig vom Projekt
  renderUserMgmt();      // Nutzer & Rollen (E-Mail-Konten)
  if(!currentProjectId)return;
  await loadReasons();
  // Kein Auto-Seed mehr: Gründe sind streng pro Projekt. Leere Projekte bekommen
  // einen optionalen Button (seedDefaultReasons) statt automatisch Standard-Gründe.
  renderDriverMgmt();
  renderReasonsMgmt();
}

// ─── FAHRER-LOGINS & PINs (Mehrmandanten — nutzbar nach Auth-Aktivierung) ─────
let driverLoginsOrg = '';
let dlPinEdit = null;
const dlEsc = s => (''+(s??'')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function dlFnCall(name,data){
  try{
    if(!window.firebase?.app || !firebase.app().functions) return Promise.reject({code:'unavailable'});
    return firebase.app().functions('us-central1').httpsCallable(name)(data);
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
  const orgSel=document.getElementById('dl-org');
  const body=document.getElementById('driver-logins-body');
  if(!orgSel||!body) return;
  if(!(currentRole==='superadmin'||currentRole==='orgadmin')){
    orgSel.style.display='none';
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);">${currentRole?'Nur Administratoren können Fahrer-Logins verwalten.':'Mehrmandanten/Auth noch nicht aktiviert — siehe <code>docs/auth-mandanten.md</code>.'}</div>`;
    return;
  }
  let orgs=[];
  if(currentRole==='superadmin'){ try{ const qs=await db.collection('orgs').get(); qs.forEach(d=>orgs.push({id:d.id,...d.data()})); }catch(e){} }
  else if(currentOrg){ orgs=[{id:currentOrg,name:currentOrg}]; }
  if(orgs.length===0){
    orgSel.innerHTML=''; orgSel.style.display='none';
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);line-height:1.6;">
      Keine Mandanten verfügbar (siehe <code>docs/auth-mandanten.md</code>).</div>`;
    return;
  }
  if(currentRole==='superadmin'){
    orgSel.style.display='';
    const picked=orgSel.value;
    if(picked && orgs.find(o=>o.id===picked)) driverLoginsOrg=picked;
    else if(!driverLoginsOrg||!orgs.find(o=>o.id===driverLoginsOrg)) driverLoginsOrg=orgs[0].id;
    orgSel.innerHTML=orgs.map(o=>`<option value="${dlEsc(o.id)}"${o.id===driverLoginsOrg?' selected':''}>${dlEsc(o.name||o.id)}</option>`).join('');
  } else { orgSel.style.display='none'; driverLoginsOrg=currentOrg; }
  let drivers=[];
  try{ const qs=await db.collection('drivers').where('orgId','==',driverLoginsOrg).get(); qs.forEach(d=>drivers.push({id:d.id,...d.data()})); }catch(e){}
  drivers.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  body.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      ${drivers.length?drivers.map(dlRow).join(''):`<div style="font-size:12px;color:var(--text3);">Noch keine Fahrer in diesem Mandanten.</div>`}
    </div>
    <div style="display:flex;gap:6px;align-items:center;border-top:1px solid var(--border);padding-top:10px;">
      <input id="dl-new-name" class="form-control" placeholder="Fahrername…" style="flex:1;padding:5px 8px;font-size:12px;">
      <input id="dl-new-pin" class="form-control" placeholder="6-stellige PIN" inputmode="numeric" maxlength="6" style="width:130px;padding:5px 8px;font-size:12px;">
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px;white-space:nowrap;" onclick="addDriverLogin()">+ Fahrer + PIN</button>
    </div>`;
}
function dlRow(d){
  const active=d.active!==false, editing=dlPinEdit===d.id;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;">
    <span style="flex:1;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(d.name)}</span>
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="dl-pin-${dlEsc(d.id)}" class="form-control" placeholder="neue PIN" inputmode="numeric" maxlength="6" style="width:110px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveDriverPin('${dlEsc(d.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlCancelPin()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlEditPin('${dlEsc(d.id)}')">PIN setzen</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleDriverLoginActive('${dlEsc(d.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>`}
  </div>`;
}
async function addDriverLogin(){
  const name=(document.getElementById('dl-new-name')?.value||'').trim();
  const pin=(document.getElementById('dl-new-pin')?.value||'').trim();
  if(!name){ notify('Bitte Fahrername eingeben'); return; }
  if(!/^\d{6}$/.test(pin)){ notify('PIN muss 6-stellig sein'); return; }
  try{ await dlFnCall('setDriverPin',{name,orgId:driverLoginsOrg,pin}); notify('✓ Fahrer angelegt'); renderDriverLogins(); }
  catch(e){ notify(dlErr(e)); }
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
  const orgSel=document.getElementById('ur-org');
  const body=document.getElementById('user-mgmt-body');
  if(!orgSel||!body) return;
  if(!(currentRole==='superadmin'||currentRole==='orgadmin')){
    orgSel.style.display='none';
    body.innerHTML=`<div style="font-size:12px;color:var(--text3);">Nur Administratoren können Nutzer verwalten.</div>`;
    return;
  }
  let orgs=[];
  if(currentRole==='superadmin'){ try{ const qs=await db.collection('orgs').get(); qs.forEach(d=>orgs.push({id:d.id,...d.data()})); }catch(e){} }
  else { orgs=[{id:currentOrg,name:currentOrg}]; }
  if(orgs.length===0){ orgSel.style.display='none'; body.innerHTML=`<div style="font-size:12px;color:var(--text3);">Keine Mandanten vorhanden (siehe docs/auth-mandanten.md).</div>`; return; }
  if(currentRole==='superadmin'){
    orgSel.style.display='';
    const picked=orgSel.value;
    if(picked && orgs.find(o=>o.id===picked)) userMgmtOrg=picked;
    else if(!userMgmtOrg||!orgs.find(o=>o.id===userMgmtOrg)) userMgmtOrg=orgs[0].id;
    orgSel.innerHTML=orgs.map(o=>`<option value="${dlEsc(o.id)}"${o.id===userMgmtOrg?' selected':''}>${dlEsc(o.name||o.id)}</option>`).join('');
  } else { orgSel.style.display='none'; userMgmtOrg=currentOrg; }
  let users=[];
  try{ const qs=await db.collection('users').where('orgId','==',userMgmtOrg).get(); qs.forEach(d=>users.push({id:d.id,...d.data()})); }catch(e){}
  users.sort((a,b)=>(a.email||'').localeCompare(b.email||''));
  body.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      ${users.length?users.map(urRow).join(''):`<div style="font-size:12px;color:var(--text3);">Noch keine Nutzer in diesem Mandanten.</div>`}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;">
      <input id="ur-new-email" class="form-control" type="email" placeholder="E-Mail" style="flex:1;min-width:150px;padding:5px 8px;font-size:12px;">
      <input id="ur-new-pass" class="form-control" type="text" placeholder="Start-Passwort (min. 6)" style="width:170px;padding:5px 8px;font-size:12px;">
      <select id="ur-new-role" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
        <option value="planer">Planer</option>
        <option value="erfasser">Erfasser</option>
        <option value="orgadmin">Org-Admin</option>
      </select>
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px;white-space:nowrap;" onclick="addOrgUser()">+ Nutzer anlegen</button>
    </div>`;
}
function urRow(u){
  const active=u.active!==false, editing=urPassEdit===u.id;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;flex-wrap:wrap;">
    <span style="flex:1;min-width:140px;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(u.email||u.id)}</span>
    <span style="font-size:10px;font-weight:700;color:var(--text2);background:var(--surface2);padding:1px 7px;border-radius:99px;">${dlEsc(u.role||'')}</span>
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="ur-pass-${dlEsc(u.id)}" class="form-control" type="text" placeholder="neues Passwort" style="width:150px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveUserPass('${dlEsc(u.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urCancelPass()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urEditPass('${dlEsc(u.id)}')">Passwort</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleUserActive('${dlEsc(u.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>`}
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
  if(tours.length===0){
    el.innerHTML='<div style="padding:10px 14px;font-size:12px;color:var(--text3);">Noch keine Touren angelegt.</div>';return;
  }
  // Spaltenanzahl: 3 bei ≥4 Touren, 2 bei 2-3, 1 bei 1
  const cols = tours.length >= 4 ? 3 : tours.length >= 2 ? 2 : 1;
  el.innerHTML=`<div style="display:grid;grid-template-columns:repeat(${cols},1fr);">`+
    tours.map((t,idx)=>{
      const isLastRow = idx >= tours.length - (tours.length % cols || cols);
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
        <div style="display:flex;gap:4px;">
          <input class="form-control" id="new-driver-${t.id}" placeholder="Name…" style="flex:1;padding:4px 8px;font-size:11px;min-width:0;" onkeydown="if(event.key==='Enter')addDriver('${t.id}')">
          <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="addDriver('${t.id}')">+</button>
        </div>
      </div>`;
    }).join('')+`</div>`;
}

async function addDriver(tourId){
  const inp=document.getElementById('new-driver-'+tourId);
  const name=inp?.value.trim();if(!name)return;
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  const drivers=[...(tour.drivers||[tour.assignedDriver].filter(Boolean))];
  if(drivers.includes(name)){notify('Fahrer bereits vorhanden');return;}
  drivers.push(name);
  await updateDoc(doc(db,'projects',currentProjectId,'tours',tourId),{drivers,assignedDriver:drivers[0]});
  inp.value='';
  notify('Fahrer hinzugefügt');
}

async function removeDriver(tourId,idx){
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  const drivers=[...(tour.drivers||[tour.assignedDriver].filter(Boolean))];
  drivers.splice(idx,1);
  await updateDoc(doc(db,'projects',currentProjectId,'tours',tourId),{drivers,assignedDriver:drivers[0]||''});
  notify('Fahrer entfernt');
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
let _importRows=[], _importSwap=false, _impMap=null, _impLayer=null;
// Zahl robust parsen (auch Dezimal-Komma "52,28")
function impNum(v){ if(v==null)return NaN; if(typeof v==='number')return v; return parseFloat(String(v).trim().replace(',','.')); }
// Plausibel in Deutschland?
function impInDE(la,lo){ return la>47&&la<55.5&&lo>5&&lo<16; }

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
  const parsed=[];
  for(let i=1;i<rows.length;i++){
    const row=rows[i]; if(!row||row.length<1)continue;
    const lat=impNum(row[7]), lng=impNum(row[8]);
    parsed.push({
      name:row[0]||'Unbekannt', stadtteil:row[1]||'', art:row[2]||'',
      baumnr:row[3]?.toString()||'', pflanzjahr:row[4]?.toString()||'',
      pflanzzeitpunkt:row[5]?.toString()||'', notiz:row[6]||'',
      lat:isNaN(lat)?null:lat, lng:isNaN(lng)?null:lng,
    });
  }
  if(!parsed.length){ notify('Keine Datenzeilen gefunden'); return; }
  _importRows=parsed;
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
  const sw=document.getElementById('imp-swap'); sw.checked=_importSwap;
  sw.onchange=()=>{ _importSwap=sw.checked; renderImportPreview(); };
  document.getElementById('imp-x').onclick=closeImportPreview;
  document.getElementById('imp-cancel').onclick=closeImportPreview;
  document.getElementById('imp-go').onclick=doImport;
  m.onclick=e=>{ if(e.target===m)closeImportPreview(); };
  // Karte initialisieren
  try{
    _impMap=L.map('imp-map',{zoomControl:true}).setView([51,9],5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(_impMap);
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
  let imported=0;
  try{
    // Baum-Zähler EINMAL lesen, lokal hochzählen, am Ende EINMAL schreiben (statt pro Objekt)
    const projRef=doc(db,'projects',currentProjectId);
    const projSnap=await getDoc(projRef);
    let counter=projSnap.data()?.lastBaumId||0;
    const colRef=collection(db,'projects',currentProjectId,'trees');
    const CH=450; // Firestore-Batch-Limit ist 500
    for(let i=0;i<_importRows.length;i+=CH){
      const batch=db.batch();
      for(const r of _importRows.slice(i,i+CH)){
        counter++;
        const baumId='B-'+String(counter).padStart(5,'0');
        const la=_importSwap?r.lng:r.lat, lo=_importSwap?r.lat:r.lng;
        batch.set(colRef.doc(),{
          name:r.name, stadtteil:r.stadtteil, art:r.art, baumnr:r.baumnr,
          pflanzjahr:r.pflanzjahr, pflanzzeitpunkt:r.pflanzzeitpunkt, notiz:r.notiz,
          lat:(la==null?null:la), lng:(lo==null?null:lo),
          wasser:'mittel',zustand:'mittel', datum:'',tourId:'',tourIds:[],history:[],
          baumId, createdAt:serverTimestamp(),
          orgId: currentProjectData?.orgId || currentOrg,
        });
        imported++;
      }
      if(btn) btn.textContent=`Importiert… ${Math.min(imported,_importRows.length)}/${_importRows.length}`;
      await batch.commit();
    }
    await updateDoc(projRef,{lastBaumId:counter}); // Zähler einmal final setzen
  }catch(e){ notify('Import-Fehler: '+e.message); }
  closeImportPreview();
  notify(`✓ ${imported} Objekte importiert${_importSwap?' · Koordinaten getauscht':''}`);
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

  body.innerHTML=reported.map((tree,idx)=>{
    const tour=tours.find(t=>t.id===tree.tourId);
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
      <td style="padding:8px 12px;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${tree._projectName||currentProjectData?.name||'–'}</td>
      <td style="padding:8px 12px;font-size:12px;font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${tree.name||''}">${tree.name||'–'}</td>
      <td style="padding:8px 12px;font-size:11px;color:var(--text2);font-family:monospace;white-space:nowrap;">${tree.baumnr||'–'}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);white-space:nowrap;">${tree.stadtteil||'–'}</td>
      <td style="padding:8px 12px;font-size:12px;">${tour?`<span style="font-weight:600;color:${tour.color};">${tour.name}</span>`:'–'}</td>
      <td style="padding:8px 12px;font-size:12px;white-space:nowrap;">${stHtml}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${tree.lastReason||''}">${tree.lastReason||'–'}</td>
      <td style="padding:8px 12px;font-size:12px;color:var(--text2);white-space:nowrap;">${tree.lastDriver||'–'}</td>
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
    t.lastStatus||'offen',t.lastReason||'',t.lastNote||'',t.zustand||'',t.wasser||''
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

  // Setup canvas
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
  trees.forEach(tree=>{
    if(!tree.lat||!tree.lng)return;
    const pt=map.latLngToContainerPoint(L.latLng(tree.lat,tree.lng));
    if(touchesLasso(pt.x,pt.y,MARKER_RADIUS)) selected.push(tree);
  });

  lassoPoints=[];
  if(selected.length===0){notify('Keine Objekte im Lasso-Bereich');return;}

  // Konflikte (bereits in anderer Tour) vs. frei/bereits in Ziel-Tour
  const conflicts=selected.filter(t=>getTreeTourIds(t).length>0&&!treeInTour(t,tourId));
  const clean=selected.filter(t=>getTreeTourIds(t).length===0||treeInTour(t,tourId));

  // Bei Konflikten: gleicher Hinweisdialog wie beim Einzelklick (3 Optionen)
  let mode='add'; // 'add' = zusätzlich zuordnen | 'move' = aus bisherigen Touren entfernen
  if(conflicts.length>0){
    const choice=await showLassoConflictDialog(conflicts,tour?.name||'');
    if(choice==='cancel'){ notify('Abgebrochen — keine Änderungen'); return; }
    mode=choice;
  }

  const targets=[...clean,...conflicts];
  if(targets.length===0){notify('Keine Objekte zugewiesen');return;}

  const conflictSet=new Set(conflicts.map(t=>t.id));
  setSyncState('syncing',`${targets.length} Objekte werden zugewiesen…`);
  for(const tree of targets){
    const newIds=(mode==='move'&&conflictSet.has(tree.id))
      ? [tourId]                                              // aus bisherigen Touren entfernen
      : [...new Set([...getTreeTourIds(tree),tourId])];       // zusätzlich zuordnen
    await setTreeTourIds(tree.id,newIds);
  }
  routeCache={};
  rebuildAssignPills();
  setSyncState('ok','Synchronisiert');
  notify(`✓ ${targets.length} Objekte → ${tour?.name||'Tour'}`);
}

// cancelLasso merged into cancelAssign

// ─── CONFLICT DIALOGS ────────────────────────────────────────
// Lasso-Variante des Konflikt-Dialogs – gleiche Optik & Optionen wie beim
// Einzelklick (showTourConflictDialog), angewandt auf mehrere Objekte.
// Liefert: 'move' (aus bisherigen entfernen) | 'add' (zusätzlich) | 'cancel'
function showLassoConflictDialog(conflicts, toTour){
  return new Promise(resolve=>{
    const existing=document.getElementById('conflict-modal'); if(existing) existing.remove();
    const names=conflicts.slice(0,4).map(t=>t.name).filter(Boolean).join(', ')+(conflicts.length>4?` +${conflicts.length-4} weitere`:'');
    const curName=toTour||'aktuelle Tour';
    const n=conflicts.length;
    const modal=document.createElement('div');
    modal.id='conflict-modal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;';
    const done=v=>{ modal.remove(); resolve(v); };
    const opt=(id,title,desc,color)=>`<button id="${id}" style="display:block;width:100%;text-align:left;padding:11px 13px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);cursor:pointer;font-family:inherit;transition:background .12s;" onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='var(--surface)'">
      <div style="font-size:13px;font-weight:600;color:${color};">${title}</div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px;">${desc}</div></button>`;
    modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:460px;max-width:92vw;overflow:hidden;">
      <div style="padding:18px 20px 12px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;color:var(--amber);">⚠ ${n} Objekte bereits verplant</div>
      <div style="padding:16px 20px;font-size:13px;color:var(--text2);line-height:1.6;">
        ${n} der ausgewählten Objekte sind bereits anderen Touren zugeordnet:<br>
        <b style="color:var(--text);">${names}</b><br><br>
        Möchten Sie diese in die Tour <b style="color:var(--text);">„${curName}"</b> übernehmen?
      </div>
      <div style="padding:0 20px 18px;display:flex;flex-direction:column;gap:8px;">
        ${opt('lc-move','Übernehmen und aus bisheriger Tour entfernen',`Werden „${curName}" zugeordnet und aus ihren bisherigen Touren entfernt.`,'var(--green)')}
        ${opt('lc-add','Zusätzlich zur aktuellen Tour zuordnen',`Bleiben in ihren bisherigen Touren und werden zusätzlich „${curName}" zugeordnet.`,'var(--text)')}
        ${opt('lc-cancel','Abbrechen','Es werden keine Änderungen vorgenommen.','var(--text2)')}
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#lc-move').onclick=()=>done('move');
    modal.querySelector('#lc-add').onclick=()=>done('add');
    modal.querySelector('#lc-cancel').onclick=()=>done('cancel');
    modal.addEventListener('click',e=>{ if(e.target===modal) done('cancel'); });
  });
}

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
  if(activeTourOnMap && rpOn){
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(dashNichtMap);
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
    const meta=[r.stadtteil,r.baumnr].filter(Boolean).join(' · ');
    const popup=`<b>${r.name||'Baum'}</b>`+(meta?`<br>${meta}`:'')+(r.art?`<br><i>${r.art}</i>`:'')+
      `<br>Grund: <b style="color:#dc2626;">${r.lastReason||'nicht angegeben'}</b>`+
      (r.lastNote?`<br>Notiz: ${r.lastNote}`:'')+(r.lastDriver?`<br>Fahrer: ${r.lastDriver}`:'')+`<br>${d}`;
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
const DISPO_CFG_KEY='dispo_config', DISPO_BINS_KEY='dispo_bins', DISPO_RES_KEY='dispo_resources';
let dispoMap=null, dispoLayer=null, dispoPickCleanup=null, dispoMarkers={};
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

function dispoGetConfig(){
  const d={kritisch:80, planbar:50, aus:50, emptyMin:3, reservePct:10, speedKmh:25, binCount:40};
  try{ return {...d, ...(JSON.parse(localStorage.getItem(DISPO_CFG_KEY)||'{}'))}; }catch(e){ return d; }
}
function dispoSetConfig(c){ localStorage.setItem(DISPO_CFG_KEY, JSON.stringify(c)); }
function dispoGetBins(){ try{ return JSON.parse(localStorage.getItem(DISPO_BINS_KEY)||'[]'); }catch(e){ return []; } }
function dispoSetBins(a){ localStorage.setItem(DISPO_BINS_KEY, JSON.stringify(a)); }
function dispoDefaultDepot(){
  const d=getDepot(); if(d?.lat) return {lat:d.lat, lng:d.lng, adresse:d.address||'Betriebshof'};
  const pts=(dispoGetBins().length?dispoGetBins():trees.filter(t=>t.lat&&t.lng));
  if(pts.length){ const la=pts.reduce((s,p)=>s+p.lat,0)/pts.length, lo=pts.reduce((s,p)=>s+p.lng,0)/pts.length; return {lat:la, lng:lo, adresse:'Zentrum'}; }
  return {lat:50.0, lng:8.42, adresse:'Betriebshof'};
}
function dispoGetResources(){
  try{ const r=JSON.parse(localStorage.getItem(DISPO_RES_KEY)||'null'); if(r) return r; }catch(e){}
  const def=[
    {id:'r1', name:'Fahrzeug 1', arbeitszeitMin:420, depot:null, maxBins:0}, // depot null = Standard-Betriebshof, maxBins 0 = unbegrenzt
    {id:'r2', name:'Fahrzeug 2', arbeitszeitMin:420, depot:null, maxBins:0},
  ];
  dispoSetResources(def); return def;
}
function dispoSetResources(a){ localStorage.setItem(DISPO_RES_KEY, JSON.stringify(a)); }
// depot null/leer oder == Projekt-Betriebshof → Standard
function dispoIsStandardDepot(d){ if(!d||d.lat==null) return true; const dp=dispoDefaultDepot(); return Math.abs(d.lat-dp.lat)<1e-5 && Math.abs(d.lng-dp.lng)<1e-5; }
function dispoResolveDepot(r){ return (r.depot&&r.depot.lat!=null)?r.depot:dispoDefaultDepot(); }

function dispoSimulate(){
  const cfg=dispoGetConfig();
  const src=trees.filter(t=>t.lat&&t.lng);
  if(src.length<5){ notify('Keine Standorte verfügbar – bitte Projekt mit Objekten öffnen'); return; }
  const shuffled=[...src].sort(()=>Math.random()-0.5).slice(0, Math.min(cfg.binCount, src.length));
  const bins=shuffled.map((t,i)=>({
    id:'pk'+i, name:'Papierkorb '+(i+1), stadtteil:t.stadtteil||'', lat:t.lat, lng:t.lng,
    fuellstand:Math.floor(Math.random()*101),
    fillRate:5+Math.floor(Math.random()*26), // %/Tag (simuliert)
  }));
  dispoSetBins(bins);
  window.__dispoPlan=null;
  dispoRenderResults(); dispoRenderMap();
  notify(`${bins.length} Papierkörbe simuliert`);
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
    const html=`<div style="display:flex;align-items:center;gap:5px;white-space:nowrap;">`
      + `<div style="width:22px;height:22px;border-radius:5px;background:${col};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0;">🏢</div>`
      + `<span style="background:rgba(255,255,255,.92);border:1px solid #cbd5e1;color:#1f2937;font-size:11px;font-weight:600;padding:2px 6px;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.2);">${label}</span></div>`;
    const m=L.marker([g.depot.lat,g.depot.lng],{icon:L.divIcon({className:'',html,iconSize:[22,22],iconAnchor:[11,11]})}).addTo(dispoLayer);
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

function dispoRenderMap(){
  const L=window.L, wrap=document.getElementById('dispo-map'); if(!L||!wrap) return;
  if(!dispoMap){
    dispoMap=L.map('dispo-map',{zoomControl:true,attributionControl:false}).setView([50.0,8.42],12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(dispoMap);
    dispoLayer=L.layerGroup().addTo(dispoMap);
    setTimeout(()=>dispoMap.invalidateSize(),150);
  }
  dispoLayer.clearLayers();
  dispoMarkers={};
  const bins=dispoGetBins(), cfg=dispoGetConfig(), plan=window.__dispoPlan;
  const pts=[];
  const filtered=plan && dispoVisible; // Sichtbarkeitsfilter aktiv?
  // Welche Körbe gehören zu sichtbaren Touren?
  let visBinIds=null;
  if(filtered){ visBinIds=new Set(); plan.R.forEach(r=>{ if(dispoResVisible(r.id)) r.route.forEach(s=>visBinIds.add(s.id)); }); }
  // Routen (nur sichtbare Fahrzeuge)
  if(plan){
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
  bins.forEach(b=>{
    let col='#9c9890';
    if(plan){ const st=plan.begr[b.id]?.status; col= st==='eingeplant'?'#16a34a': st==='verschoben'?'#b45309':'#9c9890'; }
    else { col= b.fuellstand>=cfg.kritisch?'#dc2626': b.fuellstand>=cfg.planbar?'#f59e0b':'#9c9890'; }
    // Bei aktivem Filter: Körbe fremder/ausgeblendeter Touren gedämpft darstellen
    const dim = filtered && plan.begr[b.id]?.status==='eingeplant' && !visBinIds.has(b.id);
    const m=L.circleMarker([b.lat,b.lng],{radius:dim?4:7,color:'#fff',weight:1.5,fillColor:col,fillOpacity:dim?0.25:0.95}).addTo(dispoLayer);
    m.bindPopup(`<b>${b.name}</b><br>Füllstand: <b>${b.fuellstand}%</b>${b.fillRate?`<br>~voll in ${Math.max(0,Math.ceil((100-b.fuellstand)/b.fillRate))} Tagen`:''}${plan?`<br>Status: ${plan.begr[b.id]?.status||'-'}`:''}`);
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
function buildKiContext(){
  if(!currentProjectId) return 'Kein Projekt geöffnet.';
  const active=trees.filter(isActive);
  const cntZ=k=>active.filter(t=>t.zustand===k).length;
  const grp=(arr,key,top)=>{ const m={}; arr.forEach(t=>{const v=key(t)||'—';m[v]=(m[v]||0)+1;}); let e=Object.entries(m).sort((a,b)=>b[1]-a[1]); if(top)e=e.slice(0,top); return e.map(([k,n])=>`${k}: ${n}`).join(', '); };
  const bew=active.filter(t=>t.lastStatus==='bewaessert').length;
  const nicht=active.filter(t=>t.lastStatus==='nicht').length;
  const offen=active.filter(t=>!t.lastStatus||t.lastStatus==='offen').length;
  const gruende=grp(active.filter(t=>t.lastStatus==='nicht'), t=>t.lastReason)||'keine';
  const tourStr=tours.map(t=>{ const c=active.filter(x=>treeInTour(x,t.id)).length; const rt=tourRoutes[t.id]; return `${t.name}: ${c} Objekte${rt?`, ${rt.km.toFixed(1)} km`:''}`; }).join(' | ')||'keine';
  return [
    `Projekt: ${currentProjectData?.name||currentProjectId}`,
    `Objekte gesamt (aktiv): ${active.length}`,
    `Zustand: gut ${cntZ('gut')}, mittel ${cntZ('mittel')}, schlecht ${cntZ('schlecht')}`,
    `Letzter Status: bewässert ${bew}, nicht bewässert ${nicht}, offen ${offen}`,
    `Gründe „nicht bewässert": ${gruende}`,
    `Objekte je Stadtteil: ${grp(active,t=>t.stadtteil)}`,
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

function openKiPrompt(id){
  const p=KI_PROMPTS.find(x=>x.id===id); if(!p) return;
  if(!currentProjectId){ notify('Bitte zuerst ein Projekt öffnen'); return; }
  const text=p.build(buildKiContext());
  const esc=s=>(''+s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const auto=kiHasAuto(), manual=kiHasManual();
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';
  const footer=[
    auto?`<button id="ki-gemini" class="btn btn-primary">🤖 Mit Gemini auswerten</button>`:'',
    manual?`<button id="ki-copy" class="btn ${auto?'btn-secondary':'btn-primary'}">📋 Prompt kopieren</button>`:'',
    manual?`<a href="https://chatgpt.com/" target="_blank" rel="noopener" class="btn btn-secondary">ChatGPT ↗</a>`:'',
    manual?`<a href="https://claude.ai/new" target="_blank" rel="noopener" class="btn btn-secondary">Claude ↗</a>`:'',
  ].filter(Boolean).join('');
  modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:820px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
      <span style="font-size:20px;">${p.icon}</span>
      <div style="flex:1;min-width:0;"><div style="font-size:15px;font-weight:700;">${p.title}</div><div style="font-size:12px;color:var(--text3);">${p.desc}</div></div>
      <button id="ki-close" style="border:none;background:none;cursor:pointer;color:var(--text2);font-size:22px;line-height:1;">×</button>
    </div>
    <div style="padding:14px 20px;overflow:auto;">
      <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Prompt (editierbar)${auto?' – „Mit Gemini auswerten" oder ':' – '}kopieren und in einen KI-Dienst einfügen:</div>
      <textarea id="ki-text" style="width:100%;height:${auto?'220px':'320px'};font-family:'DM Mono',monospace;font-size:12px;line-height:1.5;border:1px solid var(--border);border-radius:var(--radius-sm);padding:10px;resize:vertical;background:var(--bg);color:var(--text);outline:none;">${esc(text)}</textarea>
      <div style="font-size:11px;color:var(--amber);margin-top:8px;">⚠ Die Projektdaten sind im Prompt enthalten.${auto?' Bei „Mit Gemini auswerten" werden sie über die Cloud Function an Google Gemini gesendet.':' Beim Einfügen in einen externen KI-Dienst verlassen sie die App.'}</div>
      <div id="ki-result" style="display:none;margin-top:14px;"></div>
    </div>
    <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">${footer}</div>
  </div>`;
  document.body.appendChild(modal);
  const close=()=>modal.remove();
  modal.querySelector('#ki-close').onclick=close;
  modal.addEventListener('click',e=>{ if(e.target===modal) close(); });
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
      const r=await fetch('/api/gemini',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:promptText})});
      let data={}; try{ data=await r.json(); }catch(_){}
      if(!r.ok){
        const det=data.detail?(' – '+esc(typeof data.detail==='string'?data.detail:JSON.stringify(data.detail))):'';
        res.innerHTML=`<div style="color:var(--red);font-size:12px;">Fehler (${r.status}): ${esc(data.error||'unbekannt')}${det}</div>`;
      } else {
        const ans=data.text||'(leere Antwort)';
        res.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:11px;font-weight:700;color:var(--green);">🤖 GEMINI-ANTWORT</span><button id="ki-ans-copy" class="btn btn-secondary" style="padding:2px 8px;font-size:11px;margin-left:auto;">Antwort kopieren</button></div>
          <div style="white-space:pre-wrap;font-size:13px;line-height:1.55;background:var(--green-light);border:1px solid var(--green-mid);border-radius:var(--radius-sm);padding:12px;max-height:340px;overflow:auto;">${esc(ans)}</div>`;
        const ac=res.querySelector('#ki-ans-copy'); if(ac) ac.onclick=()=>{ navigator.clipboard?.writeText(ans); notify('Antwort kopiert'); };
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

Object.assign(window,{
  openKiPrompt,renderKi,setKiMode,renderKiConfig,
  dispoSimulate,dispoPlan,dispoOpenSettings,dispoToggle,dispoAssign,dispoUnassign,dispoFocusBin,dispoFocusPoint,dispoResetDepot,dispoFocusVehicle,dispoToggleVehicle,dispoShowAllVehicles,
  dashSetPeriod,renderDashboard,refreshDashboard,dashFilterTours,
  saveInlineFields,filterDetailTable,filterBaeumeTable,saveHistoryEdits,deleteHistoryEntry,refreshControlling,loadTourHistoryForControlling,loadErfasser,addErfasser,removeErfasser,addReason,deleteReason,saveDriverAssignment,setCtrlPeriod,renderControlling,exportCtrlCSV,initControlling,initVerwaltung,addDriver,removeDriver,addReasonMgmt,deleteReasonMgmt,seedDefaultReasons,resetObjFilter,loadTourHistory,showHistoryDetail,exportHistoryCSV,resetCtrlFilters,ctrlShowOnMap,
  importExcel,calculateAndSaveRoute,calculateAllRoutes,closeCtxMenu,ctxCalcActive,cancelAssign,setAssignTour,startAssignMode,rebuildAssignPills,
  createProject,openProject,showProjectScreen,
  switchView,openDetail,closePanel,logWatering,
  openAddTree,openEditTree,closeTreeModal,saveTree,deleteTree,
  archiveTree,reactivateTree,archiveTreeFromModal,reactivateTreeFromModal,deleteTreeFromModal,toggleShowInactive,showTreeOnMapFromModal,
  openTourModal,closeTourModal,saveTour,deleteTour,filterTourenGrid,
  focusTour,focusTourAndSwitch,
  startPlacement,cancelMode,setDepotOnMap,
  startAssignMode,setAssignTour,cancelAssign,assignTreeToTour,
  openSettings,closeSettings,geocodeDepot,applySettings,confirmDeleteProject,openImport,openAllgemein,openProjekte,
  addWmsLayer,deleteWmsLayer,renderWmsList,
  setFilter,pickColor,renderList,
  toggleLassoMode,switchDetailTab,toggleRoutePlanning,setLassoTour,toggleRouteLines,
  renderDriverLogins,addDriverLogin,saveDriverPin,toggleDriverLoginActive,dlEditPin,dlCancelPin,
  renderUserMgmt,addOrgUser,saveUserPass,toggleUserActive,urEditPass,urCancelPass,
  startGpsPlacement,toggleFilterNoGps,updateBtnFilterNoGps,
  saveFieldLabels, migrateTourIds,
  doLogin, doLogout,
});

// ─── AUTH-GATE ────────────────────────────────────────────────
function showLogin(msg){
  const ls=document.getElementById('login-screen'); if(ls) ls.style.display='flex';
  const ps=document.getElementById('project-screen'); if(ps) ps.style.display='none';
  const e=document.getElementById('login-error'); if(e) e.textContent=msg||'';
  const b=document.getElementById('login-btn'); if(b){ b.disabled=false; b.textContent='Anmelden'; }
}
function hideLogin(){ const ls=document.getElementById('login-screen'); if(ls) ls.style.display='none'; }
function updateUserChip(){
  const el=document.getElementById('user-chip-text');
  if(el) el.textContent=(currentUser?.email||'')+(currentRole?(' · '+currentRole):'');
}
async function doLogin(){
  const email=(document.getElementById('login-email')?.value||'').trim();
  const pass=document.getElementById('login-pass')?.value||'';
  const err=document.getElementById('login-error');
  const btn=document.getElementById('login-btn');
  if(!email||!pass){ if(err) err.textContent='Bitte E-Mail und Passwort eingeben'; return; }
  if(btn){ btn.disabled=true; btn.textContent='Anmelden…'; } if(err) err.textContent='';
  try{
    await firebase.auth().signInWithEmailAndPassword(email,pass);
  }catch(e){
    const code=e&&e.code||'';
    if(err) err.textContent=/invalid-credential|wrong-password|user-not-found|invalid-email/.test(code)
      ? 'E-Mail oder Passwort falsch' : ('Fehler: '+((e&&e.message)||code));
    if(btn){ btn.disabled=false; btn.textContent='Anmelden'; }
  }
}
async function doLogout(){ try{ await firebase.auth().signOut(); }catch(e){} location.reload(); }

firebase.auth().onAuthStateChanged(async (user)=>{
  if(user){
    try{ const tok=await user.getIdTokenResult(); currentUser=user; currentRole=tok.claims.role||''; currentOrg=tok.claims.orgId||''; }
    catch(e){ currentRole=''; currentOrg=''; }
    if(!currentRole){ showLogin('Dieses Konto hat keine Berechtigung. Bitte an den Administrator wenden.'); return; }
    hideLogin(); updateUserChip(); initProjectScreen();
  } else {
    currentUser=null; currentRole=''; currentOrg='';
    showLogin('');
  }
});

(()=>{ const el=document.getElementById('app-version'); if(el) el.textContent=`Version ${APP_VERSION}`; })();

applyKiNavVisibility(); // KI-Reiter je nach Einstellung ein-/ausblenden