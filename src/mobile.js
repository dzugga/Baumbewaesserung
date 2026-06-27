import { initAppCheck } from './appcheck.js';
import { installErrorHandler } from './errlog.js'; installErrorHandler('mobil');
import { BASEMAP_FARBE, BASEMAP_ATTR } from './basemaps.js';
import { firebaseConfig } from './firebase-config.js';
import { esc } from './esc.js';
import { titelOf, typOf, buildContainerIndex, klasseFelderOf } from './objektrollen.js';
import { startSession, endSession } from './session.js';
// Container-Index (extId→Abschnitt) für die Anzeige-Rollen; aus dem vollen Projekt-Snapshot gebaut.
let _objIndex = null;
function _setObjIndex(objs){ _objIndex = buildContainerIndex(objs); }
function _getContainer(extId){ return _objIndex ? _objIndex.getContainer(extId) : null; }
function _onSessionKicked(){ try{ alert('Abgemeldet: Diese Kennung wurde an einem anderen Gerät angemeldet.'); }catch(_){}; try{ firebase.auth().signOut(); }catch(_){}; location.reload(); }
// Firebase compat API shims — maps modular API calls to compat SDK
function initializeApp(cfg){ return firebase.initializeApp(cfg); }
function getFirestore(app){ return firebase.firestore(app); }

// collection(db, 'col') or collection(db, 'col', 'id', 'subcol')
function collection(db, ...segs){
  // segs alternates: col, docId, col, docId ... ending on col
  let ref = db;
  for(let i=0;i<segs.length;i++){
    ref = (i%2===0) ? ref.collection(segs[i]) : ref.doc(segs[i]);
  }
  return ref;
}

// doc(db, 'col', 'id') or doc(db, 'col', 'id', 'subcol', 'id2')
function doc(db, ...segs){
  let ref = db;
  for(let i=0;i<segs.length;i++){
    ref = (i%2===0) ? ref.collection(segs[i]) : ref.doc(segs[i]);
  }
  return ref;
}

function getDoc(ref){ return ref.get(); }
function getDocs(ref){ return ref.get(); }
function updateDoc(ref, data){ return ref.update(data); }
// Hängt orgId automatisch an Dokumente innerhalb projects/{id}/<sub>/… (für Rules)
function _injectOrg(ref, data){
  if(!data || typeof data!=='object' || Array.isArray(data) || data.orgId!==undefined) return data;
  const path = ref && ref.path || '';
  if(/^projects\/[^/]+\/.+/.test(path) && typeof currentProjectData!=='undefined' && currentProjectData && currentProjectData.orgId)
    return {...data, orgId: currentProjectData.orgId};
  return data;
}
function addDoc(ref, data){ return ref.add(_injectOrg(ref, data)); }
function setDoc(ref, data, opts){ data=_injectOrg(ref, data); return opts ? ref.set(data, opts) : ref.set(data); }
function deleteDoc(ref){ return ref.delete(); }
function onSnapshot(ref, cb){ return ref.onSnapshot(cb); }
function serverTimestamp(){ return firebase.firestore.FieldValue.serverTimestamp(); }
function query(ref){ return ref; }
function orderBy(field, dir='asc'){ return ref => ref.orderBy(field, dir); }

const fbApp = initializeApp(firebaseConfig);
initAppCheck();
const db = getFirestore(fbApp);

// ─── NAVIGATIONS-/KARTEN-ENDPUNKTE ────────────────────────────
// Routing über OpenRouteService (eigener Mandanten-Key, DSGVO-freundlich, Server in DE) –
// statt des öffentlichen OSRM-Demo-Servers. Key kommt aus dem Login (orsKey am Mandanten).
const NAVI_ORS_BASE = 'https://api.openrouteservice.org/v2/directions/driving-car/geojson';
const NAVI_TILE_URL  = BASEMAP_FARBE; // amtliche basemap.de (statt OSM-Kachelserver)
// ORS-Manövertyp (numerisch) → OSRM-ähnliche {type,mod} für die Pfeil-/Banner-Logik (naviArrow bleibt unverändert)
const _ORS_TYPE = { 0:{mod:'left'}, 1:{mod:'right'}, 2:{mod:'sharp left'}, 3:{mod:'sharp right'},
  4:{mod:'slight left'}, 5:{mod:'slight right'}, 6:{mod:'straight',type:'continue'}, 7:{type:'roundabout'},
  8:{type:'roundabout'}, 9:{mod:'uturn'}, 10:{type:'arrive'}, 11:{type:'depart'}, 12:{mod:'slight left'}, 13:{mod:'slight right'} };
let _orsKey = (()=>{ try{ return localStorage.getItem('bwt_ors_key')||''; }catch(_){ return ''; } })();
// Eine ORS-Directions-Anfrage. pts=[[lat,lng],…]. Liefert {geom:[lat,lng][], steps[], segs[], total} oder null.
async function orsDirections(pts, withSteps){
  const key=_orsKey || (currentProjectData&&currentProjectData.orsKey) || '';
  if(!key || !pts || pts.length<2) return null;
  const body={ coordinates:pts.map(p=>[p[1],p[0]]), language:'de', instructions:!!withSteps, units:'m' };
  const r=await fetch(NAVI_ORS_BASE,{ method:'POST', headers:{ 'Authorization':key, 'Content-Type':'application/json' }, body:JSON.stringify(body) });
  if(!r.ok) throw new Error('ORS '+r.status);
  const j=await r.json(); const f=j.features&&j.features[0]; if(!f) return null;
  const geom=(f.geometry.coordinates||[]).map(c=>[c[1],c[0]]);
  const props=f.properties||{}, sum=props.summary||{};
  const segs=(props.segments||[]).map(s=>({ dist:s.distance||0, dur:s.duration||0 }));
  const steps=[];
  if(withSteps) (props.segments||[]).forEach(seg=>(seg.steps||[]).forEach(st=>{
    const m=_ORS_TYPE[st.type]||{}, wp=(st.way_points&&st.way_points[0])||0;
    steps.push({ instr:st.instruction||'', loc:geom[wp]||geom[0], type:m.type||'turn', mod:m.mod||'', dist:st.distance||0, dur:st.duration||0, lanes:[] });
  }));
  return { geom, steps, segs, total:{ dist:sum.distance||0, dur:sum.duration||0 } };
}

// ─── STATE ────────────────────────────────────────────────────
let currentDriver = null;
let currentProjectData = null;
// Füllgrad-Stufen (je Projekt aktivierbar; v = Prozent für die Dispo-Lernlogik)
const FUELLGRAD_OPTS = [{v:0,l:'leer'},{v:25,l:'25 %'},{v:50,l:'50 %'},{v:75,l:'75 %'},{v:100,l:'voll'},{v:120,l:'übervoll'}];
function fgLabel(v){ const o=FUELLGRAD_OPTS.find(x=>x.v===v); return o?o.l:''; }
// Zustand/Priorität-Wertelisten aus dem Projekt (gleiche wie Desktop) mit Standard-Fallback
const RANK_SEED_M = {
  zustand:[{id:'gut',label:'Gut'},{id:'mittel',label:'Mittel'},{id:'schlecht',label:'Schlecht'}],
  wasser:[{id:'gering',label:'Gering'},{id:'mittel',label:'Mittel'},{id:'hoch',label:'Hoch'}],
};
function _rankM(fk){ const l=currentProjectData?.listValues?.[fk]; return (l&&l.length)?[...l].sort((a,b)=>(a.rang||0)-(b.rang||0)):(RANK_SEED_M[fk]||[]); }
function _rankOptsM(fk,cur){ return _rankM(fk).map(e=>`<option value="${esc(e.id)}"${cur===e.id?' selected':''}>${esc(e.label)}</option>`).join(''); }
function _flM(fk,def){ return (currentProjectData?.fieldLabels?.[fk])||def; }
// Welche Stammdaten-Felder das Detail der Fahrer-App zeigt (projekt-konfigurierbar am Projekt-Doc).
const _MOBIL_INFO_DEFLBL={baumnr:'Objektnummer',art:'Typ / Art',stadtteil:'Stadtteil',pflanzjahr:'Jahr',pflanzzeitpunkt:'Zeitpunkt',zustand:'Zustand',wasser:'Priorität',notiz:'Notiz'};
function _mobilInfoFields(){
  const cfg=currentProjectData?.mobilFelder;
  if(Array.isArray(cfg)) return cfg;  // explizit konfiguriert (auch leer = absichtlich nichts)
  return ['baumnr','art','pflanzjahr','pflanzzeitpunkt', ...((currentProjectData?.customFields||[]).map(c=>c.key))];
}
function _mobilFieldLabel(key){
  const cf=(currentProjectData?.customFields||[]).find(c=>c.key===key);
  if(cf) return cf.label||key;
  return _flM(key, _MOBIL_INFO_DEFLBL[key]||key);
}
function _mobilFieldVal(tree,key){
  if(key==='zustand'||key==='wasser'){ const e=_rankM(key).find(x=>x.id===tree[key]); return e?e.label:(tree[key]||'–'); }
  const v=tree[key]; return (v!=null&&v!=='')?String(v):'–';
}
function _mobilInfoRows(tree){
  const kf=klasseFelderOf(tree, currentProjectData?.objektklassen);
  return _mobilInfoFields().filter(key=>!kf||kf.includes(key)).map(key=>{
    const it=key==='art'?' style="font-style:italic;"':'';
    return `<div class="field-row"><span class="field-key">${esc(_mobilFieldLabel(key))}</span><span class="field-val"${it}>${esc(_mobilFieldVal(tree,key))}</span></div>`;
  }).join('');
}
let currentProjectId = null;
let currentTourId = null;
let currentTour = null;
let trees = [];
let routeOrder = []; // ordered tree ids
let reasons = [];    // not-watered reasons from Firestore
let selectedTreeId = null;
let currentTab = 'map';
let pauseSnapshot = false;
let unsubTrees = null;
let gpsMarker = null;
let gpsLatLng = null;
let mapMarkers = {};
let routeLayer = null;

// ─── MAP ──────────────────────────────────────────────────────
let map = null;
const NAVI_ROTATE_OK = !!(L.Map && L.Map.prototype && L.Map.prototype.setBearing);
function initMap(){
  if(map) return;
  const opts={zoomControl:false};
  if(NAVI_ROTATE_OK){ opts.rotate=true; opts.bearing=0; opts.rotateControl=false; opts.touchRotate=false; opts.shiftKeyRotate=false; }
  try{ map = L.map('map', opts); }
  catch(e){ map = L.map('map', {zoomControl:false}); }
  map.setView([51.05, 13.73], 14);
  L.tileLayer(NAVI_TILE_URL, {
    attribution: BASEMAP_ATTR,
    maxZoom: 20,
    maxNativeZoom: 18,
    keepBuffer: 8,
    updateWhenZooming: false,
    updateWhenIdle: false,
    crossOrigin: true,
  }).addTo(map);
  L.control.zoom({position: 'topright'}).addTo(map);
}

// GPS tracking
function startGPS() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(pos => {
    gpsLatLng = [pos.coords.latitude, pos.coords.longitude];
    if (!gpsMarker) {
      const icon = L.divIcon({
        className: '',
        html: '<div class="gps-dot"></div>',
        iconSize: [16, 16], iconAnchor: [8, 8]
      });
      gpsMarker = L.marker(gpsLatLng, {icon, zIndexOffset: 2000}).addTo(map);
    } else {
      gpsMarker.setLatLng(gpsLatLng);
    }
    if(naviActive){
      naviLastHeading=pos.coords.heading; naviLastSpeed=pos.coords.speed;
      naviUpdate(gpsLatLng);
    }
  }, err => {}, {enableHighAccuracy: true, maximumAge: 5000});
}

// ─── LOGIN ────────────────────────────────────────────────────
// Hide loading screen once app is ready
function hideLoading() {
  const el = document.getElementById('screen-loading');
  if(el) { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }
}

// Update loading status text
function setLoadingStatus(msg) {
  const el = document.getElementById('loading-status');
  if(el) el.textContent = msg;
}

async function loadProjects() {
  setLoadingStatus('Lade Projekte…');
  // Now handled by loadAllNames() — keep stub for compat
}


let _driverAuth = null;     // {orgId, name, driverId}
let _tourCandidates = [];
function _loginErr(msg){ const e=document.getElementById('login-error'); if(e){ e.textContent=msg; e.style.display='block'; } }
function _setLoginBtn(txt, disabled){ const b=document.getElementById('btn-login'), l=document.getElementById('btn-login-label'); if(l) l.textContent=txt; if(b) b.disabled=!!disabled; }

