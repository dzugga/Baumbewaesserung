// App-Version – hier zentral pflegen (wird im Einstellungen-Panel angezeigt)
const APP_VERSION = '1.0';

function initializeApp(cfg){ return firebase.initializeApp(cfg); }
function getFirestore(app){ return firebase.firestore(app); }
function collection(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function doc(db,...segs){ let r=db; for(let i=0;i<segs.length;i++) r=(i%2===0)?r.collection(segs[i]):r.doc(segs[i]); return r; }
function getDoc(ref){ return ref.get(); }
function getDocs(ref){ return ref.get(); }
function addDoc(ref,data){ return ref.add(data); }
function setDoc(ref,data,opts){ return opts?ref.set(data,opts):ref.set(data); }
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
const TOUR_COLORS=['#2d6a4f','#1e40af','#7c3aed','#be123c','#b45309','#0e7490','#064e3b','#b91c1c'];

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
let tours = [];   // live from Firestore
let trees = [];   // live from Firestore
let unsubTours = null;
let unsubTrees = null;

let currentView = 'karte';
let selectedTreeId = null;
let filterTour = 'all';
let activeTourOnMap = null;
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
L.control.layers({'Karte':baseOSM,'Satellit':baseSat}, null, {position:'topleft', collapsed:false}).addTo(map);
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
    if(activeTourOnMap){ rebuildActiveRoute(); }
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
  const q=query(collection(db,'projects'),orderBy('createdAt'));
  unsubProjects=onSnapshot(q,snap=>{
    const psList=document.getElementById('ps-list');
    const sync=document.getElementById('ps-sync');
    sync.innerHTML='<div class="sync-dot"></div> Verbunden';
    if(snap.empty){
      psList.innerHTML='<div class="ps-empty">Noch keine Projekte. Erstelle dein erstes Projekt unten.</div>';
      return;
    }
    // Use async IIFE to allow await inside onSnapshot callback
    (async()=>{
      const projectsWithCounts = await Promise.all(snap.docs.map(async d=>{
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
      createdAt:serverTimestamp()
    });
    document.getElementById('ps-new-name').value='';
    openProject(ref.id);
  }catch(e){ notify('Fehler: '+e.message); }
}

async function openProject(projectId){
  currentProjectId=projectId;
  const snap=await getDoc(doc(db,'projects',projectId));
  currentProjectData={id:projectId,...snap.data()};
  document.getElementById('active-project-name').textContent=currentProjectData.name;
  document.getElementById('project-screen').style.display='none';
  loadFieldLabels();
  // Subscribe to tours & trees
  subscribeToProject();
}

function showProjectScreen(){
  if(unsubTours){unsubTours();unsubTours=null;}
  if(unsubTrees){unsubTrees();unsubTrees=null;}
  // clear map
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));mapMarkers={};
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}
  tours=[];trees=[];tourOrder={};activeTourOnMap=null;filterTour='all';
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
    setSyncState('ok','Synchronisiert');
  });

  const treesRef=collection(db,'projects',currentProjectId,'trees');
  unsubTrees=onSnapshot(treesRef,snap=>{
    trees=snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshMarkers();renderList();
    if(currentView==='baeume')renderBaeumeTable();
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

    // Delete all subcollections
    const subcollections=['trees','tours','routes','reasons','tourHistory'];
    for(const sub of subcollections){
      const snap=await getDocs(collection(db,'projects',pid,sub));
      for(const d of snap.docs){
        await deleteDoc(doc(db,'projects',pid,sub,d.id));
      }
    }

    // Delete project document itself
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
      const trs=trees.filter(t=>treeInTour(t,tour.id)&&t.lat&&t.lng);
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
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  const trs=trees.filter(t=>treeInTour(t,tourId)&&t.lat&&t.lng);
  if(trs.length<1){notify('Keine Objekte in dieser Tour');return;}

  setSyncState('syncing','Route wird berechnet…');
  document.getElementById('route-spinner').classList.add('visible');
  document.getElementById('route-info-text').textContent='Route wird berechnet…';
  document.getElementById('route-info-bar').classList.add('visible');

  const depot=getDepot();
  const ordered=nearestNeighborTSP(trs,depot?.lat,depot?.lng);
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
  if(activeTourOnMap&&tourRoutes[activeTourOnMap]){
    const {km,durationSec}=tourRoutes[activeTourOnMap];
    const tour=tours.find(t=>t.id===activeTourOnMap);
    const cnt=trees.filter(t=>treeInTour(t,activeTourOnMap)&&t.lat&&t.lng).length;
    const depot=getDepot();
    const _bewT=fmtBewTime(cnt);
    const _totT=fmtTotalTime(durationSec,cnt);
    txt.textContent=`${tour?.name||''} · ${cnt} Objekte · ${km.toFixed(1)} km · ${fmtDuration(durationSec)} Fahrt + ${_bewT} Bew. = ${_totT}${depot?' (inkl. Depot)':''}`;
    bar.classList.add('visible');
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
  for(const [,order] of Object.entries(tourOrder)){
    const idx=order.indexOf(treeId);
    if(idx!==-1)return idx+1;
  }
  return null;
}

function makeMarker(tree){
  const treeTourIds=getTreeTourIds(tree);
  const tour=primaryTour(tree);
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
    .on('click',()=>{ if(assignMode&&!lassoDrawing) assignTreeToTour(tree.id,assignTourId); else if(!assignMode) openDetail(tree.id); })
    .on('contextmenu', e=>showTreeTourContextMenu(tree, e));
}

function setMarkerVisibility(){
  trees.forEach(tree=>{
    const m=mapMarkers[tree.id];if(!m)return;
    // filterTour='none' → only show trees without a tour
    if(filterTour==='none'){
      if(getTreeTourIds(tree).length===0) map.addLayer(m); else map.removeLayer(m);
    } else if(activeTourOnMap){
      if(treeInTour(tree,activeTourOnMap)) map.addLayer(m); else map.removeLayer(m);
    } else {
      map.addLayer(m);
    }
  });
}

function refreshMarkers(){
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));mapMarkers={};
  trees.forEach(tree=>{ if(isActive(tree)&&tree.lat&&tree.lng) mapMarkers[tree.id]=makeMarker(tree); });
  setMarkerVisibility();
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

// ─── TOUR FOCUS ───────────────────────────────────────────────
async function focusTour(tourId){
  // Toggle off if same tour clicked again
  if(activeTourOnMap===tourId){ activeTourOnMap=null;filterTour='all'; }
  else { activeTourOnMap=tourId;filterTour=tourId; }

  // Remove all existing route layers
  Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));
  tourRoutes={};

  if(activeTourOnMap){
    // Reihenfolge/Route nur laden wenn aktiviert
    if(getRoutePlanningEnabled()){
      try{
        const routeSnap=await getDoc(doc(db,'projects',currentProjectId,'routes',activeTourOnMap));
        if(routeSnap.exists){
          drawSavedRoute(activeTourOnMap,routeSnap.data());
        } else {
          const trs=trees.filter(t=>t.tourId===activeTourOnMap&&t.lat&&t.lng);
          const depot=getDepot();
          const ordered=nearestNeighborTSP(trs,depot?.lat,depot?.lng);
          tourOrder[activeTourOnMap]=ordered.map(t=>t.id);
          notify('Noch keine Route berechnet — Rechtsklick auf Karte zum Berechnen');
        }
      }catch(e){ console.warn('focusTour load error:',e); }
    }
    // Fit map to tour trees
    const trs=trees.filter(t=>t.tourId===activeTourOnMap&&t.lat&&t.lng);
    if(trs.length>0){
      const pts=trs.map(t=>[t.lat,t.lng]);
      // Include depot in bounds if set
      const depot=getDepot();
      if(depot?.lat&&depot?.lng) pts.push([depot.lat,depot.lng]);
      map.fitBounds(L.latLngBounds(pts),{padding:[60,60],maxZoom:16});
    }
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
function renderLegend(){
  const el=document.getElementById('tour-legend');if(!el)return;
  if(tours.length===0){el.style.display='none';return;}
  el.style.display='block';

  const activeTour=tours.find(t=>t.id===activeTourOnMap);

  // ── Header row: always visible ──────────────────────────────
  let html=`<div style="display:flex;align-items:center;gap:6px;padding:6px 14px;cursor:pointer;" data-action="toggle-legend">
    <span style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3);flex:1;">Touren</span>`;

  // Show active tour pill in header when collapsed
  if(activeTour){
    html+=`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:${activeTour.color};">
      <span style="width:14px;height:3px;border-radius:2px;background:${activeTour.color};display:inline-block;"></span>
      ${activeTour.name}
      ${tourRoutes[activeTour.id]?'· '+tourRoutes[activeTour.id].km.toFixed(1)+' km':''}
    </span>`;
  } else {
    html+=`<span style="font-size:11px;color:var(--text3);">${tours.length} Touren</span>`;
  }
  const isOpen=el.dataset.open!=='false';
  html+=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--text3);transition:transform .2s;transform:rotate(${isOpen?'180':'0'}deg);flex-shrink:0;"><path d="M6 9l6 6 6-6"/></svg>
  </div>`;

  // ── Collapsible body ─────────────────────────────────────────
  html+=`<div id="legend-body" style="display:${isOpen?'block':'none'};">`;

  // Tour rows — compact
  html+=`<div style="padding:0 8px 4px;">`;
  tours.forEach(t=>{
    const km=tourRoutes[t.id]?tourRoutes[t.id].km.toFixed(1):'–';
    const isActive=activeTourOnMap===t.id;
    html+=`<div class="legend-item${isActive?' active-tour':''}" data-tourid="${t.id}" style="padding:3px 6px;margin-bottom:1px;">
      <div class="legend-line" style="background:${t.color};width:16px;height:3px;"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${t.name}</span>
      <span class="legend-km" style="font-size:10px;">${km} km</span>
      ${isActive?`<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" style="color:var(--green);flex-shrink:0;margin-left:2px;"><path d="M20 6L9 17l-5-5"/></svg>`:''}
    </div>`;
  });
  // All tours row — aktiv nur wenn weder Tour-Fokus noch 'none'-Filter
  html+=`<div class="legend-item${(!activeTourOnMap&&filterTour!=='none')?' active-tour':''}" data-tourid="__all__" style="padding:3px 6px;margin-top:2px;border-top:1px solid var(--border);">
    <div style="width:16px;height:3px;border-radius:2px;background:#ccc;flex-shrink:0;"></div>
    <span style="color:var(--text3);flex:1;font-size:12px;">Alle anzeigen</span>
  </div>`;
  // Nicht verplant — Objekte ohne Tour
  const unplannedCount=trees.filter(t=>isActive(t)&&getTreeTourIds(t).length===0).length;
  html+=`<div class="legend-item${filterTour==='none'?' active-tour':''}" data-tourid="__none__" style="padding:3px 6px;">
    <div style="width:16px;height:3px;border-radius:2px;background:repeating-linear-gradient(90deg,#9c9890 0 3px,transparent 3px 6px);flex-shrink:0;"></div>
    <span style="color:var(--text3);flex:1;font-size:12px;">Nicht verplant</span>
    <span class="legend-km" style="font-size:10px;">${unplannedCount}</span>
  </div>`;
  html+=`</div>`;

  // Route berechnen button — compact
  if(activeTourOnMap){
    html+=`<div style="padding:4px 8px 8px;">
      <button data-action="calc-active" style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--green);color:#fff;border:none;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
        Route berechnen
      </button>
    </div>`;
  } else {
    html+=`<div style="padding:4px 8px 8px;">
      <button data-action="calc-all" style="width:100%;padding:5px 10px;font-size:11px;font-weight:600;background:var(--surface2);color:var(--text2);border:1px solid var(--border);border-radius:6px;cursor:pointer;">
        Alle Routen berechnen
      </button>
    </div>`;
  }
  html+=`</div>`; // end legend-body

  el.innerHTML=html;

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
      else if(tid==='__none__')setFilter('none');
      else focusTour(tid);
      return;}
    const btn=e.target.closest('[data-action]');
    if(btn){
      if(btn.dataset.action==='calc-active'&&activeTourOnMap)calculateAndSaveRoute(activeTourOnMap);
      else if(btn.dataset.action==='calc-all')calculateAllRoutes();
    }
  };
}

// ─── LIST ─────────────────────────────────────────────────────
function renderFilters(){} // removed — legend handles filtering
function setFilter(f,el){
  document.querySelectorAll('.filter-chip').forEach(c=>c.classList.remove('active'));
  el?.classList.add('active');
  if(f==='none'){
    // Show only trees without tour — deactivate tour focus, apply none filter
    activeTourOnMap=null;
    filterTour='none';
    Object.values(tourRoutes).forEach(r=>map.removeLayer(r.layer));tourRoutes={};
    setMarkerVisibility();
    renderList();
    renderLegend();
    document.getElementById('sidebar-route-info').classList.remove('visible');
    document.getElementById('route-info-bar').classList.remove('visible');
    // Auf nicht verplante Objekte zoomen — robust gegen Ausreißer (5.–95. Perzentil)
    const unplanned=trees.filter(t=>isActive(t)&&getTreeTourIds(t).length===0&&t.lat&&t.lng);
    if(unplanned.length>0){
      const lats=unplanned.map(t=>t.lat).sort((a,b)=>a-b);
      const lngs=unplanned.map(t=>t.lng).sort((a,b)=>a-b);
      const q=(arr,p)=>arr[Math.min(arr.length-1,Math.max(0,Math.floor(arr.length*p)))];
      map.fitBounds(L.latLngBounds([[q(lats,0.05),q(lngs,0.05)],[q(lats,0.95),q(lngs,0.95)]]),
        {padding:[60,60],maxZoom:15});
    }
  } else if(f==='all'){
    activeTourOnMap=null;
    filterTour='all';
    setMarkerVisibility();
    loadSavedRoutes();
    renderList();
    renderLegend();
  } else {
    focusTour(f);
  }
}

function renderList(){
  const q=document.getElementById('search-input')?.value.toLowerCase()||'';
  let filtered=trees.filter(t=>{
    const mq=!q||t.name?.toLowerCase().includes(q)||(t.art||'').toLowerCase().includes(q);
    const mf=filterTour==='all'||treeInTour(t,filterTour)||(filterTour==='none'&&isActive(t)&&getTreeTourIds(t).length===0);
    return mq&&mf;
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
      const primaryT=treeTours[0]||null;
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

function selectTree(id){
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

  if(tree.lat&&tree.lng){
    // Always pan — delay only if we just switched views (map needs to render first)
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
      <div style="font-size:11px;color:#16a34a;margin-top:2px;">Bewässert</div>
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
      const label = isNicht ? 'Nicht bewässert' : 'Bewässert';
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

async function assignTreeToTour(treeId,tourId,skipConflictCheck=false){
  const tree=trees.find(t=>t.id===treeId);
  const tour=tours.find(t=>t.id===tourId);
  if(!tree)return;

  // Conflict check: already in a different tour?
  const currentIds=getTreeTourIds(tree);
  if(currentIds.includes(tourId)){
    notify(`${tree.name} ist bereits in ${tour?.name||'Tour'}`);
    return;
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
  if(activeTourOnMap===id){activeTourOnMap=null;filterTour='all';}
  routeCache={};notify('Tour gelöscht');
}

// ─── SETTINGS ─────────────────────────────────────────────────

function getRoutePlanningEnabled(){
  const v = localStorage.getItem('bwt_route_planning');
  return v === null ? true : v === 'true';
}

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
}

function openSettings(){
  // Hide bottom route bar to avoid overlap
  document.getElementById('route-info-bar')?.classList.remove('visible');
  const depot=getDepot();
  document.getElementById('s-apikey').value=getOrsKey();
  document.getElementById('s-depot-addr').value=depot?.address||'';
  document.getElementById('s-depot-lat').value=depot?.lat||'';
  document.getElementById('s-depot-lng').value=depot?.lng||'';
  document.getElementById('s-depot-mode').value=getDepotMode();
  const _routeOn = getRoutePlanningEnabled();
  const _rtBtn = document.getElementById('s-toggle-route');
  if(_rtBtn){ _rtBtn.style.background = _routeOn ? '#2d6a4f' : '#d1d5db'; }
  const _rtKnob = document.getElementById('s-toggle-knob');
  if(_rtKnob) _rtKnob.style.transform = _routeOn ? 'translateX(16px)' : 'translateX(0)';
  const _rtSub = document.getElementById('s-routing-sub');
  if(_rtSub){ _rtSub.style.opacity = _routeOn ? '1' : '0.4'; _rtSub.style.pointerEvents = _routeOn ? '' : 'none'; }
  document.getElementById('s-project-name').value=currentProjectData?.name||'';
  document.getElementById('s-bew-duration').value=getBewDuration();
  loadReasons();
  renderDriverAssignment();
  const el=document.getElementById('depot-status');
  el.textContent=depot?.lat?`✓ ${depot.address||depot.lat.toFixed(5)+', '+depot.lng.toFixed(5)}`:'Noch kein Betriebshof gesetzt';
  el.style.color=depot?.lat?'var(--green)':'var(--text3)';
  document.getElementById('geocode-result').style.display='none';
  document.getElementById('geocode-error').style.display='none';
  document.getElementById('settings-panel').classList.add('open');
}
function closeSettings(){
  // Restore route bar
  updateRouteInfoBar(); document.getElementById('settings-panel').classList.remove('open'); }

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
    orsKey:document.getElementById('s-apikey').value.trim(),
    depotMode:document.getElementById('s-depot-mode').value,
    name:document.getElementById('s-project-name').value.trim()||currentProjectData.name,
  };
  if(lat&&lng) updates.depot={lat,lng,address:addr||`${lat.toFixed(5)}, ${lng.toFixed(5)}`};
  await saveProjectSettings(updates);
  localStorage.setItem('bwt_ors_key',updates.orsKey);
  document.getElementById('active-project-name').textContent=updates.name;
  closeSettings();renderDepotMarker();
  await loadSavedRoutes();
  notify('Einstellungen gespeichert — Route neu berechnen wenn gewünscht');
}

// ─── VIEWS ────────────────────────────────────────────────────
function switchView(v){
  currentView=v;
  // Nav buttons
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.querySelector(`.nav-btn[onclick="switchView('${v}')"]`).classList.add('active');
  // Show/hide fullscreen overlays
  const baeume=document.getElementById('view-baeume');
  const touren=document.getElementById('view-touren');
  const controlling=document.getElementById('view-controlling');
  const dashboard=document.getElementById('view-dashboard');
  const verwaltung=document.getElementById('view-verwaltung');
  if(baeume) baeume.style.display=v==='baeume'?'flex':'none';
  if(touren) touren.style.display=v==='touren'?'block':'none';
  if(controlling) controlling.style.display=v==='controlling'?'flex':'none';
  if(dashboard) dashboard.style.display=v==='dashboard'?'flex':'none';
  if(verwaltung) verwaltung.style.display=v==='verwaltung'?'block':'none';
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
    initControlling();
    updateCtrlLastUpdated();
  }
  if(v==='dashboard') initDashboard(); // einmaliges Laden; danach nur per Refresh-Button
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
  if(countEl)countEl.textContent=`${tours.length} Touren`;

  grid.innerHTML=tours.map(tour=>{
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
          <button class="btn btn-primary" style="padding:3px 9px;font-size:11px;" data-action="route" data-tid="${tour.id}">Route</button>
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
  if(!currentProjectId)return;
  await loadReasons();
  // Auto-seed standard reasons if none exist yet
  if(reasons.length===0){
    const defaults=[
      'Zugang gesperrt',
      'Baum krank / abgestorben',
      'Gerät defekt',
      'Kein Wasser verfügbar',
      'Baum bereits bewässert',
      'Baum nicht auffindbar',
      'Witterung (Starkregen)',
      'Sonstiges',
    ];
    for(const text of defaults){
      await addDoc(collection(db,'projects',currentProjectId,'reasons'),{text,createdAt:serverTimestamp()});
    }
    await loadReasons();
    notify('Standard-Gründe wurden angelegt');
  }
  renderDriverMgmt();
  renderReasonsMgmt();
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
    el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px 0 8px;">Noch keine Gründe. Standard-Gründe werden in der App verwendet.</div>';return;
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

// ─── EXCEL IMPORT ────────────────────────────────────────────
async function importExcel(input){
  if(!currentProjectId){notify('Bitte zuerst ein Projekt öffnen');return;}
  const file=input.files[0];if(!file)return;
  notify('Excel wird eingelesen…');
  // Use SheetJS via CDN
  const XLSX=window.XLSX;
  if(!XLSX){notify('SheetJS nicht geladen');return;}
  const data=await file.arrayBuffer();
  const wb=XLSX.read(data,{type:'array'});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1});
  // Skip header row (row 0)
  let imported=0,skipped=0;
  for(let i=1;i<rows.length;i++){
    const row=rows[i];
    if(!row||row.length<1)continue;
    const lat=parseFloat(row[7]);
    const lng=parseFloat(row[8]);
    // Koordinaten optional — Objekte ohne GPS werden trotzdem importiert
    const treeData={
      name:row[0]||'Unbekannt',
      stadtteil:row[1]||'',
      art:row[2]||'',
      baumnr:row[3]?.toString()||'',
      pflanzjahr:row[4]?.toString()||'',
      pflanzzeitpunkt:row[5]?.toString()||'',
      notiz:row[6]||'',
      lat:isNaN(lat)?null:lat,
      lng:isNaN(lng)?null:lng,
      wasser:'mittel',zustand:'mittel',
      datum:'',tourId:'',tourIds:[],history:[],
    };
    try{
      const baumId=await getNextBaumId();
      await addDoc(collection(db,'projects',currentProjectId,'trees'),{...treeData,baumId,createdAt:serverTimestamp()});
      imported++;
    }catch(e){skipped++;}
  }

  input.value='';
  notify(`✓ ${imported} Objekte importiert${skipped>0?' ('+skipped+' übersprungen)':''}`);
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
      entries:snap.docs.map(d=>({id:d.id,...d.data()}))
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
    const mon=new Date(today);mon.setDate(today.getDate()-today.getDay()+1);
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
  if(fStatus) activeFilters.push(`Status: ${{bewaessert:'✓ Bewässert',nicht:'✕ Nicht bewässert',offen:'○ Offen'}[fStatus]}`);
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
    {val:bewaessert.length,lbl:'Bewässert',sub:`${pct}% der Meldungen`,color:'#16a34a'},
    {val:nicht.length,lbl:'Nicht bewässert',sub:'Einzelmeldungen',color:'var(--red)'},
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
  renderTimelineChart(filtered,from,to);
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
      labels:['Bewässert','Nicht bewässert'],
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
        {label:'Bewässert',data:Object.values(tourMap).map(t=>t.bew),backgroundColor:'#16a34a',borderRadius:4},
        {label:'Nicht bewässert',data:Object.values(tourMap).map(t=>t.nicht),backgroundColor:'#991b1b',borderRadius:4},
      ]
    },
    options:{responsive:false,plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:8}}},
      scales:{x:{stacked:true,ticks:{font:{size:11}}},y:{stacked:true,ticks:{font:{size:11},stepSize:1}}}}
  });
}

function renderTimelineChart(filtered,from,to){
  destroyChart('timeline');
  const canvas=document.getElementById('ctrl-timeline');if(!canvas||!window.Chart)return;
  // Build daily buckets
  const days={};
  const cur=new Date(from);
  while(cur<=to){
    days[cur.toISOString().slice(0,10)]={bew:0,nicht:0};
    cur.setDate(cur.getDate()+1);
  }
  filtered.forEach(tree=>{
    if(!tree.lastReportAt)return;
    const d=tree.lastReportAt.slice?tree.lastReportAt.slice(0,10):tree.lastReportAt;
    if(!days[d])return;
    if(tree.lastStatus==='bewaessert')days[d].bew++;
    else if(tree.lastStatus==='nicht')days[d].nicht++;
  });
  // Also scan history
  filtered.forEach(tree=>{
    (tree.history||[]).forEach(h=>{
      if(!h.date||!days[h.date])return;
      if(h.note&&h.note.includes('Bewässert'))days[h.date].bew++;
    });
  });
  const labels=Object.keys(days).map(d=>{const dt=new Date(d);return `${dt.getDate()}.${dt.getMonth()+1}.`;});
  ctrlCharts['timeline']=new Chart(canvas,{
    type:'line',
    data:{
      labels,
      datasets:[
        {label:'Bewässert',data:Object.values(days).map(d=>d.bew),borderColor:'#16a34a',backgroundColor:'rgba(22,163,74,.1)',fill:true,tension:.3,pointRadius:3},
        {label:'Nicht bewässert',data:Object.values(days).map(d=>d.nicht),borderColor:'#991b1b',backgroundColor:'rgba(153,27,27,.07)',fill:true,tension:.3,pointRadius:3},
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
        {label:'Bewässert',data:labels.map(l=>map[l].bew),backgroundColor:'#16a34a',borderRadius:3},
        {label:'Nicht bewässert',data:labels.map(l=>map[l].nicht),backgroundColor:'#991b1b',borderRadius:3},
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
      ?'<span style="color:#16a34a;font-weight:600;">✓ Bewässert</span>'
      :st==='nicht'
      ?'<span style="color:var(--red);font-weight:600;">✕ Nicht bewässert</span>'
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
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
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

async function showHistoryDetail(histId){
  if(!historyCache[histId]){
    const snap=await getDoc(doc(db,'projects',currentProjectId,'tourHistory',histId));
    historyCache[histId]={id:snap.id,...snap.data()};
  }
  const h=historyCache[histId];
  const existing=document.getElementById('history-modal');
  if(existing)existing.remove();
  const modal=document.createElement('div');
  modal.id='history-modal';
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;padding:20px;';

  const statusOpts=['bewaessert','nicht'].map(s=>
    `<option value="${s}">${s==='bewaessert'?'✓ Bewässert':'✕ Nicht bewässert'}</option>`
  ).join('');

  const rows=h.trees.map((t,ti)=>{
    const st=t.lastStatus;
    const stSel=`<select data-ti="${ti}" class="hist-status-sel" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);">
      <option value="">○ Offen</option>
      <option value="bewaessert"${st==='bewaessert'?' selected':''}>✓ Bewässert</option>
      <option value="nicht"${st==='nicht'?' selected':''}>✕ Nicht bewässert</option>
    </select>`;
    const reasonInp=`<input data-ri="${ti}" class="hist-reason-inp" value="${t.lastReason||''}" placeholder="Grund…" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:4px;width:100%;background:var(--bg);">`;
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
        <div style="font-size:12px;color:var(--text3);">Fahrer: ${h.closedBy||'–'} · ${h.stats?.bewaessert||0} bewässert · ${h.stats?.nicht||0} nicht</div>
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