async function doLogin() {
  const errEl=document.getElementById('login-error'); if(errEl) errEl.style.display='none';
  const tourGroup=document.getElementById('login-tour-group');
  // Schritt 2: Tour gewählt → starten
  if(_driverAuth && tourGroup && tourGroup.style.display!=='none'){
    const tid=document.getElementById('login-tour').value;
    const cand=_tourCandidates.find(c=>c.tid===tid);
    if(!cand){ _loginErr('Bitte Tour wählen.'); return; }
    await startBewässerungLogin(_driverAuth.name, cand.pid, cand.tid);
    return;
  }
  // Schritt 1: Anmelden (Stadt/Code + Name + PIN)
  const orgcode=(document.getElementById('login-orgcode')?.value||'').trim();
  const name=(document.getElementById('login-name')?.value||'').trim();
  const pin=(document.getElementById('login-pin')?.value||'').trim();
  if(!name||!pin){ _loginErr('Bitte Name und PIN ausfüllen.'); return; }
  if(!/^\d{6}$/.test(pin)){ _loginErr('PIN muss 6-stellig sein.'); return; }
  _setLoginBtn('Anmelden…', true);
  try{
    const res=await firebase.app().functions('europe-west3').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(), name, pin, app:'mobil'});
    const data=res.data||{};
    await firebase.auth().signInWithCustomToken(data.token);
    startSession(data.sessionId, _onSessionKicked);
    _driverAuth={orgId:data.orgId, name:data.name||name, driverId:data.driverId};
    _naviEnabled=!!data.naviEnabled; // Mandanten-Flag (Superadmin) steuert die Navi-Funktion
    _orsKey=data.orsKey||''; // Routing-Key (ORS) des Mandanten
    try{ localStorage.setItem('bwt_mobile_orgcode',orgcode.toUpperCase()); localStorage.setItem('bwt_mobile_name',name); localStorage.setItem('bwt_navi_enabled', _naviEnabled?'1':''); localStorage.setItem('bwt_ors_key', _orsKey); }catch(_){}
    await pickTour(_driverAuth.orgId, _driverAuth.name);
  }catch(e){
    const code=e&&e.code||''; const msg=e&&e.message||'';
    if(/already-exists/.test(code)){ _loginErr(msg||'Diese Kennung ist bereits an einem anderen Gerät angemeldet.'); _setLoginBtn('Anmelden', false); return; }
    _loginErr(/permission-denied|not-found|unauthenticated|resource-exhausted/.test(code)||/PIN|falsch|Versuche/i.test(msg)
      ? (msg||'Name oder PIN falsch') : ('Fehler: '+(msg||code)));
    _setLoginBtn('Anmelden', false);
  }
}

async function pickTour(orgId, name){
  _tourCandidates=[];
  try{
    const projSnap=await db.collection('projects').where('orgId','==',orgId).get();
    // Tour-Abfragen parallel statt sequenziell (eine Wartezeit statt N bei mehreren Projekten je Stadt)
    const tourSnaps=await Promise.all(projSnap.docs.map(p=>p.ref.collection('tours').get()));
    projSnap.docs.forEach((p,i)=>{
      tourSnaps[i].forEach(t=>{
        const td=t.data();
        if(td.uebersicht) return; // Übersichtstouren sind keine echten Touren → nicht in der Fahrer-App
        const drivers=td.drivers||(td.assignedDriver?[td.assignedDriver]:[]);
        _tourCandidates.push({pid:p.id, tid:t.id, projectName:p.data().name||'', tourName:td.name||'', assigned:drivers.includes(name)});
      });
    });
  }catch(e){ _loginErr('Touren konnten nicht geladen werden: '+(e.message||e.code)); _setLoginBtn('Anmelden',false); return; }
  const assigned=_tourCandidates.filter(c=>c.assigned);
  const list=assigned.length?assigned:_tourCandidates;
  if(list.length===0){ _loginErr('Keine Tour in diesem Mandanten gefunden.'); _setLoginBtn('Anmelden',false); return; }
  if(list.length===1){ await startBewässerungLogin(name, list[0].pid, list[0].tid); return; }
  _tourCandidates=list;
  const sel=document.getElementById('login-tour');
  sel.innerHTML='<option value="">– Tour wählen –</option>'+list.map(c=>`<option value="${esc(c.tid)}">${esc(c.projectName)} · ${esc(c.tourName)}</option>`).join('');
  document.getElementById('login-tour-group').style.display='';
  ['lg-orgcode','lg-name','lg-pin'].forEach(id=>{ const g=document.getElementById(id); if(g) g.style.display='none'; });
  _setLoginBtn('Tour starten', false);
}

async function doLogout() {
  // Es gibt erfasste Meldungen, aber die Tour ist noch nicht abgeschlossen → erst abschließen
  const hatMeldungen = Array.isArray(trees) && trees.some(t=>t.lastStatus);
  const tourOffen = currentTour && currentTour.status!=='abgeschlossen';
  if(hatMeldungen && tourOffen){
    if(confirm('Die Tour ist noch nicht abgeschlossen.\n\nOK = Tour jetzt abschließen\nAbbrechen = ohne Abschluss abmelden')){
      showFinishConfirm();
      return; // nicht abmelden — Fahrer schließt erst ab
    }
    if(!confirm('Wirklich OHNE Tour-Abschluss abmelden? Die Tour erscheint dann nicht in der Auswertung.')) return;
  } else {
    if (!confirm('Abmelden?')) return;
  }
  try{ await endSession(); }catch(_){}
  try{ localStorage.removeItem('bwt_mobile_session'); }catch(_){}
  try{ await firebase.auth().signOut(); }catch(_){}
  location.reload();
}

async function startBewässerungLogin(name, pid, tid) {
  initMap(); // ensure map is ready before rendering
  // Original bewässerung login flow
  const btn = document.querySelector('#login-submit-btn');
  if(btn){ btn.disabled=true; btn.textContent='Lädt…'; }

  try{
    // Load all data in parallel (incl. route)
    const [projSnap, tourSnap, treesSnap, reasonsSnap, routeSnap] = await Promise.all([
      getDoc(doc(db,'projects',pid)),
      getDoc(doc(db,'projects',pid,'tours',tid)),
      getDocs(collection(db,'projects',pid,'trees')),
      getDocs(collection(db,'projects',pid,'reasons')),
      getDoc(doc(db,'projects',pid,'routes',tid))
    ]);
    if(!projSnap.exists){ throw new Error('Projekt nicht gefunden'); }
    currentProjectData = {id:pid,...projSnap.data()};
    currentProjectId = pid;
    currentTourId = tid;
    currentDriver = name;
    currentTour = tourSnap.exists ? {id:tid,...tourSnap.data()} : null;
    trees = treesSnap.docs.map(d=>({id:d.id,...d.data()})).filter(t=>(t.tourIds||[t.tourId]).includes(tid) && t.aktiv!==false);
    routeOrder = trees.map(t=>t.id);
    reasons = reasonsSnap.docs.map(d=>({id:d.id,...d.data()}));

    // Cache route snap so drawRoute doesn't re-fetch
    _cachedRouteSnap = routeSnap;

    // Save session
    localStorage.setItem('bwt_mobile_session', JSON.stringify({
      driver:name, projectId:pid, tourId:tid, mode:'bewaesserung', savedAt:Date.now()
    }));

    // Show app
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-app').classList.add('active');
    const _ht=document.getElementById('header-tour-name'); if(_ht) _ht.textContent = currentTour?.name||'Tour';
    const _hd=document.getElementById('header-driver'); if(_hd){
      _hd.textContent = 'Fahrer: '+name+' · '+(currentProjectData.name||'');
      // Mandant ergänzen (1 Read; offline bleibt die Zeile ohne Mandant)
      if(currentProjectData.orgId) getDoc(doc(db,'orgs',currentProjectData.orgId)).then(s=>{
        const o=s.exists&&s.data().name;
        if(o) _hd.textContent='Fahrer: '+name+' · '+(currentProjectData.name||'')+' · '+o;
      }).catch(()=>{});
    }

    // Show all tabs
    ['tab-btn-map','tab-btn-list'].forEach(id=>{
      const el=document.getElementById(id);
      if(el) el.style.display='';
    });
    switchTab('map');

    // Cache trees
    cacheTreesLocally(pid, tid, trees);

    // Render
    renderMarkers();
    renderList('');
    updateProgress();
    updateNetworkBadge();
    // Karte zuerst messen, DANN auf die ganze Tour einpassen — sonst hat der Container beim
    // Einpassen noch die falsche Größe (Tab gerade erst sichtbar) → falscher Zoom/Ausschnitt.
    setTimeout(()=>{
      map.invalidateSize();
      const withCoords = trees.filter(t=>t.lat&&t.lng);
      let bounds = withCoords.length ? L.latLngBounds(withCoords.map(t=>[t.lat,t.lng])) : null;
      const gb=_mGeomBounds(); if(gb) bounds = bounds?bounds.extend(gb):gb; // Flächen/Strecken einbeziehen
      if(bounds && bounds.isValid()) map.fitBounds(bounds,{padding:[40,40],maxZoom:17});
    },150);

    startGPS();
    drawRoute();

    // Subscribe to live updates
    // Lädt alle Bäume des Projekts, filtert client-seitig (kompatibel mit tourId und tourIds)
    const treesQuery = db.collection('projects').doc(pid).collection('trees');
    unsubTrees = treesQuery.onSnapshot(snap=>{
      if(pauseSnapshot)return;
      // Client-seitiger Filter: tourIds-Array oder altes tourId-Feld
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
      _setObjIndex(all);
      trees=all.filter(t=>(t.tourIds||[t.tourId]).includes(tid) && t.aktiv!==false);
      routeOrder=routeOrder.filter(id=>trees.find(t=>t.id===id));
      trees.forEach(t=>{if(!routeOrder.includes(t.id))routeOrder.push(t.id);});
      cacheTreesLocally(pid,tid,trees);
      renderMarkers();
      renderList(document.getElementById('list-search-input')?.value||'');
      updateProgress();
      if(selectedTreeId) openSheet(selectedTreeId);
    });

    if(isOnline) syncOfflineQueue();

    if(currentTour?.status==='abgeschlossen'){
      setTimeout(()=>showResumeOrRestartDialog(),600);
    }

  }catch(e){
    console.error(e);
    const errEl=document.getElementById('login-error');
    if(errEl){ errEl.textContent='Fehler: '+e.message; errEl.style.display='block'; }
  }finally{
    if(btn){ btn.disabled=false; btn.textContent='Tour starten'; }
  }
}


async function loadTrees() {
  const snap = await getDocs(collection(db,'projects',currentProjectId,'trees'));
  trees = snap.docs.map(d=>({id:d.id,...d.data()}))
    .filter(t=>(t.tourIds||[t.tourId]).includes(currentTourId) && t.aktiv!==false);
}

async function loadReasons() {
  try {
    const snap = await getDocs(collection(db,'projects',currentProjectId,'reasons'));
    reasons = snap.docs.map(d=>({id:d.id,...d.data()}));
    // No defaults here — reasons are managed exclusively in the desktop app
  }catch(e){ reasons=[]; }
}

// ─── PROGRESS ─────────────────────────────────────────────────
let _allDonePrompted=false; // verhindert wiederholtes Auto-Öffnen des Abschluss-Sheets
function updateProgress() {
  const done = trees.filter(t=>t.lastStatus).length;
  const total = trees.length;
  const pct = total>0?Math.round(done/total*100):0;
  document.getElementById('progress-fill').style.width = pct+'%';
  document.getElementById('header-count').textContent = `${done}/${total}`;
  updateNextTreePreview();
  // Alle Objekte gemeldet → einmalig zum Tour-Abschluss auffordern (nicht während aktiver Navigation)
  const offen = total - done;
  if(total>0 && offen===0 && currentTour?.status!=='abgeschlossen'){
    if(!_allDonePrompted){
      _allDonePrompted=true;
      toast('🎉 Alle Objekte erledigt — bitte Tour abschließen');
      if(!naviActive) setTimeout(()=>{ if(document.getElementById('finish-sheet')?.style.display!=='block') showFinishConfirm(); }, 700);
    }
  } else {
    _allDonePrompted=false; // wieder offen (neues Objekt / Reopen) → Hinweis erneut zulassen
  }
}

function updateNextTreePreview() {
  const nextEl = document.getElementById('next-tree-name');
  if(!nextEl) return;
  const idx = getNextIdx();
  if(idx === -1) {
    nextEl.textContent = '✓ Alle erledigt!';
    nextEl.parentElement.previousElementSibling?.style && (nextEl.style.color = '#16a34a');
  } else {
    const id = routeOrder[idx];
    const tree = trees.find(t=>t.id===id);
    nextEl.textContent = tree ? `#${idx+1} — ${titelOf(tree,_getContainer)||'–'}` : '–';
    nextEl.style.color = '';
  }
}

function showResumeOrRestartDialog(){
  const bew = trees.filter(t=>t.lastStatus==='bewaessert').length;
  const nicht = trees.filter(t=>t.lastStatus==='nicht').length;
  const offen = trees.filter(t=>!t.lastStatus).length;
  const isClosed = currentTour?.status === 'abgeschlossen';

  document.getElementById('rd-bew').textContent = bew;
  document.getElementById('rd-nicht').textContent = nicht;
  document.getElementById('rd-offen').textContent = offen;

  if(isClosed){
    // Tour was closed → auto-start fresh, no choice needed
    document.getElementById('resume-icon').textContent = '🔄';
    document.getElementById('resume-title').textContent = 'Neue Runde starten';
    document.getElementById('resume-desc').textContent =
      'Die letzte Tour wurde abgeschlossen und gespeichert. Eine neue Erfassung wird gestartet — alle Status werden zurückgesetzt.';
    document.getElementById('btn-fortsetzen').style.display = 'none';
    document.getElementById('btn-neu-starten').textContent = '✓ Neue Runde starten';
  } else {
    // Tour in progress → offer choice
    document.getElementById('resume-icon').textContent = '📋';
    document.getElementById('resume-title').textContent = 'Tour fortsetzen?';
    document.getElementById('resume-desc').textContent =
      'Du hast diese Tour bereits begonnen. Weiter machen oder neu starten?';
    document.getElementById('btn-fortsetzen').style.display = 'block';
    document.getElementById('btn-neu-starten').textContent = '🔄 Neu starten';
  }

  document.getElementById('resume-backdrop').style.display = 'flex';
}

function closeResumeDialog(){
  document.getElementById('resume-backdrop').style.display = 'none';
}

function dialogFortsetzen(){
  // Just close dialog — keep existing status, continue where left off
  closeResumeDialog();
  toast('Tour wird fortgesetzt');
}

async function dialogNeuStarten(){
  closeResumeDialog();
  toast('Status wird zurückgesetzt…');

  const resetFields = {
    lastStatus: null, lastReason: null, lastNote: null,
    lastReportAt: null, lastDriver: null,
  };

  // Step 1: Unsubscribe listener
  if(unsubTrees){ unsubTrees(); unsubTrees=null; }

  // Step 2: Reset local state immediately
  trees.forEach(tree => Object.assign(tree, resetFields));
  renderMarkers();
  renderList('');
  updateProgress();

  // Step 3: Write to Firestore
  await Promise.all(
    trees.map(tree =>
      updateDoc(doc(db,'projects',currentProjectId,'trees',tree.id), resetFields)
    )
  );

  // Step 4: Set tour to active
  await updateDoc(doc(db,'projects',currentProjectId,'tours',currentTourId),{
    status: 'aktiv',
    reopenedAt: new Date().toISOString(),
    reopenedBy: currentDriver,
  });
  currentTour = {...currentTour, status: 'aktiv'};

  // Step 5: Re-subscribe (filtered by tourId)
  const _reoQ1 = db.collection('projects').doc(currentProjectId).collection('trees')/* alle laden, client-seitig filtern */;
  unsubTrees = _reoQ1.onSnapshot(snap => {
    if(pauseSnapshot) return;
    const _all = snap.docs.map(d=>({id:d.id,...d.data()}));
    _setObjIndex(_all);
    trees = _all.filter(t=>(t.tourIds||[t.tourId]).includes(currentTourId) && t.aktiv!==false);
    routeOrder = routeOrder.filter(id=>trees.find(t=>t.id===id));
    trees.forEach(t=>{if(!routeOrder.includes(t.id))routeOrder.push(t.id);});
    renderMarkers();
    renderList(document.getElementById('list-search-input')?.value||'');
    updateProgress();
    if(selectedTreeId) openSheet(selectedTreeId);
  });

  drawRoute();
  toast('🔄 Neu gestartet — viel Erfolg!');
}

function markAllDone(){
  // Count only truly open trees (no status at all)
  const open = trees.filter(t => !t.lastStatus);
  if(open.length === 0){
    toast('Keine offenen Bäume mehr');
    return;
  }
  // Show confirm sheet
  document.getElementById('bulk-desc').textContent =
    `${open.length} Aufträge ohne Rückmeldung werden als „Erledigt" markiert. ` +
    `${trees.filter(t=>t.lastStatus==='nicht').length} negative Rückmeldungen bleiben erhalten.`;
  document.getElementById('bulk-backdrop').style.display = 'block';
  document.getElementById('bulk-sheet').style.display = 'block';
}

function closeBulkSheet(){
  document.getElementById('bulk-backdrop').style.display = 'none';
  document.getElementById('bulk-sheet').style.display = 'none';
}

function confirmMarkAllDone(){
  closeBulkSheet();
  const now = new Date().toISOString();
  const open = trees.filter(t => !t.lastStatus);
  if(open.length === 0){ toast('Keine offenen Bäume'); return; }

  const updates = {
    lastStatus: 'bewaessert',
    lastDriver: currentDriver,
    lastReportAt: now,
    lastReason: null,
    lastNote: null,
    datum: now.slice(0,10),
  };

  // Update local state + UI immediately
  pauseSnapshot = true;
  open.forEach(tree => Object.assign(tree, updates));
  renderMarkers();
  renderList('');
  updateProgress();
  toast(`✓ ${open.length} Bäume als bewässert markiert`);

  // Firestore writes in background
  Promise.all(
    open.map(tree =>
      updateDoc(doc(db,'projects',currentProjectId,'trees',tree.id), updates)
    )
  ).catch(e => {
    toast('Sync-Fehler: ' + e.message);
    console.error('confirmMarkAllDone error:', e);
  }).finally(()=>{
    setTimeout(()=>{ pauseSnapshot = false; }, 500);
  });
}