async function saveHistoryEdits(histId){
  const btn=document.getElementById('hist-save-btn');
  if(btn){btn.textContent='Speichert…';btn.disabled=true;}
  const h=historyCache[histId];
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
  notify('✓ Historie gespeichert');
  document.getElementById('history-modal')?.remove();
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
  const h=historyCache[histId];
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

  // Split into conflict (already in another tour) vs clean
  const conflicts=selected.filter(t=>getTreeTourIds(t).length>0&&!treeInTour(t,tourId));
  const clean=selected.filter(t=>getTreeTourIds(t).length===0||treeInTour(t,tourId));

  let toAssign=[...clean];

  if(conflicts.length>0){
    const confirmed=await showLassoConflictDialog(conflicts,tour?.name||'');
    if(confirmed) toAssign=[...toAssign,...conflicts];
  }

  if(toAssign.length===0){notify('Keine Objekte zugewiesen');return;}

  setSyncState('syncing',`${toAssign.length} Objekte werden zugewiesen…`);
  for(const tree of toAssign){
    const newIds=[...new Set([...getTreeTourIds(tree),tourId])];
    await setTreeTourIds(tree.id,newIds);
  }
  setSyncState('ok','Synchronisiert');
  notify(`✓ ${toAssign.length} Objekte → ${tour?.name||'Tour'}`);
}