function showFinishConfirm() {
  // Prevent double-open
  if(document.getElementById('finish-sheet').style.display === 'block') return;

  const bewaessert = trees.filter(t=>t.lastStatus==='bewaessert').length;
  const nicht = trees.filter(t=>t.lastStatus==='nicht').length;
  const offen = trees.filter(t=>!t.lastStatus).length;
  const total = trees.length;
  const alreadyClosed = currentTour?.status === 'abgeschlossen';

  // Block finish if open trees remain
  if(!alreadyClosed && offen > 0) {
    const content = document.getElementById('finish-content');
    content.innerHTML = `
      <div style="text-align:center;margin-bottom:20px;">
        <div style="width:56px;height:56px;background:var(--amber-light);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </div>
        <div style="font-size:18px;font-weight:700;color:var(--text);">Noch ${offen} Aufträge offen</div>
        <div style="font-size:13px;color:var(--text3);margin-top:6px;line-height:1.6;">
          Alle Aufträge müssen eine Rückmeldung haben, bevor die Tour abgeschlossen werden kann.<br>
          Nutze <b>„Alle als erledigt markieren"</b> für eine Schnellerfassung.
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
        <div style="background:var(--green-light);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#16a34a;">${bewaessert}</div>
          <div style="font-size:11px;color:var(--text3);">Erledigt</div>
        </div>
        <div style="background:var(--red-light);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:#991b1b;">${nicht}</div>
          <div style="font-size:11px;color:var(--text3);">Nicht erledigt</div>
        </div>
        <div style="background:var(--amber-light);border-radius:10px;padding:12px;text-align:center;">
          <div style="font-size:22px;font-weight:700;color:var(--amber);">${offen}</div>
          <div style="font-size:11px;color:var(--text3);">Noch offen</div>
        </div>
      </div>
      <button onclick="closeFinishSheet();switchTab('list');" style="width:100%;padding:14px;background:var(--green);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">
        Zur Liste — offene Aufträge bearbeiten
      </button>
      <button onclick="closeFinishSheet()" style="width:100%;padding:14px;background:var(--surface2);color:var(--text2);border:none;border-radius:12px;font-size:15px;cursor:pointer;">
        Schließen
      </button>`;
    document.getElementById('finish-backdrop').style.display = 'block';
    document.getElementById('finish-sheet').style.display = 'block';
    document.getElementById('finish-backdrop').onclick = e => { if(e.target===document.getElementById('finish-backdrop')) closeFinishSheet(); };
    return;
  }

  const content = document.getElementById('finish-content');

  const statsHtml = `
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:20px;">
      <div style="background:var(--green-light);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#16a34a;">${bewaessert}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;">Erledigt</div>
      </div>
      <div style="background:var(--red-light);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:#991b1b;">${nicht}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;">Nicht erledigt</div>
      </div>
      <div style="background:var(--amber-light);border-radius:10px;padding:12px;text-align:center;">
        <div style="font-size:24px;font-weight:700;color:var(--amber);">${offen}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px;">Offen</div>
      </div>
    </div>`;

  if(alreadyClosed) {
    content.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <div style="width:56px;height:56px;background:#dcfce7;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 12px;">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <div style="font-size:18px;font-weight:700;">Tour abgeschlossen</div>
        <div style="font-size:13px;color:var(--text3);margin-top:4px;">Letzte Abschluss: ${currentTour?.lastClosedDate||'–'}</div>
      </div>
      ${statsHtml}
      <button onclick="reopenTour()" style="width:100%;padding:14px;background:var(--green);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;">
        🔄 Neue Runde starten
      </button>
      <button onclick="closeFinishSheet()" style="width:100%;padding:14px;background:var(--surface2);color:var(--text2);border:none;border-radius:12px;font-size:15px;cursor:pointer;">
        Schließen
      </button>`;
  } else {
    content.innerHTML = `
      <div style="text-align:center;margin-bottom:16px;">
        <div style="font-size:17px;font-weight:700;">${offen===0?'🎉 Alle erledigt!':'Tour abschließen'}</div>
        <div style="font-size:13px;color:var(--text3);margin-top:4px;">${offen>0?`Noch ${offen} Bäume ohne Rückmeldung`:'Alle Bäume wurden bearbeitet'}</div>
      </div>
      ${statsHtml}
      <button id="btn-finish-confirm" onclick="finishTour()" style="width:100%;padding:14px;background:#991b1b;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:8px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Tour abschließen & speichern
      </button>
      <button onclick="closeFinishSheet()" style="width:100%;padding:14px;background:var(--surface2);color:var(--text2);border:none;border-radius:12px;font-size:15px;cursor:pointer;">
        Weiter arbeiten
      </button>`;
  }

  document.getElementById('finish-backdrop').style.display = 'block';
  document.getElementById('finish-sheet').style.display = 'block';
  // Nur schließen wenn direkt auf Backdrop geklickt (nicht auf Sheet-Inhalt)
  document.getElementById('finish-backdrop').onclick = e => {
    if(e.target === document.getElementById('finish-backdrop')) closeFinishSheet();
  };
}

function closeFinishSheet() {
  document.getElementById('finish-backdrop').style.display = 'none';
  document.getElementById('finish-sheet').style.display = 'none';
}

async function finishTour() {
  const btn = document.getElementById('btn-finish-confirm');
  if(btn){ if(btn.disabled) return; btn.disabled = true; }

  // ── Progress overlay — erscheint sofort ──────────────────────
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9500;display:flex;align-items:center;justify-content:center;padding:24px;';
  overlay.innerHTML = `
    <div style="background:#fff;border-radius:20px;width:100%;max-width:340px;padding:28px 24px;text-align:center;">
      <div style="font-size:17px;font-weight:700;color:#1a1a1a;margin-bottom:6px;">Tour wird gespeichert…</div>
      <div id="finish-progress-label" style="font-size:13px;color:#6b7280;margin-bottom:16px;">Vorbereitung…</div>
      <div style="background:#e5e7eb;border-radius:99px;height:12px;overflow:hidden;">
        <div id="finish-progress-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#16a34a,#22c55e);border-radius:99px;transition:width .3s ease;"></div>
      </div>
      <div id="finish-progress-pct" style="font-size:13px;font-weight:600;color:#374151;margin-top:10px;">0%</div>
    </div>`;
  document.body.appendChild(overlay);

  // Animierter Fortschritt — bewegt sich auch während Netz wartet
  let _animPct = 0;
  let _animTarget = 0;
  let _animDone = false;
  function setProgress(pct, label) {
    _animTarget = pct;
    const bar = document.getElementById('finish-progress-bar');
    const lbl = document.getElementById('finish-progress-label');
    const pctEl = document.getElementById('finish-progress-pct');
    if(lbl) lbl.textContent = label;
    // Sofort auf Zielwert wenn fertig, sonst smooth
    if(pct >= 100) {
      if(bar) bar.style.width = '100%';
      if(pctEl) pctEl.textContent = '100%';
    } else {
      if(bar) bar.style.width = pct + '%';
      if(pctEl) pctEl.textContent = Math.round(pct) + '%';
    }
  }

  // Fake-Fortschritt: kriecht von 0→80% in ~1s während Netz wartet
  function startFakeProgress(from, to, durationMs) {
    const start = Date.now();
    const tick = () => {
      if(_animDone) return;
      const elapsed = Date.now() - start;
      const t = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const cur = from + (to - from) * eased;
      const bar = document.getElementById('finish-progress-bar');
      const pctEl = document.getElementById('finish-progress-pct');
      if(bar) bar.style.width = cur + '%';
      if(pctEl) pctEl.textContent = Math.round(cur) + '%';
      if(t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0,10);
    const tsStr = now.toISOString();
    const treesWithStatus = trees.filter(t=>t.lastStatus);
    const stats = {
      total: trees.length,
      bewaessert: trees.filter(t=>t.lastStatus==='bewaessert').length,
      nicht: trees.filter(t=>t.lastStatus==='nicht').length,
      offen: trees.filter(t=>!t.lastStatus).length,
    };

    // Starte Fake-Animation sofort (0→75% in 800ms)
    const lbl = document.getElementById('finish-progress-label');
    if(lbl) lbl.textContent = `${treesWithStatus.length} Bäume werden gespeichert…`;
    startFakeProgress(0, 75, 800);

    // ── Lean snapshot ────────────────────────────────────────────
    const histId = `${dateStr}_${now.getTime()}_${currentTourId}`;
    const snapshot = {
      orgId: currentProjectData?.orgId||'',
      tourId: currentTourId, tourName: currentTour?.name||'',
      tourColor: currentTour?.color||'',
      date: dateStr, closedAt: tsStr, closedBy: currentDriver, stats,
      // Kanonisches trees-Schema (von Controlling/Einsatzleiter/Detail direkt gelesen)
      trees: treesWithStatus.map(t=>({
        id: t.id, baumnr: t.baumnr||'', name: t.name||'',
        stadtteil: t.stadtteil||null, art: t.art||null, pflanzjahr: t.pflanzjahr||null,
        lat: t.lat??null, lng: t.lng??null,
        lastStatus: t.lastStatus, lastReason: t.lastReason||null,
        lastNote: t.lastNote||null, lastDriver: t.lastDriver||null,
        lastReportAt: t.lastReportAt||null,
      })),
    };

    // ── Batches: max 20 Trees pro Batch → granulares Progress-Update ─
    const BATCH_SIZE = 20;
    const batchPromises = [];
    let completed = 0;

    for(let i = 0; i < treesWithStatus.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = treesWithStatus.slice(i, i + BATCH_SIZE);
      chunk.forEach(tree => {
        const entry = {
          date: dateStr, tourId: currentTourId, tourName: currentTour?.name||'',
          status: tree.lastStatus, reason: tree.lastReason||null,
          note: tree.lastNote||null, driver: tree.lastDriver||null,
        };
        batch.update(
          db.collection('projects').doc(currentProjectId).collection('trees').doc(tree.id),
          { history: firebase.firestore.FieldValue.arrayUnion(entry) }
        );
      });
      if(i === 0) {
        batch.set(
          db.collection('projects').doc(currentProjectId).collection('tourHistory').doc(histId),
          snapshot
        );
        batch.update(
          db.collection('projects').doc(currentProjectId).collection('tours').doc(currentTourId),
          { status:'abgeschlossen', closedAt:tsStr, closedBy:currentDriver, lastClosedDate:dateStr }
        );
      }
      batchPromises.push(
        batch.commit().then(() => {
          completed += chunk.length;
          const realPct = 75 + (completed / Math.max(treesWithStatus.length,1)) * 20;
          setProgress(realPct, `${completed} / ${treesWithStatus.length} gespeichert…`);
        })
      );
    }

    if(treesWithStatus.length === 0) {
      const batch = db.batch();
      batch.set(db.collection('projects').doc(currentProjectId).collection('tourHistory').doc(histId), snapshot);
      batch.update(db.collection('projects').doc(currentProjectId).collection('tours').doc(currentTourId),
        { status:'abgeschlossen', closedAt:tsStr, closedBy:currentDriver, lastClosedDate:dateStr });
      batchPromises.push(batch.commit());
    }

    await Promise.all(batchPromises);
    _animDone = true;
    setProgress(100, 'Gespeichert! ✓');

    currentTour = {...currentTour, status:'abgeschlossen', lastClosedDate:dateStr};

    // ── Success ───────────────────────────────────────────────────
    setTimeout(() => {
      overlay.remove();
      closeFinishSheet();

      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;inset:0;background:var(--green);z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;';
      banner.innerHTML = `
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" style="margin-bottom:16px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <div style="font-size:24px;font-weight:700;margin-bottom:8px;">Tour abgeschlossen!</div>
        <div style="font-size:14px;opacity:.85;">${stats.bewaessert} erledigt · ${stats.nicht} nicht · ${stats.offen} offen</div>
        <div style="font-size:13px;opacity:.7;margin-top:6px;">✓ Erfolgreich gespeichert</div>`;
      document.body.appendChild(banner);
      setTimeout(()=>banner.remove(), 3000);

      const finishBtn = document.getElementById('btn-show-finish');
      if(finishBtn){ finishBtn.textContent='✅ Abgeschlossen'; finishBtn.style.background='#16a34a'; finishBtn.disabled=true; }
    }, 400);

  } catch(e) {
    console.error('finishTour error:', e);
    overlay.remove();
    if(btn){ btn.disabled=false; btn.innerHTML='⚠ Fehler — erneut versuchen'; btn.style.background='#b45309'; }
    toast('Fehler beim Speichern: ' + e.message);
  }
}

async function reopenTour() {
  try {
    const now = new Date();

    const resetFields = {
      lastStatus: null,
      lastReason: null,
      lastNote: null,
      lastReportAt: null,
      lastDriver: null,
    };

    // Step 1: Unsubscribe listener so it doesn't overwrite our reset
    if(unsubTrees){ unsubTrees(); unsubTrees=null; }

    // Step 2: Reset local state immediately and re-render
    trees.forEach(tree => Object.assign(tree, resetFields));
    renderMarkers();
    renderList('');
    updateProgress();

    // Step 3: Write all resets to Firestore in parallel
    await Promise.all(
      trees.map(tree =>
        updateDoc(doc(db,'projects',currentProjectId,'trees',tree.id), resetFields)
      )
    );

    // Step 4: Mark tour as active
    await updateDoc(doc(db,'projects',currentProjectId,'tours',currentTourId),{
      status: 'aktiv',
      reopenedAt: now.toISOString(),
      reopenedBy: currentDriver,
    });
    currentTour = {...currentTour, status: 'aktiv'};

    // Step 5: Re-subscribe filtered by tourId
    const _reoQ2 = db.collection('projects').doc(currentProjectId).collection('trees')/* alle laden, client-seitig filtern */;
    unsubTrees = _reoQ2.onSnapshot(snap => {
      if(pauseSnapshot) return;
      const _all = snap.docs.map(d=>({id:d.id,...d.data()}));
      _setObjIndex(_all);
      trees = _all.filter(t=>(t.tourIds||[t.tourId]).includes(currentTourId) && t.aktiv!==false);
      routeOrder = routeOrder.filter(id=>trees.find(t=>t.id===id));
      trees.forEach(t=>{if(!routeOrder.includes(t.id))routeOrder.push(t.id);});
      renderMarkers();
      renderList(document.getElementById('list-search-input')?.value||'');
      updateProgress();
      if(selectedTreeId) openSheet(selectedTreeId);
    });

    drawRoute();
    closeFinishSheet();
    toast('🔄 Tour neu gestartet');

  } catch(e) { toast('Fehler: '+e.message); console.error(e); }
}

// ─── MARKERS ──────────────────────────────────────────────────
function makeTreeIcon(tree, idx) {
  const status = tree.lastStatus; // 'bewaessert' | 'nicht' | null
  const color = currentTour?.color || '#2d6a4f';
  const bg = status==='bewaessert'?'#16a34a':status==='nicht'?'#991b1b':color;
  const num = idx+1;
  const isNext = routeOrder.indexOf(tree.id) === getNextIdx();
  const size = isNext ? 38 : 30;
  const border = isNext ? '4px solid #fff' : '3px solid #fff';
  const shadow = isNext ? '0 0 0 3px '+color+', 0 4px 12px rgba(0,0,0,.3)' : '0 2px 6px rgba(0,0,0,.3)';
  return L.divIcon({
    className:'',
    html:`<div style="position:relative;width:${size}px;height:${size}px;">
      <div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};border:${border};box-shadow:${shadow};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;font-family:'SF Mono','Fira Code',Consolas,monospace;">${status?status==='bewaessert'?'✓':'✕':num}</div>
    </div>`,
    iconSize:[size,size],iconAnchor:[size/2,size/2]
  });
}

function renderMarkers() {
  Object.values(mapMarkers).forEach(m=>map.removeLayer(m));
  mapMarkers={};
  renderTourGeoms(); // Flächen/Strecken (geomStr) zuerst zeichnen, Marker liegen darüber
  routeOrder.forEach((id,idx)=>{
    const tree=trees.find(t=>t.id===id);
    const np=navPoint(tree); if(!np)return; // Punkt=Koordinate, Fläche=Zentroid, Linie=Mittelpunkt
    const m=L.marker(np,{icon:makeTreeIcon(tree,idx)})
      .addTo(map).on('click',()=>openSheet(id));
    mapMarkers[id]=m;
  });
  // Route drawn separately via drawRoute() to load from Firestore
}

// Gezeichnete Geometrie (Flächen/Strecken am Doc, geomStr) der Tour auf der Karte zeigen
let geomLayers={};
function _mGeom(t){ if(!t||!t.geomStr) return null; try{ return JSON.parse(t.geomStr); }catch(_){ return null; } }
// Navigations-/Stopp-Punkt eines Objekts: Punkt=Koordinate, Fläche=Zentroid, Linie=Mittelpunkt (stabil).
function navPoint(t){
  if(!t) return null;
  if(t.lat&&t.lng) return [t.lat,t.lng];
  const g=_mGeom(t); if(!g) return null;
  if(g.type==='Polygon'){ const ring=g.coordinates[0]||[]; const r=ring.length>1?ring.slice(0,-1):ring; let la=0,ln=0,n=0; for(const c of r){ la+=c[1]; ln+=c[0]; n++; } return n?[la/n,ln/n]:null; }
  if(g.type==='LineString'){ const pts=(g.coordinates||[]).map(c=>[c[1],c[0]]); return pts.length?pts[Math.floor(pts.length/2)]:null; }
  return null;
}
function hasNav(t){ return !!navPoint(t); }
// Navi-Ziel: bei Linien der dem aktuellen GPS nächstgelegene Punkt (sonst Mittelpunkt), sonst wie navPoint.
function navTarget(t){
  const g=_mGeom(t);
  if(g && g.type==='LineString' && gpsLatLng){ const pts=(g.coordinates||[]).map(c=>[c[1],c[0]]); let best=pts[0],bd=Infinity; for(const p of pts){ const d=haversine(gpsLatLng[0],gpsLatLng[1],p[0],p[1]); if(d<bd){bd=d;best=p;} } return best||navPoint(t); }
  return navPoint(t);
}
// Distanz (m) eines Punktes zum Objekt: Linie=nächster Stützpunkt, sonst zum navPoint.
function _distToTreeM(latlng,t){
  if(!latlng) return Infinity;
  const g=_mGeom(t);
  if(g && g.type==='LineString'){ const pts=(g.coordinates||[]).map(c=>[c[1],c[0]]); let bd=Infinity; for(const p of pts){ const d=haversine(latlng[0],latlng[1],p[0],p[1])*1000; if(d<bd)bd=d; } return bd; }
  const np=navPoint(t); return np?haversine(latlng[0],latlng[1],np[0],np[1])*1000:Infinity;
}
function _mGeomBounds(){ let b=null; for(const id in geomLayers){ const lb=geomLayers[id].getBounds&&geomLayers[id].getBounds(); if(lb&&lb.isValid()) b=b?b.extend(lb):L.latLngBounds(lb.getSouthWest(),lb.getNorthEast()); } return b; }
function renderTourGeoms(){
  Object.values(geomLayers).forEach(l=>{ try{ map.removeLayer(l); }catch(_){} }); geomLayers={};
  trees.forEach(t=>{
    const g=_mGeom(t); if(!g) return;
    const st=t.lastStatus;
    const col = st==='bewaessert'?'#16a34a':st==='nicht'?'#991b1b':(currentTour?.color||'#2d6a4f');
    let layer;
    if(g.type==='Polygon'){ const ll=(g.coordinates[0]||[]).map(c=>[c[1],c[0]]); if(ll.length<3) return; layer=L.polygon(ll,{color:col,weight:2,fillColor:col,fillOpacity:st?0.45:0.25}); }
    else if(g.type==='LineString'){ const ll=(g.coordinates||[]).map(c=>[c[1],c[0]]); if(ll.length<2) return; layer=L.polyline(ll,{color:col,weight:5,opacity:.9}); }
    if(!layer) return;
    layer.on('click',()=>openSheet(t.id));
    layer.addTo(map); geomLayers[t.id]=layer;
  });
}

async function drawRoute(){
  if(routeLayer){
    if(Array.isArray(routeLayer))routeLayer.forEach(l=>map.removeLayer(l));
    else map.removeLayer(routeLayer);
    routeLayer=null;
  }
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}

  const color=currentTour?.color||'#2d6a4f';

  // Use cached route snap from login (avoid extra Firestore call)
  try{
    const routeSnap = _cachedRouteSnap || await getDoc(doc(db,'projects',currentProjectId,'routes',currentTourId));
    _cachedRouteSnap = null; // use once
    if(routeSnap.exists){
      const data=routeSnap.data();
      // Restore route order from saved data
      if(data.orderIds){
        const savedOrder=data.orderIds.filter(id=>trees.find(t=>t.id===id));
        // Merge: keep done trees in order, append remaining
        const done=routeOrder.filter(id=>trees.find(t=>t.id===id)&&trees.find(t=>t.id===id).lastStatus);
        const remaining=savedOrder.filter(id=>!trees.find(t=>t.id===id)?.lastStatus);
        routeOrder=[...done,...remaining];
        trees.forEach(t=>{if(!routeOrder.includes(t.id))routeOrder.push(t.id);});
      }
      // Saved GeoJSON nur nutzen, wenn die Route keine inaktiven/entfernten Objekte mehr enthält
      const routeStale=(data.orderIds||[]).some(id=>!trees.find(t=>t.id===id));
      if(data.geojsonStr && !routeStale){
        try{
          const geo=JSON.parse(data.geojsonStr);
          routeLayer=L.geoJSON(geo,{style:{color,weight:4,opacity:.85}}).addTo(map);
          drawDepotMarker(data);
          return;
        }catch(e){}
      }
    }
  }catch(e){}

  // Route war veraltet (inaktive/entfernte Objekte) oder ohne GeoJSON:
  // frische Straßenroute über die aktiven Stopps berechnen
  const activeStops=routeOrder.map(id=>trees.find(t=>t.id===id)).filter(t=>t&&hasNav(t));
  const street=await naviStreetLine(activeStops);
  if(street && street.length>1){
    routeLayer=L.polyline(street,{color,weight:4,opacity:.85}).addTo(map);
    drawDepotMarker(null);
    return;
  }

  // Fallback: dashed polyline with depot if set
  const pts=routeOrder.map(id=>navPoint(trees.find(x=>x.id===id))).filter(Boolean);
  if(pts.length<2)return;

  // Add depot to route if configured
  const allPts=await getRouteWithDepot(pts);
  routeLayer=L.polyline(allPts,{color,weight:3,opacity:.7,dashArray:'8 5'}).addTo(map);
  drawDepotMarker(null);
}

let depotMarker=null;

// Frische straßenfolgende Linie über die aktiven Stopps (ORS), inkl. Betriebshof
async function naviStreetLine(stops){
  try{
    const pts=stops.map(s=>navPoint(s)).filter(Boolean);
    if(pts.length<2) return null;
    const withDepot=await getRouteWithDepot(pts);
    const res=await orsDirections(withDepot,false);
    if(res&&res.geom.length>1) return res.geom;
  }catch(e){}
  return null;
}

async function getRouteWithDepot(pts){
  try{
    const data = currentProjectData || {};
    const depot=data.depot;
    const depotMode=data.depotMode||'round';
    if(depot?.lat&&depot?.lng){
      const dp=[depot.lat,depot.lng];
      return depotMode==='round'?[dp,...pts,dp]:[dp,...pts];
    }
  }catch(e){}
  return pts;
}

async function drawDepotMarker(routeData){
  if(depotMarker){map.removeLayer(depotMarker);depotMarker=null;}
  try{
    const depot=(currentProjectData||{}).depot;
    if(!depot?.lat)return;
    const icon=L.divIcon({
      className:'',
      html:`<div style="width:32px;height:32px;border-radius:8px;background:#f59e0b;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);display:flex;align-items:center;justify-content:center;font-size:16px;">🏭</div>`,
      iconSize:[32,32],iconAnchor:[16,16]
    });
    depotMarker=L.marker([depot.lat,depot.lng],{icon,zIndexOffset:1000})
      .addTo(map)
      .bindTooltip(`<b>Betriebshof</b>`,{direction:'top',offset:[0,-18]});
  }catch(e){}
}

// ─── NEXT TREE ─────────────────────────────────────────────────
function getNextIdx(){
  return routeOrder.findIndex(id=>{
    const t=trees.find(x=>x.id===id);
    return t&&!t.lastStatus;
  });
}

function goToNextTree(){
  const idx=getNextIdx();
  if(idx===-1){toast('Alle Bäume abgearbeitet! 🎉');return;}
  const id=routeOrder[idx];
  const tree=trees.find(t=>t.id===id);
  const np=navPoint(tree); if(np) map.panTo(np,{animate:true});
  openSheet(id);
}

function recalcFromGPS(){
  if(!gpsLatLng){toast('GPS noch nicht verfügbar');return;}
  // Nearest-neighbor from GPS position
  const remaining=trees.filter(t=>!t.lastStatus&&hasNav(t));
  if(remaining.length===0){toast('Alle erledigt!');return;}
  const done=trees.filter(t=>t.lastStatus);
  const ordered=nearestNeighbor(remaining,gpsLatLng[0],gpsLatLng[1]);
  routeOrder=[...done.map(t=>t.id),...ordered.map(t=>t.id)];
  renderMarkers();
  renderList('');
  toast('Route neu berechnet');
  drawRoute();
}

function nearestNeighbor(pts,startLat,startLng){
  const visited=new Set();const result=[];
  let lat=startLat,lng=startLng;
  while(result.length<pts.length){
    let best=null,bestD=Infinity;
    for(const p of pts){
      if(visited.has(p.id))continue;
      const np=navPoint(p); if(!np)continue;
      const d=haversine(lat,lng,np[0],np[1]);
      if(d<bestD){bestD=d;best=p;}
    }
    if(!best)break;
    const bp=navPoint(best); result.push(best);visited.add(best.id);lat=bp[0];lng=bp[1];
  }
  return result;
}

function haversine(a,b,c,d){
  const R=6371,dLat=(c-a)*Math.PI/180,dLon=(d-b)*Math.PI/180;
  const x=Math.sin(dLat/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

// ═══ NAVI-MODUS (Turn-by-turn, Beta) ══════════════════════════════
// Routing via OpenRouteService (Mandanten-Key). Deutsche Manöver-Texte aus ORS,
// Sprachausgabe (Web Speech), Wake-Lock, Off-Route-Reroute, Ankunft→Sheet.
const NAVI_ARRIVE_M=35, NAVI_ADVANCE_M=25, NAVI_OFFROUTE_M=70, NAVI_OFFROUTE_HITS=3;
let naviActive=false, naviSteps=[], naviGeom=[], naviTargetId=null, naviStepIdx=1,
    naviPreIdx=-1, naviNowIdx=-1, naviOffrouteHits=0, naviRerouting=false, naviLegLayer=null,
    naviWakeLock=null, naviTotal={dist:0,dur:0}, naviAutoNext=false, naviFollow=true,
    naviMuted=false, naviRotate=true, naviPrevPos=null, naviSpeechPrimed=false,
    naviLastHeading=null, naviLastSpeed=null,
    naviCompassHeading=null, naviCompassOn=false, naviLastApplied=null,
    naviFullRoute=true, naviFullGeom=null;

// Mandanten-Flag (Superadmin): steuert, ob die Navi-Funktion verfügbar ist. Default aus; aus localStorage vorbelegt für Reloads.
let _naviEnabled = (()=>{ try{ return localStorage.getItem('bwt_navi_enabled')==='1'; }catch(_){ return false; } })();
function naviInit(){
  if(!_naviEnabled) return; // Navi pro Mandant abschaltbar
  const ov=document.querySelector('.map-overlay-top');
  if(ov && !document.getElementById('btn-navi')){
    const b=document.createElement('button');
    b.className='recalc-btn'; b.id='btn-navi';
    b.style.cssText='background:#1d4ed8;color:#fff;border:none;';
    b.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline;vertical-align:middle;margin-right:4px;"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>Navi';
    b.onclick=naviStart;
    ov.appendChild(b);
  }
  const tab=document.getElementById('tab-map');
  if(tab && !document.getElementById('navi-banner')){
    const d=document.createElement('div');
    d.id='navi-banner';
    d.style.cssText='position:absolute;top:0;left:0;right:0;z-index:1500;background:#1d4ed8;color:#fff;padding:14px 16px;display:none;box-shadow:0 2px 12px rgba(0,0,0,.3);';
    d.innerHTML='<div style="display:flex;align-items:center;gap:14px;">'+
      '<div id="navi-arrow" style="font-size:34px;line-height:1;width:42px;text-align:center;">↑</div>'+
      '<div style="flex:1;min-width:0;">'+
        '<div id="navi-dist" style="font-size:13px;opacity:.85;font-weight:600;">—</div>'+
        '<div id="navi-instr" style="font-size:17px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>'+
      '</div>'+
      '</div>'+
      '<div id="navi-lanes" style="display:none;gap:5px;margin-top:8px;align-items:center;"></div>'+
      '<div id="navi-sub" style="font-size:12px;opacity:.8;margin-top:6px;">—</div>';
    tab.appendChild(d);
    // Bedienelemente als schwebende Runde-Buttons rechts auf der Karte → Banner bleibt frei für die Anweisung
    const fabs=document.createElement('div');
    fabs.id='navi-fabs';
    fabs.style.cssText='position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:1600;display:none;flex-direction:column;gap:10px;';
    const fab=(id,sym,bg,col)=>`<button id="${id}" style="width:46px;height:46px;border-radius:50%;border:none;background:${bg};box-shadow:0 2px 8px rgba(0,0,0,.3);font-size:20px;line-height:1;cursor:pointer;color:${col};">${sym}</button>`;
    fabs.innerHTML=fab('navi-voice','🔊','rgba(255,255,255,.95)','#1d4ed8')+
      fab('navi-rot','🧭','rgba(255,255,255,.95)','#1d4ed8')+
      fab('navi-route','🗺️','rgba(255,255,255,.95)','#1d4ed8')+
      fab('navi-end','✕','#dc2626','#fff');
    tab.appendChild(fabs);
    document.getElementById('navi-voice').onclick=naviToggleVoice;
    document.getElementById('navi-rot').onclick=naviToggleRotate;
    document.getElementById('navi-route').onclick=naviToggleFullRoute;
    document.getElementById('navi-end').onclick=naviStop;
    naviUpdateToggleUi();
  }
  // "Tour gesamt"-Button
  if(ov && !document.getElementById('btn-tour-overview')){
    const b=document.createElement('button');
    b.className='recalc-btn'; b.id='btn-tour-overview';
    b.style.cssText='background:var(--surface);color:#1d4ed8;border:1.5px solid #1d4ed8;';
    b.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="display:inline;vertical-align:middle;margin-right:4px;"><path d="M9 18l6-6-6-6"/><path d="M3 6h4M3 12h4M3 18h4" /></svg>Tour gesamt';
    b.onclick=naviOverview;
    ov.appendChild(b);
  }
}

// Nächstes Ziel = das dem aktuellen GPS am nächsten gelegene offene Objekt
// (passt sich an, wenn der Fahrer woanders hinfährt). Fallback: erstes in Reihenfolge.
function naviPickTarget(){
  const open=naviNearestOpenStop(gpsLatLng);
  if(open) return open.tree;
  for(const id of routeOrder){
    const t=trees.find(x=>x.id===id);
    if(t && !t.lastStatus && hasNav(t)) return t;
  }
  return null;
}

// Beim Navi-Start: Reihenfolge ab aktuellem Standort neu sortieren (Nearest-Neighbor),
// damit die Reihenfolge-Nummern in Liste/Karte zur tatsächlichen Fahrreihenfolge passen.
function naviReorderFromGPS(){
  if(!gpsLatLng) return;
  const remaining=trees.filter(t=>!t.lastStatus&&hasNav(t));
  if(!remaining.length) return;
  const done=trees.filter(t=>t.lastStatus);
  const ordered=nearestNeighbor(remaining,gpsLatLng[0],gpsLatLng[1]);
  routeOrder=[...done.map(t=>t.id),...ordered.map(t=>t.id)];
  trees.forEach(t=>{ if(!routeOrder.includes(t.id)) routeOrder.push(t.id); });
  renderMarkers(); renderList('');
}

// Nächstgelegener offener (aktiver, mit Koordinaten) Stopp zum gegebenen Punkt
function naviNearestOpenStop(latlng){
  if(!latlng) return null;
  let best=null,bd=Infinity;
  for(const id of routeOrder){
    const t=trees.find(x=>x.id===id);
    if(!t || t.lastStatus || !hasNav(t)) continue;
    const d=_distToTreeM(latlng,t);
    if(d<bd){ bd=d; best=t; }
  }
  return best?{tree:best,dist:bd}:null;
}

async function naviStart(){
  naviPrimeSpeech(); // synchron in der Nutzer-Geste → entsperrt Sprachausgabe auf Mobile
  if(naviRotate) naviRequestCompass(); // Kompass-Freigabe in der Nutzer-Geste anfragen (iOS)
  if(currentTour?.status==='abgeschlossen'){toast('Tour abgeschlossen');return;}
  if(!gpsLatLng){toast('GPS noch nicht verfügbar');return;}
  naviPrevPos=null;
  naviReorderFromGPS(); // Reihenfolge-Nummern an aktuellen Standort anpassen
  const target=naviPickTarget();
  if(!target){toast('Alle Objekte erledigt 🎉');return;}
  naviTargetId=target.id;
  toast('Navi wird berechnet…');
  const ok=await naviFetchRoute(gpsLatLng, navTarget(target));
  if(!ok){toast('Route konnte nicht berechnet werden');return;}
  if(naviFullRoute) await naviFetchFullRoute(); // ganze Restroute für Übersicht
  naviActive=true; naviStepIdx=1; naviPreIdx=-1; naviNowIdx=-1; naviOffrouteHits=0; naviFollow=true;
  naviShowBanner(true);
  naviDrawDisplay(true); // Linie zeichnen + passend einrahmen
  await naviAcquireWake();
  switchTab('map');
  naviUpdate(gpsLatLng);
  // Erst-Ansage sofort, damit der Fahrer gleich etwas hört
  const s0=naviSteps[naviStepIdx];
  if(s0){ speak('Navigation gestartet. '+s0.instr); naviPreIdx=naviStepIdx; }
}

async function naviFetchRoute(from,to){
  try{
    const res=await orsDirections([from,to],true);
    if(!res || !res.steps.length) return false;
    naviGeom=res.geom;
    naviSteps=res.steps;            // ORS liefert die Anweisungstexte (instr) bereits auf Deutsch
    naviTotal=res.total;
    return naviSteps.length>0;
  }catch(e){ return false; }
}

// Ganze Restroute (GPS → alle verbleibenden Stopps in Reihenfolge) für die Übersichts-Anzeige
async function naviFetchFullRoute(){
  naviFullGeom=null;
  const stops=routeOrder.map(id=>trees.find(t=>t.id===id)).filter(t=>t&&!t.lastStatus&&hasNav(t));
  if(!stops.length || !gpsLatLng) return;
  const pts=[gpsLatLng, ...stops.map(s=>navTarget(s))];
  try{
    const res=await orsDirections(pts,false);
    if(res&&res.geom.length) naviFullGeom=res.geom;
  }catch(e){}
}

function naviUpdate(latlng){
  if(!naviActive)return;
  const target=trees.find(t=>t.id===naviTargetId);
  if(!target){naviStop();return;}
  // Ankunft an IRGENDEINEM offenen Stopp erkennen (Fahrer fährt evtl. woanders hin)
  const near=naviNearestOpenStop(latlng);
  if(near && near.dist<NAVI_ARRIVE_M){ naviTargetId=near.tree.id; naviArrive(); return; }
  const distToTarget=_distToTreeM(latlng,target);
  while(naviStepIdx<naviSteps.length-1){
    const s=naviSteps[naviStepIdx];
    const d=haversine(latlng[0],latlng[1],s.loc[0],s.loc[1])*1000;
    if(d<NAVI_ADVANCE_M){ naviStepIdx++; } else break;
  }
  naviVoice(latlng);
  const nearest=naviNearestDist(latlng);
  if(nearest>NAVI_OFFROUTE_M){
    naviOffrouteHits++;
    if(naviOffrouteHits>=NAVI_OFFROUTE_HITS && !naviRerouting) naviReroute();
  } else naviOffrouteHits=0;
  naviRenderBanner(latlng,distToTarget);
  // Karte mitführen (erst zentrieren) …
  if(naviFollow && map){
    try{
      if(naviFullRoute) map.panTo(latlng, {animate:true,duration:.5}); // Übersicht: Zoom belassen, nur folgen
      else map.setView(latlng, Math.max(map.getZoom(),16), {animate:true,duration:.5}); // Etappe: nah heranzoomen
    }catch(e){}
  }
  // … dann in Fahrtrichtung drehen (NACH setView, sonst kann es zurückgesetzt werden).
  // Reihenfolge der Richtungsquellen: Geräte-Kompass > GPS-heading > Bewegung.
  if(naviRotate && naviFollow && NAVI_ROTATE_OK && map.setBearing){
    let brg=null;
    if(typeof naviCompassHeading==='number') brg=naviCompassHeading;
    else if(typeof naviLastHeading==='number' && !isNaN(naviLastHeading) && (naviLastSpeed==null||naviLastSpeed>0.3)) brg=naviLastHeading;
    else if(naviPrevPos){
      const moved=haversine(naviPrevPos[0],naviPrevPos[1],latlng[0],latlng[1])*1000;
      if(moved>6) brg=naviBearing(naviPrevPos,latlng);
    }
    if(brg!=null){ naviLastApplied=brg; try{ map.setBearing(brg); }catch(e){} }
  }
  naviPrevPos=latlng;
}

// Sprachausgabe: Vorab-Ansage (in X m …) + Ansage am Manöver
function naviVoice(latlng){
  const cur=naviSteps[naviStepIdx]; if(!cur)return;
  const d=haversine(latlng[0],latlng[1],cur.loc[0],cur.loc[1])*1000;
  if(d<=300 && d>90 && naviPreIdx!==naviStepIdx){
    naviPreIdx=naviStepIdx; speak(`In ${Math.round(d/10)*10} Metern, ${cur.instr}`);
  }
  if(d<=90 && naviNowIdx!==naviStepIdx){
    naviNowIdx=naviStepIdx; speak(cur.instr);
  }
}

async function naviReroute(){
  naviRerouting=true; naviOffrouteHits=0;
  const target=trees.find(t=>t.id===naviTargetId);
  if(target){
    const ok=await naviFetchRoute(gpsLatLng, navTarget(target));
    if(ok){ naviStepIdx=1; naviPreIdx=-1; naviNowIdx=-1; if(naviFullRoute) await naviFetchFullRoute(); naviDrawDisplay(false); toast('Route neu berechnet'); naviVoice(gpsLatLng); }
  }
  naviRerouting=false;
}

function naviArrive(){
  const t=trees.find(x=>x.id===naviTargetId);
  speak('Ziel erreicht. '+(t?.name||''));
  toast('Ziel erreicht');
  const tid=naviTargetId;
  naviActive=false; naviTargetId=null; naviFollow=false; naviAutoNext=true;
  naviShowBanner(false); naviRemoveLeg(); naviReleaseWake();
  setTimeout(()=>{ if(tid) openSheet(tid); },400); // Status melden → danach Auto-Weiter
}

function naviToggleVoice(){
  naviMuted=!naviMuted;
  if(!naviMuted){ naviPrimeSpeech(); speak('Sprachansagen an'); }
  else { try{ speechSynthesis.cancel(); }catch(e){} }
  naviUpdateToggleUi();
}
function naviToggleRotate(){
  naviRotate=!naviRotate;
  if(naviRotate){ naviRequestCompass(); }
  else { naviStopCompass(); if(NAVI_ROTATE_OK && map && map.setBearing){ try{ map.setBearing(0); }catch(e){} } }
  naviUpdateToggleUi();
}
async function naviToggleFullRoute(){
  naviFullRoute=!naviFullRoute;
  if(naviFullRoute && naviActive) await naviFetchFullRoute();
  naviDrawDisplay(true); // neu zeichnen + passend einrahmen
  naviUpdateToggleUi();
  toast(naviFullRoute?'Ganze Route':'Nur nächste Etappe');
}
function naviUpdateToggleUi(){
  const v=document.getElementById('navi-voice');
  if(v){ v.textContent=naviMuted?'🔇':'🔊'; v.style.opacity=naviMuted?'.45':'1'; }
  const r=document.getElementById('navi-rot');
  if(r){
    if(!NAVI_ROTATE_OK){ r.style.display='none'; }
    else { r.style.opacity=naviRotate?'1':'.45'; r.title=naviRotate?'Karte dreht in Fahrtrichtung':'Norden oben'; }
  }
  const rt=document.getElementById('navi-route');
  if(rt){ rt.textContent=naviFullRoute?'🗺️':'📍'; rt.title=naviFullRoute?'Ganze Route — tippen für nächste Etappe':'Nächste Etappe — tippen für ganze Route'; }
}

function naviStop(){
  naviActive=false; naviTargetId=null; naviFollow=false; naviAutoNext=false; naviPrevPos=null;
  naviShowBanner(false); naviRemoveLeg(); naviReleaseWake(); naviStopCompass();
  if(NAVI_ROTATE_OK && map && map.setBearing){ try{ map.setBearing(0); }catch(e){} } // Norden wieder oben
  try{ speechSynthesis.cancel(); }catch(e){}
}

function naviRenderBanner(latlng,distToTarget){
  const step=naviSteps[naviStepIdx]||naviSteps[naviSteps.length-1];
  const dMan=step?haversine(latlng[0],latlng[1],step.loc[0],step.loc[1])*1000:0;
  const target=trees.find(t=>t.id===naviTargetId);
  const set=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
  set('navi-instr', step?step.instr:'—');
  set('navi-dist', fmtDist(dMan));
  set('navi-arrow', naviArrow(step));
  // Restzeit/ETA aus verbleibenden Schritten
  let remDur=0, remDist=0;
  for(let i=naviStepIdx;i<naviSteps.length;i++){ remDur+=naviSteps[i].dur||0; remDist+=naviSteps[i].dist||0; }
  const eta=new Date(Date.now()+remDur*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const min=Math.max(1,Math.round(remDur/60));
  set('navi-sub', `${target?.name||'Ziel'} · noch ${fmtDist(remDist||distToTarget)} · ${min} min · an ${eta}`);
  // Spurassistent: nur anzeigen, wenn das nächste Manöver nah ist und Spurdaten vorliegen
  const lanesEl=document.getElementById('navi-lanes');
  if(lanesEl){
    if(step && step.lanes && step.lanes.length && dMan<260){
      lanesEl.style.display='flex';
      lanesEl.innerHTML=step.lanes.map(l=>
        `<span style="font-size:20px;line-height:1;opacity:${l.valid?1:.35};">${naviLaneArrow(l.ind)}</span>`
      ).join('');
    } else { lanesEl.style.display='none'; }
  }
}

function naviLaneArrow(ind){
  const a={'left':'⬅','slight left':'↖','sharp left':'⬅','right':'➡','slight right':'↗',
    'sharp right':'➡','straight':'⬆','through':'⬆','uturn':'↩','none':'⬆'};
  return a[(ind||'').split(';')[0]]||'⬆';
}

function naviNearestDist(latlng){
  let best=Infinity;
  for(const p of naviGeom){ const d=haversine(latlng[0],latlng[1],p[0],p[1])*1000; if(d<best)best=d; }
  return best;
}

// Zeichnet die hervorgehobene Linie je nach Modus: ganze Restroute oder nur nächste Etappe
function naviDrawDisplay(fit){
  naviRemoveLeg();
  if(!map) return;
  const geom = (naviFullRoute && naviFullGeom && naviFullGeom.length>1) ? naviFullGeom : naviGeom;
  if(!geom || geom.length<2) return;
  naviLegLayer=L.polyline(geom,{color:'#1d4ed8',weight:6,opacity:.9}).addTo(map);
  if(fit){ try{ map.fitBounds(L.latLngBounds(geom),{padding:[50,70]}); }catch(e){} }
}
function naviRemoveLeg(){ if(naviLegLayer){ try{map.removeLayer(naviLegLayer);}catch(e){} naviLegLayer=null; } }
function naviShowBanner(show){
  const b=document.getElementById('navi-banner'); if(b)b.style.display=show?'block':'none';
  const f=document.getElementById('navi-fabs'); if(f)f.style.display=show?'flex':'none';
}

async function naviAcquireWake(){
  try{ if('wakeLock' in navigator) naviWakeLock=await navigator.wakeLock.request('screen'); }catch(e){}
}
function naviReleaseWake(){ try{ naviWakeLock&&naviWakeLock.release(); }catch(e){} naviWakeLock=null; }
document.addEventListener('visibilitychange',()=>{
  if(naviActive && document.visibilityState==='visible' && !naviWakeLock) naviAcquireWake();
});

function speak(text){
  try{
    if(naviMuted || !('speechSynthesis' in window))return;
    const u=new SpeechSynthesisUtterance(text);
    u.lang='de-DE'; u.rate=1.0;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  }catch(e){}
}

// Mobile: Sprachausgabe muss einmal in einer Nutzer-Geste „entsperrt" werden,
// sonst spielen spätere (aus GPS-Callbacks ausgelöste) Ansagen nicht ab.
function naviPrimeSpeech(){
  try{
    if(naviSpeechPrimed || !('speechSynthesis' in window))return;
    const u=new SpeechSynthesisUtterance(' ');
    u.volume=0; u.lang='de-DE';
    speechSynthesis.speak(u);
    naviSpeechPrimed=true;
  }catch(e){}
}

// Kompass-Bearing (0–360°) zwischen zwei [lat,lng]-Punkten
function naviBearing(a,b){
  const toR=d=>d*Math.PI/180, toD=r=>r*180/Math.PI;
  const dLon=toR(b[1]-a[1]);
  const y=Math.sin(dLon)*Math.cos(toR(b[0]));
  const x=Math.cos(toR(a[0]))*Math.sin(toR(b[0]))-Math.sin(toR(a[0]))*Math.cos(toR(b[0]))*Math.cos(dLon);
  return (toD(Math.atan2(y,x))+360)%360;
}

// Geräte-Kompass (iOS: webkitCompassHeading; Android: absolute alpha) für „Fahrtrichtung oben".
// iOS verlangt eine Freigabe, die nur aus einer Nutzer-Geste angefragt werden darf.
function naviOnOrientation(e){
  let h=null;
  if(typeof e.webkitCompassHeading==='number' && !isNaN(e.webkitCompassHeading)) h=e.webkitCompassHeading;
  else if(e.absolute && typeof e.alpha==='number') h=(360-e.alpha)%360;
  if(h==null) return;
  naviCompassHeading=h;
  // live drehen (gedrosselt: erst ab >2° Änderung)
  if(naviActive && naviRotate && naviFollow && NAVI_ROTATE_OK && map && map.setBearing){
    if(naviLastApplied==null || Math.abs(((h-naviLastApplied+540)%360)-180)>2){
      naviLastApplied=h;
      try{ map.setBearing(h); }catch(_){}
    }
  }
}
function naviRequestCompass(){
  if(naviCompassOn) return;
  const start=()=>{
    naviCompassOn=true;
    window.addEventListener('deviceorientationabsolute', naviOnOrientation, true);
    window.addEventListener('deviceorientation', naviOnOrientation, true);
  };
  try{
    if(typeof DeviceOrientationEvent!=='undefined' && typeof DeviceOrientationEvent.requestPermission==='function'){
      DeviceOrientationEvent.requestPermission().then(p=>{ if(p==='granted') start(); }).catch(()=>{});
    } else { start(); }
  }catch(e){}
}
function naviStopCompass(){
  if(!naviCompassOn) return;
  window.removeEventListener('deviceorientationabsolute', naviOnOrientation, true);
  window.removeEventListener('deviceorientation', naviOnOrientation, true);
  naviCompassOn=false; naviCompassHeading=null; naviLastApplied=null;
}

function fmtDist(m){
  if(m<20)return 'jetzt';
  if(m<1000)return `${Math.round(m/10)*10} m`;
  return `${(m/1000).toFixed(1).replace('.',',')} km`;
}

function naviArrow(step){
  if(!step)return '↑';
  if(step.type==='arrive')return '🏁';
  if(step.type==='roundabout'||step.type==='rotary')return '↻';
  const m=step.mod||'';
  if(m.includes('uturn'))return '↩';
  if(m==='left'||m==='sharp left')return '←';
  if(m==='slight left')return '↖';
  if(m==='right'||m==='sharp right')return '→';
  if(m==='slight right')return '↗';
  return '↑';
}
// ─── TOUR-GESAMTÜBERSICHT ─────────────────────────────────────────
async function naviOverview(){
  if(!gpsLatLng){ toast('GPS noch nicht verfügbar'); return; }
  const stops=routeOrder.map(id=>trees.find(t=>t.id===id)).filter(t=>t&&!t.lastStatus&&hasNav(t));
  if(!stops.length){ toast('Alle Objekte erledigt 🎉'); return; }
  toast('Tour-Übersicht wird berechnet…');
  const pts=[gpsLatLng, ...stops.map(s=>navTarget(s))];
  let legs=null, total={dist:0,dur:0};
  try{
    const res=await orsDirections(pts,false);
    if(res){ legs=res.segs.map(s=>({duration:s.dur,distance:s.dist})); total={dist:res.total.dist,dur:res.total.dur}; }
  }catch(e){}
  naviShowOverview(stops, legs, total);
}

function naviShowOverview(stops, legs, total){
  const old=document.getElementById('navi-ov'); if(old)old.remove();
  let cum=0;
  const rows=stops.map((s,i)=>{
    if(legs && legs[i]) cum+=legs[i].duration;
    const eta=new Date(Date.now()+cum*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
    const legKm=legs&&legs[i]?fmtDist(legs[i].distance):'–';
    return `<div style="display:flex;align-items:center;gap:10px;padding:9px 4px;border-top:1px solid var(--border);">
      <div style="width:24px;height:24px;border-radius:50%;background:#1d4ed822;color:#1d4ed8;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</div>
      <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${s.name||'Objekt'}</div>
        <div style="font-size:11px;color:var(--text3);">${s.stadtteil||''} ${s.baumnr?'· '+s.baumnr:''}</div></div>
      <div style="text-align:right;flex-shrink:0;"><div style="font-size:12px;font-weight:600;">${legs?'an '+eta:''}</div>
        <div style="font-size:11px;color:var(--text3);">+${legKm}</div></div>
    </div>`;
  }).join('');
  const totMin=Math.max(1,Math.round(total.dur/60));
  const totEta=new Date(Date.now()+total.dur*1000).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
  const m=document.createElement('div');
  m.id='navi-ov';
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:3000;display:flex;align-items:flex-end;justify-content:center;';
  m.innerHTML=`<div style="background:var(--surface);width:100%;max-width:560px;max-height:85vh;border-radius:18px 18px 0 0;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:16px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
      <div style="flex:1;"><div style="font-size:16px;font-weight:700;">Tour-Übersicht</div>
        <div style="font-size:12px;color:var(--text3);">${stops.length} offene Objekte${legs?` · ${fmtDist(total.dist)} · ${totMin} min · fertig ~${totEta}`:' · (Strecke offline)'}</div></div>
      <button id="navi-ov-x" style="border:none;background:none;font-size:24px;color:var(--text2);cursor:pointer;line-height:1;">×</button>
    </div>
    <div style="overflow:auto;flex:1;padding:4px 16px 12px;">${rows}</div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px;">
      <button id="navi-ov-gmaps" class="btn btn-secondary" style="flex:1;">In Google Maps</button>
      <button id="navi-ov-start" class="btn btn-primary" style="flex:1;">Navi starten</button>
    </div></div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#navi-ov-x').onclick=close;
  m.onclick=e=>{ if(e.target===m)close(); };
  m.querySelector('#navi-ov-gmaps').onclick=()=>{ naviGmapsTour(stops); };
  m.querySelector('#navi-ov-start').onclick=()=>{ close(); naviStart(); };
}

function naviGmapsTour(stops){
  const limited=stops.slice(0,10); // Google-URL: max ~10 Punkte
  const dest=limited[limited.length-1];
  const wps=limited.slice(0,-1).map(s=>`${s.lat},${s.lng}`).join('|');
  if(stops.length>10) toast('Hinweis: Google Maps zeigt nur die ersten 10 Stopps');
  const url=`https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`+
    (wps?`&waypoints=${encodeURIComponent(wps)}`:'')+`&travelmode=driving`;
  window.open(url,'_blank');
}
window.naviOverview=naviOverview;

// Externe Navigation (Deeplink) — öffnet Google Maps (App oder Web, plattformübergreifend)
window.naviExternal=(lat,lng)=>{
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,'_blank');
};
// Beta-Test-Hooks (Sandbox): GPS simulieren / Status abfragen — Navi ohne echte Fahrt testen
window.naviStart=naviStart;
window.naviSimulateGps=(lat,lng)=>{ gpsLatLng=[lat,lng]; if(gpsMarker)gpsMarker.setLatLng(gpsLatLng); if(naviActive)naviUpdate(gpsLatLng); };
window.naviDebug=()=>({active:naviActive,targetId:naviTargetId,stepIdx:naviStepIdx,steps:naviSteps.map(s=>s.instr),lastGeom:naviGeom[naviGeom.length-1],total:naviTotal,rotateOk:NAVI_ROTATE_OK});
window.naviSetBearing=(deg)=>{ if(map&&map.setBearing){ map.setBearing(deg); return 'ok '+deg; } return 'no rotate'; };
// ═══ ENDE NAVI-MODUS ══════════════════════════════════════════════