// cancelLasso merged into cancelAssign

// ─── CONFLICT DIALOGS ────────────────────────────────────────
function showConflictDialog(treeName, fromTour, toTour){
  return new Promise(resolve=>{
    // Use custom modal instead of browser confirm for better UX
    const existing=document.getElementById('conflict-modal');
    if(existing)existing.remove();
    const modal=document.createElement('div');
    modal.id='conflict-modal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML=`<div style="background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:380px;max-width:90vw;overflow:hidden;">
      <div style="padding:18px 20px 10px;border-bottom:1px solid #ddd9d0;">
        <div style="font-size:15px;font-weight:600;color:#1a1917;">Baum bereits verplant</div>
      </div>
      <div style="padding:16px 20px;font-size:13px;color:#6b6760;line-height:1.6;">
        <b style="color:#1a1917;">${treeName}</b> ist bereits der Tour <b style="color:#1a1917;">${fromTour}</b> zugewiesen.<br>
        Trotzdem zu <b style="color:#1a1917;">${toTour}</b> verschieben?
      </div>
      <div style="padding:12px 20px;border-top:1px solid #ddd9d0;display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('conflict-modal').remove();window._conflictResolve(false);" style="padding:7px 14px;border:1px solid #c8c3b8;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Überspringen</button>
        <button onclick="document.getElementById('conflict-modal').remove();window._conflictResolve(true);" style="padding:7px 14px;border:none;border-radius:6px;background:#2d6a4f;color:#fff;cursor:pointer;font-size:13px;font-weight:500;">Trotzdem zuweisen</button>
      </div>
    </div>`;
    window._conflictResolve=resolve;
    document.body.appendChild(modal);
  });
}

function showLassoConflictDialog(conflicts, toTour){
  return new Promise(resolve=>{
    const existing=document.getElementById('conflict-modal');
    if(existing)existing.remove();
    const modal=document.createElement('div');
    modal.id='conflict-modal';
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:9998;display:flex;align-items:center;justify-content:center;';
    const names=conflicts.slice(0,3).map(t=>t.name).join(', ')+(conflicts.length>3?` +${conflicts.length-3} weitere`:'');
    modal.innerHTML=`<div style="background:#fff;border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.18);width:400px;max-width:90vw;overflow:hidden;">
      <div style="padding:18px 20px 10px;border-bottom:1px solid #ddd9d0;">
        <div style="font-size:15px;font-weight:600;color:#1a1917;">${conflicts.length} Objekte bereits verplant</div>
      </div>
      <div style="padding:16px 20px;font-size:13px;color:#6b6760;line-height:1.6;">
        Folgende Objekte sind bereits anderen Touren zugewiesen:<br>
        <b style="color:#1a1917;">${names}</b><br><br>
        Sollen diese trotzdem zu <b style="color:#1a1917;">${toTour}</b> verschoben werden?
      </div>
      <div style="padding:12px 20px;border-top:1px solid #ddd9d0;display:flex;gap:8px;justify-content:flex-end;">
        <button onclick="document.getElementById('conflict-modal').remove();window._conflictResolve(false);" style="padding:7px 14px;border:1px solid #c8c3b8;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">Nur freie zuweisen</button>
        <button onclick="document.getElementById('conflict-modal').remove();window._conflictResolve(true);" style="padding:7px 14px;border:none;border-radius:6px;background:#2d6a4f;color:#fff;cursor:pointer;font-size:13px;font-weight:500;">Alle zuweisen</button>
      </div>
    </div>`;
    window._conflictResolve=resolve;
    document.body.appendChild(modal);
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
  if(activeTourOnMap){
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
  const grid=document.getElementById('dash-kpi-grid');
  if(grid) grid.innerHTML=[
    {val:trees.filter(isActive).length,lbl:'Bäume gesamt',sub:'im Projekt',color:'var(--text)'},
    {val:bew.length,lbl:'Bewässert',sub:`${pct}% der Meldungen`,color:'var(--green)'},
    {val:nicht.length,lbl:'Nicht bewässert',sub:'im Zeitraum',color:'var(--red)'},
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

function dashRenderTourProgress(reported){
  const el=document.getElementById('dash-tour-progress'); if(!el)return;
  if(tours.length===0){ el.innerHTML='<div class="dsh-empty">Keine Touren angelegt</div>'; return; }
  const tourIdsByTreeId={}; trees.forEach(x=>{ tourIdsByTreeId[x.id]=getTreeTourIds(x); });
  const repTourIds=(r)=>{ if(r._tourId)return[r._tourId]; const live=tourIdsByTreeId[r.id]; if(live&&live.length)return live; return getTreeTourIds(r); };
  el.innerHTML=tours.map(t=>{
    const total=trees.filter(x=>treeInTour(x,t.id)&&isActive(x)).length;
    const rep=reported.filter(r=>repTourIds(r).includes(t.id));
    const bewIds=new Set(rep.filter(r=>r.lastStatus==='bewaessert').map(r=>r.id));
    const nichtIds=new Set(rep.filter(r=>r.lastStatus==='nicht'&&!bewIds.has(r.id)).map(r=>r.id));
    const bewN=bewIds.size,nichtN=nichtIds.size;
    const offen=Math.max(0,total-bewN-nichtN);
    const base=Math.max(total,bewN+nichtN,1);
    const bewW=bewN/base*100,nichtW=nichtN/base*100,offenW=offen/base*100;
    const pct=total>0?Math.round(bewN/total*100):(bewN+nichtN>0?Math.round(bewN/(bewN+nichtN)*100):0);
    const color=t.color||TOUR_COLORS[0];
    return `<div class="dsh-tour-row">
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
        <span style="margin-left:auto;">${total} Bäume</span>
      </div>
    </div>`;
  }).join('');
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
  const countEl=document.getElementById('dash-map-count'); if(countEl) countEl.textContent=uniq.length>0?`${uniq.length} Bäume`:'';
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
      {label:'Bewässert', data:order.map(k=>buckets[k].bew), borderColor:'#16a34a', backgroundColor:'rgba(22,163,74,.12)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
      {label:'Nicht bewässert', data:order.map(k=>buckets[k].nicht), borderColor:'#dc2626', backgroundColor:'rgba(220,38,38,.08)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
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

Object.assign(window,{
  dashSetPeriod,renderDashboard,refreshDashboard,
  saveInlineFields,filterDetailTable,filterBaeumeTable,saveHistoryEdits,deleteHistoryEntry,refreshControlling,loadTourHistoryForControlling,loadErfasser,addErfasser,removeErfasser,addReason,deleteReason,saveDriverAssignment,setCtrlPeriod,renderControlling,exportCtrlCSV,initControlling,initVerwaltung,addDriver,removeDriver,addReasonMgmt,deleteReasonMgmt,loadTourHistory,showHistoryDetail,exportHistoryCSV,resetCtrlFilters,ctrlShowOnMap,
  importExcel,calculateAndSaveRoute,calculateAllRoutes,closeCtxMenu,ctxCalcActive,cancelAssign,setAssignTour,startAssignMode,rebuildAssignPills,
  createProject,openProject,showProjectScreen,
  switchView,openDetail,closePanel,logWatering,
  openAddTree,openEditTree,closeTreeModal,saveTree,deleteTree,
  archiveTree,reactivateTree,archiveTreeFromModal,reactivateTreeFromModal,deleteTreeFromModal,toggleShowInactive,showTreeOnMapFromModal,
  openTourModal,closeTourModal,saveTour,deleteTour,
  focusTour,focusTourAndSwitch,
  startPlacement,cancelMode,setDepotOnMap,
  startAssignMode,setAssignTour,cancelAssign,assignTreeToTour,
  openSettings,closeSettings,geocodeDepot,applySettings,confirmDeleteProject,
  setFilter,pickColor,renderList,
  toggleLassoMode,switchDetailTab,toggleRoutePlanning,setLassoTour,
  startGpsPlacement,toggleFilterNoGps,updateBtnFilterNoGps,
  saveFieldLabels, migrateTourIds,
});

initProjectScreen();

(()=>{ const el=document.getElementById('app-version'); if(el) el.textContent=`Version ${APP_VERSION}`; })();