// ─── LIST ──────────────────────────────────────────────────────
function renderList(q=''){
  const el=document.getElementById('tree-list-mobile');
  let list=routeOrder.map(id=>trees.find(t=>t.id===id)).filter(Boolean);
  if(q){ const ql=q.toLowerCase(); list=list.filter(t=>titelOf(t,_getContainer).toLowerCase().includes(ql)||(t.art||'').toLowerCase().includes(ql)); }
  if(list.length===0){el.innerHTML='<div style="padding:40px;text-align:center;color:var(--text3);">Keine Bäume</div>';return;}
  el.innerHTML=list.map((tree,i)=>{
    const idx=routeOrder.indexOf(tree.id);
    const st=tree.lastStatus;
    const dotClass=st==='bewaessert'?'bewaessert':st==='nicht'?'nicht':'offen';
    const color=currentTour?.color||'#2d6a4f';
    return `<div class="tree-row${st?' done':''}" data-id="${tree.id}">
      <div class="tree-row-num" style="background:${color}22;color:${color};">${idx+1}</div>
      <div class="tree-row-info">
        <div class="tree-row-name">${esc(titelOf(tree,_getContainer)||'–')}</div>
        <div class="tree-row-meta">${esc(typOf(tree)||'–')} · ${esc(tree.stadtteil||'')}</div>
      </div>
      <div class="status-dot ${dotClass}"></div>
    </div>`;
  }).join('');
  el.onclick=e=>{
    const row=e.target.closest('[data-id]');
    if(row) openSheet(row.dataset.id);
  };
}

// ─── SHEET ────────────────────────────────────────────────────
function openSheet(id){
  // Abgeschlossene Tour ist schreibgeschützt – Status-/Bearbeitungs-Sheet nicht öffnen
  if(currentTour?.status==='abgeschlossen'){
    toast('Tour abgeschlossen — keine Änderungen möglich');
    return;
  }
  selectedTreeId=id;
  const tree=trees.find(t=>t.id===id);
  if(!tree)return;
  document.getElementById('sheet-title').textContent=titelOf(tree,_getContainer)||'–';
  document.getElementById('sheet-meta').textContent=
    `${typOf(tree)||'–'} · ${tree.stadtteil||''} · ${tree.baumnr||''}`;

  const idx=routeOrder.indexOf(id);
  const statusVal=tree.lastStatus||'';
  const reasonVal=tree.lastReason||'';
  const _np=navPoint(tree); // Ziel für „In Google Maps" (Punkt / Flächen-Zentroid / Linien-Mittelpunkt)

  // Build reason chips
  const reasonChips=reasons.length>0
    ? reasons.map(r=>`<div class="reason-chip${reasonVal===r.text?' selected':''}" data-reason="${esc(r.text)}">${esc(r.text)}</div>`).join('')
    : '<div style="font-size:12px;color:var(--text3);padding:4px 0;">Keine Gründe hinterlegt — bitte in der Desktop-App unter Verwaltung einrichten.</div>';

  document.getElementById('sheet-body').innerHTML=`
    ${_np?`<button class="btn btn-secondary" style="width:100%;margin-bottom:14px;display:flex;align-items:center;justify-content:center;gap:6px;" onclick="naviExternal(${_np[0]},${_np[1]})">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
      In Google Maps navigieren
    </button>`:''}
    <!-- Status -->
    <div class="section-title">Status</div>
    <div class="status-btns">
      <div class="status-btn${statusVal==='bewaessert'?' selected-ok':''}" id="btn-ok" onclick="selectStatus('bewaessert')">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        Erledigt
      </div>
      <div class="status-btn${statusVal==='nicht'?' selected-nok':''}" id="btn-nok" onclick="selectStatus('nicht')">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        Nicht erledigt
      </div>
    </div>

    <!-- Reasons (only when nicht) -->
    <div id="reason-section" style="display:${statusVal==='nicht'?'block':'none'}">
      <div class="section-title">Grund</div>
      <div class="reason-chips" id="reason-chips">${reasonChips}</div>
      <input class="prop-input prop-full" id="reason-custom" placeholder="Weitere Bemerkung…" value="${esc(tree.lastNote||'')}">
    </div>

    <!-- Properties -->
    <div class="section-title" style="margin-top:16px;">Eigenschaften erfassen</div>
    <div class="prop-grid">
      <div class="prop-group">
        <label class="prop-label">${esc(_flM('zustand','Zustand'))}</label>
        <select class="prop-input" id="p-zustand">${_rankOptsM('zustand', tree.zustand||'mittel')}</select>
      </div>
      <div class="prop-group">
        <label class="prop-label">${esc(_flM('wasser','Bedarf'))}</label>
        <select class="prop-input" id="p-wasser">${_rankOptsM('wasser', tree.wasser||'mittel')}</select>
      </div>
      <div class="prop-group prop-full">
        <label class="prop-label">Bemerkung</label>
        <input class="prop-input" id="p-notiz" placeholder="Freitext…" value="${esc(tree.notiz||'')}">
      </div>
    </div>

    ${currentProjectData?.fuellgradAktiv?`
    <!-- Füllgrad -->
    <div class="section-title" style="margin-top:16px;">Füllgrad</div>
    <div class="reason-chips" id="fuellgrad-chips">
      ${FUELLGRAD_OPTS.map(o=>`<div class="reason-chip${tree.lastFuellgrad===o.v?' selected':''}" data-fg="${o.v}">${o.l}</div>`).join('')}
    </div>`:''}

    <!-- Info fields -->
    <div class="section-title">Stammdaten</div>
    ${_mobilInfoRows(tree)}
    <div class="field-row"><span class="field-key">Route #</span><span class="field-val">#${idx+1}</span></div>
    ${tree.lastStatus?`<div class="field-row"><span class="field-key">Letzte Meldung</span><span class="field-val">${tree.lastStatus==='bewaessert'?'✓ Erledigt':'✕ Nicht erledigt'}</span></div>`:''}
  `;

  // Reason chips click
  document.getElementById('reason-chips').onclick=e=>{
    const chip=e.target.closest('[data-reason]');
    if(!chip)return;
    document.querySelectorAll('#reason-chips .reason-chip').forEach(c=>c.classList.remove('selected'));
    chip.classList.add('selected');
  };
  const fgc=document.getElementById('fuellgrad-chips');
  if(fgc) fgc.onclick=e=>{ const chip=e.target.closest('[data-fg]'); if(!chip)return; fgc.querySelectorAll('.reason-chip').forEach(c=>c.classList.remove('selected')); chip.classList.add('selected'); };

  document.getElementById('sheet-footer').innerHTML=`
    <button class="btn btn-secondary" style="flex:1;" onclick="closeSheet()">Abbrechen</button>
    <button class="btn btn-primary" style="flex:2;" onclick="saveReport('${id}')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>
      Speichern & weiter
    </button>
  `;

  document.getElementById('sheet-backdrop').classList.add('open');
  document.getElementById('detail-sheet').classList.add('open');

  // Pan map to tree/geometry
  if(_np&&currentTab==='map') map.panTo(_np,{animate:true});
}

let _sheetStatus=null;
function selectStatus(s){
  _sheetStatus=s;
  document.getElementById('btn-ok').className='status-btn'+(s==='bewaessert'?' selected-ok':'');
  document.getElementById('btn-nok').className='status-btn'+(s==='nicht'?' selected-nok':'');
  document.getElementById('reason-section').style.display=s==='nicht'?'block':'none';
}

function closeSheet(){
  _sheetStatus=null;
  selectedTreeId=null;
  naviAutoNext=false; // Abbrechen/Schließen ohne Speichern → kein Auto-Weiter
  document.getElementById('sheet-backdrop').classList.remove('open');
  document.getElementById('detail-sheet').classList.remove('open');
}

async function saveReport(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  const wasNaviArrival=naviAutoNext; // vor closeSheet() merken
  const status=_sheetStatus||tree.lastStatus;
  const selectedChip=document.querySelector('.reason-chip.selected');
  const reason=selectedChip?selectedChip.dataset.reason:'';
  const note=document.getElementById('reason-custom')?.value||'';

  // Pflichtfeld: Grund bei "nicht bewässert"
  if(status==='nicht' && !reason && !note.trim()){
    const reasonSec=document.getElementById('reason-section');
    if(reasonSec){
      reasonSec.style.border='2px solid var(--red)';
      reasonSec.style.borderRadius='8px';
      reasonSec.style.padding='8px';
      reasonSec.style.background='var(--red-light)';
      setTimeout(()=>{
        reasonSec.style.border='';
        reasonSec.style.borderRadius='';
        reasonSec.style.padding='';
        reasonSec.style.background='';
      },2000);
    }
    toast('⚠ Bitte einen Grund angeben');
    return;
  }

  const zustand=document.getElementById('p-zustand')?.value||tree.zustand;
  const wasser=document.getElementById('p-wasser')?.value||tree.wasser;
  const notiz=document.getElementById('p-notiz')?.value||tree.notiz||'';
  let fuellgrad=null;
  if(currentProjectData?.fuellgradAktiv){
    const fgSel=document.querySelector('#fuellgrad-chips .reason-chip.selected');
    if(fgSel) fuellgrad=Number(fgSel.dataset.fg);
  }

  const updates={
    zustand,wasser,notiz,
    lastStatus:status||null,
    lastReason:reason||null,
    lastNote:note||null,
    lastDriver:currentDriver,
    lastReportAt:new Date().toISOString(),
  };
  if(status==='bewaessert') updates.datum=new Date().toISOString().slice(0,10);
  if(fuellgrad!=null) updates.lastFuellgrad=fuellgrad;

  const histEntry={
    date:new Date().toISOString().slice(0,10),
    note:`${status==='bewaessert'?'Bewässert':'Nicht bewässert'}${reason?' — '+reason:''}${note?' ('+note+')':''}${fuellgrad!=null?' · Füllgrad: '+fgLabel(fuellgrad):''}`,
    driver:currentDriver
  };
  if(fuellgrad!=null) histEntry.fuellgrad=fuellgrad;
  // Use arrayUnion — no need to read existing history first
  const firestoreUpdates={...updates, history: firebase.firestore.FieldValue.arrayUnion(histEntry)};
  const offlineUpdates={...updates, history:[...(tree.history||[]),histEntry]};

  // Update local state + close sheet immediately (optimistic UI)
  Object.assign(tree, updates);
  renderMarkers(); renderList(''); updateProgress();
  closeSheet();

  // Auto-Weiter: nach Melden aus einer Navi-Ankunft direkt zum nächsten Objekt navigieren
  if(wasNaviArrival){
    if(naviPickTarget()){ toast('Weiter zum nächsten Objekt…'); setTimeout(()=>naviStart(),700); }
    else { speak('Alle Objekte erledigt'); toast('Alle Objekte erledigt 🎉'); }
  }
  toast(status==='bewaessert'?'✓ Erledigt gemeldet':'✕ Nicht erledigt gemeldet');

  if(!isOnline){
    addToOfflineQueue(id, offlineUpdates);
    toast('📦 Offline gespeichert — wird synchronisiert wenn Netz verfügbar');
  } else {
    // Firestore write in background — UI already updated
    updateDoc(doc(db,'projects',currentProjectId,'trees',id), firestoreUpdates).then(()=>{
      setTimeout(()=>{
        const nextIdx=getNextIdx();
        if(nextIdx!==-1){
          const nextId=routeOrder[nextIdx];
          const next=trees.find(t=>t.id===nextId);
          const _nnp=navPoint(next); if(_nnp) map.panTo(_nnp,{animate:true,duration:0.8});
        }
      },800);
    }).catch(e=>{
      addToOfflineQueue(id, offlineUpdates);
      toast('📦 Offline gespeichert — wird später synchronisiert');
    });
  }
}


// ─── TABS ─────────────────────────────────────────────────────
function switchTab(t){
  currentTab=t;
  document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));
  document.getElementById('tab-'+t).classList.add('active');
  document.getElementById('tab-btn-'+t).classList.add('active');
  if(t==='map') setTimeout(()=>map.invalidateSize(),50);
}

// ─── TOAST ────────────────────────────────────────────────────
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),2500);
}

// ─── GLOBALS ──────────────────────────────────────────────────
// ─── LOGIN HELPERS ────────────────────────────────────────────
let _loginProjects = [];
let _loginTours = {};
let _cachedRouteSnap = null;

async function loadLoginProjects(){
  try{
    const snap = await getDocs(collection(db,'projects'));
    _loginProjects = snap.docs.map(d=>({id:d.id,...d.data()}));
    const sel = document.getElementById('login-project');
    sel.innerHTML='<option value="">– Projekt wählen –</option>'+
      _loginProjects.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    if(_loginProjects.length===1){
      sel.value=_loginProjects[0].id;
      // Pre-load tours for the only project immediately
      onLoginProjectChange();
    } else if(_loginProjects.length>0){
      // Pre-load tours for all projects in parallel
      const tourSnaps = await Promise.all(
        _loginProjects.map(p=>getDocs(collection(db,'projects',p.id,'tours')))
      );
      _loginProjects.forEach((p,i)=>{
        _loginTours[p.id] = tourSnaps[i].docs.map(d=>({id:d.id,...d.data()}));
      });
    }
  }catch(e){ console.error(e); }
}

async function onLoginProjectChange(){
  const pid = document.getElementById('login-project').value;
  const tourSel = document.getElementById('login-tour');
  const nameSel = document.getElementById('login-name');
  tourSel.innerHTML='<option value="">– Tour wählen –</option>';
  nameSel.innerHTML='<option value="">– Fahrer wählen –</option>';
  if(!pid) return;
  // Use cache if available, otherwise load
  if(!_loginTours[pid]){
    const snap = await getDocs(collection(db,'projects',pid,'tours'));
    _loginTours[pid] = snap.docs.map(d=>({id:d.id,...d.data()}));
  }
  tourSel.innerHTML='<option value="">– Tour wählen –</option>'+
    _loginTours[pid].map(t=>`<option value="${t.id}">${t.name}</option>`).join('');
  if(_loginTours[pid].length===1){
    tourSel.value=_loginTours[pid][0].id;
    await onLoginTourChange();
  }
}

async function onLoginTourChange(){
  const pid = document.getElementById('login-project').value;
  const tid = document.getElementById('login-tour').value;
  const nameSel = document.getElementById('login-name');
  nameSel.innerHTML='<option value="">– Fahrer wählen –</option>';
  if(!tid) return;
  const tours = _loginTours[pid]||[];
  const tour = tours.find(t=>t.id===tid);
  if(!tour) return;
  const drivers = tour.drivers || (tour.assignedDriver ? [tour.assignedDriver] : []);
  if(drivers.length>0){
    nameSel.innerHTML='<option value="">– Fahrer wählen –</option>'+
      drivers.map(d=>`<option value="${d}">${d}</option>`).join('');
    if(drivers.length===1) nameSel.value=drivers[0];
  }
}

// ─── OFFLINE MANAGER ─────────────────────────────────────────
const CACHE_KEY = 'bwt_offline_trees';
const QUEUE_KEY = 'bwt_offline_queue';
let isOnline = navigator.onLine;
let syncInProgress = false;
let _queueLen = 0;

// IndexedDB key-value store — ersetzt localStorage (von Edge Tracking Prevention blockiert)
const IDB_NAME = 'bwt_offline', IDB_STORE = 'kv';
let _idbPromise = null;
function idbOpen(){
  if(_idbPromise) return _idbPromise;
  _idbPromise = new Promise((resolve,reject)=>{
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = ()=>req.result.createObjectStore(IDB_STORE);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
  return _idbPromise;
}
async function idbGet(key){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const req = db.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(key);
    req.onsuccess = ()=>resolve(req.result);
    req.onerror = ()=>reject(req.error);
  });
}
async function idbSet(key,val){
  const db = await idbOpen();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(IDB_STORE,'readwrite');
    tx.objectStore(IDB_STORE).put(val,key);
    tx.oncomplete = ()=>resolve();
    tx.onerror = ()=>reject(tx.error);
  });
}

// Einmalige Migration alter localStorage-Daten → IndexedDB + Badge-Init
async function initOfflineStore(){
  try {
    const lsQueue = localStorage.getItem(QUEUE_KEY);
    if(lsQueue){ try{ await idbSet(QUEUE_KEY, JSON.parse(lsQueue)); }catch(e){} localStorage.removeItem(QUEUE_KEY); }
    const lsCache = localStorage.getItem(CACHE_KEY);
    if(lsCache){ try{ await idbSet(CACHE_KEY, JSON.parse(lsCache)); }catch(e){} localStorage.removeItem(CACHE_KEY); }
  } catch(e){}
  _queueLen = (await getOfflineQueue()).length;
  updateNetworkBadge();
}
initOfflineStore();

// Network status monitoring
window.addEventListener('online', ()=>{
  isOnline = true;
  updateNetworkBadge();
  syncOfflineQueue();
});
window.addEventListener('offline', ()=>{
  isOnline = false;
  updateNetworkBadge();
  toast('⚠ Kein Netz — Meldungen werden lokal gespeichert');
});

function updateNetworkBadge(){
  const badge = document.getElementById('network-badge');
  if(!badge) return;
  if(isOnline){
    badge.style.display = 'none';
  } else {
    badge.style.display = 'flex';
    badge.textContent = _queueLen > 0 ? `Offline · ${_queueLen} ausstehend` : 'Offline';
  }
}

// ── Local tree cache ──────────────────────────────────────────
async function cacheTreesLocally(projectId, tourId, treesData){
  try {
    await idbSet(CACHE_KEY, { projectId, tourId, trees: treesData, cachedAt: new Date().toISOString() });
  } catch(e){ console.warn('Cache write failed:', e); }
}

async function loadCachedTrees(projectId, tourId){
  try {
    const data = await idbGet(CACHE_KEY);
    if(data && data.projectId === projectId && data.tourId === tourId) return data.trees;
  } catch(e){}
  return null;
}

// ── Offline queue ─────────────────────────────────────────────
async function getOfflineQueue(){
  try { return (await idbGet(QUEUE_KEY)) || []; }
  catch(e){ return []; }
}

async function addToOfflineQueue(treeId, updates){
  const q = await getOfflineQueue();
  // Replace existing entry for same tree (latest wins)
  const idx = q.findIndex(e=>e.treeId===treeId);
  const entry = { treeId, updates, projectId: currentProjectId, queuedAt: new Date().toISOString() };
  if(idx>=0) q[idx] = entry;
  else q.push(entry);
  await idbSet(QUEUE_KEY, q);
  _queueLen = q.length;
  updateNetworkBadge();
}


async function syncOfflineQueue(){
  if(syncInProgress || !isOnline) return;
  const q = await getOfflineQueue();
  if(q.length === 0) return;

  syncInProgress = true;
  const badge = document.getElementById('network-badge');
  if(badge){ badge.style.display='flex'; badge.textContent=`Synchronisiert ${q.length}…`; }

  let synced = 0;
  const failed = [];

  for(const entry of q){
    try {
      await updateDoc(
        doc(db,'projects',entry.projectId,'trees',entry.treeId),
        entry.updates
      );
      synced++;
    } catch(e){
      console.warn('Sync failed for', entry.treeId, e);
      failed.push(entry);
    }
  }

  await idbSet(QUEUE_KEY, failed);
  _queueLen = failed.length;
  syncInProgress = false;

  if(synced > 0){
    toast(`✓ ${synced} Meldung${synced>1?'en':''} synchronisiert`);
  }
  updateNetworkBadge();
}


async function tryResumeSession() {
  const loadingEl = document.getElementById('screen-loading');
  const loginEl   = document.getElementById('screen-login');

  function showLogin(){
    if(loadingEl) loadingEl.style.display='none';
    if(loginEl)   loginEl.classList.add('active');
    // Vorbelegung aus letztem Login
    try{ const oc=localStorage.getItem('bwt_mobile_orgcode'); if(oc){ const e=document.getElementById('login-orgcode'); if(e) e.value=oc; } const nm=localStorage.getItem('bwt_mobile_name'); if(nm){ const e=document.getElementById('login-name'); if(e) e.value=nm; } }catch(_){}
  }

  // Always show login — session resume disabled (localStorage blocked by Edge Tracking Prevention)
  showLogin();
}

// Safety fallback — show login after 5s if still loading
setTimeout(()=>{
  const loading = document.getElementById('screen-loading');
  const login   = document.getElementById('screen-login');
  if(loading && loading.style.display !== 'none'){
    loading.style.display = 'none';
    if(login) login.classList.add('active');
  }
}, 800);

// Init
tryResumeSession();


// ─── EVENT LISTENERS (replaces all inline onclick/onchange) ──────
document.addEventListener('DOMContentLoaded', () => {
  // Login (Stadt-Code + Name + PIN)
  document.getElementById('btn-login').addEventListener('click', doLogin);
  const _pin=document.getElementById('login-pin');
  if(_pin) _pin.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });

  // App header
  const btnLogout = document.getElementById('btn-logout');
  if(btnLogout) btnLogout.addEventListener('click', doLogout);

  // Map controls
  const btnRecalc = document.getElementById('btn-recalc');
  if(btnRecalc) btnRecalc.addEventListener('click', recalcFromGPS);
  naviInit(); // Navi-Button + Banner injizieren

  const btnToggleRoute = document.getElementById('btn-toggle-route');
  if(btnToggleRoute) btnToggleRoute.addEventListener('click', toggleRouteVisibility);
  const pill = document.getElementById('map-progress-pill');
  if(pill) pill.addEventListener('click', goToNextTree);

  // Tab bar
  const tabMapBtn = document.getElementById('tab-btn-map');
  if(tabMapBtn) tabMapBtn.addEventListener('click', () => switchTab('map'));
  const tabListBtn = document.getElementById('tab-btn-list');
  if(tabListBtn) tabListBtn.addEventListener('click', () => switchTab('list'));

  // Resume dialog
  const btnNeu = document.getElementById('btn-neu-starten');
  if(btnNeu) btnNeu.addEventListener('click', dialogNeuStarten);
  const btnFort = document.getElementById('btn-fortsetzen');
  if(btnFort) btnFort.addEventListener('click', dialogFortsetzen);

  // Bulk sheet
  const bulkBackdrop = document.getElementById('bulk-backdrop');
  if(bulkBackdrop) bulkBackdrop.addEventListener('click', closeBulkSheet);

  // Sheet backdrop
  const sheetBackdrop = document.getElementById('sheet-backdrop');
  if(sheetBackdrop) sheetBackdrop.addEventListener('click', closeSheet);

  // Header action buttons
  const btnMarkAll = document.getElementById('btn-mark-all-done');
  if(btnMarkAll) btnMarkAll.addEventListener('click', markAllDone);
  const btnFinish = document.getElementById('btn-show-finish');
  if(btnFinish) btnFinish.addEventListener('click', showFinishConfirm);
});

// ─── ROUTE TOGGLE ─────────────────────────────────────────────
let _routeVisible = true;
function toggleRouteVisibility(){
  _routeVisible = !_routeVisible;
  const btn = document.getElementById('btn-toggle-route');
  if(_routeVisible){
    // Route wieder einblenden
    drawRoute();
    if(btn){ btn.style.background='var(--surface)'; btn.style.color='var(--green)'; btn.style.borderColor='var(--green)'; }
  } else {
    // Route ausblenden
    if(routeLayer){
      if(Array.isArray(routeLayer)) routeLayer.forEach(l=>map.removeLayer(l));
      else map.removeLayer(routeLayer);
      routeLayer=null;
    }
    if(depotMarker){ map.removeLayer(depotMarker); depotMarker=null; }
    if(btn){ btn.style.background='var(--surface2)'; btn.style.color='var(--text3)'; btn.style.borderColor='var(--border)'; }
  }
}

// Expose functions used in inline onclick handlers (static + dynamically generated)
Object.assign(window, {
  selectStatus, closeSheet, saveReport,
  closeFinishSheet, finishTour, reopenTour,
  showFinishConfirm, markAllDone,
  switchTab,
  confirmMarkAllDone, closeBulkSheet,
  renderList,
  doLogin, doLogout,
  onLoginProjectChange, onLoginTourChange,
  recalcFromGPS, goToNextTree,
  dialogNeuStarten, dialogFortsetzen,
  closeResumeDialog,
});