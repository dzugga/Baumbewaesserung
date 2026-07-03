// App-Version – hier zentral pflegen (wird im Einstellungen-Panel angezeigt)
const APP_VERSION = '1.0';

import { HANDBUCH } from './handbuch-daten.js';
import { installErrorHandler } from './errlog.js'; installErrorHandler('desktop');
import { SI_DSGVO, SI_STACK, SI_REGIONEN, SI_APPS, SI_SICHERHEIT, SI_DIENSTE } from './systeminfo-daten.js';
import { initAppCheck } from './appcheck.js';
import { basemapLayer, BASEMAP_FARBE, BASEMAP_GRAU, BASEMAP_ATTR } from './basemaps.js';
import { firebaseConfig } from './firebase-config.js';
import { esc as dlEsc } from './esc.js'; // dlEsc = projektweites HTML-Escape (zentral in esc.js)
// Escaper für Zeichenketten, die als JS-String-Argument in einem Inline-Handler stehen
// (Handler-Attribut ruft eine Funktion mit einfach-quotiertem Argument auf). dlEsc allein genügt
// NICHT: der HTML-Parser dekodiert &#39; im Attribut zurück zu ' → die Zeichenkette bricht aus dem
// JS-String aus (Code-Injection durch DB-Werte mit Apostroph). Hier zusätzlich JS-Escape (\\ \' \n).
// Kontext: doppelt-quotiertes Attribut, JS-String single-quoted.
function _jsArg(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n')
    .replace(/"/g,'&quot;');
}
import { titelOf as orTitel, ELEM_GRUPPE_ORDER, ELEM_GRUPPE_LABEL, haeufigkeitOf as orHaeuf, objektartOf as orObjektart, lageOf as orLage } from './objektrollen.js'; // zentrale Rollen (Objekt + Lage, Reinigungs-Häufigkeit)
import { initVersionCheck } from './version-check.js';
initVersionCheck();   // erkennt neue Deploys während die App offen ist → „Neu laden"-Banner

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
// Sicherheits-Bestätigung vor dem Löschen: der Name muss exakt eingetippt werden (wie „Tour/Projekt löschen").
// Aufruf: if(!await confirmByName({label:'Fahrer', name:p.name, warn:'…'})) return;
// Ohne Namen (name leer) muss das Wort „LÖSCHEN" getippt werden. Vergleich getrimmt & ohne Groß/Kleinschreibung.
function confirmByName(opts){
  opts=opts||{};
  const expected=(opts.name||'').trim();
  const typed=expected||'LÖSCHEN';
  const title=opts.title||((opts.label?opts.label+' ':'')+'löschen');
  const warn=opts.warn||((opts.label?dlEsc(opts.label):'Der Eintrag')+' <b style="color:var(--text);">'+dlEsc(typed)+'</b> wird endgültig gelöscht. Das kann nicht rückgängig gemacht werden.');
  return new Promise(resolve=>{
    const modal=document.createElement('div');
    modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100050;display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:400px;max-width:92vw;overflow:hidden;">
      <div style="padding:18px 20px 10px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;color:var(--red);">⚠ ${dlEsc(title)}</div>
      <div style="padding:14px 20px 6px;font-size:13px;color:var(--text2);line-height:1.6;">${warn}</div>
      <div style="padding:6px 20px 10px;">
        <input id="cbn-input" class="form-control" placeholder="${expected?'Name zur Bestätigung eingeben':'LÖSCHEN eingeben'}" style="border-color:var(--red-light,#f3b4b4);" autocomplete="off">
        <div style="font-size:11px;color:var(--text3);margin-top:4px;">Gib <b>${dlEsc(typed)}</b> ein, um zu bestätigen.</div>
      </div>
      <div style="padding:12px 20px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
        <button id="cbn-cancel" style="padding:7px 16px;border:1.5px solid var(--border);border-radius:6px;background:var(--surface);cursor:pointer;font-size:13px;font-weight:600;">Abbrechen</button>
        <button id="cbn-ok" style="padding:7px 16px;border:none;border-radius:6px;background:var(--red);color:#fff;cursor:pointer;font-size:13px;font-weight:600;opacity:0.4;" disabled>${dlEsc(opts.confirmText||'Löschen')}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const input=modal.querySelector('#cbn-input'), ok=modal.querySelector('#cbn-ok');
    const match=()=>input.value.trim().toLowerCase()===typed.toLowerCase();
    input.oninput=()=>{ ok.disabled=!match(); ok.style.opacity=ok.disabled?'0.4':'1'; };
    const done=v=>{ modal.remove(); resolve(v); };
    modal.querySelector('#cbn-cancel').onclick=()=>done(false);
    ok.onclick=()=>{ if(match()) done(true); };
    input.onkeydown=e=>{ if(e.key==='Enter'&&match()) done(true); else if(e.key==='Escape') done(false); };
    modal.onclick=e=>{ if(e.target===modal) done(false); };
    setTimeout(()=>input.focus(),50);
  });
}
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
// Kräftige, klar unterscheidbare Palette über den ganzen Farbkreis; so geordnet,
// dass benachbarte Felder stark abweichen. Alle mitteltonig → gut auf der Karte sichtbar.
const TOUR_COLORS=[
  '#d11149','#27ae60','#2980b9','#e67e22','#7c3aed','#16a085','#c71585',
  '#808000','#d4ac0d','#3f51b5','#d81b60','#9a6324','#1099a8','#5d6d7e',
  '#e74c3c','#1e8449','#1e40af','#f58231','#6c3483','#0e7d6e','#ad1457',
  '#6b8e23','#b8860b','#283593','#ec407a','#784212','#0e7490','#34495e'
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
// Übersichten (z.B. Stadtteil-Touren) sind keine „echten" Touren: kein Marker-Zähler,
// keine Routenberechnung, auf der Karte standardmäßig ausgeblendet.
function isOverviewTour(tourId){ const t=tours.find(x=>x.id===tourId); return !!(t&&t.uebersicht); }
// ── Tour-Rhythmus: läuft die Tour an einem Datum? ──
function _daysBetween(a,b){ const [ay,am,ad]=a.split('-').map(Number),[by,bm,bd]=b.split('-').map(Number); return Math.round((Date.UTC(by,bm-1,bd)-Date.UTC(ay,am-1,ad))/86400000); }
function _tourInValidity(t,date){ const g=t&&t.gueltig; if(!Array.isArray(g)||!g.length) return true; return g.some(p=>p&&p.from<=date&&p.to>=date); }
function tourDueOn(t,date){
  if(!t || !_tourInValidity(t,date)) return false;
  if(t.saison && saisonFor(date)!==t.saison) return false; // Sommer-/Winter-Tour: nur in der passenden Saison fällig
  const iv=t.interval||'';
  if(iv==='bedarf') return false;            // Bedarfstour: nie automatisch fällig
  if(!iv||!t.startDate) return true;          // ohne Intervall/Startdatum: immer fällig (Bestand)
  if(date<t.startDate) return false;
  if(iv==='taeglich') return true;
  const d=_daysBetween(t.startDate,date);
  return iv==='woechentlich'?d%7===0:iv==='14taeglich'?d%14===0:iv==='4woechentlich'?d%28===0:true;
}
function realTourIds(tree){ return getTreeTourIds(tree).filter(id=>!isOverviewTour(id)); } // ohne Übersichten
function treeInTour(tree, tourId){
  return getTreeTourIds(tree).includes(tourId);
}
// Archiv: tree.aktiv===false → inaktiv (gefällt/abgegangen). Default = aktiv.
function isActive(tree){ return !tree || tree.aktiv!==false; }
function primaryTour(tree){
  // Übersichten bestimmen NICHT die Standardfarbe — sonst erschiene ein nur einer
  // Stadtteil-Übersicht zugeordnetes (real unverplantes) Objekt eingefärbt statt grau.
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
// Pro Rolle zuweisbare Module = die operativen Reiter. NICHT enthalten (bewusst nur Superadmin):
// das ganze „Admin"-Menü (Benutzer/Rollen, Projekte, Nutzung, Mandanten, Allgemein/ORS, KI-Config)
// sowie System & Compliance. Diese sind in der Nav per __superadmin__ gegated.
const MODULES = [
  {key:'planung',     label:'Planung (Karte)'},
  {key:'disposition', label:'Disposition (automatisiert)'},
  {key:'einsatzplaner', label:'Einsatzplaner'},
  {key:'dashboard',   label:'Dashboard'},
  {key:'controlling', label:'Controlling'},
  {key:'ki',          label:'KI-Analysen'},
  {key:'objekte',     label:'Objekte'},
  {key:'touren',      label:'Touren'},
  {key:'verwaltung',  label:'Gründe'},
  {key:'wms',         label:'WMS-Karten'},
  {key:'import',      label:'Import'},
  {key:'erfassung',   label:'Erfassungs-App ↗'},
  {key:'mobil',       label:'Fahrer-App (Mobil) ↗'},
  {key:'einsatzleiter', label:'Einsatzleiter-App ↗'},
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
  planer:     {name:'Planer',     baseType:'editor', modules:_mods(['planung','disposition','einsatzplaner','dashboard','controlling','ki','objekte','touren','import','wms','einsatzleiter']), builtin:true},
  erfasser:   {name:'Erfasser',   baseType:'editor', modules:_mods(['erfassung','objekte']), builtin:true},
  fahrer:     {name:'Fahrer',     baseType:'driver', modules:_mods(['mobil']), builtin:true},
};
let rolesCache = {};   // roleKey -> {name, baseType, modules, builtin}
function roleModules(roleKey){ const r=rolesCache[roleKey]||BUILTIN_ROLES[roleKey]; return r?r.modules:{}; }
// Modul projektscharf abschaltbar: projects/{id}.modules[key]===false → aus (fehlt/true → an).
function projectAllowsModule(key){ const m=currentProjectData&&currentProjectData.modules; return !m || m[key]!==false; }
function canUseModule(key){
  if(!projectAllowsModule(key)) return false;   // Projekt-Gate gilt auch für Superadmin (Reiter spiegelt das Projekt)
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
// „Nicht verplant" = in keiner ECHTEN Tour (Übersichten zählen nicht als Verplanung)
function treeIsUnplanned(t){ return isActive(t) && !_isContainer(t) && realTourIds(t).length===0; } // Abschnitt-Container sind nicht tour-planbar → zählen nicht als „nicht verplant"
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
// Cluster nur, wenn der Projekt-Schalter an ist UND keine Tour ausgewählt ist
// (in der Touransicht stören Cluster die Reihenfolge/Übersicht).
function _effectiveCluster(){ return !!(currentProjectData&&currentProjectData.clusterAktiv) && activeTours.size===0 && !_isCheckMode(_colorMode); }

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
let currentOrgWms = []; // mandantenweite WMS-Standardliste (orgs/{id}.wmsDefaults) — vor getWmsLayers deklariert (sonst TDZ beim frühen Karten-Aufbau)
// WMS projektscharf: liegt am Projekt (projects/{id}.wmsLayers) — bewusst NICHT am Mandanten,
// damit Projekte derselben Stadt (z. B. Grünpflege vs. Behälterleerung) eigene Karten haben.
// Effektive WMS-Ebenen = Stadt-Standard (orgs/{id}.wmsDefaults) + projekteigene; dedup nach id (Projekt gewinnt).
// _scope kennzeichnet die Herkunft (für Verwaltung/Anzeige), wird beim Speichern wieder entfernt.
function getWmsLayers(){
  const proj=Array.isArray(currentProjectData?.wmsLayers)?currentProjectData.wmsLayers.map(x=>({...x,_scope:'project'})):[];
  const org=(currentOrgWms||[]).map(x=>({...x,_scope:'org'}));
  const pid=new Set(proj.map(x=>x.id));
  return [...org.filter(o=>!pid.has(o.id)), ...proj];
}
function saveWmsLayers(arr){
  if(!currentProjectId){ notify('Kein Projekt geöffnet'); return; }
  if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Administratoren'); return; }
  saveProjectSettings({wmsLayers:arr.map(({_scope,...x})=>({...x}))}).catch(e=>notify(dlErr(e)));
}
// Stadt-Standard speichern (nur Superadmin; Org-Doc-Direktschreiben wie bei „Stadt anlegen").
async function saveOrgWms(arr){
  const org=currentProjectData?.orgId;
  if(!org){ notify('Kein Mandant aktiv'); return; }
  if(currentRole!=='superadmin'){ notify('Stadt-Standard nur durch Superadmin'); return; }
  const clean=arr.map(({_scope,...x})=>({...x}));
  await db.collection('orgs').doc(org).update({wmsDefaults:clean});
  currentOrgWms=clean.map(x=>({...x}));
}
function buildWmsLayer(cfg){
  return L.tileLayer.wms(cfg.url, {
    layers:cfg.layers, format:cfg.format||'image/png', version:cfg.version||'1.3.0',
    transparent:!!cfg.transparent, maxZoom:cfg.maxZoom||20, attribution:cfg.attribution||''});
}

let wmsLayerInstances={}; // id -> aktuelle Leaflet-Ebene
let _basemaps={}, _overlayLayers={}; // Anzeigename -> Leaflet-Ebene (für die Chip-Leiste)
let _basemapDefaultApplied='__init__'; // Projekt-Standardkarte einmal je Projekt-Öffnen anwenden
let _displayDefaultsApplied='__init__'; // Darstellungs-Standard einmal je Projekt-Öffnen anwenden
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
  // Projekt-Standardkarte beim Öffnen anwenden (einmal je Projekt; überschreibt die initiale „Karte")
  if(_basemapDefaultApplied!==currentProjectId){
    _basemapDefaultApplied=currentProjectId;
    let pref=null; try{ pref=localStorage.getItem('bwt_basemap_'+currentProjectId); }catch(_){} // persönliche Wahl (pro Anwender/Gerät)
    const def=pref || currentProjectData?.defaultBasemap;                                       // sonst Projekt-Standard
    if(def && _basemaps[def]){ Object.values(_basemaps).forEach(l=>map.removeLayer(l)); _basemaps[def].addTo(map); customBaseActive=true; }
  }
  if(customBaseActive){ map.removeLayer(baseFarbe); map.removeLayer(baseGrau); }
  else if(!map.hasLayer(baseFarbe)&&!map.hasLayer(baseGrau)){ baseFarbe.addTo(map); } // Standard: Karte (Farbe)
  renderBasemapSwitcher();
  _applyDisplayDefaults(); // gespeicherte Sichtbarkeit/Einfärbung/Versatz beim Projekt-Öffnen anwenden
}
// Karten-Auswahl: aufklappbares Panel über dem Karten-Button unten links
function closeBasemapPanel(){
  const p=document.getElementById('basemap-panel'), b=document.getElementById('basemap-btn');
  if(p) p.style.display='none'; if(b) b.classList.remove('open');
}
function renderBasemapSwitcher(){
  const panel=document.getElementById('basemap-panel'); if(!panel) return;
  const ro=isReadonly(); const def=currentProjectData?.defaultBasemap;
  const baseNames=Object.keys(_basemaps);
  let activeBase=baseNames.find(n=>map.hasLayer(_basemaps[n]));
  if(!activeBase){ _basemaps['Karte'].addTo(map); activeBase='Karte'; }
  const _q=s=>(s+'').replace(/"/g,'&quot;');
  const star=n=> ro?'' : `<span data-setdefault="${_q(n)}" title="${n===def?'Standardkarte dieses Projekts':'Als Standardkarte für dieses Projekt setzen'}" style="cursor:pointer;padding:0 3px;font-size:14px;line-height:1;color:${n===def?'var(--green)':'var(--text3)'};">${n===def?'★':'☆'}</span>`;
  const optBase=(n,act)=>`<div data-base="${_q(n)}" class="bm-opt${act?' active':''}"><svg class="chk" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(n)}</span>${star(n)}</div>`;
  const opt=(label,attr,act)=>`<button ${attr} class="bm-opt${act?' active':''}"><svg class="chk" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(label)}</span></button>`;
  let html=`<div class="bm-plabel">Hintergrundkarte</div>`;
  html+=baseNames.map(n=>optBase(n,n===activeBase)).join('');
  const ovNames=Object.keys(_overlayLayers);
  if(ovNames.length) html+=`<div class="bm-plabel" style="margin-top:3px;border-top:1px solid var(--border);padding-top:6px;">Zusatz-Ebenen</div>`+ovNames.map(n=>opt(n,`data-overlay="${_q(n)}"`,map.hasLayer(_overlayLayers[n]))).join('');
  if(!ro) html+=`<div style="font-size:10px;color:var(--text3);padding:6px 8px 0;border-top:1px solid var(--border);margin-top:4px;line-height:1.4;">★ = Projekt-Standard (für alle) · Karte anklicken = nur für dich</div>`;
  panel.innerHTML=html;
  panel.onclick=e=>{
    const sd=e.target.closest('[data-setdefault]');
    if(sd){ e.stopPropagation(); setDefaultBasemap(sd.dataset.setdefault); return; }
    const b=e.target.closest('[data-base]'), o=e.target.closest('[data-overlay]');
    if(b){ const n=b.dataset.base; if(_basemaps[n]){ Object.values(_basemaps).forEach(l=>map.removeLayer(l)); _basemaps[n].addTo(map); try{ if(currentProjectId) localStorage.setItem('bwt_basemap_'+currentProjectId, n); }catch(_){} renderBasemapSwitcher(); closeBasemapPanel(); } }
    else if(o){ const n=o.dataset.overlay, l=_overlayLayers[n]; if(l){ map.hasLayer(l)?map.removeLayer(l):l.addTo(map); renderBasemapSwitcher(); } }
  };
}
async function setDefaultBasemap(name){
  if(isReadonly()||!currentProjectId) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{defaultBasemap:name});
    if(currentProjectData) currentProjectData.defaultBasemap=name;
    notify('✓ „'+name+'" als Standardkarte gesetzt');
    renderBasemapSwitcher();
  }catch(e){ console.warn('setDefaultBasemap',e); notify(dlErr(e)); }
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
  let docs=_psOrgFilter?_psDocs.filter(d=>d.data().orgId===_psOrgFilter):_psDocs;
  // Superadmin: nach Mandant (alphabetisch), dann Projektname sortieren
  if(currentRole==='superadmin'){
    const oName=d=>(_psOrgNames[d.data().orgId]||d.data().orgId||'').toLowerCase();
    docs=[...docs].sort((a,b)=>oName(a).localeCompare(oName(b))||(a.data().name||'').localeCompare(b.data().name||''));
  }
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
    // Superadmin: Mandant als linke Spalte (zuerst Mandant, dann Projekt) — Projektname muss nicht der Stadtname sein
    const orgName=_psOrgNames[data.orgId]||data.orgId||'ohne Mandant';
    const orgCol=currentRole==='superadmin'
      ? `<span title="${dlEsc(orgName)}" style="flex-shrink:0;width:140px;font-size:11px;font-weight:700;background:var(--green-light);color:var(--green);padding:4px 10px;border-radius:99px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:center;">${dlEsc(orgName)}</span>`
      : '';
    return `<div class="ps-item" onclick="openProject('${d.id}')">
      ${orgCol}
      <div class="ps-item-icon">${data.icon||'🌳'}</div>
      <div class="ps-item-info">
        <div class="ps-item-name">${dlEsc(data.name||'')}</div>
        <div class="ps-item-meta">${meta}</div>
      </div>
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
  if(_flaechenLayer){ map.removeLayer(_flaechenLayer); _flaechenLayer=null; } _flaechenLayerKey=''; _flaechenBundle=null; _flaechenBundleKey=''; // Flächen des alten Projekts verwerfen
  currentProjectId=projectId;
  window._tourHistoryCache=null;   // Historie des alten Projekts verwerfen
  _dataViewProject=null;           // Controlling/Dashboard für neues Projekt neu aufbauen
  // Suchfelder der vorigen Stadt zurücksetzen
  ['search-input','baeume-search','tour-legend-search'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  { const sc=document.getElementById('search-clear'); if(sc) sc.style.display='none'; }
  tourLegendQuery='';
  document.getElementById('detail-panel')?.classList.remove('open'); selectedTreeId=null; // offenes Objekt-Detail des alten Projekts schließen (kein stehengebliebener Füllgrad/Wert)
  // Planen-Modus, Tour-Auswahl und Routen-Panel des ALTEN Projekts zurücksetzen (sonst bleiben Planungsleiste/Zeiten hängen)
  _lassoActive=false; assignMode=false; lassoMode=false; lassoDrawing=false; lassoPoints=[]; assignTourId=null; lassoTourId=null;
  if(lassoSelection&&lassoSelection.size) lassoSelection.clear();
  activeTours.clear(); showUnplanned=false; activeTourOnMap=null;
  Object.values(tourRoutes).forEach(r=>{ try{ map.removeLayer(r.layer); }catch(_){} }); tourRoutes={};
  document.getElementById('assign-lasso-banner')?.classList.remove('visible');
  document.getElementById('lasso-action-bar')?.classList.remove('visible');
  document.getElementById('lasso-canvas')?.classList.remove('active');
  { const _sri=document.getElementById('sidebar-route-info'); if(_sri) _sri.style.display='none'; }
  document.getElementById('route-info-bar')?.classList.remove('visible');
  if(map) map.getContainer().style.cursor='';
  const snap=await getDoc(doc(db,'projects',projectId));
  currentProjectData={id:projectId,...snap.data()};
  _pilotShowAll=false; // Pilot-„alle anzeigen" ist eine lokale Superadmin-Ansicht, pro Projekt zurücksetzen
  _listMode = currentProjectData.listAbschnitteDefault ? 'abschnitte' : 'objekte'; // Listen-Standard je Projekt
  document.getElementById('active-project-name').textContent=currentProjectData.name;
  // Mandant neben dem Projektnamen (gecacht, max. 1 Read)
  const apOrg=document.getElementById('active-project-org');
  if(apOrg){ apOrg.textContent=''; const _oid=currentProjectData.orgId; if(_oid) orgDisplayName(_oid).then(n=>{ if(n&&currentProjectData?.orgId===_oid) apOrg.textContent='· '+n; }); }
  document.getElementById('project-screen').style.display='none';
  loadFieldLabels();
  loadListValues();
  applyModulePermissions(); // Reiter-Sichtbarkeit projektscharf neu setzen (projects.modules)
  // Ist die offene Ansicht im neuen Projekt abgeschaltet → zurück zur Karte
  { const vm={disposition:'disposition',controlling:'controlling',ki:'ki',dashboard:'dashboard',baeume:'objekte',touren:'touren',wmskarten:'wms',verwaltung:'verwaltung',einsatzplaner:'einsatzplaner'}[currentView];
    if(vm && !canUseModule(vm)) switchView('karte'); }
  // Einsatzplaner folgt dem global geöffneten Projekt: eigene Mandant/Projekt-Auswahl neu auf das offene Projekt setzen
  if(currentView==='einsatzplaner'){ _epOrg=''; _epProject=''; initEinsatzplaner(); }
  applyClusterMode(_effectiveCluster(), false); // Marker-Zielebene fürs Projekt (vor erstem Marker-Render) — Cluster nur ohne Tour-Auswahl
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
    const _prevColor=tours.reduce((m,t)=>{m[t.id]=t.color;return m;},{});
    tours=snap.docs.map(d=>({id:d.id,...d.data()}));
    // Tourfarbe geändert → Marker + Geometrie-Objekte (Fläche/Strecke/Abschnitt) neu einfärben.
    // Nur bei echtem Farbwechsel, damit reine Status-Updates (Fahrer-App) keine teure Neuzeichnung auslösen.
    const _colorChanged=tours.some(t=>_prevColor[t.id]!==undefined && _prevColor[t.id]!==t.color);
    renderFilters();renderList();renderLegend();
    if(_colorChanged){ try{ refreshMarkers(); }catch(_){} try{ _applyFlaechenSelection(); }catch(_){} try{ loadSavedRoutes(); }catch(_){} }
    if(currentView==='touren') renderTourenGrid();
    if(currentView==='benutzer') renderDriverMgmt();
    syncDataViewToProject();
    maybeHealCount('tourCount',tours.length);
    setSyncState('ok','Synchronisiert');
  });

  const treesRef=collection(db,'projects',currentProjectId,'trees');
  unsubTrees=onSnapshot(treesRef,snap=>{
    _allTrees=snap.docs.map(d=>({id:d.id,...d.data()}));
    maybeHealCount('treeCount',_allTrees.length); // echter Projekt-Gesamtstand (vor Pilot-Filter)
    trees=_applyPilotScope(_allTrees);             // Pilot-Bereich: Arbeitsmenge ggf. auf Ausschnitt eingrenzen
    if(_suppressTreeRender){
      _pendingTreeRender=true; // Massen-Schreibvorgang läuft — EIN Render am Ende statt je Batch
    }else{
      const changes=snap.docChanges();
      // Erstladung/Projektwechsel (alles neu) → Voll-Aufbau; sonst nur Geändertes anfassen
      if(Object.keys(mapMarkers).length===0 || changes.length>=snap.size) refreshMarkers();
      else { diffMarkers(changes); try{ renderDrawnGeoms(); }catch(_){} } // gezeichnete Geometrie bei Teil-Updates mitziehen
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

// Zeitaufwand eines Objekts je Objektart: Punkt = min/Stück (arten[].zeitaufwand, sonst Projekt-Standard);
// Linie = min/100 m (zeitaufwandM) × Länge; Fläche = min/100 m² (zeitaufwandM2) × Fläche. Ohne passenden Satz: 0.
function artBewMin(tree){
  const a=(tree.artId&&artenList.find(x=>x.id===tree.artId))||artenList.find(x=>x.name===(tree.art||'').trim());
  const gt=geomTypeOf(tree), menge=_effMenge(tree);
  if(gt==='linie'){ const r=a&&a.zeitaufwandM; return (typeof r==='number'&&r>0&&menge>0)?r*menge/100:0; }
  if(gt==='flaeche'){ const r=a&&a.zeitaufwandM2; return (typeof r==='number'&&r>0&&menge>0)?r*menge/100:0; }
  const v=a&&a.zeitaufwand;
  return (typeof v==='number'&&v>0)?v:getBewDuration();
}
// Bearbeitungsminuten: Tree-Array → Summe je Art; Zahl → Anzahl × Standard (Abwärtskompat.)
function bewMinutes(arg){
  if(Array.isArray(arg)) return arg.reduce((s,t)=>s+artBewMin(t),0);
  return (arg||0)*getBewDuration();
}
function fmtBewTime(arg){
  const mins=Math.round(bewMinutes(arg));
  const h=Math.floor(mins/60), m=mins%60;
  return h>0?`${h}h ${m}min`:`${m} min`;
}
function fmtTotalTime(driveSec,arg,extraMin){
  const total=Math.round(driveSec/60)+Math.round(bewMinutes(arg))+(extraMin||0);
  const h=Math.floor(total/60), m=total%60;
  return h>0?`${h}h ${m}min`:`${m} min`;
}
// Minuten (auch negativ) als "Xh Ymin" formatieren — für Arbeits-/Restzeit.
function fmtMin(mins){
  const neg=mins<0, a=Math.abs(Math.round(mins));
  const h=Math.floor(a/60), m=a%60;
  return (neg?'-':'')+(h>0?`${h}h ${m}min`:`${m} min`);
}
// Summe der Zusatztätigkeiten einer Tour (Pause, Rüstzeit …) in Minuten.
function tourZusatzMin(tour){ return (tour&&Array.isArray(tour.zusatzzeiten)?tour.zusatzzeiten:[]).reduce((s,z)=>s+(Math.max(0,z&&z.min)||0),0); }
// Restzeit einer Tour: Arbeitszeit − (Fahrt + Bearbeitung + Zusatztätigkeiten).
// null, wenn keine Arbeitszeit gesetzt ist.
function tourRestzeit(tour,treeList,driveSec){
  const az=tour&&tour.arbeitszeitMin;
  if(!(typeof az==='number'&&az>0)) return null;
  const driveMin=Math.round((driveSec||0)/60);
  const bewMin=Math.round(bewMinutes(treeList||[]));
  const zusMin=tourZusatzMin(tour);
  const usedMin=driveMin+bewMin+zusMin;
  return {azMin:az,driveMin,bewMin,zusMin,usedMin,restMin:az-usedMin};
}

// ─── TOUR-RESTRIKTION (Zuordnungsregeln je Tour) ─────────────────
// Welche Listenfelder lassen sich als Tour-Regel nutzen (mit Beschriftung).
// Element (Seite) eines Objekts auf eine Kategorie abbilden (Fahrbahn/Gehweg/… — ohne links/rechts),
// damit eine Tour-Regel „nur Fahrbahn" beide Fahrbahn-Seiten trifft.
function _elemCategory(el){ if(!el) return ''; const k=String(el).toLowerCase();
  if(k.startsWith('fahrbahn')) return 'Fahrbahn';
  if(k.startsWith('gehweg')) return 'Gehweg';
  if(k.startsWith('radweg')) return 'Radweg';
  if(k.startsWith('parkstreif')) return 'Parkstreifen';
  if(k.startsWith('grün')||k.startsWith('gruen')) return 'Grünstreifen';
  return el; }
function tourRuleFieldDefs(){
  const defs=[
    {key:'stadtteil',label:FL.stadtteil},
    {key:'art',label:FL.art},
    {key:'pflanzjahr',label:FL.pflanzjahr},
    {key:'pflanzzeitpunkt',label:FL.pflanzzeitpunkt},
    {key:'zustand',label:FL.zustand},
    {key:'wasser',label:FL.wasser},
  ];
  // Segment-Projekte: Seite/Element (Fahrbahn/Gehweg …) + Geometrietyp als Regelfelder (z. B. Kehrmaschine = nur Fahrbahn)
  if((trees||[]).some(t=>t.element||t.containerExtId)) defs.push({key:'element',label:'Seite (Fahrbahn/Gehweg)'});
  if(_geomActive()) defs.push({key:'geomType',label:'Geometrietyp'});
  (customFields||[]).filter(c=>c&&c.aktiv!==false&&c.key).forEach(c=>defs.push({key:c.key,label:c.label||c.key}));
  return defs;
}
// Auswählbare Werte eines Regelfeldes — in derselben Repräsentation wie am Objekt gespeichert
// (zustand/wasser: ID; alle anderen: Label).
function ruleFieldOptions(key){
  if(isRankField(key)) return rankList(key).map(e=>({val:e.id,label:e.label,color:e.farbe}));
  if(key==='art') return [...artenList].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(a=>({val:a.name,label:a.name}));
  if(key==='element'){ const cats=[...new Set((trees||[]).map(t=>_elemCategory(t.element||t.elementLabel||'')).filter(Boolean))].sort(); return cats.map(v=>({val:v,label:v})); }
  if(key==='geomType'){ const present=new Set((trees||[]).map(t=>geomTypeOf(t))); return [['punkt','Punkt'],['linie','Linie'],['flaeche','Fläche']].filter(([v])=>present.has(v)).map(([v,l])=>({val:v,label:l})); }
  const lv=listValues[key];
  if(Array.isArray(lv)&&lv.length) return lv.map(e=>({val:e.label,label:e.label}));
  return [...new Set(trees.map(t=>(t[key]??'').toString()).filter(Boolean))].sort().map(v=>({val:v,label:v}));
}
// Wert eines Objekts für ein Regelfeld (konsistent zur Filterlogik objMatchesPropFilter).
function treeRuleValue(tree,key){
  if(key==='element') return _elemCategory(tree.element||tree.elementLabel||'');
  if(key==='geomType') return geomTypeOf(tree);
  return (tree[key]??'').toString();
}
// Verletzte Regelfelder eines Objekts gegen eine Tour (leeres Array = passt).
function treeRuleViolations(tree,tour){
  const reg=tour&&tour.regeln; if(!reg) return [];
  const out=[];
  for(const def of tourRuleFieldDefs()){
    const allowed=reg[def.key];
    if(!Array.isArray(allowed)||!allowed.length) continue; // keine Auswahl = alle erlaubt
    if(!allowed.includes(treeRuleValue(tree,def.key))) out.push(def.label);
  }
  return out;
}
function treeMatchesTour(tree,tour){ return treeRuleViolations(tree,tour).length===0; }
function tourHasRules(tour){ const r=tour&&tour.regeln; return !!r && Object.keys(r).some(k=>Array.isArray(r[k])&&r[k].length); }
// Bereits zugewiesene Objekte, die die aktuellen Regeln der Tour verletzen.
// Dialog: welche zugewiesenen Objekte verletzen die Tour-Regeln (+ Abweichungsfeld) — Klick springt zum Objekt.
function showTourViolations(tourId){
  const tour=tours.find(t=>t.id===tourId); if(!tour) return;
  const bad=tourViolatingTrees(tour);
  const rows=bad.map(t=>{
    const viol=treeRuleViolations(t,tour);
    const cont=_containerOf(t);
    const nm=cont?(dlEsc(cont.name||'Abschnitt')+' · '+dlEsc(_elemLabel(t))):dlEsc(t.name||'Objekt');
    const art=t.art?dlEsc(t.art):'<i>ohne Typ/Art</i>';
    return `<div onclick="showTourViolationsClose&&showTourViolationsClose();selectTree('${t.id}')" style="cursor:pointer;border-bottom:1px solid var(--border);padding:7px 2px;">
      <div style="font-size:13px;font-weight:600;">${nm}</div>
      <div style="font-size:11px;color:var(--text2);">Abweichung bei: ${viol.map(dlEsc).join(', ')||'–'} · Typ/Art: ${art}</div>
    </div>`;
  }).join('')||'<div style="font-size:12px;color:var(--text3);padding:8px 0;">Keine Regelverstöße.</div>';
  const m=document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100002;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;width:480px;max-width:94vw;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;">
    <div style="padding:13px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:14px;">⚠ Regelverstöße — ${dlEsc(tour.name||'Tour')} (${bad.length})</div>
    <div style="padding:4px 16px;overflow:auto;">${rows}</div>
    <div style="padding:11px 16px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:8px;align-items:center;">
      <span style="font-size:11px;color:var(--text3);">Klick auf einen Eintrag springt zum Objekt.</span>
      <button id="tv-close" class="btn btn-secondary" style="padding:6px 14px;">Schließen</button></div>
  </div>`;
  document.body.appendChild(m);
  window.showTourViolationsClose=()=>{ m.remove(); window.showTourViolationsClose=null; };
  m.querySelector('#tv-close').onclick=window.showTourViolationsClose;
  m.addEventListener('click',e=>{ if(e.target===m) window.showTourViolationsClose(); });
}
function tourViolatingTrees(tour){
  if(!tourHasRules(tour)) return [];
  return trees.filter(t=>treeInTour(t,tour.id) && !treeMatchesTour(t,tour));
}
// Warnung mit Override — Promise<true=trotzdem, false=abbrechen>.
// Liefert 'cancel' | 'all' | 'matching'. matchLabel optional → dritter Knopf „nur passende zuweisen".
function ruleWarnDialog(bodyHtml, okLabel, matchLabel){
  return new Promise(resolve=>{
    const m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:10000;display:flex;align-items:center;justify-content:center;';
    m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:440px;max-width:92vw;overflow:hidden;">
      <div style="padding:16px 20px 10px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;color:#b45309;">⚠ Passt nicht zu den Tour-Regeln</div>
      <div style="padding:14px 20px;font-size:13px;color:var(--text2);line-height:1.6;">${bodyHtml}</div>
      <div style="padding:10px 16px 16px;display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;">
        <button class="btn btn-secondary" data-x="cancel">Abbrechen</button>
        ${matchLabel?`<button class="btn btn-secondary" data-x="matching" style="border-color:var(--green);color:var(--green);">${matchLabel}</button>`:''}
        <button class="btn btn-primary" data-x="all">${okLabel||'Trotzdem zuweisen'}</button>
      </div>
    </div>`;
    m.addEventListener('click',e=>{
      if(e.target===m){ document.body.removeChild(m); resolve('cancel'); return; }
      const b=e.target.closest('[data-x]'); if(!b) return;
      document.body.removeChild(m); resolve(b.dataset.x);
    });
    document.body.appendChild(m);
  });
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
  currentKiMode='manual'; currentOrgOrsKey=''; currentDispoConfig=null; currentDispoResources=null; currentOrgWms=[];
  if(org){
    try{ const os=await db.collection('orgs').doc(org).get(); if(os.exists){ const d=os.data();
      currentKiMode=d.kiMode||'manual';
      currentOrgOrsKey=d.orsKey||'';
      currentDispoConfig=(d.dispoConfig&&typeof d.dispoConfig==='object')?d.dispoConfig:null;
      currentDispoResources=Array.isArray(d.dispoResources)?d.dispoResources:null;
      currentOrgWms=Array.isArray(d.wmsDefaults)?d.wmsDefaults.map(x=>({...x})):[];
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
    _allTrees=[];
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

// ORS-Optimierungs-Endpunkt (Vroom): optimierte Reihenfolge für VIELE Stopps (jenseits der 50×50-Matrix).
// Liefert die Tree-Liste in optimierter Reihenfolge (ohne Depot) oder null.
async function fetchOrsOptimization(trs, depot, roundTrip){
  const key=getOrsKey(); if(!key||trs.length<2) return null;
  const jobs=trs.map((p,i)=>({id:i+1, location:[p.lng,p.lat]}));
  const vehicle={id:1, profile:'driving-car'};
  if(depot){ vehicle.start=[depot.lng,depot.lat]; if(roundTrip) vehicle.end=[depot.lng,depot.lat]; }
  try{
    const res=await fetch('https://api.openrouteservice.org/optimization',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':key},
      body:JSON.stringify({jobs, vehicles:[vehicle]})
    });
    if(!res.ok){ console.warn('ORS optimization error:',res.status, await res.text()); return null; }
    const data=await res.json();
    const steps=data?.routes?.[0]?.steps; if(!steps) return null;
    const order=steps.filter(s=>s.type==='job').map(s=>trs[s.job-1]).filter(Boolean);
    return order.length===trs.length ? order : (order.length?order:null);
  }catch(e){ console.warn('ORS optimization failed:',e); return null; }
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
    // >50 Stopps: ORS-Optimierungs-Endpunkt (Vroom) — die 50×50-Matrix reicht da nicht
    if(trs.length>50){
      const opt=await fetchOrsOptimization(trs, depot, roundTrip);
      if(opt) return opt;
      notify('Große Tour: optimierte Reihenfolge nicht verfügbar — Luftlinie genutzt');
    } else {
      const pts = depot ? [{id:'__depot__',lat:depot.lat,lng:depot.lng}, ...trs] : trs.slice();
      const matrix = await fetchOrsMatrix(pts.map(p=>[p.lng,p.lat]));
      if(matrix){
        const idx=new Map(pts.map((p,i)=>[p,i]));
        const cost=(a,b)=>matrix[idx.get(a)][idx.get(b)];
        const seed=nnFromMatrix(pts, matrix, 0);
        const opt=twoOpt(seed, cost, !!depot, roundTrip);
        return opt.filter(p=>p.id!=='__depot__');
      }
      notify('ORS-Matrix nicht verfügbar — Luftlinie genutzt');
    }
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
// Routen-Aufteilung: Anteil der gefahrenen Route, der ÜBER Tour-Strecken läuft (Reinigungsfahrt)
// vs. Rest (Anfahrt/Leerfahrt). Exakt aus der Geometrie — summiert sich zur Routenlänge.
function _bboxLL(ll){ let a=90,b=-90,c=180,d=-180; for(const p of ll){ if(p[0]<a)a=p[0]; if(p[0]>b)b=p[0]; if(p[1]<c)c=p[1]; if(p[1]>d)d=p[1]; } return [a,b,c,d]; }
function _ptSegMeters(p,a,b){ // Punkt-zu-Segment-Distanz in Metern (lokale planare Näherung)
  const mPerLat=111320, mPerLng=111320*Math.cos(p[0]*Math.PI/180);
  const px=p[1]*mPerLng, py=p[0]*mPerLat, ax=a[1]*mPerLng, ay=a[0]*mPerLat, bx=b[1]*mPerLng, by=b[0]*mPerLat;
  const dx=bx-ax, dy=by-ay, len2=dx*dx+dy*dy;
  let t=len2?((px-ax)*dx+(py-ay)*dy)/len2:0; t=t<0?0:t>1?1:t;
  return Math.hypot(px-(ax+t*dx), py-(ay+t*dy));
}
function _computeRouteSplit(geojson, tourId){
  try{
    const coords=geojson?.features?.[0]?.geometry?.coordinates; if(!coords||coords.length<2) return null;
    const seen=new Set(), polys=[], boxes=[]; // Tour-Strecken (lat/lng), je Container einmal
    for(const t of (trees||[])){
      if(t.aktiv===false||!treeInTour(t,tourId)) continue;
      const g=_treeGeom(t); if(!g||g.type!=='LineString') continue;
      const key=t.containerExtId||t.id; if(seen.has(key)) continue; seen.add(key);
      const ll=(g.coordinates||[]).map(c=>[c[1],c[0]]); if(ll.length>=2){ polys.push(ll); boxes.push(_bboxLL(ll)); }
    }
    if(!polys.length) return null; // keine Strecken-Objekte → keine sinnvolle Aufteilung
    const TOLM=16, TOLD=16/111320; let rein=0, leer=0;
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1], b=coords[i];
      const mid=[(a[1]+b[1])/2,(a[0]+b[0])/2];
      const dKm=haversine(a[1],a[0],b[1],b[0]);
      let near=false;
      for(let k=0;k<polys.length && !near;k++){ const bb=boxes[k];
        if(mid[0]<bb[0]-TOLD||mid[0]>bb[1]+TOLD||mid[1]<bb[2]-TOLD||mid[1]>bb[3]+TOLD) continue;
        const poly=polys[k]; for(let j=1;j<poly.length;j++){ if(_ptSegMeters(mid,poly[j-1],poly[j])<=TOLM){ near=true; break; } }
      }
      if(near) rein+=dKm; else leer+=dKm;
    }
    return {routeReinKm:rein, routeLeerKm:leer};
  }catch(e){ console.warn('routeSplit',e); return null; }
}
// Routenlinien-Stil je Projekt: 'solid' = durchgezogen (kein dashArray), sonst gestrichelt
function _routeDash(pat){ return currentProjectData?.routeLineStyle==='solid' ? null : pat; }
async function setRouteLineStyle(val){
  if(isReadonly()||!currentProjectId) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{routeLineStyle:val});
    if(currentProjectData) currentProjectData.routeLineStyle=val;
    loadSavedRoutes(true); // Routen mit neuem Linienstil neu zeichnen
  }catch(e){ console.warn('setRouteLineStyle',e); notify(dlErr(e)); }
}
function drawSavedRoute(tourId, routeData){
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  if(tourRoutes[tourId]){map.removeLayer(tourRoutes[tourId].layer);delete tourRoutes[tourId];}

  // Restore order
  if(routeData.orderIds) tourOrder[tourId]=routeData.orderIds;

  // Parse geojson from string (stored as string to avoid Firestore nested array limit)
  const geojson=routeData.geojsonStr?JSON.parse(routeData.geojsonStr):routeData.geojson||null;

  // Eigene Ebene UNTER den Objekten: die Route ist gestrichelt; wo ein Straßenabschnitt der Tour
  // liegt, überdeckt dessen durchgezogene Linie die Route → nur die reinen Fahrstrecken (ohne
  // Abschnitt) bleiben gestrichelt sichtbar und sind so unterscheidbar.
  if(map && !map.getPane('routeline')){ map.createPane('routeline'); const p=map.getPane('routeline'); p.style.zIndex=390; p.style.pointerEvents='none'; }
  let layer;
  if(geojson){
    layer=L.geoJSON(geojson,{pane:'routeline',interactive:false,style:{color:tour.color,weight:3,opacity:.9,dashArray:_routeDash('3 8')}}).addTo(map);
  } else {
    // Draw straight-line fallback from saved order
    const orderedTrees=routeData.orderIds
      .map(id=>trees.find(t=>t.id===id))
      .filter(Boolean);
    const depot=getDepot();
    let pts=orderedTrees.map(t=>[t.lat,t.lng]);
    if(depot){const dp=[depot.lat,depot.lng];pts=getDepotMode()==='round'?[dp,...pts,dp]:[dp,...pts];}
    layer=L.polyline(pts,{pane:'routeline',interactive:false,color:tour.color,weight:3,opacity:.7,dashArray:_routeDash('8 5')}).addTo(map);
  }
  const _split=geojson?_computeRouteSplit(geojson,tourId):null;
  tourRoutes[tourId]={layer,km:routeData.km||0,durationSec:routeData.durationSec||0,routeReinKm:_split?_split.routeReinKm:null,routeLeerKm:_split?_split.routeLeerKm:null};
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
      const trs=_routableTrees(tour.id);
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
  if(isOverviewTour(tourId)){ notify('Übersichten erhalten keine Route'); return; }
  const tour=tours.find(t=>t.id===tourId);if(!tour)return;
  const trs=_routableTrees(tourId); // Punkte + Flächen/Linien (Stellvertreter-Koordinate)
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
  rebuildMarkersWithNumbers();renderDrawnGeoms();renderList();renderLegend();
  updateRouteInfoBar();
  setSyncState('ok','Route gespeichert');
  notify(`✓ Route gespeichert — ${km.toFixed(1)} km`);
}

// Calculate all tours at once
async function calculateAllRoutes(){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  if(!getRoutePlanningEnabled()){ notify('Reihenfolgeplanung ist deaktiviert'); return; }
  for(const tour of tours){
    if(tour.uebersicht) continue; // Übersichten überspringen
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

// Geschwindigkeit (km/h) des der Tour zugeordneten Reinigungssystems (0 = keins/keine Geschwindigkeit).
function _tourSpeedKmh(tid){
  const t=tours.find(x=>x.id===tid); if(!t||!t.reinigungssystem) return 0;
  const s=getReinigungssysteme().find(x=>x.id===t.reinigungssystem);
  const v=s&&parseFloat(s.speed); return (typeof v==='number'&&v>0)?v:0;
}
// Zu bearbeitende Strecke einer Tour (Meter) = Summe der effektiven Längen ALLER Linien-Objekte der Tour.
// Fahrbahn links und rechts zählen getrennt (jede ihre Länge) — die zu reinigende Strecke ist also
// die Summe beider Seiten, nicht die einmalige Mittellinie/Route.
function _tourWorkMeters(tid){
  let m=0;
  for(const t of (trees||[])){ if(t.aktiv===false||!treeInTour(t,tid)) continue; if(geomTypeOf(t)==='linie') m+=_effMenge(t); }
  return m;
}
// Kennzahlen einer Tour: bevorzugt geladene Route (tourRoutes), sonst persistierte Tour-Werte.
// Ist der Tour ein Reinigungssystem mit Geschwindigkeit zugeordnet, bestimmt diese die Fahrtzeit über die
// zu bearbeitende Strecke (Summe der Seiten-Längen ÷ Geschwindigkeit) statt der ORS-/Auto-Fahrzeit.
function tourMetrics(tid){
  let km=null, durationSec=0;
  const rt=tourRoutes[tid];
  if(rt){ km=rt.km||0; durationSec=rt.durationSec||0; }
  else { const t=tours.find(x=>x.id===tid); if(t && typeof t.routeKm==='number'){ km=t.routeKm; durationSec=t.routeDriveSec||0; } }
  if(km==null) return null;
  const routeKm=km; // ORS-Routenstrecke (gefahrener Weg) — vor dem Geschwindigkeits-Override
  const sp=_tourSpeedKmh(tid);
  let reinKm=null;
  if(sp>0){ const wm=_tourWorkMeters(tid); if(wm>0){ reinKm=wm/1000; km = reinKm; durationSec = wm*3.6/sp; } } // km + Zeit über die zu bearbeitende Strecke (beide Seiten)
  // Aufteilung der gefahrenen Route: Reinigungsfahrt (über Tour-Strecken) + Anfahrt/Leerfahrt — summiert zu routeKm
  const routeReinKm = rt && typeof rt.routeReinKm==='number' ? rt.routeReinKm : null;
  const routeLeerKm = rt && typeof rt.routeLeerKm==='number' ? rt.routeLeerKm : null;
  return {km, durationSec, routeKm, reinKm, routeReinKm, routeLeerKm};
}
// Füllt das Routen-Kennzahlen-Panel (Sidebar): Gesamtzeit + km, Proportionsleiste, Chips.
function _fillRoutePanel(name,cnt,km,driveMin,bewMin,zusMin,azMin,routeKm,routeReinKm,routeLeerKm){
  const sp=document.getElementById('sidebar-route-info'); if(!sp) return;
  driveMin=Math.round(driveMin||0); bewMin=Math.round(bewMin||0); zusMin=Math.round(zusMin||0); azMin=Math.round(azMin||0);
  const total=driveMin+bewMin+zusMin;
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
  set('sidebar-route-tour-name',name||'');
  set('sidebar-route-cnt',(cnt!=null?cnt:0)+' Objekte');
  // Bei Reinigungssystem: km = Reinigungsstrecke (beide Seiten). Geschätzte Gesamtfahrstrecke = Reinigung + Anfahrt/Leerfahrt
  // (die ORS-Route allein wäre zu kurz, weil sie jede Straße nur 1× befährt — beide Seiten erst mit Arc-Routing exakt).
  const showRein = km!=null && routeKm!=null && Math.abs(routeKm-km)>0.05;
  const gesamtKm = (showRein && routeLeerKm!=null) ? km+routeLeerKm : null;
  const kmEl=document.getElementById('sidebar-route-km');
  if(kmEl){
    kmEl.textContent = showRein
      ? (gesamtKm!=null ? `${km.toFixed(1)} km Rein. · ~${gesamtKm.toFixed(1)} km Fahrt` : `${km.toFixed(1)} km Rein. · ${routeKm.toFixed(1)} km Route`)
      : ((routeKm!=null?routeKm:km)!=null ? (routeKm!=null?routeKm:km).toFixed(1)+' km' : '–');
    kmEl.title = showRein ? `Reinigungsstrecke (beide Seiten): ${km.toFixed(1)} km · geschätzte Gesamtfahrstrecke (Reinigung + Anfahrt): ~${gesamtKm!=null?gesamtKm.toFixed(1):'–'} km · ORS-Route (jede Straße 1×): ${routeKm.toFixed(1)} km` : '';
  }
  // Sub-Zeile: Anfahrt/Leerfahrt (der Teil der Route, der nicht über die zu reinigenden Strecken läuft)
  const splitEl=document.getElementById('sidebar-route-split');
  if(splitEl){
    if(routeLeerKm!=null){ splitEl.style.display='block'; splitEl.innerHTML=`<span style="opacity:.7;">davon Anfahrt/Leerfahrt:</span> ${routeLeerKm.toFixed(1)} km`; }
    else splitEl.style.display='none';
  }
  set('sidebar-route-drive',driveMin?fmtMin(driveMin):'–');
  set('sidebar-route-taet',bewMin?fmtMin(bewMin):'–');
  set('sidebar-route-total',total?fmtMin(total):'–');
  const zBox=document.getElementById('sidebar-route-zusatz-box');
  if(zBox){ if(zusMin>0){ zBox.style.display='inline-flex'; set('sidebar-route-zusatz',fmtMin(zusMin)); } else zBox.style.display='none'; }
  const barEl=document.getElementById('sidebar-route-bar');
  if(barEl){ const base=Math.max(total,1);
    barEl.innerHTML=`<div style="width:${driveMin/base*100}%;background:var(--green);"></div><div style="width:${bewMin/base*100}%;background:var(--green-mid);"></div><div style="width:${zusMin/base*100}%;background:#f59e0b;"></div>`;
  }
  // Restzeit (nur wenn Arbeitszeit gesetzt): Arbeitszeit − Gesamtzeit
  const restBox=document.getElementById('sidebar-route-rest-box');
  if(restBox){
    if(azMin>0){
      restBox.style.display='flex';
      set('sidebar-route-az',fmtMin(azMin));
      const rest=azMin-total, rEl=document.getElementById('sidebar-route-rest');
      if(rEl){ rEl.textContent=fmtMin(rest); rEl.style.color=rest<0?'var(--red)':'var(--green)'; }
    } else restBox.style.display='none';
  }
  sp.style.display='block';
}
function updateRouteInfoBar(){
  const bar=document.getElementById('route-info-bar');
  if(bar) bar.classList.remove('visible'); // schwebende Routen-Info-Leiste entfernt — Infos im Seitenpanel
  // Mehrere Touren ausgewählt → kompakte Summe
  if(activeTours.size>1){
    let km=0,dur=0,zusAll=0,azAll=0,rKm=0,rrKm=0,rlKm=0,hasSplit=false; activeTours.forEach(tid=>{ const m=tourMetrics(tid); if(m){ km+=m.km; dur+=m.durationSec; rKm+=(m.routeKm||0); if(m.routeReinKm!=null){ rrKm+=m.routeReinKm; rlKm+=(m.routeLeerKm||0); hasSplit=true; } } const tt=tours.find(x=>x.id===tid); if(tt){ zusAll+=tourZusatzMin(tt); if(tt.arbeitszeitMin>0) azAll+=tt.arbeitszeitMin; } });
    const members=trees.filter(t=>treeInAnyActiveTour(t)&&isActive(t)); const cnt=members.length;
    _fillRoutePanel(`${activeTours.size} Touren`, cnt, km||null, dur/60, bewMinutes(members), zusAll, azAll, rKm||null, hasSplit?rrKm:null, hasSplit?rlKm:null);
    return;
  }
  const _activeM=activeTourOnMap?tourMetrics(activeTourOnMap):null;
  const tour=activeTourOnMap?tours.find(t=>t.id===activeTourOnMap):null;
  const members=tour?trees.filter(t=>treeInTour(t,activeTourOnMap)&&isActive(t)):[];
  if(_activeM || members.length){ // Flächen-Touren haben keine Route, aber Objekte → Panel trotzdem zeigen
    const cnt=members.length;
    _fillRoutePanel(tour?.name||'', cnt, _activeM?_activeM.km:null, _activeM?_activeM.durationSec/60:0, bewMinutes(members), tourZusatzMin(tour), (tour&&tour.arbeitszeitMin>0)?tour.arbeitszeitMin:0, _activeM?_activeM.routeKm:null, _activeM?_activeM.routeReinKm:null, _activeM?_activeM.routeLeerKm:null);
  } else {
    if(bar) bar.classList.remove('visible');
    const sp=document.getElementById('sidebar-route-info'); if(sp) sp.style.display='none';
  }
}

// ─── MARKERS ──────────────────────────────────────────────────
// Perf: Route-Nummern einmal als Map vorberechnen statt pro Zeile/Marker über tourOrder zu suchen (O(1) statt O(n)).
let _routeNumMap=null;
function buildRouteNumMap(){
  const m=new Map();
  // Reihenfolge-Nummern NUR bei genau EINER angezeigten Tour (sonst keine — werden mit der Tour ausgeblendet)
  if(!activeTourOnMap || !tourOrder[activeTourOnMap]) return m;
  tourOrder[activeTourOnMap].forEach((id,i)=>{ if(!m.has(id)) m.set(id,i+1); });
  return m;
}
function getRouteNum(treeId){
  if(_routeNumMap) return _routeNumMap.get(treeId) ?? null; // vorberechnete Map während Bulk-Renders
  if(!activeTourOnMap || !tourOrder[activeTourOnMap]) return null; // keine angezeigte Tour → keine Nummern
  const idx=tourOrder[activeTourOnMap].indexOf(treeId);
  return idx!==-1 ? idx+1 : null;
}

function makeMarker(tree){
  const treeTourIds=getTreeTourIds(tree);
  const realIds=realTourIds(tree);                            // Übersichten zählen nicht mit
  const isMulti=realIds.length>1;                             // mehrere ECHTE Tourzuordnungen → Zähler
  const activeForTree=treeTourIds.filter(id=>activeTours.has(id) && !isOverviewTour(id)); // Übersichten zählen nicht
  const multiActive=activeForTree.length>=2;                  // mehrere gleichzeitig eingeblendete ECHTE Touren → gelb
  // Farbe: mehrere gleichzeitig aktive Touren → gelb; sonst aktive/Primär-Tourfarbe
  let color;
  if(multiActive){
    color='#eab308';
  } else {
    // Einfärbung nur bei Tour-Auswahl: gehört das Objekt zu einer AKTIVEN Tour → deren Farbe, sonst neutral
    let tour=null;
    if(activeTourOnMap && treeTourIds.includes(activeTourOnMap)) tour=tours.find(t=>t.id===activeTourOnMap);
    else { const activeId=treeTourIds.find(id=>activeTours.has(id)); if(activeId) tour=tours.find(t=>t.id===activeId); }
    if(!tour && assignMode && assignTourId && treeTourIds.includes(assignTourId)) tour=tours.find(t=>t.id===assignTourId); // Planen: Ziel-Tour einfärben (Rest bleibt sichtbar/neutral)
    color=tour?tour.color:'#6b6760';
  }
  if(_isCheckMode(_colorMode)){ const b=_checkBucket(tree); if(b) color=_checkColor(_colorMode,b); }  // Plan-/Fälligkeits-Check überschreibt Tourfarbe
  const num=getRouteNum(tree.id);
  const isHighlighted=selectedTreeId===tree.id;
  const isPreselected=lassoSelection.size>0 && lassoSelection.has(tree.id); // Lasso-Vorauswahl
  const numColor=multiActive?'#a16207':color; // lesbarer Reihenfolge-Zähler auf Gelb

  const badge=(num!=null&&_showRouteNums)
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
    .on('contextmenu', e=>{ L.DomEvent.stopPropagation(e); try{ e.originalEvent&&e.originalEvent.preventDefault(); }catch(_){} showTreeTourContextMenu(tree, e); });
  return _mAdd(m);
}

// Ist ein Objekt aktuell auf der Karte SICHTBAR (Tour-Fokus, Typ-Filter, Eigenschafts-Filter,
// Check-Modus)? Gemeinsame Wahrheit für Marker-Anzeige UND Lasso-Auswahl — das Lasso darf
// nur treffen, was der Anwender sieht (sonst landen ausgeblendete/inaktive Objekte in Touren).
function _lassoSelectable(tree){
  if(!isActive(tree)) return false;
  if(!(treeVisibleSel(tree) && _typeShown(tree))) return false;
  if(objFilterOnMap && !objMatchesPropFilter(tree)) return false;
  if(_isCheckMode(_colorMode)){ const b=_checkBucket(tree); if(b && !_checkShow.has(b)) return false; }
  return true;
}
function setMarkerVisibility(){
  trees.forEach(tree=>{
    const m=mapMarkers[tree.id];if(!m)return;
    if(_lassoSelectable(tree)) _mAdd(m); else _mDel(m);
  });
}
// Eigenschaften-Filter auch auf die IMPORTIERTE Flächen-Ebene (Bundle) anwenden — sie besteht nicht
// aus mapMarkers, sondern aus _flaechenLayer/_flaechenByExt. Nicht passende Flächen werden entfernt.
function _applyFlaechenFilterVisibility(){
  if(!_flaechenLayer) return;
  const filt = objFilterOnMap && objFilterActive();
  for(const ext in _flaechenByExt){
    const l=_flaechenByExt[ext]; if(!l) continue;
    const t=trees.find(x=>x.extId===ext);
    let show = !(filt && t && !objMatchesPropFilter(t));
    if(show && _isCheckMode(_colorMode) && t){ const b=_checkBucket(t); if(b && !_checkShow.has(b)) show=false; }
    const on=_flaechenLayer.hasLayer(l);
    if(show && !on){ try{ _flaechenLayer.addLayer(l); }catch(_){} }
    else if(!show && on){ try{ _flaechenLayer.removeLayer(l); }catch(_){} }
  }
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
function applyObjFilter(){ renderList(); setMarkerVisibility(); _applyFlaechenFilterVisibility(); renderDrawnGeoms(); updateObjFilterCount(); }
function resetObjFilter(){ objFilter={stadtteil:'',art:'',pflanzjahr:'',zustand:'',wasser:'',status:''}; renderObjFilterUI(); applyObjFilter(); }
function updateObjFilterCount(){
  const active=objFilterActive();
  const fb=document.getElementById('btn-toggle-filter'); if(fb){ fb.style.borderColor=active?'var(--green)':'var(--border)'; fb.style.boxShadow=active?'0 0 0 2px var(--green), var(--shadow-md)':'var(--shadow-md)'; }
  renderMapStatus();
  const el=document.getElementById('obj-filter-count'); if(!el)return;
  const act=trees.filter(isActive);
  el.textContent = active? `${act.filter(objMatchesPropFilter).length}/${act.length}` : '';
}
// Sichtbare Status-Leiste auf der Karte: zeigt aktiven Eigenschaften-Filter und aktiven Kontroll-Modus
// (blenden Objekte aus / färben um) mit Ein-Klick-Abschalten — damit der Anwender es sofort bemerkt.
function renderMapStatus(){
  const el=document.getElementById('map-status'); if(!el) return;
  const _x='border:none;background:rgba(255,255,255,.28);color:#fff;width:18px;height:18px;border-radius:50%;cursor:pointer;font-size:12px;line-height:1;display:flex;align-items:center;justify-content:center;flex:none;';
  const chip=(bg,svg,label,onclick)=>`<span style="display:inline-flex;align-items:center;gap:7px;background:${bg};color:#fff;border-radius:99px;padding:4px 6px 4px 12px;font-size:12px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.28);">${svg}${label} <button onclick="${onclick}" title="ausschalten" style="${_x}">✕</button></span>`;
  const chips=[];
  if(objFilterActive()){
    const act=trees.filter(isActive), n=act.filter(objMatchesPropFilter).length;
    chips.push(chip('var(--green)','<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',`Filter aktiv · ${n}/${act.length} <span style="opacity:.85;font-weight:500;">${objFilterOnMap?'auf Karte':'nur Liste'}</span>`,'resetObjFilter()'));
  }
  if(_isCheckMode(_colorMode)){
    chips.push(chip('var(--blue)','<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',`${dlEsc(CHECK_MODES[_colorMode].title)} aktiv`,"setColorMode('none')"));
  }
  if(pilotScopeActive()){
    const p=_pilotCfg();
    const svg='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>';
    const label=_pilotShowAll
      ? 'Pilot-Bereich · alle sichtbar (nur du)'
      : `Pilot-Bereich: ${dlEsc(_pilotFieldLabel(p.field))} = ${dlEsc(p.values.map(v=>_pilotValueLabel(p.field,v)).join(', '))} · ${((_allTrees||[]).length-trees.length).toLocaleString('de-DE')} ausgeblendet`;
    // eigener klickbarer Chip (kein ✕): öffnet die Konfiguration (Superadmin)
    chips.push(`<span onclick="openPilotScope()" title="Pilot-Bereich bearbeiten" style="cursor:pointer;display:inline-flex;align-items:center;gap:7px;background:var(--amber);color:#fff;border-radius:99px;padding:5px 13px;font-size:12px;font-weight:600;box-shadow:0 2px 8px rgba(0,0,0,.28);">${svg}${label}</span>`);
  }
  el.innerHTML=chips.join('');
  el.style.display=chips.length?'flex':'none';
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
      ${!isReadonly()?`<button onclick="openObjFilterConfig(this)" title="Auswählen, welche Filter angezeigt werden" style="border:none;background:none;cursor:pointer;color:var(--text3);padding:0;margin-left:4px;display:flex;align-items:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>`:''}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;">
      ${_objFilterShown('stadtteil')?`<select id="of-stadtteil" style="${ss}">${opt(distinct('stadtteil'),objFilter.stadtteil,'Alle Stadtteile')}</select>`:''}
      ${_objFilterShown('art')?`<select id="of-art" style="${ss}">${opt(distinct('art'),objFilter.art,'Alle Typen')}</select>`:''}
      ${_objFilterShown('pflanzjahr')?`<select id="of-pflanzjahr" style="${ss}">${opt(distinct('pflanzjahr'),objFilter.pflanzjahr,'Alle Jahre')}</select>`:''}
      ${_objFilterShown('zustand')?`<select id="of-zustand" style="${ss}">${optRank('zustand',objFilter.zustand,'Alle '+FL.zustand)}</select>`:''}
      ${_objFilterShown('wasser')?`<select id="of-wasser" style="${ss}">${optRank('wasser',objFilter.wasser,'Alle '+FL.wasser)}</select>`:''}
      ${_objFilterShown('status')?`<select id="of-status" style="${ss}"><option value="">Alle Status</option><option value="bewaessert"${objFilter.status==='bewaessert'?' selected':''}>✓ Erledigt</option><option value="nicht"${objFilter.status==='nicht'?' selected':''}>✕ Nicht erledigt</option><option value="offen"${objFilter.status==='offen'?' selected':''}>○ Offen</option></select>`:''}
      ${customFields.filter(c=>_objFilterShown('cf:'+c.key)).map(c=>`<select id="of-cf-${c.key}" style="${ss}">${opt(distinct(c.key),objFilter[c.key]||'','Alle: '+esc(c.label))}</select>`).join('')}
    </div>
    <label style="display:flex;align-items:center;gap:6px;margin-top:7px;font-size:11px;cursor:pointer;color:var(--text2);">
      <input type="checkbox" id="of-map"${objFilterOnMap?' checked':''}> Nur gefilterte auf der Karte zeigen
    </label>
  </div>`;
  const wire={stadtteil:'of-stadtteil',art:'of-art',pflanzjahr:'of-pflanzjahr',zustand:'of-zustand',wasser:'of-wasser',status:'of-status'};
  Object.entries(wire).forEach(([k,id])=>{ const s=document.getElementById(id); if(s) s.onchange=()=>{ objFilter[k]=s.value; applyObjFilter(); renderObjFilterUI(); }; });
  customFields.forEach(c=>{ const s=document.getElementById('of-cf-'+c.key); if(s) s.onchange=()=>{ objFilter[c.key]=s.value; applyObjFilter(); renderObjFilterUI(); }; });
  const mp=document.getElementById('of-map'); if(mp) mp.onchange=()=>{ objFilterOnMap=mp.checked; setMarkerVisibility(); _applyFlaechenFilterVisibility(); renderDrawnGeoms(); renderMapStatus(); };
  const rb=el.querySelector('[data-action="reset-objfilter"]'); if(rb) rb.onclick=()=>resetObjFilter();
  const fb=document.getElementById('btn-toggle-filter'); if(fb) fb.style.borderColor=active?'var(--green)':'var(--border)';
  updateObjFilterCount();
}
// Welche Filter im Panel angezeigt werden (projektweit konfigurierbar, admin)
function _objFilterFieldDefs(){
  return [
    {key:'stadtteil',label:FL.stadtteil},
    {key:'art',label:FL.art},
    {key:'pflanzjahr',label:FL.pflanzjahr},
    {key:'zustand',label:FL.zustand},
    {key:'wasser',label:FL.wasser},
    {key:'status',label:'Meldestatus'},
    ...customFields.map(c=>({key:'cf:'+c.key,label:c.label})),
  ];
}
function _objFilterShown(key){ const cfg=currentProjectData&&currentProjectData.objFilterFields; if(!Array.isArray(cfg)) return true; return cfg.includes(key); }
async function setObjFilterField(key,on){
  if(isReadonly()||!currentProjectId) return;
  let cfg=Array.isArray(currentProjectData.objFilterFields)?[...currentProjectData.objFilterFields]:_objFilterFieldDefs().map(f=>f.key);
  if(on){ if(!cfg.includes(key)) cfg.push(key); } else { cfg=cfg.filter(k=>k!==key); }
  currentProjectData.objFilterFields=cfg;
  if(!on){ const rk=key.startsWith('cf:')?key.slice(3):key; if(objFilter[rk]){ objFilter[rk]=''; applyObjFilter(); } }  // ausgeblendetes Feld: aktiven Filterwert lösen
  renderObjFilterUI();
  try{ await updateDoc(doc(db,'projects',currentProjectId),{objFilterFields:cfg}); }
  catch(e){ console.warn('objFilterFields speichern',e); notify(dlErr(e)); }
}
function openObjFilterConfig(btn){
  const ex=document.getElementById('of-cfg-menu'); if(ex){ ex.remove(); return; }
  if(isReadonly()) return;
  const r=btn.getBoundingClientRect();
  const m=document.createElement('div'); m.id='of-cfg-menu';
  m.style.cssText=`position:fixed;top:${Math.round(r.bottom+4)}px;left:${Math.round(Math.max(8,r.left-150))}px;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px;width:220px;max-height:70vh;overflow:auto;`;
  m.innerHTML=`<div style="font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);padding:4px 6px 6px;">Filter anzeigen</div>`+
    _objFilterFieldDefs().map(f=>`<label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:13px;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><input type="checkbox" ${_objFilterShown(f.key)?'checked':''} onchange="setObjFilterField('${f.key}',this.checked)" style="width:15px;height:15px;cursor:pointer;"><span>${dlEsc(f.label||'—')}</span></label>`).join('');
  document.body.appendChild(m);
  setTimeout(()=>{ const close=ev=>{ if(!m.contains(ev.target)&&ev.target!==btn&&!btn.contains(ev.target)){ m.remove(); document.removeEventListener('mousedown',close); } }; document.addEventListener('mousedown',close); },0);
}
// ── Pilot-Bereich (Superadmin) ────────────────────────────────────────────
// Grenzt den sichtbaren Objektbestand eines Projekts temporär auf einen Ausschnitt ein
// (z. B. nur Stadtteil „Beuel"). Nicht-destruktiv: filtert die Arbeitsmenge `trees` beim
// Laden — Daten bleiben unverändert, Schalter aus = alles sofort zurück. Manuell an/aus.
let _allTrees=[];        // ungefilterter Projekt-Gesamtbestand (Choke-Point-Quelle)
let _pilotShowAll=false; // lokal (nur diese Sitzung): trotz aktivem Pilot alle Objekte zeigen — für Pflege/Bulk
let _pilotDraft=null;    // Entwurf im Konfig-Dialog
function _pilotCfg(){ return currentProjectData&&currentProjectData.pilotScope; }
function pilotScopeActive(){ const p=_pilotCfg(); return !!(p&&p.active&&p.field&&Array.isArray(p.values)&&p.values.length); }
function _pilotFieldDefs(){ return _objFilterFieldDefs().filter(f=>f.key!=='status'); } // Meldestatus taugt nicht als stabile Aufteilung
function _pilotFieldLabel(field){ const f=_pilotFieldDefs().find(x=>x.key===field); return f?f.label:field; }
function _pilotFieldValue(t,field){
  if(!t||!field) return '';
  const k = field.startsWith('cf:') ? field.slice(3) : field; // Kundenfelder liegen als t[key] (wie im Objekt-Filter)
  const v=t[k]; return v==null?'':String(v);
}
function _pilotValueLabel(field,val){
  if(field==='zustand'||field==='wasser'){ const e=(rankList(field)||[]).find(x=>String(x.id)===String(val)); return e?e.label:val; }
  return val;
}
function inPilotScope(t){
  const p=_pilotCfg();
  if(!p||!p.active||!p.field||!Array.isArray(p.values)||!p.values.length) return true;
  if(_pilotShowAll) return true;
  return p.values.map(String).includes(_pilotFieldValue(t,p.field));
}
function _applyPilotScope(arr){ return (pilotScopeActive()&&!_pilotShowAll) ? arr.filter(inPilotScope) : arr; }
function _pilotDistinctValues(field){
  const s=new Set();
  (_allTrees||[]).forEach(t=>{ const v=_pilotFieldValue(t,field); if(v!=='') s.add(v); });
  return [...s].sort((a,b)=>String(a).localeCompare(String(b),'de',{numeric:true}));
}
// Nach Pilot-Änderung: Arbeitsmenge neu ableiten und Anzeige überall auffrischen
function _pilotReapply(){
  trees=_applyPilotScope(_allTrees);
  try{ refreshMarkers(); }catch(_){}
  try{ renderListDebounced(); }catch(_){}
  try{ renderMapStatus(); }catch(_){}
  try{ if(currentView==='dashboard') renderDashboard(); }catch(_){}
}
function openPilotScope(){
  if(currentRole!=='superadmin'){ notify('Nur für Superadmin'); return; }
  if(!currentProjectId){ notify('Bitte zuerst ein Projekt öffnen'); return; }
  const p=_pilotCfg();
  _pilotDraft={ active:!!(p&&p.active), field:(p&&p.field)||'stadtteil', values:Array.isArray(p&&p.values)?[...p.values]:[] };
  _renderPilotModal();
}
function closePilot(){ const m=document.getElementById('pilot-modal'); if(m) m.remove(); }
function _renderPilotModal(){
  closePilot();
  const d=_pilotDraft; if(!d) return;
  const total=(_allTrees||[]).length;
  const shown=(_allTrees||[]).filter(t=> (d.field&&d.values.length)? d.values.map(String).includes(_pilotFieldValue(t,d.field)) : true).length;
  const hidden=total-shown;
  const fieldOpts=_pilotFieldDefs().map(f=>`<option value="${dlEsc(f.key)}"${f.key===d.field?' selected':''}>${dlEsc(f.label||'—')}</option>`).join('');
  const remaining=_pilotDistinctValues(d.field).filter(v=>!d.values.map(String).includes(String(v)));
  const addOpts=`<option value="">+ Wert hinzufügen…</option>`+remaining.map(v=>`<option value="${dlEsc(String(v))}">${dlEsc(_pilotValueLabel(d.field,v))}</option>`).join('');
  const chips = d.values.length
    ? d.values.map((v,i)=>`<span style="display:inline-flex;align-items:center;gap:5px;font-size:13px;background:var(--green-light);color:#065f46;padding:4px 6px 4px 11px;border-radius:20px;">${dlEsc(_pilotValueLabel(d.field,v))} <span onclick="pilotRemoveValue(${i})" title="entfernen" style="cursor:pointer;font-weight:700;">✕</span></span>`).join('')
    : `<span style="font-size:12px;color:var(--text3);">Noch keine Werte gewählt — der Pilot zeigt dann alle Objekte</span>`;
  const on=d.active;
  const m=document.createElement('div'); m.id='pilot-modal';
  m.style.cssText='position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:14px;box-shadow:0 20px 60px rgba(0,0,0,.35);width:440px;max-width:100%;max-height:90vh;overflow:auto;">
    <div style="display:flex;align-items:center;gap:10px;padding:16px 18px 10px;">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2.2"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>
      <span style="font-size:16px;font-weight:700;color:var(--text);">Pilot-Bereich</span>
      <span style="margin-left:auto;font-size:10px;font-weight:700;background:#ede9fe;color:#6d28d9;padding:3px 9px;border-radius:20px;">Nur Superadmin</span>
    </div>
    <div style="padding:0 18px 6px;font-size:12.5px;color:var(--text2);line-height:1.55;">Grenzt den sichtbaren Objektbestand dieses Projekts auf einen Ausschnitt ein. Nicht passende Objekte werden überall ausgeblendet — die Daten bleiben unverändert.</div>
    <div style="padding:12px 18px;">
      <label style="display:flex;align-items:center;gap:11px;padding:11px 12px;background:${on?'var(--green-light)':'var(--surface2)'};border-radius:9px;cursor:pointer;">
        <input type="checkbox" ${on?'checked':''} onchange="pilotToggleActive(this.checked)" style="width:16px;height:16px;cursor:pointer;">
        <span><span style="display:block;font-size:13.5px;font-weight:600;color:${on?'#065f46':'var(--text)'};">Pilot-Bereich ${on?'aktiv':'inaktiv'}</span><span style="font-size:11.5px;color:${on?'#047857':'var(--text3)'};">${on?'Kunde sieht nur den eingegrenzten Bestand':'Alle Objekte sind sichtbar'}</span></span>
      </label>
      <div style="margin-top:14px;">
        <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:5px;">Feld</label>
        <select onchange="pilotSetField(this.value)" style="width:100%;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:7px;background:var(--bg);font-family:inherit;">${fieldOpts}</select>
      </div>
      <div style="margin-top:12px;">
        <label style="display:block;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:5px;">Erlaubte Werte</label>
        <div style="display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid var(--border);border-radius:7px;min-height:38px;align-items:center;">${chips}</div>
        <select onchange="pilotAddValue(this.value)" style="width:100%;margin-top:7px;padding:8px;font-size:13px;border:1px solid var(--border);border-radius:7px;background:var(--bg);font-family:inherit;">${addOpts}</select>
      </div>
      <div style="display:flex;align-items:center;gap:9px;padding:10px 12px;background:var(--surface2);border-radius:8px;margin-top:14px;">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="color:var(--text3);flex:none;"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
        <span style="font-size:12.5px;color:var(--text2);"><b style="color:var(--text);">${hidden.toLocaleString('de-DE')}</b> von ${total.toLocaleString('de-DE')} ausgeblendet · <b style="color:var(--text);">${shown.toLocaleString('de-DE')}</b> im Pilot sichtbar</span>
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:var(--text2);cursor:pointer;">
        <input type="checkbox" ${_pilotShowAll?'checked':''} onchange="pilotToggleShowAll(this.checked)" style="width:15px;height:15px;cursor:pointer;"> Als Superadmin trotzdem alle anzeigen (nur für dich, wird nicht gespeichert)
      </label>
    </div>
    <div style="display:flex;gap:10px;padding:12px 18px 18px;">
      <button onclick="pilotSave()" class="btn btn-primary" style="flex:1;">Speichern</button>
      <button onclick="closePilot()" class="btn btn-secondary">Schließen</button>
    </div>
  </div>`;
  m.addEventListener('mousedown',ev=>{ if(ev.target===m) closePilot(); });
  document.body.appendChild(m);
}
function pilotSetField(field){ if(!_pilotDraft)return; _pilotDraft.field=field; _pilotDraft.values=[]; _renderPilotModal(); }
function pilotAddValue(v){ if(!_pilotDraft||v==null||v==='')return; if(!_pilotDraft.values.map(String).includes(String(v))) _pilotDraft.values.push(v); _renderPilotModal(); }
function pilotRemoveValue(i){ if(!_pilotDraft)return; _pilotDraft.values.splice(i,1); _renderPilotModal(); }
function pilotToggleActive(on){ if(!_pilotDraft)return; _pilotDraft.active=!!on; _renderPilotModal(); }
function pilotToggleShowAll(on){ _pilotShowAll=!!on; _pilotReapply(); notify(_pilotShowAll?'Zeige alle Objekte (nur für dich)':'Pilot-Bereich angewendet'); }
async function pilotSave(){
  if(currentRole!=='superadmin'||!currentProjectId||!_pilotDraft) return;
  const d=_pilotDraft;
  const cfg={ active:!!d.active, field:d.field||'stadtteil', values:(d.values||[]).map(String), setAt:new Date().toISOString(), setBy:(currentUser&&currentUser.email)||'' };
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{pilotScope:cfg});
    if(currentProjectData) currentProjectData.pilotScope=cfg;
    _pilotReapply();
    if(cfg.active&&cfg.values.length){ // beim Aktivieren sanft auf den Pilot-Ausschnitt zoomen
      try{ const pts=trees.filter(t=>isActive(t)&&t.lat&&t.lng).map(t=>[t.lat,t.lng]); if(pts.length&&map&&map.fitBounds) map.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:16}); }catch(_){}
    }
    notify('✓ Pilot-Bereich gespeichert');
    closePilot();
  }catch(e){ console.warn('pilotSave',e); notify(dlErr(e)); }
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
let _showRouteNums=true;  // Routennummern (Reihenfolge) auf Markern + Geometrie
let _showTourCounts=true; // Tourhäufigkeit: orange „in N Touren"-Badge (CSS)
function toggleTourCounts(){
  _showTourCounts=!_showTourCounts;
  document.body.classList.toggle('hide-tour-counts',!_showTourCounts);
}
function toggleRouteNums(){
  _showRouteNums=!_showRouteNums;
  remakeMarkers(Object.keys(mapMarkers)); // Routennummern auf Punkt-Markern neu — ohne Routen-Reload (Linie bleibt)
  renderDrawnGeoms();                      // Routennummern auf Abschnitten/Seiten
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
  renderFlaechen();   // Polygon-Layer (Flächen) aus dem Geometrie-Bundle
}

// ── Flächen-Geometrie (Phase 1): Bundle aus Storage laden + als Canvas-Polygone rendern ──
let _flaechenLayer=null, _flaechenLayerKey='', _flaechenBundle=null, _flaechenBundleKey='', _flaechenBusy=false, _flaechenByExt={}, _flaechenSelExt='';
const FL_NEUTRAL='#000'; // Standardfarbe ohne Tour-Auswahl (wie Punktobjekte: erst bei Auswahl eingefärbt)
// Projekt-konfigurierbare Standard-Darstellung der Geometrie (ohne Tour-Auswahl): Farbe/Stärke/Transparenz je Typ
const _GEOM_STYLE_DEF={ abschnitt:{color:'#000000',weight:4,opacity:0.85,fillOpacity:0.2}, linie:{color:'#000000',weight:4,opacity:0.85,fillOpacity:0.2}, flaeche:{color:'#000000',weight:1,opacity:0.85,fillOpacity:0.2}, punkt:{color:'#000000',weight:1,opacity:0.85,fillOpacity:0.2} };
function _geomStyleFor(cat){
  const d=_GEOM_STYLE_DEF[cat]||_GEOM_STYLE_DEF.linie;
  const c=(currentProjectData?.geomStyle&&currentProjectData.geomStyle[cat])||{};
  return { color:c.color||d.color, weight:c.weight!=null?c.weight:d.weight, opacity:c.opacity!=null?c.opacity:d.opacity, fillOpacity:c.fillOpacity!=null?c.fillOpacity:d.fillOpacity };
}
// Stärke der versetzten (Versatz-)Seitenlinien — eigener Wert, sonst Abschnittsnetz-Stärke
function _versatzWeight(){ const v=currentProjectData?.geomStyle?.versatz?.weight; return v!=null?v:_geomStyleFor('abschnitt').weight; }
async function setGeomStyle(cat,prop,val){
  if(isReadonly()||!currentProjectId) return;
  const gs=JSON.parse(JSON.stringify(currentProjectData?.geomStyle||{}));
  if(!gs[cat]) gs[cat]={};
  gs[cat][prop]= prop==='color' ? val : parseFloat(val);
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{geomStyle:gs});
    if(currentProjectData) currentProjectData.geomStyle=gs;
    // Gezeichnete Geometrie neu zeichnen UND die importierte Flächen-Ebene (Bundle) neu stylen.
    // renderFlaechen() allein bricht bei gleichem Key früh ab → importierte Flächen blieben ungestylt.
    try{ renderDrawnGeoms(); }catch(_){}
    try{ _applyFlaechenSelection(); }catch(_){}
  }catch(e){ console.warn('setGeomStyle',e); notify(dlErr(e)); }
}
const FL_MULTI='#eab308';  // Überschneidung: Objekt in mehreren angezeigten Touren → gelb (wie bei Punkt-Markern)
// Tourfarbe einer Fläche – analog zu makeMarker: NUR bei aktiver Tour-Auswahl, sonst null.
function _flTourColorFor(t){
  if(!t) return null;
  if(assignMode && assignTourId && !activeTours.size){ // Planen: nur die Ziel-Tour einfärben, Rest neutral (alle bleiben sichtbar)
    const inT = _isContainer(t) ? _ausstattungOf(t.extId).some(s=>treeInTour(s,assignTourId)) : treeInTour(t,assignTourId);
    return inT ? ((tours.find(x=>x.id===assignTourId)||{}).color||null) : null;
  }
  if(!activeTours.size) return null;
  if(_isContainer(t)){ // Abschnitt: aktive Touren ALLER Seiten sammeln — ≥2 = Überschneidung → gelb (wie Punkte)
    const set=new Set();
    for(const s of _ausstattungOf(t.extId)){ for(const id of getTreeTourIds(s)){ if(activeTours.has(id)) set.add(id); } }
    const realSet=[...set].filter(id=>!isOverviewTour(id)); // Übersichten zählen nicht für „gelb"
    if(realSet.length>=2) return FL_MULTI;
    if(set.size>=1) return (tours.find(x=>x.id===(realSet[0]||[...set][0]))||{}).color||null; // bevorzugt echte Tour
    return null;
  }
  const act=getTreeTourIds(t).filter(id=>activeTours.has(id));
  const realAct=act.filter(id=>!isOverviewTour(id)); // Übersichten zählen nicht für „gelb"
  if(realAct.length>=2) return FL_MULTI;
  if(act.length>=1){
    const pick=(activeTourOnMap && act.includes(activeTourOnMap)) ? activeTourOnMap : (realAct[0]||act[0]);
    return (tours.find(x=>x.id===pick)||{}).color||null;
  }
  return null;
}
let _colorMode='none';   // Karten-Einfärbung: 'none' | 'rk' | 'haeuf' | 'plan' (Soll/Plan-Check)
function _haeufColor(h){ h=Math.round(h||0); if(h<=0) return '#d1d5db'; return ({1:'#22c55e',2:'#3b82f6',3:'#f59e0b'})[h]||'#ef4444'; }
// Planungs-Check: Soll (Ziel/Woche) vs. Plan (Summe Wochen-Einsätze der aktiven Touren des Objekts)
function planStatusOf(tree){
  if(!tree || _isContainer(tree)) return null;
  const saison=_curCheckSaison();          // Saison-Umschalter (H): Sommer/Winter/aktuell
  const soll=sollFreqProWoche(tree,saison);
  const ids=realTourIds(tree);
  if(soll==null) return {status:'kein',soll:null,plan:0,tours:ids.length,saison};
  let plan=0; ids.forEach(id=>plan+=_tourWeeklyOcc(tours.find(x=>x.id===id),saison));
  const status = plan<soll-1e-6?'unter':(plan>soll+1e-6?'ueber':'ok');
  return {status,soll,plan,tours:ids.length,saison};
}
function planStatusColor(ps){
  if(!ps||ps.status==='kein') return '#d1d5db';
  if(ps.status==='ok') return '#22c55e';
  if(ps.status==='ueber') return '#3b82f6';
  return ps.plan===0?'#ef4444':'#f59e0b';   // gar nicht verplant vs. unterplant
}
function planStatusLabel(ps){ if(!ps||ps.status==='kein') return 'kein Soll'; return ps.status==='ok'?'Planung passt':ps.status==='ueber'?'überplant':(ps.plan===0?'nicht verplant':'unterplant'); }
// Saison für den Planungs-Check: 'auto' (aktuelle) | 'sommer' | 'winter' — macht Winter-Lücken jetzt sichtbar (H)
let _checkSaison='auto';
function _curCheckSaison(){ return _checkSaison==='auto' ? ((typeof saisonFor==='function')?saisonFor(new Date().toISOString().slice(0,10)):'sommer') : _checkSaison; }
function setCheckSaison(s){ _checkSaison=s||'auto'; rebuildMarkersWithNumbers(); setMarkerVisibility(); _applyFlaechenSelection(); _renderRkLegend(); }
function _planBucket(tree){ const ps=planStatusOf(tree); if(!ps) return null; if(ps.status==='unter') return ps.plan===0?'stark':'unter'; return ps.status; }
// ── Fälligkeit / Überfälligkeit: erwarteter Abstand (7/Soll Tage) vs. letzte ERLEDIGUNG ──
function _lastDoneDate(tree){   // letztes Datum, an dem tatsächlich erledigt wurde (nicht „nicht erledigt")
  let d=null;
  (tree.history||[]).forEach(h=>{ if(!h.date) return; if(h.status==='bewaessert'){ const x=(''+h.date).slice(0,10); if(!d||x>d) d=x; } });
  if(tree.lastStatus==='bewaessert'&&tree.lastReportAt){ const x=(''+tree.lastReportAt).slice(0,10); if(!d||x>d) d=x; }
  return d;
}
function _overdueTol(){ const v=currentProjectData&&currentProjectData.overdueTolerance; return (typeof v==='number'&&v>=0)?v:1; }
function overdueInfoOf(tree){
  if(!tree||_isContainer(tree)) return null;
  const saison=(typeof saisonFor==='function')?saisonFor(new Date().toISOString().slice(0,10)):'sommer';
  const soll=sollFreqProWoche(tree,saison);
  if(soll==null||soll<=0) return {status:'kein',soll:null,interval:null,last:null,overdue:null};
  const interval=7/soll;                       // erwarteter Abstand in Tagen
  const last=_lastDoneDate(tree);
  if(!last) return {status:'nie',soll,interval,last:null,overdue:null};
  const today=new Date().toISOString().slice(0,10);
  const days=Math.floor((new Date(today+'T00:00:00')-new Date(last+'T00:00:00'))/86400000);
  const overdue=days-interval;
  const status = overdue<0 ? 'ok' : (overdue<=_overdueTol() ? 'faellig' : 'ueber');
  return {status,soll,interval,last,days,overdue};
}
function _overdueBucket(tree){ const o=overdueInfoOf(tree); return o?o.status:null; }
function overdueLabel(o){ if(!o) return ''; return {kein:'kein Soll',nie:'nie erledigt',ok:'im Plan',faellig:'jetzt fällig',ueber:'überfällig'}[o.status]||o.status; }
async function setOverdueTol(v){
  const n=parseFloat(v); if(isReadonly()||!currentProjectId||!(n>=0)) return;
  if(currentProjectData) currentProjectData.overdueTolerance=n;
  rebuildMarkersWithNumbers(); setMarkerVisibility(); _applyFlaechenSelection(); _renderRkLegend();
  try{ await updateDoc(doc(db,'projects',currentProjectId),{overdueTolerance:n}); }catch(e){ console.warn('overdueTolerance',e); }
}
// ── Karten-„Check"-Modi (Plan / Fälligkeit): gemeinsame Farb-/Legenden-/Filter-Logik ──
const CHECK_MODES={
  plan:{ title:'Planungs-Check', note:'Plan = Wochen-Einsätze der Touren',
    buckets:[['ok','#22c55e','passt'],['unter','#f59e0b','unterplant'],['stark','#ef4444','nicht verplant'],['ueber','#3b82f6','überplant'],['kein','#d1d5db','kein Soll']], bucketOf:_planBucket },
  overdue:{ title:'Fälligkeit', note:'fällig alle 7/Soll Tage · Toleranz einstellbar',
    buckets:[['ok','#22c55e','im Plan'],['faellig','#f59e0b','jetzt fällig'],['ueber','#ef4444','überfällig'],['nie','#991b1b','nie erledigt'],['kein','#d1d5db','kein Soll']], bucketOf:_overdueBucket },
};
function _isCheckMode(m){ return m==='plan'||m==='overdue'; }
function _checkColor(mode,b){ const cm=CHECK_MODES[mode]; const d=cm&&cm.buckets.find(x=>x[0]===b); return d?d[1]:'#d1d5db'; }
function _checkBucket(tree){ const cm=CHECK_MODES[_colorMode]; return cm?cm.bucketOf(tree):null; }
let _checkShow=new Set();
function _checkFilterApply(){ setMarkerVisibility(); _applyFlaechenFilterVisibility(); _renderRkLegend(); }
function checkToggleStatus(s){ if(_checkShow.has(s)) _checkShow.delete(s); else _checkShow.add(s); _checkFilterApply(); }
function checkShowProblems(){ const cm=CHECK_MODES[_colorMode]; if(!cm) return; _checkShow=new Set(cm.buckets.map(b=>b[0]).filter(b=>b!=='ok')); _checkFilterApply(); }   // alles außer „passt/im Plan"
function checkShowAll(){ const cm=CHECK_MODES[_colorMode]; if(!cm) return; _checkShow=new Set(cm.buckets.map(b=>b[0])); _checkFilterApply(); }
// Repräsentative Häufigkeit eines Abschnitts = höchste Häufigkeit seiner Seiten (sonst eigene)
function _haeufOf(t){
  if(_isContainer(t)){ const vals=_ausstattungOf(t.extId).map(s=>orHaeuf(s,_rkById,_containerByExt)).filter(v=>v!=null); return vals.length?Math.max(...vals):null; }
  return orHaeuf(t,_rkById,_containerByExt);
}
function _flStyleForTree(t, isLine){
  // Lasso-/Planungs-Vorauswahl: violetter Akzent. Beim Abschnitt zählt auch eine vorgewählte Seite
  // (im Mittellinien-Modus hat die Seite keine eigene Linie → der Abschnitt vertritt sie).
  if(t && lassoSelection.size>0 && (lassoSelection.has(t.id) || (_isContainer(t) && _ausstattungOf(t.extId).some(s=>lassoSelection.has(s.id)))))
    return isLine?{ color:'#7c3aed', weight:6, opacity:0.95 }:{ color:'#7c3aed', weight:3, fillColor:'#7c3aed', fillOpacity:0.4 };
  // Modus „nach Reinigungsklasse einfärben": Abschnitte (und ihre versetzten Seiten) in RK-Farbe, Rest blass
  if(_colorMode==='rk'){
    let rkId=null;
    if(_isContainer(t)) rkId=t.reinigungsklasse;
    else if(t&&t.containerExtId){ const c=_containerOf(t); rkId=c&&c.reinigungsklasse; }
    if(rkId){ const rk=_rkById(rkId); const c2=(rk&&rk.color)||'#cbd5e1';
      return isLine?{ color:c2, weight:6, opacity:0.95 }:{ color:c2, weight:2, fillColor:c2, fillOpacity:0.5 }; }
    return isLine?{ color:'#d1d5db', weight:2, opacity:0.5 }:{ color:'#d1d5db', weight:1, fillColor:'#d1d5db', fillOpacity:0.1 };
  }
  // Modus „nach Häufigkeit einfärben": Abschnitt/Seite nach Reinigungs-Häufigkeit
  if(_colorMode==='haeuf'){
    const h=_haeufOf(t);
    const c2=h==null?'#e5e7eb':_haeufColor(h);
    return isLine?{ color:c2, weight:6, opacity:0.95 }:{ color:c2, weight:2, fillColor:c2, fillOpacity:0.5 };
  }
  // Modus „Plan-/Fälligkeits-Check": nach Status einfärben
  if(_isCheckMode(_colorMode)){
    const c2=_checkColor(_colorMode,_checkBucket(t));
    return isLine?{ color:c2, weight:6, opacity:0.95 }:{ color:c2, weight:2, fillColor:c2, fillOpacity:0.5 };
  }
  const col=_flTourColorFor(t);
  if(activeTours.size && !col) return isLine?{ color:'#b9b6b0', weight:2, opacity:0.5 }:{ color:'#b9b6b0', weight:1, fillColor:'#b9b6b0', fillOpacity:0.06 }; // andere Tour → ausgegraut
  if(col) return isLine?{ color:col, weight:5, opacity:0.95 }:{ color:col, weight:1.5, fillColor:col, fillOpacity:0.5 };                                       // gewählte Tour → Tourfarbe
  const gs=_geomStyleFor(_objCategory(t)); // projekt-konfigurierbare Standard-Darstellung (Farbe/Stärke/Transparenz)
  return isLine?{ color:gs.color, weight:gs.weight, opacity:gs.opacity }:{ color:gs.color, weight:gs.weight, fillColor:gs.color, fillOpacity:gs.fillOpacity };
}
function _flStyleFor(extId){ return _flStyleForTree(trees.find(x=>x.extId===extId)); }
// Flächen folgen der Tour-Auswahl (gleiche Logik wie Punktobjekte) – Stil je Polygon neu setzen.
function _applyFlaechenSelection(){
  if(_flaechenLayer) _flaechenLayer.eachLayer(l=>{ const ext=l.feature&&l.feature.properties&&l.feature.properties.extId; if(ext&&l.setStyle) l.setStyle(_flStyleFor(ext)); });
  for(const id in _drawnById){ const t=trees.find(x=>x.id===id), l=_drawnById[id]; if(t&&l&&l.setStyle) l.setStyle(_flStyleForTree(t, t.geomType==='linie')); }
}
// Karten-Modus „nach Reinigungsklasse einfärben" umschalten
function _updateColorBtns(){
  const b=document.getElementById('btn-color-mode'); if(b){ const on=_colorMode!=='none'; b.style.background=on?'var(--green)':'var(--surface)'; b.style.color=on?'#fff':'var(--text2)'; }
  // Aktive Option im Menü markieren
  document.querySelectorAll('#color-mode-menu [data-mode]').forEach(el=>{ el.style.fontWeight=el.dataset.mode===_colorMode?'700':'400'; el.style.color=el.dataset.mode===_colorMode?'var(--green)':'var(--text)'; });
}
function toggleColorMenu(){ const m=document.getElementById('color-mode-menu'); if(m) m.style.display=m.style.display==='none'?'block':'none'; }
function togglePlanCheck(){ setColorMode(_colorMode==='plan'?'none':'plan'); }
function toggleOverdueCheck(){ setColorMode(_colorMode==='overdue'?'none':'overdue'); }
function _checkBtnState(id,on){ const b=document.getElementById(id); if(b){ b.style.background=on?'var(--green)':'var(--surface)'; b.style.color=on?'#fff':'var(--text2)'; b.style.borderColor=on?'var(--green)':'var(--border)'; } }
function _updateCheckBtns(){
  _checkBtnState('btn-check', _isCheckMode(_colorMode));
  document.querySelectorAll('#check-menu [data-cm]').forEach(el=>{ const on=el.dataset.cm===_colorMode; el.style.background=on?'var(--green-light)':''; el.style.color=on?'var(--green)':'var(--text)'; el.style.fontWeight=on?'700':'400'; });
}
// „Kontrolle"-Menü (bündelt Planungs-Check, Fälligkeits-Check, Datenqualität)
function _closeCheckMenu(ev){ const m=document.getElementById('check-menu'); const b=document.getElementById('btn-check'); if(m&&!m.contains(ev.target)&&ev.target!==b&&!(b&&b.contains(ev.target))){ m.style.display='none'; document.removeEventListener('mousedown',_closeCheckMenu); } }
function toggleCheckMenu(e){ if(e&&e.stopPropagation) e.stopPropagation(); const m=document.getElementById('check-menu'); if(!m) return; const open=(m.style.display==='none'||!m.style.display); m.style.display=open?'block':'none'; if(open){ _updateCheckBtns(); setTimeout(()=>document.addEventListener('mousedown',_closeCheckMenu),0); } }
function checkMenuPick(mode){ const m=document.getElementById('check-menu'); if(m) m.style.display='none'; setColorMode(mode); }
function checkMenuGoDq(){ const m=document.getElementById('check-menu'); if(m) m.style.display='none'; switchView('datenqualitaet'); }
function setColorMode(mode){
  const prev=_colorMode;
  if(_isCheckMode(mode) && mode!==prev) _checkShow=new Set(CHECK_MODES[mode].buckets.map(b=>b[0]));   // beim Einschalten: alle Status sichtbar
  _colorMode=mode; _updateColorBtns();
  const m=document.getElementById('color-mode-menu'); if(m) m.style.display='none';
  // Check-Modus: Clustering aus (Cluster würde die Status-Farbe verdecken); zurück: Projekt-Standard wiederherstellen.
  // applyClusterMode(...,true) schaltet die Ebene um UND zeichnet die Marker neu (einfärben).
  if(_isCheckMode(mode)||_isCheckMode(prev)) applyClusterMode(_effectiveCluster(), true);
  _applyFlaechenSelection(); _renderRkLegend(); _updateCheckBtns(); renderMapStatus();
}
// ── „Darstellung"-Panel: Sichtbarkeit, Einfärben, Standard-Stile gebündelt ──
const _CAT_LABEL={punkt:'Punkte',linie:'Strecken',flaeche:'Flächen',abschnitt:'Abschnitte'};
// Panel-Auswahl (Sichtbarkeit/Einfärben/Versatz) als Projekt-Standard speichern
async function saveDisplayDefaults(){
  if(isReadonly()||!currentProjectId) return;
  const hidden=Object.keys(_typeFilter).filter(c=>_typeFilter[c]===false);
  const d={ showRouteNums:_showRouteNums, showTourCounts:_showTourCounts, routesVisible, versatz:_versatzOn, colorMode:_colorMode, hidden };
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{displayDefaults:d});
    if(currentProjectData) currentProjectData.displayDefaults=d;
    notify('✓ Darstellung als Projekt-Standard gespeichert');
  }catch(e){ console.warn('saveDisplayDefaults',e); notify(dlErr(e)); }
}
// Projekt-Standard der Darstellung beim Öffnen anwenden (einmal je Projekt; Flag oben deklariert)
function _applyDisplayDefaults(){
  if(!currentProjectId) return;                              // beim Modul-Init (kein Projekt) nichts tun (vermeidet TDZ)
  if(_displayDefaultsApplied===currentProjectId) return;
  _displayDefaultsApplied=currentProjectId;
  const d=currentProjectData?.displayDefaults;
  const _legacyNums = d&&d.showNums!=null ? !!d.showNums : true; // Alt-Standard (gemeinsamer Schalter) → beide
  _showRouteNums = d&&d.showRouteNums!=null ? !!d.showRouteNums : _legacyNums;
  _showTourCounts = d&&d.showTourCounts!=null ? !!d.showTourCounts : _legacyNums;
  routesVisible = d&&d.routesVisible!=null ? !!d.routesVisible : true;
  _versatzOn = !!(d&&d.versatz);
  _colorMode = (d&&d.colorMode)||'none';
  _typeFilter = {};
  if(d&&Array.isArray(d.hidden)) d.hidden.forEach(c=>{ _typeFilter[c]=false; });
  document.body.classList.toggle('hide-tour-counts', !_showTourCounts);
  try{ applyRouteVisibility(); }catch(_){}
  try{ refreshMarkers(); }catch(_){}
  try{ renderFlaechen(); }catch(_){ try{ renderDrawnGeoms(); }catch(__){} }
  try{ _applyFlaechenSelection(); _renderRkLegend(); }catch(_){}
}
function toggleDisplayPanel(){ const p=document.getElementById('display-panel'); if(!p) return; if(p.style.display==='block'){ p.style.display='none'; return; } renderDisplayPanel(); p.style.display='block'; }
function renderDisplayPanel(){
  const p=document.getElementById('display-panel'); if(!p) return;
  const ro=isReadonly(), present=_presentCategories(), hasCont=(trees||[]).some(_isContainer);
  const chk=(on,call,label)=>`<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0;cursor:pointer;"><input type="checkbox" ${on?'checked':''} onchange="${call}" style="margin:0;cursor:pointer;"><span>${label}</span></label>`;
  let h=`<div style="font-size:11px;font-weight:700;color:var(--text3);letter-spacing:.04em;margin:0 0 6px;">DARSTELLUNG</div>`;
  h+=`<div style="font-size:12px;font-weight:600;margin:4px 0 2px;">Sichtbarkeit</div>`;
  ['punkt','linie','flaeche','abschnitt'].filter(c=>present.has(c)).forEach(c=>{ h+=chk(_typeFilter[c]!==false,`setTypeVisible('${c}',this.checked)`,dlEsc(_CAT_LABEL[c])); });
  h+=chk(routesVisible,'toggleRouteLines()','Routenlinien ein/aus');
  h+=chk(_showTourCounts,'toggleTourCounts()','Tourhäufigkeit ein/aus');
  h+=chk(_showRouteNums,'toggleRouteNums()','Routennummern ein/aus');
  if(hasCont) h+=chk(_versatzOn,'toggleVersatz()','Objekte nach Lage versetzt');
  if(hasCont || currentProjectData?.sollFeld){
    h+=`<div style="font-size:12px;font-weight:600;margin:10px 0 2px;border-top:1px solid var(--border);padding-top:8px;">Einfärben nach</div>`;
    const rad=(val,label)=>`<label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:3px 0;cursor:pointer;"><input type="radio" name="dp-cm" ${_colorMode===val?'checked':''} onchange="setColorMode('${val}')" style="margin:0;cursor:pointer;"><span>${label}</span></label>`;
    h+=rad('none','aus (Tourfarbe)')+(hasCont?rad('rk','Reinigungsklasse')+rad('haeuf','Reinigungshäufigkeit'):'')+rad('plan','Planungs-Check (Soll/Plan)')+rad('overdue','Fälligkeit (überfällig)');
  }
  if(!ro){
    const rls=currentProjectData?.routeLineStyle==='solid'?'solid':'dashed';
    h+=`<div style="display:flex;align-items:center;gap:8px;font-size:13px;margin:10px 0 2px;border-top:1px solid var(--border);padding-top:8px;">Routenlinie
      <select onchange="setRouteLineStyle(this.value)" style="margin-left:auto;padding:3px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
        <option value="dashed"${rls==='dashed'?' selected':''}>gestrichelt</option>
        <option value="solid"${rls==='solid'?' selected':''}>durchgezogen</option>
      </select></div>`;
  }
  if(!ro){
    h+=`<div style="border-top:1px solid var(--border);margin:10px 0 0;padding-top:8px;"><button onclick="saveDisplayDefaults()" class="btn btn-secondary" style="width:100%;padding:6px;font-size:12px;">★ Aktuelle Auswahl als Projekt-Standard</button></div>`;
  }
  if(!ro){
    const sc=['abschnitt','linie','flaeche'].filter(c=>present.has(c)), lbl={abschnitt:'Abschnittsnetz',linie:'Linien / Strecken',flaeche:'Flächen'};
    if(sc.length){
      h+=`<div style="font-size:12px;font-weight:600;margin:10px 0 4px;border-top:1px solid var(--border);padding-top:8px;">Standard-Darstellung</div>`;
      sc.forEach(c=>{
        const s=_geomStyleFor(c), tp=c==='flaeche'?'fillOpacity':'opacity', tv=c==='flaeche'?s.fillOpacity:s.opacity;
        h+=`<div style="margin:6px 0;"><div style="font-size:12px;margin-bottom:3px;">${lbl[c]}</div>
          <div style="display:flex;align-items:center;gap:9px;font-size:11px;color:var(--text3);flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;">Farbe<input type="color" value="${s.color}" onchange="setGeomStyle('${c}','color',this.value)" style="width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:5px;cursor:pointer;"></label>
            <label style="display:flex;align-items:center;gap:4px;">Stärke<input type="number" min="0.5" max="12" step="0.5" value="${s.weight}" onchange="setGeomStyle('${c}','weight',this.value)" style="width:46px;padding:3px 5px;border:1px solid var(--border);border-radius:5px;"></label>
            <label style="display:flex;align-items:center;gap:4px;">Deckkraft<input type="range" min="0" max="1" step="0.05" value="${tv}" onchange="setGeomStyle('${c}','${tp}',this.value)" style="width:64px;"></label>
          </div></div>`;
      });
      if(present.has('abschnitt')){
        h+=`<div style="margin:6px 0;"><div style="font-size:12px;margin-bottom:3px;">Versetzte Linien</div>
          <div style="display:flex;align-items:center;gap:9px;font-size:11px;color:var(--text3);flex-wrap:wrap;">
            <label style="display:flex;align-items:center;gap:4px;">Stärke<input type="number" min="0.5" max="12" step="0.5" value="${_versatzWeight()}" onchange="setGeomStyle('versatz','weight',this.value)" style="width:46px;padding:3px 5px;border:1px solid var(--border);border-radius:5px;"></label>
            <span>Farbe/Deckkraft wie Abschnittsnetz</span>
          </div></div>`;
      }
    }
  }
  p.innerHTML=h;
}
function _renderRkLegend(){
  const el=document.getElementById('rk-legend'); if(!el) return;
  if(_colorMode==='rk' && reinigungsklassen.length){
    el.style.display='block';
    el.innerHTML=`<div style="font-size:11px;font-weight:700;margin-bottom:6px;">Reinigungsklassen</div>`+
      reinigungsklassen.map(r=>`<div style="display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:3px;"><span style="width:14px;height:4px;border-radius:2px;background:${dlEsc(r.color||'#cbd5e1')};flex:none;"></span>${dlEsc(r.name)}</div>`).join('')+
      `<div style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text3);margin-top:4px;"><span style="width:14px;height:4px;border-radius:2px;background:#d1d5db;flex:none;"></span>ohne Klasse</div>`;
  } else if(_colorMode==='haeuf'){
    const present=new Set();
    for(const t of (trees||[])){ if(_isContainer(t)){ const h=_haeufOf(t); if(h!=null) present.add(Math.round(h)); } }
    const vals=[...present].sort((a,b)=>a-b);
    el.style.display='block';
    el.innerHTML=`<div style="font-size:11px;font-weight:700;margin-bottom:6px;">Häufigkeit / Woche</div>`+
      (vals.length?vals.map(v=>`<div style="display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:3px;"><span style="width:14px;height:4px;border-radius:2px;background:${_haeufColor(v)};flex:none;"></span>${v===0?'0 (keine Reinigung)':v+'×'}</div>`).join('')
        :`<div style="font-size:12px;color:var(--text3);">noch keine Häufigkeiten gesetzt</div>`);
  } else if(_isCheckMode(_colorMode)){
    const cm=CHECK_MODES[_colorMode];
    const counts={}; cm.buckets.forEach(b=>counts[b[0]]=0);
    (trees||[]).forEach(t=>{ if(!isActive(t)) return; const b=cm.bucketOf(t); if(b!=null&&counts[b]!=null) counts[b]++; });
    const allShown=cm.buckets.every(b=>_checkShow.has(b[0]));
    const tolCtl=_colorMode==='overdue'?`<div style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);margin:0 0 6px;">Toleranz <input type="number" min="0" step="1" value="${_overdueTol()}" onchange="setOverdueTol(this.value)" style="width:44px;padding:2px 5px;border:1px solid var(--border);border-radius:5px;font-size:11px;font-family:inherit;"> Tage</div>`:'';
    const saisonCtl=_colorMode==='plan'?`<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:var(--text2);margin:0 0 6px;flex-wrap:wrap;">Saison ${[['auto','Auto'],['sommer','Sommer'],['winter','Winter']].map(o=>`<button onclick="setCheckSaison('${o[0]}')" title="Planung für diese Saison prüfen" style="font-size:10px;border:1px solid var(--border);border-radius:5px;background:${_checkSaison===o[0]?'var(--green-light)':'var(--bg)'};color:${_checkSaison===o[0]?'var(--green)':'var(--text2)'};cursor:pointer;padding:1px 6px;font-family:inherit;">${o[1]}</button>`).join('')}</div>`:'';
    const noteExtra=_colorMode==='plan'?` · rechnet ${_curCheckSaison()==='winter'?'Winter':'Sommer'}`:'';
    el.style.display='block';
    el.innerHTML=`<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
        <span style="font-size:11px;font-weight:700;">${cm.title}</span>
        <button onclick="${allShown?'checkShowProblems()':'checkShowAll()'}" style="font-size:10px;border:1px solid var(--border);border-radius:5px;background:var(--bg);color:var(--text2);cursor:pointer;padding:1px 6px;white-space:nowrap;">${allShown?'nur Problemfälle':'alle zeigen'}</button>
      </div>`+saisonCtl+tolCtl+
      cm.buckets.map(b=>{ const on=_checkShow.has(b[0]); return `<div onclick="checkToggleStatus('${b[0]}')" title="Ein-/ausblenden" style="display:flex;align-items:center;gap:7px;font-size:12px;margin-bottom:3px;cursor:pointer;opacity:${on?1:0.38};"><span style="width:12px;height:12px;border-radius:3px;background:${b[1]};flex:none;"></span>${b[2]} · <b>${counts[b[0]]}</b></div>`; }).join('')+
      `<div style="font-size:10px;color:var(--text3);margin-top:4px;">Zeile klicken = aus-/einblenden · ${cm.note}${noteExtra}</div>`;
  } else { el.style.display='none'; el.innerHTML=''; }
}
// Bounds aller Flächen der aktuell ausgewählten Touren (für „einpassen")
function _flaechenSelBounds(){
  if(!_flaechenLayer) return null; let b=null;
  _flaechenLayer.eachLayer(l=>{ const ext=l.feature&&l.feature.properties&&l.feature.properties.extId;
    const t=ext?trees.find(x=>x.extId===ext):null;
    if(t&&treeInAnyActiveTour(t)&&l.getBounds){ const lb=l.getBounds(); if(lb&&lb.isValid()) b=b?b.extend(lb):L.latLngBounds(lb.getSouthWest(),lb.getNorthEast()); } });
  return b;
}
// ─── GEZEICHNETE GEOMETRIE (Fläche/Strecke direkt am Objekt-Doc) ─────────────
function _distM(a,b){ const R=6371000, dLat=(b[0]-a[0])*Math.PI/180, dLon=(b[1]-a[1])*Math.PI/180,
  s=Math.sin(dLat/2)**2+Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(s)); }
function _geoLen(ll){ let d=0; for(let i=1;i<ll.length;i++) d+=_distM(ll[i-1],ll[i]); return d; }
function _geoArea(ll){ if(ll.length<3) return 0; const R=6378137; let a=0; // sphärisches Exzess → m²
  for(let i=0;i<ll.length;i++){ const p1=ll[i],p2=ll[(i+1)%ll.length];
    a += (p2[1]-p1[1])*Math.PI/180*(2+Math.sin(p1[0]*Math.PI/180)+Math.sin(p2[0]*Math.PI/180)); }
  return Math.abs(a*R*R/2); }
function _fmtLen(m){ return m>=1000?(m/1000).toFixed(2).replace('.',',')+' km':Math.round(m)+' m'; }
function _fmtArea(m2){ return m2>=10000?(m2/10000).toFixed(2).replace('.',',')+' ha':Math.round(m2)+' m²'; }
// Geometrie am Doc rendern (Fläche=Polygon, Strecke=Linie) — getrennt vom Import-Bundle
// Gezeichnete Geometrie liegt als JSON-String am Doc (geomStr) — Firestore kann keine verschachtelten Arrays
function _treeGeom(t){ if(!t) return null; if(t.geom&&t.geom.coordinates) return t.geom; if(t.geomStr){ try{ return JSON.parse(t.geomStr); }catch(_){ return null; } }
  const c=_containerOf(t); if(c) return _treeGeom(c); // Seite ohne eigene Geometrie erbt vom Abschnitt-Container
  return null; }
function _hasDrawnGeom(t){ return !!(t && (t.geomStr || (t.geom&&t.geom.coordinates) || (t&&t.containerExtId&&_containerOf(t)))); }
// ── Container / Ausstattung (Straßenabschnitt mit Seiten) ────────────────────────────
// Abschnitt = Container (Feld containerTyp, z. B. 'strecke') trägt Linie + Länge. Die Seiten
// (Fahrbahn/Gehweg links/rechts …) referenzieren ihn über containerExtId und ERBEN Geometrie +
// Länge: leer = erbt, eigene Länge/Geometrie = Override. Container selbst ist nicht tour-planbar.
function _isContainer(t){ return !!(t && t.containerTyp); }
// Indizes (extId→Container, extId→Seiten[]) — EINMAL je trees-Array statt find/filter pro Aufruf (sonst O(n²) beim Rendern vieler Abschnitte).
let _contIndex=null, _ausstIndex=null, _ctIndexRef=null;
function _rebuildContIndex(){
  _contIndex=new Map(); _ausstIndex=new Map();
  for(const t of (trees||[])){
    if(t.containerTyp) _contIndex.set(t.extId, t);
    if(t.containerExtId){ let a=_ausstIndex.get(t.containerExtId); if(!a){ a=[]; _ausstIndex.set(t.containerExtId,a); } a.push(t); }
  }
  _ctIndexRef=trees;
}
function _containerOf(t){ if(!t||!t.containerExtId) return null; if(_ctIndexRef!==trees) _rebuildContIndex(); return _contIndex.get(t.containerExtId)||null; }
// Adapter für die geteilten Resolver (objektrollen.js erwartet getContainer(extId))
function _containerByExt(extId){ return _containerOf({containerExtId:extId}); }
function _ausstattungOf(containerExtId){ if(!containerExtId) return []; if(_ctIndexRef!==trees) _rebuildContIndex(); return _ausstIndex.get(containerExtId)||[]; }
// Effektive Länge/Fläche + Einheit: eigener Wert, sonst geerbt vom Container
function _effMenge(t){ if(!t) return 0; if(t.menge!=null&&t.menge!=='') return parseFloat(t.menge)||0; const c=_containerOf(t); return c?(parseFloat(c.menge)||0):0; }
function _effEinheit(t){ if(t&&t.einheit) return t.einheit; const c=_containerOf(t); return c?(c.einheit||''):''; }
// Vererbungs-Zustand einer Seite: erbt | eigene Länge | eigene Geometrie
function _ausstStatus(t){ if(t&&(t.geomStr||(t.geom&&t.geom.coordinates))) return 'geom'; if(t&&t.menge!=null&&t.menge!=='') return 'laenge'; return 'erbt'; }
// ── Objekttyp-Filter (Karte): Punkt/Strecke/Fläche/Abschnitt ein-/ausblendbar für die Planung ──
let _typeFilter={}; // Kategorie → false = ausgeblendet
function _objCategory(t){
  if(_isContainer(t) || (t&&t.containerExtId)) return 'abschnitt'; // Abschnitt-Container + seine Seiten
  const gt=geomTypeOf(t);
  if(gt==='flaeche') return 'flaeche';
  if(gt==='linie') return 'linie';
  return 'punkt';
}
function _typeShown(t){ return _typeFilter[_objCategory(t)]!==false; }
// Stellvertreter-Koordinate [lat,lng] für die Routenberechnung: Punkt=Koordinate, Fläche=Zentroid, Linie=Mittelpunkt.
function _routePoint(t){
  if(!t) return null;
  if(t.lat&&t.lng) return [t.lat,t.lng];
  const g=_treeGeom(t); if(!g) return null;
  if(g.type==='Polygon'){ const ring=g.coordinates[0]||[]; const r=ring.length>1?ring.slice(0,-1):ring; let la=0,ln=0,n=0; for(const c of r){ la+=c[1]; ln+=c[0]; n++; } return n?[la/n,ln/n]:null; }
  if(g.type==='LineString'){ const pts=(g.coordinates||[]).map(c=>[c[1],c[0]]); return pts.length?pts[Math.floor(pts.length/2)]:null; }
  return null;
}
// Tour-Objekte für die Routenberechnung: Punkte + Geometrie (mit Stellvertreter-Koordinate als flache Kopie, id bleibt)
function _routableTrees(tourId){
  return trees.filter(t=>treeInTour(t,tourId)&&t.aktiv!==false&&_routePoint(t))
    .map(t=>{ if(t.lat&&t.lng) return t; const p=_routePoint(t); return {...t, lat:p[0], lng:p[1]}; });
}
let _drawnLayer=null, _drawnById={}, _drawnSelId='';
// ── Objekttyp-Filter (Karten-Button): Punkt/Strecke/Fläche/Abschnitt ein-/ausblenden ──
function _presentCategories(){ const s=new Set(); for(const t of (trees||[])){ if(isActive(t)) s.add(_objCategory(t)); } return s; }
function toggleTypeFilter(){
  const p=document.getElementById('type-filter-panel'); if(!p) return;
  if(p.style.display==='block'){ p.style.display='none'; return; }
  renderTypeFilterPanel(); p.style.display='block';
}
function renderTypeFilterPanel(){
  const p=document.getElementById('type-filter-panel'); if(!p) return;
  const present=_presentCategories();
  const cats=[['punkt','Punktobjekte'],['linie','Strecken'],['flaeche','Flächen'],['abschnitt','Straßenabschnitte']].filter(([c])=>present.has(c));
  if(!cats.length){ p.innerHTML='<div style="font-size:12px;color:var(--text3);padding:4px;">Keine Objekte.</div>'; return; }
  p.innerHTML=`<div style="font-size:11px;font-weight:700;color:var(--text2);margin-bottom:6px;">Auf der Karte anzeigen</div>`+
    cats.map(([c,l])=>`<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;cursor:pointer;color:var(--text2);white-space:nowrap;"><input type="checkbox" ${_typeFilter[c]!==false?'checked':''} onchange="setTypeVisible('${c}',this.checked)" style="width:14px;height:14px;cursor:pointer;flex:none;">${l}</label>`).join('');
}
function setTypeVisible(cat,on){
  _typeFilter[cat]=!!on;
  setMarkerVisibility();
  try{ renderFlaechen(); }catch(_){ try{ renderDrawnGeoms(); }catch(__){} } // renderFlaechen ruft renderDrawnGeoms + gated Bundle
  const b=document.getElementById('btn-type-filter');
  if(b){ const anyHidden=Object.values(_typeFilter).some(v=>v===false); b.style.background=anyHidden?'var(--green-light)':'var(--surface)'; b.style.color=anyHidden?'var(--green)':'var(--text2)'; }
}
// ── Versatz-Modus: Abschnitt-Seiten parallel zur Mittellinie versetzt zeichnen (Umschalter) ──
let _versatzOn=false;
function toggleVersatz(){
  _versatzOn=!_versatzOn;
  const b=document.getElementById('btn-toggle-versatz');
  if(b){ b.style.background=_versatzOn?'var(--green-light)':'var(--surface)'; b.style.color=_versatzOn?'var(--green)':'var(--text2)'; }
  renderDrawnGeoms();
  notify(_versatzOn?'Objekte nach Lage versetzt':'Objekte auf der Mittellinie');
}
// Vorzeichenbehafteter Seitenversatz (Meter): links negativ, rechts positiv; Magnitude je Element-Kategorie.
function _sideOffsetM(s){
  const el=String(s&&s.element||'').toLowerCase();
  const mag={Fahrbahn:2.5,Radweg:4.5,Gehweg:6.5,Parkstreifen:5.5,'Grünstreifen':7.5}[_elemCategory(el)]||3;
  const dir=/_l$|links$/.test(el)?-1:/_r$|rechts$/.test(el)?1:0;
  return mag*dir;
}
// Polylinie [lat,lng][] um `meters` senkrecht zur Laufrichtung versetzen (rechts = positiv).
function _offsetLatLngs(ll, meters){
  if(!Array.isArray(ll)||ll.length<2||!meters) return ll;
  const R=6378137, toRad=Math.PI/180; const out=[];
  for(let i=0;i<ll.length;i++){
    const a=ll[Math.max(0,i-1)], b=ll[Math.min(ll.length-1,i+1)];
    const lat=ll[i][0]*toRad;
    const dx=(b[1]-a[1])*Math.cos(lat), dy=(b[0]-a[0]); // Richtung in (Ost, Nord), Grad
    const len=Math.hypot(dx,dy)||1;
    const nx=dy/len, ny=-dx/len; // Rechts-Normale (Ost, Nord)
    const dLat=(meters*ny)/R/toRad;
    const dLng=(meters*nx)/(R*Math.cos(lat))/toRad;
    out.push([ll[i][0]+dLat, ll[i][1]+dLng]);
  }
  return out;
}
// Reihenfolge-Nummer eines Abschnitts (Hauptlinien-Modus) = kleinste Nummer seiner Seiten in der aktiven Route.
function _containerRouteNum(t){ let n=null; for(const s of _ausstattungOf(t.extId)){ const r=getRouteNum(s.id); if(r!=null && (n==null||r<n)) n=r; } return n; }
function renderDrawnGeoms(){
  if(!map) return;
  if(_drawnLayer){ map.removeLayer(_drawnLayer); _drawnLayer=null; } _drawnById={};
  // Seiten (Ausstattung) zeichnen sich NICHT selbst — der Abschnitt-Container vertritt sie (eine Linie statt 4 deckungsgleicher).
  const list=(trees||[]).filter(t=>_hasDrawnGeom(t)&&isActive(t)&&!t.containerExtId&&_typeShown(t)
    && !(objFilterOnMap && objFilterActive() && !objMatchesPropFilter(t)));   // Eigenschaften-Filter auch auf gezeichnete Geometrie
  const _vb=document.getElementById('btn-toggle-versatz'); if(_vb) _vb.style.display=(trees||[]).some(_isContainer)?'flex':'none';
  const _tb=document.getElementById('btn-type-filter'); if(_tb) _tb.style.display=_presentCategories().size>1?'flex':'none';
  const _hasCont=(trees||[]).some(_isContainer);
  const _cmb=document.getElementById('btn-color-mode'); if(_cmb) _cmb.style.display=_hasCont?'flex':'none';
  _updateColorBtns();
  _renderRkLegend();
  if(!list.length) return;
  // Zeichenreihenfolge: große Flächen unten, kleine darüber, Linien zuoberst → überlappte/kleinere bleiben anklickbar
  const _isLine=t=>_treeGeom(t)?.type==='LineString';
  const _polyA=t=>{ const g=_treeGeom(t); if(!g||g.type!=='Polygon') return 0; return (typeof t.menge==='number'&&t.einheit==='m2')?t.menge:_geoArea((g.coordinates[0]||[]).map(c=>[c[1],c[0]])); };
  list.sort((a,b)=>{ const al=_isLine(a),bl=_isLine(b); if(al!==bl) return al?1:-1; if(al) return 0; return _polyA(b)-_polyA(a); });
  // Renderer hybrid: wenige Objekte → SVG (zuverlässige Klick-Treffer bei Überlappung); viele → 1 Canvas (Performance, z. B. importierte Straßennetze)
  const _rend = list.length>150 ? L.canvas({padding:0.5}) : null;
  const _opt = st => _rend ? {renderer:_rend, ...st} : st;
  _drawnLayer=L.featureGroup().addTo(map); // featureGroup → getBounds() für „einpassen"
  const _placeNum=(num,latlng,col)=>{ if(!_showRouteNums||num==null||!latlng) return; try{ L.marker(latlng,{interactive:false,icon:L.divIcon({className:'',html:'<div style="min-width:18px;height:18px;border-radius:9px;background:'+(col||FL_NEUTRAL)+';border:2px solid #fff;color:#fff;font:700 10px/14px monospace;text-align:center;padding:0 3px;box-shadow:0 0 2px rgba(0,0,0,.6);">'+num+'</div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(_drawnLayer); }catch(_){} };
  list.forEach(t=>{
    const g=_treeGeom(t); if(!g) return;
    // Versatz-Modus: Abschnitt-Seiten einzeln, senkrecht zur Mittellinie versetzt
    if(_versatzOn && _isContainer(t) && g.type==='LineString'){
      const sides=_ausstattungOf(t.extId);
      if(sides.length){
        const baseLL=(g.coordinates||[]).map(c=>[c[1],c[0]]); if(baseLL.length<2) return;
        sides.forEach(s=>{
          const ll=_offsetLatLngs(baseLL,_sideOffsetM(s));
          const _vst=_flStyleForTree(s,true); _vst.weight=_versatzWeight(); // eigene Stärke für versetzte Linien
          const layer=L.polyline(ll,_opt(_vst));
          layer.on('click',()=>{ if(assignMode&&!lassoDrawing){ toggleLassoSelect(s.id); _applyFlaechenSelection(); } else if(!assignMode) selectTree(s.id,false); });
          layer.on('contextmenu',e=>{ L.DomEvent.stopPropagation(e); try{ e.originalEvent&&e.originalEvent.preventDefault(); }catch(_){} showTreeTourContextMenu(s, e); });
          layer.bindTooltip(dlEsc((t.name||'Abschnitt')+' · '+_elemLabel(s)),{sticky:true});
          layer.addTo(_drawnLayer); _drawnById[s.id]=layer;
          _placeNum(getRouteNum(s.id), ll[Math.floor(ll.length/2)], _flTourColorFor(s));
        });
        return; // Container-Mittellinie im Versatz-Modus nicht zusätzlich zeichnen
      }
    }
    let layer;
    if(g.type==='Polygon'){ const ll=(g.coordinates[0]||[]).map(c=>[c[1],c[0]]); if(ll.length<3) return; layer=L.polygon(ll,_opt(_flStyleForTree(t,false))); }
    else if(g.type==='LineString'){ const ll=(g.coordinates||[]).map(c=>[c[1],c[0]]); if(ll.length<2) return; layer=L.polyline(ll,_opt(_flStyleForTree(t,true))); }
    if(!layer) return;
    layer.on('click',()=>{
      if(assignMode&&!lassoDrawing){
        if(_isContainer(t)){ _ausstattungOf(t.extId).forEach(s=>lassoSelection.add(s.id)); renderLassoActions(); } // Abschnitt → alle Seiten vorwählen
        else toggleLassoSelect(t.id);
        _applyFlaechenSelection();
      } else if(!assignMode){ if(_isContainer(t)) openAbschnitt(t.id); else selectTree(t.id,false); }
    });
    layer.on('contextmenu',e=>{ L.DomEvent.stopPropagation(e); try{ e.originalEvent&&e.originalEvent.preventDefault(); }catch(_){} showTreeTourContextMenu(t, e); }); // Rechtsklick → nur Objekt-Menü (Frei-Menü unterdrückt)
    layer.bindTooltip(dlEsc((t.name||(t.geomType==='linie'?'Strecke':'Fläche'))+(t.menge?' · '+(t.einheit==='m'?_fmtLen(t.menge):_fmtArea(t.menge)):'')),{sticky:true});
    layer.addTo(_drawnLayer); _drawnById[t.id]=layer;
    // Reihenfolge-Nummer (nur bei aktiver Route): Abschnitt = kleinste Nummer seiner Seiten, sonst eigene
    const num=_isContainer(t)?_containerRouteNum(t):getRouteNum(t.id);
    if(num!=null){ try{ _placeNum(num, layer.getBounds().getCenter(), _flTourColorFor(t)); }catch(_){} }
  });
}
function _drawnSelBounds(){ let b=null; for(const id in _drawnById){ const t=trees.find(x=>x.id===id); const l=_drawnById[id];
  // Container zählt, wenn EINE seiner Seiten in einer aktiven Tour liegt (Mittellinien-Modus); im Versatz-Modus sind die Seiten selbst im Layer.
  const inSel = t && (treeInAnyActiveTour(t) || (_isContainer(t) && _ausstattungOf(t.extId).some(s=>treeInAnyActiveTour(s))));
  if(inSel&&l.getBounds){ const lb=l.getBounds(); if(lb&&lb.isValid()) b=b?b.extend(lb):L.latLngBounds(lb.getSouthWest(),lb.getNorthEast()); } } return b; }

// ─── ZEICHNEN-MODUS (Fläche/Strecke auf der Karte) ───────────────────────────
let _drawMode=null, _drawPts=[], _drawLayer=null;
function startDraw(type){
  if(currentView!=='karte'){ switchView('karte'); setTimeout(()=>startDraw(type),100); return; }
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  cancelDraw(); _drawMode=type; _drawPts=[];
  map.getContainer().style.cursor='crosshair';
  _drawLayer=L.layerGroup().addTo(map);
  const bar=document.createElement('div'); bar.id='draw-bar';
  bar.style.cssText='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9998;background:var(--surface);border:1px solid var(--border);border-radius:12px;box-shadow:var(--shadow-md);padding:10px 14px;display:flex;align-items:center;gap:12px;font-size:13px;flex-wrap:wrap;justify-content:center;max-width:94vw;';
  bar.innerHTML=`<span style="font-weight:600;">${type==='flaeche'?'▱ Fläche zeichnen':'／ Strecke zeichnen'}</span>
    <span id="draw-bar-info" style="color:var(--text2);min-width:80px;">0 Punkt(e)</span>
    <span style="font-size:11px;color:var(--text3);">Klick = Punkt · Doppelklick = fertig</span>
    <button onclick="finishDraw()" class="btn btn-primary" style="padding:5px 12px;font-size:12px;">Fertig</button>
    <button onclick="cancelDraw()" class="btn btn-secondary" style="padding:5px 12px;font-size:12px;">Abbrechen</button>`;
  document.body.appendChild(bar);
  map.on('click',_onDrawClick); map.on('dblclick',_onDrawDbl);
  try{ map.doubleClickZoom.disable(); }catch(_){}
}
function _onDrawClick(e){ _drawPts.push([e.latlng.lat,e.latlng.lng]); _drawRender(); }
function _onDrawDbl(e){ if(e.originalEvent) e.originalEvent.preventDefault(); finishDraw(); }
function _drawRender(){
  if(!_drawLayer) return; _drawLayer.clearLayers();
  const ll=_drawPts;
  if(_drawMode==='flaeche' && ll.length>=3) L.polygon(ll,{color:'#1d4ed8',weight:2,fillColor:'#1d4ed8',fillOpacity:0.2,dashArray:'4 4'}).addTo(_drawLayer);
  else if(ll.length>=2) L.polyline(ll,{color:'#1d4ed8',weight:3,dashArray:'4 4'}).addTo(_drawLayer);
  ll.forEach(p=>L.circleMarker(p,{radius:4,color:'#1d4ed8',fillColor:'#fff',fillOpacity:1,weight:2}).addTo(_drawLayer));
  const info=document.getElementById('draw-bar-info');
  if(info) info.textContent = _drawMode==='flaeche'
    ? (ll.length>=3?_fmtArea(_geoArea(ll)):`${ll.length} Punkt(e)`)
    : (ll.length>=2?_fmtLen(_geoLen(ll)):`${ll.length} Punkt(e)`);
}
function cancelDraw(){
  map.off('click',_onDrawClick); map.off('dblclick',_onDrawDbl);
  try{ map.doubleClickZoom.enable(); }catch(_){}
  if(_drawLayer){ map.removeLayer(_drawLayer); _drawLayer=null; }
  _drawMode=null; _drawPts=[];
  if(map) map.getContainer().style.cursor='';
  document.getElementById('draw-bar')?.remove();
}
async function finishDraw(){
  const type=_drawMode, pts=_drawPts.slice();
  cancelDraw();
  if(type==='flaeche' && pts.length<3){ notify('Mindestens 3 Punkte für eine Fläche'); return; }
  if(type==='linie' && pts.length<2){ notify('Mindestens 2 Punkte für eine Strecke'); return; }
  let geom, menge, einheit;
  if(type==='flaeche'){ const ring=pts.map(p=>[+p[1].toFixed(7),+p[0].toFixed(7)]); ring.push(ring[0].slice()); geom={type:'Polygon',coordinates:[ring]}; menge=Math.round(_geoArea(pts)); einheit='m2'; }
  else { geom={type:'LineString',coordinates:pts.map(p=>[+p[1].toFixed(7),+p[0].toFixed(7)])}; menge=Math.round(_geoLen(pts)); einheit='m'; }
  setSyncState('syncing','Speichert…');
  try{
    const baumId=await getNextBaumId();
    const ref=await addDoc(collection(db,'projects',currentProjectId,'trees'),{
      name:type==='flaeche'?'Neue Fläche':'Neue Strecke', geomType:type, geomStr:JSON.stringify(geom), menge, einheit, // GeoJSON als String — Firestore kann keine verschachtelten Arrays
      zustand:'mittel', wasser:'mittel', tourId:'', tourIds:[], notiz:'', baumId, history:[], createdAt:serverTimestamp(),
    });
    notify(`✓ ${type==='flaeche'?'Fläche '+_fmtArea(menge):'Strecke '+_fmtLen(menge)} angelegt`);
    setTimeout(()=>{ try{ renderDrawnGeoms(); }catch(_){} selectTree(ref.id,false); }, 350);
  }catch(e){ notify('Fehler: '+e.message); }
}

async function renderFlaechen(){
  renderDrawnGeoms(); // gezeichnete Geometrie immer rendern (unabhängig vom Import-Bundle)
  // Objekttyp-Filter: importierte Flächen (Bundle) ausblenden, wenn „Flächen" abgewählt sind
  if(_typeFilter.flaeche===false){ if(_flaechenLayer&&map.hasLayer(_flaechenLayer)) map.removeLayer(_flaechenLayer); return; }
  if(_flaechenLayer && !map.hasLayer(_flaechenLayer)) _flaechenLayer.addTo(map); // wieder einblenden
  // Bundle nur laden, wenn es IMPORTIERTE Flächen gibt (extId, Geometrie im Bundle). Rein gezeichnete
  // Flächen (geom am Doc, kein extId) brauchen kein Bundle → kein 404.
  const hasFl = currentProjectData?.hatFlaechen || (Array.isArray(trees) && trees.some(t=>t.geomType==='flaeche' && t.extId && !_hasDrawnGeom(t)));
  if(!hasFl){ if(_flaechenLayer){ map.removeLayer(_flaechenLayer); _flaechenLayer=null; _flaechenLayerKey=''; } return; }
  const key=currentProjectId+'_'+(currentProjectData?.geomVersion||'');
  const startedFor=currentProjectId; // Projektwechsel während des Ladens erkennen
  if((_flaechenLayer && _flaechenLayerKey===key) || _flaechenBusy) return;
  _flaechenBusy=true;
  let bundle;
  try{
    let url=await storage.ref(`objektgeom/${currentProjectData.orgId}/${currentProjectId}/flaechen.json`).getDownloadURL();
    url+=(url.includes('?')?'&':'?')+'v='+(currentProjectData.geomVersion||''); // Cache-Buster nach Neu-Import
    const r=await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status);
    bundle=await r.json();
  }catch(e){ _flaechenBusy=false; console.warn('Flächen-Bundle laden:', e); notify('⚠ Flächen-Geometrie nicht ladbar: '+(e.code||e.message||e)); return; }
  if(currentProjectId!==startedFor){ _flaechenBusy=false; return; } // inzwischen Projekt gewechselt → alten Layer nicht aufspielen
  if(!bundle?.features?.length){ _flaechenBusy=false; notify('⚠ Flächen-Bundle ist leer'); return; }
  try{
    if(_flaechenLayer){ map.removeLayer(_flaechenLayer); _flaechenLayer=null; }
    const byExt={}; trees.forEach(t=>{ if(t.extId) byExt[t.extId]=t; });
    _flaechenByExt={}; _flaechenSelExt='';
    _flaechenLayer=L.geoJSON(bundle, {
      renderer: L.canvas({ padding:0.5 }),
      style: f=>_flStyleFor(f.properties&&f.properties.extId),
      onEachFeature:(f,layer)=>{ const ext=f.properties&&f.properties.extId; if(ext) _flaechenByExt[ext]=layer;
        // Baum ERST beim Klick auflösen (nicht zur Render-Zeit — Flächen-Trees laden ggf. später,
        // und die Ebene wird bei gleichem Key nicht neu gebaut). So bleibt die Fläche immer anklickbar.
        const _t=()=>trees.find(x=>x.extId===ext);
        layer.on('click',()=>{ const t=_t(); if(t) selectTree(t.id,false); });
        layer.on('contextmenu',e=>{ L.DomEvent.stopPropagation(e); try{ e.originalEvent&&e.originalEvent.preventDefault(); }catch(_){} const t=_t(); if(t) showTreeTourContextMenu(t, e); });
        layer.bindTooltip(()=>{ const t=_t(); return dlEsc(t?((t.name||'Fläche')+(t.menge?' · '+t.menge+' m²':'')):'Fläche'); },{sticky:true});
      }
    }).addTo(map);
    _flaechenLayerKey=key;
    _applyFlaechenSelection(); // bestehende Tour-Auswahl auf neue Polygone übernehmen
    _applyFlaechenFilterVisibility(); // aktiven Eigenschaften-Filter auf die frisch gebauten Flächen anwenden
    try{ const b=_flaechenLayer.getBounds(); if(b.isValid() && currentView==='karte' && !activeTours.size){ map.fitBounds(b,{padding:[40,40],maxZoom:16}); _cityFitDone=true; } }catch(_){}
  }catch(e){ console.warn('Flächen zeichnen:', e); notify('⚠ Flächen-Polygone-Fehler: '+(e.message||e)); }
  _flaechenBusy=false;
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
        if(isActive(tree)&&inPilotScope(tree)&&tree.lat&&tree.lng) mapMarkers[id]=makeMarker(tree); // Pilot-Bereich: Status-Updates dürfen keine Nicht-Pilot-Marker zurückholen
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
// Echte Touren, die aktuell zur Tour-Suche passen (bei leerer Suche: alle).
function _legendVisibleTours(){
  const echte=tours.filter(t=>!t.uebersicht);
  return (tourLegendQuery||'').trim() ? echte.filter(t=>matchTerms(t.name, tourLegendQuery)) : echte;
}
// Sammel-Checkbox-Status (an/halb/aus) anhand der gefilterten Touren synchronisieren
function _syncAllToursCheck(){
  const allCb=document.getElementById('tour-all-check'); if(!allCb) return;
  const vis=_legendVisibleTours(); const sel=vis.filter(t=>activeTours.has(t.id)).length;
  allCb.checked=vis.length>0&&sel===vis.length; allCb.indeterminate=sel>0&&sel<vis.length;
}
async function toggleAllTours(){
  // Sammel-Checkbox im Touren-Kopf: wirkt auf die GEFILTERTEN Touren (bei leerer Suche auf alle)
  const vis=_legendVisibleTours();
  if(!vis.length) return;
  const allSel=vis.every(t=>activeTours.has(t.id));
  vis.forEach(t=>{ if(allSel) activeTours.delete(t.id); else activeTours.add(t.id); });
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
  let b=pts.length?L.latLngBounds(pts):null;
  const hasFl=currentProjectData?.hatFlaechen || trees.some(t=>geomTypeOf(t)==='flaeche');
  if(hasFl && _flaechenLayer){ try{ const fb=_flaechenLayer.getBounds(); if(fb&&fb.isValid()) b=b?b.extend(fb):L.latLngBounds(fb.getSouthWest(),fb.getNorthEast()); }catch(_){} } // Flächen nur, wenn das aktuelle Projekt welche hat (sonst Rest-Layer aus vorigem Projekt)
  if(_drawnLayer){ try{ const db2=_drawnLayer.getBounds&&_drawnLayer.getBounds(); if(db2&&db2.isValid()) b=b?b.extend(db2):L.latLngBounds(db2.getSouthWest(),db2.getNorthEast()); }catch(_){} } // gezeichnete Geometrie
  if(!b||!b.isValid()) return;
  map.invalidateSize();
  map.fitBounds(b,{padding:[50,50],maxZoom:16});
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
            const trs=_routableTrees(tid);
            const depot=getDepot();
            tourOrder[tid]=nearestNeighborTSP(trs,depot?.lat,depot?.lng).map(t=>t.id);
            missing++;
          }
        }catch(e){ console.warn('applyTourSelection load error:',e); }
      }
      if(missing&&activeTours.size===1) notify('Noch keine Route berechnet — Rechtsklick auf Karte zum Berechnen');
    }
    // Karte auf alle ausgewählten Touren einpassen (Marker UND Flächen)
    if(fit){
      const pts=trees.filter(t=>treeInAnyActiveTour(t)&&t.lat&&t.lng).map(t=>[t.lat,t.lng]);
      const depot=getDepot(); if(depot?.lat&&depot?.lng) pts.push([depot.lat,depot.lng]);
      let b=pts.length?L.latLngBounds(pts):null;
      const fb=_flaechenSelBounds(); if(fb) b=b?b.extend(fb):fb;
      const db2=_drawnSelBounds(); if(db2) b=b?b.extend(db2):db2;
      if(b&&b.isValid()) map.fitBounds(b,{padding:[60,60],maxZoom:16});
    }
  } else if(showUnplanned){
    // nur Unverplant: keine Tour-Routenlinien zeichnen
  } else {
    if(getRoutePlanningEnabled()) await loadSavedRoutes();
  }

  applyClusterMode(_effectiveCluster(), false); // Cluster nur ohne Tour-Auswahl → in Touransicht Einzelmarker
  setMarkerVisibility();
  rebuildMarkersWithNumbers();
  renderDrawnGeoms(); // Geometrie mit aktualisierten Reihenfolge-Nummern/Farben
  _applyFlaechenSelection();
  updateRouteInfoBar();
  renderLegend();
  renderFilters();
  renderList();
}

// ─── LEGEND ───────────────────────────────────────────────────
// Rechtsklick-Kontextmenü auf eine Tour-Zeile in der Legende: „Bericht" + „Touren"
function showTourLegendMenu(tid,x,y){
  document.getElementById('tour-legend-ctx')?.remove();
  const t=tours.find(z=>z.id===tid); if(!t) return;
  const m=document.createElement('div'); m.id='tour-legend-ctx';
  m.style.cssText='position:fixed;z-index:100000;background:var(--surface);border:1px solid var(--border);border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:4px;min-width:180px;font-size:13px;';
  const item=(a,svg,label)=>`<button type="button" data-a="${a}" style="display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;background:none;cursor:pointer;padding:7px 10px;border-radius:6px;font:inherit;color:var(--text);">${svg}${label}</button>`;
  m.innerHTML=`<div style="padding:5px 10px 6px;font-size:11px;color:var(--text3);font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px;">${dlEsc(t.name)}</div>`
    +item('bericht','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></svg>','Bericht')
    +item('touren','<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>','Touren');
  document.body.appendChild(m);
  const r=m.getBoundingClientRect();
  m.style.left=Math.min(x, window.innerWidth-r.width-8)+'px';
  m.style.top=Math.min(y, window.innerHeight-r.height-8)+'px';
  m.querySelectorAll('button').forEach(b=>{ b.onmouseenter=()=>b.style.background='var(--surface2)'; b.onmouseleave=()=>b.style.background='none'; });
  const onOutside=ev=>{ if(!m.contains(ev.target)) close(); };
  const close=()=>{ m.remove(); document.removeEventListener('mousedown',onOutside,true); document.removeEventListener('contextmenu',onOutside,true); window.removeEventListener('blur',close); };
  m.onclick=e=>{ const b=e.target.closest('[data-a]'); if(!b) return; e.stopPropagation(); const a=b.dataset.a; close();
    if(a==='bericht'){ openTourReport(tid); }
    else if(a==='touren'){ switchView('touren'); setTimeout(()=>{ const s=document.getElementById('touren-search'); if(s){ s.value=t.name; try{_sx(s);}catch(_){} } filterTourenGrid(t.name); },70); }
  };
  setTimeout(()=>{ document.addEventListener('mousedown',onOutside,true); document.addEventListener('contextmenu',onOutside,true); window.addEventListener('blur',close); },0);
}
let tourLegendQuery='';
let legendExpanded=new Set(); // je Tour aufgeklappte Detail-Zeile (Session)
let showOverviewInLegend=false; // Übersichten in der Legende eingeblendet? (Session, Standard: aus)
let showOverviewInGrid=false;   // Übersichten im Touren-Reiter eingeblendet? (Session, Standard: aus)
let showOverviewInAssign=false; // Übersichten in der Ziel-Tour-Auswahl (Planen) eingeblendet?
// Mehrwort-UND-Suche: alle durch Leerzeichen getrennten Begriffe müssen vorkommen
// (Reihenfolge/Zwischenzeichen egal) — z.B. "Nord Mi" findet "Nord/Team/Mi/1/3". Überall genutzt.
function matchTerms(text,query){
  const terms=(query||'').toLowerCase().split(/\s+/).filter(Boolean);
  if(!terms.length) return true;
  const h=(text||'').toLowerCase();
  return terms.every(t=>h.includes(t));
}
// Such-× (Aufheben) für Felder in einem [data-sx]-Container — wie bei der Objektsuche
function _sx(inp){ const w=inp&&inp.closest('[data-sx]'); const b=w&&w.querySelector('.s-x'); if(b) b.style.display=inp.value?'flex':'none'; }
function _sxClear(btn){ const w=btn.closest('[data-sx]'); const inp=w&&w.querySelector('input'); if(!inp) return; inp.value=''; inp.dispatchEvent(new Event('input',{bubbles:true})); btn.style.display='none'; inp.focus(); }
function applyTourLegendFilter(){
  document.querySelectorAll('#tour-legend .legend-item[data-tourname]').forEach(row=>{
    row.style.display = matchTerms(row.dataset.tourname, tourLegendQuery) ? '' : 'none';
  });
  _syncAllToursCheck(); // Sammel-Haken folgt dem Filter
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
    <input type="checkbox" id="tour-all-check" title="Alle Touren an/aus" style="margin:0;cursor:pointer;flex-shrink:0;width:13px;height:13px;accent-color:var(--green);">
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
    html+=`<div style="padding:2px 8px 6px;"><span data-sx style="position:relative;display:flex;align-items:center;"><input id="tour-legend-search" type="text" placeholder="Tour suchen…" style="width:100%;padding:4px 24px 4px 8px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;box-sizing:border-box;"><button type="button" class="s-x" aria-label="Suche aufheben" onclick="_sxClear(this)"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span></div>`;
  }

  // Tour rows — kompakt: Name + Gesamtzeit; Details je Tour aufklappbar (Pfeil)
  function tourRow(t){
    const _tm=tourMetrics(t.id);
    const members=trees.filter(x=>treeInTour(x,t.id)&&isActive(x)); // inkl. Flächen/Strecken (ohne lat/lng)
    const cnt=members.length;
    const total=_tm?fmtTotalTime(_tm.durationSec,members,tourZusatzMin(t)):'';
    const isSel=activeTours.has(t.id);
    const isExp=legendExpanded.has(t.id);
    // Übersichten: kein Aufklapp-Pfeil (keine Route/Zeiten), nur Objektzahl
    const ov=!!t.uebersicht;
    let r=`<div class="legend-item${isSel?' active-tour':''}" data-tourid="${t.id}" data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="padding:3px 6px;margin-bottom:1px;">
      <input type="checkbox" class="tour-check"${isSel?' checked':''} style="margin:0 4px 0 0;cursor:pointer;flex-shrink:0;accent-color:${t.color};">
      <div class="legend-line" style="background:${t.color};width:16px;height:3px;"></div>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;">${dlEsc(t.name)}</span>
      <span class="legend-km" style="font-size:10px;">${ov?cnt:(_tm?total:cnt+' Obj.')}</span>
      ${ov?'':`<svg data-expand="${t.id}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2.5" style="flex-shrink:0;cursor:pointer;padding:1px;transition:transform .15s;transform:rotate(${isExp?180:0}deg);"><path d="M6 9l6 6 6-6"/></svg>`}
    </div>`;
    if(isExp && !ov){
      if(_tm){
        const driveMin=Math.round(_tm.durationSec/60), bewMin=Math.round(bewMinutes(members));
        const base=Math.max(driveMin+bewMin,1), dw=Math.round(driveMin/base*100);
        r+=`<div data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="margin:0 6px 4px 30px;padding:5px 8px;background:var(--surface2);border-radius:6px;">
          <div style="display:flex;height:4px;border-radius:2px;overflow:hidden;margin-bottom:4px;">
            <div style="width:${dw}%;background:${t.color};"></div>
            <div style="width:${100-dw}%;background:var(--green-mid);"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);">
            <span>Fahrt ${fmtDuration(_tm.durationSec)}</span><span>Tätigkeit ${fmtBewTime(members)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:1px;">
            <span>${_tm.km.toFixed(1)} km</span><span>${cnt} Objekte</span>
          </div>${(()=>{const z=tourZusatzMin(t);const rz=tourRestzeit(t,members,_tm.durationSec);let out='';
          if(z>0) out+=`<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:1px;"><span>Zusatztätigkeiten</span><span>${fmtMin(z)}</span></div>`;
          if(rz) out+=`<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text3);margin-top:1px;border-top:1px solid var(--border);padding-top:2px;"><span>Arbeitszeit ${fmtMin(rz.azMin)}</span><span style="font-weight:700;color:${rz.restMin<0?'var(--red)':'var(--green-strong,#15803d)'};" title="Arbeitszeit − Fahrt − Tätigkeit − Zusatz">Restzeit ${fmtMin(rz.restMin)}</span></div>`;
          return out;})()}
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
  const _tourScroll = echteTouren.length>20; // ab >20 Touren scrollbare Liste (ca. 20 Zeilen sichtbar)
  if(_tourScroll) html+=`<div style="max-height:440px;overflow-y:auto;">`;
  echteTouren.forEach(t=>{ html+=tourRow(t); });
  if(_tourScroll) html+=`</div>`;
  // Übersichten (z.B. Stadtteile): standardmäßig eingeklappt, per Klick einblendbar
  if(overviewTouren.length){
    html+=`<div data-action="toggle-overview" style="display:flex;align-items:center;gap:6px;padding:5px 6px;margin-top:3px;border-top:1px solid var(--border);cursor:pointer;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text2)" stroke-width="2.5" style="flex-shrink:0;transition:transform .15s;transform:rotate(${showOverviewInLegend?90:0}deg);"><path d="M9 18l6-6-6-6"/></svg>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      <span style="font-size:11px;font-weight:600;color:var(--text2);flex:1;">Übersichten</span>
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

  // Sammel-Checkbox: an = alle gewählt, halb = einige (indeterminate)
  _syncAllToursCheck();

  // Tour-Suche verdrahten
  const ts=document.getElementById('tour-legend-search');
  if(ts){
    ts.value=tourLegendQuery;
    ts.oninput=()=>{ tourLegendQuery=ts.value; applyTourLegendFilter(); _sx(ts); };
    ts.onclick=e=>e.stopPropagation();
    _sx(ts); // initiales ×-Sichtbarkeit (z.B. bei erhaltenem Suchbegriff nach Re-Render)
  }
  applyTourLegendFilter();

  // Event delegation
  el.onclick=e=>{
    if(e.target.id==='tour-all-check'){ toggleAllTours(); return; } // Sammel-Checkbox: nicht ein-/ausklappen
    if(e.target.closest('[data-action="toggle-legend"]')){
      const body=document.getElementById('legend-body');
      const svg=el.querySelector('[data-action="toggle-legend"] svg');
      const open=body.style.display==='none';
      body.style.display=open?'block':'none';
      el.dataset.open=open?'true':'false';
      if(svg)svg.style.transform=`rotate(${open?180:0}deg)`;
      return;
    }
    if(e.target.closest('[data-action="toggle-overview"]')){ // Übersichten ein-/ausklappen
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
  // Rechtsklick auf eine Tour-Zeile → Kontextmenü (Bericht / Touren)
  el.oncontextmenu=e=>{
    const item=e.target.closest('[data-tourid]'); if(!item) return;
    const tid=item.dataset.tourid;
    if(tid==='__all__'||tid==='__none__'||!tours.find(x=>x.id===tid)) return;
    e.preventDefault();
    showTourLegendMenu(tid, e.clientX, e.clientY);
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
    pts=route.orderIds.map(id=>_routePoint(trees.find(t=>t.id===id))).filter(Boolean);
    if(depot){ const dp=[depot.lat,depot.lng]; pts=getDepotMode()==='round'?[dp,...pts,dp]:[dp,...pts]; }
  }
  if(pts.length<2) return null;
  const cum=[0];
  for(let i=1;i<pts.length;i++) cum[i]=cum[i-1]+haversine(pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1])*1000;
  const totalGeo=cum[cum.length-1]||1;
  const totalDrive=route.durationSec||(totalGeo/1000/30*3600);
  const waterSec=skipBew?0:getBewDuration()*60;
  const depot=getDepot();
  // Stellvertreter-Koordinate je Objekt (Punkt = selbst, Fläche = Zentroid, Linie/Seite = Mittelpunkt) →
  // funktioniert auch für Abschnitt-Seiten ohne eigene lat/lng (Geometrie geerbt vom Container).
  const ot=(route.orderIds||[]).map(id=>trees.find(t=>t.id===id)).map(t=>{ const p=t?_routePoint(t):null; return p?{t,p}:null; }).filter(Boolean);
  if(ot.length===0) return null;
  const wp=[];
  if(depot) wp.push({type:'depot',coord:[depot.lat,depot.lng]});
  ot.forEach(({t,p})=>wp.push({type:'water',coord:p,tree:t}));
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

// Listen-Modus: 'objekte' = alle Objekte (inkl. Seiten) · 'abschnitte' = nur Abschnitte/Container (kompakt)
let _listMode='objekte';
function setListMode(mode){ _listMode=(mode==='abschnitte')?'abschnitte':'objekte'; renderList(); }
function _syncListModeToggle(){
  const wrap=document.getElementById('list-mode-toggle'); if(!wrap) return;
  const hasC=(trees||[]).some(_isContainer);
  wrap.style.display=hasC?'flex':'none';
  const a=document.getElementById('lm-abschnitte'), o=document.getElementById('lm-objekte');
  const act=(el,on)=>{ if(!el) return; el.style.background=on?'var(--green)':'var(--surface)'; el.style.color=on?'#fff':'var(--text2)'; };
  act(a,_listMode==='abschnitte'); act(o,_listMode!=='abschnitte');
}
function renderList(){
  _syncListModeToggle();
  const q=document.getElementById('search-input')?.value.toLowerCase()||'';
  // Abschnittsnamen je extId (für Seiten: Straßenname als Anzeige + durchsuchbar)
  const _contName={}; for(const t of trees){ if(t.containerTyp) _contName[t.extId]=t.name||''; }
  let filtered=trees.filter(t=>{
    if(_listMode==='abschnitte'){ if(!_isContainer(t)) return false; } // Abschnitts-Modus: NUR Abschnitte (Container)
    else if(_isContainer(t)) return false; // Objekt-Modus: Abschnitt-Container sind keine Objekte → ausblenden
    const cn=t.containerExtId?(_contName[t.containerExtId]||''):'';
    const mq=matchTerms([t.name,t.art,t.stadtteil,t.baumnr,t.baumId,t.pflanzjahr,cn].join(' '), q);
    // Container-Sichtbarkeit folgt seinen Seiten (Tour-Auswahl/Unverplant); sonst normale Objekt-Sichtbarkeit
    const mf = _isContainer(t)
      ? ((!activeTours.size && !showUnplanned) || _ausstattungOf(t.extId).some(s=>treeVisibleSel(s)))
      : treeVisibleSel(t);
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
  // Lazy-Liste: ohne Suche/Tour-Auswahl/Filter und bei vielen Einträgen nicht alle auflisten —
  // nur ein Hinweis (Karte zeigt weiter alles). Suche oder Tour-Auswahl füllt die Liste.
  const _noFilter = !q && !activeTours.size && !showUnplanned && !objFilterActive();
  if(_noFilter && filtered.length>600){
    const noun=_listMode==='abschnitte'?'Abschnitte':'Objekte';
    list.innerHTML=`<div class="empty-state" style="padding:34px 18px;text-align:center;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <p style="font-weight:600;margin:8px 0 2px;">${filtered.length.toLocaleString('de-DE')} ${noun}</p>
      <p style="font-size:12px;color:var(--text3);line-height:1.55;">Für die Übersicht nicht alle aufgelistet.<br>Oben <b>suchen</b> (Name/Straße) oder eine <b>Tour wählen</b> — dann erscheinen die passenden Einträge. Auf der Karte sind alle sichtbar.</p>
    </div>`;
    document.getElementById('list-count').textContent=`${filtered.length} ${_listMode==='abschnitte'?'Einträge':'Objekte'}`;
    return;
  }
  if(filtered.length===0){list.innerHTML=`<div class="empty-state"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22V12"/><path d="M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7z"/></svg><p>Keine Objekte gefunden</p></div>`;
  } else {
    const tourMap=new Map(tours.map(t=>[t.id,t]));   // Perf: 1× statt tours.find pro Zeile
    const prevRn=_routeNumMap; _routeNumMap=buildRouteNumMap();
    try{
    const nSel=activeTours.size;
    list.innerHTML=filtered.map(tree=>{
      const treeTours=getTreeTourIds(tree).map(id=>tourMap.get(id)).filter(Boolean);
      // Bei angezeigter Tour deren Farbe bevorzugen
      const primaryT=(activeTourOnMap&&treeTours.find(t=>t.id===activeTourOnMap))||(activeTours.size?treeTours.find(t=>activeTours.has(t.id)):null)||null;
      const color=primaryT?.color||null;
      const bg=color?color+'22':'#f0ede6';
      const sel=selectedTreeId===tree.id?' selected':'';
      // Genau 1 Tour aktiv → Reihenfolgenummer als Badge auf dem Avatar (keine 3. Zeile, kein Tourname)
      const rNum=nSel===1?getRouteNum(tree.id):null;
      const seqBadge=rNum!=null?`<span class="tree-seq" style="background:${color||'#6b6760'};">${rNum}</span>`:'';
      // Tour-Namen-Chips nur bei Mehrfachauswahl (da ist der Tourname relevant); bei 0/1 ausgeblendet
      const tourBadges=nSel>=2?treeTours.map(t=>`<span class="badge" style="background:${t.color}22;color:${t.color};">${dlEsc(t.name)}</span>`).join(''):'';
      const _isSide=!!tree.containerExtId; // Seite eines Abschnitts → Straßenname als Titel, Seite+Art als Meta
      const dispName=_isSide?(_contName[tree.containerExtId]||tree.name||'–'):(tree.name||'–');
      const meta=_isSide
        ? [_elemLabel(tree),tree.art].filter(Boolean).map(dlEsc).join(' · ')
        : [tree.art||'Unbekannt',tree.stadtteil].filter(Boolean).map(dlEsc).join(' · ');
      return `<div class="tree-item${sel}" data-treeid="${tree.id}">
        <div class="tree-icon" style="background:${bg};">${objIcon(tree)}${seqBadge}</div>
        <div class="tree-info">
          <div class="tree-name">${_geomChip(tree)}${dlEsc(dispName)}</div>
          <div class="tree-meta">${meta}</div>
          ${tourBadges?`<div class="tree-badges">${tourBadges}</div>`:''}
        </div>
      </div>`;
    }).join('');
    } finally { _routeNumMap=prevRn; }
    // Event delegation — reliable, no escaping issues
    list.onclick=e=>{
      const item=e.target.closest('[data-treeid]');
      if(item) selectTree(item.dataset.treeid);
    };
    // Rechtsklick auf eine Objektzeile: kein (Browser-)Menü
    list.oncontextmenu=e=>{ if(e.target.closest('[data-treeid]')) e.preventDefault(); };
  }
  document.getElementById('list-count').textContent=`${filtered.length} ${_listMode==='abschnitte'?'Einträge':'Objekte'}`;
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
      const m=mapMarkers[id];
      // Cluster-Ansicht: so weit reinzoomen, dass das Objekt EINZELN sichtbar wird (statt nur zum Cluster zu schwenken)
      if(_clusterOn && _clusterGroup && m && _clusterGroup.hasLayer && _clusterGroup.hasLayer(m) && _clusterGroup.zoomToShowLayer){
        _clusterGroup.zoomToShowLayer(m, ()=>{ map.panTo([tree.lat,tree.lng],{animate:true,duration:0.3}); });
      } else {
        const tz=Math.max(map.getZoom(), 17); // beim Listen-Klick näher ans Objekt heranzoomen (nur rein, nie raus)
        map.setView([tree.lat,tree.lng], tz, {animate:true});
      }
    }, wasOnMap ? 0 : 200);
  }
  else if(geomTypeOf(tree)!=='punkt' && (_drawnById[tree.id] || (tree.containerExtId && _containerOf(tree) && _drawnById[_containerOf(tree).id]))){
    // Gezeichnete Geometrie (am Doc): heranzoomen + kurz grün hervorheben.
    // Seite ohne eigene Linie → auf die Linie ihres Abschnitt-Containers zoomen.
    const _lid=_drawnById[tree.id]?tree.id:_containerOf(tree).id;
    const isLine=geomTypeOf(trees.find(x=>x.id===_lid)||tree)==='linie';
    if(_drawnSelId && _drawnSelId!==_lid && _drawnById[_drawnSelId]){ const p0=trees.find(x=>x.id===_drawnSelId); try{ _drawnById[_drawnSelId].setStyle(_flStyleForTree(p0, p0&&p0.geomType==='linie')); }catch(_){} }
    setTimeout(()=>{ try{
      map.invalidateSize();
      const lyr=_drawnById[_lid]; if(!lyr) return;
      try{ lyr.setStyle(isLine?{color:'#1d9e75',weight:6,opacity:1}:{color:'#1d9e75',weight:3,fillColor:'#1d9e75',fillOpacity:0.55}); lyr.bringToFront&&lyr.bringToFront(); }catch(_){}
      _drawnSelId=_lid;
      if(pan && lyr.getBounds){ const b=lyr.getBounds(); if(b.isValid()) map.fitBounds(b,{padding:[60,60],maxZoom:18,animate:true}); }
    }catch(_){} }, wasOnMap?0:250);
  }
  else if(geomTypeOf(tree)==='flaeche'){
    // Importierte Fläche (Bundle, extId): vorherige Hervorhebung zurücksetzen, dann markieren + heranzoomen
    if(_flaechenSelExt && _flaechenSelExt!==tree.extId && _flaechenByExt[_flaechenSelExt]){ try{ _flaechenByExt[_flaechenSelExt].setStyle(_flStyleFor(_flaechenSelExt)); }catch(_){} }
    setTimeout(()=>{ try{
      map.invalidateSize();
      const lyr=_flaechenByExt[tree.extId];
      if(!lyr){ notify('Geometrie dieser Fläche noch nicht geladen — kurz warten und erneut.'); return; }
      try{ lyr.setStyle({ color:'#1d9e75', weight:3, fillColor:'#1d9e75', fillOpacity:0.55 }); lyr.bringToFront&&lyr.bringToFront(); }catch(_){}
      _flaechenSelExt=tree.extId;
      if(pan){ const b=lyr.getBounds(); if(b.isValid()) map.fitBounds(b,{padding:[60,60],maxZoom:18,animate:true}); }
    }catch(_){} }, wasOnMap ? 0 : 250);
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
// ── Geometrietyp-Fundament (Phase 0): Punkt = Default; fehlend ⇒ punkt (keine Migration nötig) ──
function geomTypeOf(tree){ return (tree && tree.geomType) || 'punkt'; }
// Feld gilt für diesen Geometrietyp? Leere/fehlende geomTypes = gilt für alle.
function fieldAppliesTo(c, gt){ return !(c && c.geomTypes && c.geomTypes.length) || c.geomTypes.includes(gt); }
// Hat das Projekt überhaupt Nicht-Punkt-Geometrien? Steuert die Sichtbarkeit der Geometrie-UI
// (für reine Punkt-Projekte bleibt alles unverändert/unsichtbar).
function _geomActive(){ return Array.isArray(trees) && trees.some(t=>geomTypeOf(t)!=='punkt'); }
function _geomLabel(tree){
  const name={punkt:'Punkt',linie:'Linie',flaeche:'Fläche'}[geomTypeOf(tree)]||geomTypeOf(tree);
  const mv=_effMenge(tree);
  if(!mv) return name;
  const eh={m2:'m²',m:'m',Stk:'Stk'}[_effEinheit(tree)]||_effEinheit(tree)||'';
  return name+' · '+mv.toLocaleString('de-DE')+(eh?' '+eh:'');
}
// Kleiner Geometrie-Chip für Listen (Fläche/Strecke); Punkt = kein Chip
function _geomChip(tree){
  const gt=geomTypeOf(tree);
  if(gt==='flaeche') return '<span title="Fläche" style="color:#0369a1;font-weight:700;margin-right:5px;">▱</span>';
  if(gt==='linie') return '<span title="Strecke" style="color:#6d28d9;font-weight:700;margin-right:5px;">／</span>';
  return '<span title="Punkt" style="color:#6b6760;font-weight:700;margin-right:5px;">●</span>';
}
function openDetail(id){
  const tree=trees.find(t=>t.id===id);if(!tree)return;
  if(_isContainer(tree)){ openAbschnitt(id); return; } // Abschnitt → eigenes Fenster
  _mountDetailPanel();
  selectedTreeId=id;renderList();
  const tour=primaryTour(tree);
  const _zE=tree.zustand?rankEntry('zustand',tree.zustand):null;
  const statusBg=_zE?_zE.farbe+'22':'';
  const statusColor=_zE?_zE.farbe:'';
  const zLabel=_zE?_zE.label:'';
  const rNum=getRouteNum(tree.id);
  document.getElementById('panel-title').textContent=orTitel(tree,_containerByExt)||tree.name||'–';
  const _meta=document.getElementById('panel-meta');
  if(_meta) _meta.textContent=`${tree.baumnr?'Nr. '+tree.baumnr+' · ':''}${tree.art||''}${tree.stadtteil?' · '+tree.stadtteil:''}`;
  // Build tour options for inline select
  const currentTourIds=getTreeTourIds(tree);
  const tourOptions=tours.map(t=>`<option value="${t.id}"${currentTourIds.includes(t.id)?' selected':''}>${t.name}</option>`).join('');

  // Kompakt: leere Felder ausblenden (kein „–"-Rauschen), Koordinaten ganz raus
  const drow=(k,v,vs)=>v?`<div class="detail-field" style="padding:5px 0;"><span class="detail-key">${k}</span><span class="detail-val"${vs?` style="${vs}"`:''}>${dlEsc(''+v)}</span></div>`:'';
  const _cont=_containerOf(tree); // gehört dieses Objekt zu einem Abschnitt? → Rücksprung anbieten
  let body=`
    ${_cont?`<div onclick="openAbschnitt('${_cont.id}')" style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--green);padding:2px 0 8px;">← ${dlEsc(_cont.name||'Abschnitt')}</div>`:''}
    ${_zE?`<div class="status-bar" style="background:${statusBg};color:${statusColor};">${dlEsc(FL.zustand)} — ${dlEsc(zLabel)}</div>`:''}

    <div class="form-section">Identifikation</div>
    <div class="detail-field" style="padding:5px 0;"><span class="detail-key">Objekt-ID</span><span class="detail-val" style="font-family:monospace;font-weight:700;color:var(--green);">${tree.baumId||'–'}</span></div>
    ${geomTypeOf(tree)!=='punkt'?drow('Geometrie',_geomLabel(tree)):''}
    ${drow(FL.baumnr||'Baumnummer',tree.baumnr)}
    ${drow(FL.stadtteil,tree.stadtteil)}
    ${drow(FL.art,tree.art,'font-style:italic;')}
    ${drow(FL.pflanzjahr,tree.pflanzjahr)}
    ${drow(FL.pflanzzeitpunkt||'Pflanzzeitpunkt',tree.pflanzzeitpunkt)}
    ${customFields.filter(c=>fieldAppliesTo(c,geomTypeOf(tree))).map(c=>drow(c.label,tree[c.key])).join('')}

    ${(tree.containerExtId)?(()=>{
      const c=_containerOf(tree);
      const rk=(c&&c.reinigungsklasse)?_rkById(c.reinigungsklasse):null;
      const manuell=tree.haeufigkeit!=null&&tree.haeufigkeit!=='';
      const h=orHaeuf(tree,_rkById,_containerByExt);
      if(!rk && !manuell && h==null) return '';
      return `<div class="form-section">Reinigung</div>`
        +(rk?drow('Reinigungsklasse',rk.name+' · vom Abschnitt'):'')
        +(h!=null?drow('Häufigkeit / Woche',h+'×/Woche'+(manuell?' (manuell)':' (geerbt)'))
                 :'<div class="detail-field" style="padding:5px 0;"><span class="detail-key">Häufigkeit / Woche</span><span class="detail-val" style="color:var(--text3);">– (Element nicht abgedeckt)</span></div>');
    })():''}

    ${geomTypeOf(tree)==='flaeche'?`
    <div class="form-section">Reinigungsplan</div>
    ${drow('Belag',tree.belag)}
    ${tree.teilflaechen>1?drow('Teilflächen',tree.teilflaechen):''}
    ${drow('Objektart',tree.objektart)}
    ${drow('Objektnummer',tree.objektnummer)}
    ${drow('Betriebshof',tree.betriebshof)}
    ${drow('Fahrzeug',tree.fahrzeug)}
    ${(tree.haeufigkeitS||tree.haeufigkeitW)?drow('Häufigkeit / Woche','Sommer '+(tree.haeufigkeitS||'–')+'× · Winter '+(tree.haeufigkeitW||'–')+'×'):''}
    ${drow('Reinigungstage Sommer',tree.sommerTage)}
    ${drow('Reinigungstage Winter',tree.winterTage)}
    ${tree.reinigungsflaecheListe?drow('Reinigungsfläche (Liste)',tree.reinigungsflaecheListe+' m²'):''}
    ${tree.hatPlan===false?'<div style="font-size:12px;color:var(--amber);padding:4px 0;">⚠ Kein Reinigungsplan in der Liste hinterlegt</div>':''}
    `:''}

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
    ${currentProjectData?.fuellgradAktiv && typeof tree.lastFuellgrad==='number'?`<div class="detail-field" style="padding:4px 0;"><span class="detail-key">Füllgrad (zuletzt)</span><span class="detail-val" style="font-weight:600;">${fgLabelD(tree.lastFuellgrad)}</span></div>`:''}

    ${tree.notiz?`<div class="form-section">${dlEsc(FL.notiz)}</div>
    <div style="padding:5px 0 8px;font-size:13px;color:var(--text2);line-height:1.55;white-space:pre-wrap;">${dlEsc(tree.notiz)}</div>`:''}

    ${(()=>{ const ps=planStatusOf(tree); if(!ps) return '';
      if(ps.status==='kein') return `<div class="form-section">Planung</div><div class="detail-field" style="padding:5px 0;"><span class="detail-key">Soll / Plan</span><span class="detail-val" style="color:var(--text3);">kein Soll hinterlegt</span></div>`;
      const col=planStatusColor(ps);
      return `<div class="form-section">Planung</div>
      <div class="detail-field" style="padding:5px 0;align-items:center;"><span class="detail-key">Soll / Plan</span><span class="detail-val"><b>${+ps.soll.toFixed(2)}</b>×/Wo · Plan <b>${+ps.plan.toFixed(2)}</b> <span style="color:var(--text3);font-size:11px;">(${ps.tours} Tour${ps.tours===1?'':'en'})</span> <span style="display:inline-block;margin-left:4px;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${col}22;color:${col};">${planStatusLabel(ps)}</span></span></div>`;
    })()}
    ${(()=>{ const o=overdueInfoOf(tree); if(!o||o.status==='kein') return ''; const col=_checkColor('overdue',o.status);
      const zuletzt = o.status==='nie' ? 'noch nie erledigt' : (o.last?('zuletzt '+o.last.split('-').reverse().join('.')):'');
      const extra = o.status==='ueber'&&o.overdue!=null ? (' · '+Math.round(o.overdue)+' Tage über') : (o.interval?(' · fällig alle '+(o.interval<1?o.interval.toFixed(1):Math.round(o.interval))+' Tage'):'');
      return `<div class="detail-field" style="padding:5px 0;align-items:center;"><span class="detail-key">Fälligkeit</span><span class="detail-val"><span style="display:inline-block;padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${col}22;color:${col};">${overdueLabel(o)}</span> <span style="color:var(--text3);font-size:11px;">${zuletzt}${extra}</span></span></div>`;
    })()}

    <div class="form-section">Touren (Mehrfachauswahl)</div>
    <div id="inline-tour-wrap" style="padding:6px 0 4px;"></div>

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
  renderInlineTourChips();
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

// ─── ABSCHNITTS-FENSTER (Container mit Ausstattung) ───────────────────────────
const _ELEM_ORDER=['fahrbahn_l','fahrbahn_r','gehweg_l','gehweg_r','radweg_l','radweg_r','mittelinsel','parkstreifen','gruenstreifen'];
const _ELEM_LABEL={fahrbahn_l:'Fahrbahn links',fahrbahn_r:'Fahrbahn rechts',gehweg_l:'Gehweg links',gehweg_r:'Gehweg rechts',radweg_l:'Radweg links',radweg_r:'Radweg rechts',mittelinsel:'Mittelinsel',parkstreifen:'Parkstreifen',gruenstreifen:'Grünstreifen'};
function _elemLabel(s){ return _ELEM_LABEL[s.element]||s.elementLabel||s.name||'Seite'; }
function openAbschnitt(id){
  const c=trees.find(t=>t.id===id); if(!c) return;
  if(!_isContainer(c)) return openDetail(id);
  _mountDetailPanel(); selectedTreeId=id; renderList();
  const _erank=s=>{ const i=_ELEM_ORDER.indexOf(s.element); return i<0?99:i; };
  const sides=_ausstattungOf(c.extId).slice().sort((a,b)=>_erank(a)-_erank(b)||(_elemLabel(a)).localeCompare(_elemLabel(b)));
  const eh={m2:'m²',m:'m',Stk:'Stk'}[c.einheit]||c.einheit||'';
  const totalMin=Math.round(sides.reduce((s,x)=>s+artBewMin(x),0));
  document.getElementById('panel-title').textContent=c.name||'Abschnitt';
  const _meta=document.getElementById('panel-meta'); if(_meta) _meta.textContent=(c.stadtteil?dlEsc(c.stadtteil)+' · ':'')+'Abschnitt';
  const badge=st=>st==='geom'?'<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#e0edff;color:#0369a1;">eigene Geometrie</span>'
    :st==='laenge'?'<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:#fdebd0;color:#92560a;">eigene Länge</span>'
    :'<span style="font-size:11px;padding:2px 8px;border-radius:6px;background:var(--surface2);color:var(--text2);">erbt</span>';
  const rows=sides.map(s=>{
    const tr=primaryTour(s), tcol=tr?tr.color:'#b4b2a9';
    const done=s.lastStatus==='bewaessert', sdot=done?'#1d9e75':(s.lastStatus==='nicht'?'#dc2626':'#b4b2a9');
    const ml=_effMenge(s), ehs=_effEinheit(s)==='m2'?'m²':_effEinheit(s), mlS=ml?ml.toLocaleString('de-DE')+(ehs?' '+ehs:''):'';
    const st=_ausstStatus(s);
    const lenS=!mlS?'':st==='erbt'?`<span style="color:var(--text3);">${mlS} geerbt</span>`:st==='laenge'?`<span style="color:#92560a;">${mlS} eigen</span>`:`<span style="color:#0369a1;">${mlS} gezeichnet</span>`;
    const am=Math.round(artBewMin(s));
    const hf=orHaeuf(s,_rkById,_containerByExt);
    return `<div onclick="selectTree('${s.id}')" style="cursor:pointer;border:1px solid var(--border);border-radius:8px;padding:9px 11px;margin-bottom:7px;">
      <div style="display:flex;align-items:center;gap:9px;">
        <span style="width:9px;height:9px;border-radius:50%;background:${sdot};flex:none;"></span>
        <div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">${dlEsc(orObjektart(s)||_elemLabel(s))}${orLage(s)?`<span style="font-size:10px;font-weight:600;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:99px;padding:0 6px;" title="Lage">${dlEsc(orLage(s))}</span>`:''}</div>
          <div style="font-size:11px;color:var(--text2);">${dlEsc(s.art||'–')}${am?' · '+am+' min':''}</div></div>
        ${badge(st)}
      </div>
      <div style="display:flex;gap:14px;margin:6px 0 0 18px;font-size:11px;color:var(--text2);flex-wrap:wrap;">
        <span><span style="color:${tcol};">●</span> ${tr?dlEsc(tr.name):'keine Tour'}</span>
        ${lenS?`<span>${lenS}</span>`:''}
        ${hf!=null?`<span title="${s.haeufigkeit!=null&&s.haeufigkeit!==''?'manuell':'aus Reinigungsklasse'}">${hf}×/Wo</span>`:''}
        <span>${done?'erledigt':'offen'}</span>
      </div>
    </div>`;
  }).join('')||'<div style="font-size:12px;color:var(--text3);padding:6px 0;">Noch keine Ausstattung.</div>';
  document.getElementById('panel-body').innerHTML=`
    <div class="detail-field" style="padding:5px 0;"><span class="detail-key">Abschnitts-ID</span><span class="detail-val" style="font-family:monospace;font-weight:700;color:var(--green);">${dlEsc(c.baumId||'–')}</span></div>
    <div class="form-section">Reinigung</div>
    <div class="detail-field" style="padding:4px 0;">
      <span class="detail-key">Reinigungsklasse</span>
      <select class="form-control" style="width:auto;padding:3px 8px;font-size:12px;" ${isReadonly()?'disabled':`onchange="setAbschnittRk('${c.id}',this.value)"`}>
        <option value="">– keine –</option>
        ${reinigungsklassen.map(r=>`<option value="${dlEsc(r.id)}"${c.reinigungsklasse===r.id?' selected':''}>${dlEsc(r.name)}</option>`).join('')}
      </select>
    </div>
    ${(()=>{ const rk=c.reinigungsklasse?_rkById(c.reinigungsklasse):null; if(!rk) return ''; const fr=ELEM_GRUPPE_ORDER.filter(g=>rk.freq&&rk.freq[g]!=null).map(g=>ELEM_GRUPPE_LABEL[g]+' '+rk.freq[g]+'×').join(' · '); return fr?`<div style="font-size:11px;color:var(--text2);padding:0 0 6px;">${dlEsc(fr)} / Woche</div>`:''; })()}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 14px;">
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:var(--text3);">Länge</div><div style="font-size:17px;font-weight:700;">${(parseFloat(c.menge)||0).toLocaleString('de-DE')} ${eh}</div></div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:var(--text3);">Ausstattung</div><div style="font-size:17px;font-weight:700;">${sides.length}</div></div>
      <div style="background:var(--surface2);border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:var(--text3);">Zeit gesamt</div><div style="font-size:17px;font-weight:700;">${totalMin} min</div></div>
    </div>
    <div class="form-section" style="display:flex;justify-content:space-between;align-items:center;">Ausstattung <span style="font-size:11px;font-weight:400;color:var(--text3);">leer = erbt vom Abschnitt</span></div>
    <div style="padding:6px 0;">${rows}</div>
    ${isReadonly()?'':`<button class="btn btn-secondary" style="width:100%;padding:7px;font-size:12px;" onclick="abschnittAddSeite('${c.id}')">+ Objekt hinzufügen</button>`}
  `;
  document.getElementById('panel-actions').innerHTML=isReadonly()?'':`<button class="btn btn-secondary" style="flex:1;" onclick="openEditTree('${c.id}')">Abschnitt bearbeiten</button>`;
  switchDetailTab('details');
  const _vb=document.getElementById('panel-body-verlauf'); if(_vb) _vb._treeId=id;
  document.getElementById('detail-panel').classList.add('open');
  // Abschnitt auf der Karte grün hervorheben (vorherige Auswahl zurücksetzen) + heranzoomen
  if(_drawnSelId && _drawnSelId!==id && _drawnById[_drawnSelId]){ const p0=trees.find(x=>x.id===_drawnSelId); try{ _drawnById[_drawnSelId].setStyle(_flStyleForTree(p0, p0&&geomTypeOf(p0)==='linie')); }catch(_){} }
  const _lyr=_drawnById[id];
  if(_lyr){ try{ _lyr.setStyle({color:'#1d9e75',weight:6,opacity:1}); _lyr.bringToFront&&_lyr.bringToFront(); }catch(_){} _drawnSelId=id;
    try{ const b=_lyr.getBounds&&_lyr.getBounds(); if(b&&b.isValid()) map.fitBounds(b,{padding:[60,60],maxZoom:18,animate:true}); }catch(_){} }
}
async function abschnittAddSeite(containerId){
  const c=trees.find(t=>t.id===containerId); if(!c||isReadonly()) return;
  const common=[['fahrbahn_l','Fahrbahn links'],['fahrbahn_r','Fahrbahn rechts'],['gehweg_l','Gehweg links'],['gehweg_r','Gehweg rechts'],['radweg_l','Radweg links'],['radweg_r','Radweg rechts'],['mittelinsel','Mittelinsel'],['parkstreifen','Parkstreifen'],['gruenstreifen','Grünstreifen']];
  const existing=new Set(_ausstattungOf(c.extId).map(s=>s.element).filter(Boolean));
  const m=document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;width:400px;max-width:94vw;overflow:hidden;">
    <div style="padding:13px 16px;border-bottom:1px solid var(--border);font-weight:700;font-size:14px;">+ Objekt zu „${dlEsc(c.name||'Abschnitt')}"</div>
    <div style="padding:14px 16px;display:flex;flex-direction:column;gap:11px;">
      <div><div style="font-size:11px;color:var(--text3);margin-bottom:5px;">Bezeichnung</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">${common.map(([k,l])=>`<button type="button" data-k="${k}" data-l="${dlEsc(l)}" class="as-pick" ${existing.has(k)?'disabled':''} style="font-size:11px;padding:4px 9px;border:1px solid var(--border);border-radius:99px;background:var(--bg);cursor:pointer;${existing.has(k)?'opacity:.4;cursor:not-allowed;':''}">${dlEsc(l)}</button>`).join('')}</div>
        <input id="as-name" class="form-control" placeholder="oder eigene Bezeichnung" style="width:100%;margin-top:8px;padding:6px 9px;font-size:12px;"></div>
      <label style="font-size:11px;color:var(--text3);">Art (Aufwandssatz)<select id="as-art" class="form-control" style="width:100%;margin-top:3px;"><option value="">— wählen —</option>${artenList.map(a=>`<option value="${dlEsc(a.name)}">${dlEsc(a.name)}</option>`).join('')}</select></label>
      <div style="font-size:11px;color:var(--text3);">Erbt Geometrie und Länge vom Abschnitt. Eigene Länge/Geometrie später im Objekt setzen.</div>
    </div>
    <div style="padding:11px 16px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="as-cancel" class="btn btn-secondary" style="padding:6px 12px;">Abbrechen</button>
      <button id="as-save" class="btn btn-primary" style="padding:6px 14px;">Hinzufügen</button>
    </div></div>`;
  document.body.appendChild(m);
  let pick={k:'',l:''};
  m.querySelectorAll('.as-pick').forEach(b=>{ if(b.disabled) return; b.onclick=()=>{ pick={k:b.dataset.k,l:b.dataset.l}; m.querySelectorAll('.as-pick').forEach(x=>x.style.borderColor='var(--border)'); b.style.borderColor='var(--green)'; const n=document.getElementById('as-name'); if(n) n.value=''; }; });
  const close=()=>m.remove(); m.querySelector('#as-cancel').onclick=close; m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#as-save').onclick=async()=>{
    const custom=(document.getElementById('as-name').value||'').trim();
    const label=custom||pick.l, element=custom?'':pick.k, art=document.getElementById('as-art').value||'';
    if(!label){ notify('Bitte eine Bezeichnung wählen'); return; }
    const btn=m.querySelector('#as-save'); btn.disabled=true; btn.style.opacity=.5;
    try{
      const baumId=await getNextBaumId();
      await addDoc(collection(db,'projects',currentProjectId,'trees'),{ name:label, element, elementLabel:label, art, geomType:'linie', containerExtId:c.extId, baumId, aktiv:true, tourIds:[], tourId:'', history:[], createdAt:serverTimestamp() });
      notify('✓ Objekt „'+label+'" hinzugefügt'); close();
      setTimeout(()=>{ if(trees.find(t=>t.id===containerId)) openAbschnitt(containerId); },300);
    }catch(e){ notify('Fehler: '+(e.message||e)); btn.disabled=false; btn.style.opacity=1; }
  };
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

const FUELLGRAD_LABELS={0:'leer',25:'25 %',50:'50 %',75:'75 %',100:'voll',120:'übervoll'};
function fgLabelD(v){ return (typeof v!=='number')?'':(FUELLGRAD_LABELS[v]||v+' %'); }
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
        ${currentProjectData?.fuellgradAktiv && typeof e.fuellgrad==='number' ? `<div style="margin-top:3px;"><span class="badge" style="background:var(--surface2);color:var(--text2);font-size:11px;">Füllgrad: ${fgLabelD(e.fuellgrad)}</span></div>` : ''}
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
      ?`<div style="display:flex;gap:8px;flex-wrap:wrap;padding:2px 0 6px;">${fotos.map((f,i)=>`<img src="${f.u}" loading="lazy" onclick="openFoto('${_jsArg(treeId)}',${i})" title="Foto ansehen" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);cursor:pointer;">`).join('')}</div>`
      :'<div style="font-size:11px;color:var(--text3);padding:2px 0 6px;">Keine Fotos vorhanden (Aufnahme über die Erfassungs-App).</div>'}
    <div class="form-section">Dokumente${docs.length?` (${docs.length})`:''}</div>
    <div style="display:flex;flex-direction:column;gap:5px;padding:2px 0 4px;">
      ${docs.map((d,i)=>`<div style="display:flex;align-items:center;gap:8px;background:var(--surface2);border-radius:8px;padding:7px 10px;">
        <span style="flex-shrink:0;">${d.typ==='link'?'🔗':docIcon(d.name)}</span>
        <a href="${dlEsc(d.u)}" target="_blank" rel="noopener" title="${dlEsc(d.name||'')}" style="flex:1;min-width:0;font-size:12px;font-weight:600;color:var(--text);text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(d.name||'Dokument')}</a>
        ${d.size?`<span style="font-size:10px;color:var(--text3);flex-shrink:0;">${fmtBytes(d.size)}</span>`:''}
        ${isReadonly()?'':`<button type="button" onclick="docDelete('${_jsArg(treeId)}',${i})" title="Entfernen" style="border:none;background:none;cursor:pointer;color:var(--red);font-size:15px;line-height:1;padding:0 2px;flex-shrink:0;">×</button>`}
      </div>`).join('')}
      ${isReadonly()?(docs.length?'':'<div style="font-size:11px;color:var(--text3);">Keine Dokumente.</div>'):`<div style="display:flex;gap:6px;">
        <button type="button" class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docUploadStart('${_jsArg(treeId)}')">📎 Datei hochladen</button>
        <button type="button" class="btn btn-secondary" style="flex:1;padding:6px;font-size:12px;" onclick="docAddLink('${_jsArg(treeId)}')">🔗 Link hinzufügen</button>
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
  if(!await confirmByName({title:'Dokument entfernen', label:'Dokument', name:d.name||'Dokument', confirmText:'Entfernen', warn:`Dokument <b style="color:var(--text);">${dlEsc(d.name||'Dokument')}</b> entfernen?${d.typ==='link'?'':' Die Datei wird endgültig gelöscht.'}`})) return;
  try{
    if(d.typ!=='link'){ try{ await storage.refFromURL(d.u).delete(); }catch(e){ if(e.code!=='storage/object-not-found') throw e; } }
    await db.collection('projects').doc(currentProjectId).collection('trees').doc(treeId)
      .set({dokumente:firebase.firestore.FieldValue.arrayRemove(d)},{merge:true});
    tree.dokumente=tree.dokumente.filter((_,i)=>i!==idx);
    notify('✓ Entfernt');
    refreshMediaViews(treeId);
  }catch(e){ notify('Fehler: '+(e.message||e.code)); }
}

// Inline-Tour-Mehrfachauswahl im Objekt-Detail: echte Touren immer, Übersichten ein-/ausblendbar
let showOverviewInDetail=false;
function toggleOverviewInDetail(){ showOverviewInDetail=!showOverviewInDetail; renderInlineTourChips(); }
function renderInlineTourChips(){
  const wrap=document.getElementById('inline-tour-wrap'); if(!wrap) return;
  const tree=trees.find(t=>t.id===selectedTreeId);
  const cur=tree?getTreeTourIds(tree):[];
  const ueb=tours.filter(t=>isOverviewTour(t.id));
  const visible0=tours.filter(t=>!isOverviewTour(t.id) || showOverviewInDetail); // echte Touren immer; Übersicht nur eingeblendet
  // Zugeordnete Touren nach oben (stabile Sortierung erhält die übrige Reihenfolge)
  const visible=[...visible0].sort((a,b)=>(cur.includes(b.id)?1:0)-(cur.includes(a.id)?1:0));
  const ro=isReadonly();
  const rowHtml=(t,first)=>{
    const sel=cur.includes(t.id);
    const div=first?'border-top:2px solid var(--border);':''; // Trenner zwischen zugeordnet/übrige
    return `<label data-tourid="${t.id}" data-tourname="${(t.name||'').toLowerCase().replace(/"/g,'&quot;')}" style="display:flex;align-items:center;gap:9px;padding:7px 10px;cursor:pointer;border-bottom:1px solid var(--border);${div}font-size:13px;background:${sel?t.color+'14':'transparent'};">
      <input type="checkbox"${sel?' checked':''} style="width:15px;height:15px;flex-shrink:0;cursor:pointer;accent-color:${t.color};">
      <span style="width:11px;height:11px;border-radius:50%;background:${t.color};flex-shrink:0;"></span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(t.name)}${isOverviewTour(t.id)?' <span style="font-size:10px;color:var(--text3);font-weight:600;">Übersicht</span>':''}</span>
    </label>`;
  };
  const _selCount=visible.filter(t=>cur.includes(t.id)).length;
  const chips = tours.length===0
    ? '<div style="padding:10px;font-size:12px;color:var(--text3);">Keine Touren angelegt</div>'
    : (visible.map((t,i)=>rowHtml(t, i===_selCount && _selCount>0)).join('') || '<div style="padding:10px;font-size:12px;color:var(--text3);">Keine echten Touren — über „Übersichten einblenden" anzeigen.</div>');
  // Suchfeld erst ab vielen Touren einblenden
  const search = visible0.length>6
    ? `<input id="inline-tour-search" type="text" placeholder="Tour suchen…" oninput="filterInlineTours(this.value)" autocomplete="off" style="width:100%;padding:6px 9px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:12px;font-family:inherit;margin-bottom:5px;box-sizing:border-box;outline:none;">`
    : '';
  const toggle = ueb.length
    ? `<div onclick="toggleOverviewInDetail()" style="cursor:pointer;font-size:12px;font-weight:600;color:var(--green);padding:5px 2px;">${showOverviewInDetail?'− Übersichten ausblenden':`+ Übersichten einblenden (${ueb.length})`}</div>`
    : '';
  wrap.innerHTML=`${search}<div id="inline-tour-chips" style="max-height:170px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;">${chips}</div><div id="inline-tour-empty" style="display:none;padding:10px;font-size:12px;color:var(--text3);">Keine Tour gefunden.</div>${toggle}
    <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;width:100%;${ro?'opacity:.45;cursor:not-allowed;':''}" ${ro?'disabled title="Nur Lesezugriff"':`onclick="saveInlineFields('${selectedTreeId}')"`}>Touren speichern</button>`;
}
// Live-Filter der Detail-Tourliste: blendet nur aus (Häkchen ausgeblendeter Touren bleiben im DOM → kein Datenverlust beim Speichern)
function filterInlineTours(q){
  q=(q||'').trim().toLowerCase();
  let vis=0;
  document.querySelectorAll('#inline-tour-chips [data-tourid]').forEach(r=>{
    const show=!q || (r.getAttribute('data-tourname')||'').includes(q);
    r.style.display=show?'':'none'; if(show) vis++;
  });
  const empty=document.getElementById('inline-tour-empty'); if(empty) empty.style.display=(q&&vis===0)?'block':'none';
}
async function saveInlineFields(id){
  if(isReadonly()){ notify('Nur Lesezugriff'); return; }
  const wasser=document.getElementById('inline-wasser')?.value;
  const zustand=document.getElementById('inline-zustand')?.value;
  // Touren aus Checkbox-Auswahl lesen
  const rows=document.querySelectorAll('#inline-tour-chips [data-tourid]');
  const rendered=new Set([...rows].map(r=>r.dataset.tourid));
  const checked=[...rows].filter(r=>r.querySelector('input[type=checkbox]')?.checked).map(r=>r.dataset.tourid);
  // Eingeklappte (nicht gerenderte) Übersichts-Zuweisungen erhalten → kein Datenverlust
  const tree0=trees.find(t=>t.id===id);
  const hiddenUeb=(tree0?getTreeTourIds(tree0):[]).filter(tid=>isOverviewTour(tid) && !rendered.has(tid));
  const selectedTourIds=[...new Set([...checked,...hiddenUeb])];
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
async function fillArtSelect(current, klasse){
  const sel=document.getElementById('f-art'); if(!sel) return;
  if(artenList.length===0) await loadArten();
  if(klasse===undefined) klasse=document.getElementById('f-klasse')?.value||'';
  // Arten der gewählten Objektklasse (Arten ohne Klassen-Tag gelten für alle)
  const list=artenList.filter(a=>!a.klasse || a.klasse===klasse);
  let names=[...new Set(list.map(a=>a.name).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
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
// Felder einer Objektklasse (Allowlist); null = keine/leere Klasse → alle Felder zeigen (Default)
function _klasseFelder(tree){
  const kl=objektklassen.find(k=>k.id===tree?.klasse);
  return (kl && Array.isArray(kl.felder) && kl.felder.length) ? kl.felder : null;
}
// Kundenfelder dynamisch ins Formular rendern (je Feld ein Dropdown)
function renderCustomFieldInputs(tree){
  const wrap=document.getElementById('f-custom-fields'); if(!wrap) return;
  const gt=geomTypeOf(tree);
  const kf=_klasseFelder(tree);
  wrap.innerHTML=customFields.filter(c=>fieldAppliesTo(c,gt) && (!kf||kf.includes(c.key))).map(c=>{
    const cur=((tree?tree[c.key]:'')||'');
    return `<div class="form-group"><label class="form-label">${dlEsc(c.label)}</label><select class="form-control" id="f-${c.key}">${_listOptions(c.key,cur)}</select></div>`;
  }).join('');
}

// Klassifizierungs-Selects füllen + Sichtbarkeit (Reinigungsklasse nur Abschnitt, Häufigkeit nur Seite)
function _fillKlasseSelects(tree){
  const kSel=document.getElementById('f-klasse');
  if(kSel) kSel.innerHTML='<option value="">– keine –</option>'+objektklassen.map(k=>`<option value="${dlEsc(k.id)}"${tree.klasse===k.id?' selected':''}>${dlEsc(k.name)}</option>`).join('');
  // Container (Abschnitt) ist kein Objekt → Objektklasse-Feld ausblenden
  if(kSel){ const kg=kSel.closest('.form-group'); if(kg) kg.style.display=_isContainer(tree)?'none':''; }
  const isAbschnitt=_isContainer(tree);
  const isSeite=!!tree.containerExtId;
  const rRow=document.getElementById('row-f-reinigungsklasse');
  if(rRow){ rRow.style.display=isAbschnitt?'':'none';
    const rSel=document.getElementById('f-reinigungsklasse');
    if(rSel) rSel.innerHTML='<option value="">– keine –</option>'+reinigungsklassen.map(r=>`<option value="${dlEsc(r.id)}"${tree.reinigungsklasse===r.id?' selected':''}>${dlEsc(r.name)}</option>`).join('');
  }
  const hRow=document.getElementById('row-f-haeufigkeit');
  if(hRow){ hRow.style.display=isSeite?'':'none';
    const hIn=document.getElementById('f-haeufigkeit'); if(hIn) hIn.value=(tree.haeufigkeit!=null?tree.haeufigkeit:'');
  }
}
// Klassenwechsel im Formular: Felder live nachblenden (ohne f-klasse-Auswahl zurückzusetzen)
function onKlasseChange(){
  const tree=trees.find(t=>t.id===editingTreeId); if(!tree) return;
  const tmp={...tree, klasse:document.getElementById('f-klasse').value};
  renderCustomFieldInputs(tmp); _applyKlasseScope(tmp);
  fillArtSelect(document.getElementById('f-art')?.value||'', tmp.klasse); // Typ/Art-Liste der neuen Klasse
  const isAbschnitt=_isContainer(tree);
  const rRow=document.getElementById('row-f-reinigungsklasse'); if(rRow) rRow.style.display=isAbschnitt?'':'none';
}
// Stage 4: Standard-Formularfelder nach Objektklasse ein-/ausblenden (name bleibt immer)
function _applyKlasseScope(tree){
  const sel=_klasseFelder(tree);
  const govern={stadtteil:'f-stadtteil',baumnr:'f-baumnr',art:'f-art',pflanzjahr:'f-pflanzjahr',pflanzzeitpunkt:'f-pflanzzeitpunkt',zustand:'f-zustand',wasser:'f-wasser',notiz:'f-notiz'};
  Object.entries(govern).forEach(([key,id])=>{
    const el=document.getElementById(id); const grp=el&&el.closest('.form-group');
    if(grp) grp.style.display=(!sel||sel.includes(key))?'':'none';
  });
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
  fillArtSelect(tree.art||'', tree.klasse||'');
  fillListSelect('pflanzjahr',tree.pflanzjahr||'');
  fillListSelect('pflanzzeitpunkt',tree.pflanzzeitpunkt||'');
  renderCustomFieldInputs(tree);
  _fillKlasseSelects(tree);
  _applyKlasseScope(tree);
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
    // tourId/tourIds bewusst NICHT hier schreiben: das Feld ist ausgeblendet und trägt nur die
    // erste Tour → Speichern würde Mehrfach-Touren und Übersichts-Zugehörigkeit kappen.
    // Tour-Zuordnung läuft ausschließlich über die Planung (Lasso/Zuweisen).
    notiz:document.getElementById('f-notiz').value,
    klasse:document.getElementById('f-klasse')?.value||'',
  };
  // Reinigungsklasse/Häufigkeit nur schreiben, wenn relevant (Abschnitt bzw. Seite) — sonst Punkte nicht verunreinigen
  const _rRow=document.getElementById('row-f-reinigungsklasse');
  if(_rRow&&_rRow.style.display!=='none') data.reinigungsklasse=document.getElementById('f-reinigungsklasse').value||'';
  const _hRow=document.getElementById('row-f-haeufigkeit');
  if(_hRow&&_hRow.style.display!=='none'){ const hv=(document.getElementById('f-haeufigkeit').value||'').trim(); data.haeufigkeit=hv===''?null:(parseFloat(hv.replace(',','.'))||0); }
  // Nur tatsächlich angezeigte Kundenfelder schreiben — sonst würden für den Typ ausgeblendete Felder überschrieben
  customFields.forEach(c=>{ const el=document.getElementById('f-'+c.key); if(el) data[c.key]=el.value; });
  try{
    if(editingTreeId){
      await updateDoc(doc(db,'projects',currentProjectId,'trees',editingTreeId),data);
      notify('Objekt aktualisiert');
    } else {
      const baumId=await getNextBaumId();
      await addDoc(collection(db,'projects',currentProjectId,'trees'),{
        ...data,
        baumId, // eindeutige fortlaufende ID z.B. B-00042
        tourIds:[], tourId:'', // neues Objekt startet unverplant
        history:[],
        createdAt:serverTimestamp()
      });
      notify('Objekt hinzugefügt');
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

// Gelöschte Objekt-IDs aus den Artefakten der Auto-Planung entfernen: Varianten-Touren/unassigned
// (mit Neuberechnung der Zähl-KPIs) und die persistierten Fixierungen am Projekt-Doc. Sonst zeigen
// Varianten „Phantom-Objekte" und der Fixierungs-Zähler tote Einträge.
async function _stripIdsFromPlanArtifacts(ids){
  const set=new Set(ids); if(!set.size) return;
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'planVarianten'));
    for(const d of snap.docs){
      const v=d.data()||{}; let changed=false;
      const touren=(v.touren||[]).map(t=>{
        const keep=(t.objektIds||[]).filter(x=>!set.has(x));
        if(keep.length!==(t.objektIds||[]).length) changed=true;
        return {...t, objektIds:keep};
      });
      const unassigned=(v.unassigned||[]).filter(u=>!set.has(u&&u.id));
      if(unassigned.length!==(v.unassigned||[]).length) changed=true;
      if(changed){
        const kpi={...(v.kpi||{})};
        kpi.objekte=touren.reduce((s,t)=>s+(t.objektIds||[]).length,0);
        kpi.unassigned=unassigned.length;
        kpi.fzg=touren.filter(t=>(t.objektIds||[]).length).length;
        await updateDoc(doc(db,'projects',currentProjectId,'planVarianten',d.id),{touren,unassigned,kpi});
      }
    }
  }catch(e){ console.warn('_stripIdsFromPlanArtifacts planVarianten',e); }
  // Fixierungen am Projekt-Doc säubern
  try{
    const r=currentProjectData&&currentProjectData.autoplanRahmen;
    if(r&&Array.isArray(r.locks)&&r.locks.some(l=>l&&set.has(l.id))){
      r.locks=r.locks.filter(l=>l&&!set.has(l.id));
      await updateDoc(doc(db,'projects',currentProjectId),{autoplanRahmen:r});
      if(_apRahmen&&Array.isArray(_apRahmen.locks)) _apRahmen.locks=_apRahmen.locks.filter(l=>l&&!set.has(l.id));
    }
  }catch(e){ console.warn('_stripIdsFromPlanArtifacts locks',e); }
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
  if(!confirm(`„${tree.name||'Objekt'}" als INAKTIV markieren?\n\n`+
    `• Wird aus Karte, Tourplanung und „offen"-Zahlen ausgeblendet`+
    (tourCnt?`\n• Wird aus ${tourCnt} Tour(en) entfernt`:'')+
    `\n• Historie bleibt erhalten, jederzeit reaktivierbar`)) return;
  setSyncState('syncing','Speichert…');
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',id),
      {aktiv:false, archiviertAm:serverTimestamp(), tourIds:[], tourId:''});
    await removeTreeFromRoutes(id);
    notify('Objekt inaktiv gesetzt');
  }catch(e){ notify('Fehler: '+e.message); }
}

async function reactivateTree(id){
  if(!trees.find(t=>t.id===id)) return;
  setSyncState('syncing','Speichert…');
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'trees',id),{aktiv:true});
    notify('Objekt reaktiviert — bei Bedarf wieder einer Tour zuweisen');
  }catch(e){ notify('Fehler: '+e.message); }
}

async function deleteTree(id){
  const tree=trees.find(t=>t.id===id);
  if(!tree){ await deleteDoc(doc(db,'projects',currentProjectId,'trees',id)); closePanel(); return; }
  // Schutz: Objekte mit Historie nicht endgültig löschen → Archiv anbieten
  if(await treeHasHistory(tree)){
    if(confirm(`„${tree.name||'Objekt'}" hat eine Bewässerungs-Historie und kann nicht endgültig `+
      `gelöscht werden (Historie/Controlling würde verfälscht).\n\nStattdessen als INAKTIV archivieren?`)){
      await archiveTree(id);
    }
    return;
  }
  const tourCnt=getTreeTourIds(tree).length;
  if(!await confirmByName({title:'Objekt löschen', label:'Objekt', name:tree.name||'Objekt',
    warn:`Objekt <b style="color:var(--text);">${dlEsc(tree.name||'Objekt')}</b> ENDGÜLTIG löschen?`+(tourCnt?`<br>Wird aus ${tourCnt} Tour(en) entfernt.`:'')+`<br><span style="color:var(--red);">Kann nicht rückgängig gemacht werden.</span>`})) return;
  setSyncState('syncing','Löscht…');
  try{
    await removeTreeFromRoutes(id);
    await _stripIdsFromPlanArtifacts([id]); // aus Auto-Planungs-Varianten + Fixierungen entfernen
    await deleteDoc(doc(db,'projects',currentProjectId,'trees',id));
    closePanel(); closeTreeModal(); notify('Objekt gelöscht');
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
  document.getElementById('mode-text').textContent=`Position für „${tree?.name||'Objekt'}" klicken`;
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
  // Ziel-Tour gleich farblich einblenden (sieht man, was schon zugeordnet ist / wo erweitern)
  refreshMarkers(); try{ renderDrawnGeoms(); }catch(_){}

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
  // Übersichten nur nach Bedarf (eigene Gruppe), per Umschalt-Eintrag ein-/ausblendbar
  if(showOverviewInAssign && ueb.length) html+=`<optgroup label="Übersichten" style="color:#111;">${ueb.map(opt).join('')}</optgroup>`;
  if(ueb.length) html+=`<option value="__toggle_overview__" style="color:#2d6a4f;background:#fff;">${showOverviewInAssign?'− Übersichten ausblenden':'+ Übersichten einblenden…'}</option>`;
  sel.innerHTML=html;
  // Gültige Auswahl sicherstellen (keine ausgeblendete Übersicht aktiv lassen)
  const valid=tours.some(t=>t.id===assignTourId) && (showOverviewInAssign || !isOverviewTour(assignTourId));
  if(!valid) assignTourId=(echte[0]||ueb[0])?.id||null;
  lassoTourId=assignTourId;
  if(assignTourId) sel.value=assignTourId;
  updateAssignSwatch();
}

function setAssignTour(id){
  if(id==='__toggle_overview__'){ // Umschalt-Eintrag: Übersichten ein-/ausblenden, Auswahl behalten
    showOverviewInAssign=!showOverviewInAssign;
    rebuildAssignPills(); renderLassoActions();
    return;
  }
  assignTourId=id;lassoTourId=id;
  const sel=document.getElementById('assign-tour-select');
  if(sel) sel.value=id;
  updateAssignSwatch();
  renderLassoActions(); // Ziel-Tour-Name in den Aktions-Buttons aktualisieren
  if(assignMode){ refreshMarkers(); try{ renderDrawnGeoms(); }catch(_){} } // neue Ziel-Tour farblich einblenden
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
  refreshMarkers(); try{ renderDrawnGeoms(); }catch(_){} // Planen-Einfärbung zurücknehmen
}

// Hinweisdialog, wenn ein Baum bereits anderen Touren zugeordnet ist.
// Liefert: 'move' (aus bisherigen entfernen) | 'add' (zusätzlich) | 'cancel'
function showTourConflictDialog(tree, currentTour, otherTourIds){
  return new Promise(resolve=>{
    const otherNames=otherTourIds.map(id=>dlEsc(tours.find(t=>t.id===id)?.name||'Tour'));
    const namesStr=otherNames.map(n=>`„${n}"`).join(', ');
    const curName=dlEsc(currentTour?.name||'aktuelle Tour');
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
        Das ausgewählte Objekt <b style="color:var(--text);">${dlEsc(tree.name||'')}</b> ist bereits ${plural?'den Touren':'der Tour'} ${namesStr} zugeordnet.<br><br>
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
  // Tour-Restriktion: passt das Objekt zu den Regeln der Tour? (Warnung mit Override)
  if(!skipConflictCheck){
    const viol=treeRuleViolations(tree, tour);
    if(viol.length){
      const r=await ruleWarnDialog(`<b>${dlEsc(tree.name||'Objekt')}</b> passt nicht zu den Regeln von <b>${dlEsc(tour?.name||'Tour')}</b>.<br><span style="color:var(--text3);">Abweichung bei: ${viol.map(dlEsc).join(', ')}</span>`);
      if(r!=='all') return; // Einzelobjekt: nur „Trotzdem zuweisen" fährt fort
    }
  }
  // Bereits anderen ECHTEN Tour(en) zugeordnet → Hinweisdialog (Übersichten zählen nicht als Konflikt)
  const uebersichten=currentIds.filter(id=>isOverviewTour(id));
  const otherIds=currentIds.filter(id=>id!==tourId && !isOverviewTour(id));
  if(otherIds.length>0 && !skipConflictCheck){
    const choice=await showTourConflictDialog(tree, tour, otherIds);
    if(choice==='cancel') return;
    if(choice==='move'){
      await setTreeTourIds(treeId, [tourId, ...uebersichten]); // aus echten Touren raus, Übersichten bleiben
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
    `<div class="color-swatch${c===sel?' selected':''}" style="background:${c};" title="${c}" onclick="pickColor('${c}',this)"></div>`).join('');
  selectedTourColor=sel||TOUR_COLORS[0];
}
function pickColor(c,el){ selectedTourColor=c; document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('selected')); if(el) el.classList.add('selected'); }

// Zusatztätigkeiten-Editor (Pause, Rüstzeit …) — Arbeitskopie an window für Inline-Handler
function renderTourZusatzRows(){
  const el=document.getElementById('t-zusatz-list'); if(!el) return;
  const arr=window._tourZusatz||[];
  el.innerHTML=arr.length?arr.map((z,i)=>`<div style="display:flex;gap:5px;align-items:center;">
    <input class="form-control" value="${dlEsc(z.label||'')}" placeholder="z. B. Pause" oninput="window._tourZusatz[${i}].label=this.value" style="flex:1;padding:5px 8px;font-size:12px;">
    <input class="form-control" type="number" min="0" step="1" value="${z.min||''}" placeholder="0" oninput="window._tourZusatz[${i}].min=Math.max(0,parseInt(this.value)||0)" style="width:62px;text-align:right;padding:5px 6px;font-size:12px;">
    <span style="font-size:11px;color:var(--text3);">min</span>
    <button type="button" onclick="tourZusatzDel(${i})" title="Entfernen" style="border:none;background:none;cursor:pointer;color:var(--text3);font-size:17px;line-height:1;padding:2px 4px;">×</button>
  </div>`).join(''):'<div style="font-size:11px;color:var(--text3);">Keine — mit „+ Tätigkeit" hinzufügen.</div>';
}
function tourZusatzAdd(){ (window._tourZusatz=window._tourZusatz||[]).push({label:'',min:0}); renderTourZusatzRows(); }
function tourZusatzDel(i){ if(window._tourZusatz) window._tourZusatz.splice(i,1); renderTourZusatzRows(); }

// Zuordnungsregeln-Editor (Restriktion je Tour) — Chips je Listenfeld
function renderTourRegeln(){
  const el=document.getElementById('t-regeln-list'); if(!el) return;
  const reg=window._tourRegeln=window._tourRegeln||{};
  let activeCount=0;
  el.innerHTML=tourRuleFieldDefs().map(def=>{
    const opts=ruleFieldOptions(def.key);
    if(!opts.length) return '';
    const sel=Array.isArray(reg[def.key])?reg[def.key]:[];
    if(sel.length) activeCount++;
    const chips=opts.map((o,oi)=>{
      const on=sel.includes(o.val);
      return `<button type="button" onclick="tourRegelToggle('${_jsArg(def.key)}',${oi})" style="padding:3px 9px;font-size:11px;border-radius:12px;cursor:pointer;border:1px solid ${on?'var(--green-mid)':'var(--border)'};background:${on?'var(--green-light)':'var(--bg)'};color:${on?'var(--green-strong,#15803d)':'var(--text2)'};font-family:inherit;">${o.color?`<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${o.color};margin-right:4px;vertical-align:middle;"></span>`:''}${dlEsc(o.label)}</button>`;
    }).join('');
    return `<div><div style="font-size:11px;font-weight:600;color:var(--text2);margin-bottom:3px;">${dlEsc(def.label)} ${sel.length?`<span style="color:var(--text3);font-weight:400;">(${sel.length} erlaubt)</span>`:'<span style="color:var(--text3);font-weight:400;">– alle erlaubt</span>'}</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${chips}</div></div>`;
  }).join('')||'<div style="font-size:11px;color:var(--text3);">Keine Listenfelder mit Werten vorhanden.</div>';
  const cnt=document.getElementById('t-regeln-count');
  if(cnt) cnt.textContent=activeCount?`— ${activeCount} Feld${activeCount>1?'er':''} eingeschränkt`:'— alle Objekte erlaubt';
}
function tourRegelToggle(key,idx){
  const o=ruleFieldOptions(key)[idx]; if(!o) return;
  const reg=window._tourRegeln=window._tourRegeln||{};
  const arr=Array.isArray(reg[key])?reg[key]:[];
  const i=arr.indexOf(o.val);
  if(i>=0) arr.splice(i,1); else arr.push(o.val);
  if(arr.length) reg[key]=arr; else delete reg[key];
  renderTourRegeln();
}
// Bereinigte Regelkopie für saveTour: nur Felder mit Auswahl.
function collectTourRegeln(){
  const reg=window._tourRegeln||{}, out={};
  for(const k of Object.keys(reg)){ if(Array.isArray(reg[k])&&reg[k].length) out[k]=[...reg[k]]; }
  return out;
}

function openTourModal(id){
  editingTourId=id||null;
  const t=id?tours.find(x=>x.id===id):null;
  if(t){
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
  const sysSel=document.getElementById('t-system');
  if(sysSel){ sysSel.innerHTML='<option value="">— keines —</option>'+getReinigungssysteme().map(s=>`<option value="${dlEsc(s.id)}">${dlEsc(s.name)} (${_rsTypLabel(s.typ)})</option>`).join(''); sysSel.value=t?.reinigungssystem||''; }
  const az=t&&typeof t.arbeitszeitMin==='number'&&t.arbeitszeitMin>0?t.arbeitszeitMin:0;
  document.getElementById('t-az-h').value=az?Math.floor(az/60):'';
  document.getElementById('t-az-m').value=az?az%60:'';
  window._tourZusatz=(t&&Array.isArray(t.zusatzzeiten)?t.zusatzzeiten:[]).map(z=>({label:z.label||'',min:Math.max(0,z.min)||0}));
  renderTourZusatzRows();
  window._tourRegeln={};
  if(t&&t.regeln) for(const k of Object.keys(t.regeln)){ if(Array.isArray(t.regeln[k])&&t.regeln[k].length) window._tourRegeln[k]=[...t.regeln[k]]; }
  const det=document.getElementById('t-regeln-details'); if(det) det.open=tourHasRules(t||{});
  renderTourRegeln();
  // Rhythmus & Gültigkeit
  document.getElementById('t-startdate').value=(t&&t.startDate)||'';
  document.getElementById('t-interval').value=(t&&t.interval)||'';
  window._tourGueltig=(t&&Array.isArray(t.gueltig)?t.gueltig:[]).map(g=>({from:g.from||'',to:g.to||''}));
  renderTourGueltigRows(); tourUpdWeekday();
  document.getElementById('tour-modal').classList.add('open');
}
function closeTourModal(){ document.getElementById('tour-modal').classList.remove('open');editingTourId=null; }

async function saveTour(){
  const name=document.getElementById('t-name').value.trim();
  if(!name){alert('Bitte einen Namen eingeben.');return;}
  const azh=parseInt(document.getElementById('t-az-h').value)||0;
  const azm=parseInt(document.getElementById('t-az-m').value)||0;
  const arbeitszeitMin=Math.max(0,azh)*60+Math.max(0,azm);
  const zusatzzeiten=(window._tourZusatz||[]).map(z=>({label:(z.label||'').trim(),min:Math.max(0,parseInt(z.min)||0)})).filter(z=>z.label||z.min>0);
  const startDate=document.getElementById('t-startdate').value||'';
  const interval=document.getElementById('t-interval').value||'';
  const gueltig=(window._tourGueltig||[]).filter(g=>g.from&&g.to).map(g=>({from:g.from,to:g.to}));
  const data={name,desc:document.getElementById('t-desc').value,color:selectedTourColor,zusatzzeiten,regeln:collectTourRegeln(),startDate,interval,gueltig,reinigungssystem:document.getElementById('t-system')?.value||''};
  try{
    if(editingTourId){
      data.arbeitszeitMin=arbeitszeitMin>0?arbeitszeitMin:firebase.firestore.FieldValue.delete();
      await updateDoc(doc(db,'projects',currentProjectId,'tours',editingTourId),data);
      notify('Tour aktualisiert');
    } else {
      if(arbeitszeitMin>0) data.arbeitszeitMin=arbeitszeitMin;
      await addDoc(collection(db,'projects',currentProjectId,'tours'),{...data,createdAt:serverTimestamp()});
      await updateDoc(doc(db,'projects',currentProjectId),{tourCount:tours.length+1});
      notify('Tour erstellt');
    }
    routeCache={};closeTourModal();
  }catch(e){ notify('Fehler: '+e.message); }
}
// ── Tour-Rhythmus-UI im Bearbeiten-Dialog ──
const _WD_FULL=['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
function _wdName(date){ if(!date) return ''; const [Y,M,D]=date.split('-').map(Number); return _WD_FULL[new Date(Y,M-1,D).getDay()]; }
function _todayStr(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function tourUpdWeekday(){ const el=document.getElementById('t-weekday'); const sd=document.getElementById('t-startdate')?.value; if(el) el.textContent=sd?_wdName(sd):''; tourRenderPreview(); }
function tourRhythmusUI(){ tourRenderPreview(); }
function tourGueltigAdd(from,to){ window._tourGueltig=window._tourGueltig||[]; window._tourGueltig.push({from:from||'',to:to||''}); renderTourGueltigRows(); }
function tourGueltigDel(i){ if(window._tourGueltig) window._tourGueltig.splice(i,1); renderTourGueltigRows(); }
function tourGueltigSet(i,field,val){ if(window._tourGueltig&&window._tourGueltig[i]){ window._tourGueltig[i][field]=val; tourRenderPreview(); } }
function renderTourGueltigRows(){
  const el=document.getElementById('t-gueltig-list'); if(!el) return;
  const list=window._tourGueltig||[];
  el.innerHTML=list.length?list.map((g,i)=>`<div style="display:flex;align-items:center;gap:7px;">
    <input type="date" class="form-control" value="${g.from||''}" onchange="tourGueltigSet(${i},'from',this.value)" style="width:150px;">
    <span style="font-size:12px;color:var(--text3);">bis</span>
    <input type="date" class="form-control" value="${g.to||''}" onchange="tourGueltigSet(${i},'to',this.value)" style="width:150px;">
    <button type="button" class="btn btn-secondary" style="padding:3px 8px;font-size:12px;color:#c0392b;" onclick="tourGueltigDel(${i})">✕</button>
  </div>`).join(''):'<div style="font-size:11px;color:var(--text3);">Ganzjährig (kein Zeitraum gesetzt).</div>';
  tourRenderPreview();
}
function tourRenderPreview(){
  const el=document.getElementById('t-termin-preview'); if(!el) return;
  const iv=document.getElementById('t-interval')?.value||'';
  const sd=document.getElementById('t-startdate')?.value||'';
  if(iv==='bedarf'){ el.innerHTML='<b>Bedarfstour</b> — kein fester Rhythmus; im Einsatzplaner über „Bedarf" einplanbar.'; return; }
  if(!iv){ el.textContent='Ohne Intervall: läuft an jedem Tag (Bestand).'; return; }
  if(!sd){ el.innerHTML='<span style="color:#b45309;">Bitte Startdatum setzen — bestimmt Wochentag und Rhythmus.</span>'; return; }
  const tmp={interval:iv, startDate:sd, gueltig:(window._tourGueltig||[]).filter(g=>g.from&&g.to)};
  const today=_todayStr(); const startAt=sd>today?sd:today;
  let [Y,M,D]=startAt.split('-').map(Number); let dt=new Date(Y,M-1,D);
  const out=[]; let guard=0;
  while(out.length<5 && guard<732){ const ds=dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); if(tourDueOn(tmp,ds)) out.push(ds); dt.setDate(dt.getDate()+1); guard++; }
  el.innerHTML='Nächste Einsätze: '+(out.length?out.map(d=>{ const [,m,da]=d.split('-'); return _wdName(d).slice(0,2)+' '+da+'.'+m+'.'; }).join(' · '):'<span style="color:#b45309;">keine im Gültigkeitszeitraum</span>');
}

// Übersichten im Touren-Reiter ein-/ausblenden
function toggleOverviewInGrid(){ showOverviewInGrid=!showOverviewInGrid; renderTourenGrid(); }

// Übersicht-Markierung umschalten (Inline-Checkbox im Touren-Reiter)
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
    <div style="padding:14px 20px 6px;font-size:13px;color:var(--text2);line-height:1.6;">Tour <b style="color:var(--text);">${name}</b> löschen?<br>${cnt?`${cnt} Objekte werden aus der Tour entfernt (bleiben erhalten).`:'Objekte bleiben erhalten.'}</div>
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
  // Gesamtbestand bereinigen — auch Objekte außerhalb eines Pilot-Ausschnitts behalten sonst die tote Tour-ID
  for(const tree of ((_allTrees&&_allTrees.length)?_allTrees:trees).filter(t=>treeInTour(t,id))){
    const newIds=getTreeTourIds(tree).filter(tid=>tid!==id);
    await setTreeTourIds(tree.id, newIds);
  }
  await deleteDoc(doc(db,'projects',currentProjectId,'tours',id));
  try{ await deleteDoc(doc(db,'projects',currentProjectId,'routes',id)); }catch(_){}  // gespeicherte Route der Tour mit entfernen (sonst verwaistes Doc)
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
const ICON_CHOICES=['🌳','🌲','🌴','🌿','🍀','🌸','🌷','🌻','🪴','🍂','🗑️','🚮','🪣','♻️','🧹','🐕','💧','⛲','🚿','🪑','🛝','⚽','🚏','🅷','🅿️','🚧','💡','📍','⭐','🚶','🚲','🚴','🛣️','🚗','🚂','🚸','🔗','🥾','🪜','🟫','🔲'];
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

// ── Saison (Phase 2-Grundlage): Sommer-Zeitraum je Projekt; Winter = außerhalb ──
const SAISON_DEFAULT={ von:'04-01', bis:'10-31' }; // 1.4.–31.10.
function getSaison(){ return { von: currentProjectData?.sommerVon||SAISON_DEFAULT.von, bis: currentProjectData?.sommerBis||SAISON_DEFAULT.bis }; }
function _ttmmToMmdd(s){ const m=String(s||'').match(/(\d{1,2})\.\s*(\d{1,2})/); if(!m) return ''; const d=+m[1], mo=+m[2]; if(d<1||d>31||mo<1||mo>12) return ''; return String(mo).padStart(2,'0')+'-'+String(d).padStart(2,'0'); }
function _mmddToTtmm(s){ const m=String(s||'').match(/(\d{2})-(\d{2})/); return m?(+m[2])+'.'+(+m[1])+'.':''; }
// Saison eines Datums (YYYY-MM-DD oder Date): 'sommer' im gepflegten Zeitraum (auch über Jahreswechsel), sonst 'winter'
function saisonFor(date){ const s=getSaison(); let md; if(date instanceof Date) md=String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0'); else md=String(date||'').slice(5,10); if(!md) return 'sommer'; const inRange=(s.von<=s.bis)?(md>=s.von&&md<=s.bis):(md>=s.von||md<=s.bis); return inRange?'sommer':'winter'; }
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
  // Zeitaufwand-Standard wird jetzt im Reiter Objekte → Typ/Art gepflegt
  const _fg=document.getElementById('s-fuellgrad'); if(_fg) _fg.checked=!!currentProjectData?.fuellgradAktiv;
  const _cl=document.getElementById('s-cluster'); if(_cl) _cl.checked=!!currentProjectData?.clusterAktiv;
  const _la=document.getElementById('s-list-abschnitte'); if(_la) _la.checked=!!currentProjectData?.listAbschnitteDefault;
  const _lag=document.getElementById('s-list-abschnitte-group'); if(_lag) _lag.style.display=(trees||[]).some(_isContainer)?'':'none';
  const _sg=document.getElementById('s-saison-group'); if(_sg) _sg.style.display=currentProjectData?.hatFlaechen?'':'none';
  const _sv=document.getElementById('s-saison-von'); if(_sv) _sv.value=_mmddToTtmm(getSaison().von);
  const _sb=document.getElementById('s-saison-bis'); if(_sb) _sb.value=_mmddToTtmm(getSaison().bis);
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
let editingWmsId=null, editingWmsScope=null; // beim Bearbeiten gesetzt
function renderWmsList(){
  const el=document.getElementById('wms-list'); if(!el) return;
  const isSuper=currentRole==='superadmin';
  const sw=document.getElementById('wms-add-scope-wrap'); if(sw) sw.style.display=isSuper?'':'none';
  const all=getWmsLayers();
  const org=all.filter(l=>l._scope==='org');
  const proj=all.filter(l=>l._scope==='project');
  const btns=l=>`<button onclick="editWmsLayer('${l._scope}','${l.id}')" style="border:1px solid var(--border);background:var(--surface);cursor:pointer;color:var(--text2);padding:5px 11px;border-radius:6px;font-size:12px;font-weight:600;font-family:inherit;flex-shrink:0;">Bearbeiten</button>
    <button onclick="deleteWmsLayer('${l._scope}','${l.id}')" title="Löschen" style="border:1px solid var(--red-light);background:var(--surface);cursor:pointer;color:var(--red);padding:5px 8px;border-radius:6px;flex-shrink:0;display:flex;">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg></button>`;
  const item=(l,editable)=>`<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;background:var(--surface);">
    <div style="flex:1;min-width:0;">
      <div style="font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(l.name)}</div>
      <div style="font-size:10px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${l.type==='overlay'?'Overlay':'Basiskarte'} · Layer: ${dlEsc(l.layers||'')}</div>
    </div>
    ${editable?btns(l):'<span style="font-size:10px;color:var(--text3);flex-shrink:0;border:1px solid var(--border);border-radius:6px;padding:3px 8px;">geerbt</span>'}
  </div>`;
  const hdr=t=>`<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin:0 0 8px;">${t}</div>`;
  let html='';
  if(org.length || isSuper){
    html+=hdr('Stadt-Standard – gilt für alle Projekte'+(org.length?' ('+org.length+')':''));
    html+= org.length ? org.map(l=>item(l,isSuper)).join('')
      : '<div style="font-size:12px;color:var(--text3);padding:2px 0 12px;">Noch kein Stadt-Standard. Unten mit Geltungsbereich „Stadt-Standard" hinzufügen.</div>';
  }
  html+=`<div style="${org.length||isSuper?'margin-top:12px;':''}">`+hdr('Nur dieses Projekt'+(proj.length?' ('+proj.length+')':''))+'</div>';
  html+= proj.length ? proj.map(l=>item(l,true)).join('')
    : '<div style="font-size:12px;color:var(--text3);padding:2px 0 6px;">Keine projekteigenen Kartenebenen.</div>';
  el.innerHTML=html;
}
function editWmsLayer(scope,id){
  const l=getWmsLayers().find(x=>x._scope===scope&&x.id===id); if(!l) return;
  editingWmsId=id; editingWmsScope=scope;
  const set=(i,v)=>{ const e=document.getElementById(i); if(e) e.value=v; };
  set('wms-add-name',l.name||''); set('wms-add-url',l.url||''); set('wms-add-layers',l.layers||'');
  set('wms-add-type',l.type||'overlay'); set('wms-add-version',l.version||'1.3.0'); set('wms-add-scope',scope);
  const t=document.getElementById('wms-form-title'); if(t) t.textContent=(scope==='org'?'Stadt-Standard bearbeiten':'Ebene bearbeiten');
  const b=document.getElementById('wms-add-btn'); if(b) b.textContent='Änderungen speichern';
  const c=document.getElementById('wms-cancel-btn'); if(c) c.style.display='';
  document.getElementById('wms-add-name')?.scrollIntoView({behavior:'smooth',block:'center'});
}
function cancelWmsEdit(){
  editingWmsId=null; editingWmsScope=null;
  ['wms-add-name','wms-add-url','wms-add-layers'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; });
  const sc=document.getElementById('wms-add-scope'); if(sc) sc.value='project';
  const t=document.getElementById('wms-form-title'); if(t) t.textContent='Neue Ebene hinzufügen';
  const b=document.getElementById('wms-add-btn'); if(b) b.textContent='+ WMS-Ebene hinzufügen';
  const c=document.getElementById('wms-cancel-btn'); if(c) c.style.display='none';
}
function _wmsClearForm(){ ['wms-add-name','wms-add-url','wms-add-layers'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; }); }
function addWmsLayer(){
  const v=id=>document.getElementById(id)?.value.trim()||'';
  const name=v('wms-add-name'), url=v('wms-add-url'), layers=v('wms-add-layers'),
        type=v('wms-add-type')||'overlay', version=v('wms-add-version')||'1.3.0';
  const scope=(editingWmsId?editingWmsScope:(document.getElementById('wms-add-scope')?.value))||'project';
  if(!name||!url||!layers){ notify('Name, URL und Layer-Name sind erforderlich'); return; }
  if(scope==='org' && currentRole!=='superadmin'){ notify('Stadt-Standard nur durch Superadmin'); return; }
  const list=getWmsLayers().filter(x=>x._scope===scope);
  if(editingWmsId){
    const l=list.find(x=>x.id===editingWmsId);
    if(l) Object.assign(l,{name,url,layers,type,version,transparent:type==='overlay'});
  } else {
    list.push({ id:(window.crypto?.randomUUID?crypto.randomUUID():'w'+Date.now()),
      name, url, layers, type, format:'image/png', version, transparent:type==='overlay', maxZoom:20, attribution:'' });
  }
  const done=()=>{ rebuildLayerControl(); const ed=editingWmsId; cancelWmsEdit(); renderWmsList(); if(!ed)_wmsClearForm(); notify(scope==='org'?'Stadt-Standard gespeichert':'WMS-Ebene gespeichert'); };
  if(scope==='org') saveOrgWms(list).then(done).catch(e=>notify(dlErr(e)));
  else { saveWmsLayers(list); done(); }
}
async function deleteWmsLayer(scope,id){
  const lyr=getWmsLayers().find(l=>l._scope===scope && l.id===id);
  if(!await confirmByName({title:'WMS-Ebene löschen', label:'WMS-Ebene', name:(lyr&&lyr.name)||'WMS-Ebene'})) return;
  if(editingWmsId===id) cancelWmsEdit();
  const list=getWmsLayers().filter(l=>l._scope===scope && l.id!==id);
  const done=()=>{ rebuildLayerControl(); renderWmsList(); notify(scope==='org'?'Stadt-Standard gelöscht':'WMS-Ebene gelöscht'); };
  if(scope==='org') saveOrgWms(list).then(done).catch(e=>notify(dlErr(e)));
  else { saveWmsLayers(list); done(); }
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
    fuellgradAktiv:document.getElementById('s-fuellgrad')?.checked||false,
    clusterAktiv:document.getElementById('s-cluster')?.checked||false,
    listAbschnitteDefault:document.getElementById('s-list-abschnitte')?.checked||false,
    routePlanning:getRoutePlanningEnabled(),
    name:currentProjectData?.name||'', // Projektname wird unter Verwaltung → Projekte verwaltet
    sommerVon:_ttmmToMmdd(document.getElementById('s-saison-von')?.value)||SAISON_DEFAULT.von,
    sommerBis:_ttmmToMmdd(document.getElementById('s-saison-bis')?.value)||SAISON_DEFAULT.bis,
  };
  if(lat&&lng) updates.depot={lat,lng,address:addr||`${lat.toFixed(5)}, ${lng.toFixed(5)}`};
  await saveProjectSettings(updates);
  _listMode = updates.listAbschnitteDefault ? 'abschnitte' : 'objekte'; // neuen Standard sofort anwenden
  document.getElementById('active-project-name').textContent=updates.name;
  closeSettings();renderDepotMarker();
  await loadSavedRoutes();
  applyClusterMode(_effectiveCluster(), false); // Cluster-Modus umschalten (nur ohne Tour-Auswahl; Marker werden gleich neu gebaut)
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
      ${currentRole==='superadmin'?`
      <div class="form-section">Module je Projekt</div>
      <div style="font-size:11px;color:var(--text3);margin:-4px 0 8px;line-height:1.5;">Legt fest, welche Reiter ein <b>einzelnes Projekt</b> anbietet (z. B. „Disposition" nur in passenden Projekten) — unabhängig von den mandantenweiten Rollen-Rechten. Projekt wählen, Haken setzen — wird unten mit <b>„Speichern"</b> gesichert.</div>
      <select id="prj-mod-target" class="form-control" style="width:100%;margin-bottom:8px;font-size:13px;"><option>Lade…</option></select>
      <div id="prj-mods" style="display:grid;grid-template-columns:1fr 1fr;gap:3px 12px;margin-bottom:6px;"></div>`:''}
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
  m.querySelector('#prj-del').onclick=()=>{ close(); confirmDeleteProject(); };
  m.querySelector('#prj-save').onclick=async()=>{
    const name=m.querySelector('#prj-name').value.trim();
    if(!name){ notify('Projektname darf nicht leer sein'); return; }
    try{
      await saveProjectSettings({name});
      document.getElementById('active-project-name').textContent=name;
      // Superadmin: Module des gewählten Projekts gleich mitspeichern
      if(currentRole==='superadmin'){
        const tsel=m.querySelector('#prj-mod-target'); const pid=tsel?tsel.value:'';
        if(pid){
          const modules={}; m.querySelectorAll('#prj-mods .prj-mod').forEach(c=>{ modules[c.dataset.mod]=c.checked; });
          await updateDoc(doc(db,'projects',pid),{modules});
          if(pid===currentProjectId){ currentProjectData.modules=modules; applyModulePermissions(); }
        }
      }
      close(); notify('Gespeichert');
    }catch(e){ notify('Fehler: '+(e.message||e)); }
  };
  // Modul-Manager je Projekt (Superadmin): alle Projekte des Mandanten einzeln schaltbar
  if(currentRole==='superadmin'){
    const sel=m.querySelector('#prj-mod-target'), modsBox=m.querySelector('#prj-mods'), projCache={};
    const renderMods=pid=>{
      const pm=(projCache[pid]&&projCache[pid].modules)||{};
      modsBox.innerHTML=MODULES.map(mm=>`<label style="display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" class="prj-mod" data-mod="${mm.key}"${pm[mm.key]===false?'':' checked'}> ${dlEsc(mm.label)}</label>`).join('');
    };
    (async()=>{
      try{
        const qs=await db.collection('projects').where('orgId','==',currentProjectData.orgId).get();
        const list=qs.docs.map(d=>({id:d.id,name:d.data().name||d.id,modules:d.data().modules||{}})).sort((a,b)=>a.name.localeCompare(b.name));
        list.forEach(p=>projCache[p.id]=p);
        sel.innerHTML=list.map(p=>`<option value="${dlEsc(p.id)}"${p.id===currentProjectId?' selected':''}>${dlEsc(p.name)}</option>`).join('');
        renderMods(currentProjectId);
      }catch(e){ console.warn('proj modules load',e); modsBox.innerHTML='<div style="font-size:11px;color:var(--red,#c0392b);">Konnte Projekte nicht laden</div>'; }
    })();
    sel.onchange=()=>renderMods(sel.value);
  }
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
  const sollist=document.getElementById('view-sollist'); if(sollist) sollist.style.display=v==='sollist'?'flex':'none';
  const datenq=document.getElementById('view-datenqualitaet'); if(datenq) datenq.style.display=v==='datenqualitaet'?'flex':'none';
  const autoplan=document.getElementById('view-autoplan'); if(autoplan) autoplan.style.display=v==='autoplan'?'flex':'none';
  const ausf=document.getElementById('view-ausfaelle'); if(ausf) ausf.style.display=v==='ausfaelle'?'flex':'none';
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
  const einsatzplaner=document.getElementById('view-einsatzplaner'); if(einsatzplaner) einsatzplaner.style.display=v==='einsatzplaner'?'flex':'none';
  if(verwaltung) verwaltung.style.display=v==='verwaltung'?'block':'none';
  const vReinig=document.getElementById('view-reinigungssysteme'); if(vReinig) vReinig.style.display=v==='reinigungssysteme'?'block':'none';
  const vNachr=document.getElementById('view-nachrichten'); if(vNachr) vNachr.style.display=v==='nachrichten'?'flex':'none';
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
  if(v==='sollist') initSollIstView();
  if(v==='datenqualitaet') initDatenqualitaet();
  if(v==='ausfaelle') initAusfaelle();
  if(v==='autoplan') initAutoplan();
  if(v==='kiconfig') renderKiConfig();
  if(v==='handbuch') renderHandbuch();
  if(v==='wmskarten') renderWmsList();
  if(v==='mandanten') renderMandanten();
  if(v==='systeminfo') renderSystemInfo();
  if(v==='disposition') initDispo();
  if(v==='einsatzplaner') initEinsatzplaner();
  if(v==='verwaltung') initVerwaltung();
  if(v==='reinigungssysteme') renderReinigungssysteme();
  if(v==='nachrichten') initNachrichten();
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
// ─── NACHRICHTEN (Push-/Postfach an Fahrer) ─────────────────────────────────
let _nmDrivers=[];                 // login-fähige Fahrer der Org [{id,name,nameLower}]
let _nmType='info';                // 'info'|'task'
let _nmAudience='all';             // 'all'|'tour'|'toursOfDay'|'drivers'
let _nmTourId='';
let _nmSel=new Set();              // ausgewählte driverIds (audience 'drivers')
let _nmUnsub=null;
let _nmMessages=[];
let _nmExpanded=null;              // aktuell aufgeklappte msgId
let _nmRecips={};                  // msgId -> recipient-Docs (Aggregat)
let _nmDelArm=null;                // msgId, fuer den die Loesch-Bestaetigung offen ist
let _nmShowArchived=false;
let _nmPushEnabled=null;           // orgs/{org}.pushEnabled (nur Superadmin sichtbar/änderbar)
function _nmIsAdmin(){ return currentRole==='superadmin' || currentCap==='admin'; }
function _nmPill(txt,bg,fg){ return '<span style="font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;background:'+bg+';color:'+fg+';white-space:nowrap;">'+txt+'</span>'; }
function _nmStatusPill(x,isTask){ return x.doneAt?_nmPill('Erledigt','#dcfce7','#166534'):x.seenAt?_nmPill('Gesehen','#dbeafe','#1e40af'):_nmPill(isTask?'Offen':'Neu','#f3f4f6','#374151'); }

function _nmCanPlan(){ return currentRole==='superadmin' || currentCap==='admin' || currentCap==='editor'; }
function _nmTime(iso){ if(!iso) return '–'; try{ const d=new Date(iso); return ('0'+d.getDate()).slice(-2)+'.'+('0'+(d.getMonth()+1)).slice(-2)+'. '+('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2); }catch(_){ return '–'; } }

async function initNachrichten(){
  const body=document.getElementById('nachrichten-body'); if(!body) return;
  const org=currentProjectData?.orgId||currentOrg;
  if(!_nmCanPlan()){ body.innerHTML='<div style="color:var(--text3);padding:30px;">Nur für Planer/Administratoren.</div>'; return; }
  if(!org){ body.innerHTML='<div style="color:var(--text3);padding:30px;">Bitte zuerst ein Projekt/einen Mandanten öffnen.</div>'; return; }
  // Fahrer der Org laden (nur login-fähige)
  _nmDrivers=[];
  try{ const qs=await db.collection('drivers').where('orgId','==',org).get();
    qs.forEach(d=>{ const x=d.data(); if(x.active!==false && x.noLogin!==true) _nmDrivers.push({id:d.id, name:x.name||'', nameLower:(x.nameLower||x.name||'').toLowerCase()}); });
  }catch(e){ console.warn('Nachrichten: Fahrer laden', e); }
  _nmDrivers.sort((a,b)=>a.name.localeCompare(b.name));
  _nmPushEnabled=null;
  if(currentRole==='superadmin'){ try{ const o=await db.collection('orgs').doc(org).get(); _nmPushEnabled=o.exists?(o.data().pushEnabled===true):false; }catch(_){ _nmPushEnabled=false; } }
  // Verlauf-Listener (Org)
  if(_nmUnsub){ try{ _nmUnsub(); }catch(_){} _nmUnsub=null; }
  _nmUnsub = db.collection('messages').where('orgId','==',org).onSnapshot(snap=>{
    _nmMessages = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
    if(currentView==='nachrichten') renderNachrichten();
  }, err=>console.warn('Nachrichten-Listener', err));
  renderNachrichten();
}

function nmSetType(t){ _nmType=t; renderNachrichten(); }
function nmSetAudience(a){ _nmAudience=a; renderNachrichten(); }
function nmToggleSel(id){ if(_nmSel.has(id)) _nmSel.delete(id); else _nmSel.add(id); }

function _nmAudienceDetail(){
  if(_nmAudience==='tour'){
    const opts=tours.filter(t=>!t.uebersicht).map(t=>`<option value="${dlEsc(t.id)}"${t.id===_nmTourId?' selected':''}>${dlEsc(t.name||t.id)}</option>`).join('');
    return `<select onchange="_nmSetTour(this.value)" style="margin-top:8px;padding:7px;border:1px solid var(--border);border-radius:6px;font-family:inherit;min-width:240px;"><option value="">– Tour wählen –</option>${opts}</select>`;
  }
  if(_nmAudience==='drivers'){
    if(!_nmDrivers.length) return '<div style="margin-top:8px;font-size:12px;color:var(--text3);">Keine login-fähigen Fahrer in diesem Mandanten.</div>';
    return '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;max-width:520px;">'+_nmDrivers.map(d=>`<label style="display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:20px;padding:4px 10px;font-size:12px;cursor:pointer;"><input type="checkbox" ${_nmSel.has(d.id)?'checked':''} onchange="nmToggleSel('${_jsArg(d.id)}')" style="margin:0;">${dlEsc(d.name)}</label>`).join('')+'</div>';
  }
  if(_nmAudience==='toursOfDay'){
    const due=tours.filter(t=>!t.uebersicht && tourDueOn(t,_todayStr()));
    return `<div style="margin-top:8px;font-size:12px;color:var(--text2);">Heute fällige Touren: ${due.length?due.map(t=>dlEsc(t.name||t.id)).join(', '):'<span style="color:#b45309;">keine</span>'}</div>`;
  }
  return `<div style="margin-top:8px;font-size:12px;color:var(--text3);">${_nmDrivers.length} login-fähige Fahrer im Mandanten.</div>`;
}

function renderNachrichten(){
  const body=document.getElementById('nachrichten-body'); if(!body) return;
  const seg=(val,lbl)=>`<button onclick="nmSetType('${val}')" class="btn ${_nmType===val?'btn-primary':'btn-secondary'}" style="padding:6px 14px;font-size:13px;">${lbl}</button>`;
  const compose=`
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px 18px;max-width:760px;">
      <div style="font-size:14px;font-weight:700;margin-bottom:12px;">Neue Nachricht</div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">${seg('info','Information')}${seg('task','Aufgabe (mit Erledigung)')}</div>
      <input id="nm-title" placeholder="Titel" class="form-control" style="width:100%;padding:9px 11px;margin-bottom:8px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;">
      <textarea id="nm-body" placeholder="Nachrichtentext (optional)" style="width:100%;min-height:80px;padding:9px 11px;margin-bottom:12px;border:1px solid var(--border);border-radius:8px;font-family:inherit;font-size:14px;resize:vertical;"></textarea>
      <div style="font-size:12px;font-weight:600;color:var(--text2);margin-bottom:5px;">Empfänger</div>
      <select onchange="nmSetAudience(this.value)" style="padding:7px;border:1px solid var(--border);border-radius:6px;font-family:inherit;">
        <option value="all"${_nmAudience==='all'?' selected':''}>Alle Fahrer (Mandant)</option>
        <option value="tour"${_nmAudience==='tour'?' selected':''}>Eine Tour</option>
        <option value="toursOfDay"${_nmAudience==='toursOfDay'?' selected':''}>Alle heute fälligen Touren</option>
        <option value="drivers"${_nmAudience==='drivers'?' selected':''}>Einzelne Fahrer</option>
      </select>
      ${_nmAudienceDetail()}
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);margin:12px 0;cursor:pointer;"><input type="checkbox" id="nm-link-tour" style="margin:0;">Mit ${_nmAudience==='tour'?'gewählter Tour':'aktuellem Projekt'} verknüpfen</label>
      <button class="btn btn-primary" onclick="nmSend()" style="padding:9px 18px;font-size:14px;">Senden</button>
    </div>`;
  // Verlauf
  const isAdmin=_nmIsAdmin();
  const msgs=_nmMessages.filter(m=>_nmShowArchived || m.status!=='archived');
  const list = msgs.length ? msgs.map(m=>{
    const isTask=m.type==='task', exp=_nmExpanded===m.id, id=dlEsc(m.id), armed=_nmDelArm===m.id;
    const aud = m.audience?.kind==='tour'?'Tour':m.audience?.kind==='toursOfDay'?'Fällige Touren':m.audience?.kind==='drivers'?'Einzelne':'Alle';
    const total=m.recipientCount||0, cs=(m.counts&&m.counts.seen)||0, cd=(m.counts&&m.counts.done)||0;
    const allSeen=total>0&&cs>=total, allDone=total>0&&cd>=total;
    const statusPills = (isTask
      ? _nmPill(cs+'/'+total+' gesehen', allSeen?'#dbeafe':'#f3f4f6', allSeen?'#1e40af':'#6b7280')+_nmPill(cd+'/'+total+' erledigt', allDone?'#dcfce7':'#f3f4f6', allDone?'#166534':'#6b7280')
      : _nmPill(cs+'/'+total+' gesehen', allSeen?'#dbeafe':'#f3f4f6', allSeen?'#1e40af':'#6b7280'));
    const actions = isAdmin ? `<div style="border-top:1px solid var(--border);padding:7px 12px;display:flex;gap:8px;align-items:center;justify-content:flex-end;flex-wrap:wrap;">`
      + (armed
          ? `<span style="font-size:12px;color:#991b1b;margin-right:auto;">Endgültig löschen? Zum Bestätigen „LÖSCHEN" eintippen.</span>
             <input id="nm-del-${id}" placeholder="LÖSCHEN" style="padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;width:110px;">
             <button onclick="nmDeleteDo('${id}')" style="padding:5px 11px;font-size:12px;background:#991b1b;color:#fff;border:none;border-radius:6px;cursor:pointer;">Löschen</button>
             <button onclick="nmDelCancel()" class="btn btn-secondary" style="padding:5px 10px;font-size:12px;">Abbrechen</button>`
          : `${m.status==='archived'
                ? `<button onclick="nmUnarchive('${id}')" class="btn btn-secondary" style="padding:5px 10px;font-size:12px;">Aus Archiv holen</button>`
                : `<button onclick="nmArchive('${id}')" class="btn btn-secondary" style="padding:5px 10px;font-size:12px;">Archivieren</button>`}
             <button onclick="nmDelArm('${id}')" class="btn btn-secondary" style="padding:5px 10px;font-size:12px;color:#991b1b;">Löschen…</button>`)
      + `</div>` : '';
    return `<div style="border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--surface);${m.status==='archived'?'opacity:.65;':''}">
      <div onclick="nmToggle('${id}')" style="padding:11px 14px;cursor:pointer;display:flex;align-items:center;gap:10px;">
        <span style="font-size:11px;font-weight:600;color:${isTask?'#16a34a':'var(--text3)'};border:1px solid var(--border);border-radius:20px;padding:2px 8px;">${isTask?'Aufgabe':'Info'}</span>
        <div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:14px;">${dlEsc(m.title||'(ohne Titel)')}</div><div style="font-size:11px;color:var(--text3);">${_nmTime(m.sentAt||m.createdAt)} · ${aud} · ${total} Empfänger${m.status==='archived'?' · archiviert':''}</div></div>
        <div style="display:flex;gap:4px;flex-shrink:0;">${statusPills}</div>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="transform:rotate(${exp?180:0}deg);"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      ${exp?`<div id="nm-agg-${id}" style="border-top:1px solid var(--border);padding:10px 14px;">Lade Status…</div>`:''}
      ${actions}
    </div>`;
  }).join('') : '<div style="color:var(--text3);font-size:13px;">Noch keine Nachrichten.</div>';
  const archToggle = `<label style="font-size:12px;color:var(--text2);display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin-left:auto;"><input type="checkbox" ${_nmShowArchived?'checked':''} onchange="nmToggleArchived()" style="margin:0;">Archiv anzeigen</label>`;
  const pushRow = currentRole==='superadmin'
    ? `<div style="margin-bottom:14px;padding:9px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;display:flex;align-items:center;gap:8px;max-width:760px;"><label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer;"><input type="checkbox" ${_nmPushEnabled?'checked':''} onchange="setPushEnabled(this.checked)" style="margin:0;cursor:pointer;">Geräte-Push (FCM) für diesen Mandanten aktiv</label><span style="font-size:11px;color:var(--text3);margin-left:auto;">nur Superadmin</span></div>`
    : '';
  body.innerHTML = pushRow + `<div style="display:flex;gap:24px;flex-wrap:wrap;align-items:flex-start;">
    <div style="flex:1;min-width:340px;">${compose}</div>
    <div style="flex:1;min-width:340px;"><div style="display:flex;align-items:center;margin-bottom:10px;"><span style="font-size:14px;font-weight:700;">Verlauf</span>${archToggle}</div>${list}</div>
  </div>`;
}
function _nmSetTour(id){ _nmTourId=id; }
function nmToggle(msgId){ if(_nmExpanded===msgId){ _nmExpanded=null; renderNachrichten(); return; } _nmExpanded=msgId; renderNachrichten(); _nmLoadAgg(msgId); }
async function _nmLoadAgg(msgId){
  const el=document.getElementById('nm-agg-'+msgId); if(!el) return;
  const m=_nmMessages.find(x=>x.id===msgId);
  try{
    // orgId-Filter, damit die Regel (canPlan(orgId)) gegen die Query garantierbar ist (Rules sind keine Filter)
    const qs=await db.collection('messages').doc(msgId).collection('recipients').where('orgId','==', m&&m.orgId).get();
    const r=qs.docs.map(d=>d.data());
    const isTask=m&&m.type==='task';
    const seen=r.filter(x=>x.seenAt).length, done=r.filter(x=>x.doneAt).length;
    const rows=r.sort((a,b)=>(a.driverName||'').localeCompare(b.driverName||'')).map(x=>`<tr style="border-top:1px solid var(--border);">
      <td style="padding:5px 8px;">${dlEsc(x.driverName||x.driverId)}</td>
      <td style="padding:5px 8px;">${_nmStatusPill(x,isTask)}</td>
      <td style="padding:5px 8px;color:var(--text3);">${_nmTime(x.deliveredAt)}</td>
      <td style="padding:5px 8px;color:${x.seenAt?'#166534':'var(--text3)'};">${_nmTime(x.seenAt)}</td>
      ${isTask?`<td style="padding:5px 8px;color:${x.doneAt?'#166534':'var(--text3)'};">${_nmTime(x.doneAt)}</td>`:''}
    </tr>`).join('');
    el.innerHTML=`<div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">${_nmPill(r.length+' erhalten','#f3f4f6','#374151')}${_nmPill(seen+' gesehen','#dbeafe','#1e40af')}${isTask?_nmPill(done+' erledigt','#dcfce7','#166534'):''}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="color:var(--text3);text-align:left;"><th style="padding:4px 8px;">Fahrer</th><th style="padding:4px 8px;">Status</th><th style="padding:4px 8px;">Zugestellt</th><th style="padding:4px 8px;">Gesehen</th>${isTask?'<th style="padding:4px 8px;">Erledigt</th>':''}</tr></thead><tbody>${rows||'<tr><td style="padding:6px 8px;color:var(--text3);">Keine Empfänger</td></tr>'}</tbody></table>`;
  }catch(e){ console.error('nmLoadAgg', e); el.innerHTML='<span style="color:#b45309;font-size:12px;">Status nicht ladbar ('+(e&&e.code||e&&e.message||'Fehler')+')</span>'; }
}

function _nmResolveRecipients(){
  const byName=new Map(); _nmDrivers.forEach(d=>{ if(!byName.has(d.nameLower)) byName.set(d.nameLower,d); });
  const ids=new Set();
  if(_nmAudience==='all') _nmDrivers.forEach(d=>ids.add(d.id));
  else if(_nmAudience==='drivers') _nmSel.forEach(id=>{ if(_nmDrivers.find(d=>d.id===id)) ids.add(id); });
  else if(_nmAudience==='tour'){ const t=tours.find(x=>x.id===_nmTourId); (t&&t.drivers||[]).forEach(n=>{ const d=byName.get(String(n).toLowerCase()); if(d) ids.add(d.id); }); }
  else if(_nmAudience==='toursOfDay'){ tours.filter(t=>!t.uebersicht && tourDueOn(t,_todayStr())).forEach(t=>(t.drivers||[]).forEach(n=>{ const d=byName.get(String(n).toLowerCase()); if(d) ids.add(d.id); })); }
  return [...ids].map(id=>_nmDrivers.find(d=>d.id===id)).filter(Boolean);
}

async function nmSend(){
  const org=currentProjectData?.orgId||currentOrg; if(!org){ notify('Kein Mandant/Projekt offen'); return; }
  const title=(document.getElementById('nm-title')?.value||'').trim();
  const text=(document.getElementById('nm-body')?.value||'').trim();
  if(!title){ notify('Bitte einen Titel eingeben'); return; }
  if(_nmAudience==='tour' && !_nmTourId){ notify('Bitte eine Tour wählen'); return; }
  const recips=_nmResolveRecipients();
  if(!recips.length){ notify('Keine login-fähigen Empfänger für diese Auswahl'); return; }
  const now=new Date().toISOString();
  const uid=(firebase.auth().currentUser&&firebase.auth().currentUser.uid)||null;
  const linkOn=document.getElementById('nm-link-tour')?.checked;
  const link = linkOn ? (_nmAudience==='tour'?{projectId:currentProjectId,tourId:_nmTourId}:{projectId:currentProjectId}) : {};
  const msgRef=db.collection('messages').doc();
  const msgData={ orgId:org, type:_nmType, title, body:text, createdBy:uid, createdByName:currentName||'', createdAt:now, sentAt:now,
    audience:{kind:_nmAudience, tourId:_nmAudience==='tour'?_nmTourId:null}, link, status:'sent', recipientCount:recips.length, counts:{seen:0,done:0} };
  try{
    let batch=db.batch(); batch.set(msgRef,msgData); let n=1;
    for(const d of recips){
      batch.set(msgRef.collection('recipients').doc(d.id), { orgId:org, msgId:msgRef.id, driverId:d.id, ownerUid:'drv_'+d.id, driverName:d.name, type:_nmType, title, body:text, link, sentAt:now, deliveredAt:null, seenAt:null, doneAt:null });
      if(++n>=450){ await batch.commit(); batch=db.batch(); n=0; }
    }
    if(n>0) await batch.commit();
    notify('✓ Nachricht an '+recips.length+' Fahrer gesendet');
    const t=document.getElementById('nm-title'); if(t) t.value=''; const b=document.getElementById('nm-body'); if(b) b.value='';
  }catch(e){ console.error('nmSend', e); notify(dlErr(e)); }
}
async function nmArchive(msgId){
  if(!_nmIsAdmin()){ notify('Nur Administratoren'); return; }
  try{ await db.collection('messages').doc(msgId).update({status:'archived'}); }catch(e){ notify(dlErr(e)); }
}
async function nmUnarchive(msgId){
  if(!_nmIsAdmin()){ notify('Nur Administratoren'); return; }
  try{ await db.collection('messages').doc(msgId).update({status:'sent'}); }catch(e){ notify(dlErr(e)); }
}
function nmToggleArchived(){ _nmShowArchived=!_nmShowArchived; renderNachrichten(); }
async function setPushEnabled(on){
  if(currentRole!=='superadmin'){ notify('Nur Superadmin'); return; }
  const org=currentProjectData?.orgId||currentOrg; if(!org){ notify('Kein Mandant'); return; }
  try{ await db.collection('orgs').doc(org).set({pushEnabled:!!on},{merge:true}); _nmPushEnabled=!!on; notify(on?'✓ Geräte-Push aktiviert':'Geräte-Push deaktiviert'); }
  catch(e){ notify(dlErr(e)); }
}
function nmDelArm(msgId){ _nmDelArm=msgId; renderNachrichten(); }
function nmDelCancel(){ _nmDelArm=null; renderNachrichten(); }
// Endgültig löschen — bewusst erschwert: Admin + getipptes „LÖSCHEN". Entfernt Nachricht + alle Empfänger-Quittungen.
async function nmDeleteDo(msgId){
  if(!_nmIsAdmin()){ notify('Nur Administratoren'); return; }
  const v=(document.getElementById('nm-del-'+msgId)?.value||'').trim();
  if(v!=='LÖSCHEN'){ notify('Bitte „LÖSCHEN" eintippen'); return; }
  const m=_nmMessages.find(x=>x.id===msgId);
  try{
    const qs=await db.collection('messages').doc(msgId).collection('recipients').where('orgId','==', m&&m.orgId).get();
    const refs=qs.docs.map(d=>d.ref); refs.push(db.collection('messages').doc(msgId));
    for(let i=0;i<refs.length;i+=400){ const b=db.batch(); refs.slice(i,i+400).forEach(r=>b.delete(r)); await b.commit(); }
    _nmDelArm=null; notify('Nachricht gelöscht');
  }catch(e){ console.error('nmDeleteDo', e); notify(dlErr(e)); }
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
// ── Objekt-Tabelle: Spalten ein-/ausblenden (pro Browser gemerkt) ──────────
let _baeumeHiddenCols = new Set();
try{
  const raw=localStorage.getItem('bwt_baeume_hidden_cols');
  if(raw!=null) _baeumeHiddenCols=new Set(JSON.parse(raw));
  else _baeumeHiddenCols=new Set(['notiz','menge']); // neue Spalten anfangs aus, damit die Ansicht wie bisher wirkt
}catch(_){ _baeumeHiddenCols=new Set(['notiz','menge']); }
function _saveBaeumeHiddenCols(){ try{ localStorage.setItem('bwt_baeume_hidden_cols', JSON.stringify([..._baeumeHiddenCols])); }catch(_){} }
// Alle ein-/ausblendbaren Spalten (Reihenfolge = Tabelle); Custom-Felder dynamisch dazwischen.
function _baeumeColDefs(){
  return [
    {key:'rn',label:'#'},
    {key:'baumId',label:'Objekt-ID'},
    {key:'name',label:FL.name},
    {key:'stadtteil',label:FL.stadtteil},
    {key:'baumnr',label:FL.baumnr},
    {key:'art',label:FL.art},
    {key:'pflanzjahr',label:FL.pflanzjahr},
    {key:'pflanzzeitpunkt',label:FL.pflanzzeitpunkt},
    ...customFields.map(c=>({key:'cf:'+c.key,label:c.label})),
    {key:'zustand',label:FL.zustand},
    {key:'tour',label:'Tour'},
    {key:'wasser',label:FL.wasser},
    {key:'datum',label:FL.datum},
    {key:'notiz',label:FL.notiz},
    {key:'menge',label:'Menge (m²/m)'},
    {key:'gps',label:'GPS'},
  ];
}
function _baeumeColStyleText(){
  return [..._baeumeHiddenCols].map(k=>`#baeume-table-wrap [data-col="${String(k).replace(/["\\]/g,'')}"]{display:none}`).join('');
}
function _applyBaeumeColVis(){
  const st=document.getElementById('baeume-col-style'); if(st) st.textContent=_baeumeColStyleText();
  const b=document.getElementById('baeume-col-badge'); if(b) b.textContent=_baeumeHiddenCols.size?` (${_baeumeHiddenCols.size} aus)`:'';
}
function toggleBaeumeCol(key,on){ if(on) _baeumeHiddenCols.delete(key); else _baeumeHiddenCols.add(key); _saveBaeumeHiddenCols(); _applyBaeumeColVis(); }
function resetBaeumeCols(){ _baeumeHiddenCols.clear(); _saveBaeumeHiddenCols(); _applyBaeumeColVis(); const m=document.getElementById('baeume-col-menu'); if(m) m.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true); }
function openBaeumeColMenu(btn){
  const ex=document.getElementById('baeume-col-menu'); if(ex){ ex.remove(); return; }
  const r=btn.getBoundingClientRect();
  const m=document.createElement('div'); m.id='baeume-col-menu';
  m.style.cssText=`position:fixed;top:${Math.round(r.bottom+4)}px;left:${Math.round(Math.max(8,r.right-250))}px;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px;width:250px;max-height:72vh;overflow:auto;`;
  m.innerHTML=`<div style="font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);padding:4px 6px 8px;">Spalten ein-/ausblenden</div>`+
    _baeumeColDefs().map(d=>`<label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:13px;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
        <input type="checkbox" ${_baeumeHiddenCols.has(d.key)?'':'checked'} onchange="toggleBaeumeCol('${d.key}',this.checked)" style="width:15px;height:15px;cursor:pointer;">
        <span>${dlEsc(d.label||'—')}</span></label>`).join('')+
    `<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;"><button class="btn btn-secondary" style="width:100%;padding:5px;font-size:11px;" onclick="resetBaeumeCols()">Alle einblenden</button></div>`;
  document.body.appendChild(m);
  setTimeout(()=>{ const close=ev=>{ if(!m.contains(ev.target)&&ev.target!==btn){ m.remove(); document.removeEventListener('mousedown',close); } }; document.addEventListener('mousedown',close); },0);
}

let _baeumeShowAll = false; // alle Objekte trotz Übersichts-Schwelle anzeigen
function toggleShowAll(){
  _baeumeShowAll = !_baeumeShowAll;
  const btn=document.getElementById('btn-show-all');
  if(btn){ btn.style.background=_baeumeShowAll?'var(--green)':''; btn.style.color=_baeumeShowAll?'#fff':''; btn.style.borderColor=_baeumeShowAll?'var(--green)':''; }
  filterBaeumeTable(document.getElementById('baeume-search')?.value||'');
}
// Alle Filter der Objekt-Tabelle zurücksetzen (✕-Button)
function clearBaeumeFilters(){
  const s=document.getElementById('baeume-search'); if(s) s.value='';
  _baeumeNoGpsFilter=false; _baeumeShowAll=false;
  updateBtnFilterNoGps();
  const b=document.getElementById('btn-show-all'); if(b){ b.style.background=''; b.style.color=''; b.style.borderColor=''; }
  filterBaeumeTable('');
}

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
  let filtered = _baeumeAllTrees.filter(tree=>
    matchTerms([tree.name,tree.art,tree.stadtteil,tree.baumnr,tree.baumId,tree.pflanzjahr,tree.pflanzzeitpunkt,(tree.containerExtId&&_containerOf(tree)?.name)||''].join(' '), q)
  );
  if(_baeumeNoGpsFilter) filtered = filtered.filter(t => !t.lat || !t.lng);
  if(!_baeumeShowInactive) filtered = filtered.filter(isActive);
  const hasFilter = q.trim() || _baeumeNoGpsFilter;
  if(countEl) countEl.textContent = hasFilter ? `${filtered.length} Ergebnisse` : '';
  renderBaeumeTableWith(filtered);
}

// Objekt-Basis der Tabelle: Arbeitsmenge (ggf. Pilot-gefiltert) PLUS alle Inaktiven aus dem
// Gesamtbestand — sonst wären Archiv-Objekte außerhalb des Pilot-Ausschnitts über
// „Inaktive zeigen" unsichtbar, obwohl „Archiv bereinigen" sie zählt.
function _baeumeBase(){
  const base=trees.filter(t=>!_isContainer(t));
  const have=new Set(base.map(t=>t.id));
  (_allTrees||[]).forEach(t=>{ if(!isActive(t)&&!_isContainer(t)&&!have.has(t.id)) base.push(t); });
  return base;
}
function renderBaeumeTable(){
  const base=_baeumeBase();
  _baeumeAllTrees = [...base]; // cache all (Objekt-)trees
  document.getElementById('baeume-search-count').textContent = '';
  renderBaeumeTableWith(_baeumeShowInactive ? base : base.filter(isActive));
}

// ─── SAMMELAKTION (nur Superadmin): wirkt auf die aktuell gefilterte/angezeigte Menge ───
let _baeumeFiltered=[]; // exakt die zuletzt gerenderte Objektliste = Operier-Menge
function updateBulkBar(){
  const bar=document.getElementById('baeume-bulk'); if(!bar) return;
  if(currentRole!=='superadmin'){ bar.style.display='none'; return; }
  bar.style.display='flex';
  const n=_baeumeFiltered.length, act=_baeumeFiltered.filter(isActive).length;
  const bi=document.getElementById('bulk-inactive'), bd=document.getElementById('bulk-delete');
  if(bi){ bi.textContent=act+' inaktiv'; bi.disabled=!act; bi.style.opacity=act?'':'.4'; bi.style.cursor=act?'pointer':'not-allowed'; }
  if(bd){ bd.textContent=n+' löschen'; bd.disabled=!n; bd.style.opacity=n?'':'.4'; bd.style.cursor=n?'pointer':'not-allowed'; }
  // Archiv-Bereinigung zählt über den GESAMTEN Projektbestand (nicht Pilot-/Ansichts-gefiltert)
  const ba=document.getElementById('bulk-archiv');
  if(ba){ const ina=(_allTrees.length?_allTrees:trees).filter(t=>!isActive(t)).length; ba.textContent=`Archiv bereinigen (${ina})`; ba.disabled=!ina; ba.style.opacity=ina?'':'.4'; ba.style.cursor=ina?'pointer':'not-allowed'; }
}
// ─── ARCHIV BEREINIGEN (nur Superadmin): ALLE inaktiven Objekte des Projekts endgültig löschen ───
// Für Alt-/Testdaten aus früheren Importen. Abgeschlossene Tour-Protokolle (tourHistory) tragen
// eigene Kopien der Meldedaten und bleiben unberührt — verloren geht nur der objektbezogene Verlauf.
async function archivBereinigen(){
  if(currentRole!=='superadmin'||!currentProjectId) return;
  const alle=(_allTrees.length?_allTrees:trees).filter(t=>!isActive(t));
  if(!alle.length){ notify('Keine inaktiven Objekte im Projekt'); return; }
  const ans=prompt(`Archiv bereinigen — ENDGÜLTIGES Löschen:\n\n`+
    `• ${alle.length} inaktive (archivierte) Objekte werden unwiderruflich entfernt — inklusive ihres Verlaufs.\n`+
    `• Abgeschlossene Tour-Protokolle (Controlling) bleiben erhalten.\n\n`+
    `Nicht umkehrbar. Zum Bestätigen die Zahl ${alle.length} eingeben:`, '');
  if(ans===null) return;
  if((ans||'').trim()!==String(alle.length)){ notify('Abgebrochen — Bestätigungszahl stimmt nicht'); return; }
  const ids=alle.map(t=>t.id);
  setSyncState('syncing','Bereinigt…'); _suppressTreeRender=true;
  try{
    for(let i=0;i<ids.length;i+=400){
      const chunk=ids.slice(i,i+400), batch=db.batch();
      chunk.forEach(id=>batch.delete(doc(db,'projects',currentProjectId,'trees',id)));
      await batch.commit(); _bumpUsage('deletes',chunk.length);
      setSyncState('syncing',`Bereinigt… ${Math.min(i+400,ids.length)}/${ids.length}`);
    }
    await stripIdsFromRoutes(ids);
    await _stripIdsFromPlanArtifacts(ids); // Auto-Planungs-Varianten + Fixierungen von gelöschten Objekten säubern
    notify(`✓ Archiv bereinigt — ${ids.length} inaktive Objekte endgültig gelöscht`);
  }catch(e){ console.warn('archivBereinigen',e); setSyncState('error','Fehler'); notify('⚠ Fehlgeschlagen: '+(e.message||e)); }
  finally{ _bulkRefresh(); }
}
// Entfernt mehrere Objekt-IDs in EINEM Durchlauf aus allen Routen (statt pro Objekt)
async function stripIdsFromRoutes(ids){
  const set=new Set(ids);
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'routes'));
    for(const d of snap.docs){
      const data=d.data()||{};
      if(Array.isArray(data.orderIds)&&data.orderIds.some(x=>set.has(x)))
        await updateDoc(doc(db,'projects',currentProjectId,'routes',d.id),{orderIds:data.orderIds.filter(x=>!set.has(x))});
    }
  }catch(e){ console.warn('stripIdsFromRoutes',e); }
  routeCache={}; _routesCache={}; _routesLoadedFor=null;
}
function _bulkRefresh(){
  _suppressTreeRender=false; _pendingTreeRender=false;
  _baeumeAllTrees=_baeumeBase();
  refreshMarkers(); renderList();
  filterBaeumeTable(document.getElementById('baeume-search')?.value||'');
  setSyncState('ok','Synchronisiert');
}
async function bulkSetInactive(){
  if(currentRole!=='superadmin') return;
  const ids=_baeumeFiltered.filter(isActive).map(t=>t.id);
  if(!ids.length){ notify('Keine aktiven Objekte in der Auswahl'); return; }
  if(!confirm(`${ids.length} Objekt(e) aus der aktuellen Ansicht INAKTIV setzen?\n\n`+
    `• Werden aus Karte, Tourplanung und „offen"-Zahlen ausgeblendet\n`+
    `• Aus allen Touren entfernt\n`+
    `• Historie bleibt erhalten, jederzeit reaktivierbar`)) return;
  setSyncState('syncing','Speichert…'); _suppressTreeRender=true;
  try{
    for(let i=0;i<ids.length;i+=400){
      const chunk=ids.slice(i,i+400), batch=db.batch();
      chunk.forEach(id=>batch.update(doc(db,'projects',currentProjectId,'trees',id),{aktiv:false,archiviertAm:serverTimestamp(),tourIds:[],tourId:''}));
      await batch.commit(); _bumpUsage('writes',chunk.length);
      setSyncState('syncing',`Speichert… ${Math.min(i+400,ids.length)}/${ids.length}`);
    }
    await stripIdsFromRoutes(ids);
    notify(`✓ ${ids.length} Objekte inaktiv gesetzt`);
  }catch(e){ console.warn('bulkSetInactive',e); setSyncState('error','Fehler'); notify('⚠ Fehlgeschlagen: '+(e.message||e)); }
  finally{ _bulkRefresh(); }
}
async function bulkDelete(){
  if(currentRole!=='superadmin') return;
  const targets=[..._baeumeFiltered];
  if(!targets.length){ notify('Keine Objekte in der Auswahl'); return; }
  // Historie einmal prüfen: in-memory (history[]/lastStatus) + tourHistory-Referenzen
  setSyncState('syncing','Prüfe Historie…');
  let histRefs=new Set();
  try{
    const snap=await getDocs(collection(db,'projects',currentProjectId,'tourHistory'));
    snap.docs.forEach(d=>(d.data().trees||[]).forEach(x=>{ if(x&&x.id) histRefs.add(x.id); }));
  }catch(e){ console.warn('bulkDelete tourHistory',e); setSyncState('ok',''); notify('⚠ Historie-Prüfung fehlgeschlagen — abgebrochen'); return; }
  setSyncState('ok','');
  const hasHist=t=>(t.history||[]).length>0 || (t.lastStatus&&t.lastStatus!=='offen') || histRefs.has(t.id);
  const toDelete=targets.filter(t=>!hasHist(t)).map(t=>t.id);
  const toArchive=targets.filter(t=>hasHist(t)&&isActive(t)).map(t=>t.id);
  const protectedInactive=targets.filter(t=>hasHist(t)&&!isActive(t)).length;
  const ans=prompt(`Sammel-Löschen (${targets.length} Objekte in der Ansicht):\n\n`+
    `• ${toDelete.length} werden ENDGÜLTIG gelöscht\n`+
    `• ${toArchive.length} mit Historie werden stattdessen INAKTIV gesetzt (Schutz)\n`+
    (protectedInactive?`• ${protectedInactive} mit Historie sind bereits inaktiv (unverändert)\n`:'')+
    `\nNicht umkehrbar. Zum Bestätigen die Zahl ${toDelete.length} eingeben:`, '');
  if(ans===null) return;
  if((ans||'').trim()!==String(toDelete.length)){ notify('Abgebrochen — Bestätigungszahl stimmt nicht'); return; }
  setSyncState('syncing','Löscht…'); _suppressTreeRender=true;
  try{
    for(let i=0;i<toDelete.length;i+=400){
      const chunk=toDelete.slice(i,i+400), batch=db.batch();
      chunk.forEach(id=>batch.delete(doc(db,'projects',currentProjectId,'trees',id)));
      await batch.commit(); _bumpUsage('writes',chunk.length);
      setSyncState('syncing',`Löscht… ${Math.min(i+400,toDelete.length)}/${toDelete.length}`);
    }
    for(let i=0;i<toArchive.length;i+=400){
      const chunk=toArchive.slice(i,i+400), batch=db.batch();
      chunk.forEach(id=>batch.update(doc(db,'projects',currentProjectId,'trees',id),{aktiv:false,archiviertAm:serverTimestamp(),tourIds:[],tourId:''}));
      await batch.commit(); _bumpUsage('writes',chunk.length);
    }
    await stripIdsFromRoutes([...toDelete,...toArchive]);
    await _stripIdsFromPlanArtifacts(toDelete); // nur die endgültig Gelöschten aus Varianten/Fixierungen entfernen
    notify(`✓ ${toDelete.length} gelöscht, ${toArchive.length} wegen Historie archiviert`);
  }catch(e){ console.warn('bulkDelete',e); setSyncState('error','Fehler'); notify('⚠ Fehlgeschlagen: '+(e.message||e)); }
  finally{ _bulkRefresh(); }
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
  const m={}; trees.forEach(t=>{ if(_isContainer(t)) return; if(t.artId) m[t.artId]=(m[t.artId]||0)+1; }); return m; // Container sind keine Objekte → nicht mitzählen
}
function switchBaeumeTab(tab){
  const o=document.getElementById('baeume-objekte'), a=document.getElementById('baeume-arten'), ab=document.getElementById('baeume-abschnitte');
  const to=document.getElementById('tab-objekte'), ta=document.getElementById('tab-arten'), ts=document.getElementById('tab-abschnitte');
  if(ts) ts.style.display=trees.some(_isContainer)?'':'none';   // Reiter nur bei Abschnitts-Projekten
  if(o) o.style.display=tab==='objekte'?'flex':'none';
  if(ab) ab.style.display=tab==='abschnitte'?'flex':'none';
  if(a) a.style.display=tab==='arten'?'block':'none';
  [to,ta,ts].forEach(b=>{ if(!b) return; b.style.borderBottomColor='transparent'; b.style.color='var(--text3)'; b.style.fontWeight='600'; });
  const act=tab==='arten'?ta:tab==='abschnitte'?ts:to; if(act){ act.style.borderBottomColor='var(--green)'; act.style.color='var(--green)'; act.style.fontWeight='700'; }
  if(tab==='arten') renderFieldCatalogView();
  else if(tab==='abschnitte') renderAbschnitteTable();
  else renderBaeumeTable();
}

// ─── ABSCHNITTE-TABELLE (Verwaltung): Übersicht der Straßenabschnitte ──────────
let _abschnAllTrees=[], _abschnShowAll=false, _abschnSearchT=null;
function renderAbschnitteTable(){
  _abschnAllTrees = trees.filter(_isContainer);
  filterAbschnitteTable(document.getElementById('abschnitte-search')?.value||'');
}
function filterAbschnitteTableDebounced(q){ clearTimeout(_abschnSearchT); _abschnSearchT=setTimeout(()=>filterAbschnitteTable(q),180); }
function filterAbschnitteTable(q){
  const ql=(q||'').trim();
  let list=_abschnAllTrees;
  if(ql) list=list.filter(c=>matchTerms([c.name,c.extId,c.baumId,c.stadtteil].join(' '), ql));
  const sc=document.getElementById('abschnitte-search-count'); if(sc) sc.textContent=ql?`${list.length} Ergebnisse`:'';
  renderAbschnitteTableWith(list, !!ql);
}
function toggleAbschnShowAll(){
  _abschnShowAll=!_abschnShowAll;
  const b=document.getElementById('btn-abschn-show-all'); if(b){ b.style.background=_abschnShowAll?'var(--green)':''; b.style.color=_abschnShowAll?'#fff':''; b.style.borderColor=_abschnShowAll?'var(--green)':''; }
  filterAbschnitteTable(document.getElementById('abschnitte-search')?.value||'');
}
function renderAbschnitteTableWith(list, hasFilter){
  const wrap=document.getElementById('abschnitte-table-wrap'); if(!wrap) return;
  if(!_abschnAllTrees.length){
    wrap.innerHTML=`<div class="empty-state" style="margin-top:50px;text-align:center;"><p style="font-weight:600;margin-bottom:4px;">Keine Straßenabschnitte</p><p style="font-size:12px;color:var(--text3);">Dieses Projekt enthält keine Abschnitte.</p></div>`;
    return;
  }
  if(!hasFilter && !_abschnShowAll && list.length>600){
    wrap.innerHTML=`<div class="empty-state" style="margin-top:40px;text-align:center;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <p style="font-weight:600;margin:8px 0 2px;">${list.length.toLocaleString('de-DE')} Abschnitte</p>
      <p style="font-size:12px;color:var(--text3);line-height:1.55;max-width:380px;margin:0 auto;">Für die Übersicht nicht alle aufgelistet. Oben <b>suchen</b> (Straße, Abschnitts-ID, Stadtteil …) — dann erscheinen die Treffer.</p>
      <button class="btn btn-primary" style="margin-top:14px;padding:7px 16px;font-size:12px;" onclick="toggleAbschnShowAll()">Alle ${list.length.toLocaleString('de-DE')} Abschnitte anzeigen</button></div>`;
    return;
  }
  const tourMap=new Map(tours.map(t=>[t.id,t]));
  const sorted=[...list].sort((a,b)=>(a.name||'').localeCompare(b.name||'','de'));
  const th=lbl=>`<th style="position:sticky;top:0;background:var(--surface2);padding:9px 12px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${lbl}</th>`;
  let rows='';
  sorted.forEach(c=>{
    const sides=_ausstattungOf(c.extId);
    const eh={m2:'m²',m:'m',Stk:'Stk'}[c.einheit]||c.einheit||'';
    const menge=parseFloat(c.menge); const len=menge?menge.toLocaleString('de-DE')+(eh?' '+eh:''):'<span style="color:var(--text3)">–</span>';
    const rk=c.reinigungsklasse?_rkById(c.reinigungsklasse):null;
    const tids=new Set(); sides.forEach(s=>getTreeTourIds(s).forEach(id=>{ if(!isOverviewTour(id)) tids.add(id); }));
    const tNames=[...tids].map(id=>tourMap.get(id)).filter(Boolean);
    rows+=`<tr style="border-top:1px solid var(--border);transition:background .1s;cursor:pointer;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''" data-abschnid="${c.id}">
      <td style="padding:8px 12px;font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${dlEsc(c.extId||c.baumId||'–')}</td>
      <td style="padding:8px 12px;font-weight:500;">${dlEsc(c.name||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);">${dlEsc(c.stadtteil||'–')}</td>
      <td style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${len}</td>
      <td style="padding:8px 12px;">${rk?`<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:2px;background:${rk.color||'#bbb'};flex-shrink:0;"></span>${dlEsc(rk.name)}</span>`:'<span style="color:var(--text3)">–</span>'}</td>
      <td style="padding:8px 12px;text-align:right;color:var(--text2);">${sides.length}</td>
      <td style="padding:8px 12px;white-space:nowrap;">${tNames.length?tNames.map(t=>`<span style="display:inline-block;font-size:11px;font-weight:600;color:${t.color||'var(--text2)'};">${dlEsc(t.name)}</span>`).join(' · '):'<span style="color:var(--text3);font-size:12px;">–</span>'}</td>
      <td style="padding:8px 12px;"><button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;" data-editabschn="${c.id}">Bearbeiten</button></td>
    </tr>`;
  });
  wrap.innerHTML=`<div style="padding:10px 16px;display:flex;align-items:center;gap:14px;flex-shrink:0;border-bottom:1px solid var(--border);background:var(--surface);">
      <span style="font-size:13px;font-weight:600;">${sorted.length.toLocaleString('de-DE')} Abschnitte</span>
      <span style="font-size:12px;color:var(--text3);">Klick auf Zeile → Detail mit zugehörigen Objekten</span>
    </div>
    <div style="overflow:auto;flex:1;"><table style="width:100%;border-collapse:collapse;font-size:13px;background:var(--surface);">
      <thead><tr>${th('Abschnitts-ID')}${th('Straße')}${th('Stadtteil')}${th('Länge')}${th('Reinigungsklasse')}<th style="position:sticky;top:0;background:var(--surface2);padding:9px 12px;text-align:right;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Objekte</th>${th('Touren')}${th('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  wrap.onclick=e=>{
    const editBtn=e.target.closest('[data-editabschn]');
    if(editBtn){ e.stopPropagation(); openEditTree(editBtn.dataset.editabschn); return; }
    const row=e.target.closest('[data-abschnid]');
    if(row){ const id=row.dataset.abschnid; switchView('karte'); setTimeout(()=>openAbschnitt(id),160); }
  };
}
// Abschnitte als Excel exportieren — inkl. ursprünglicher Abschnitts-ID für Re-Import/Abgleich
function downloadAbschnitteExport(){
  const XLSX=window.XLSX; if(!XLSX){ notify('SheetJS nicht geladen'); return; }
  const list=trees.filter(_isContainer);
  if(!list.length){ notify('Keine Abschnitte vorhanden'); return; }
  const headers=['Abschnitts-ID','Straße','Stadtteil','Länge','Einheit','Reinigungsklasse','Objekte','Objekt-ID'];
  const aoa=[headers];
  list.forEach(c=>{
    const rk=c.reinigungsklasse?_rkById(c.reinigungsklasse):null;
    aoa.push([c.extId||'', c.name||'', c.stadtteil||'', (parseFloat(c.menge)||''), c.einheit||'', rk?rk.name:'', _ausstattungOf(c.extId).length, c.baumId||'']);
  });
  const ws=XLSX.utils.aoa_to_sheet(aoa);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Abschnitte');
  XLSX.writeFile(wb, ((currentProjectData&&currentProjectData.name||'Projekt').replace(/[^\wäöüÄÖÜß-]+/g,'_'))+'_Abschnitte.xlsx');
  notify(`✓ ${list.length} Abschnitte exportiert`);
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
  const unmapped=trees.filter(t=>!_isContainer(t)&&(t.art||'').trim() && !(t.artId&&validIds.has(t.artId))).length;
  const ro=isReadonly();
  const showKl=objektklassen.length>0; // Klassen-Spalte nur zeigen, wenn Objektklassen definiert sind
  // Container-Arten (z. B. „Straßenabschnitt") sind keine Tätigkeits-Arten → aus der Liste ausblenden
  const _contArtIds=new Set(trees.filter(_isContainer).map(t=>t.artId).filter(Boolean));
  const objCount=trees.filter(t=>!_isContainer(t)).length;
  const sorted=[...artenList].filter(a=>!(_contArtIds.has(a.id)&&!byId[a.id])).sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const rows=sorted.map(a=>{
    const c=byId[a.id]||0;
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:4px 8px 4px 12px;width:46px;">
        <button type="button" ${ro?'disabled':`onclick="artSetIcon('${_jsArg(a.id)}')"`} title="${a.icon?'Eigenes Symbol — ändern':'Projekt-Standard — eigenes Symbol setzen'}" style="width:32px;height:32px;font-size:16px;padding:0;border:1.5px solid ${a.icon?'var(--green-mid)':'var(--border)'};border-radius:8px;background:${a.icon?'var(--green-light)':'var(--bg)'};cursor:${ro?'default':'pointer'};${a.icon?'':'opacity:.55;'}">${a.icon||projIcon()}</button>
      </td>
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(a.name)}</td>
      ${showKl?`<td style="padding:7px 12px;">${ro?dlEsc(objektklassen.find(k=>k.id===a.klasse)?.name||'alle'):`<select onchange="artSetKlasse('${_jsArg(a.id)}',this.value)" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;max-width:140px;"><option value="">alle Klassen</option>${objektklassen.map(k=>`<option value="${dlEsc(k.id)}"${a.klasse===k.id?' selected':''}>${dlEsc(k.name)}</option>`).join('')}</select>`}</td>`:''}
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:4px 12px;text-align:right;white-space:nowrap;">${ro
        ?(typeof a.zeitaufwand==='number'&&a.zeitaufwand>0?a.zeitaufwand+' min':'<span style="color:var(--text3);font-size:11px;">Standard</span>')
        :`<input type="number" min="0" step="1" value="${typeof a.zeitaufwand==='number'&&a.zeitaufwand>0?a.zeitaufwand:''}" placeholder="${getBewDuration()}" onchange="artSetTime('${_jsArg(a.id)}',this.value)" style="width:50px;padding:3px 6px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;" title="Minuten je Objekt (Stück); leer = Projekt-Standard (${getBewDuration()} min)"><span style="font-size:10px;color:var(--text3);"> min/Stk</span>${_geomActive()?`<br><input type="number" min="0" step="0.1" value="${typeof a.zeitaufwandM==='number'&&a.zeitaufwandM>0?a.zeitaufwandM:''}" placeholder="–" onchange="artSetRate('${_jsArg(a.id)}','zeitaufwandM',this.value)" style="width:50px;padding:3px 6px;margin-top:3px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;" title="Minuten je 100 m (Strecken)"><span style="font-size:10px;color:var(--text3);"> min/100m</span><br><input type="number" min="0" step="0.1" value="${typeof a.zeitaufwandM2==='number'&&a.zeitaufwandM2>0?a.zeitaufwandM2:''}" placeholder="–" onchange="artSetRate('${_jsArg(a.id)}','zeitaufwandM2',this.value)" style="width:50px;padding:3px 6px;margin-top:3px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;" title="Minuten je 100 m² (Flächen)"><span style="font-size:10px;color:var(--text3);"> min/100m²</span>`:''}`}</td>
      <td style="padding:7px 12px;white-space:nowrap;text-align:right;">${ro?'<span style="font-size:11px;color:var(--text3);">nur Lesezugriff</span>':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="renameArt('${a.id}')">Umbenennen</button>
        <select data-merge-field="__art__" data-merge-self="${dlEsc(a.id)}" onmousedown="_fillMerge(this)" onfocus="_fillMerge(this)" onchange="if(this.value)mergeArt('${a.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <option value="">→ zusammenführen…</option>
        </select>
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;${c===0?'color:#c0392b;':'opacity:.45;cursor:not-allowed;'}" ${c===0?`onclick="deleteArt('${a.id}')"`:'disabled title="Nur löschbar bei Häufigkeit 0"'}>Löschen</button>`}
      </td>
    </tr>`;
  }).join('');
  el.innerHTML=`<div style="max-width:780px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;flex-wrap:wrap;">
      <div style="font-size:15px;font-weight:700;">Arten – ${FL.art}</div>
      <span style="font-size:12px;color:var(--text3);">${sorted.length} Einträge · ${objCount} Objekte</span>
      ${ro?'':`<button class="btn btn-primary" style="margin-left:auto;padding:5px 11px;font-size:12px;" onclick="buildArten()">Liste aus Objekten aufbauen/aktualisieren</button>`}
    </div>
    ${ro?'':`<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:10px;">
      <span style="font-size:12px;font-weight:600;color:var(--text2);">⏱ Standard-Zeitaufwand</span>
      <input id="art-default-time" type="number" min="1" max="240" step="1" value="${getBewDuration()}" onchange="setArtDefaultTime(this.value)" style="width:64px;padding:4px 6px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
      <span style="font-size:12px;color:var(--text3);">Min/Objekt — gilt für Arten ohne eigenen Wert</span>
      ${artenList.length?`<button class="btn btn-secondary" style="margin-left:auto;padding:4px 10px;font-size:12px;white-space:nowrap;" onclick="artApplyTimeToAll()" title="Diesen Wert in alle ${artenList.length} Arten als eigenen Zeitaufwand schreiben">Für alle Arten übernehmen</button>`:''}
    </div>`}
    ${unmapped?`<div style="background:#fef3c7;border:1px solid #b45309;color:#7a4a06;border-radius:8px;padding:8px 12px;font-size:12px;margin-bottom:10px;">${unmapped} Objekte noch keiner Art-ID zugeordnet — „aufbauen/aktualisieren" klicken.</div>`:''}
    ${artenList.length===0?'<div style="color:var(--text3);font-size:13px;padding:10px 0;">Noch keine Arten-Liste. Klicke „aufbauen/aktualisieren", um sie aus den Objekten zu erzeugen.</div>':`
    <table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:13px;">
      <thead><tr style="background:var(--surface2);">
        <th style="padding:8px 8px 8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Symbol</th>
        <th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">${FL.art}</th>
        ${showKl?'<th style="padding:8px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Objektklasse</th>':''}
        <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Häufigkeit</th>
        <th style="padding:8px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);" title="Zeitaufwand je Objekt dieser Art (Minuten). Leer = Projekt-Standard.">Zeitaufwand/Obj.</th>
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
async function artSetTime(id,val){
  if(isReadonly()) return;
  const s=(''+(val??'')).trim().replace(',','.');
  const n=s===''?null:Math.max(0,Math.round(parseFloat(s)||0));
  try{
    const useDefault=(n==null||!(n>0));
    await updateDoc(doc(db,'projects',currentProjectId,'arten',id), useDefault?{zeitaufwand:firebase.firestore.FieldValue.delete()}:{zeitaufwand:n});
    await loadArten();
    renderArtenList();
    try{ updateRouteInfoBar(); }catch(e){}
    try{ renderLegend(); }catch(e){}
    try{ renderTourenGrid(); }catch(e){}
    notify(useDefault?'✓ Zeitaufwand: Projekt-Standard':'✓ Zeitaufwand '+n+' min/Objekt');
  }catch(e){ notify(dlErr(e)); }
}
// Längen-/Flächen-Aufwandssatz je Art: zeitaufwandM (min/100 m) bzw. zeitaufwandM2 (min/100 m²)
async function artSetRate(id, field, val){
  if(isReadonly()) return;
  if(field!=='zeitaufwandM' && field!=='zeitaufwandM2') return;
  const s=(''+(val??'')).trim().replace(',','.');
  const n=s===''?null:Math.max(0,parseFloat(s)||0);
  try{
    const del=(n==null||!(n>0));
    await updateDoc(doc(db,'projects',currentProjectId,'arten',id), del?{[field]:firebase.firestore.FieldValue.delete()}:{[field]:n});
    await loadArten(); renderArtenList();
    try{ updateRouteInfoBar(); }catch(e){}
    try{ renderLegend(); }catch(e){}
    try{ renderTourenGrid(); }catch(e){}
    notify(del?'✓ Aufwandssatz entfernt':'✓ Aufwandssatz gespeichert');
  }catch(e){ notify(dlErr(e)); }
}
// Standard-Zeitaufwand (Fallback für Arten ohne eigenen Wert) — am Projekt-Doc.
async function setArtDefaultTime(val){
  if(isReadonly()) return;
  const n=Math.max(1,Math.round(parseFloat((''+(val??'')).replace(',','.'))||0))||5;
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{bewDuration:n});
    if(currentProjectData) currentProjectData.bewDuration=n;
    try{ localStorage.setItem('bew_duration_min',n); }catch(e){}
    renderArtenList();
    try{ updateRouteInfoBar(); }catch(e){}
    try{ renderLegend(); }catch(e){}
    try{ renderTourenGrid(); }catch(e){}
    notify('✓ Standard-Zeitaufwand '+n+' min/Objekt');
  }catch(e){ notify(dlErr(e)); }
}
// Komfort: den Standardwert als eigenen Zeitaufwand in ALLE Arten schreiben.
async function artApplyTimeToAll(){
  if(isReadonly()) return;
  if(!artenList.length){ notify('Keine Arten vorhanden'); return; }
  const n=Math.max(1,Math.round(parseFloat(((document.getElementById('art-default-time')?.value)||'').replace(',','.'))||0))||getBewDuration();
  if(!confirm(`${n} Min/Objekt als Zeitaufwand für alle ${artenList.length} Arten übernehmen?\nBestehende Art-Zeiten werden überschrieben.`)) return;
  try{
    for(let i=0;i<artenList.length;i+=400){
      const batch=db.batch();
      const chunk=artenList.slice(i,i+400);
      chunk.forEach(a=>batch.update(doc(db,'projects',currentProjectId,'arten',a.id),{zeitaufwand:n}));
      await batch.commit();
      _bumpUsage('writes',chunk.length);
    }
    await loadArten();
    renderArtenList();
    try{ updateRouteInfoBar(); }catch(e){}
    try{ renderLegend(); }catch(e){}
    try{ renderTourenGrid(); }catch(e){}
    notify('✓ '+n+' min/Objekt für alle '+artenList.length+' Arten übernommen');
  }catch(e){ notify(dlErr(e)); }
}
// Art einer Objektklasse zuordnen (leer = alle Klassen) — steuert die Typ/Art-Auswahl im Formular
async function artSetKlasse(id, klasseId){
  if(isReadonly()) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'arten',id), klasseId?{klasse:klasseId}:{klasse:firebase.firestore.FieldValue.delete()});
    await loadArten(); renderArtenList();
  }catch(e){ console.warn('artSetKlasse',e); notify(dlErr(e)); }
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
  // Container (Abschnitte) sind keine Objekte → ihre „Art" (Straßenabschnitt) NICHT in die Arten-Liste aufnehmen
  const names=[...new Set(trees.filter(t=>!_isContainer(t)).map(t=>(t.art||'').trim()).filter(Boolean))];
  for(const nm of names){
    if(!byName.has(nm)){
      const ref=await addDoc(collection(db,'projects',currentProjectId,'arten'),{name:nm,orgId:currentProjectData?.orgId||currentOrg||null,createdAt:serverTimestamp()});
      byName.set(nm,ref.id);
    }
  }
  const ups=[];
  trees.forEach(t=>{ if(_isContainer(t)) return; const nm=(t.art||'').trim(); const id=nm?byName.get(nm):''; if((t.artId||'')!==(id||'')){ ups.push({id:t.id,data:{artId:id||null}}); t.artId=id||null; } });
  await _chunkedTreeUpdate(ups);
  await loadArten(); renderArtenList();
  notify(`✓ ${byName.size} Arten · ${ups.length} Objekte zugeordnet`);
}
// Wird ein Listenwert umbenannt/zusammengeführt/gelöscht, die Tour-Zuordnungsregeln mitführen,
// damit keine falschen „Regelverstöße" durch veraltete Regel-Werte entstehen. newVal=null → entfernen.
async function _propagateRuleRename(fieldKey, oldVal, newVal){
  if(!currentProjectId || oldVal==null || oldVal==='') return;
  const ups=[];
  for(const t of tours){
    const reg=t.regeln; if(!reg||!Array.isArray(reg[fieldKey])||!reg[fieldKey].includes(oldVal)) continue;
    const arr=reg[fieldKey].filter(v=>v!==oldVal);
    if(newVal!=null && newVal!=='' && !arr.includes(newVal)) arr.push(newVal);
    const newReg={...reg}; if(arr.length) newReg[fieldKey]=arr; else delete newReg[fieldKey];
    t.regeln=newReg; ups.push({id:t.id,regeln:newReg});
  }
  for(const u of ups){ try{ await updateDoc(doc(db,'projects',currentProjectId,'tours',u.id),{regeln:u.regeln}); }catch(e){ console.warn('Regel-Mitführung',e); } }
  if(ups.length) try{ renderTourenGrid(); }catch(_){}
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
  await _propagateRuleRename('art', a.name, name);
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
  await _propagateRuleRename('art', src.name, tgt.name);
  await loadArten(); renderArtenList();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function deleteArt(id){
  if(isReadonly()) return;
  const a=artenList.find(x=>x.id===id); if(!a) return;
  if((artCountById()[id]||0)>0){ notify('Nur löschbar bei Häufigkeit 0'); return; }
  if(!await confirmByName({label:'Art', name:a.name})) return;
  await deleteDoc(doc(db,'projects',currentProjectId,'arten',id));
  await _propagateRuleRename('art', a.name, null);
  await loadArten(); renderArtenList();
  notify('✓ Gelöscht');
}

// ─── GENERISCHE WERTELISTEN (Listenfelder am Projekt-Doc) ────────────
// art bleibt in eigener Subcollection (oben). Die übrigen Listenfelder
// (stadtteil, pflanzjahr, pflanzzeitpunkt, Kundenfelder feld1..feld5)
// liegen kompakt unter projects/{id}.listValues[fieldKey] = [{id,label}].
// Der Wert wird am Objekt als Label gespeichert (wie heute Freitext) →
// keine Datenmigration nötig, „Aus Objekten aufbauen" sammelt Bestand ein.
let objektklassen = []; // [{id,name,strukturart,felder:[fieldKeys]}] — Stage 1: Definition; Scoping folgt
let reinigungsklassen = []; // [{id,name,freq:{fahrbahn:n,gehweg:n,…}}] — Satzungs-Klassen (Stage 2)
function loadListValues(){
  listValues = JSON.parse(JSON.stringify(currentProjectData?.listValues || {}));
  customFields = (currentProjectData?.customFields || []).map(c=>({...c}));
  objektklassen = (currentProjectData?.objektklassen || []).map(k=>({...k, felder:[...(k.felder||[])]}));
  reinigungsklassen = (currentProjectData?.reinigungsklassen || []).map(r=>({...r, freq:{...(r.freq||{})}}));
}
function _rkById(id){ return reinigungsklassen.find(r=>r.id===id)||null; }
function listFor(fieldKey){ return listValues[fieldKey] || []; }
function _genId(){ return 'v'+Math.random().toString(36).slice(2,9); }
function _treesUsing(fieldKey,label){ const l=(label||'').trim(); return trees.filter(t=>(t[fieldKey]||'').trim()===l); }
// Befüllt ein „zusammenführen"-Dropdown erst bei Bedarf (Klick/Fokus) — vermeidet O(Werte²) Optionen
// vorab beim Rendern langer Listen (z. B. Kundenfeld mit tausenden Werten).
function _fillMerge(sel){
  if(!sel || sel.dataset.filled) return;
  sel.dataset.filled='1';
  const f=sel.dataset.mergeField, self=sel.dataset.mergeSelf;
  const items = f==='__art__'
    ? [...artenList].sort((a,b)=>(a.name||'').localeCompare(b.name||'')).map(x=>({id:x.id,label:x.name}))
    : [...(listValues[f]||[])].sort((a,b)=>(a.label||'').localeCompare(b.label||'')).map(x=>({id:x.id,label:x.label}));
  sel.insertAdjacentHTML('beforeend', items.filter(x=>x.id!==self).map(x=>`<option value="${dlEsc(x.id)}">${dlEsc(x.label)}</option>`).join(''));
}
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
  await _chunkedTreeUpdate(ups); await saveListValues(); await _propagateRuleRename(fieldKey, old, name); renderFieldCatalog();
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
  await saveListValues(); await _propagateRuleRename(fieldKey, src.label, tgt.label); renderFieldCatalog();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function deleteListVal(fieldKey,id){
  if(isReadonly()) return;
  const e=(listValues[fieldKey]||[]).find(x=>x.id===id); if(!e) return;
  if(_treesUsing(fieldKey,e.label).length>0){ notify('Nur löschbar, wenn kein Objekt den Wert nutzt'); return; }
  if(!await confirmByName({label:'Wert', name:e.label})) return;
  listValues[fieldKey]=(listValues[fieldKey]||[]).filter(x=>x.id!==id);
  await saveListValues(); await _propagateRuleRename(fieldKey, e.label, null); renderFieldCatalog(); notify('✓ Gelöscht');
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
// Geometrietyp-Scope eines Kundenfeldes umschalten (leere Liste = gilt für alle)
async function cfGeomToggle(fieldKey, gt, checked){
  if(isReadonly()) return;
  const c=customFields.find(x=>x.key===fieldKey); if(!c) return;
  const ALL=['punkt','linie','flaeche'];
  const set=new Set((c.geomTypes&&c.geomTypes.length)?c.geomTypes:ALL);
  if(checked) set.add(gt); else set.delete(gt);
  if(set.size===0){ notify('Mindestens ein Typ muss aktiv bleiben'); renderFieldCatalog(); return; }
  c.geomTypes=(set.size===ALL.length)?[]:ALL.filter(t=>set.has(t)); // alle aktiv → leer (= gilt für alle)
  await saveListValues(); renderFieldCatalog();
}
// ─── OBJEKTKLASSEN (Stage 1: Definition; Objekt-Zuordnung + Feld-Scoping folgen) ──
// Klasse = {id,name,strukturart,felder:[fieldKeys]}. Ohne Klassen = bisheriges Verhalten (nichts bricht).
const KLASSE_STRUKTUR={punkt:'Punkt',flaeche:'Fläche',strecke:'Strecke',seite:'Abschnitts-Objekt'};
function _klassePool(){ return [['stadtteil',FL.stadtteil],['baumnr',FL.baumnr],['art',FL.art],['pflanzjahr',FL.pflanzjahr],['pflanzzeitpunkt',FL.pflanzzeitpunkt],['zustand',FL.zustand],['wasser',FL.wasser],['notiz',FL.notiz],...customFields.map(c=>[c.key,c.label])]; }
async function saveObjektklassen(){
  if(!currentProjectId) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId), {objektklassen});
    if(currentProjectData) currentProjectData.objektklassen=objektklassen;
  }catch(e){ console.warn('saveObjektklassen',e); notify(dlErr(e)); }
}
async function addObjektklasse(){
  if(isReadonly()) return;
  const name=(prompt('Name der neuen Objektklasse (z. B. „Abfallbehälter", „Straßenabschnitt"):','')||'').trim(); if(!name) return;
  objektklassen.push({id:_genId(),name,strukturart:'punkt',felder:[]});
  await saveObjektklassen(); renderFieldCatalog(); notify('✓ Objektklasse angelegt');
}
async function renameObjektklasse(id,val){
  if(isReadonly()) return;
  const k=objektklassen.find(x=>x.id===id); if(!k) return;
  const l=(val||'').trim(); if(!l||l===k.name){ renderFieldCatalog(); return; }
  k.name=l; await saveObjektklassen(); notify('✓ Umbenannt');
}
async function setKlasseStruktur(id,val){
  if(isReadonly()) return;
  const k=objektklassen.find(x=>x.id===id); if(!k||!KLASSE_STRUKTUR[val]) return;
  k.strukturart=val; await saveObjektklassen();
}
async function toggleKlasseFeld(id,key,checked){
  if(isReadonly()) return;
  const k=objektklassen.find(x=>x.id===id); if(!k) return;
  k.felder=(k.felder||[]).filter(f=>f!==key);
  if(checked) k.felder.push(key);
  await saveObjektklassen();
}
async function deleteObjektklasse(id){
  if(isReadonly()) return;
  const k=objektklassen.find(x=>x.id===id); if(!k) return;
  if(!confirm(`Objektklasse „${k.name}" löschen?`)) return;
  objektklassen=objektklassen.filter(x=>x.id!==id);
  await saveObjektklassen(); renderFieldCatalog(); notify('✓ Gelöscht');
}
// ─── REINIGUNGSKLASSEN-KATALOG (Stage 2) — je Klasse Häufigkeit pro Element-Gruppe ──
async function saveReinigungsklassen(){
  if(!currentProjectId) return;
  try{
    await updateDoc(doc(db,'projects',currentProjectId), {reinigungsklassen});
    if(currentProjectData) currentProjectData.reinigungsklassen=reinigungsklassen;
  }catch(e){ console.warn('saveReinigungsklassen',e); notify(dlErr(e)); }
}
const _RK_PALETTE=['#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#ec4899','#14b8a6','#64748b','#0ea5e9','#a16207'];
async function addReinigungsklasse(){
  if(isReadonly()) return;
  const name=(prompt('Name der Reinigungsklasse (laut Satzung, z. B. „B2"):','')||'').trim(); if(!name) return;
  reinigungsklassen.push({id:_genId(),name,color:_RK_PALETTE[reinigungsklassen.length%_RK_PALETTE.length],freq:{fahrbahn:1}}); // Fahrbahn immer dabei
  await saveReinigungsklassen(); renderFieldCatalog(); notify('✓ Reinigungsklasse angelegt');
}
async function setRkColor(id,val){
  if(isReadonly()) return;
  const r=_rkById(id); if(!r) return;
  r.color=val; await saveReinigungsklassen();
  if(_colorMode==='rk'){ _applyFlaechenSelection(); _renderRkLegend(); } // Karte live nachfärben
}
// Reinigungsklasse direkt am Abschnitt setzen (aus dem Detail-Panel)
async function setAbschnittRk(id,val){
  if(isReadonly()) return;
  const c=trees.find(t=>t.id===id); if(!c) return;
  c.reinigungsklasse=val||''; // optimistisch — Seiten erben sofort
  try{ await updateDoc(doc(db,'projects',currentProjectId,'trees',id),{reinigungsklasse:val||''}); }
  catch(e){ console.warn('setAbschnittRk',e); notify(dlErr(e)); }
  openAbschnitt(id);                 // Panel + abgeleitete Häufigkeiten neu
  if(_colorMode!=='none') _applyFlaechenSelection();
}
async function renameReinigungsklasse(id,val){
  if(isReadonly()) return;
  const r=_rkById(id); if(!r) return;
  const l=(val||'').trim(); if(!l||l===r.name){ renderFieldCatalog(); return; }
  r.name=l; await saveReinigungsklassen(); notify('✓ Umbenannt');
}
// Häufigkeit je Element-Gruppe setzen; leer = Gruppe nicht abgedeckt (Fahrbahn bleibt immer)
async function setRkFreq(id,gruppe,val){
  if(isReadonly()) return;
  const r=_rkById(id); if(!r) return;
  if(!r.freq) r.freq={};
  const v=(val||'').toString().trim();
  if(v==='' && gruppe!=='fahrbahn'){ delete r.freq[gruppe]; }
  else { const n=parseFloat(v.replace(',','.')); r.freq[gruppe]=isNaN(n)?0:n; }
  await saveReinigungsklassen();
}
async function deleteReinigungsklasse(id){
  if(isReadonly()) return;
  const r=_rkById(id); if(!r) return;
  const used=trees.filter(t=>t.reinigungsklasse===id).length;
  if(!confirm(`Reinigungsklasse „${r.name}" löschen?${used?`\n${used} Abschnitt(e) nutzen sie — die Zuordnung wird dort leer.`:''}`)) return;
  reinigungsklassen=reinigungsklassen.filter(x=>x.id!==id);
  await saveReinigungsklassen(); renderFieldCatalog(); notify('✓ Gelöscht');
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
  if(!await confirmByName({title:'Kundenfeld entfernen', label:'Kundenfeld', name:c.label, confirmText:'Entfernen', warn:`Kundenfeld <b style="color:var(--text);">${dlEsc(c.label)}</b> entfernen? Die Werteliste wird gelöscht; bereits an Objekten gespeicherte Werte bleiben erhalten, das Feld wird ausgeblendet.`})) return;
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
// Zahlenwert je geordnetem Listenwert (z. B. wöchentlich = 1) — für Auswertung/Soll-Ist
async function rankSetZahl(fieldKey,id,val){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  const v=String(val??'').trim().replace(',','.'); const n=parseFloat(v);
  if(v===''||isNaN(n)) delete e.zahl; else e.zahl=n;
  await saveListValues(); _afterRankChange();
}
// Zweite Zahl je Wert: Winter-Häufigkeit (leer = Rückfall auf Sommer/Standard-Zahl)
async function rankSetZahlWinter(fieldKey,id,val){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  const v=String(val??'').trim().replace(',','.'); const n=parseFloat(v);
  if(v===''||isNaN(n)) delete e.zahlWinter; else e.zahlWinter=n;
  await saveListValues(); _afterRankChange();
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
  await saveListValues(); await _propagateRuleRename(fieldKey, srcId, tgtId); _afterRankChange();
  notify(`✓ Zusammengeführt — ${ups.length} Objekte umgehängt`);
}
async function rankDelete(fieldKey,id){
  if(isReadonly()) return; _materializeRank(fieldKey);
  const e=listValues[fieldKey].find(x=>x.id===id); if(!e) return;
  if(_rankUseCount(fieldKey,id)>0){ notify('Nur löschbar, wenn kein Objekt den Wert nutzt'); return; }
  if(!await confirmByName({label:'Wert', name:e.label})) return;
  listValues[fieldKey]=listValues[fieldKey].filter(x=>x.id!==id);
  await saveListValues(); await _propagateRuleRename(fieldKey, id, null); _afterRankChange(); notify('✓ Gelöscht');
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
      <td style="padding:6px 8px;text-align:right;">${ro?(e.zahl??'<span style="color:var(--text3);">–</span>'):`<input type="number" step="0.5" value="${e.zahl??''}" onchange="rankSetZahl('${fieldKey}','${e.id}',this.value)" style="width:58px;padding:3px 6px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;" title="Häufigkeit im Sommer (×/Woche) — Grundlage Soll-Ist">`}</td>
      <td style="padding:6px 8px;text-align:right;">${ro?(e.zahlWinter??'<span style="color:var(--text3);">–</span>'):`<input type="number" step="0.5" value="${e.zahlWinter??''}" onchange="rankSetZahlWinter('${fieldKey}','${e.id}',this.value)" placeholder="=Sommer" style="width:64px;padding:3px 6px;font-size:12px;text-align:right;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;" title="Häufigkeit im Winter (×/Woche). Leer = wie Sommer. 0 = im Winter nicht fällig.">`}</td>
      <td style="padding:6px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:6px 12px;white-space:nowrap;text-align:right;">${ro?'':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="rankRename('${fieldKey}','${e.id}')">Umbenennen</button>
        <select onchange="if(this.value)rankMerge('${fieldKey}','${e.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;"><option value="">→ zusammenführen…</option>${vals.filter(x=>x.id!==e.id).map(x=>`<option value="${x.id}">${dlEsc(x.label)}</option>`).join('')}</select>
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;${c===0?'color:#c0392b;':'opacity:.45;cursor:not-allowed;'}" ${c===0?`onclick="rankDelete('${fieldKey}','${e.id}')"`:'disabled title="Nur löschbar bei Häufigkeit 0"'}>Löschen</button>`}
      </td></tr>`;
  }).join('');
  return `<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;"><div style="font-size:14px;font-weight:700;">${dlEsc(title)}</div><span style="font-size:11px;color:var(--text3);background:var(--surface2);padding:2px 7px;border-radius:5px;">Geordnete Liste · ${vals.length}</span></div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:10px;">Mit ▲▼ die Reihenfolge (Rang) festlegen — bestimmt Sortierung und Auswertung. Die Farbe färbt die Anzeige in Tabelle und Detail. Spalten „Sommer"/„Winter": Häufigkeit je Woche (×) für den Soll-Ist-Abgleich (z. B. Sommer 2, Winter 1). Winter leer = wie Sommer; Winter 0 = im Winter nicht fällig. Sommer/Winter-Zeitraum unter Einstellungen.</div>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface2);"><th style="padding:6px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Rang</th><th style="padding:6px 8px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Farbe</th><th style="padding:6px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Wert</th><th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);" title="Häufigkeit im Sommer (×/Woche)">Sommer</th><th style="padding:6px 8px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);" title="Häufigkeit im Winter (×/Woche); leer = wie Sommer">Winter</th><th style="padding:6px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">Häufigkeit</th><th></th></tr></thead>
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
  // „Gilt für" (Geometrietyp-Scope) nur bei Kundenfeldern UND wenn das Projekt Nicht-Punkt-Geometrien hat
  const cf=opts.custom?customFields.find(c=>c.key===fieldKey):null;
  const geomScopeUI=(opts.custom && !ro && _geomActive())?`<div style="display:flex;align-items:center;gap:12px;margin:0 0 10px;font-size:12px;color:var(--text2);flex-wrap:wrap;">
      <span style="color:var(--text3);">Gilt für:</span>
      ${['punkt','linie','flaeche'].map(gt=>`<label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" ${fieldAppliesTo(cf,gt)?'checked':''} onchange="cfGeomToggle('${fieldKey}','${gt}',this.checked)" style="margin:0;cursor:pointer;">${{punkt:'Punkt',linie:'Linie',flaeche:'Fläche'}[gt]}</label>`).join('')}
      <span style="color:var(--text3);font-size:11px;">(alle aktiv = überall sichtbar)</span>
    </div>`:'';
  const counts=Object.create(null);  // Häufigkeiten in 1 Durchlauf statt O(Werte×Objekte)
  for(const t of trees){ const v=(t[fieldKey]||'').toString().trim(); if(v) counts[v]=(counts[v]||0)+1; }
  const rows=vals.map(e=>{
    const c=counts[(e.label||'').trim()]||0;
    return `<tr style="border-top:1px solid var(--border);">
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(e.label)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${c}</td>
      <td style="padding:7px 12px;white-space:nowrap;text-align:right;">${ro?'':`
        <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" onclick="renameListVal('${fieldKey}','${e.id}')">Umbenennen</button>
        <select data-merge-field="${dlEsc(fieldKey)}" data-merge-self="${dlEsc(e.id)}" onmousedown="_fillMerge(this)" onfocus="_fillMerge(this)" onchange="if(this.value)mergeListVal('${fieldKey}','${e.id}',this.value);this.selectedIndex=0;" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">
          <option value="">→ zusammenführen…</option>
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
    ${geomScopeUI}
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
  const labelFields=[['name','Anlage / Straße'],['stadtteil','Stadtteil'],['baumnr','Objektnummer'],['art','Typ / Art'],['pflanzjahr','Jahr'],['pflanzzeitpunkt','Zeitpunkt'],['zustand','Zustand'],['wasser','Priorität'],['notiz','Notiz'],['datum','Letzte Bearb.']];
  const labelGrid = ro ? '' : `
    <div style="font-size:13px;font-weight:700;margin:26px 0 4px;">Feldbezeichnungen</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Wie die Felder in Formular, Tabelle und Detailansicht heißen — der interne Bezug bleibt gleich. Änderungen werden sofort gespeichert.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;">
      ${labelFields.map(([k,def])=>`<div><label style="display:block;font-size:11px;color:var(--text3);margin-bottom:3px;">${dlEsc(def)}</label><input class="form-control" id="fl-${k}" value="${dlEsc(FL[k]||'')}" placeholder="${dlEsc(DEFAULT_LABELS[k]||def)}" onchange="setFieldLabel('${k}',this.value)" style="padding:6px 9px;font-size:13px;"></div>`).join('')}
    </div>`;
  // Fahrer-App: welche Stammdaten im Detail-Sheet erscheinen (projekt-konfigurierbar)
  const mobilCand=[['baumnr',FL.baumnr||'Objektnummer'],['art',FL.art||'Typ / Art'],['stadtteil',FL.stadtteil||'Stadtteil'],['pflanzjahr',FL.pflanzjahr||'Jahr'],['pflanzzeitpunkt',FL.pflanzzeitpunkt||'Zeitpunkt'],...customFields.map(c=>[c.key,c.label])];
  const mobilSel=Array.isArray(currentProjectData?.mobilFelder)?currentProjectData.mobilFelder:['baumnr','art','pflanzjahr','pflanzzeitpunkt',...customFields.map(c=>c.key)];
  const mobilSection = ro ? '' : `
    <div style="font-size:13px;font-weight:700;margin:26px 0 4px;">Fahrer- &amp; Erfassungs-App: sichtbare Felder</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Welche Stammdaten die Fahrer-App (Detail-Ansicht) und die Erfassungs-App (Bearbeiten-Maske) zeigen. Koordinaten und Routen-Nr. sind in der Fahrer-App immer dabei; Anlage/Straße, Zustand, Priorität/Bedarf und Notiz werden ohnehin direkt erfasst.</div>
    <div style="display:flex;flex-wrap:wrap;gap:9px 18px;">
      ${mobilCand.map(([k,l])=>`<label style="display:inline-flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;"><input type="checkbox" ${mobilSel.includes(k)?'checked':''} onchange="toggleMobilFeld('${k}',this.checked)" style="margin:0;cursor:pointer;">${dlEsc(l)}</label>`).join('')}
    </div>`;
  // Objektklassen (Stage 1: nur Definition — Zuordnung & Scoping folgen)
  const klassenSection = ro ? '' : `
    <div style="font-size:13px;font-weight:700;margin:26px 0 4px;">Objektklassen</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Definiere Objekttypen (z. B. „Abfallbehälter", „Baum", „Straßenabschnitt") und welche Felder zu ihnen gehören. Ohne Klassen bleibt alles wie bisher — die Zuordnung der Objekte und das Ausblenden nicht-passender Felder folgt im nächsten Schritt.</div>
    ${objektklassen.map(k=>`
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--surface);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <input class="form-control" value="${dlEsc(k.name)}" onchange="renameObjektklasse('${k.id}',this.value)" style="flex:1;padding:6px 9px;font-size:13px;font-weight:600;">
          <select class="form-control" onchange="setKlasseStruktur('${k.id}',this.value)" style="padding:6px 9px;font-size:13px;width:auto;">
            ${Object.entries(KLASSE_STRUKTUR).map(([v,l])=>`<option value="${v}"${k.strukturart===v?' selected':''}>${dlEsc(l)}</option>`).join('')}
          </select>
          <button class="btn btn-secondary" onclick="deleteObjektklasse('${k.id}')" style="padding:5px 10px;font-size:12px;color:#dc2626;">Löschen</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:7px 16px;">
          ${_klassePool().map(([key,label])=>`<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;"><input type="checkbox" ${(k.felder||[]).includes(key)?'checked':''} onchange="toggleKlasseFeld('${k.id}','${key}',this.checked)" style="margin:0;cursor:pointer;">${dlEsc(label)}</label>`).join('')}
        </div>
      </div>`).join('')}
    <button class="btn btn-secondary" style="padding:7px 14px;font-size:12px;" onclick="addObjektklasse()">+ Objektklasse anlegen</button>`;
  // Soll-Ist: welches Feld liefert die Ziel-Häufigkeit (×/Woche) — projektweit
  const _sollCands=_sollCandidateFields();
  const sollSection = ro ? '' : `
    <div style="font-size:13px;font-weight:700;margin:26px 0 4px;">Soll-Ist</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px;">Welches Feld liefert die Ziel-Häufigkeit für den Soll-Ist-Abgleich? Genutzt wird die „Zahl" des gewählten Werts (z. B. wöchentlich = 1). Es zählt für alle Objekttypen.</div>
    ${_sollCands.length?`<select class="form-control" style="width:auto;padding:6px 9px;font-size:13px;" onchange="setSollFeld(this.value)">
      <option value="">— kein Soll-Feld —</option>
      ${_sollCands.map(f=>`<option value="${dlEsc(f.key)}"${(currentProjectData?.sollFeld||'')===f.key?' selected':''}>${dlEsc(f.label)}</option>`).join('')}
    </select>`:`<div style="font-size:12px;color:#92400e;background:#fef3c7;border-radius:8px;padding:8px 12px;">Noch kein Feld mit „Zahl"-Werten vorhanden. Zuerst in einer geordneten Liste (z. B. RH) je Wert eine „Zahl" eintragen — dann kann es hier als Soll-Feld gewählt werden.</div>`}`;
  // Reinigungsklassen-Katalog (Satzung): je Klasse Häufigkeit pro Element-Gruppe
  const rkSection = ro ? '' : `
    <div style="font-size:13px;font-weight:700;margin:26px 0 4px;">Reinigungsklassen (Satzung)</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:10px;">Je Klasse die Reinigungs-Häufigkeit pro Element-Gruppe (× pro Woche). Fahrbahn ist immer dabei; leere Felder = Gruppe nicht abgedeckt. Wird einem Straßenabschnitt zugewiesen; die Seiten erben ihre Häufigkeit daraus.</div>
    ${reinigungsklassen.map(r=>`
      <div style="border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--surface);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
          <input type="color" value="${dlEsc(r.color||'#3b82f6')}" onchange="setRkColor('${r.id}',this.value)" title="Farbe (Karte: Einfärben nach Reinigungsklasse)" style="width:36px;height:32px;padding:2px;border:1px solid var(--border);border-radius:6px;cursor:pointer;flex:none;">
          <input class="form-control" value="${dlEsc(r.name)}" onchange="renameReinigungsklasse('${r.id}',this.value)" style="flex:1;padding:6px 9px;font-size:13px;font-weight:600;">
          <button class="btn btn-secondary" onclick="deleteReinigungsklasse('${r.id}')" style="padding:5px 10px;font-size:12px;color:#dc2626;">Löschen</button>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px 18px;">
          ${ELEM_GRUPPE_ORDER.map(g=>`<label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;">${dlEsc(ELEM_GRUPPE_LABEL[g])}${g==='fahrbahn'?' *':''}<input type="number" min="0" step="0.5" value="${r.freq&&r.freq[g]!=null?r.freq[g]:''}" onchange="setRkFreq('${r.id}','${g}',this.value)" placeholder="–" style="width:64px;padding:4px 7px;font-size:12px;border:1px solid var(--border);border-radius:6px;"></label>`).join('')}
        </div>
      </div>`).join('')}
    <button class="btn btn-secondary" style="padding:7px 14px;font-size:12px;" onclick="addReinigungsklasse()">+ Reinigungsklasse anlegen</button>`;
  el.innerHTML=`<div style="max-width:880px;margin:0 auto;">
    <div style="font-size:16px;font-weight:700;margin-bottom:4px;">Felder & Listen</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:16px;">Wähle ein Feld, um seine Auswahlliste zu pflegen; die Bezeichnungen änderst du unten. Freitext-Felder (${dlEsc(FL.name)}, ${dlEsc(FL.baumnr)}, ${dlEsc(FL.notiz)}) haben keine Liste.</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">${tiles}</div>
    ${!ro && customFields.length<5?`<button class="btn btn-secondary" style="padding:7px 14px;font-size:12px;margin-top:16px;" onclick="addCustomField()">+ Kundenfeld hinzufügen (${customFields.length}/5)</button>`:''}
    ${sollSection}
    ${klassenSection}
    ${rkSection}
    ${mobilSection}
    ${labelGrid}
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
  _baeumeFiltered=treeList||[]; updateBulkBar();   // Operier-Menge der Sammelaktion
  const wrap=document.getElementById('baeume-table-wrap');
  if(trees.length===0){
    wrap.innerHTML=`<div class="empty-state" style="margin-top:60px;">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 22V12"/><path d="M12 12C12 12 7 9 7 5a5 5 0 0 1 10 0c0 4-5 7-5 7z"/></svg>
      <p>Noch keine Objekte</p></div>`;
    return;
  }
  // Lazy: ohne Suche/Filter und bei vielen Objekten nicht alle Zeilen rendern — erst Hinweis (Übersicht/Performance)
  const _q=(document.getElementById('baeume-search')?.value||'').trim();
  if(!_q && !_baeumeNoGpsFilter && !_baeumeShowAll && (treeList||[]).length>600){
    wrap.innerHTML=`<div class="empty-state" style="margin-top:40px;text-align:center;">
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      <p style="font-weight:600;margin:8px 0 2px;">${treeList.length.toLocaleString('de-DE')} Objekte</p>
      <p style="font-size:12px;color:var(--text3);line-height:1.55;max-width:380px;margin:0 auto;">Für die Übersicht nicht alle aufgelistet. Oben <b>suchen</b> (Name, Stadtteil, Objekt-ID …) oder „Ohne GPS" filtern — dann erscheinen die Treffer.</p>
      <button class="btn btn-primary" style="margin-top:14px;padding:7px 16px;font-size:12px;" onclick="toggleShowAll()">Alle ${treeList.length.toLocaleString('de-DE')} Objekte anzeigen</button></div>`;
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
    {key:'rn',   label:'#',        w:'40px'},
    {key:'baumId',label:'Objekt-ID', w:'80px'},
    {key:'name', label:FL.name,          w:'200px'},
    {key:'stadtteil',label:FL.stadtteil, w:'110px'},
    {key:'baumnr',label:FL.baumnr,       w:'130px'},
    {key:'art',  label:FL.art,           w:'180px'},
    {key:'pflanzjahr',label:FL.pflanzjahr,w:'100px'},
    {key:'pflanzzeitpunkt',label:FL.pflanzzeitpunkt,w:'140px'},
    ...customFields.map(c=>({key:'cf:'+c.key,label:c.label,w:'120px'})),
    {key:'zustand',label:FL.zustand,     w:'80px'},
    {key:'tour', label:'Tour',           w:'110px'},
    {key:'wasser',label:FL.wasser,       w:'100px'},
    {key:'datum',label:FL.datum,         w:'110px'},
    {key:'notiz',label:FL.notiz,         w:'160px'},
    {key:'menge',label:'Menge',          w:'90px'},
    {key:'gps',  label:'GPS',      w:'70px'},
    {key:'actions',label:'',       w:'100px'},
  ];

  const th=cols.map(col=>
    `<th data-col="${col.key}" style="position:sticky;top:0;z-index:2;padding:9px 12px;text-align:left;font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);background:var(--surface2);white-space:nowrap;min-width:${col.w};">${col.label}</th>`
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
      <td data-col="rn" style="padding:8px 12px;font-family:'DM Mono',monospace;color:var(--text3);font-size:11px;white-space:nowrap;">${rNum!=null?'<b style=color:var(--green)>#'+rNum+'</b>':'–'}</td>
      <td data-col="baumId" style="padding:8px 12px;font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--green);white-space:nowrap;">${dlEsc(tree.baumId||'–')}</td>
      <td data-col="name" style="padding:8px 12px;font-weight:500;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc((tree.containerExtId&&_containerOf(tree)?.name)||tree.name||'')}">${inact?'<span style="font-size:9px;font-weight:700;padding:1px 6px;border-radius:9px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);margin-right:5px;">INAKTIV</span>':''}${_geomChip(tree)}${(()=>{ const c=tree.containerExtId?_containerOf(tree):null; return c?`${dlEsc(c.name||'–')}<span style="color:var(--text3);font-weight:400;font-size:11px;"> · ${dlEsc(_elemLabel(tree))}</span>`:dlEsc(tree.name||'–'); })()}</td>
      <td data-col="stadtteil" style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.stadtteil||'–')}</td>
      <td data-col="baumnr" style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${dlEsc(tree.baumnr||'–')}</td>
      <td data-col="art" style="padding:8px 12px;color:var(--text2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(tree.art||'')}">${dlEsc(tree.art||'–')}</td>
      <td data-col="pflanzjahr" style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${dlEsc(tree.pflanzjahr||'–')}</td>
      <td data-col="pflanzzeitpunkt" style="padding:8px 12px;color:var(--text2);white-space:nowrap;font-size:12px;">${dlEsc(pzt)}</td>
      ${customFields.map(c=>`<td data-col="cf:${c.key}" style="padding:8px 12px;color:var(--text2);white-space:nowrap;font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;" title="${dlEsc(tree[c.key]||'')}">${dlEsc(tree[c.key]||'–')}</td>`).join('')}
      <td data-col="zustand" style="padding:8px 12px;">${zBadge}</td>
      <td data-col="tour" style="padding:8px 12px;white-space:nowrap;">${rowTours.length?rowTours.map(t=>`<span style="font-size:11px;font-weight:600;color:${t.color};">${dlEsc(t.name)}</span>`).join('<br>'):'<span style="color:var(--text3);font-size:12px;">–</span>'}</td>
      <td data-col="wasser" style="padding:8px 12px;color:var(--text2);white-space:nowrap;">${wLbl}</td>
      <td data-col="datum" style="padding:8px 12px;color:var(--text2);font-family:'DM Mono',monospace;font-size:11px;white-space:nowrap;">${tree.datum||'–'}</td>
      <td data-col="notiz" style="padding:8px 12px;color:var(--text2);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;" title="${dlEsc(tree.notiz||'')}">${dlEsc(tree.notiz||'–')}</td>
      <td data-col="menge" style="padding:8px 12px;color:var(--text2);white-space:nowrap;text-align:right;font-size:12px;">${(tree.menge==null||tree.menge==='')?'–':(tree.einheit==='m'?_fmtLen(tree.menge):_fmtArea(tree.menge))}</td>
      <td data-col="gps" style="padding:8px 12px;">${!tree.lat||!tree.lng?'<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;background:#fef3c7;color:#b45309;white-space:nowrap;">Kein GPS</span>':''}</td>
      <td data-col="actions" style="padding:8px 12px;">
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
      <button onclick="openBaeumeColMenu(this)" class="btn btn-secondary" style="margin-left:auto;padding:3px 10px;font-size:11px;white-space:nowrap;" title="Spalten ein-/ausblenden"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>Spalten<span id="baeume-col-badge" style="color:var(--text3);">${_baeumeHiddenCols.size?` (${_baeumeHiddenCols.size} aus)`:''}</span></button>
      ${(currentRole==='superadmin'||currentCap==='admin')?`<button onclick="checkBaumIdDuplicates()" class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;" title="Prüft alle Objekt-IDs dieses Projekts auf Dubletten">Objekt-IDs prüfen</button>`:''}
      ${(currentRole==='superadmin'||currentCap==='admin')&&trees.some(_isContainer)?`<button onclick="deriveHaeufigkeitFromZustaendigkeit()" class="btn btn-secondary" style="padding:3px 10px;font-size:11px;white-space:nowrap;" title="Setzt je Seite die Reinigungshäufigkeit aus dem Zuständigkeits-Tag im Feld Typ/Art: (Stadt) → 1×/Woche, (Anlieger) → 0">Häufigkeit aus Zuständigkeit</button>`:''}
    </div>
    <style id="baeume-col-style">${_baeumeColStyleText()}</style>
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
  // Rechtsklick auf eine Objektzeile: kein (Browser-)Menü
  wrap.oncontextmenu=e=>{ if(e.target.closest('[data-treeid]')) e.preventDefault(); };
}

let _tourenSearch='';
function filterTourenGrid(q){ _tourenSearch=q||''; renderTourenGrid(); }

// ── Tour-Plausibilität (F): sind die Touren fahrbar, aktuell, gut geschnitten? ──
function _tourChecks(){
  const real=tours.filter(t=>!t.uebersicht && !isOverviewTour(t.id));
  const rp=getRoutePlanningEnabled();
  const leer=[],ohneFahrer=[],ohneRoute=[],veraltet=[],ueberbucht=[],regel=[],ausreisser=[];
  real.forEach(t=>{
    const members=trees.filter(x=>isActive(x)&&treeInTour(x,t.id));
    if(members.length===0){ leer.push(t); return; }        // leere Tour → restliche Checks überspringen
    const drivers=(t.drivers||(t.assignedDriver?[t.assignedDriver]:[])).filter(Boolean);
    if(!drivers.length) ohneFahrer.push(t);
    const rt=tourRoutes[t.id];
    const hasRoute=!!rt||typeof t.routeKm==='number';
    if(rp){
      if(!hasRoute) ohneRoute.push(t);
      else if(rt&&Array.isArray(rt.orderIds)){                // veraltet: Route-Menge ≠ aktuelle Mitglieder
        const setO=new Set(rt.orderIds), setM=new Set(members.map(m=>m.id));
        let diff=setO.size!==setM.size; if(!diff){ for(const id of setM){ if(!setO.has(id)){ diff=true; break; } } }
        if(diff) veraltet.push(t);
      }
    }
    const driveVal=rt?rt.durationSec:(typeof t.routeDriveSec==='number'?t.routeDriveSec:null);
    const rz=tourRestzeit(t,members,driveVal);
    if(rz&&rz.restMin<0) ueberbucht.push(t);
    if(tourViolatingTrees(t).length) regel.push(t);
    const pts=members.filter(m=>m.lat&&m.lng);
    if(pts.length>=4){                                       // Ausreißer: weit vom Tour-Schwerpunkt
      const cy=pts.reduce((a,m)=>a+m.lat,0)/pts.length, cx=pts.reduce((a,m)=>a+m.lng,0)/pts.length;
      const d=pts.map(m=>haversine(m.lat,m.lng,cy,cx));
      const mean=d.reduce((a,b)=>a+b,0)/d.length;
      if(d.some(x=>x>Math.max(1.5,mean*3))) ausreisser.push(t);
    }
  });
  return {leer,ohneFahrer,ohneRoute,veraltet,ueberbucht,regel,ausreisser};
}
function renderTourKontrolle(){
  const el=document.getElementById('tour-kontrolle'); if(!el) return;
  const c=_tourChecks();
  const cats=[
    {label:'Leere Tour',            items:c.leer,      act:'öffnen',        fn:t=>`openTourModal('${t.id}')`},
    {label:'Ohne Fahrer',           items:c.ohneFahrer,act:'Fahrer zuweisen',fn:t=>`openTourModal('${t.id}')`},
    {label:'Ohne Route',            items:c.ohneRoute, act:'Route berechnen',fn:t=>`calculateAndSaveRoute('${t.id}')`},
    {label:'Route veraltet',        items:c.veraltet,  act:'neu berechnen', fn:t=>`calculateAndSaveRoute('${t.id}')`},
    {label:'Überbucht (Restzeit < 0)',items:c.ueberbucht,act:'öffnen',      fn:t=>`openTourModal('${t.id}')`},
    {label:'Regelverstöße',         items:c.regel,     act:'anzeigen',      fn:t=>`showTourViolations('${t.id}')`},
    {label:'Ausreißer-Objekt (weit weg)',items:c.ausreisser,act:'auf Karte',fn:t=>`focusTourAndSwitch('${t.id}')`},
  ].filter(k=>k.items.length);
  const total=cats.reduce((a,k)=>a+k.items.length,0);
  if(!cats.length){ el.innerHTML=`<div style="display:flex;align-items:center;gap:7px;font-size:12px;color:var(--green);padding:2px 0 12px;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6 9 17l-5-5"/></svg>Tour-Kontrolle: alle Touren plausibel.</div>`; return; }
  el.innerHTML=`<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;padding:10px 14px;margin-bottom:14px;">
    <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:6px;">⚠ Tour-Kontrolle — ${total} Auffälligkeit(en)</div>
    ${cats.map(k=>`<div style="display:flex;align-items:baseline;gap:8px;padding:5px 0;flex-wrap:wrap;border-top:1px solid #f8d377;">
      <span style="font-size:12px;font-weight:600;color:#92400e;min-width:170px;flex:none;">${dlEsc(k.label)} · ${k.items.length}</span>
      <span style="display:flex;gap:5px;flex-wrap:wrap;">${k.items.slice(0,40).map(t=>`<button onclick="${k.fn(t)}" title="${dlEsc(k.act)}" style="font-size:11px;border:1px solid #f59e0b;background:#fff;color:#92400e;border-radius:5px;padding:1px 7px;cursor:pointer;font-family:inherit;white-space:nowrap;">${dlEsc(t.name||'Tour')} ›</button>`).join('')}${k.items.length>40?`<span style="font-size:11px;color:#92400e;align-self:center;">+${k.items.length-40}</span>`:''}</span>
    </div>`).join('')}
  </div>`;
}

function renderTourenGrid(){
  const grid=document.getElementById('touren-grid');
  const countEl=document.getElementById('touren-count');
  if(!grid)return;
  renderTourKontrolle();
  const genBtn=document.getElementById('btn-flaechen-tourgen');
  if(genBtn) genBtn.style.display=((currentRole==='superadmin'||currentCap==='admin') && _geomActive() && trees.some(t=>geomTypeOf(t)==='flaeche'&&(t.fahrzeug||'').trim()))?'':'none';

  if(tours.length===0){
    grid.innerHTML=`<tr><td colspan="8" style="padding:60px;text-align:center;color:var(--text3);">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="display:block;margin:0 auto 12px;opacity:.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
      Noch keine Touren angelegt</td></tr>`;
    if(countEl)countEl.textContent='Touren';
    return;
  }

  const ovCount=tours.filter(t=>t.uebersicht).length, echtCount=tours.length-ovCount;
  // Standardmäßig nur echte Touren; Übersichten erst nach Klick auf den Umschalter
  const base=showOverviewInGrid ? tours : tours.filter(t=>!t.uebersicht);
  const q=(_tourenSearch||'').trim().toLowerCase();
  const list=q ? base.filter(t=>matchTerms((t.name||'')+' '+(t.desc||''), q)) : base;
  if(countEl)countEl.textContent=q?`${list.length} von ${tours.length} Touren`:`${echtCount} Touren${ovCount?` · ${ovCount} Übersicht`:''}`;
  // Umschalter nur zeigen, wenn es überhaupt Übersichten gibt
  const ovBtn=document.getElementById('btn-toggle-overview-grid');
  if(ovBtn){
    ovBtn.style.display=ovCount?'':'none';
    const lbl=document.getElementById('toggle-overview-grid-label');
    if(lbl) lbl.textContent=showOverviewInGrid?'Übersichten ausblenden':`Übersichten anzeigen (${ovCount})`;
    ovBtn.style.background=showOverviewInGrid?'var(--green-light)':'';
    ovBtn.style.color=showOverviewInGrid?'var(--green)':'';
  }

  if(list.length===0){
    const msg=q ? `Keine Tour gefunden für „${_tourenSearch}"`
                : 'Nur Übersichten vorhanden — über „Übersichten anzeigen" oben rechts einblenden.';
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
    const bewZeit=kmVal!=null?fmtBewTime(treesInTour):'–';
    const _zusMin=tourZusatzMin(tour);
    const gesamtZeit=driveVal?fmtTotalTime(driveVal,treesInTour,_zusMin):'–';
    const _rz=tourRestzeit(tour,treesInTour,driveVal);
    const _violCnt=tourViolatingTrees(tour).length;
    const _rulesActive=tourHasRules(tour);
    const zusLine=_zusMin>0?`
        <div style="color:var(--text2);">${fmtMin(_zusMin)} <span style="color:var(--text3);font-size:10px;">Zusatz</span></div>`:'';
    const restBlock=_rz?`
        <div style="color:var(--text2);">${fmtMin(_rz.azMin)} <span style="color:var(--text3);font-size:10px;">Arbeitszeit</span></div>
        <div style="font-weight:700;color:${_rz.restMin<0?'var(--red)':'var(--green-strong,#15803d)'};" title="Arbeitszeit − Fahrt − Bearbeitung − Zusatztätigkeiten${_rz.restMin<0?' (Tour überbucht)':''}">${fmtMin(_rz.restMin)} <span style="font-size:10px;font-weight:600;">Restzeit</span></div>`:'';
    const bar=cnt>0?`<div style="display:flex;height:6px;border-radius:3px;overflow:hidden;gap:1px;width:120px;">
      ${zCounts.filter(z=>z.n>0).map(z=>`<div style="flex:${z.n};background:${z.farbe};" title="${z.n} ${dlEsc(z.label)}"></div>`).join('')}
      </div><div style="font-size:10px;color:var(--text3);margin-top:2px;">${zCounts.filter(z=>z.n>0).map(z=>z.n+' '+dlEsc(z.label)).join(' · ')||'–'}</div>`
      :'<span style="color:var(--text3);font-size:12px;">–</span>';
    return `<tr style="border-top:1px solid var(--border);" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
      <td style="padding:10px 16px;"><div style="width:14px;height:14px;border-radius:3px;background:${tour.color};flex-shrink:0;"></div></td>
      <td style="padding:10px 16px;font-weight:600;white-space:nowrap;">${tour.name}${tour.uebersicht?' <span style="font-size:10px;font-weight:600;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:1px 5px;vertical-align:middle;">Übersicht</span>':''}${_violCnt?` <span onclick="showTourViolations('${tour.id}')" title="Anzeigen: welche Objekte die Zuordnungsregeln verletzen" style="cursor:pointer;font-size:10px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #f59e0b;border-radius:4px;padding:1px 5px;vertical-align:middle;">⚠ ${_violCnt} Regelverstoß</span>`:(_rulesActive?' <span title="Zuordnungsregeln aktiv" style="font-size:10px;font-weight:600;color:var(--text3);border:1px solid var(--border);border-radius:4px;padding:1px 5px;vertical-align:middle;">Regeln</span>':'')}</td>
      <td style="padding:10px 16px;color:var(--text2);font-size:12px;">${tour.desc||'–'}</td>
      <td style="padding:10px 16px;text-align:center;"><input type="checkbox" ${tour.uebersicht?'checked':''} onchange="toggleTourUebersicht('${tour.id}',this.checked)" style="cursor:pointer;width:16px;height:16px;" title="Als Übersicht markieren (keine echte Tour)"></td>
      <td style="padding:10px 16px;text-align:right;font-weight:600;">${cnt}</td>
      <td style="padding:10px 16px;text-align:right;color:var(--text2);font-size:12px;">${km}</td>
      <td style="padding:10px 16px;text-align:right;font-size:12px;">
        <div style="color:var(--text2);">${driveZeit} <span style="color:var(--text3);font-size:10px;">Fahrt</span></div>
        <div style="color:var(--text2);">${bewZeit} <span style="color:var(--text3);font-size:10px;">Bew.</span></div>${zusLine}
        <div style="font-weight:600;color:var(--text);">${gesamtZeit} <span style="color:var(--text3);font-size:10px;">Gesamt</span></div>${restBlock}
      </td>
      <td style="padding:10px 16px;">
        <div style="display:flex;gap:5px;justify-content:flex-end;align-items:center;">
          <button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" data-action="karte" data-tid="${tour.id}">Karte</button>
          ${tour.uebersicht?'':`<button class="btn btn-primary" style="padding:3px 9px;font-size:11px;${rpDisStyle()}" data-action="route" data-tid="${tour.id}"${rpDisAttr()}>Route</button>`}
          ${tour.uebersicht?'':`<button class="btn btn-secondary" style="padding:3px 9px;font-size:11px;" data-action="report" data-tid="${tour.id}">Bericht</button>`}
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
    else if(action==='report')openTourReport(tid);
    else if(action==='edit')openTourModal(tid);
    else if(action==='delete')deleteTour(tid);
  };
  // Rechtsklick auf eine Tour-Zeile: kein (Browser-)Menü
  grid.oncontextmenu=e=>{ if(e.target.closest('tr')) e.preventDefault(); };

  // "Alle Routen berechnen"-Toolbar-Button je nach Reihenfolgeplanung
  const allBtn=document.getElementById('btn-calc-all-toolbar');
  if(allBtn){ const off=!getRoutePlanningEnabled()||isReadonly(); allBtn.disabled=off; allBtn.style.opacity=off?'0.45':''; allBtn.style.cursor=off?'not-allowed':''; allBtn.title=isReadonly()?'Nur Lesezugriff':(off?'Reihenfolgeplanung ist deaktiviert':''); }
}

// ─── TOUR-BERICHTE (Baukasten: Spalten/Sortierung/Druck/PDF/Excel/Vorlagen) ──
function reportFields(tourId){
  const members = (tourId!=null) ? trees.filter(t=>treeInTour(t,tourId)) : trees;
  const hasFl = members.some(t=>geomTypeOf(t)==='flaeche');
  const hasPt = members.some(t=>geomTypeOf(t)!=='flaeche');
  const f=[{key:'name',label:FL.name}];
  if(hasFl) f.push({key:'objektnummer',label:'Objektnummer'},{key:'objektart',label:'Objektart'},
    {key:'stadtteil',label:FL.stadtteil},{key:'belag',label:'Belag'},{key:'menge',label:'Fläche (m²)'},
    {key:'teilflaechen',label:'Teilflächen'},{key:'betriebshof',label:'Betriebshof'},{key:'fahrzeug',label:'Fahrzeug'},
    {key:'haeufigkeitS',label:'Häufigkeit Sommer'},{key:'haeufigkeitW',label:'Häufigkeit Winter'},
    {key:'sommerTage',label:'Reinigungstage Sommer'},{key:'winterTage',label:'Reinigungstage Winter'});
  if(hasPt) f.push({key:'baumnr',label:FL.baumnr},{key:'art',label:FL.art},{key:'stadtteil',label:FL.stadtteil},
    {key:'pflanzjahr',label:FL.pflanzjahr},{key:'pflanzzeitpunkt',label:FL.pflanzzeitpunkt},
    {key:'zustand',label:FL.zustand},{key:'wasser',label:FL.wasser});
  (customFields||[]).filter(c=>c&&c.aktiv!==false&&c.key).forEach(c=>{
    if((hasFl&&fieldAppliesTo(c,'flaeche'))||(hasPt&&fieldAppliesTo(c,'punkt'))) f.push({key:c.key,label:c.label||c.key});
  });
  const seen=new Set(); return f.filter(x=>!seen.has(x.key)&&seen.add(x.key)); // stadtteil ggf. doppelt → entfernen
}
function _repFieldLabel(k){ return (reportFields(_rep&&_rep.tourId).find(f=>f.key===k)||{}).label||k; }
function _repCell(t,k){
  if(k==='zustand') return t.zustand?rankLabel('zustand',t.zustand):'';
  if(k==='wasser') return t.wasser?rankLabel('wasser',t.wasser):'';
  return (t[k]??'').toString();
}
function _repDate(v){ if(!v) return ''; const s=(''+v).slice(0,10); const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(s); return m?`${m[3]}.${m[2]}.${m[1]}`:s; }
function _repNum(n){ return Number(n).toLocaleString('de-DE',{maximumFractionDigits:2}); }
function _repSort(tourId,arr,sort){
  if(sort==='name') return [...arr].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  if(sort==='baumnr') return [...arr].sort((a,b)=>{const x=parseFloat(a.baumnr),y=parseFloat(b.baumnr); if(!isNaN(x)&&!isNaN(y))return x-y; return (a.baumnr||'').localeCompare(b.baumnr||'');});
  let order=null;
  if(sort==='manual'){ const t=tours.find(x=>x.id===tourId); if(Array.isArray(t&&t.manualOrder)) order=t.manualOrder; }
  if(!order) order=tourOrder[tourId]||null;
  if(order){ const idx=new Map(order.map((id,i)=>[id,i])); return [...arr].sort((a,b)=>((idx.has(a.id)?idx.get(a.id):1e9)-(idx.has(b.id)?idx.get(b.id):1e9))||(a.name||'').localeCompare(b.name||'')); }
  return [...arr].sort((a,b)=>(a.name||'').localeCompare(b.name||''));
}
function reportRows(tourId,cfg){
  const list=_repSort(tourId, trees.filter(t=>treeInTour(t,tourId)), cfg.sort);
  const cols=cfg.columns||[];
  const abhakCols = (cfg.abhak&&cfg.abhak!=='none') ? ['bearbeitet von','nicht erf.','Datum'] : [];
  const headers=['Nr.', ...cols.map(_repFieldLabel), ...abhakCols];
  const rows=[], notiz=[];
  list.forEach((t,i)=>{
    let ab=[];
    if(cfg.abhak==='leer') ab=['','',''];
    else if(cfg.abhak==='digital') ab=[t.lastDriver||'', t.lastStatus==='nicht'?'X':'', _repDate(t.lastReportAt)];
    rows.push([String(i+1), ...cols.map(k=>_repCell(t,k)), ...ab]);
    notiz.push(t.notiz||'');
  });
  const sums=cols.map(k=>{ let s=0,any=false; list.forEach(t=>{const n=parseFloat(String(_repCell(t,k)).replace(',','.')); if(!isNaN(n)&&String(_repCell(t,k)).trim()!==''){s+=n;any=true;}}); return any?s:null; });
  return {headers,rows,notiz,sums,cols,abhakCols,count:list.length};
}
let _rep=null; // {tourId,cfg,order}
function openTourReport(tourId){
  const tour=tours.find(t=>t.id===tourId); if(!tour) return;
  const fields=reportFields(tourId);
  const isFl=trees.some(t=>treeInTour(t,tourId)&&geomTypeOf(t)==='flaeche');
  const tpls=currentProjectData?.reportTemplates||[];
  let cfg;
  if(tpls.length){ const t=tpls[0]; cfg={columns:[...(t.columns||[])],showNotiz:!!t.showNotiz,abhak:t.abhak||'leer',sort:t.sort||'route',title:t.title||'',sub:t.sub||''}; }
  else cfg={columns:(isFl?['name','objektart','menge']:['name','baumnr','art']).filter(k=>fields.some(f=>f.key===k)),showNotiz:true,abhak:'leer',sort:(tour.manualOrder?'manual':'route'),title:'Bemerkungen',sub:''};
  _rep={tourId,cfg}; window._rep=_rep;
  document.getElementById('report-modal').classList.add('open');
  renderReportDialog();
}
function closeReportModal(){ document.getElementById('report-modal')?.classList.remove('open'); }
function _repH(t){ return `<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px;">${t}</div>`; }
function renderReportDialog(){
  if(!_rep) return; const {tourId,cfg}=_rep; const tour=tours.find(t=>t.id===tourId); if(!tour) return;
  const fields=reportFields(tourId);
  const avail=fields.filter(f=>!cfg.columns.includes(f.key));
  const colRows=cfg.columns.map((k,i)=>`<div style="display:flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:4px;font-size:13px;">
     <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(_repFieldLabel(k))}</span>
     <button class="btn btn-secondary" style="padding:1px 7px;font-size:12px;${i===0?'opacity:.4;':''}" onclick="repMoveCol('${_jsArg(k)}',-1)">▲</button>
     <button class="btn btn-secondary" style="padding:1px 7px;font-size:12px;${i===cfg.columns.length-1?'opacity:.4;':''}" onclick="repMoveCol('${_jsArg(k)}',1)">▼</button>
     <button class="btn btn-secondary" style="padding:1px 7px;font-size:12px;color:var(--red);" onclick="repRemoveCol('${_jsArg(k)}')">✕</button>
   </div>`).join('')||'<div style="font-size:12px;color:var(--text3);margin-bottom:6px;">Keine Spalten gewählt.</div>';
  const addBlock=avail.length?`<div style="display:flex;gap:6px;margin-top:4px;"><select id="rep-addcol" class="form-control" style="flex:1;">${avail.map(f=>`<option value="${dlEsc(f.key)}">${dlEsc(f.label)}</option>`).join('')}</select><button class="btn btn-secondary" style="white-space:nowrap;" onclick="repAddCol(document.getElementById('rep-addcol').value)">+ Spalte</button></div>`:'';
  const tpls=currentProjectData?.reportTemplates||[];
  const tplOpts=`<option value="">— gespeicherte Vorlage laden —</option>`+tpls.map((t,i)=>`<option value="${i}">${dlEsc(t.name)}</option>`).join('');
  const sortOpt=(v,l)=>`<option value="${v}"${cfg.sort===v?' selected':''}>${l}</option>`;
  const abOpt=(v,l)=>`<option value="${v}"${cfg.abhak===v?' selected':''}>${l}</option>`;
  document.getElementById('report-body').innerHTML=`
   <div style="font-size:14px;font-weight:600;font-style:italic;margin-bottom:12px;">${dlEsc(tour.name)}</div>
   <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
     <div>${_repH('Spalten')}${colRows}${addBlock}</div>
     <div>${_repH('Optionen')}
       <label style="display:flex;gap:8px;align-items:center;font-size:13px;margin-bottom:10px;"><input type="checkbox" id="rep-notiz" ${cfg.showNotiz?'checked':''} onchange="repApplyFromControls()"> Bemerkungszeile (Notiz)</label>
       <div style="font-size:12px;color:var(--text2);margin-bottom:3px;">Abhak-Spalten</div>
       <select id="rep-abhak" class="form-control" style="width:100%;margin-bottom:10px;" onchange="repApplyFromControls()">${abOpt('none','keine')}${abOpt('leer','leer zum Ausfüllen')}${abOpt('digital','aus digitaler Rückmeldung')}</select>
       <div style="font-size:12px;color:var(--text2);margin-bottom:3px;">Sortierung</div>
       <select id="rep-sort" class="form-control" style="width:100%;margin-bottom:10px;" onchange="repApplyFromControls()">${sortOpt('route','Route-Reihenfolge')}${sortOpt('manual','Manuell')}${sortOpt('name',dlEsc(FL.name))}${sortOpt('baumnr',dlEsc(FL.baumnr))}</select>
       <button class="btn btn-secondary" style="width:100%;font-size:12px;" onclick="openOrderEditor()">Reihenfolge manuell bearbeiten…</button>
     </div>
   </div>
   ${_repH('Kopfzeile')}
   <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
     <input id="rep-title" class="form-control" style="flex:1;min-width:120px;" placeholder="Titel" value="${dlEsc(cfg.title||'')}" oninput="repApplyFromControls()">
     <input id="rep-sub" class="form-control" style="flex:2;min-width:200px;" placeholder="Untertitel" value="${dlEsc(cfg.sub||'')}" oninput="repApplyFromControls()">
   </div>
   <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">
     <select id="rep-template" class="form-control" style="flex:1;" onchange="loadReportTemplate(this.value)">${tplOpts}</select>
     <button class="btn btn-secondary" style="white-space:nowrap;" onclick="saveReportTemplate()">Als Vorlage speichern</button>
   </div>
   ${_repH('Vorschau')}
   <div id="rep-preview" style="overflow:auto;border:1px solid var(--border);border-radius:6px;padding:8px;background:var(--surface);max-height:280px;"></div>
   <div id="rep-order" style="display:none;"></div>
   ${_repH('Kartenausdruck der Tour')}
   <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px;">
     <span style="font-size:12px;color:var(--text2);">Format</span>
     <select id="repmap-format" class="form-control" style="width:auto;"><option value="auto">Automatisch</option><option value="quer">A4 quer</option><option value="hoch">A4 hoch</option></select>
     <span style="font-size:12px;color:var(--text2);">Hintergrund</span>
     <select id="repmap-bg" class="form-control" style="width:auto;"><option value="grau">Graustufen</option><option value="farbe">Karte (farbig)</option>${getWmsLayers().some(l=>l.type==='base'&&l.layers)?'<option value="luftbild">Luftbild</option>':''}</select>
     <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);"><input type="checkbox" id="repmap-depot" checked style="width:14px;height:14px;cursor:pointer;"> Betriebshof einbeziehen</label>
     <span style="font-size:12px;color:var(--text2);">Detailkarten</span>
     <select id="repmap-detail" class="form-control" style="width:auto;"><option value="auto">Automatisch</option><option value="aus">Keine</option><option value="2">2 Ausschnitte</option><option value="3">3</option><option value="4">4</option><option value="6">6</option></select>
     <button class="btn btn-secondary" style="margin-left:auto;" onclick="printTourMap()">🗺 Karte drucken</button>
   </div>
   <div style="font-size:11px;color:var(--text3);margin-bottom:6px;">Route + nummerierte Stopps (Betriebshof optional). In der Vorschau lässt sich Quer/Hoch umschalten und die Karte frei verschieben/zoomen. Für die Linie wird eine berechnete Route genutzt — sonst Luftlinie.</div>
   <div style="display:flex;gap:8px;margin-top:10px;justify-content:flex-end;">
     <button class="btn btn-secondary" onclick="closeReportModal()">Schließen</button>
     <button class="btn btn-secondary" onclick="exportReportExcel()">Excel</button>
     <button class="btn btn-primary" onclick="printReport()">Tabelle drucken / PDF</button>
   </div>`;
  renderReportPreview();
}
function repApplyFromControls(){
  if(!_rep) return; const cfg=_rep.cfg; const g=id=>document.getElementById(id);
  if(g('rep-notiz')) cfg.showNotiz=g('rep-notiz').checked;
  if(g('rep-abhak')) cfg.abhak=g('rep-abhak').value;
  if(g('rep-sort')) cfg.sort=g('rep-sort').value;
  if(g('rep-title')) cfg.title=g('rep-title').value;
  if(g('rep-sub')) cfg.sub=g('rep-sub').value;
  renderReportPreview();
}
function repAddCol(k){ if(_rep&&k&&!_rep.cfg.columns.includes(k)){ _rep.cfg.columns.push(k); renderReportDialog(); } }
function repRemoveCol(k){ if(_rep){ _rep.cfg.columns=_rep.cfg.columns.filter(x=>x!==k); renderReportDialog(); } }
function repMoveCol(k,dir){ if(!_rep)return; const a=_rep.cfg.columns,i=a.indexOf(k),j=i+dir; if(i<0||j<0||j>=a.length)return; [a[i],a[j]]=[a[j],a[i]]; renderReportDialog(); }
function renderReportPreview(){
  if(!_rep) return; const el=document.getElementById('rep-preview'); if(!el) return;
  const R=reportRows(_rep.tourId,_rep.cfg);
  if(!R.rows.length){ el.innerHTML='<div style="font-size:12px;color:var(--text3);">Keine Objekte in dieser Tour.</div>'; return; }
  const th=R.headers.map(h=>`<th style="border:1px solid var(--border);padding:4px 6px;text-align:left;background:var(--surface2);font-size:11px;white-space:nowrap;">${dlEsc(h)}</th>`).join('');
  let body='';
  R.rows.forEach((r,i)=>{
    body+='<tr>'+r.map(c=>`<td style="border:1px solid var(--border);padding:3px 6px;font-size:11px;">${dlEsc(c)}</td>`).join('')+'</tr>';
    if(_rep.cfg.showNotiz && R.notiz[i]) body+=`<tr><td style="border:1px solid var(--border);"></td><td colspan="${R.headers.length-1}" style="border:1px solid var(--border);padding:2px 6px;font-size:10px;font-style:italic;color:var(--text3);">${dlEsc(R.notiz[i])}</td></tr>`;
  });
  const sumRow=`<tr><td style="border:1px solid var(--border);padding:3px 6px;font-size:11px;font-weight:700;">Σ ${R.count}</td>`+R.cols.map((k,ci)=>`<td style="border:1px solid var(--border);padding:3px 6px;font-size:11px;font-weight:700;text-align:right;">${R.sums[ci]!=null?_repNum(R.sums[ci]):''}</td>`).join('')+R.abhakCols.map(()=>'<td style="border:1px solid var(--border);"></td>').join('')+'</tr>';
  el.innerHTML=`<table style="border-collapse:collapse;width:100%;"><thead><tr>${th}</tr></thead><tbody>${body}${sumRow}</tbody></table>`;
}
function printReport(){
  if(!_rep) return; const {tourId,cfg}=_rep; const tour=tours.find(t=>t.id===tourId); const R=reportRows(tourId,cfg);
  const esc=dlEsc;
  const th=R.headers.map(h=>`<th>${esc(h)}</th>`).join('');
  let body='';
  R.rows.forEach((r,i)=>{
    body+='<tr>'+r.map((c,ci)=>`<td${ci===0?' class="nr"':''}>${esc(c)}</td>`).join('')+'</tr>';
    if(cfg.showNotiz && R.notiz[i]) body+=`<tr><td></td><td colspan="${R.headers.length-1}" class="rem">${esc(R.notiz[i])}</td></tr>`;
  });
  body+=`<tr class="sum"><td>Σ ${R.count}</td>`+R.cols.map((k,ci)=>`<td class="num">${R.sums[ci]!=null?_repNum(R.sums[ci]):''}</td>`).join('')+R.abhakCols.map(()=>'<td></td>').join('')+'</tr>';
  const html=`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${esc(tour&&tour.name||'Bericht')}</title>
   <style>@page{size:landscape;margin:12mm;} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;} h1{font-size:15px;font-style:italic;margin:0 0 2px;} .sub{font-size:11px;color:#444;margin:0 0 10px;} table{border-collapse:collapse;width:100%;} th,td{border:1px solid #888;padding:4px 6px;font-size:10px;text-align:left;vertical-align:top;} th{background:#eee;} td.num,th.num{text-align:right;} .nr{text-align:right;width:26px;} .rem{font-style:italic;color:#555;font-size:9px;} tr.sum td{font-weight:bold;background:#f3f3f3;} td.num{text-align:right;}</style></head>
   <body><h1>${esc(tour&&tour.name||'Bericht')}</h1>${cfg.title||cfg.sub?`<div class="sub"><b>${esc(cfg.title||'')}</b> ${esc(cfg.sub||'')}</div>`:''}
   <table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>
   <script>window.onload=function(){window.print();}<\/script></body></html>`;
  const w=window.open('','_blank'); if(!w){ notify('Bitte Pop-ups erlauben'); return; } w.document.write(html); w.document.close();
}
function exportReportExcel(){
  if(!_rep||typeof XLSX==='undefined') { notify('Excel nicht verfügbar'); return; }
  const {tourId,cfg}=_rep; const tour=tours.find(t=>t.id===tourId); const R=reportRows(tourId,cfg);
  const head=[...R.headers, ...(cfg.showNotiz?['Bemerkung']:[])];
  const aoa=[[tour&&tour.name||'Bericht']]; if(cfg.title||cfg.sub) aoa.push([((cfg.title||'')+' '+(cfg.sub||'')).trim()]); aoa.push([]); aoa.push(head);
  R.rows.forEach((r,i)=> aoa.push(cfg.showNotiz?[...r,R.notiz[i]]:r));
  const sumRow=['Σ '+R.count]; R.cols.forEach((k,ci)=>sumRow.push(R.sums[ci]!=null?R.sums[ci]:'')); R.abhakCols.forEach(()=>sumRow.push('')); if(cfg.showNotiz) sumRow.push(''); aoa.push(sumRow);
  const ws=XLSX.utils.aoa_to_sheet(aoa); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Bericht');
  XLSX.writeFile(wb, ((tour&&tour.name||'Bericht').replace(/[^\wäöüÄÖÜß-]+/g,'_'))+'.xlsx');
}
// Teilt die geordneten Stopps in K zusammenhängende Abschnitte (für Detail-/Szenenkarten).
// mode: 'aus' = keine; 'auto' = K nach Tour-Ausdehnung; '2'/'3'/'4'/'6' = feste Anzahl.
function _repSections(stops, mode){
  if(mode==='aus' || !stops || stops.length<4) return [];
  let K;
  if(mode==='auto'){
    const la=stops.map(s=>s.lat), lo=stops.map(s=>s.lng);
    const midLat=(Math.max(...la)+Math.min(...la))/2, toR=Math.PI/180;
    const km=Math.sqrt(((Math.max(...la)-Math.min(...la))*111)**2 + ((Math.max(...lo)-Math.min(...lo))*111*Math.cos(midLat*toR))**2);
    if(km<2) return [];
    K=Math.min(6, Math.max(2, Math.ceil(km/2)));
  } else { K=parseInt(mode,10)||0; }
  K=Math.min(K, Math.floor(stops.length/2));
  if(K<2) return [];
  const per=Math.ceil(stops.length/K), secs=[];
  for(let i=0;i<stops.length;i+=per){
    const grp=stops.slice(i,i+per); if(!grp.length) continue;
    const b=L.latLngBounds(grp.map(s=>[s.lat,s.lng])); grp.forEach(s=>{ if(s.bbox) b.extend(s.bbox); }); // Flächen ganz einfassen
    secs.push({ bounds:b.pad(0.15), from:grp[0].n, to:grp[grp.length-1].n });
  }
  return secs;
}
// Kartenausdruck einer Tour: eigenes Druckfenster mit frisch gerenderter Leaflet-Karte
// (Route + nummerierte Stopps + Betriebshof), Auto-Ausrichtung, wartet auf Kacheln, dann Druck.
// Polygon-Geometrie der Flächen einer Tour (für Kartendruck) — bevorzugt geladene Layer-Geometrie, sonst Bundle.
async function _repFlaechenFeatures(tourId){
  const extIds=new Set(trees.filter(t=>treeInTour(t,tourId)&&geomTypeOf(t)==='flaeche'&&t.extId).map(t=>t.extId));
  if(!extIds.size) return [];
  let feats=[];
  if(_flaechenLayer){ try{ const gj=_flaechenLayer.toGeoJSON(); feats=(gj.features||[]).filter(f=>extIds.has(f.properties&&f.properties.extId)); }catch(_){} }
  if(!feats.length){
    try{ let url=await storage.ref(`objektgeom/${currentProjectData.orgId}/${currentProjectId}/flaechen.json`).getDownloadURL();
      url+=(url.includes('?')?'&':'?')+'v='+(currentProjectData.geomVersion||''); const r=await fetch(url); const b=await r.json();
      feats=(b.features||[]).filter(f=>extIds.has(f.properties&&f.properties.extId)); }catch(e){ console.warn('rep flaechen laden',e); }
  }
  return feats;
}
function _featBounds(f){ let b=null; const walk=cs=>{ if(!Array.isArray(cs))return; if(typeof cs[0]==='number'){ const ll=[cs[1],cs[0]]; b=b?(b.extend(ll),b):L.latLngBounds(ll,ll); return; } cs.forEach(walk); }; if(f&&f.geometry) walk(f.geometry.coordinates); return b; }
async function printTourMap(){
  if(!_rep) return; const {tourId}=_rep; const tour=tours.find(t=>t.id===tourId); if(!tour){ notify('Keine Tour'); return; }
  const stopsTrees0=trees.filter(t=>treeInTour(t,tourId)&&t.lat&&t.lng);
  const flTrees0=trees.filter(t=>treeInTour(t,tourId)&&geomTypeOf(t)==='flaeche'&&t.extId);
  if(!stopsTrees0.length && !flTrees0.length){ notify('Keine Objekte mit Koordinaten oder Flächen in dieser Tour'); return; }
  const flFeatures = flTrees0.length ? await _repFlaechenFeatures(tourId) : [];
  // Flächen-Koordinaten flach sammeln (für Ausrichtung/Bounds)
  const flLatLngs=[]; flFeatures.forEach(f=>{ const walk=cs=>{ if(!Array.isArray(cs))return; if(typeof cs[0]==='number'){ flLatLngs.push([cs[1],cs[0]]); return; } cs.forEach(walk); }; if(f.geometry) walk(f.geometry.coordinates); });
  let routeData=null;
  try{ const s=await getDoc(doc(db,'projects',currentProjectId,'routes',tourId)); if(s&&s.exists) routeData=s.data(); }catch(e){ console.warn('printTourMap route',e); }
  // Reihenfolge: manuell > gespeicherte Route > vorhandene Tour-Reihenfolge > Listenreihenfolge
  const order=(tour.manualOrder&&tour.manualOrder.length)?tour.manualOrder:((routeData&&routeData.orderIds)||tourOrder[tourId]||[]);
  let stopsTrees = order.length ? order.map(id=>stopsTrees0.find(t=>t.id===id)).filter(Boolean) : stopsTrees0;
  if(!stopsTrees.length) stopsTrees=stopsTrees0;
  const stops=stopsTrees.map((t,i)=>({lat:t.lat,lng:t.lng,n:i+1,name:t.name||''}));
  // Flächen als nummerierte Zentroid-Stopps anhängen → Nummerierung + Ausschnitte (_repSections) gelten auch für Flächen
  const _flByExt={}; flFeatures.forEach(f=>{ const e=f.properties&&f.properties.extId; if(e) _flByExt[e]=f; });
  const _flOrdered=_repSort(tourId, flTrees0, _rep.cfg&&_rep.cfg.sort);
  const _nPts=stops.length;
  _flOrdered.forEach((t,i)=>{ const bb=_featBounds(_flByExt[t.extId]); if(!bb)return; const c=bb.getCenter(); stops.push({lat:c.lat,lng:c.lng,n:_nPts+i+1,name:t.name||'',bbox:bb,fl:true}); });
  const depot=getDepot();
  const useDepot = (document.getElementById('repmap-depot')?document.getElementById('repmap-depot').checked:true) && !!(depot&&depot.lat&&depot.lng);
  const detailMode = document.getElementById('repmap-detail')?document.getElementById('repmap-detail').value:'auto';
  // Routenlinie
  let routeLatLngs=null;
  if(routeData){
    const gj=routeData.geojsonStr?(()=>{try{return JSON.parse(routeData.geojsonStr);}catch(e){return null;}})():routeData.geojson;
    if(gj){ const coords=[]; const push=c=>c.forEach(p=>coords.push([p[1],p[0]]));
      const walk=g=>{ if(!g)return; if(g.type==='FeatureCollection')g.features.forEach(f=>walk(f.geometry)); else if(g.type==='Feature')walk(g.geometry); else if(g.type==='LineString')push(g.coordinates); else if(g.type==='MultiLineString')g.coordinates.forEach(push); };
      walk(gj); if(coords.length) routeLatLngs=coords; }
  }
  if(!routeLatLngs && stopsTrees.length){ const pts=stopsTrees.map(t=>[t.lat,t.lng]); routeLatLngs=useDepot?(getDepotMode()==='round'?[[depot.lat,depot.lng],...pts,[depot.lat,depot.lng]]:[[depot.lat,depot.lng],...pts]):pts; }
  // Auto-Ausrichtung aus Bounding-Box (Stopps + Flächen; Betriebshof nur, wenn einbezogen)
  const lats=stops.map(s=>s.lat).concat(flLatLngs.map(p=>p[0])).concat(useDepot?[depot.lat]:[]);
  const lngs=stops.map(s=>s.lng).concat(flLatLngs.map(p=>p[1])).concat(useDepot?[depot.lng]:[]);
  const latSpan=(Math.max(...lats)-Math.min(...lats))||0.001, lngSpan=(Math.max(...lngs)-Math.min(...lngs))||0.001;
  const midLat=(Math.max(...lats)+Math.min(...lats))/2;
  const fmt=document.getElementById('repmap-format')?.value||'auto';
  const orient= fmt==='quer'?'landscape':fmt==='hoch'?'portrait':((lngSpan*Math.cos(midLat*Math.PI/180))>=latSpan?'landscape':'portrait');
  // Hintergrund
  const bg=document.getElementById('repmap-bg')?.value||'grau';
  let base, baseAttr=BASEMAP_ATTR;
  if(bg==='luftbild'){ const w=getWmsLayers().find(l=>l.type==='base'&&l.layers); base=w?{kind:'wms',url:w.url,layers:w.layers,version:w.version||'1.3.0'}:{kind:'xyz',url:BASEMAP_FARBE}; if(w&&w.attribution)baseAttr=w.attribution; }
  else if(bg==='farbe') base={kind:'xyz',url:BASEMAP_FARBE};
  else base={kind:'xyz',url:BASEMAP_GRAU};
  // Kennzahlen
  const driveSec=routeData?routeData.durationSec:(tourRoutes[tourId]&&tourRoutes[tourId].durationSec)||0;
  const km=(routeData&&typeof routeData.km==='number')?routeData.km:(tourRoutes[tourId]&&tourRoutes[tourId].km);
  const zus=tourZusatzMin(tour);
  const _flM2=flTrees0.reduce((s,t)=>s+(parseFloat(t.menge)||0),0);
  const kennz=`${stops.length} Objekte${_flM2?` · ${_repNum(Math.round(_flM2))} m²`:''}${km!=null?` · ${km.toFixed(1)} km`:''}${driveSec?` · ${fmtDuration(driveSec)} Fahrt`:''}${stopsTrees.length?` · gesamt ${fmtTotalTime(driveSec,stopsTrees,zus)}`:''}`;
  baseAttr=baseAttr+' · Route: OpenRouteService';
  const titleSub='Kartenausdruck · '+dlEsc(currentProjectData?.name||'')+' · '+dlEsc(dashFmtDE(new Date()));
  const color=tour.color;
  // ── In-App-Druckvorschau (kein separates Fenster; WYSIWYG A4-Rahmen) ──
  document.getElementById('mapprint-modal')?.remove();
  document.getElementById('mapprint-style')?.remove();
  closeReportModal();
  const styleEl=document.createElement('style'); styleEl.id='mapprint-style';
  const baseCss='#mapprint-modal .mp-ovl{position:absolute;z-index:600;background:rgba(255,255,255,.9);border:1px solid #999;border-radius:5px;padding:4px 9px;font-size:11px;color:#222;}'
    +'#mapprint-modal .mp-top{top:8px;left:8px;font-size:13px;}#mapprint-modal .mp-top b{font-style:italic;}#mapprint-modal .mp-top .s{font-size:10px;color:#555;margin-left:6px;}'
    +'#mapprint-modal .mp-bot{bottom:8px;left:8px;display:flex;gap:14px;}'
    +'#mapprint-modal .mp-bar{display:flex;gap:7px;align-items:center;background:#fff;padding:8px 10px;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.35);font-size:13px;}'
    +'#mapprint-modal .mp-bar button{font:inherit;padding:5px 12px;border:1px solid #bbb;border-radius:6px;background:#f3f3f3;cursor:pointer;}'
    +'#mapprint-modal .mp-bar button.prim{background:#2d6a4f;color:#fff;border-color:#2d6a4f;}#mapprint-modal .mp-bar button.act{background:#dbeafe;border-color:#1d4ed8;color:#1d4ed8;font-weight:bold;}'
    +'#mapprint-modal .leaflet-control-attribution{font-size:8px;}';
  // Druck: alles AUSSER dem Modal per display:none (visibility würde Platz belassen → Leerseiten).
  // Die Druckseite ist intern bereits in A4-Pixeln (96 dpi) gerendert; im Druck nur die
  // Bildschirm-Skalierung entfernen → die Seite belegt exakt eine A4-Seite, Karte scharf.
  // Gedruckt wird ausschliesslich das gerasterte Karten-Bild (#mapprint-out), das exakt
  // eine A4-Seite fuellt — robust gegen Drucker/Skalierung/Papier (kein Leaflet im Druck).
  const applyStyle=o=>{
    styleEl.textContent=baseCss
      +'@page{size:A4 '+o+';margin:6mm;}'
      +'@media print{html,body{height:auto!important;margin:0!important;background:#fff!important;}'
      +'body>*{display:none!important;}'
      +'#mapprint-out{display:block!important;position:static!important;inset:auto!important;width:auto!important;height:auto!important;overflow:visible!important;}'
      +'#mapprint-out .pg{width:100%;height:100vh;display:flex;align-items:center;justify-content:center;overflow:hidden;break-inside:avoid;}'
      +'#mapprint-out .pg:not(:last-child){page-break-after:always;break-after:page;}'
      +'#mapprint-out .pg img{max-width:100%;max-height:100%;object-fit:contain;}}';
  };
  applyStyle(orient); document.head.appendChild(styleEl);
  const modal=document.createElement('div'); modal.id='mapprint-modal'; modal.tabIndex=-1;
  modal.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(40,40,40,.65);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:12px;';
  modal.innerHTML='<div class="mp-bar"><span style="color:#444;margin-right:4px;">Druckvorschau — verschieben/zoomen</span>'
    +'<button id="mp-q">Quer</button><button id="mp-h">Hoch</button><span style="width:1px;height:18px;background:#ccc;"></span>'
    +'<button id="mp-fit">Tour einpassen</button><button id="mp-print" class="prim">Drucken / PDF</button><button id="mp-close">Schließen</button></div>'
    +'<div class="mp-frame" style="position:relative;">'
    +'<div class="mp-page" style="position:absolute;top:0;left:0;transform-origin:top left;background:#fff;box-shadow:0 6px 30px rgba(0,0,0,.45);overflow:hidden;">'
    +'<div id="mapprint-map" style="position:absolute;inset:0;"></div>'
    +'<div class="mp-ovl mp-top"><b>'+dlEsc(tour.name||'Tour')+'</b><span class="s">'+titleSub+'</span><span class="pl" style="margin-left:6px;font-weight:600;font-style:normal;"></span></div>'
    +'<div class="mp-ovl mp-bot"><span>● Nr. (Reihenfolge)'+(flFeatures.length?' &nbsp; ▰ Fläche':'')+(useDepot?' &nbsp; ▪ Betriebshof':'')+(routeLatLngs&&routeLatLngs.length?' &nbsp; — Route':'')+'</span><span>'+dlEsc(kennz)+'</span></div></div></div>';
  document.body.appendChild(modal);
  const page=modal.querySelector('.mp-page'), frame=modal.querySelector('.mp-frame');
  let curOrient=orient;
  // A4 druckbar (210/297 mm minus 6 mm Rand = 198/285 mm) in CSS-px @96 dpi → Karte wird in Druckauflösung gerendert
  const sizePage=()=>{
    const PW=curOrient==='landscape'?1077:748, PH=curOrient==='landscape'?748:1077; // 285mm/198mm @96dpi
    page.style.width=PW+'px'; page.style.height=PH+'px';
    const aw=window.innerWidth-40, ah=window.innerHeight-110;
    const s=Math.min(aw/PW, ah/PH, 1);
    page.style.transform='scale('+s+')';
    frame.style.width=Math.round(PW*s)+'px'; frame.style.height=Math.round(PH*s)+'px';
  };
  sizePage();
  const pmap=L.map('mapprint-map',{zoomControl:true,attributionControl:true,zoomSnap:0.25,zoomDelta:0.25,wheelPxPerZoomLevel:140});
  const pbase = base.kind==='wms' ? L.tileLayer.wms(base.url,{layers:base.layers,format:'image/png',version:base.version,transparent:false,maxZoom:20,attribution:baseAttr,crossOrigin:true}) : L.tileLayer(base.url,{maxZoom:20,maxNativeZoom:18,attribution:baseAttr,crossOrigin:true});
  pbase.addTo(pmap);
  const pb=L.latLngBounds([]);
  // Flächen-Umrisse (Nummerierung übernimmt die Stopp-Schleife unten, da Flächen als Zentroid-Stopps in `stops` stecken)
  if(flFeatures.length){
    const flLayer=L.geoJSON({type:'FeatureCollection',features:flFeatures},{renderer:L.canvas({padding:0.5}),style:{color,weight:1.5,fillColor:color,fillOpacity:0.45}}).addTo(pmap);
    try{ pb.extend(flLayer.getBounds()); }catch(_){}
  }
  if(routeLatLngs&&routeLatLngs.length){ L.polyline(routeLatLngs,{color,weight:4,opacity:.9}).addTo(pmap); if(useDepot) routeLatLngs.forEach(p=>pb.extend(p)); }
  stops.forEach(s=>{ L.marker([s.lat,s.lng],{icon:L.divIcon({className:'',html:'<div style="width:23px;height:23px;border-radius:50%;border:2px solid #fff;color:#fff;font:600 11px/19px monospace;text-align:center;box-shadow:0 0 2px rgba(0,0,0,.6);background:'+color+'">'+s.n+'</div>',iconSize:[23,23],iconAnchor:[11,11]})}).addTo(pmap); pb.extend([s.lat,s.lng]); });
  if(useDepot){ L.marker([depot.lat,depot.lng],{icon:L.divIcon({className:'',html:'<div style="width:20px;height:20px;border-radius:4px;background:#EF9F27;border:2px solid #fff;box-shadow:0 0 2px rgba(0,0,0,.5)"></div>',iconSize:[20,20],iconAnchor:[10,10]})}).addTo(pmap); pb.extend([depot.lat,depot.lng]); }
  const fit=()=>{ if(pb.isValid()) pmap.fitBounds(pb,{padding:[24,24]}); };
  pmap.whenReady(()=>setTimeout(fit,120));
  const setOrient=o=>{ curOrient=o; applyStyle(o); modal.querySelector('#mp-q').className=o==='landscape'?'act':''; modal.querySelector('#mp-h').className=o==='portrait'?'act':''; sizePage(); setTimeout(()=>{ pmap.invalidateSize(); fit(); },130); };
  setOrient(orient);
  const onResize=()=>{ sizePage(); setTimeout(()=>{ pmap.invalidateSize(); fit(); },80); };
  window.addEventListener('resize',onResize);
  const close=()=>{ window.removeEventListener('resize',onResize); try{ pmap.remove(); }catch(e){} modal.remove(); styleEl.remove(); };
  modal.querySelector('#mp-q').onclick=()=>setOrient('landscape');
  modal.querySelector('#mp-h').onclick=()=>setOrient('portrait');
  modal.querySelector('#mp-fit').onclick=fit;
  modal.querySelector('#mp-print').onclick=async ()=>{
    const btn=modal.querySelector('#mp-print'); const lbl0=btn.textContent;
    if(typeof htmlToImage==='undefined'){ notify('Druck-Modul nicht geladen'); return; }
    const sections=_repSections(stops, detailMode);
    const plEl=modal.querySelector('.mp-top .pl');
    const cap=()=>htmlToImage.toPng(page,{width:page.offsetWidth,height:page.offsetHeight,pixelRatio:2,backgroundColor:'#fff',filter:n=>!(n.classList&&n.classList.contains('leaflet-control-zoom'))});
    btn.disabled=true;
    const prevT=page.style.transform; page.style.transform='none'; pmap.invalidateSize();
    const savedCenter=pmap.getCenter(), savedZoom=pmap.getZoom();
    const imgs=[]; let rects=[];
    try{
      if(sections.length){ // A/B/C-Rahmen auf der Übersicht
        sections.forEach((sec,i)=>{
          rects.push(L.rectangle(sec.bounds,{color:'#993C1D',weight:2,dashArray:'6 4',fill:false}).addTo(pmap));
          rects.push(L.marker(sec.bounds.getNorthWest(),{interactive:false,icon:L.divIcon({className:'',html:'<div style="background:#993C1D;color:#fff;font:700 11px/1 Arial;padding:3px 6px;border-radius:4px;">'+String.fromCharCode(65+i)+'</div>',iconSize:[18,16],iconAnchor:[-1,-1]})}).addTo(pmap));
        });
      }
      btn.textContent='Erzeuge 1/'+(sections.length+1)+'…';
      if(plEl) plEl.textContent=sections.length?'· Übersicht':'';
      await new Promise(r=>setTimeout(r,500));
      imgs.push(await cap());
      rects.forEach(r=>r.remove()); rects=[];
      for(let i=0;i<sections.length;i++){
        btn.textContent='Erzeuge '+(i+2)+'/'+(sections.length+1)+'…';
        if(plEl) plEl.textContent='· Ausschnitt '+String.fromCharCode(65+i)+' · Stopps '+sections[i].from+'–'+sections[i].to;
        pmap.fitBounds(sections[i].bounds,{padding:[34,34]});
        await new Promise(r=>setTimeout(r,700));
        imgs.push(await cap());
      }
    }catch(e){ console.warn('mapprint capture',e); rects.forEach(r=>r.remove()); }
    if(plEl) plEl.textContent=''; page.style.transform=prevT; try{ pmap.setView(savedCenter,savedZoom); }catch(e){} pmap.invalidateSize();
    btn.disabled=false; btn.textContent=lbl0;
    if(!imgs.length){ notify('Karte konnte nicht erfasst werden (evtl. Luftbild ohne CORS) — bitte Graustufen wählen'); return; }
    document.getElementById('mapprint-out')?.remove();
    const out=document.createElement('div'); out.id='mapprint-out'; out.style.cssText='position:fixed;inset:0;z-index:100000;background:#fff;overflow:auto;';
    out.innerHTML=imgs.map(u=>'<div class="pg"><img src="'+u+'" style="display:block;"></div>').join('');
    document.body.appendChild(out);
    const cleanup=()=>{ out.remove(); window.removeEventListener('afterprint',cleanup); };
    window.addEventListener('afterprint',cleanup);
    setTimeout(()=>{ window.print(); setTimeout(cleanup,1800); }, 80);
  };
  modal.querySelector('#mp-close').onclick=close;
  modal.addEventListener('keydown',e=>{ if(e.key==='Escape') close(); });
  setTimeout(()=>modal.focus(),50);
}
async function saveReportTemplate(){
  if(!_rep) return; const name=(prompt('Name der Vorlage:', _rep.cfg.title||'Bericht')||'').trim(); if(!name) return;
  const c=_rep.cfg; const tpl={name,columns:[...c.columns],showNotiz:c.showNotiz,abhak:c.abhak,sort:c.sort,title:c.title||'',sub:c.sub||''};
  const list=(currentProjectData?.reportTemplates||[]).filter(t=>t.name!==name); list.push(tpl);
  try{ await saveProjectSettings({reportTemplates:list}); if(currentProjectData) currentProjectData.reportTemplates=list; renderReportDialog(); notify('✓ Vorlage gespeichert'); }
  catch(e){ notify(dlErr(e)); }
}
function loadReportTemplate(idx){
  if(idx===''||idx==null||!_rep) return; const t=(currentProjectData?.reportTemplates||[])[+idx]; if(!t) return;
  _rep.cfg={columns:[...(t.columns||[])],showNotiz:!!t.showNotiz,abhak:t.abhak||'leer',sort:t.sort||'route',title:t.title||'',sub:t.sub||''};
  renderReportDialog();
}
function openOrderEditor(){
  if(!_rep) return; const {tourId,cfg}=_rep;
  _rep.order=_repSort(tourId, trees.filter(t=>treeInTour(t,tourId)), cfg.sort).map(t=>t.id);
  renderOrderEditor();
}
function renderOrderEditor(){
  if(!_rep) return; const el=document.getElementById('rep-order'); if(!el) return;
  const ids=_rep.order||[]; const byId=new Map(trees.map(t=>[t.id,t]));
  const rows=ids.map((id,i)=>{ const t=byId.get(id)||{}; return `<div style="display:flex;align-items:center;gap:6px;padding:4px 8px;border:1px solid var(--border);border-radius:6px;margin-bottom:3px;font-size:12px;">
    <span style="width:24px;color:var(--text3);text-align:right;">${i+1}</span>
    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(t.name||'')}${t.baumnr?' · '+dlEsc(t.baumnr):''}</span>
    <button class="btn btn-secondary" style="padding:1px 7px;${i===0?'opacity:.4;':''}" onclick="repOrderMove(${i},-1)">▲</button>
    <button class="btn btn-secondary" style="padding:1px 7px;${i===ids.length-1?'opacity:.4;':''}" onclick="repOrderMove(${i},1)">▼</button>
  </div>`; }).join('');
  el.style.display='block';
  el.innerHTML=`${_repH('Manuelle Reihenfolge')}<div style="max-height:260px;overflow:auto;">${rows}</div>
    <div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-primary" onclick="saveManualOrder()">Reihenfolge speichern</button><button class="btn btn-secondary" onclick="closeOrderEditor()">Abbrechen</button></div>`;
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function repOrderMove(i,dir){ if(!_rep||!_rep.order)return; const a=_rep.order,j=i+dir; if(j<0||j>=a.length)return; [a[i],a[j]]=[a[j],a[i]]; renderOrderEditor(); }
function closeOrderEditor(){ const el=document.getElementById('rep-order'); if(el){ el.style.display='none'; el.innerHTML=''; } }
async function saveManualOrder(){
  if(!_rep) return; const {tourId}=_rep; const order=_rep.order||[];
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'tours',tourId),{manualOrder:order,orderLocked:true});
    const t=tours.find(x=>x.id===tourId); if(t){ t.manualOrder=order; t.orderLocked=true; }
    _rep.cfg.sort='manual'; closeOrderEditor(); renderReportDialog(); notify('✓ Manuelle Reihenfolge gespeichert');
  }catch(e){ notify(dlErr(e)); }
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

// Geänderte Feldbezeichnungen sofort überall im Projekt sichtbar machen:
// Formular-Labels erledigt applyFieldLabels (in loadFieldLabels); hier zusätzlich
// das offene Objekt-Detail, die Bäume-Tabelle (Spaltenköpfe) und den Eigenschaften-Filter.
function _refreshFieldLabelViews(){
  if(selectedTreeId && document.getElementById('detail-panel')?.classList.contains('open')){
    try{ openDetail(selectedTreeId); }catch(e){ console.warn('refreshLabel detail',e); }
  }
  try{ if(document.getElementById('view-baeume')) renderBaeumeTable(); }catch(e){ console.warn('refreshLabel table',e); }
  try{ if(document.getElementById('obj-filter')) renderObjFilterUI(); }catch(e){ console.warn('refreshLabel filter',e); }
}
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
  _refreshFieldLabelViews();
  notify('✓ Feldbezeichnungen gespeichert');
}
// Einzelne Feldbezeichnung setzen (für die Integration in „Felder & Listen")
async function setFieldLabel(key, value){
  if(isReadonly()||!currentProjectId) return;
  const labels={...(currentProjectData?.fieldLabels||{})};
  const v=(value||'').trim();
  if(v) labels[key]=v; else delete labels[key];
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{fieldLabels:labels});
    if(currentProjectData) currentProjectData.fieldLabels=labels;
    loadFieldLabels();
    if(currentView==='baeume' && !_fieldDetailKey) renderFieldCatalog(); // Kachel-Titel aktualisieren
    _refreshFieldLabelViews(); // offenes Detail-Panel / Tabelle / Filter mit neuen Bezeichnungen aktualisieren
    notify('✓ Bezeichnung gespeichert');
  }catch(e){ console.warn('setFieldLabel',e); notify(dlErr(e)); }
}
// Stammdaten-Feld für die Fahrer-App ein-/ausblenden (Liste am Projekt-Doc, kanonische Reihenfolge)
async function toggleMobilFeld(key, on){
  if(isReadonly()||!currentProjectId) return;
  const order=['baumnr','art','stadtteil','pflanzjahr','pflanzzeitpunkt',...customFields.map(c=>c.key)];
  let cur=Array.isArray(currentProjectData?.mobilFelder)?[...currentProjectData.mobilFelder]:['baumnr','art','pflanzjahr','pflanzzeitpunkt',...customFields.map(c=>c.key)];
  cur=cur.filter(k=>k!==key);
  if(on) cur.push(key);
  cur.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
  try{
    await updateDoc(doc(db,'projects',currentProjectId),{mobilFelder:cur});
    if(currentProjectData) currentProjectData.mobilFelder=cur;
  }catch(e){ console.warn('toggleMobilFeld',e); notify(dlErr(e)); }
}

// Reinigungshäufigkeit je Seite aus dem Zuständigkeits-Tag in art ableiten: (Stadt)→1, (Anlieger)→0.
// Schreibt das manuelle haeufigkeit-Feld (Override) gebündelt; Update existierender Docs (orgId bleibt).
async function deriveHaeufigkeitFromZustaendigkeit(){
  if(isReadonly()||!currentProjectId) return;
  const reStadt=/\(\s*stadt\s*\)/i, reAnl=/\(\s*anlieger\s*\)/i;
  const targets=[];
  for(const t of trees){
    const a=t.art||''; let h=null;
    if(reStadt.test(a)) h=1; else if(reAnl.test(a)) h=0; else continue;
    if(t.haeufigkeit!==h) targets.push({tree:t,h});
  }
  const nStadt=targets.filter(x=>x.h===1).length, nAnl=targets.filter(x=>x.h===0).length;
  if(!targets.length){ notify('Nichts zu ändern — alle (Stadt)/(Anlieger)-Objekte sind bereits gesetzt'); return; }
  if(!confirm(`Reinigungshäufigkeit aus Zuständigkeit ableiten?\n\n• ${nStadt} Objekt(e) → 1×/Woche (Stadt)\n• ${nAnl} Objekt(e) → 0 (Anlieger)\n\nInsgesamt ${targets.length} Objekt(e) werden geschrieben.`)) return;
  notify('Schreibt…');
  let done=0; const BATCH=400;
  for(let i=0;i<targets.length;i+=BATCH){
    const batch=db.batch();
    targets.slice(i,i+BATCH).forEach(({tree,h})=>{
      batch.update(db.collection('projects').doc(currentProjectId).collection('trees').doc(tree.id),{haeufigkeit:h});
      tree.haeufigkeit=h; done++;
    });
    await batch.commit();
  }
  notify(`✓ ${done} Objekt(e) aktualisiert — ${nStadt}× Stadt (1), ${nAnl}× Anlieger (0)`);
}
async function migrateTourIds(){
  if(!confirm(`tourIds-Migration für alle ${trees.length} Objekte durchführen? Einmalig nötig.`)) return;
  notify('Migration läuft…');
  let migrated=0;
  const BATCH=400;
  const _migSrc=(_allTrees&&_allTrees.length)?_allTrees:trees; // Gesamtbestand
  for(let i=0;i<_migSrc.length;i+=BATCH){
    const batch=db.batch();
    _migSrc.slice(i,i+BATCH).forEach(tree=>{
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
  const pending=((_allTrees&&_allTrees.length)?_allTrees:trees).filter(t=>!Array.isArray(t.tourIds)); // Gesamtbestand migrieren, nicht nur den Pilot-Ausschnitt
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

// ─── REINIGUNGSSYSTEME (Verwaltung) ──────────────────────────────────────────
// Je Projekt: Liste {id,name,typ(maschinell|manuell|team),speed(km/h)}. Je Tour wählbar.
// Geschwindigkeit wird gespeichert (für die spätere Routenzeit) — noch nicht in die Zeit verdrahtet.
function getReinigungssysteme(){ return Array.isArray(currentProjectData?.reinigungssysteme)?currentProjectData.reinigungssysteme:[]; }
function _rsTypLabel(t){ return {maschinell:'maschinell',manuell:'manuell',team:'Team'}[t]||t||''; }
async function _rsSave(list){
  if(!currentProjectId) return;
  if(currentProjectData) currentProjectData.reinigungssysteme=list; // optimistisch
  try{ await updateDoc(doc(db,'projects',currentProjectId),{reinigungssysteme:list}); }
  catch(e){ console.warn('Reinigungssysteme speichern',e); notify('Speichern fehlgeschlagen'); }
}
function renderReinigungssysteme(){
  const el=document.getElementById('rs-list'); if(!el) return;
  const list=getReinigungssysteme();
  if(!list.length){ el.innerHTML='<div style="font-size:12px;color:var(--text3);padding:6px 2px;">Noch keine Reinigungssysteme. Unten anlegen.</div>'; return; }
  el.innerHTML=list.map(s=>`<div style="display:flex;gap:6px;align-items:center;padding:5px 0;border-bottom:1px solid var(--border);flex-wrap:wrap;">
    <input class="form-control" value="${dlEsc(s.name||'')}" onchange="rsUpdate('${_jsArg(s.id)}','name',this.value)" style="flex:1;min-width:150px;padding:4px 8px;font-size:12px;">
    <select class="form-control" onchange="rsUpdate('${_jsArg(s.id)}','typ',this.value)" style="width:130px;padding:4px 8px;font-size:12px;">
      ${['maschinell','manuell','team'].map(t=>`<option value="${t}"${s.typ===t?' selected':''}>${_rsTypLabel(t)}</option>`).join('')}
    </select>
    <input class="form-control" type="number" min="0" step="0.5" value="${s.speed??''}" onchange="rsUpdate('${_jsArg(s.id)}','speed',this.value)" style="width:78px;padding:4px 8px;font-size:12px;" title="km/h"><span style="font-size:11px;color:var(--text3);">km/h</span>
    <button onclick="rsDelete('${_jsArg(s.id)}')" title="Entfernen" style="border:none;background:none;color:var(--red);cursor:pointer;font-size:16px;line-height:1;">×</button>
  </div>`).join('');
}
async function rsAdd(){
  const name=(document.getElementById('rs-new-name')?.value||'').trim();
  const typ=document.getElementById('rs-new-typ')?.value||'maschinell';
  const speed=parseFloat(document.getElementById('rs-new-speed')?.value)||0;
  if(!name){ notify('Bitte einen Namen eingeben'); return; }
  const id='rs_'+Date.now().toString(36)+Math.random().toString(36).slice(2,6);
  await _rsSave([...getReinigungssysteme(),{id,name,typ,speed}]);
  const n=document.getElementById('rs-new-name'); if(n) n.value=''; const sp=document.getElementById('rs-new-speed'); if(sp) sp.value='';
  renderReinigungssysteme();
}
async function rsUpdate(id,field,val){
  const list=getReinigungssysteme().map(s=>{ if(s.id!==id) return s; const v=field==='speed'?(parseFloat(val)||0):val; return {...s,[field]:v}; });
  await _rsSave(list);
  if(field==='typ') renderReinigungssysteme();
}
async function rsDelete(id){
  const s=getReinigungssysteme().find(x=>x.id===id);
  if(!await confirmByName({title:'Reinigungssystem entfernen',label:'System',name:s?.name||'',confirmText:'Entfernen'})) return;
  await _rsSave(getReinigungssysteme().filter(x=>x.id!==id));
  renderReinigungssysteme();
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
// Geschätzte Firestore-Operationskosten je Stadt. Stückpreise in € je 100.000 Operationen
// (Firestore regional, Näherung — bei Preisänderung hier anpassen). Bewusst BRUTTO: ohne
// projektweites Gratis-Kontingent und ohne Speicher/Functions/KI/Traffic → die echte Rechnung
// ist meist niedriger; gut für den Vergleich „welche Stadt verursacht wie viel".
const FS_PREIS_PRO_100K = { reads: 0.031, writes: 0.094, deletes: 0.010 };
function _usageKosten(r){ return (r.reads/1e5)*FS_PREIS_PRO_100K.reads + (r.writes/1e5)*FS_PREIS_PRO_100K.writes + (r.deletes/1e5)*FS_PREIS_PRO_100K.deletes; }
function _eur(n){ if(n>0 && n<0.01) return '<0,01 €'; return n.toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2})+' €'; }
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
  _usageRows=docs.map(d=>{ const r={stadt:orgNames[d.orgId]||d.orgId, orgId:d.orgId, reads:d.reads||0, writes:d.writes||0, deletes:d.deletes||0}; r.kosten=_usageKosten(r); return r; });
  const fmt=n=>(n||0).toLocaleString('de-DE');
  if(_usageRows.length===0){ el.innerHTML=`<div style="color:var(--text3);font-size:13px;padding:10px 0;">Noch keine Nutzungsdaten für ${ym}. (Werden gesammelt, sobald die App genutzt wird.)</div>`; return; }
  const sum=_usageRows.reduce((a,r)=>({reads:a.reads+r.reads,writes:a.writes+r.writes,deletes:a.deletes+r.deletes,kosten:a.kosten+r.kosten}),{reads:0,writes:0,deletes:0,kosten:0});
  const th='padding:9px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);';
  el.innerHTML=`<table style="width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;font-size:13px;">
    <thead><tr style="background:var(--surface2);">
      <th style="${th}text-align:left;">Stadt</th><th style="${th}">Reads</th><th style="${th}">Writes</th><th style="${th}">Deletes</th><th style="${th}" title="Geschätzte Firestore-Operationskosten — Brutto, ohne Gratis-Kontingent/Speicher/Functions/KI">≈ Kosten</th>
    </tr></thead>
    <tbody>${_usageRows.map(r=>`<tr style="border-top:1px solid var(--border);">
      <td style="padding:7px 12px;font-weight:500;">${dlEsc(r.stadt)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.reads)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.writes)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;">${fmt(r.deletes)}</td>
      <td style="padding:7px 12px;text-align:right;font-variant-numeric:tabular-nums;color:var(--text2);">${_eur(r.kosten)}</td>
    </tr>`).join('')}
    <tr style="border-top:2px solid var(--border);font-weight:700;background:var(--surface2);">
      <td style="padding:8px 12px;">Summe</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.reads)}</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.writes)}</td>
      <td style="padding:8px 12px;text-align:right;">${fmt(sum.deletes)}</td>
      <td style="padding:8px 12px;text-align:right;">${_eur(sum.kosten)}</td>
    </tr></tbody></table>
    <div style="font-size:11px;color:var(--text3);margin-top:8px;line-height:1.5;">„≈ Kosten" ist eine <b>Schätzung</b> der Firestore-Operationskosten (Reads/Writes/Deletes × Stückpreis) — <b>brutto</b>, also <u>ohne</u> das projektweite kostenlose Kontingent und <u>ohne</u> Speicher, Cloud Functions, KI und Datenverkehr. Die tatsächliche Google-Rechnung ist meist niedriger. Nützlich vor allem für den Vergleich zwischen den Städten.</div>`;
}
function exportUsageCSV(){
  const ym=document.getElementById('usage-month')?.value||_usageMonth();
  const rows=[['Stadt','orgId','Reads','Writes','Deletes','Kosten_Schaetzung_EUR','Monat'],..._usageRows.map(r=>[r.stadt,r.orgId,r.reads,r.writes,r.deletes,(r.kosten||0).toFixed(2).replace('.',','),ym])];
  const csv=rows.map(r=>r.map(x=>`"${String(x).replace(/"/g,'""')}"`).join(';')).join('\n');
  const blob=new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8;'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='nutzung_'+ym+'.csv'; a.click();
}

// ─── FAHRER-LOGINS & PINs (Mehrmandanten — nutzbar nach Auth-Aktivierung) ─────
let driverLoginsOrg = '';
let benutzerOrg = ''; // zentraler Stadt-/Mandanten-Umschalter (Benutzer-Seite)
let dtaProjectId = ''; // Schritt 4: gewähltes Projekt für Tour-Zuweisung
let dlPinEdit = null;
// Gepflegte Funktions-/Einsatzgruppen-Liste je Mandant (Dropdown im Personal — kein Freitext)
const DEFAULT_FUNKTIONEN = ['Fahrer','Reiniger','Lader','Springer','Vorarbeiter'];
let _dlFunktionen = []; // wirksame Liste in der Benutzerverwaltung (org.funktionen oder Fallback)
function _effFunktionen(orgList, persons){
  if(Array.isArray(orgList) && orgList.length) return orgList.slice();
  const fromP=[...new Set((persons||[]).map(p=>(p.funktion||'').trim()).filter(Boolean))];
  return [...new Set([...DEFAULT_FUNKTIONEN, ...fromP])];
}
// <option>-Liste für ein Funktion-Dropdown; bewahrt einen evtl. nicht (mehr) gelisteten Bestandswert.
function funktionenOptions(list, current){
  const cur=(current||'').trim(), seen=new Set();
  let opts='<option value="">— Funktion —</option>';
  (list&&list.length?list:DEFAULT_FUNKTIONEN).forEach(f=>{ f=(f||'').trim(); if(f&&!seen.has(f)){ seen.add(f); opts+=`<option value="${dlEsc(f)}"${f===cur?' selected':''}>${dlEsc(f)}</option>`; } });
  if(cur && !seen.has(cur)) opts+=`<option value="${dlEsc(cur)}" selected>${dlEsc(cur)}</option>`;
  return opts;
}
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
  let orgCode='', orgFunktionen=null; try{ const os=await db.collection('orgs').doc(org).get(); if(os.exists){ orgCode=os.data().code||''; orgFunktionen=os.data().funktionen||null; } }catch(e){}
  _dlFunktionen=_effFunktionen(orgFunktionen, drivers);
  const requested=drivers.filter(d=>d.loginRequested && !(!d.noLogin && (d.pinHash||d.role)));
  const reqBanner=requested.length?`
    <div style="border:1px solid #e9c46a;background:#fcefcb;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:700;color:#9a6700;margin-bottom:6px;">🔑 ${requested.length} App-Login angefordert (vom Einsatzleiter)</div>
      <div style="display:flex;flex-direction:column;gap:5px;">
        ${requested.map(d=>`<div style="display:flex;align-items:center;gap:8px;font-size:12px;">
          <span style="flex:1;min-width:120px;">${dlEsc(d.name)}${d.funktion?` <span style="color:var(--text3);">· ${dlEsc(d.funktion)}</span>`:''}</span>
          <button class="btn btn-primary" style="padding:4px 10px;font-size:11px;" onclick="dlEditPin('${_jsArg(d.id)}')">PIN vergeben →</button>
          <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="dlDismissLoginRequest('${_jsArg(d.id)}')">Ablehnen</button>
        </div>`).join('')}
      </div>
      <div style="font-size:11px;color:#9a6700;margin-top:6px;">„PIN vergeben" aktiviert den kostenpflichtigen Login. „Ablehnen" zieht die Anfrage zurück (Person bleibt ohne Login).</div>
    </div>`:'';
  body.innerHTML=reqBanner+`
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
      <span style="font-size:12px;font-weight:600;">Stadt-Code</span>
      <input id="dl-org-code" class="form-control" placeholder="z. B. RUESSEL" maxlength="12" value="${dlEsc(orgCode)}" style="width:140px;padding:5px 8px;font-size:12px;text-transform:uppercase;">
      <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="saveOrgCode()">Speichern</button>
      <span style="font-size:11px;color:var(--text3);">Fallback, falls Name+PIN in mehreren Städten gleich sind.</span>
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border);">
      <span style="font-size:12px;font-weight:600;">Funktionen</span>
      ${_dlFunktionen.map(f=>`<span style="display:inline-flex;align-items:center;gap:3px;font-size:12px;background:var(--surface2);padding:3px 4px 3px 9px;border-radius:99px;">${dlEsc(f)}<i onclick="dlFunktionRemove('${_jsArg(f)}')" title="entfernen" style="cursor:pointer;color:var(--text3);font-style:normal;padding:0 3px;">×</i></span>`).join('')||'<span style="font-size:11px;color:var(--text3);">noch keine</span>'}
      <input id="dl-new-funktion-name" class="form-control" placeholder="neue Funktion…" style="width:140px;padding:5px 8px;font-size:12px;" onkeydown="if(event.key==='Enter')dlFunktionAdd()">
      <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="dlFunktionAdd()">+ Funktion</button>
      <span style="font-size:11px;color:var(--text3);">Auswahl im Personal (hier & Einsatzplaner) — kein Freitext.</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;margin-bottom:10px;">
      ${drivers.length?drivers.map(dlRow).join(''):`<div style="font-size:12px;color:var(--text3);">Noch keine Personen in diesem Mandanten.</div>`}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:10px;">
      <input id="dl-new-name" class="form-control" placeholder="Name…" style="flex:1;min-width:120px;padding:5px 8px;font-size:12px;">
      <select id="dl-new-funktion" class="form-control" style="width:150px;padding:5px 8px;font-size:12px;">${funktionenOptions(_dlFunktionen,'')}</select>
      <label style="font-size:12px;display:flex;align-items:center;gap:5px;cursor:pointer;" title="Reiner Mitarbeiter-Stammsatz ohne App-Zugang"><input type="checkbox" id="dl-new-nologin" onchange="dlToggleNoLogin()" style="margin:0;cursor:pointer;"> ohne Login</label>
      <select id="dl-new-role" style="padding:5px 6px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;">${personRoleOptionsHtml('fahrer')}</select>
      <input id="dl-new-pin" class="form-control" placeholder="6-stellige PIN" inputmode="numeric" maxlength="6" style="width:120px;padding:5px 8px;font-size:12px;">
      <button class="btn btn-primary" style="padding:5px 10px;font-size:12px;white-space:nowrap;" onclick="addDriverLogin()">+ Person</button>
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
  const hasLogin = !d.noLogin && (d.pinHash || d.role);
  const inPlan = (typeof d.einsatz==='boolean')?d.einsatz:!['superadmin','orgadmin','admin','planer'].includes(d.role||'');
  const roleSel=`<select onchange="changeDriverRole('${_jsArg(d.id)}',this.value)" title="Rolle ändern" style="font-size:11px;padding:2px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">${personRoleOptionsHtml(d.role||'fahrer')}</select>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;flex-wrap:wrap;">
    <span style="flex:1;min-width:120px;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(d.name)}</span>
    <select title="Funktion / Einsatzgruppe" onchange="setDriverFunktion('${_jsArg(d.id)}',this.value)" style="width:118px;font-size:11px;padding:3px 6px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">${funktionenOptions(_dlFunktionen, d.funktion)}</select>
    <label style="font-size:11px;display:flex;align-items:center;gap:4px;cursor:pointer;color:var(--text2);" title="Im Einsatzplaner berücksichtigen"><input type="checkbox" ${inPlan?'checked':''} onchange="setDriverEinsatz('${_jsArg(d.id)}',this.checked)" style="margin:0;cursor:pointer;"> Einsatz</label>
    ${hasLogin?roleSel:(d.loginRequested?'<span style="font-size:10px;font-weight:700;color:#9a6700;background:#fcefcb;padding:2px 7px;border-radius:5px;" title="App-Login vom Einsatzleiter angefordert">🔑 Login angefordert</span>':'<span style="font-size:10px;font-weight:700;color:var(--text3);background:var(--surface2);padding:2px 7px;border-radius:5px;">ohne Login</span>')}
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="dl-pin-${dlEsc(d.id)}" class="form-control" placeholder="neue PIN" inputmode="numeric" maxlength="6" style="width:110px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveDriverPin('${_jsArg(d.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlCancelPin()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="dlEditPin('${_jsArg(d.id)}')">PIN setzen</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleDriverLoginActive('${_jsArg(d.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;color:#c0392b;" onclick="deleteDriverUi('${_jsArg(d.id)}','${_jsArg(d.name||'')}')">Löschen</button>`}
  </div>`;
}
function dlToggleNoLogin(){ const no=document.getElementById('dl-new-nologin')?.checked; ['dl-new-role','dl-new-pin'].forEach(id=>{ const el=document.getElementById(id); if(el) el.style.display=no?'none':''; }); }
async function addDriverLogin(){
  const name=(document.getElementById('dl-new-name')?.value||'').trim();
  const funktion=(document.getElementById('dl-new-funktion')?.value||'').trim();
  const nologin=!!document.getElementById('dl-new-nologin')?.checked;
  const pin=(document.getElementById('dl-new-pin')?.value||'').trim();
  const personRole=document.getElementById('dl-new-role')?.value||'fahrer';
  if(!name){ notify('Bitte Name eingeben'); return; }
  if(!nologin && !/^\d{6}$/.test(pin)){ notify('PIN muss 6-stellig sein — oder „ohne Login" wählen'); return; }
  const einsatz = nologin ? true : !['superadmin','orgadmin','admin','planer'].includes(personRole);
  try{
    const ref=await db.collection('drivers').add({orgId:driverLoginsOrg, name, nameLower:name.toLowerCase(), funktion, einsatz, role:nologin?'':personRole, noLogin:!!nologin, active:true, createdAt:serverTimestamp()});
    if(!nologin) await dlFnCall('setDriverPin',{driverId:ref.id, orgId:driverLoginsOrg, pin, personRole});
    notify('✓ '+(nologin?'Mitarbeiter (ohne Login) angelegt':'Person angelegt')); renderDriverLogins();
  }catch(e){ notify(fnErr(e)); }
}
async function setDriverFunktion(id,val){ try{ await db.collection('drivers').doc(id).set({funktion:(val||'').trim()},{merge:true}); }catch(e){ notify(dlErr(e)); } }
async function _dlSaveFunktionen(list){
  const org=driverLoginsOrg||currentOrg; if(!org){ notify('Kein Mandant gewählt'); return; }
  try{ const r=await dlFnCall('setOrgFunktionen',{orgId:org,funktionen:list}); _dlFunktionen=(r&&r.data&&r.data.funktionen)||list; notify('✓ Funktionen gespeichert'); renderDriverLogins(); }
  catch(e){ notify(fnErr(e)); }
}
async function dlFunktionAdd(){
  const inp=document.getElementById('dl-new-funktion-name'); const v=(inp?.value||'').trim();
  if(!v) return;
  if((_dlFunktionen||[]).some(f=>f.toLowerCase()===v.toLowerCase())){ notify('„'+v+'" gibt es schon'); return; }
  await _dlSaveFunktionen([...(_dlFunktionen||[]), v]);
}
function dlFunktionRemove(name){
  if(!confirm('Funktion „'+name+'" aus der Auswahl entfernen?\n\nBereits an Personen gespeicherte Werte bleiben erhalten.')) return;
  _dlSaveFunktionen((_dlFunktionen||[]).filter(f=>f!==name));
}
async function setDriverEinsatz(id,checked){ try{ await db.collection('drivers').doc(id).set({einsatz:!!checked},{merge:true}); }catch(e){ notify(dlErr(e)); } }
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
  try{ await dlFnCall('setDriverPin',{driverId,orgId:driverLoginsOrg,pin}); await db.collection('drivers').doc(driverId).set({noLogin:false, loginRequested:false},{merge:true}); dlPinEdit=null; notify('✓ PIN gesetzt — Person hat jetzt einen Login'); renderDriverLogins(); }
  catch(e){ notify(dlErr(e)); }
}
async function dlDismissLoginRequest(driverId){
  try{ await db.collection('drivers').doc(driverId).set({loginRequested:false},{merge:true}); notify('Login-Anfrage zurückgezogen'); renderDriverLogins(); }
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
      <input id="ur-new-pass" class="form-control" type="text" placeholder="Start-Passwort (min. 10)" style="width:170px;padding:5px 8px;font-size:12px;">
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
  const roleSel=`<select onchange="changeUserRole('${_jsArg(u.id)}',this.value)" title="Rolle ändern" style="font-size:11px;padding:2px 5px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">
    ${roleOptionsHtml(u.role)}</select>`;
  return `<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:var(--bg);border-radius:6px;flex-wrap:wrap;">
    <span style="flex:1;min-width:140px;font-size:13px;${active?'':'color:var(--text3);text-decoration:line-through;'}">${dlEsc(u.email||u.id)}</span>
    ${roleSel}
    <span style="font-size:10px;font-weight:700;color:${active?'var(--green)':'var(--text3)'};">${active?'aktiv':'inaktiv'}</span>
    ${editing
      ? `<input id="ur-pass-${dlEsc(u.id)}" class="form-control" type="text" placeholder="neues Passwort" style="width:150px;padding:4px 6px;font-size:12px;">
         <button class="btn btn-primary" style="padding:4px 8px;font-size:11px;" onclick="saveUserPass('${_jsArg(u.id)}')">OK</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urCancelPass()">✕</button>`
      : `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="urEditPass('${_jsArg(u.id)}')">Passwort</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="toggleUserActive('${_jsArg(u.id)}',${active})">${active?'deaktivieren':'aktivieren'}</button>
         <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;color:#c0392b;" onclick="deleteOrgUserUi('${_jsArg(u.id)}','${_jsArg(u.email||'')}')">Löschen</button>`}
  </div>`;
}
async function addOrgUser(){
  const email=(document.getElementById('ur-new-email')?.value||'').trim();
  const password=(document.getElementById('ur-new-pass')?.value||'').trim();
  const newRole=document.getElementById('ur-new-role')?.value||'planer';
  if(!email){ notify('Bitte E-Mail eingeben'); return; }
  if(password.length<10){ notify('Start-Passwort min. 10 Zeichen'); return; }
  try{ await dlFnCall('createOrgUser',{email,password,newRole,orgId:userMgmtOrg}); notify('✓ Nutzer angelegt'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function saveUserPass(uid){
  const password=(document.getElementById('ur-pass-'+uid)?.value||'').trim();
  if(password.length<10){ notify('Passwort min. 10 Zeichen'); return; }
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
  if(!await confirmByName({title:'Konto löschen', label:'Konto', name:email||uid, warn:`Konto <b style="color:var(--text);">${dlEsc(email||uid)}</b> endgültig löschen? Der Login wird entfernt. Erfasste Daten und Historie bleiben erhalten.`})) return;
  try{ await dlFnCall('deleteOrgUser',{uid}); notify('✓ Konto gelöscht'); renderUserMgmt(); }
  catch(e){ notify(fnErr(e)); }
}
async function deleteDriverUi(driverId,name){
  if(!await confirmByName({title:'Person löschen', label:'Person', name:name||driverId, warn:`<b style="color:var(--text);">${dlEsc(name||driverId)}</b> löschen? Ein evtl. PIN-Login wird entfernt. Tour-Historie bleibt erhalten.`})) return;
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
  el.innerHTML=`<div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:4px;">Rollen der Stadt: ${dlEsc(cityName)} — Änderungen gelten nur für diesen Mandanten.</div>`+
    `<div style="font-size:11px;color:var(--text3);margin-bottom:10px;">Die Modul-Häkchen hier gelten <b>mandantenweit</b> (alle Projekte der Stadt). Einzelne Projekte schaltest du unter <b>Admin → Projekte → „Module je Projekt"</b>.</div>`+
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
    <div style="font-size:10px;color:var(--text3);margin:-4px 0 10px;line-height:1.5;">↗ = Start-Verknüpfung der App im Menü „Apps". Steuert nur die Desktop-Verknüpfung — der direkte App-Zugang (PIN-Login in der jeweiligen App) bleibt davon unberührt.</div>
    <div style="display:flex;gap:8px;">
      <button class="btn btn-primary" style="padding:5px 12px;font-size:12px;" onclick="saveRole('${_jsArg(key)}')">Speichern</button>
      ${r.builtin?'':`<button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;color:#c0392b;" onclick="deleteRole('${_jsArg(key)}')">Löschen</button>`}
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
    <div style="font-size:10px;color:var(--text3);margin:-4px 0 10px;line-height:1.5;">↗ = Start-Verknüpfung der App im Menü „Apps". Steuert nur die Desktop-Verknüpfung — der direkte App-Zugang (PIN-Login in der jeweiligen App) bleibt davon unberührt.</div>
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
  if(!await confirmByName({label:'Rolle', name:rolesCache[key]?.name||key})) return;
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
    else ok=mods.some(m=>canUseModule(m)); // canUseModule = Projekt-Gate UND (Superadmin ODER Rolle)
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
  try{ const ts=await db.collection('projects').doc(dtaProjectId).collection('tours').get(); tlist=ts.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!t.uebersicht); }catch(e){} // Übersichten nicht zuweisbar
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
  const r=reasons.find(x=>x.id===id);
  if(!await confirmByName({title:'Grund löschen', label:'Grund', name:(r&&r.text)||'', confirmText:'Entfernen'})) return;
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
  const r=reasons.find(x=>x.id===id);
  if(!await confirmByName({title:'Grund löschen', label:'Grund', name:(r&&r.text)||'', confirmText:'Entfernen'})) return;
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
let _importRows=[], _importSwap=false, _impMap=null, _impLayer=null, _importNew={}, _importTourCols=[];
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
  const klasseAliases=['objektklasse','klasse'];
  const heads=(headerRow||[]).map((h,i)=>({n:_normH(h),i})).filter(x=>x.n);
  // 1) EXAKTE Treffer zuerst (Feld-Anzeigename ODER Kundenfeld-Label) — schlägt generische Aliasse,
  //    damit z. B. ein Kundenfeld „Ortsteil" nicht vom Stadtteil-Alias „ortsteil" geschluckt wird.
  for(const {n,i} of heads){
    if(baumIdAliases.includes(n)){ if(map.baumId==null) map.baumId=i; continue; }
    if(klasseAliases.includes(n)){ if(map.klasse==null) map.klasse=i; continue; }
    let hit=false;
    for(const k of Object.keys(labelFor)){ if(n===_normH(labelFor[k])){ if(map[k]==null) map[k]=i; hit=true; break; } }
    if(hit) continue;
    for(const c of customFields){ if(n===_normH(c.label)){ if(map[c.key]==null) map[c.key]=i; hit=true; break; } }
  }
  // 2) Generische Aliasse + Koordinaten für noch freie Spalten
  const used=new Set(Object.values(map));
  for(const {n,i} of heads){
    if(used.has(i)) continue;
    if(coordAliases.includes(n)){ coordCols.push(i); continue; }
    for(const k of Object.keys(labelFor)){ if((aliases[k]||[]).includes(n)){ if(map[k]==null){ map[k]=i; used.add(i); } break; } }
  }
  map._coord=coordCols.slice(0,2);
  return map;
}
// Geordnete-Listen-Zelle → stabile id. Match auf Label/Schlüssel ODER auf den hinterlegten Zahlenwert
// (z. B. Import-Zelle „2" trifft den Wert mit Zahl 2). Leer/unbekannt → 'mittel'.
function mapRankImport(fk,val){
  const raw=String(val??'').trim(); const v=_normH(raw); if(!v) return 'mittel';
  const list=rankList(fk);
  let e=list.find(x=>_normH(x.id)===v||_normH(x.label)===v);
  if(!e){ const num=parseFloat(raw.replace(',','.')); if(!isNaN(num)) e=list.find(x=>x.zahl!=null && Number(x.zahl)===num); }
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
  const headers=[FL.name,FL.stadtteil,FL.baumnr,FL.art,FL.pflanzjahr,FL.pflanzzeitpunkt,FL.zustand,FL.wasser,...customFields.map(c=>c.label),FL.notiz,'Objektklasse','Koordinate 1','Koordinate 2'];
  const ex=['Berliner Platz 23','Innenstadt','118-0044','Ahorn','2020','Frühjahr',(rankList('zustand')[0]?.label||'Gut'),(rankList('wasser')[0]?.label||'Gering'),...customFields.map(()=>''),'Beispiel-Notiz',(objektklassen[0]?.name||''),'49.4830','8.4450'];
  const ws=XLSX.utils.aoa_to_sheet([headers,ex]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Objekte');
  XLSX.writeFile(wb,'Importvorlage.xlsx');
}
// Voll-Export aller (aktiven) Objekte — spiegelbildlich zur Vorlage; Objekt-ID ermöglicht Re-Import als Update
function downloadObjectsExport(){
  const XLSX=window.XLSX; if(!XLSX){ notify('SheetJS nicht geladen'); return; }
  const headers=[FL.name,FL.stadtteil,FL.baumnr,FL.art,FL.pflanzjahr,FL.pflanzzeitpunkt,FL.zustand,FL.wasser,...customFields.map(c=>c.label),FL.notiz,'Objektklasse','Koordinate 1','Koordinate 2','Objekt-ID'];
  const list=((_allTrees&&_allTrees.length)?_allTrees:trees).filter(isActive); // Voll-Export = Gesamtbestand, auch außerhalb eines Pilot-Ausschnitts
  const _klName=t=>{ const k=objektklassen.find(x=>x.id===t.klasse); return k?k.name:''; };
  const rows=list.map(t=>{
    const kf=_klasseFelder(t), ok=key=>!kf||kf.includes(key), gt=geomTypeOf(t); // nur Felder der Objektklasse exportieren
    return [
      orTitel(t,_containerByExt)||'',
      ok('stadtteil')?(t.stadtteil||''):'', ok('baumnr')?(t.baumnr||''):'', ok('art')?(t.art||''):'',
      ok('pflanzjahr')?(t.pflanzjahr||''):'', ok('pflanzzeitpunkt')?(t.pflanzzeitpunkt||''):'',
      ok('zustand')?rankLabel('zustand',t.zustand):'', ok('wasser')?rankLabel('wasser',t.wasser):'',
      ...customFields.map(c=>(ok(c.key)&&fieldAppliesTo(c,gt))?(t[c.key]||''):''),
      ok('notiz')?(t.notiz||''):'', _klName(t), (t.lat==null?'':t.lat), (t.lng==null?'':t.lng), t.baumId||'',
    ];
  });
  const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Objekte');
  XLSX.writeFile(wb, ((currentProjectData?.name||'Objekte').replace(/[^\w-]+/g,'_'))+'_Export.xlsx');
  notify(`✓ ${list.length} Objekte exportiert`);
}
// Zahl robust parsen (auch Dezimal-Komma "52,28")
function impNum(v){ if(v==null)return NaN; if(typeof v==='number')return v; return parseFloat(String(v).trim().replace(',','.')); }
// „ja"-Zelle für Tour-Spalten (auch x/1/wahr/yes); „nein"/leer/0 = false
function _truthyImport(v){ const n=_normH(v); return n==='ja'||n==='j'||n==='x'||n==='1'||n==='true'||n==='wahr'||n==='yes'||n==='y'; }
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
  let A=Math.abs(a), B=Math.abs(b);
  if(Math.max(A,B)>1e8){ A/=1000; B/=1000; } // sehr große Werte = Millimeter (z. B. NRW-Altdaten in mm) → Meter
  // Northing = Wert im DE-Bereich (~5,2–6,1 Mio); der andere ist Easting (egal welche Spalte)
  let northing,easting;
  if(A>=4000000&&A<=7000000){ northing=A; easting=B; }
  else if(B>=4000000&&B<=7000000){ northing=B; easting=A; }
  else { northing=Math.max(A,B); easting=Math.min(A,B); }
  // Gauß-Krüger (EPSG:31466/67/68/69): Rechtswert ≈ Zone×1 Mio + 500.000 (Zone 2 ≈ 2,5 Mio … Zone 5 ≈ 5,5 Mio).
  // Bessel-Ellipsoid + Datumsshift → nur mit proj4 korrekt (alte NRW-/DE-Katasterdaten).
  if(typeof proj4!=='undefined' && easting>=1500000 && easting<5500000 && (easting%1000000)>200000 && (easting%1000000)<800000){
    const z=Math.round((easting-500000)/1000000);
    if(z>=2&&z<=5){ try{
      const def='+proj=tmerc +lat_0=0 +lon_0='+(z*3)+' +k=1 +x_0='+(z*1000000+500000)+' +y_0=0 +ellps=bessel +towgs84=598.1,73.7,418.2,0.202,0.045,-2.455,6.7 +units=m +no_defs';
      const [lng,lat]=proj4(def,'WGS84',[easting,northing]);
      if(impInDE(lat,lng)) return {lat,lng};
    }catch(_){} }
  }
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
  // Tour-Spalten: noch freie Spalte, deren Überschrift = Name einer angelegten ECHTEN Tour → ja/x/1 ordnet zu
  const _used=new Set([...Object.values(map).filter(v=>typeof v==='number'), ...(map._coord||[])]);
  const tourCols=[];
  (rows[0]||[]).forEach((h,i)=>{ if(_used.has(i)) return; const n=_normH(h); if(!n) return; const t=tours.find(x=>!x.uebersicht && _normH(x.name)===n); if(t) tourCols.push({i,id:t.id,name:t.name}); });
  _importTourCols=tourCols.map(c=>c.name);
  const parsed=[];
  const _klByName=new Map(objektklassen.map(k=>[_normH(k.name),k])); // Objektklasse-Spalte (Name) → Klasse
  for(let i=1;i<rows.length;i++){
    const row=rows[i]; if(!row||!row.length) continue;
    if(row.every(c=>c==null||String(c).trim()==='')) continue; // Leerzeile
    const {lat,lng}=(c0!=null&&c1!=null)?impCoords(impNum(row[c0]),impNum(row[c1])):{lat:null,lng:null};
    const _klRaw=String(get(row,'klasse')??'').trim(); const _kl=_klRaw?_klByName.get(_normH(_klRaw)):null;
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
    if(map.klasse!=null) o.klasse=_kl?_kl.id:''; // nur bei vorhandener Spalte (sonst bestehende Klasse beim Upsert nicht überschreiben)
    // Kundenfelder nur schreiben, wenn sie zur Objektklasse gehören (Klassen-Scope)
    const _kf=(_kl&&Array.isArray(_kl.felder)&&_kl.felder.length)?_kl.felder:null;
    customFields.forEach(c=>{ if(map[c.key]!=null && (!_kf||_kf.includes(c.key))) o[c.key]=String(row[map[c.key]]??'').trim(); });
    if(tourCols.length){ const tids=[]; for(const tc of tourCols){ if(_truthyImport(row[tc.i])) tids.push(tc.id); } o.tourIds=tids; }
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
  if(sum) sum.textContent=`${_importRows.length} Zeilen · ${withC.length} mit Koordinaten · ${_importRows.length-withC.length} ohne · ${inDE} in Deutschland`+(_importTourCols.length?` · Tour-Zuordnung über Spalten: ${_importTourCols.join(', ')}`:'');
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
    // Bestehende Objekt-IDs → Objekt (für Re-Import als Update aus dem Export-Kreislauf).
    // GESAMTBESTAND (_allTrees), nicht die Pilot-Arbeitsmenge — sonst legt ein Re-Import für
    // Objekte außerhalb des Pilot-Ausschnitts Dubletten an.
    const _impSrc=(_allTrees&&_allTrees.length)?_allTrees:trees;
    const byBaumId=new Map(_impSrc.filter(t=>t.baumId).map(t=>[t.baumId,t]));
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
        const exist = r.baumId && byBaumId.get(r.baumId);
        // Tour-Zuordnung aus ja/nein-Tag-Spalten (nur wenn Tour-Spalten vorhanden waren).
        // Übersichts-Zugehörigkeit des Bestandsobjekts bleibt erhalten (steht nie in den Import-Spalten).
        if(Array.isArray(r.tourIds)){
          const ueb = exist ? getTreeTourIds(exist).filter(id=>isOverviewTour(id)) : [];
          const merged=[...new Set([...r.tourIds, ...ueb])];
          fields.tourIds=merged; fields.tourId=merged[0]||'';
        }
        if(exist){ batch.update(colRef.doc(exist.id), fields); updated++; }
        else {
          counter++;
          batch.set(colRef.doc(),{
            datum:'',tourId:'',tourIds:[],history:[],
            ...fields,
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
// Dubletten-Prüfung (Admin): scannt die Objekt-IDs des offenen Projekts (keine Extra-Reads, nutzt geladene trees)
function checkBaumIdDuplicates(){
  // Nur AKTIVE Objekte: archivierte (per „Löschen" bei vorhandener Historie nur inaktiv gesetzte) zählen nicht.
  // GESAMTBESTAND — ein Duplikat kann über die Pilot-Grenze hinweg oder ganz außerhalb liegen.
  const act=((_allTrees&&_allTrees.length)?_allTrees:trees).filter(isActive);
  const seen=new Map();
  act.forEach(t=>{ const id=(t.baumId||'').trim(); if(id) seen.set(id,(seen.get(id)||0)+1); });
  const dups=[...seen.entries()].filter(([,n])=>n>1);
  const noId=act.filter(t=>!(t.baumId||'').trim()).length;
  const archived=trees.length-act.length;
  const archNote=archived?`\n\n(${archived} archivierte/inaktive Objekte werden nicht geprüft.)`:'';
  if(!dups.length){ notify('✓ Keine doppelten Objekt-IDs'+(noId?` · ${noId} ohne ID`:'')); return; }
  const total=dups.reduce((s,[,n])=>s+n,0);
  const list=dups.slice(0,15).map(([id,n])=>`${id} ×${n}`).join('\n');
  alert(`⚠ ${dups.length} Objekt-IDs sind doppelt vergeben (${total} betroffene aktive Objekte):\n\n${list}${dups.length>15?`\n… und ${dups.length-15} weitere`:''}${noId?`\n\nZusätzlich ${noId} Objekte ohne Objekt-ID.`:''}${archNote}`);
}
async function getNextBaumId(){
  // Atomar in einer Transaktion zählen → keine doppelten IDs bei gleichzeitigem Anlegen (zwei Planer).
  const ref=db.collection('projects').doc(currentProjectId);
  const next=await db.runTransaction(async tx=>{
    const s=await tx.get(ref);
    const n=(s.data()?.lastBaumId||0)+1;
    tx.update(ref,{lastBaumId:n});
    return n;
  });
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
    return {from:f?new Date(f+'T00:00:00'):new Date(0),to:t?new Date(t+'T23:59:59'):new Date()}; // lokale Mitternacht (nicht UTC) — sonst fällt der Starttag raus
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

  // Typ/Art (objekt-neutral, Projekt-Feldbezeichnung)
  const baumartSel=document.getElementById('ctrl-filter-baumart');
  if(baumartSel){
    const vals=[...new Set(trees.map(t=>t.art).filter(Boolean))].sort();
    baumartSel.innerHTML=`<option value="">Alle: ${dlEsc(FL.art||'Typ/Art')}</option>`+
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

// ── Controlling: welche Auswertungen sichtbar sind (projektweit, am Projekt-Doc) ──
const CTRL_WIDGETS=[
  {id:'kpi_gesamt',    label:'Gesamt',                 group:'Kennzahlen'},
  {id:'kpi_erledigt',  label:'Erledigt',               group:'Kennzahlen'},
  {id:'kpi_nicht',     label:'Nicht erledigt',         group:'Kennzahlen'},
  {id:'kpi_meldungen', label:'Meldungen gesamt',       group:'Kennzahlen'},
  {id:'kpi_fahrer',    label:'Aktive Fahrer',          group:'Kennzahlen'},
  {id:'chart_pie',     label:'Status-Verteilung',      group:'Diagramme'},
  {id:'chart_tour',    label:'Status pro Tour',        group:'Diagramme'},
  {id:'chart_zeit',    label:'Zeitverlauf',            group:'Diagramme'},
  {id:'chart_stadtteil',label:'Status pro Stadtteil',  group:'Diagramme'},
  {id:'gruende',       label:'Gründe: Nicht erledigt', group:'Tabellen'},
  {id:'einzelmeldungen',label:'Einzelmeldungen',       group:'Tabellen'},
  {id:'historie',      label:'Abgeschlossene Touren (Historie)', group:'Tabellen'},
];
// Standard: alles an, wenn nichts konfiguriert ist (rückwärtskompatibel)
function _ctrlWidgetOn(id){ const w=currentProjectData&&currentProjectData.controllingWidgets; if(!w||typeof w!=='object') return true; return w[id]!==false; }
function _applyCtrlWidgetVis(){
  document.querySelectorAll('#view-controlling [data-widget]').forEach(el=>{
    el.style.display=_ctrlWidgetOn(el.getAttribute('data-widget'))?'':'none';
  });
  const btn=document.getElementById('ctrl-widget-btn'); if(btn) btn.style.display=(currentProjectId&&!isReadonly())?'':'none';
}
async function toggleCtrlWidget(id,on){
  if(isReadonly()||!currentProjectId) return;
  const w=Object.assign({},(currentProjectData&&currentProjectData.controllingWidgets)||{});
  w[id]=!!on;
  if(currentProjectData) currentProjectData.controllingWidgets=w;   // sofort lokal wirksam
  _applyCtrlWidgetVis(); renderControlling();
  try{ await updateDoc(doc(db,'projects',currentProjectId),{controllingWidgets:w}); }
  catch(e){ console.warn('controllingWidgets speichern',e); notify(dlErr(e)); }
}
async function resetCtrlWidgets(){
  if(isReadonly()||!currentProjectId) return;
  if(currentProjectData) currentProjectData.controllingWidgets={};
  _applyCtrlWidgetVis(); renderControlling();
  const m=document.getElementById('ctrl-widget-menu'); if(m) m.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true);
  try{ await updateDoc(doc(db,'projects',currentProjectId),{controllingWidgets:{}}); }
  catch(e){ console.warn('controllingWidgets reset',e); notify(dlErr(e)); }
}
function openCtrlWidgetMenu(btn){
  const ex=document.getElementById('ctrl-widget-menu'); if(ex){ ex.remove(); return; }
  if(isReadonly()) return;
  const r=btn.getBoundingClientRect();
  const m=document.createElement('div'); m.id='ctrl-widget-menu';
  m.style.cssText=`position:fixed;top:${Math.round(r.bottom+4)}px;left:${Math.round(Math.max(8,r.right-270))}px;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px;width:270px;max-height:74vh;overflow:auto;`;
  let html=`<div style="font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);padding:4px 6px 4px;">Auswertungen (projektweit)</div>`;
  let lastGroup='';
  CTRL_WIDGETS.forEach(w=>{
    if(w.group!==lastGroup){ html+=`<div style="font-size:10px;font-weight:700;color:var(--text3);padding:8px 6px 3px;text-transform:uppercase;letter-spacing:.04em;">${w.group}</div>`; lastGroup=w.group; }
    html+=`<label style="display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:13px;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" ${_ctrlWidgetOn(w.id)?'checked':''} onchange="toggleCtrlWidget('${w.id}',this.checked)" style="width:15px;height:15px;cursor:pointer;">
      <span>${dlEsc(w.label)}</span></label>`;
  });
  html+=`<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;"><button class="btn btn-secondary" style="width:100%;padding:5px;font-size:11px;" onclick="resetCtrlWidgets()">Alle einblenden</button></div>`;
  m.innerHTML=html;
  document.body.appendChild(m);
  setTimeout(()=>{ const close=ev=>{ if(!m.contains(ev.target)&&ev.target!==btn&&!btn.contains(ev.target)){ m.remove(); document.removeEventListener('mousedown',close); } }; document.addEventListener('mousedown',close); },0);
}

// ── Soll-Ist: objekt-zentrierte Ziel-Häufigkeit (×/Woche) je Objekt ──────────
// Quellen je Typ: Fläche → haeufigkeitS/W (Saison); Seite → Reinigungsklasse/haeufigkeit;
// Punkt/Strecke → haeufigkeit. null = kein Soll hinterlegt. Basis für Meilenstein 2 (Ist-Abgleich).
function _objTypBucket(tree){
  const gt=geomTypeOf(tree);
  if(gt==='flaeche') return 'flaeche';
  if(gt==='linie') return 'strecke';
  if(tree.containerExtId) return 'seite';
  return 'punkt';
}
// „Zahl" eines gespeicherten Listenwerts holen — robust gegen ID- ODER Label-Speicherung
// (Rang-Felder speichern die ID, einfache Custom-Felder das Label).
function _zahlFor(fieldKey, stored, saison){
  if(stored==null||stored==='') return null;
  const list=rankList(fieldKey);
  const e=list.find(x=>x.id===stored) || list.find(x=>x.label===String(stored).trim());
  if(!e) return null;
  // Winter nutzt zahlWinter, wenn gepflegt (auch 0 = im Winter nicht fällig); sonst Rückfall auf Sommer-Zahl
  let raw = (saison==='winter' && e.zahlWinter!=null && e.zahlWinter!=='') ? e.zahlWinter : e.zahl;
  if(raw==null||raw==='') return null;
  const n=parseFloat(raw); return n>0?n:null;
}
// Kandidaten für das Soll-Feld: Listenfelder, deren Werte eine „Zahl" tragen
function _sollCandidateFields(){
  const keys=['zustand','wasser',...customFields.map(c=>c.key)];
  return keys.filter(k=>(rankList(k)||[]).some(e=>e&&e.zahl!=null&&e.zahl!==''))
    .map(k=>({key:k,label:(k==='zustand'?FL.zustand:k==='wasser'?FL.wasser:(customFields.find(c=>c.key===k)?.label||k))}));
}
function _sollFeldLabel(){ const k=currentProjectData&&currentProjectData.sollFeld; if(!k) return null; return k==='zustand'?FL.zustand:k==='wasser'?FL.wasser:(customFields.find(c=>c.key===k)?.label||k); }
async function setSollFeld(key){
  if(isReadonly()||!currentProjectId) return;
  if(currentProjectData) currentProjectData.sollFeld=key||'';
  try{ await updateDoc(doc(db,'projects',currentProjectId),{sollFeld:key||''}); notify(key?`✓ Soll-Feld: ${_sollFeldLabel()}`:'✓ Soll-Feld entfernt'); }
  catch(e){ console.warn('sollFeld speichern',e); notify(dlErr(e)); }
  if(currentView==='controlling') renderControlling();
  if(currentView==='sollist') renderSollIstView();
}
function sollFreqProWoche(tree, saison){
  if(!tree || _isContainer(tree)) return null;
  const sf=currentProjectData&&currentProjectData.sollFeld;
  if(sf) return _zahlFor(sf, tree[sf], saison);   // EIN projektweit designiertes Feld — für alle Objekttypen
  if(_objTypBucket(tree)==='flaeche'){
    const s=parseFloat(tree.haeufigkeitS), w=parseFloat(tree.haeufigkeitW);
    const v = saison==='winter' ? w : s;
    if(v>0) return v;
    if(s>0) return s; if(w>0) return w;   // nur eine Saison gepflegt → Rückfall
    return null;
  }
  const h=parseFloat(tree.haeufigkeit);
  if(h>0) return h;
  if(tree.containerExtId){                 // Seite ohne eigenes Feld → aus Reinigungsklasse des Abschnitts
    const c=_containerOf(tree); const rk=c&&c.reinigungsklasse?_rkById(c.reinigungsklasse):null;
    if(rk&&rk.freq){ const vals=Object.values(rk.freq).map(x=>parseFloat(x)).filter(x=>x>0); if(vals.length) return Math.max(...vals); }
  }
  return null;
}
function _sollInfo(tree, saison){
  const typ=_objTypBucket(tree);
  const v=sollFreqProWoche(tree, saison);
  let quelle=null;
  if(v!=null){
    if(currentProjectData&&currentProjectData.sollFeld) quelle='sollfeld';
    else if(typ==='flaeche') quelle='sommerwinter';
    else if(typ==='seite'){ const c=_containerOf(tree); quelle=(c&&c.reinigungsklasse)?'reinigungsklasse':'haeufigkeit'; }
    else quelle='haeufigkeit';
  }
  return {typ, hasSoll:v!=null, soll:v, quelle};
}
function renderSollDatenlage(mountId, list, saison){
  const el=document.getElementById(mountId||'si-datenlage'); if(!el) return;
  saison = saison || ((typeof saisonFor==='function')?saisonFor(new Date().toISOString().slice(0,10)):'sommer');
  list = list || trees.filter(t=>isActive(t)&&!_isContainer(t));
  const TYPES=[{key:'punkt',label:'Punkte'},{key:'seite',label:'Abschnitts-Seiten'},{key:'flaeche',label:'Flächen'},{key:'strecke',label:'Strecken'}];
  const QL={haeufigkeit:'Häufigkeit',reinigungsklasse:'Reinigungsklasse',sommerwinter:'Sommer/Winter',sollfeld:_sollFeldLabel()||'Soll-Feld'};
  const buckets={}; TYPES.forEach(t=>buckets[t.key]={n:0,soll:0,q:{}});
  list.forEach(t=>{ const info=_sollInfo(t,saison); const b=buckets[info.typ]; if(!b) return; b.n++; if(info.hasSoll){ b.soll++; b.q[info.quelle]=(b.q[info.quelle]||0)+1; } });
  const total=list.length, withSoll=TYPES.reduce((a,t)=>a+buckets[t.key].soll,0), ohne=total-withSoll;
  const pctAll=total?Math.round(withSoll/total*100):0;
  if(!total){ el.innerHTML='<div style="color:var(--text3);font-size:13px;padding:6px 0;">Keine Objekte im aktuellen Filter.</div>'; return; }
  const kpi=`<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:12px;">
    ${[['Objekte gesamt',total.toLocaleString('de-DE'),'var(--text)'],['mit Soll',`${withSoll.toLocaleString('de-DE')} · ${pctAll}%`,'var(--green)'],['ohne Soll',`${ohne.toLocaleString('de-DE')} · ${100-pctAll}%`,'var(--amber)']]
      .map(k=>`<div style="background:var(--surface2);border-radius:8px;padding:8px 10px;"><div style="font-size:11px;color:var(--text3);">${k[0]}</div><div style="font-size:18px;font-weight:700;color:${k[2]};">${k[1]}</div></div>`).join('')}
  </div>`;
  const legend=`<div style="display:flex;gap:16px;margin-bottom:4px;font-size:11px;color:var(--text2);">
    <span style="display:flex;align-items:center;gap:6px;"><span style="width:11px;height:11px;border-radius:3px;background:var(--green);"></span>Soll hinterlegt</span>
    <span style="display:flex;align-items:center;gap:6px;"><span style="width:11px;height:11px;border-radius:3px;background:#d9d4c8;"></span>kein Soll</span></div>`;
  const rows=TYPES.filter(t=>buckets[t.key].n>0).map(t=>{
    const b=buckets[t.key], pct=Math.round(b.soll/b.n*100);
    const chips=Object.keys(b.q).length
      ? Object.entries(b.q).map(([k,n])=>`<span style="display:inline-block;margin:5px 5px 0 0;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--surface2);color:var(--text2);border:1px solid var(--border);">${QL[k]||k}: ${n}</span>`).join('')
      : `<span style="display:inline-block;margin-top:5px;font-size:11px;padding:2px 8px;border-radius:6px;background:#fef3c7;color:#b45309;">kein Soll hinterlegt</span>`;
    return `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-top:1px solid var(--border);">
      <div style="width:200px;flex:none;">
        <div style="font-size:13px;font-weight:600;">${t.label}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:1px;">${b.n.toLocaleString('de-DE')} Objekte</div>
        <div>${chips}</div>
      </div>
      <div style="flex:1;"><div style="height:14px;border-radius:7px;overflow:hidden;background:#d9d4c8;"><div style="width:${pct}%;height:100%;background:var(--green);"></div></div></div>
      <div style="width:90px;flex:none;text-align:right;"><div style="font-size:15px;font-weight:700;">${pct} %</div><div style="font-size:11px;color:var(--text3);">mit Soll</div></div>
    </div>`;
  }).join('');
  const pB=buckets.punkt;
  const warn=(pB.n>0 && pB.soll/pB.n<0.5)
    ? `<div style="margin-top:12px;padding:9px 12px;background:#fef3c7;border-radius:8px;font-size:12px;color:#92400e;">Bei Punkten ist überwiegend kein Soll hinterlegt. Hier zuerst die Zielhäufigkeit pflegen, bevor der Erfüllungsgrad aussagekräftig ist.</div>`
    : '';
  const sf=_sollFeldLabel();
  const srcBanner = sf
    ? `<div style="font-size:12px;color:var(--text2);margin-bottom:10px;">Soll-Quelle: Feld <b>${dlEsc(sf)}</b> — Häufigkeit (×/Woche) je Wert, saisonabhängig (aktuell <b>${saison==='winter'?'Winter':'Sommer'}</b>). Projektweit für alle Objekttypen.</div>`
    : `<div style="font-size:12px;color:#92400e;background:#fef3c7;border-radius:8px;padding:8px 12px;margin-bottom:10px;">Kein Soll-Feld festgelegt. Unter Verwaltung → Felder &amp; Listen ein Feld als „Soll-Häufigkeit" wählen. Solange greift die typweise Ersatzlogik (Häufigkeit / Reinigungsklasse / Sommer-Winter).</div>`;
  el.innerHTML=srcBanner+kpi+legend+rows+warn;
}

// ── Soll-Ist: eigener Reiter (Auswertung → Soll-Ist) ─────────────────────────
// Plan = eingeplante Häufigkeit/Woche = Summe der Wochen-Einsätze aller aktiven Touren des Objekts.
function _tourWeeklyOcc(tour,saison){
  if(!tour || isOverviewTour(tour.id)) return 0;
  if(tour.saison && tour.saison!==saison) return 0;   // Saison-Tour zählt nur in ihrer Saison
  const iv=tour.interval||'';
  if(iv==='bedarf') return 0;
  if(iv==='taeglich') return 5;         // Mo–Fr
  if(iv==='woechentlich') return 1;
  if(iv==='14taeglich') return 0.5;
  if(iv==='4woechentlich') return 0.25;
  return 1;                              // kein Intervall / Bestandstour = 1×/Woche
}
function _seasonDayCounts(from,to){
  let s=0,w=0,guard=0; const end=new Date(to+'T00:00:00');
  for(let d=new Date(from+'T00:00:00'); d<=end && guard<1200; d.setDate(d.getDate()+1),guard++){
    const iso=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    (saisonFor(iso)==='winter'?w++:s++);
  }
  return {s,w};
}
// Ist je Objekt = Anzahl „Erledigt"-Meldungen im Zeitraum — GENAU wie der Verlauf-Tab zählt:
// status==='bewaessert' ODER Notiz-Eintrag ohne Status ({date,note}). Mehrfach am selben Tag zählt einzeln.
function _siIstCount(from,to){
  const inR=d=>d&&(!from||d>=from)&&(!to||d<=to), ist={};
  trees.forEach(t=>{
    if(!isActive(t)) return;
    let n=0; const seenDays=new Set();
    (t.history||[]).forEach(h=>{
      if(!h.date) return;
      if(h.status!=='bewaessert') return;   // Ist zählt nur echte Erledigungen (jede Meldung trägt status)
      const d=(''+h.date).slice(0,10);
      if(inR(d)){ n++; seenDays.add(d); }
    });
    if(t.lastStatus==='bewaessert' && t.lastReportAt){                   // Live-Status, falls noch nicht in history
      const d=(''+t.lastReportAt).slice(0,10);
      if(inR(d) && !seenDays.has(d)) n++;
    }
    if(n) ist[t.id]=n;
  });
  return ist;
}
const _siState={period:'custom',from:'',to:'',gebiet:'',typ:'',q:'',planStatus:'',istStatus:'',aggDim:'gebiet',showAll:false};
function _siEnsureCustomDates(){
  if(_siState.period!=='custom') return;
  const day=d=>d.toISOString().slice(0,10), today=new Date();
  if(!_siState.from){ const f=new Date(today); f.setDate(f.getDate()-29); _siState.from=day(f); }
  if(!_siState.to) _siState.to=day(today);
}
function siSet(field,val){
  _siState[field]=val;
  if(field==='period'){
    const cf=document.getElementById('si-custom'); if(cf) cf.style.display=(val==='custom')?'flex':'none';
    if(val==='custom'){   // Datumsfelder sinnvoll vorbelegen (letzte 30 Tage), falls leer
      _siEnsureCustomDates();
      const fi=document.getElementById('si-from'), ti=document.getElementById('si-to');
      if(fi) fi.value=_siState.from; if(ti) ti.value=_siState.to;
    }
  }
  renderSollIstView();
}
function siSearch(v){ _siState.q=v||''; renderSollIstView(); }
// KPI-Schnellfilter (Karte anklicken → toggelt den Status-Filter)
function siQuickFilter(field,val){
  _siState[field]=(_siState[field]===val?'':val);
  const sel=document.getElementById(field==='planStatus'?'si-planstatus':'si-iststatus'); if(sel) sel.value=_siState[field];
  renderSollIstView();
}
function _siApplyStatus(list){ return list.filter(r=>(!_siState.planStatus||r.planStatus===_siState.planStatus)&&(!_siState.istStatus||r.istStatus===_siState.istStatus)); }
function siResetFilters(){
  _siState.gebiet=''; _siState.typ=''; _siState.planStatus=''; _siState.istStatus=''; _siState.q=''; _siState.showAll=false;
  ['si-gebiet','si-typ','si-planstatus','si-iststatus'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  const s=document.getElementById('si-search'); if(s) s.value='';
  renderSollIstView();
}
function _siObjName(t){ const c=t.containerExtId?_containerOf(t):null; return c?((c.name||'–')+' · '+_elemLabel(t)):(t.name||'–'); }
function _siBaseList(){
  const q=(_siState.q||'').trim().toLowerCase();
  return trees.filter(t=>isActive(t)&&!_isContainer(t))
    .filter(t=>!_siState.gebiet || (t.stadtteil||'')===_siState.gebiet)
    .filter(t=>!_siState.typ || _objTypBucket(t)===_siState.typ)
    .filter(t=>!q || matchTerms((t.name||'')+' '+(t.stadtteil||'')+' '+(t.baumId||''), q));
}
// Kernberechnung: je Objekt Soll (×/Wo + Zeitraum), Plan (Touren) und Ist (Meldungen)
function _siCompute(){
  const r=kiComputeRange(_siState.period,_siState.from,_siState.to);
  let from=r.from,to=r.to;
  if(!from||!to){ const m=kiComputeRange('month'); from=m.from; to=m.to; }   // „Gesamt" nicht sinnvoll → Monat
  const dc=_seasonDayCounts(from,to), nS=dc.s, nW=dc.w;
  const refSaison=nW>nS?'winter':'sommer';
  const ist=_siIstCount(from,to);
  const rows=_siBaseList().map(t=>{
    const sS=sollFreqProWoche(t,'sommer'), sW=sollFreqProWoche(t,'winter');
    const hasSoll=sS!=null||sW!=null;
    const o={t,name:_siObjName(t),gebiet:t.stadtteil||'—',typ:_objTypBucket(t),hasSoll};
    if(!hasSoll) return o;
    o.sollWo=(refSaison==='winter')?(sW!=null?sW:sS):(sS!=null?sS:sW);
    o.sollP=(sS||0)*nS/7 + (sW||0)*nW/7;
    o.plan=realTourIds(t).reduce((a,id)=>a+_tourWeeklyOcc(tours.find(x=>x.id===id),refSaison),0);
    o.istN=ist[t.id]||0;
    o.planStatus=(o.sollWo>0)?(o.plan<o.sollWo-1e-6?'unter':(o.plan>o.sollWo+1e-6?'ueber':'ok')):null;
    o.grad=o.sollP>0?o.istN/o.sollP:null;
    o.istStatus=(o.grad==null)?null:(o.grad<0.85?'unter':(o.grad>1.15?'ueber':'ok'));
    return o;
  });
  return {rows,from,to,nS,nW,refSaison};
}
function initSollIstView(){
  if(!currentProjectId){ const b=document.getElementById('si-body'); if(b) b.innerHTML='<div style="padding:24px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; }
  const geb=[...new Set(trees.filter(t=>isActive(t)&&!_isContainer(t)).map(t=>t.stadtteil).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const gSel=document.getElementById('si-gebiet'); if(gSel) gSel.innerHTML=`<option value="">Alle ${dlEsc(FL.stadtteil)}</option>`+geb.map(g=>`<option value="${dlEsc(g)}"${_siState.gebiet===g?' selected':''}>${dlEsc(g)}</option>`).join('');
  const pSel=document.getElementById('si-period'); if(pSel) pSel.value=_siState.period;
  const tSel=document.getElementById('si-typ'); if(tSel) tSel.value=_siState.typ;
  const psSel=document.getElementById('si-planstatus'); if(psSel) psSel.value=_siState.planStatus;
  const isSel=document.getElementById('si-iststatus'); if(isSel) isSel.value=_siState.istStatus;
  _siEnsureCustomDates();
  const cf=document.getElementById('si-custom'); if(cf) cf.style.display=(_siState.period==='custom')?'flex':'none';
  const fi=document.getElementById('si-from'); if(fi) fi.value=_siState.from||'';
  const ti=document.getElementById('si-to'); if(ti) ti.value=_siState.to||'';
  renderSollIstView();
}
function renderSollIstView(){
  const hintEl=document.getElementById('si-hint');
  if(hintEl) hintEl.innerHTML=_sollFeldLabel()?`Soll-Feld: <b>${dlEsc(_sollFeldLabel())}</b>`:`<span style="color:#b45309;">Kein Soll-Feld gewählt — Verwaltung → Felder &amp; Listen</span>`;
  const clrEl=document.getElementById('si-clear'); if(clrEl) clrEl.style.display=(_siState.gebiet||_siState.typ||_siState.planStatus||_siState.istStatus||_siState.q||_siState.showAll)?'':'none';
  const {rows,nS,nW,refSaison}=_siCompute();
  const withSoll=rows.filter(r=>r.hasSoll), kein=rows.length-withSoll.length;
  const TL={punkt:'Punkt',seite:'Seite',flaeche:'Fläche',strecke:'Strecke'};
  const planEval=withSoll.filter(r=>r.planStatus), unterplant=planEval.filter(r=>r.planStatus==='unter').length;
  const planPct=planEval.length?Math.round((planEval.length-unterplant)/planEval.length*100):0;
  const istEval=withSoll.filter(r=>r.istStatus);
  const sumIst=istEval.reduce((a,r)=>a+r.istN,0), sumSoll=istEval.reduce((a,r)=>a+r.sollP,0);
  const istPct=sumSoll>0?Math.round(sumIst/sumSoll*100):0, unterIst=istEval.filter(r=>r.istStatus==='unter').length;
  const kpiEl=document.getElementById('si-kpis');
  const kpiDefs=[
    {l:'Objekte mit Soll',v:withSoll.length.toLocaleString('de-DE'),c:'var(--text)'},
    {l:'Plan erfüllt',v:planPct+' %',c:'var(--green)'},
    {l:'Ø Ist-Erfüllung',v:istPct+' %',c:'var(--text)'},
    {l:'unterplant',v:unterplant.toLocaleString('de-DE'),c:'var(--amber)',qf:['planStatus','unter']},
    {l:'unter Ist',v:unterIst.toLocaleString('de-DE'),c:'var(--red)',qf:['istStatus','unter']},
  ];
  if(kpiEl) kpiEl.innerHTML=kpiDefs.map(k=>{
    const active=k.qf && _siState[k.qf[0]]===k.qf[1];
    return `<div ${k.qf?`onclick="siQuickFilter('${k.qf[0]}','${k.qf[1]}')" title="Auf ${k.l} filtern" style="cursor:pointer;`:'style="'}background:var(--surface2);border-radius:8px;padding:9px 11px;${active?`box-shadow:inset 0 0 0 2px ${k.c};`:''}"><div style="font-size:11px;color:var(--text3);">${k.l}${active?' ✓':''}</div><div style="font-size:19px;font-weight:700;color:${k.c};">${k.v}</div></div>`;
  }).join('');
  const chip=(s,type)=>{ if(!s) return '<span style="color:var(--text3);">–</span>'; const c=(type==='plan'?{ok:'var(--green)',unter:'var(--amber)',ueber:'var(--blue)'}:{ok:'var(--green)',unter:'var(--red)',ueber:'var(--blue)'})[s]; const lbl={ok:'ok',unter:'unter',ueber:'über'}[s]; return `<span style="display:inline-block;padding:1px 7px;border-radius:6px;font-size:11px;font-weight:600;background:${c}22;color:${c};">${lbl}</span>`; };
  const tableSet=_siApplyStatus(withSoll);
  const sorted=[...tableSet].sort((a,b)=>{ const ga=a.grad==null?9:a.grad, gb=b.grad==null?9:b.grad; if(ga!==gb) return ga-gb; return (a.planStatus==='unter'?0:1)-(b.planStatus==='unter'?0:1); });
  const cap=600, shown=sorted.slice(0,cap);
  const statusActive=_siState.planStatus||_siState.istStatus;
  const trows=shown.map(r=>`<tr data-treeid="${r.t.id}" style="border-top:1px solid var(--border);cursor:pointer;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
    <td style="padding:7px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(r.name)}">${dlEsc(r.name)}</td>
    <td style="padding:7px 10px;color:var(--text2);white-space:nowrap;">${dlEsc(r.gebiet)}</td>
    <td style="padding:7px 10px;color:var(--text2);">${TL[r.typ]||r.typ}</td>
    <td style="padding:7px 10px;text-align:right;font-weight:600;">${+r.sollWo.toFixed(2)}</td>
    <td style="padding:7px 10px;text-align:right;white-space:nowrap;">${+r.plan.toFixed(2)} ${chip(r.planStatus,'plan')}</td>
    <td style="padding:7px 10px;text-align:right;white-space:nowrap;" title="Ist: ${r.istN} Erledigt-Meldungen im Zeitraum · Soll: ${r.sollP.toFixed(2)} (= ${+r.sollWo.toFixed(2)}×/Woche × Wochen im Zeitraum)">${r.istN} / ${Math.round(r.sollP)} ${chip(r.istStatus,'ist')}</td>
  </tr>`).join('');
  const tableEl=document.getElementById('si-table');
  const _hasFilter=(_siState.gebiet||_siState.typ||_siState.planStatus||_siState.istStatus||_siState.q);
  if(tableEl && !_hasFilter && !_siState.showAll){
    tableEl.innerHTML=`<div style="text-align:center;padding:26px 10px;color:var(--text3);">
      <div style="font-size:13px;margin-bottom:10px;">${withSoll.length.toLocaleString('de-DE')} Objekte mit Soll — für die Übersicht ausgeblendet. Oben <b>filtern</b> oder <b>suchen</b>, um gezielt Objekte zu sehen.</div>
      <button class="btn btn-secondary" onclick="siSet('showAll',true)" style="padding:6px 14px;font-size:12px;">Alle ${withSoll.length.toLocaleString('de-DE')} anzeigen</button>
    </div>`;
  } else if(tableEl){
    tableEl.innerHTML=`<div style="font-size:12px;color:var(--text3);margin:2px 0 6px;">${statusActive?`${sorted.length.toLocaleString('de-DE')} von ${withSoll.length.toLocaleString('de-DE')} (Status-Filter aktiv)`:`${withSoll.length.toLocaleString('de-DE')} Objekte mit Soll`}${kein?` · ${kein.toLocaleString('de-DE')} ohne Soll`:''}${shown.length<sorted.length?` · Anzeige auf ${cap} begrenzt`:''} — Zeitraum ${nS+nW} Tage (${nS} Sommer/${nW} Winter). Klick → Karte.</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="background:var(--surface2);">${['Objekt',FL.stadtteil,'Typ','Soll/Wo','Plan (Touren)','Ist / Soll'].map((h,i)=>`<th style="padding:7px 10px;text-align:${i>=3?'right':'left'};font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${dlEsc(h)}</th>`).join('')}</tr></thead>
        <tbody>${trows||`<tr><td colspan="6" style="padding:16px;color:var(--text3);">Keine Objekte mit Soll im Filter.</td></tr>`}</tbody>
      </table>`;
    tableEl.onclick=e=>{ const tr=e.target.closest('[data-treeid]'); if(tr){ selectTree(tr.dataset.treeid); switchView('karte'); } };
  }
  const aggEl=document.getElementById('si-agg');
  if(aggEl){
    const dimName=r=>{ if(_siState.aggDim==='typ') return TL[r.typ]||r.typ; if(_siState.aggDim==='tour'){ const pt=primaryTour(r.t); return pt?pt.name:'— ohne Tour —'; } return r.gebiet; };
    const groups={};
    withSoll.forEach(r=>{ if(!r.istStatus) return; const g=dimName(r); const G=groups[g]||(groups[g]={ist:0,soll:0,unter:0}); G.ist+=r.istN; G.soll+=r.sollP; if(r.istStatus==='unter') G.unter++; });
    const gcol=g=>g>=85?'var(--green)':g>=70?'var(--amber)':'var(--red)';
    const arr=Object.entries(groups).map(([name,G])=>({name,grad:G.soll>0?Math.round(G.ist/G.soll*100):null,unter:G.unter})).sort((a,b)=>(a.grad==null?999:a.grad)-(b.grad==null?999:b.grad)).slice(0,15);
    aggEl.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin:0 0 8px;">
        <span style="font-size:12px;font-weight:600;">Ist-Erfüllung je</span>
        <select onchange="siSet('aggDim',this.value)" style="padding:4px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">
          ${[['gebiet',FL.stadtteil||'Gebiet'],['tour','Tour'],['typ','Objekttyp']].map(o=>`<option value="${o[0]}"${_siState.aggDim===o[0]?' selected':''}>${dlEsc(o[1])}</option>`).join('')}
        </select></div>`+
      (arr.length?arr.map(G=>`<div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-top:1px solid var(--border);">
          <div style="width:170px;flex:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(G.name)}">${dlEsc(G.name)}</div>
          <div style="flex:1;height:10px;border-radius:5px;overflow:hidden;background:#d9d4c8;">${G.grad!=null?`<div style="width:${Math.min(100,G.grad)}%;height:100%;background:${gcol(G.grad)};"></div>`:''}</div>
          <div style="width:120px;flex:none;text-align:right;font-size:12px;">${G.grad!=null?`<b>${G.grad} %</b>${G.unter?` <span style="color:var(--text3);">· ${G.unter} unter</span>`:''}`:'–'}</div>
        </div>`).join(''):'<div style="color:var(--text3);font-size:12px;">Keine bewertbaren Daten im Zeitraum.</div>');
  }
  renderSollDatenlage('si-datenlage', _siBaseList(), refSaison);
}
function siExportCsv(){
  const {rows}=_siCompute(); const withSoll=_siApplyStatus(rows.filter(r=>r.hasSoll));
  if(!withSoll.length){ notify('Keine Objekte im aktuellen Filter zum Export'); return; }
  const TL={punkt:'Punkt',seite:'Seite',flaeche:'Fläche',strecke:'Strecke'};
  const cell=v=>{ const s=''+(v==null?'':v); return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const line=a=>a.map(cell).join(';');
  const head=['Objekt',FL.stadtteil,'Typ','Soll_pro_Woche','Plan_Touren','Plan_Status','Ist','Soll_Zeitraum','Ist_Status'];
  const body=withSoll.map(r=>line([r.name,r.gebiet,TL[r.typ]||r.typ,+r.sollWo.toFixed(2),+r.plan.toFixed(2),r.planStatus||'',r.istN,Math.round(r.sollP),r.istStatus||'']));
  const csv='﻿'+[line(head),...body].join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download='Soll-Ist_'+(currentProjectData?.name||'Projekt').replace(/[^\wäöüÄÖÜß-]+/g,'_')+'_'+new Date().toISOString().slice(0,10)+'.csv';
  a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ── Datenqualität (Auswertung → Datenqualität): Lücken & Dubletten prüfen ──
let _dqCat=null;
function _dqChecks(){
  const act=trees.filter(t=>isActive(t)&&!_isContainer(t));
  const all=trees.filter(t=>!_isContainer(t));
  // Reine Koordinaten-Gleichheit ist KEIN Dubletten-Signal: in Projekten wie „Verpflichtungen" liegen
  // mehrere echte Datensätze bewusst am selben Punkt. Verlässlich sind nur doppelte Objekt-IDs (Kachel unten).
  const idCount={};
  act.forEach(t=>{ const k=(t.baumId||'').trim(); if(k) idCount[k]=(idCount[k]||0)+1; });
  const hasSoll=t=>sollFreqProWoche(t,'sommer')!=null||sollFreqProWoche(t,'winter')!=null;
  // Unplausible Koordinaten: weit vom Schwerpunkt aller Objekte (Import-/Tippfehler, anderer Ort, 0/0)
  const geo=act.filter(t=>t.lat&&t.lng); let cy=0,cx=0,outSet=new Set();
  if(geo.length>=8){
    cy=geo.reduce((a,m)=>a+m.lat,0)/geo.length; cx=geo.reduce((a,m)=>a+m.lng,0)/geo.length;
    const dists=geo.map(m=>haversine(m.lat,m.lng,cy,cx));
    const med=[...dists].sort((a,b)=>a-b)[Math.floor(dists.length/2)]||0;
    geo.forEach((m,i)=>{ if(dists[i]>Math.max(10, med*8)) outSet.add(m.id); });   // >10 km UND >8× Median
  }
  return [
    {key:'gps',      label:'Ohne Koordinaten',      items:act.filter(t=>!t.lat&&!t.lng ? !_routePoint(t) : (!t.lat||!t.lng))}, // Flächen/Strecken mit Geometrie haben einen Ort — kein Mangel
    {key:'coordbad', label:'Unplausible Koordinaten',items:act.filter(t=>outSet.has(t.id)), detail:t=>Math.round(haversine(t.lat,t.lng,cy,cx))+' km vom Zentrum'},
    {key:'id',       label:'Ohne Objekt-ID',        items:act.filter(t=>!(t.baumId||'').trim())},
    {key:'iddup',    label:'Doppelte Objekt-ID',    items:act.filter(t=>{const k=(t.baumId||'').trim();return k&&idCount[k]>1;}), detail:t=>'ID '+(t.baumId||'')},
    {key:'soll',     label:'Ohne Soll-Häufigkeit',  items:act.filter(t=>!hasSoll(t))},
    {key:'tour',     label:'Keiner Tour zugeordnet',items:act.filter(t=>realTourIds(t).length===0)},
    {key:'art',      label:'Ohne '+FL.art,          items:act.filter(t=>!(t.art||'').trim())},
    {key:'stadtteil',label:'Ohne '+FL.stadtteil,    items:act.filter(t=>!(t.stadtteil||'').trim())},
    {key:'inaktivInTour',label:'Inaktiv, aber in Tour',items:all.filter(t=>!isActive(t)&&realTourIds(t).length>0)},
  ];
}
function _dqName(t){ const c=t.containerExtId?_containerOf(t):null; return c?((c.name||'–')+' · '+_elemLabel(t)):(t.name||'–'); }
function dqPick(key){ _dqCat=key; renderDatenqualitaet(); }
function initDatenqualitaet(){ if(!currentProjectId){ const b=document.getElementById('dq-body'); if(b) b.innerHTML='<div style="padding:24px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; } renderDatenqualitaet(); }
function renderDatenqualitaet(){
  const cardsEl=document.getElementById('dq-cards'), listEl=document.getElementById('dq-list'); if(!cardsEl||!listEl) return;
  const checks=_dqChecks();
  if(!_dqCat || !checks.find(c=>c.key===_dqCat)) _dqCat=(checks.find(c=>c.items.length>0)||checks[0]).key;
  cardsEl.innerHTML=checks.map(c=>{ const sel=c.key===_dqCat, n=c.items.length, col=n>0?'var(--amber)':'var(--green)';
    return `<div onclick="dqPick('${c.key}')" style="cursor:pointer;background:var(--surface2);border:1px solid ${sel?'var(--green)':'transparent'};border-radius:10px;padding:9px 11px;">
      <div style="font-size:12px;color:var(--text3);line-height:1.3;">${dlEsc(c.label)}</div>
      <div style="font-size:20px;font-weight:700;color:${col};">${n.toLocaleString('de-DE')}</div></div>`; }).join('');
  const cat=checks.find(c=>c.key===_dqCat), items=cat?cat.items:[];
  const cap=500, shown=items.slice(0,cap);
  const rows=shown.map(t=>`<tr data-treeid="${t.id}" style="border-top:1px solid var(--border);cursor:pointer;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
    <td style="padding:7px 10px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(_dqName(t))}</td>
    <td style="padding:7px 10px;color:var(--text2);white-space:nowrap;font-family:'DM Mono',monospace;font-size:11px;">${dlEsc(t.baumId||'–')}</td>
    <td style="padding:7px 10px;color:var(--text2);white-space:nowrap;">${dlEsc(t.stadtteil||'–')}</td>
    <td style="padding:7px 10px;color:var(--text2);white-space:nowrap;">${cat&&cat.detail?dlEsc(cat.detail(t)):''}</td>
  </tr>`).join('');
  listEl.innerHTML=`<div style="font-size:13px;font-weight:600;margin-bottom:4px;">${dlEsc(cat?cat.label:'')}</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:8px;">${items.length.toLocaleString('de-DE')} Objekt(e)${shown.length<items.length?` · Anzeige auf ${cap} begrenzt`:''} — Klick öffnet die Karte.</div>
    ${items.length?`<table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead><tr style="background:var(--surface2);">${['Objekt','Objekt-ID',FL.stadtteil,'Detail'].map(h=>`<th style="padding:7px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${dlEsc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table>`:'<div style="color:var(--green);font-size:13px;padding:8px 0;">✓ Keine Probleme in dieser Kategorie.</div>'}`;
  listEl.onclick=e=>{ const tr=e.target.closest('[data-treeid]'); if(tr){ selectTree(tr.dataset.treeid); switchView('karte'); } };
}
function dqExportCsv(){
  const cat=_dqChecks().find(c=>c.key===_dqCat); if(!cat||!cat.items.length){ notify('Keine Objekte zum Export'); return; }
  const cell=v=>{ const s=''+(v==null?'':v); return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; };
  const line=a=>a.map(cell).join(';');
  const head=['Kategorie','Objekt','Objekt-ID',FL.stadtteil,FL.art];
  const body=cat.items.map(t=>line([cat.label,_dqName(t),t.baumId||'',t.stadtteil||'',t.art||'']));
  const csv='﻿'+[line(head),...body].join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download='Datenqualitaet_'+cat.key+'_'+new Date().toISOString().slice(0,10)+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ── Chronische Ausfälle (G): systematische statt einmalige Probleme ──
const _gState={period:'30',minN:3,showFahrer:false};
function gSet(f,v){ _gState[f]=(f==='minN')?(parseInt(v)||1):(f==='showFahrer'?!!v:v); renderAusfaelle(); }
function _gCompute(){
  const r=kiComputeRange(_gState.period); let from=r.from,to=r.to;
  if(!from||!to){ const m=kiComputeRange('30'); from=m.from; to=m.to; }
  const inR=d=>d&&(!from||d>=from)&&(!to||d<=to);
  const per=[], reasonAgg={}, driverAgg={};
  trees.filter(t=>isActive(t)&&!_isContainer(t)).forEach(t=>{
    let bew=0,nicht=0; const reasons={}; const fills=[];
    (t.history||[]).forEach(h=>{
      if(!h.date||!inR((''+h.date).slice(0,10))) return;
      const done=h.status==='bewaessert', no=h.status==='nicht';
      if(typeof h.fuellgrad==='number') fills.push(h.fuellgrad);
      if(!done&&!no) return;
      if(done) bew++; else { nicht++; if(h.reason){ reasons[h.reason]=(reasons[h.reason]||0)+1; reasonAgg[h.reason]=(reasonAgg[h.reason]||0)+1; } }
      if(h.driver){ const da=driverAgg[h.driver]=driverAgg[h.driver]||{tot:0,n:0}; da.tot++; if(no) da.n++; }
    });
    if(bew||nicht||fills.length){ const tr=Object.entries(reasons).sort((a,b)=>b[1]-a[1])[0]; per.push({t,bew,nicht,topReason:tr?tr[0]:'',fillN:fills.length,avgFill:fills.length?Math.round(fills.reduce((a,b)=>a+b,0)/fills.length):null}); }
  });
  const chronisch=per.filter(x=>x.nicht>=_gState.minN).sort((a,b)=>b.nicht-a.nicht);
  const nieErfolg=per.filter(x=>x.bew===0&&x.nicht>0).sort((a,b)=>b.nicht-a.nicht);
  const reasons=Object.entries(reasonAgg).sort((a,b)=>b[1]-a[1]).slice(0,12);
  const drivers=Object.entries(driverAgg).filter(([n,d])=>d.tot>=5).map(([n,d])=>({name:n,tot:d.tot,n:d.n,rate:d.n/d.tot})).sort((a,b)=>b.rate-a.rate);
  const fuellAktiv=!!(currentProjectData&&currentProjectData.fuellgradAktiv);
  const rightsize=fuellAktiv?per.filter(x=>x.fillN>=3&&(x.avgFill>=90||x.avgFill<=30)).map(x=>({...x,rec:x.avgFill>=90?'häufiger leeren':'seltener möglich'})).sort((a,b)=>b.avgFill-a.avgFill):[];
  return {chronisch,nieErfolg,reasons,drivers,rightsize,fuellAktiv,maxReason:reasons[0]?reasons[0][1]:0};
}
function initAusfaelle(){
  if(!currentProjectId){ const b=document.getElementById('g-body'); if(b) b.innerHTML='<div style="padding:24px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; }
  const p=document.getElementById('g-period'); if(p) p.value=_gState.period;
  const mn=document.getElementById('g-minN'); if(mn) mn.value=_gState.minN;
  const fc=document.getElementById('g-fahrer'); if(fc) fc.checked=_gState.showFahrer;
  renderAusfaelle();
}
function renderAusfaelle(){
  const el=document.getElementById('g-content'); if(!el) return;
  const d=_gCompute();
  const card=(title,inner,sub)=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;margin-bottom:14px;"><div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">${title}</div>${sub?`<div style="font-size:12px;color:var(--text3);margin-bottom:8px;">${sub}</div>`:''}${inner}</div>`;
  const objTable=arr=>{
    if(!arr.length) return '<div style="color:var(--green);font-size:13px;">✓ Keine Fälle im Zeitraum.</div>';
    const cap=400, shown=arr.slice(0,cap);
    return `<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--surface2);">${['Objekt',FL.stadtteil,'Nicht / Gesamt','Häufigster Grund'].map(h=>`<th style="padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${dlEsc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(x=>`<tr data-treeid="${x.t.id}" style="border-top:1px solid var(--border);cursor:pointer;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><td style="padding:6px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(_dqName(x.t))}</td><td style="padding:6px 10px;color:var(--text2);white-space:nowrap;">${dlEsc(x.t.stadtteil||'–')}</td><td style="padding:6px 10px;white-space:nowrap;"><b style="color:var(--red);">${x.nicht}</b> / ${x.bew+x.nicht}</td><td style="padding:6px 10px;color:var(--text2);">${dlEsc(x.topReason||'–')}</td></tr>`).join('')}</tbody></table>${arr.length>cap?`<div style="font-size:11px;color:var(--text3);margin-top:6px;">Anzeige auf ${cap} begrenzt.</div>`:''}`;
  };
  const reasonList=d.reasons.length?d.reasons.map(([r,n])=>`<div style="display:flex;align-items:center;gap:10px;padding:4px 0;"><div style="width:170px;flex:none;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(r)}">${dlEsc(r)}</div><div style="flex:1;height:9px;border-radius:5px;background:#e5e1d8;overflow:hidden;"><div style="width:${d.maxReason?Math.round(n/d.maxReason*100):0}%;height:100%;background:var(--amber);"></div></div><div style="width:44px;text-align:right;font-weight:600;font-size:13px;">${n}</div></div>`).join(''):'<div style="color:var(--text3);font-size:13px;">Keine „nicht erledigt"-Gründe im Zeitraum.</div>';
  const fahrer=!_gState.showFahrer?'':card('Fahrer — zum Nachfragen (keine Bewertung)', d.drivers.length?`<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--surface2);">${['Fahrer','Nicht','Meldungen','Anteil'].map(h=>`<th style="padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);">${h}</th>`).join('')}</tr></thead><tbody>${d.drivers.map(x=>`<tr style="border-top:1px solid var(--border);"><td style="padding:6px 10px;">${dlEsc(x.name)}</td><td style="padding:6px 10px;">${x.n}</td><td style="padding:6px 10px;color:var(--text2);">${x.tot}</td><td style="padding:6px 10px;font-weight:600;">${Math.round(x.rate*100)} %</td></tr>`).join('')}</tbody></table>`:'<div style="color:var(--text3);font-size:13px;">Zu wenige Meldungen je Fahrer (ab 5).</div>','Anteil „nicht erledigt" je Fahrer (ab 5 Meldungen). Bewusst neutral — für die Rückfrage, nicht zur Leistungsbewertung.');
  const rightsizeCard=!d.fuellAktiv?'':card(`Füllgrad-Rightsizing · ${d.rightsize.length}`,
    d.rightsize.length?`<table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="background:var(--surface2);">${['Objekt',FL.stadtteil,'Ø Füllgrad','Meldungen','Empfehlung'].map(h=>`<th style="padding:6px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);white-space:nowrap;">${dlEsc(h)}</th>`).join('')}</tr></thead><tbody>${d.rightsize.slice(0,400).map(x=>{ const c=x.avgFill>=90?'var(--red)':'var(--blue)'; return `<tr data-treeid="${x.t.id}" style="border-top:1px solid var(--border);cursor:pointer;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''"><td style="padding:6px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(_dqName(x.t))}</td><td style="padding:6px 10px;color:var(--text2);white-space:nowrap;">${dlEsc(x.t.stadtteil||'–')}</td><td style="padding:6px 10px;font-weight:600;">${x.avgFill} %</td><td style="padding:6px 10px;color:var(--text2);">${x.fillN}</td><td style="padding:6px 10px;"><span style="padding:1px 8px;border-radius:6px;font-size:11px;font-weight:600;background:${c}22;color:${c};">${x.rec}</span></td></tr>`; }).join('')}</tbody></table>`:'<div style="color:var(--green);font-size:13px;">✓ Keine Auffälligkeiten — Häufigkeit passt zum Füllstand.</div>',
    'Passt die Leerungshäufigkeit zum echten Füllstand? Ø ab 90 % → unterversorgt (häufiger leeren), ≤ 30 % → überversorgt (seltener möglich). Nur Objekte mit ≥ 3 Füllgrad-Meldungen — Empfehlung, keine Automatik.');
  el.innerHTML=
    card(`Chronisch „nicht erledigt" (ab ${_gState.minN} Fällen) · ${d.chronisch.length}`, objTable(d.chronisch), 'Objekte, die wiederholt „nicht erledigt" gemeldet werden — Ursache statt Symptom prüfen (Reparatur, Zufahrt, Turnus).')+
    card(`Nie erfolgreich im Zeitraum · ${d.nieErfolg.length}`, objTable(d.nieErfolg), 'Objekte mit Meldungen, aber keiner einzigen „erledigt".')+
    rightsizeCard+
    card('Häufigste Gründe', reasonList)+
    fahrer;
  el.onclick=e=>{ const tr=e.target.closest('[data-treeid]'); if(tr){ selectTree(tr.dataset.treeid); switchView('karte'); } };
}
function gExportCsv(){
  const d=_gCompute(); const arr=d.chronisch; if(!arr.length){ notify('Keine chronischen Ausfälle zum Export'); return; }
  const cell=v=>{const s=''+(v==null?'':v);return /[";\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}; const line=a=>a.map(cell).join(';');
  const body=arr.map(x=>line([_dqName(x.t),x.t.stadtteil||'',x.nicht,x.bew+x.nicht,x.topReason||'']));
  const csv='﻿'+[line(['Objekt',FL.stadtteil,'Nicht','Gesamt','Haeufigster_Grund']),...body].join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  a.download='Ausfaelle_'+new Date().toISOString().slice(0,10)+'.csv'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ── AUTO-PLANUNG (Beta, Superadmin) ───────────────────────────────────────
// Erzeugt Touren-VARIANTEN per eigenem Optimierungsdienst (VROOM/OSRM, docker/tourenplaner-*).
// Varianten liegen in projects/{pid}/planVarianten — echte Touren/Objekte bleiben unberührt,
// bis eine Variante bewusst produktiv geschaltet wird (folgt in Ausbaustufe 2).
// Solver-URL lokal je Rechner (localStorage): Prototyp localhost:5010, später Cloud-Run-URL.
let _apVars=[], _apSel=null, _apMap=null, _apBusy=false, _apRulesHint=false;
let _apSelIds=new Set(), _apMarkers={}, _apMapVid=null; // Karten-Auswahl fürs manuelle Anpassen
let _apHiddenTours=new Set(); // per Legende ausgeblendete Touren (Index in v.touren)
function _apSolverUrl(){ try{ return localStorage.getItem('apSolverUrl')||'http://localhost:5010'; }catch(_){ return 'http://localhost:5010'; } }
function apSetSolverUrl(v){ try{ localStorage.setItem('apSolverUrl',(v||'').trim().replace(/\/+$/,'')); }catch(_){} }
function _apPlanbare(){ return trees.filter(t=>isActive(t)&&t.lat&&t.lng); }
function _apDepot(){
  const d=getDepot();
  if(d&&d.lat&&d.lng) return {lat:d.lat,lng:d.lng,quelle:'Betriebshof'};
  const pts=_apPlanbare(); if(!pts.length) return null;
  return {lat:pts.reduce((s,t)=>s+t.lat,0)/pts.length, lng:pts.reduce((s,t)=>s+t.lng,0)/pts.length, quelle:'Schwerpunkt der Objekte (kein Betriebshof gesetzt)'};
}
function _apUhr(sec){ const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60); return h+':'+String(m).padStart(2,'0'); }
// ── Rahmenbedingungen: Planungstage + Häufigkeit→Wochentage (vom Anwender vorgegeben) ──
const _AP_TAGE=['Mo','Di','Mi','Do','Fr','Sa','So'];
const _AP_PRESET={1:['Mo'],2:['Mo','Do'],3:['Mo','Mi','Fr'],4:['Mo','Di','Do','Fr'],5:['Mo','Di','Mi','Do','Fr'],6:['Mo','Di','Mi','Do','Fr','Sa'],7:['Mo','Di','Mi','Do','Fr','Sa','So']};
let _apDay=null, _apRahmen=null, _apRahmenPid=null;
function _apSaison(){
  const s=_apRahmen&&_apRahmen.saison;
  if(s==='sommer'||s==='winter') return s;
  return (typeof saisonFor==='function')?saisonFor(new Date().toISOString().slice(0,10)):'sommer';
}
function _apBucketize(f){
  if(f==null||!(f>0)) return 'ohne';
  if(f<1) return 'lt1';
  return String(Math.min(7,Math.round(f)));
}
function _apBucketOf(t){ return _apBucketize(sollFreqProWoche(t,_apSaison())); }
// Bucket eines Objekts im Kontext einer VARIANTE (deren Saison, nicht die aktuelle Rahmen-Saison)
function _apBucketOfV(t,v){ return _apBucketize(sollFreqProWoche(t,(v&&v.params&&v.params.saison)||_apSaison())); }
// Farben je Häufigkeit (Karten-Modus „Häufigkeit")
const _AP_FREQ_COLORS={'1':'#3b82f6','2':'#16a34a','3':'#f59e0b','4':'#8b5cf6','5':'#ef4444','6':'#0d9488','7':'#7c2d12','lt1':'#94a3b8','ohne':'#6b7280'};
function _apFreqColor(b){ return _AP_FREQ_COLORS[b]||'#6b7280'; }
function _apFreqShort(b){ return b==='ohne'?'ohne':(b==='lt1'?'<1×':b+'×'); }
let _apColorBy='tour'; // Karten-Färbung: 'tour' | 'freq'
function apColorBy(m){ _apColorBy=(m==='freq')?'freq':'tour'; renderAutoplan(); }
function _apBucketLabel(b){ return b==='ohne'?'ohne Häufigkeit (1× planen)':(b==='lt1'?'seltener als 1×/Woche (1× planen)':b+'× pro Woche'); }
function _apBucketNeed(b,tage){ return (b==='ohne'||b==='lt1')?1:Math.min(parseInt(b),tage.length); }
function _apDefaultDays(b,tage){
  const need=_apBucketNeed(b,tage);
  const pref=(_AP_PRESET[Math.min(7,(b==='ohne'||b==='lt1')?1:parseInt(b))]||['Mo']).filter(d=>tage.includes(d));
  const out=[...pref];
  for(const d of tage){ if(out.length>=need) break; if(!out.includes(d)) out.push(d); }
  return out.slice(0,need).sort((a,x)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(x));
}
// Rahmen laden (Projekt-Doc autoplanRahmen) + Buckets aus dem Bestand ableiten; fehlende Zeilen mit Standard belegen
function _apEnsureRahmen(){
  if(_apRahmenPid!==currentProjectId){ _apRahmen=null; _apRahmenPid=currentProjectId; } // Projektwechsel: Rahmen neu laden
  if(!_apRahmen){
    const saved=currentProjectData&&currentProjectData.autoplanRahmen;
    _apRahmen=saved?JSON.parse(JSON.stringify(saved)):{tage:['Mo','Di','Mi','Do','Fr'],saison:'auto',freqTage:{}};
  }
  if(!Array.isArray(_apRahmen.tage)||!_apRahmen.tage.length) _apRahmen.tage=['Mo','Di','Mi','Do','Fr'];
  if(!_apRahmen.freqTage) _apRahmen.freqTage={};
  if(!_apRahmen.freqErlaubt) _apRahmen.freqErlaubt={};
  if(!Array.isArray(_apRahmen.locks)) _apRahmen.locks=[]; // Fixierungen: {id,tag,vehicle} aus manuellen Anpassungen
  const buckets={};
  _apPlanbare().forEach(t=>{ const b=_apBucketOf(t); buckets[b]=(buckets[b]||0)+1; });
  Object.keys(buckets).forEach(b=>{
    const cur=(_apRahmen.freqTage[b]||[]).filter(d=>_apRahmen.tage.includes(d));
    _apRahmen.freqTage[b]=cur.length?cur:_apDefaultDays(b,_apRahmen.tage);
    const er=(_apRahmen.freqErlaubt[b]||[]).filter(d=>_apRahmen.tage.includes(d));
    _apRahmen.freqErlaubt[b]=er.length?er:_apDefaultErlaubt(b,_apRahmen.tage);
  });
  return buckets;
}
// Erlaubte Tage je Häufigkeit (Automatik-Modus): Wochenende nur, wenn es die Häufigkeit real braucht —
// Standard: bis 5×/Woche Mo–Fr, 6× inkl. Sa, 7× alle Tage. Vom Anwender je Häufigkeit umschaltbar.
function _apDefaultErlaubt(b,tage){
  const n=(b==='ohne'||b==='lt1')?1:parseInt(b);
  const pool = n>=7?_AP_TAGE : (n>=6?['Mo','Di','Mi','Do','Fr','Sa'] : ['Mo','Di','Mi','Do','Fr']);
  const out=tage.filter(d=>pool.includes(d));
  for(const d of tage){ if(out.length>=Math.min(n,tage.length)) break; if(!out.includes(d)) out.push(d); } // Notfall: zu wenig Tage im Pool
  return out.sort((a,x)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(x));
}
function _apErlaubt(b){
  const er=((_apRahmen&&_apRahmen.freqErlaubt||{})[b]||[]).filter(d=>_apRahmen.tage.includes(d));
  return er.length?er:_apDefaultErlaubt(b,_apRahmen.tage);
}
function apRahmenErlaubtDay(b,d){
  _apEnsureRahmen();
  const arr=_apRahmen.freqErlaubt[b]||(_apRahmen.freqErlaubt[b]=_apDefaultErlaubt(b,_apRahmen.tage));
  const i=arr.indexOf(d);
  if(i>=0){ if(arr.length<=1){ notify('Mindestens ein erlaubter Tag'); return; } arr.splice(i,1); }
  else arr.push(d);
  arr.sort((a,x)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(x));
  renderAutoplan();
}
function apRahmenDay(d){
  _apEnsureRahmen();
  const i=_apRahmen.tage.indexOf(d);
  if(i>=0){ if(_apRahmen.tage.length<=1){ notify('Mindestens ein Planungstag'); return; } _apRahmen.tage.splice(i,1); }
  else _apRahmen.tage=_AP_TAGE.filter(x=>x===d||_apRahmen.tage.includes(x));
  Object.keys(_apRahmen.freqTage).forEach(b=>{ _apRahmen.freqTage[b]=(_apRahmen.freqTage[b]||[]).filter(x=>_apRahmen.tage.includes(x)); });
  Object.keys(_apRahmen.freqErlaubt||{}).forEach(b=>{ _apRahmen.freqErlaubt[b]=(_apRahmen.freqErlaubt[b]||[]).filter(x=>_apRahmen.tage.includes(x)); });
  renderAutoplan();
}
function apRahmenFreqDay(b,d){
  _apEnsureRahmen();
  const arr=_apRahmen.freqTage[b]||(_apRahmen.freqTage[b]=[]);
  const i=arr.indexOf(d);
  if(i>=0) arr.splice(i,1); else arr.push(d);
  arr.sort((a,x)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(x));
  renderAutoplan();
}
function apSetSaison(s){ _apEnsureRahmen(); _apRahmen.saison=s; renderAutoplan(); }
// ── Tages-Muster + Gebiets-Zuteilung (periodische Planung) ──
// Je Häufigkeit n gibt es zulässige, gleichmäßig verteilte Tages-Muster (2× → Mo+Do ODER Di+Fr).
// WELCHES Muster ein Objekt bekommt, entscheidet die Geografie: ausgewogene kompakte Cluster.
const _AP_OFFS={1:[0],2:[0,3],3:[0,2,4],4:[0,1,3,4]};
function _apPatterns(b,tage){
  const n=_apBucketNeed(b,tage), len=tage.length;
  if(n>=len) return [[...tage]];
  let offs=(_AP_OFFS[n]&&_AP_OFFS[n][n-1]<len)?_AP_OFFS[n]:null;
  if(!offs) offs=[...new Set(Array.from({length:n},(_,i)=>Math.min(len-1,Math.round(i*(len-1)/Math.max(1,n-1)))))];
  const out=[], mx=offs[offs.length-1];
  for(let s=0;s+mx<len;s++) out.push(offs.map(o=>tage[s+o]));
  return out.length?out:[tage.slice(0,n)];
}
function _apModeOf(b){ const m=(_apRahmen&&_apRahmen.freqMode||{})[b]; return m==='fest'?'fest':'auto'; }
function apRahmenMode(b,m){ _apEnsureRahmen(); (_apRahmen.freqMode=_apRahmen.freqMode||{})[b]=m; renderAutoplan(); }
function _apD2(a,b){ const dx=(a.lng-b.lng)*Math.cos((a.lat+b.lat)*Math.PI/360), dy=a.lat-b.lat; return dx*dx+dy*dy; }
// Ausgewogene räumliche Cluster (Medoid-Variante, Gewicht = Bearbeitungsminuten):
// kompakte Gebiete, deren Arbeitslast sich ähnelt — Grundlage der Tages-/Muster-Zuteilung.
// dist(a,b) ist austauschbar: Straßennetz-Fahrzeit (OSRM-Matrix) oder Luftlinie als Rückfall —
// entscheidend z. B. am Rhein: Luftlinie über den Fluss ist kurz, der Fahrweg lang.
function _apBalancedClusters(objs,k,dist){
  dist=dist||((a,b)=>_apD2(a,b));
  if(k<=1) return [objs];
  if(objs.length<=k) return objs.map(o=>[o]).concat(Array.from({length:k-objs.length},()=>[]));
  const W=objs.map(o=>Math.max(1,artBewMin(o)));
  const cap=W.reduce((a,b)=>a+b,0)/k*1.2;
  const cs=[objs[0]];
  while(cs.length<k){ let best=null,bd=-1; objs.forEach(o=>{ const d=Math.min(...cs.map(c=>dist(o,c))); if(d>bd){bd=d;best=o;} }); cs.push(best); }
  let cent=cs, groups=null;
  for(let it=0;it<8;it++){
    groups=Array.from({length:k},()=>[]); const load=Array(k).fill(0);
    // eindeutige Fälle zuerst zuteilen → Kapazitätsgrenze verdrängt nur Grenzfälle
    const order=objs.map((o,i)=>{ const ds=cent.map(c=>dist(o,c)); const s=[...ds].sort((a,b)=>a-b); return {o,i,ds,margin:(s[1]??s[0])-s[0]}; }).sort((a,b)=>b.margin-a.margin);
    order.forEach(({o,i,ds})=>{
      const idx=ds.map((d,j)=>({d,j})).sort((a,b)=>a.d-b.d);
      const put=idx.find(x=>load[x.j]+W[i]<=cap)||idx[0];
      groups[put.j].push(o); load[put.j]+=W[i];
    });
    // Medoid-Update: das Gruppenmitglied mit der kleinsten Distanzsumme wird neues Zentrum
    cent=groups.map((g,j)=>{
      if(!g.length) return cent[j];
      const sample=g.length>150?g.filter((_,x)=>x%Math.ceil(g.length/150)===0):g;
      let best=g[0],bs=Infinity;
      g.forEach(o=>{ const s=sample.reduce((a,m)=>a+dist(o,m),0); if(s<bs){bs=s;best=o;} });
      return best;
    });
  }
  return groups;
}
// Straßennetz-Distanzmatrix (Fahrsekunden) für die Objektbasis holen — symmetrisiert.
// null bei Fehler/zu groß → Aufrufer fällt auf Luftlinie zurück.
async function _apFetchDistFn(base){
  if(base.length>600) return null; // URL-/Antwortgröße; Luftlinie bleibt dann der Rückfall
  try{
    const coords=base.map(t=>t.lng+','+t.lat).join(';');
    const res=await fetch(_apSolverUrl()+'/osrm/table/v1/driving/'+coords+'?annotations=duration');
    if(!res.ok) return null;
    const j=await res.json();
    if(j.code!=='Ok'||!Array.isArray(j.durations)) return null;
    const M=j.durations, idx=new Map(base.map((t,i)=>[t.id,i]));
    return (a,b)=>{ const i=idx.get(a.id), k=idx.get(b.id); if(i==null||k==null) return _apD2(a,b)*1e6; const x=M[i][k], y=M[k][i]; return ((x==null?9e5:x)+(y==null?9e5:y))/2; };
  }catch(e){ console.warn('OSRM-Matrix fürs Clustering nicht verfügbar', e); return null; }
}
// Tageszuteilung der ganzen Woche: feste Buckets direkt, Auto-Buckets über Cluster→Muster.
// Muster-Wahl je Cluster: größte Gruppe zuerst auf das aktuell am wenigsten belastete Muster.
function _apAssignDays(base,dist){
  const dayObjs={}, dayLoad={};
  _apRahmen.tage.forEach(d=>{ dayObjs[d]=[]; dayLoad[d]=0; });
  const put=(o,d)=>{ dayObjs[d].push(o); dayLoad[d]+=Math.max(1,artBewMin(o)); };
  const bucketObjs={};
  base.forEach(t=>{ const b=_apBucketOf(t); (bucketObjs[b]=bucketObjs[b]||[]).push(t); });
  const order=Object.keys(bucketObjs).sort((a,b)=>_apBucketNeed(b,_apRahmen.tage)-_apBucketNeed(a,_apRahmen.tage)); // hohe Häufigkeit zuerst (verankert die Tage)
  for(const b of order.reverse()){
    const objs=bucketObjs[b];
    if(_apModeOf(b)==='fest'){
      const days=(_apRahmen.freqTage[b]||[]);
      objs.forEach(o=>days.forEach(d=>put(o,d)));
      continue;
    }
    const pats=_apPatterns(b,_apErlaubt(b)); // nur die für diese Häufigkeit erlaubten Tage (z. B. Sa erst ab 6×)
    if(pats.length===1){ objs.forEach(o=>pats[0].forEach(d=>put(o,d))); continue; }
    const groups=_apBalancedClusters(objs,pats.length,dist);
    const gw=groups.map(g=>g.reduce((s,o)=>s+Math.max(1,artBewMin(o)),0));
    const gOrder=groups.map((_,i)=>i).sort((a,b)=>gw[b]-gw[a]);
    const free=new Set(pats.map((_,i)=>i));
    for(const gi of gOrder){
      let best=null,bl=Infinity;
      for(const pi of free){ const l=pats[pi].reduce((s,d)=>s+dayLoad[d],0); if(l<bl){bl=l;best=pi;} }
      free.delete(best);
      groups[gi].forEach(o=>pats[best].forEach(d=>put(o,d)));
    }
  }
  return dayObjs;
}
function apSelectDay(d){ _apDay=d; _apSelIds.clear(); renderAutoplan(); }
async function apClearLocks(){
  _apEnsureRahmen();
  if(!(_apRahmen.locks||[]).length) return;
  _apRahmen.locks=[];
  try{ await updateDoc(doc(db,'projects',currentProjectId),{autoplanRahmen:_apRahmen}); if(currentProjectData) currentProjectData.autoplanRahmen=JSON.parse(JSON.stringify(_apRahmen)); }
  catch(e){ console.warn('Fixierungen löschen',e); notify(dlErr(e)); return; }
  notify('Fixierungen gelöst'); renderAutoplan();
}
// Altbestand (Varianten ohne Tage) vereinheitlichen: Touren ohne tag → '—', unassigned Strings → {tag,id}
function _apNorm(v){
  (v.touren||[]).forEach(t=>{ if(!t.tag) t.tag='—'; });
  v.unassigned=(v.unassigned||[]).map(u=>typeof u==='string'?{tag:(v.touren[0]&&v.touren[0].tag)||'—',id:u}:u);
  return v;
}
function _apDaysOf(v){
  const set=[...new Set((v.touren||[]).map(t=>t.tag||'—'))];
  return set.sort((a,b)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(b));
}
async function initAutoplan(){
  const side=document.getElementById('ap-side'), main=document.getElementById('ap-main');
  if(!side||!main) return;
  if(currentRole!=='superadmin'){ main.innerHTML='<div style="padding:20px;color:var(--text3);">Nur für Superadmin.</div>'; side.innerHTML=''; return; }
  if(!currentProjectId){ main.innerHTML='<div style="padding:20px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; side.innerHTML=''; return; }
  await apReload();
}
async function apReload(){
  _apRulesHint=false;
  try{
    const qs=await getDocs(collection(db,'projects',currentProjectId,'planVarianten'));
    const remote=qs.docs.map(d=>_apNorm({id:d.id,...d.data()}));
    const local=_apVars.filter(v=>String(v.id).startsWith('_local')); // Sitzungs-Varianten behalten
    _apVars=[...local,...remote].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
  }catch(e){
    if(e&&e.code==='permission-denied'){ _apRulesHint=true; } else { console.warn('planVarianten laden',e); }
    _apVars=_apVars.filter(v=>String(v.id).startsWith('_local'));
  }
  if(_apSel&&!_apVars.find(v=>v.id===_apSel)) _apSel=_apVars[0]?.id||null;
  renderAutoplan();
}
function renderAutoplan(){
  const side=document.getElementById('ap-side'), main=document.getElementById('ap-main');
  if(!side||!main) return;
  const base=_apPlanbare(), depot=_apDepot();
  const echteTouren=tours.filter(t=>!t.uebersicht).length;
  const buckets=_apEnsureRahmen();
  const inp='padding:6px 8px;font-size:12px;border:1px solid var(--border);border-radius:6px;background:var(--bg);font-family:inherit;';
  const dayChip=(d,on,cb)=>`<span onclick="${cb}" style="cursor:pointer;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;border:1px solid ${on?'var(--green)':'var(--border)'};background:${on?'var(--green-light)':'var(--surface)'};color:${on?'#065f46':'var(--text3)'};">${d}</span>`;
  const bucketOrder=Object.keys(buckets).sort((a,b)=>{ const r=x=>x==='ohne'?99:(x==='lt1'?98:parseInt(x)); return r(a)-r(b); });
  const matrix=bucketOrder.map(b=>{
    const mode=_apModeOf(b);
    const pats=_apPatterns(b, mode==='auto'?_apErlaubt(b):_apRahmen.tage);
    const modeBtn=(m,lbl)=>`<span onclick="apRahmenMode('${b}','${m}')" style="cursor:pointer;font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;border:1px solid ${mode===m?'var(--green)':'var(--border)'};background:${mode===m?'var(--green-light)':'var(--surface)'};color:${mode===m?'#065f46':'var(--text3)'};">${lbl}</span>`;
    let body;
    if(mode==='auto'){
      const erlaubt=_apErlaubt(b);
      const nWant=(b==='ohne'||b==='lt1')?1:parseInt(b);
      const zuWenig=erlaubt.length<Math.min(nWant,_apRahmen.tage.length);
      const erChips=_apRahmen.tage.length>1?`<div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-bottom:3px;"><span style="font-size:10px;color:var(--text3);">erlaubt:</span>${_apRahmen.tage.map(d=>dayChip(d,erlaubt.includes(d),`apRahmenErlaubtDay('${b}','${d}')`)).join('')}</div>`:'';
      body=erChips+(zuWenig?`<div style="font-size:11px;color:#b45309;">Nur ${erlaubt.length} erlaubte Tage für ${nWant}×/Woche — wird ${erlaubt.length}× geplant.</div>`:'')+(pats.length>1
        ?`<div style="font-size:11px;color:var(--text3);">Muster: <b style="color:var(--text2);">${pats.map(p=>p.join('+')).join('</b> oder <b style="color:var(--text2);">')}</b> — Zuteilung nach Gebiet (kompakt & ausgewogen)</div>`
        :`<div style="font-size:11px;color:var(--text3);">Tage: <b style="color:var(--text2);">${pats[0].join('+')}</b></div>`);
    }else{
      const sel=_apRahmen.freqTage[b]||[], need=_apBucketNeed(b,_apRahmen.tage);
      const ok=(b==='ohne'||b==='lt1')?sel.length>=1:sel.length===need;
      body=`${ok?'':`<div style="font-size:11px;color:#b45309;margin-bottom:2px;"><b>${need} Tag${need===1?'':'e'} wählen</b> (${sel.length} gewählt)</div>`}
        <div style="display:flex;gap:4px;flex-wrap:wrap;">${_apRahmen.tage.map(d=>dayChip(d,sel.includes(d),`apRahmenFreqDay('${b}','${d}')`)).join('')}</div>`;
    }
    return `<div style="margin-bottom:9px;">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);margin-bottom:3px;">${_apBucketLabel(b)} · ${buckets[b]} Obj.<span style="margin-left:auto;display:flex;gap:3px;">${modeBtn('auto','Automatisch')}${modeBtn('fest','Feste Tage')}</span></div>
      ${body}
    </div>`;
  }).join('');
  const sollHint=!(currentProjectData&&currentProjectData.sollFeld)&&bucketOrder.length===1&&bucketOrder[0]==='ohne'
    ?'<div style="font-size:11px;color:#b45309;background:#fef3c7;border-radius:7px;padding:6px 9px;margin-bottom:8px;">Kein Soll-Feld gesetzt — alle Objekte gelten als „ohne Häufigkeit". Unter Auswertung → Soll-Ist das Häufigkeits-Feld wählen.</div>':'';
  const locksN=(_apRahmen.locks||[]).length;
  side.innerHTML=`
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px;">Varianten (${_apVars.length})</div>
    ${_apVars.length?_apVars.map(vv=>`
      <div onclick="apSelect('${_jsArg(vv.id)}')" style="padding:9px 11px;border:1px solid ${vv.id===_apSel?'var(--green)':'var(--border)'};border-radius:9px;margin-bottom:6px;cursor:pointer;background:${vv.id===_apSel?'var(--green-light)':'var(--bg)'};">
        <div style="font-size:12px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc(vv.name||'Variante')}</div>
        <div style="font-size:11px;color:var(--text3);">${(vv.kpi?.fzg??'?')} Touren · ${(vv.kpi?.objekte??0).toLocaleString('de-DE')} Einsätze${String(vv.id).startsWith('_local')?' · <span style="color:#b45309;">nur Sitzung</span>':''}</div>
      </div>`).join(''):'<div style="font-size:12px;color:var(--text3);padding:4px 2px 10px;">Noch keine Varianten — unten erzeugen.</div>'}
    ${_apRulesHint?`<div style="margin:4px 0 10px;font-size:11px;color:#b45309;background:#fef3c7;border-radius:8px;padding:8px 10px;">Speichern in der Datenbank noch nicht freigeschaltet — Varianten gelten nur für diese Sitzung.</div>`:''}
    ${locksN?`<div style="margin:4px 0 10px;font-size:11px;color:var(--text2);display:flex;align-items:center;gap:6px;flex-wrap:wrap;">📌 ${locksN} Fixierung${locksN===1?'':'en'} aus Anpassungen — bleiben beim Neu-Erzeugen erhalten <button onclick="apClearLocks()" style="border:none;background:none;color:var(--text3);font-size:11px;cursor:pointer;text-decoration:underline;padding:0;">alle lösen</button></div>`:''}
    <details ${_apVars.length?'':'open'} style="margin-top:10px;">
    <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);padding:8px 10px;background:var(--surface2);border-radius:8px;list-style-position:inside;">＋ Neue Variante erzeugen</summary>
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:8px;">
      <div style="font-size:12px;color:var(--text2);margin-bottom:10px;"><b style="color:var(--text);">${base.length.toLocaleString('de-DE')}</b> planbare Objekte (aktiv, mit Koordinaten)${pilotScopeActive()?' · <span style="color:#b45309;">Pilot-Bereich aktiv</span>':''}<br>
      Start: ${depot?dlEsc(depot.quelle):'<span style="color:var(--red);">keine Objekte</span>'} · heute ${echteTouren} echte Touren</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
        <label style="font-size:11px;color:var(--text3);">Fahrzeuge je Tag<input id="ap-n" type="number" min="1" max="50" value="${_apRahmen.fahrzeuge||3}" style="${inp}width:100%;margin-top:3px;"></label>
        <label style="font-size:11px;color:var(--text3);">Saison (Häufigkeit)<select id="ap-saison" onchange="apSetSaison(this.value)" style="${inp}width:100%;margin-top:3px;">
          <option value="auto"${(_apRahmen.saison||'auto')==='auto'?' selected':''}>Auto (${_apSaison()==='winter'?'Winter':'Sommer'})</option>
          <option value="sommer"${_apRahmen.saison==='sommer'?' selected':''}>Sommer</option>
          <option value="winter"${_apRahmen.saison==='winter'?' selected':''}>Winter</option>
        </select></label>
        <label style="font-size:11px;color:var(--text3);">Arbeitsbeginn<input id="ap-von" type="time" value="${_apRahmen.von||'08:00'}" style="${inp}width:100%;margin-top:3px;"></label>
        <label style="font-size:11px;color:var(--text3);">Arbeitsende<input id="ap-bis" type="time" value="${_apRahmen.bis||'16:00'}" style="${inp}width:100%;margin-top:3px;"></label>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-bottom:3px;">Planungstage</div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px;">${_AP_TAGE.map(d=>dayChip(d,_apRahmen.tage.includes(d),`apRahmenDay('${d}')`)).join('')}</div>
      <details ${_apVars.length?'':'open'} style="margin-bottom:10px;">
        <summary style="cursor:pointer;font-size:11px;font-weight:600;color:var(--text2);">Häufigkeit → Wochentage <span style="opacity:.7;font-weight:400;">(${bucketOrder.length} Häufigkeit${bucketOrder.length===1?'':'en'})</span></summary>
        <div style="margin-top:6px;">${sollHint}${matrix}</div>
      </details>
      <details style="margin-bottom:10px;">
        <summary style="cursor:pointer;font-size:11px;font-weight:600;color:var(--text2);">Erweitert</summary>
        <label style="font-size:11px;color:var(--text3);display:block;margin:6px 0 4px;">Solver-URL<input id="ap-url" value="${dlEsc(_apSolverUrl())}" onchange="apSetSolverUrl(this.value)" style="${inp}width:100%;margin-top:3px;" placeholder="http://localhost:5010"></label>
      </details>
      <button class="btn btn-primary" style="width:100%;" onclick="apGenerate()" ${_apBusy||!base.length?'disabled':''}>${_apBusy?'Rechnet…':'Wochenplan erzeugen'}</button>
    </div>
    </details>`;
  const v=_apVars.find(x=>x.id===_apSel);
  if(!v){ main.innerHTML='<div style="padding:24px;color:var(--text3);font-size:13px;">Links eine Variante erzeugen oder auswählen.</div>'; return; }
  _apNorm(v);
  const days=_apDaysOf(v);
  if(!_apDay||(_apDay!=='__all'&&!days.includes(_apDay))) _apDay=days[0]||null;
  const allView=_apDay==='__all';
  const dayTouren=(v.touren||[]).map((t,i)=>({t,i})).filter(x=>allView||(x.t.tag||'—')===_apDay);
  const spanne=(()=>{ if(allView) return null; const e=dayTouren.map(x=>x.t.endeSec).filter(x=>typeof x==='number'); if(e.length<2) return null; return Math.round((Math.max(...e)-Math.min(...e))/60); })();
  const kpiCard=(val,lbl)=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;"><div style="font-size:19px;font-weight:700;color:var(--text);">${val}</div><div style="font-size:11px;color:var(--text3);">${lbl}</div></div>`;
  // Auslastungs-Diagnose je Tag: WARUM ist etwas nicht eingeplant? Geplant vs. verfügbar + Bedarf des Rests.
  const byIdT={}; trees.forEach(t=>{ byIdT[t.id]=t; });
  const toSecH=s=>{ const [h,m]=String(s||'').split(':').map(Number); return (h||0)*3600+(m||0)*60; };
  const fzgN=(v.params&&v.params.fahrzeuge)||0;
  const fensterMin=v.params?Math.max(0,Math.round((toSecH(v.params.bis||'16:00')-toSecH(v.params.von||'08:00'))/60)):0;
  const availMin=fzgN*fensterMin;
  const diag=days.map(d=>{
    const tn=(v.touren||[]).filter(t=>(t.tag||'—')===d);
    const usedMin=Math.round(tn.reduce((s,t)=>s+(t.fahrtSec||0)+(t.serviceSec||0),0)/60);
    const un=(v.unassigned||[]).filter(u=>u.tag===d);
    const unMin=Math.round(un.reduce((s,u)=>{ const t=byIdT[u.id]; return s+(t?Math.max(1,artBewMin(t)):5); },0));
    return {d,usedMin,unCnt:un.length,unMin};
  });
  const diagBox=`<div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:10px 14px;margin-bottom:14px;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--text3);margin-bottom:6px;">Auslastung je Tag <span style="font-weight:400;text-transform:none;">— verfügbar: ${fzgN} Fzg × ${dlEsc(v.params?.von||'?')}–${dlEsc(v.params?.bis||'?')} = ${fmtMin(availMin)}</span></div>
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <tr style="color:var(--text3);"><th style="text-align:left;padding:2px 6px;">Tag</th><th style="text-align:right;padding:2px 6px;">geplant (Fahrt+Bearb.)</th><th style="text-align:right;padding:2px 6px;">frei</th><th style="text-align:right;padding:2px 6px;">nicht eingeplant</th><th style="text-align:right;padding:2px 6px;">Bedarf des Rests</th></tr>
      ${diag.map(x=>{ const frei=availMin-x.usedMin; const eng=x.unCnt>0||frei<30;
        return `<tr><td style="padding:2px 6px;font-weight:${x.d===_apDay?'700':'400'};">${dlEsc(x.d)}</td>
        <td style="text-align:right;padding:2px 6px;">${fmtMin(x.usedMin)}</td>
        <td style="text-align:right;padding:2px 6px;color:${frei<0?'var(--red)':'var(--text2)'};">${fmtMin(frei)}</td>
        <td style="text-align:right;padding:2px 6px;color:${x.unCnt?'var(--red)':'var(--text3)'};font-weight:${x.unCnt?'700':'400'};">${x.unCnt||'–'}</td>
        <td style="text-align:right;padding:2px 6px;color:${x.unCnt?'#b45309':'var(--text3)'};">${x.unCnt?'≈ '+fmtMin(x.unMin)+' + Fahrt':'–'}</td></tr>`; }).join('')}
    </table>
    ${diag.some(x=>x.unCnt)?`<div style="font-size:11px;color:var(--text2);margin-top:7px;">Der Tag ist voll: Es passt nicht mehr in ${fzgN} Fahrzeuge × Arbeitszeit. Hebel: mehr Fahrzeuge, längeres Zeitfenster, weitere Planungstage — oder Zeitaufwand je Objektart prüfen (ohne gepflegten Wert gelten ${getBewDuration()} min je Objekt).</div>`:''}
  </div>`;
  main.innerHTML=`
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap;">
      <span style="font-size:15px;font-weight:700;color:var(--text);">${dlEsc(v.name||'Variante')}</span>
      <span style="font-size:10px;font-weight:700;background:var(--surface2);color:var(--text2);padding:2px 8px;border-radius:20px;">${dlEsc(v.status||'entwurf')}</span>
      <span style="font-size:11px;color:var(--text3);">${v.createdAt?new Date(v.createdAt).toLocaleString('de-DE'):''} ${v.createdBy?'· '+dlEsc(v.createdBy):''}${v.params?.distanz?` · ${v.params.distanz==='strasse'?'Straßennetz':'Luftlinie'}`:''}${v.params?.fixierungen?` · 📌${v.params.fixierungen}`:''}</span>
      <span style="margin-left:auto;display:flex;gap:8px;">
        <button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;${(v.touren||[]).some(t=>t.dirty)?'border-color:#f59e0b;color:#b45309;font-weight:600;':''}" onclick="apRecalc()" ${_apBusy?'disabled':''} title="Reihenfolge & Zeiten je Tour neu berechnen — deine Zuordnung bleibt">${_apBusy?'Rechnet…':'Neu berechnen'}</button>
        <button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;" disabled title="Ausbaustufe 2 — kommt als Nächstes">Produktiv schalten (folgt)</button>
        <button class="btn btn-secondary" style="padding:5px 12px;font-size:12px;color:var(--red);" onclick="apDelete('${_jsArg(v.id)}')">Löschen</button>
      </span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:14px;">
      ${kpiCard((v.touren||[]).length,'Touren / Woche')}
      ${kpiCard((v.kpi?.objekte??0).toLocaleString('de-DE'),'Einsätze / Woche')}
      ${kpiCard(v.kpi?.unassigned??0,'nicht eingeplant')}
      ${kpiCard(fmtMin(v.kpi?.fahrtMin??0),'Fahrzeit / Woche')}
      ${kpiCard(fmtMin(v.kpi?.serviceMin??0),'Bearbeitung / Woche')}
      ${spanne!=null?kpiCard(fmtMin(spanne),'Spanne Feierabend ('+dlEsc(_apDay||'')+')'):''}
    </div>
    ${days.length>1?`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">
      <button onclick="apSelectDay('__all')" style="cursor:pointer;font-size:12px;font-weight:${allView?'700':'400'};padding:5px 12px;border-radius:8px;border:1px solid ${allView?'var(--green)':'var(--border)'};background:${allView?'var(--green-light)':'var(--surface)'};color:${allView?'#065f46':'var(--text2)'};">Woche <span style="opacity:.7;">· ${(v.touren||[]).length} T</span></button>
      ${days.map(d=>{ const tn=(v.touren||[]).filter(t=>(t.tag||'—')===d); const cnt=tn.reduce((s,t)=>s+(t.objektIds||[]).length,0); const unC=(v.unassigned||[]).filter(u=>u.tag===d).length;
        return `<button onclick="apSelectDay('${_jsArg(d)}')" style="cursor:pointer;font-size:12px;font-weight:${d===_apDay?'700':'400'};padding:5px 12px;border-radius:8px;border:1px solid ${d===_apDay?'var(--green)':'var(--border)'};background:${d===_apDay?'var(--green-light)':'var(--surface)'};color:${d===_apDay?'#065f46':'var(--text2)'};">${dlEsc(d)} <span style="opacity:.7;">· ${tn.length} T / ${cnt}</span>${unC?` <span style="color:var(--red);font-weight:700;">⚠${unC}</span>`:''}</button>`; }).join('')}
    </div>`:''}
    ${(v.unassigned||[]).length?`<div style="font-size:12px;color:#b45309;background:#fef3c7;border-radius:8px;padding:8px 12px;margin-bottom:10px;">${v.unassigned.length} Einsätze nicht eingeplant (graue Punkte am jeweiligen Tag) — Details unter „Auslastung je Tag".</div>`:''}
    ${allView?`<div style="font-size:11px;color:var(--text3);margin-bottom:8px;">Wochen-Übersicht: jede Tour in eigener Farbe. Zum Anpassen einen Tages-Reiter wählen.</div>`:`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text3);">Anpassen (${dlEsc(_apDay||'')}): Objekte anklicken, dann Ziel-Tour wählen:</span>
      <span id="ap-selinfo" style="font-size:11px;font-weight:700;color:var(--text2);background:var(--surface2);padding:3px 9px;border-radius:20px;">0 ausgewählt</span>
      ${dayTouren.map(({t,i})=>`<button onclick="apAssignSel(${i})" title="Auswahl in ${dlEsc(t.name)} verschieben" style="border:1px solid var(--border);background:var(--surface);border-radius:20px;padding:3px 10px 3px 7px;font-size:11px;cursor:pointer;display:inline-flex;align-items:center;gap:5px;"><span style="width:9px;height:9px;border-radius:50%;background:${t.color};"></span>${dlEsc(t.name)}</button>`).join('')}
      <button onclick="apClearSel()" style="border:none;background:none;color:var(--text3);font-size:11px;cursor:pointer;padding:3px 6px;">Auswahl leeren</button>
    </div>`}
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
      <span style="font-size:11px;color:var(--text3);">Anzeige:</span>
      <span style="display:inline-flex;border:1px solid var(--border);border-radius:7px;overflow:hidden;">
        <span onclick="apColorBy('tour')" style="cursor:pointer;font-size:10px;font-weight:600;padding:3px 9px;background:${_apColorBy==='tour'?'var(--green-light)':'var(--surface)'};color:${_apColorBy==='tour'?'#065f46':'var(--text3)'};">Touren</span>
        <span onclick="apColorBy('freq')" style="cursor:pointer;font-size:10px;font-weight:600;padding:3px 9px;border-left:1px solid var(--border);background:${_apColorBy==='freq'?'var(--green-light)':'var(--surface)'};color:${_apColorBy==='freq'?'#065f46':'var(--text3)'};">Häufigkeit</span>
      </span>
      ${dayTouren.map(({t,i})=>{ const hid=_apHiddenTours.has(i);
        return `<span onclick="apToggleTourVis(${i})" title="Tour ein-/ausblenden" style="cursor:pointer;display:inline-flex;align-items:center;gap:5px;font-size:11px;padding:3px 9px;border-radius:20px;border:1px solid var(--border);background:${hid?'var(--surface2)':'var(--surface)'};opacity:${hid?'.5':'1'};${hid?'text-decoration:line-through;':''}"><span style="width:9px;height:9px;border-radius:50%;background:${_apTourColorFor(t,i,allView)};"></span>${dlEsc(t.name)}</span>`; }).join('')}
      ${_apHiddenTours.size?`<button onclick="apShowAllTours()" style="border:none;background:none;color:var(--text3);font-size:11px;cursor:pointer;padding:3px 6px;">alle einblenden</button>`:''}
    </div>
    ${_apColorBy==='freq'?(()=>{ // Legende: Häufigkeit → Farbe, mit Anzahl im sichtbaren Ausschnitt
      const cnt={};
      dayTouren.forEach(({t,i})=>{ if(_apHiddenTours.has(i)) return; (t.objektIds||[]).forEach(id=>{ const o=byIdT[id]; if(!o) return; const b=_apBucketOfV(o,v); cnt[b]=(cnt[b]||0)+1; }); });
      (v.unassigned||[]).filter(u=>allView||u.tag===_apDay).forEach(u=>{ const o=byIdT[u.id]; if(!o) return; const b=_apBucketOfV(o,v); cnt[b]=(cnt[b]||0)+1; });
      const order=Object.keys(cnt).sort((a,b)=>{ const r=x=>x==='ohne'?99:(x==='lt1'?98:parseInt(x)); return r(a)-r(b); });
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;font-size:11px;color:var(--text2);">
        <span style="color:var(--text3);">Häufigkeit:</span>
        ${order.map(b=>`<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:10px;height:10px;border-radius:50%;background:${_apFreqColor(b)};border:1px solid #fff;box-shadow:0 0 0 1px var(--border);"></span>${_apFreqShort(b)} <span style="color:var(--text3);">(${cnt[b]})</span></span>`).join('')}
      </div>`; })():''}
    <div id="ap-map" style="height:440px;border-radius:10px;border:1px solid var(--border);margin-bottom:12px;"></div>
    <details ${(v.unassigned||[]).length?'open':''} style="margin-bottom:10px;">
      <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);padding:7px 10px;background:var(--surface2);border-radius:8px;list-style-position:inside;">Auslastung je Tag${(v.unassigned||[]).length?` <span style="color:var(--red);">· ${v.unassigned.length} nicht eingeplant</span>`:''}</summary>
      <div style="margin-top:8px;">${diagBox}</div>
    </details>
    <details style="margin-bottom:10px;">
      <summary style="cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);padding:7px 10px;background:var(--surface2);border-radius:8px;list-style-position:inside;">Touren-Tabelle (${allView?'ganze Woche':dlEsc(_apDay||'')})</summary>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-top:8px;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <tr style="background:var(--surface2);"><th style="text-align:left;padding:7px 12px;">Tour</th><th style="text-align:right;padding:7px 12px;">Objekte</th><th style="text-align:right;padding:7px 12px;">Fahrzeit</th><th style="text-align:right;padding:7px 12px;">Bearbeitung</th><th style="text-align:right;padding:7px 12px;">Feierabend</th></tr>
          ${dayTouren.map(({t,i})=>`<tr style="border-top:1px solid var(--border);${_apHiddenTours.has(i)?'opacity:.45;':''}">
            <td style="padding:7px 12px;"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${_apTourColorFor(t,i,allView)};margin-right:7px;vertical-align:-1px;"></span>${dlEsc(t.name)}</td>
            <td style="text-align:right;padding:7px 12px;">${(t.objektIds||[]).length}</td>
            <td style="text-align:right;padding:7px 12px;">${fmtMin(Math.round((t.fahrtSec||0)/60))}</td>
            <td style="text-align:right;padding:7px 12px;">${fmtMin(Math.round((t.serviceSec||0)/60))}</td>
            <td style="text-align:right;padding:7px 12px;">${t.dirty?'<span style="color:#b45309;" title="Zuordnung geändert — Zeiten werden neu berechnet">veraltet</span>':(typeof t.endeSec==='number'?_apUhr(t.endeSec)+' Uhr':'–')}</td></tr>`).join('')}
        </table>
      </div>
    </details>`;
  setTimeout(()=>_apRenderMap(v),30);
}
// Farbe einer Tour in der Anzeige: Tages-Sicht = gespeicherte Fahrzeug-Farbe;
// Wochen-Sicht = eigene Farbe je Tour (sonst wären alle „Fahrzeug 1"-Touren gleichfarbig).
function _apTourColorFor(t,i,allView){ return allView?TOUR_COLORS[i%TOUR_COLORS.length]:(t.color||'#333'); }
function apToggleTourVis(i){ if(_apHiddenTours.has(i)) _apHiddenTours.delete(i); else _apHiddenTours.add(i); renderAutoplan(); }
function apShowAllTours(){ _apHiddenTours.clear(); renderAutoplan(); }
function _apMarkerStyle(fill,selected){
  return selected
    ? {radius:7,color:'#111',weight:3,fillColor:fill,fillOpacity:1}
    : {radius:5,color:'#fff',weight:1.2,fillColor:fill,fillOpacity:.95};
}
function _apRenderMap(v){
  const el=document.getElementById('ap-map'); if(!el||!window.L) return;
  // Beim Re-Render derselben Variante am selben Tag (z. B. nach Zuweisung) Kartenausschnitt beibehalten
  const viewKey=v.id+'|'+(_apDay||'');
  let keep=null;
  try{ if(_apMap&&_apMapVid===viewKey){ keep={c:_apMap.getCenter(),z:_apMap.getZoom()}; } }catch(_){}
  try{ if(_apMap){ _apMap.remove(); } }catch(_){}
  _apMap=L.map('ap-map',{zoomControl:true,attributionControl:false}).setView([51,9],6);
  _apMapVid=viewKey; _apMarkers={};
  L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18}).addTo(_apMap);
  const grp=L.layerGroup().addTo(_apMap), pts=[];
  const byId={}; trees.forEach(t=>{ byId[t.id]=t; });
  const addMarker=(t,fill,tip)=>{
    const m=L.circleMarker([t.lat,t.lng],_apMarkerStyle(fill,_apSelIds.has(t.id)))
      .bindTooltip(tip).on('click',()=>apToggleSel(t.id)).addTo(grp);
    _apMarkers[t.id]={m,fill};
    pts.push([t.lat,t.lng]);
  };
  const allView=_apDay==='__all';
  // Tage je Objekt (für den Tooltip: „Mo+Do") einmal vorberechnen
  const objDays={};
  (v.touren||[]).forEach(tr=>{ (tr.objektIds||[]).forEach(id=>{ (objDays[id]=objDays[id]||[]).push(tr.tag||'—'); }); });
  const tipFor=(t,extra)=>{
    const b=_apBucketOfV(t,v);
    const tage=(objDays[t.id]||[]).sort((a,x)=>_AP_TAGE.indexOf(a)-_AP_TAGE.indexOf(x)).join('+');
    return `${dlEsc(t.name||'Objekt')} · ${extra}<br>Häufigkeit: <b>${_apFreqShort(b)}</b>${tage?` · Tage: <b>${tage}</b>`:''}`;
  };
  (v.touren||[]).forEach((tr,ti)=>{
    if(!(allView||(tr.tag||'—')===_apDay)) return;
    if(_apHiddenTours.has(ti)) return;
    const tourCol=_apTourColorFor(tr,ti,allView);
    (tr.objektIds||[]).forEach(id=>{
      const t=byId[id]; if(!t||!t.lat||!t.lng) return;
      const col=_apColorBy==='freq'?_apFreqColor(_apBucketOfV(t,v)):tourCol;
      addMarker(t,col,tipFor(t,dlEsc(tr.name)));
    });
  });
  (v.unassigned||[]).filter(u=>allView||u.tag===_apDay).forEach(u=>{
    const t=byId[u.id]; if(!t||!t.lat||!t.lng) return;
    const col=_apColorBy==='freq'?_apFreqColor(_apBucketOfV(t,v)):'#9ca3af';
    addMarker(t,col,tipFor(t,`nicht eingeplant (${dlEsc(u.tag||'')})`));
  });
  const dep=v.params&&v.params.depot;
  if(dep&&dep.lat) L.circleMarker([dep.lat,dep.lng],{radius:8,color:'#fff',weight:2,fillColor:'#f59e0b',fillOpacity:1}).bindTooltip('Start/Ziel').addTo(grp);
  if(keep) _apMap.setView(keep.c,keep.z);
  else if(pts.length) _apMap.fitBounds(L.latLngBounds(pts),{padding:[30,30]});
  setTimeout(()=>{ try{ _apMap.invalidateSize(); }catch(_){} },120);
}
function apToggleSel(id){
  if(_apSelIds.has(id)) _apSelIds.delete(id); else _apSelIds.add(id);
  const e=_apMarkers[id]; if(e) e.m.setStyle(_apMarkerStyle(e.fill,_apSelIds.has(id)));
  const info=document.getElementById('ap-selinfo'); if(info) info.textContent=_apSelIds.size+' ausgewählt';
}
function apClearSel(){
  const ids=[..._apSelIds]; _apSelIds.clear();
  ids.forEach(id=>{ const e=_apMarkers[id]; if(e) e.m.setStyle(_apMarkerStyle(e.fill,false)); });
  const info=document.getElementById('ap-selinfo'); if(info) info.textContent='0 ausgewählt';
}
function _apCur(){ return _apVars.find(x=>x.id===_apSel)||null; }
function _apRecalcKpiCounts(v){
  v.kpi=v.kpi||{};
  v.kpi.objekte=(v.touren||[]).reduce((s,t)=>s+(t.objektIds||[]).length,0);
  v.kpi.unassigned=(v.unassigned||[]).length;
  v.kpi.fzg=(v.touren||[]).filter(t=>(t.objektIds||[]).length).length;
}
async function _apSave(v){
  if(String(v.id).startsWith('_local')) return; // Sitzungs-Variante: nur lokal
  try{
    await updateDoc(doc(db,'projects',currentProjectId,'planVarianten',v.id),
      {touren:v.touren,unassigned:v.unassigned||[],kpi:v.kpi,manuell:true,geaendertAm:new Date().toISOString()});
  }catch(e){ console.warn('Variante speichern',e); notify(dlErr(e)); }
}
// Eine Tour einzeln durchrechnen (Einzel-Fahrzeug, feste Jobmenge → optimale Reihenfolge + Zeiten).
// Passt etwas nicht ins Zeitfenster, wandert es in v.unassigned (mit Tag).
async function _apSolveTour(v,t,byId){
  const objs=(t.objektIds||[]).map(id=>byId[id]).filter(x=>x&&x.lat&&x.lng);
  if(!objs.length){ t.fahrtSec=0; t.serviceSec=0; t.endeSec=null; t.dirty=false; return; }
  const toSec=s=>{ const [h,m]=String(s||'').split(':').map(Number); return (h||0)*3600+(m||0)*60; };
  const tw=[toSec(v.params?.von||'08:00'),toSec(v.params?.bis||'16:00')];
  const dep=v.params&&v.params.depot;
  const jobs=objs.map((o,i)=>({id:i+1,location:[o.lng,o.lat],service:Math.max(60,Math.round(artBewMin(o)*60))}));
  const veh={id:1,profile:'car',time_window:tw};
  if(dep&&dep.lat){ veh.start=[dep.lng,dep.lat]; veh.end=[dep.lng,dep.lat]; }
  const res=await fetch(_apSolverUrl()+'/vroom/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobs,vehicles:[veh]})});
  if(!res.ok) throw new Error('Solver antwortet nicht (HTTP '+res.status+')');
  const sol=await res.json();
  if(sol.code!==0) throw new Error('Solver: '+(sol.error||('Code '+sol.code)));
  const r=(sol.routes||[])[0];
  if(r){
    const steps=r.steps||[];
    t.objektIds=steps.filter(s=>s.type==='job').map(s=>objs[s.job-1].id);
    t.fahrtSec=r.duration||0; t.serviceSec=r.service||0;
    t.endeSec=steps.length?steps[steps.length-1].arrival:null;
  }
  const un=(sol.unassigned||[]).map(u=>objs[(u.id||0)-1]?.id).filter(Boolean);
  if(un.length){
    t.objektIds=(t.objektIds||[]).filter(id=>!un.includes(id));
    v.unassigned=[...(v.unassigned||[]),...un.map(id=>({tag:t.tag||'—',id}))];
  }
  t.dirty=false;
}
function _apSumKpiTimes(v){
  v.kpi=v.kpi||{};
  v.kpi.fahrtMin=Math.round((v.touren||[]).reduce((s,t)=>s+(t.fahrtSec||0),0)/60);
  v.kpi.serviceMin=Math.round((v.touren||[]).reduce((s,t)=>s+(t.serviceSec||0),0)/60);
}
async function apAssignSel(ti){
  const v=_apCur(); if(!v||!Array.isArray(v.touren)||!v.touren[ti]||_apBusy) return;
  if(!_apSelIds.size){ notify('Zuerst Objekte auf der Karte anklicken'); return; }
  const tgt=v.touren[ti], tag=tgt.tag||'—';
  const ids=new Set(_apSelIds);
  // Nur innerhalb DESSELBEN Tages verschieben — andere Wochentage desselben Objekts bleiben unberührt
  v.touren.forEach(t=>{
    if((t.tag||'—')!==tag) return;
    const before=(t.objektIds||[]).length;
    t.objektIds=(t.objektIds||[]).filter(id=>!ids.has(id));
    if(t.objektIds.length!==before) t.dirty=true;
  });
  v.unassigned=(v.unassigned||[]).filter(u=>!(u.tag===tag&&ids.has(u.id)));
  ids.forEach(id=>{ if(!tgt.objektIds.includes(id)) tgt.objektIds.push(id); });
  tgt.dirty=true; v.manuell=true;
  // Fixierung merken (Projekt-Rahmen): bei künftigem "Wochenplan erzeugen" bleibt die Handarbeit erhalten
  if(typeof tgt.vehicle==='number'){
    _apEnsureRahmen();
    _apRahmen.locks=_apRahmen.locks.filter(l=>!(ids.has(l.id)&&l.tag===tag));
    ids.forEach(id=>_apRahmen.locks.push({id,tag,vehicle:tgt.vehicle}));
    try{ await updateDoc(doc(db,'projects',currentProjectId),{autoplanRahmen:_apRahmen}); if(currentProjectData) currentProjectData.autoplanRahmen=JSON.parse(JSON.stringify(_apRahmen)); }
    catch(e){ console.warn('Fixierung speichern',e); }
  }
  const n=ids.size; _apSelIds.clear();
  // Endzeiten sofort neu berechnen (nur die geänderten Touren) — Anforderung: Endzeit folgt jeder Anpassung
  _apBusy=true; renderAutoplan();
  try{
    const byId={}; trees.forEach(t=>{ byId[t.id]=t; });
    for(const t of v.touren){ if(t.dirty) await _apSolveTour(v,t,byId); }
    _apRecalcKpiCounts(v); _apSumKpiTimes(v);
    await _apSave(v);
    notify(`✓ ${n} Objekt${n===1?'':'e'} → ${tgt.name} · Zeiten aktualisiert`);
  }catch(e){
    console.warn('apAssignSel recalc',e);
    notify(`✓ ${n} verschoben — Zeiten konnten nicht berechnet werden (${e.message||e}); „Neu berechnen" versucht es erneut.`);
    _apRecalcKpiCounts(v); await _apSave(v);
  }
  _apBusy=false; renderAutoplan();
}
// Alle Touren der Variante neu durchrechnen — Zuordnung bleibt, Reihenfolge/Zeiten frisch.
async function apRecalc(){
  const v=_apCur(); if(!v||_apBusy) return;
  _apBusy=true; renderAutoplan();
  try{
    const byId={}; trees.forEach(t=>{ byId[t.id]=t; });
    for(const t of (v.touren||[])) await _apSolveTour(v,t,byId);
    _apRecalcKpiCounts(v); _apSumKpiTimes(v);
    await _apSave(v);
    notify('✓ Reihenfolge & Zeiten neu berechnet');
  }catch(e){ console.warn('apRecalc',e); notify('Neu berechnen: '+(e.message||e)); }
  _apBusy=false; renderAutoplan();
}
function apSelect(id){ _apSel=id; _apSelIds.clear(); _apDay=null; _apHiddenTours.clear(); renderAutoplan(); }
async function apGenerate(){
  if(_apBusy) return;
  const buckets=_apEnsureRahmen();
  const n=Math.max(1,Math.min(50,parseInt(document.getElementById('ap-n')?.value)||3));
  const von=document.getElementById('ap-von')?.value||'08:00', bis=document.getElementById('ap-bis')?.value||'16:00';
  const toSec=s=>{ const [h,m]=s.split(':').map(Number); return h*3600+(m||0)*60; };
  if(toSec(bis)<=toSec(von)){ notify('Arbeitsende muss nach Arbeitsbeginn liegen'); return; }
  // Rahmen validieren — nur Buckets im „Feste Tage"-Modus (Auto verteilt selbst)
  for(const b of Object.keys(buckets)){
    if(_apModeOf(b)!=='fest') continue;
    const sel=(_apRahmen.freqTage[b]||[]).length, need=_apBucketNeed(b,_apRahmen.tage);
    if((b==='ohne'||b==='lt1')?sel<1:sel!==need){ notify(`„${_apBucketLabel(b)}": bitte ${need} Tag${need===1?'':'e'} wählen (${sel} gewählt)`); return; }
  }
  const base=_apPlanbare();
  if(base.length<2){ notify('Zu wenige planbare Objekte'); return; }
  if(base.length>9500){ notify('Mehr als 9.500 Objekte — bitte Bestand eingrenzen (z. B. Pilot-Bereich)'); return; }
  const depot=_apDepot(); if(!depot){ notify('Kein Startpunkt bestimmbar'); return; }
  // Rahmen (inkl. Fahrzeuge/Zeiten) für den Anwender am Projekt merken — best effort
  _apRahmen.fahrzeuge=n; _apRahmen.von=von; _apRahmen.bis=bis;
  try{ await updateDoc(doc(db,'projects',currentProjectId),{autoplanRahmen:_apRahmen}); if(currentProjectData) currentProjectData.autoplanRahmen=JSON.parse(JSON.stringify(_apRahmen)); }catch(e){ console.warn('autoplanRahmen speichern',e); }
  _apBusy=true; renderAutoplan();
  try{
    const saison=_apSaison();
    const distFn=await _apFetchDistFn(base); // Straßennetz-Fahrzeiten fürs Clustering (null → Luftlinie)
    const dayMap=_apAssignDays(base,distFn); // Objekt→Tage: feste Vorgaben + Gebiets-Zuteilung der Auto-Buckets
    // Fixierungen (Anker) je Tag: Objekt X am Tag D → Fahrzeug V (über VROOM-Skills erzwungen)
    const lockByTagId={};
    (_apRahmen.locks||[]).forEach(l=>{ if(l&&l.id&&l.tag&&typeof l.vehicle==='number'&&l.vehicle>=1&&l.vehicle<=n) lockByTagId[l.tag+'|'+l.id]=l.vehicle; });
    const touren=[], unassigned=[];
    let einsaetze=0;
    for(const tag of _apRahmen.tage){
      const dayObjs=dayMap[tag]||[];
      if(!dayObjs.length) continue;
      einsaetze+=dayObjs.length;
      const jobs=dayObjs.map((t,i)=>{
        const j={ id:i+1, location:[t.lng,t.lat], service:Math.max(60,Math.round(artBewMin(t)*60)) };
        const lv=lockByTagId[tag+'|'+t.id]; if(lv) j.skills=[lv];
        return j;
      });
      const vehicles=Array.from({length:n},(_,k)=>({ id:k+1, profile:'car', start:[depot.lng,depot.lat], end:[depot.lng,depot.lat], time_window:[toSec(von),toSec(bis)], skills:[k+1] }));
      const ctrl=new AbortController(); const timer=setTimeout(()=>ctrl.abort(),180000);
      let res;
      try{ res=await fetch(_apSolverUrl()+'/vroom/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jobs,vehicles}),signal:ctrl.signal}); }
      catch(e){
        // Typischer Fall: Browser blockiert den Zugriff einer HTTPS-Seite auf localhost (Private-Network-/Lokales-Netzwerk-Schutz)
        if(e&&e.name==='AbortError') throw new Error('Solver-Zeitlimit (3 min) überschritten');
        throw new Error('Solver nicht erreichbar — läuft der Tourenplaner-Stack? Von der Online-Version blockiert der Browser localhost ggf.: App über http://localhost:3001 öffnen oder die Browser-Abfrage „Lokales Netzwerk" zulassen.');
      }
      finally{ clearTimeout(timer); }
      if(!res.ok) throw new Error('Solver antwortet nicht (HTTP '+res.status+') — läuft der Tourenplaner-Stack?');
      const sol=await res.json();
      if(sol.code!==0) throw new Error('Solver ('+tag+'): '+(sol.error||('Code '+sol.code)));
      (sol.routes||[]).forEach(r=>{
        const steps=r.steps||[];
        touren.push({
          tag, name:tag+' · Tour '+r.vehicle, vehicle:r.vehicle,
          color:TOUR_COLORS[((r.vehicle||1)-1)%TOUR_COLORS.length],   // Farbe je Fahrzeug — über alle Tage stabil
          objektIds:steps.filter(s=>s.type==='job').map(s=>dayObjs[s.job-1].id),
          fahrtSec:r.duration||0, serviceSec:r.service||0,
          endeSec:steps.length?steps[steps.length-1].arrival:null,
        });
      });
      (sol.unassigned||[]).forEach(u=>{ const id=dayObjs[(u.id||0)-1]?.id; if(id) unassigned.push({tag,id}); });
    }
    if(!touren.length) throw new Error('Keine Tour entstanden — Häufigkeits-Tage prüfen');
    const kpi={ fzg:touren.length, objekte:einsaetze-unassigned.length, unassigned:unassigned.length,
      fahrtMin:Math.round(touren.reduce((s,t)=>s+(t.fahrtSec||0),0)/60), serviceMin:Math.round(touren.reduce((s,t)=>s+(t.serviceSec||0),0)/60) };
    const data={ name:'Wochenplan '+new Date().toLocaleDateString('de-DE')+' · '+n+' Fzg · '+_apRahmen.tage.join(''),
      status:'entwurf', createdAt:new Date().toISOString(), createdBy:(currentUser&&currentUser.email)||'',
      params:{fahrzeuge:n,von,bis,depot,saison,tage:[..._apRahmen.tage],freqTage:JSON.parse(JSON.stringify(_apRahmen.freqTage)),distanz:distFn?'strasse':'luftlinie',fixierungen:(_apRahmen.locks||[]).length}, kpi, touren, unassigned };
    let id;
    try{ const ref=await addDoc(collection(db,'projects',currentProjectId,'planVarianten'),data); id=ref.id; }
    catch(e){
      if(e&&e.code==='permission-denied'){ id='_local'+Date.now(); _apRulesHint=true; } // Regel noch nicht deployt → Sitzungs-Variante
      else throw e;
    }
    _apVars.unshift({id,...data}); _apSel=id; _apDay=null; _apHiddenTours.clear();
    notify('✓ Wochenplan erzeugt: '+touren.length+' Touren an '+_apRahmen.tage.length+' Tagen, '+kpi.objekte+' Einsätze');
  }catch(e){ console.warn('apGenerate',e); notify('Auto-Planung: '+(e.message||e)); }
  _apBusy=false; renderAutoplan();
}
async function apDelete(id){
  const v=_apVars.find(x=>x.id===id); if(!v) return;
  if(!await confirmByName({label:'Variante', name:v.name||''})) return;
  if(!String(id).startsWith('_local')){
    try{ await deleteDoc(doc(db,'projects',currentProjectId,'planVarianten',id)); }
    catch(e){ console.warn('apDelete',e); notify(dlErr(e)); return; }
  }
  _apVars=_apVars.filter(x=>x.id!==id);
  if(_apSel===id) _apSel=_apVars[0]?.id||null;
  notify('Variante gelöscht'); renderAutoplan();
}

function renderControlling(){
  if(!currentProjectId){ document.getElementById('ctrl-kpis').innerHTML='<div style="padding:20px;color:var(--text3);">Bitte zuerst ein Projekt öffnen.</div>'; return; }
  _applyCtrlWidgetVis();
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
  if(fBaumart) activeFilters.push(`${FL.art||'Typ/Art'}: ${fBaumart}`);
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
  const _kpis=[
    {id:'kpi_gesamt',val:filtered.length,lbl:'Gesamt',sub:'Objekte im Projekt',color:'var(--text)'},
    {id:'kpi_erledigt',val:bewaessert.length,lbl:'Erledigt',sub:`${pct}% der Meldungen`,color:'#16a34a'},
    {id:'kpi_nicht',val:nicht.length,lbl:'Nicht erledigt',sub:'Einzelmeldungen',color:'var(--red)'},
    {id:'kpi_meldungen',val:totalReported,lbl:'Meldungen gesamt',sub:'im Zeitraum',color:'var(--text2)'},
    {id:'kpi_fahrer',val:activeFahrer,lbl:'Aktive Fahrer',sub:'im Zeitraum',color:'var(--blue)'},
  ].filter(k=>_ctrlWidgetOn(k.id));
  if(kpiEl){ kpiEl.style.display=_kpis.length?'grid':'none'; kpiEl.style.gridTemplateColumns=`repeat(${_kpis.length||1},1fr)`; }
  if(kpiEl) kpiEl.innerHTML=_kpis.map(k=>`<div class="kpi-card">
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
  if(_ctrlWidgetOn('chart_pie')) renderPieChart(finalBewCount,finalNichtCount); else destroyChart('pie');
  if(_ctrlWidgetOn('chart_tour')) renderBarChart(filtered,finalReported); else destroyChart('bar');
  if(_ctrlWidgetOn('chart_zeit')) renderTimelineChart(finalReported,from,to); else destroyChart('timeline');
  if(_ctrlWidgetOn('chart_stadtteil')) renderStadtteilChart(filtered,finalReported); else destroyChart('stadtteil');
  if(_ctrlWidgetOn('gruende')) renderReasonsBar(finalReported.filter(r=>r.lastStatus==='nicht'));
  if(_ctrlWidgetOn('einzelmeldungen')) renderDetailTable(finalReported);
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
      <td style="padding:8px 12px;font-size:12px;font-weight:500;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${dlEsc(orTitel(tree,_containerByExt)||'')}">${dlEsc(orTitel(tree,_containerByExt)||'–')}</td>
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
          <div style="font-size:13px;font-weight:600;">${dlEsc(h.tourName||'–')} <span style="font-weight:400;color:var(--text3);font-size:12px;">· ${dlEsc(h.date||'')}</span></div>
          <div style="font-size:11px;color:var(--text3);">Fahrer: ${dlEsc(h.closedBy||'–')}</div>
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
      <td style="padding:6px 10px;font-size:12px;font-weight:500;">${dlEsc(t.name||'–')}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text2);">${dlEsc(t.baumnr||'–')}</td>
      <td style="padding:6px 10px;">${stSel}</td>
      <td style="padding:6px 10px;min-width:120px;">${reasonInp}</td>
      <td style="padding:6px 10px;font-size:11px;color:var(--text2);">${dlEsc(t.lastDriver||'–')}</td>
    </tr>`;
  }).join('');

  modal.innerHTML=`<div style="background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow-md);width:860px;max-width:95vw;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;">
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">
      <div style="flex:1;">
        <div style="font-size:15px;font-weight:600;">${dlEsc(h.tourName||'–')} — ${dlEsc(h.date||'')}</div>
        <div style="font-size:12px;color:var(--text3);">Fahrer: ${dlEsc(h.closedBy||'–')} · ${h.stats?.bewaessert||0} erledigt · ${h.stats?.nicht||0} nicht erledigt</div>
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
  const h=historyCache[histId]||{};
  const nm=h.tourName||h.name||'';
  if(!await confirmByName({title:'Historien-Eintrag löschen', label:'Eintrag', name:nm,
    warn:`Dieser historische Tour-Eintrag${nm?` (<b style="color:var(--text);">${dlEsc(nm)}</b>)`:''} wird dauerhaft gelöscht (Controlling-Daten gehen verloren).`})) return;
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
  const header=`Tour;Datum;Fahrer;${FL.name||'Anlage/Straße'};${FL.stadtteil||'Stadtteil'};${FL.art||'Typ/Art'};${FL.baumnr||'Objektnr.'};Status;Grund;Notiz;${FL.zustand||'Zustand'};${FL.wasser||'Wasserbedarf'}`;
  const rows=h.trees.map(t=>[
    h.tourName,h.date,t.lastDriver||'',orTitel(t,_containerByExt)||'',t.stadtteil||'',t.art||'',t.baumnr||'',
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
  const filtered=(q||'').trim()
    ?_allReportedCache.filter(t=>matchTerms([t.name,t.baumnr,t.stadtteil,t.art].join(' '), q))
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
  const header=`${FL.name||'Anlage/Straße'};${FL.stadtteil||'Stadtteil'};${FL.art||'Typ/Art'};${FL.baumnr||'Objektnr.'};Tour;Status;Grund;Fahrer;Datum`;
  const rows=reported.map(t=>{
    const tour=tours.find(x=>x.id===t.tourId);
    return [orTitel(t,_containerByExt),t.stadtteil,t.art,t.baumnr,tour?.name||'',t.lastStatus,t.lastReason||'',t.lastDriver||'',t.lastReportAt?.slice(0,10)||'']
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
    if(!_lassoSelectable(tree))return; // nur was sichtbar ist — keine inaktiven/weggefilterten Objekte einsammeln
    const pt=map.latLngToContainerPoint(L.latLng(tree.lat,tree.lng));
    if(touchesLasso(pt.x+offX,pt.y+offY,MARKER_RADIUS)) selected.push(tree);
  });
  // Geometrie-Objekte (Fläche/Strecke/Straßenabschnitt) ohne Marker: über Stützpunkte der Geometrie —
  // getroffen, sobald EIN (gesampelter) Geometriepunkt im Lasso liegt. Zusätzlich bei Flächen:
  // Treffer, wenn das Lasso komplett INNERHALB der Fläche gezogen wurde (Lasso-Punkt in Polygon).
  const _l0=lassoPoints[0];
  trees.forEach(tree=>{
    if((tree.lat&&tree.lng) || !_hasDrawnGeom(tree) || _isContainer(tree)) return; // Container nicht planbar — nur seine Seiten
    if(!isActive(tree) || !treeVisibleSel(tree)) return;                            // nur Sichtbares
    if(objFilterOnMap && !objMatchesPropFilter(tree)) return;
    const g=_treeGeom(tree); if(!g) return;
    const isPoly = g.type==='Polygon';
    const ring = isPoly ? (g.coordinates[0]||[]) : (g.coordinates||[]);
    if(!ring.length) return;
    const proj = ring.map(c=>{ const p=map.latLngToContainerPoint(L.latLng(c[1],c[0])); return {x:p.x+offX,y:p.y+offY}; });
    let hit=false;
    const step=Math.max(1,Math.floor(proj.length/12)); // höchstens ~12 Stützpunkte je Objekt prüfen (Perf)
    for(let i=0;i<proj.length;i+=step){ if(touchesLasso(proj[i].x,proj[i].y,4)){ hit=true; break; } }
    if(!hit && isPoly && _l0 && proj.length>=3 && pointInPolygon(_l0.x,_l0.y,proj)) hit=true; // Lasso liegt in der Fläche
    if(hit) selected.push(tree);
  });

  lassoPoints=[];
  if(selected.length===0){notify('Keine Objekte im Lasso-Bereich');return;}

  // NEU: Lasso trifft nur eine VORAUSWAHL — mehrere Lassos addieren sich. Geschrieben wird
  // erst, wenn der Nutzer in der Aktionsleiste Hinzufügen/Verschieben/Entfernen wählt.
  let added=0;
  selected.forEach(t=>{ if(!lassoSelection.has(t.id)){ lassoSelection.add(t.id); added++; } });
  remakeMarkers(selected.map(t=>t.id)); // Auswahl-Ringe zeigen (Punkt-Marker)
  _applyFlaechenSelection(); // Geometrie-Objekte (Fläche/Strecke) neu einfärben
  renderLassoActions();
  const st=_lassoStandorte();
  notify(`${lassoSelection.size} Objekte ausgewählt${added<selected.length?` (${added} neu)`:''}${st<lassoSelection.size?` — an nur ${st} Standorten (Mehrfach-Datensätze am selben Punkt!)`:''}`);
}
// Anzahl unterschiedlicher Koordinaten in der Vorauswahl — deckt gestapelte Mehrfach-Datensätze auf
function _lassoStandorte(){
  const s=new Set();
  lassoSelection.forEach(id=>{ const t=trees.find(x=>x.id===id); if(t&&t.lat&&t.lng) s.add(t.lat.toFixed(6)+','+t.lng.toFixed(6)); else s.add('g'+id); });
  return s.size;
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
  _applyFlaechenSelection();
  renderLassoActions();
}

function clearLassoSelection(){
  if(!lassoSelection.size){ renderLassoActions(); return; }
  const ids=[...lassoSelection]; lassoSelection.clear();
  remakeMarkers(ids);
  _applyFlaechenSelection();
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
  const _st=_lassoStandorte();
  bar.innerHTML=`<span style="font-weight:700;">${n} ausgewählt${_st<n?` <span style="font-weight:600;color:#fde68a;" title="Mehrere Datensätze liegen auf demselben Punkt">· nur ${_st} Standorte!</span>`:''}</span>
    ${btn('add','➕ Zu „'+tn+'“ hinzufügen','rgba(255,255,255,.18)')}
    ${btn('move','➡ Nach „'+tn+'“ verschieben','rgba(255,255,255,.18)')}
    ${btn('unplan','⊘ Aus Tour(en) entfernen','rgba(255,255,255,.18)')}
    <button onclick="clearLassoSelection()" style="padding:4px 11px;font-size:12px;border:1px solid rgba(255,255,255,.4);background:transparent;color:#fff;border-radius:var(--radius-sm);cursor:pointer;white-space:nowrap;">Auswahl aufheben</button>`;
  bar.classList.add('visible');
}

// Aktion auf die Vorauswahl anwenden: 'add' | 'move' | 'unplan'
async function lassoAction(mode){
  let targets=[...lassoSelection].map(id=>trees.find(t=>t.id===id)).filter(Boolean);
  if(!targets.length){ renderLassoActions(); return; }
  const tourId=assignTourId||lassoTourId;
  const tour=tours.find(t=>t.id===tourId);
  if((mode==='add'||mode==='move')&&!tourId){ notify('Bitte zuerst eine Ziel-Tour wählen'); return; }
  // Tour-Restriktion (Bulk): passende direkt zuweisen, unpassende per Override oder weglassen
  if((mode==='add'||mode==='move')&&tourHasRules(tour)){
    const bad=targets.filter(t=>!treeMatchesTour(t,tour));
    const good=targets.length-bad.length;
    if(bad.length){
      const r=await ruleWarnDialog(`<b>${bad.length}</b> von <b>${targets.length}</b> ausgewählten Objekten passen nicht zu den Regeln von <b>${dlEsc(tour?.name||'Tour')}</b>.`,'Trotzdem alle zuweisen', good>0?`Nur passende (${good})`:'');
      if(r==='cancel'){ renderLassoActions(); return; }
      if(r==='matching'){
        targets=targets.filter(t=>treeMatchesTour(t,tour));
        if(!targets.length){ notify('Keine passenden Objekte'); renderLassoActions(); return; }
      }
    }
  }
  // Bereits in der Ziel-Tour Verplante beim Hinzufügen überspringen — und das klar melden
  let schonDrin=0;
  if(mode==='add'){
    schonDrin=targets.filter(t=>treeInTour(t,tourId)).length;
    targets=targets.filter(t=>!treeInTour(t,tourId));
    if(!targets.length){
      notify(`⚠ Nichts hinzugefügt — alle ${schonDrin} ausgewählten Objekte sind bereits in „${tour?.name||'Tour'}"`);
      renderLassoActions();
      return;
    }
  }
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
        // Übersichten sind keine echten Touren → Verschieben/Entfernen lässt sie unangetastet
        const uebersichten=getTreeTourIds(tree).filter(id=>isOverviewTour(id));
        let newIds;
        if(mode==='add') newIds=[...new Set([...getTreeTourIds(tree),tourId])];
        else if(mode==='move') newIds=[...new Set([tourId,...uebersichten])];
        else newIds=uebersichten; // unplan → aus echten Touren raus, Übersichts-Zugehörigkeit bleibt
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
  renderDrawnGeoms(); // Geometrie-Objekte mit neuer Tour-Zuordnung umfärben
  rebuildAssignPills();
  renderLassoActions();
  setSyncState('ok','Synchronisiert');
  const verb=mode==='add'?`→ „${tour?.name||'Tour'}“ hinzugefügt`:mode==='move'?`→ „${tour?.name||'Tour'}“ verschoben`:'aus Tour(en) entfernt';
  notify(`✓ ${targets.length} Objekte ${verb}${schonDrin?` · ${schonDrin} übersprungen (bereits in der Tour)`:''}`);
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

  // Touren ermitteln: Abschnitt-Container hat selbst keine Touren → aus seinen Seiten sammeln (je Tour die Seiten merken)
  let rows;
  if(_isContainer(tree)){
    const map=new Map();
    for(const s of _ausstattungOf(tree.extId)){ for(const id of getTreeTourIds(s)){ const tr=tours.find(t=>t.id===id); if(!tr) continue; if(!map.has(id)) map.set(id,{tour:tr,sides:[]}); map.get(id).sides.push(_elemLabel(s)); } }
    rows=[...map.values()].map(v=>({color:v.tour.color,name:v.tour.name,sub:v.sides.join(' · '),ueb:!!v.tour.uebersicht}));
  } else {
    rows=getTreeTourIds(tree).map(id=>tours.find(t=>t.id===id)).filter(Boolean).map(t=>({color:t.color,name:t.name,sub:'',ueb:!!t.uebersicht}));
  }
  rows.sort((a,b)=>(a.ueb?1:0)-(b.ueb?1:0)); // echte Touren zuerst, Übersicht unten
  const _ps=planStatusOf(tree);
  const _ovd=overdueInfoOf(tree);
  const _ovdProblem = _ovd && (_ovd.status==='faellig'||_ovd.status==='ueber'||_ovd.status==='nie');
  if(rows.length===0 && !(_ps && _ps.status!=='kein') && !_ovdProblem) return; // kein Popup, wenn weder Tour noch aussagekräftiger Status
  const treeTourList=rows; // (Variablenname unten beibehalten)

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
  const _ttitle=_isContainer(tree)?((tree.name||'Abschnitt')):(tree.name||'–');
  const _rc=treeTourList.filter(t=>!t.ueb).length, _uc=treeTourList.length-_rc; // echte vs. Übersicht
  const _uebTag=`<span title="Übersicht — keine echte Tour, zählt nicht für die Planung" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:700;color:var(--text3);background:var(--surface2);border:1px solid var(--border);border-radius:99px;padding:0 6px;vertical-align:middle;margin-left:4px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Übersicht</span>`;
  popup.innerHTML=`
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);margin-bottom:8px;">
      ${dlEsc(_ttitle)} — Touren
    </div>
    ${(()=>{ if(!_ps||_ps.status==='kein') return ''; const col=planStatusColor(_ps);
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:5px 8px;border-radius:6px;background:${col}1f;"><span style="width:9px;height:9px;border-radius:50%;background:${col};flex:none;"></span><span style="font-size:12px;"><b style="color:${col};">${planStatusLabel(_ps)}</b> · Soll ${+_ps.soll.toFixed(2)} · Plan ${+_ps.plan.toFixed(2)}</span></div>`; })()}
    ${(()=>{ if(!_ovdProblem) return ''; const col=_checkColor('overdue',_ovd.status);
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;padding:5px 8px;border-radius:6px;background:${col}1f;"><span style="width:9px;height:9px;border-radius:50%;background:${col};flex:none;"></span><span style="font-size:12px;"><b style="color:${col};">${overdueLabel(_ovd)}</b>${_ovd.status==='ueber'&&_ovd.overdue!=null?' · '+Math.round(_ovd.overdue)+' Tage über':(_ovd.last?' · zuletzt '+_ovd.last.split('-').reverse().join('.'):'')}</span></div>`; })()}
    ${treeTourList.map(t=>`
      <div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border);${t.ueb?'opacity:.75;':''}">
        <div style="width:10px;height:10px;border-radius:50%;background:${t.color};flex-shrink:0;margin-top:2px;align-self:flex-start;"></div>
        <span style="min-width:0;"><span style="font-weight:600;color:${t.color};">${dlEsc(t.name)}</span>${t.ueb?_uebTag:''}${t.sub?`<br><span style="font-size:11px;color:var(--text3);">${dlEsc(t.sub)}</span>`:''}</span>
      </div>`).join('')}
    <div style="margin-top:8px;font-size:11px;color:var(--text3);">${_rc} Tour${_rc!==1?'en':''}${_uc?` · ${_uc} Übersicht`:''}</div>
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
  if(!await confirmByName({title:'Erfasser entfernen', label:'Erfasser', name:name||'', confirmText:'Entfernen'})) return;
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
  // Live-Lagebild: nur Meldungen zu HEUTE existierenden, aktiven Objekten. Protokolle zu
  // gelöschten/bereinigten Objekten gehören ins Controlling (tourHistory), nicht hierher.
  // Koordinaten/Name kommen vom LIVE-Objekt — Snapshots können veraltet/ohne Koordinaten sein.
  const liveById=new Map(trees.filter(isActive).map(t=>[t.id,t]));
  if(dashTourHistoryLoaded){
    dashTourHistory.forEach(h=>{
      if(!dashInRange(h.date))return;
      (h.trees||[]).forEach(tree=>{
        if(!tree.lastStatus||tree.lastStatus==='offen')return;
        const live=liveById.get(tree.id); if(!live)return;
        const at=tree.lastReportAt||h.date;
        const key=(tree.id||'')+'|'+dashDayStr(at);
        if(seen.has(key))return;   // Objekt in mehreren Touren → mehrere Snapshots am selben Tag NICHT doppelt zählen
        out.push({...live,lastStatus:tree.lastStatus,lastReason:tree.lastReason||null,lastNote:tree.lastNote||null,lastDriver:tree.lastDriver||null,lastReportAt:at,_tourId:h.tourId});
        seen.add(key);
      });
    });
  } else {
    trees.forEach(tree=>{
      if(!isActive(tree))return;
      (tree.history||[]).forEach(h=>{
        if(!h.date||!dashInRange(h.date))return;
        if(!h.status||h.status==='offen')return;
        out.push({...tree,lastStatus:h.status,lastReason:h.reason||null,lastDriver:h.driver||null,lastReportAt:h.date});
        seen.add((tree.id||'')+'|'+dashDayStr(h.date));
      });
    });
  }
  trees.forEach(tree=>{
    if(!isActive(tree))return;
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
// Übersichten sind nur Gruppierung (keine echten Touren) → ausgeschlossen, sonst Doppelzählung.
function dashTourStats(reported){
  return tours.filter(t=>!t.uebersicht).map(t=>{
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
    row.style.display = matchTerms(row.dataset.name, q) ? '' : 'none';
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
        <span class="dsh-tour-name">${dlEsc(t.name||'Tour')}</span>
        <span class="dsh-tour-pct">${pct}%</span>
      </div>
      <div class="dsh-bar">
        <div class="seg" style="width:${bewW}%;background:var(--green);"></div>
        <div class="seg" style="width:${nichtW}%;background:var(--dsh-red-mid);"></div>
        <div class="seg" style="width:${offenW}%;background:transparent;"></div>
      </div>
      <div class="dsh-tour-meta">
        <span><b style="color:var(--green);">${bewN}</b> erl.</span>
        <span><b style="color:var(--red);">${nichtN}</b> n. erl.</span>
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
    let _c=[52.279,8.047], _z=12; try{ if(map&&map.getCenter){ const mc=map.getCenter(); _c=[mc.lat,mc.lng]; _z=Math.min(map.getZoom()||12,13); } }catch(_){}
    dashNichtMap=L.map('dash-nicht-map',{zoomControl:true,attributionControl:false}).setView(_c,_z);   // Start am Projekt, nicht am alten Hessen-Default
    L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18}).addTo(dashNichtMap);
    dashNichtLayer=L.layerGroup().addTo(dashNichtMap);
    setTimeout(()=>dashNichtMap.invalidateSize(),200);
  }
  dashNichtLayer.clearLayers();
  const byId={};
  nichtReports.forEach(r=>{ const k=r.id||(r.lat+','+r.lng); if(!byId[k]||(r.lastReportAt||'')>(byId[k].lastReportAt||'')) byId[k]=r; });
  const uniq=Object.values(byId);
  // Flächen/Strecken haben keine lat/lng — ihr Anker-Punkt (Schwerpunkt/Mittelpunkt) kommt aus
  // der Geometrie (_routePoint), damit sie auf der Karte erscheinen statt in „ohne Koordinaten".
  const withPt=[], ohneArr=[];
  uniq.forEach(r=>{ const p=_routePoint(r); if(p) withPt.push({r,p}); else ohneArr.push(r); });
  const ohne=ohneArr.length;
  const countEl=document.getElementById('dash-map-count'); if(countEl) countEl.textContent=uniq.length>0?`${uniq.length} Objekte`:'';
  const noteEl=document.getElementById('dash-map-note'); if(noteEl) noteEl.textContent=ohne>0?`${ohne} ohne Koordinaten (nicht auf der Karte)`:'';
  const emptyEl=document.getElementById('dash-map-empty'); if(emptyEl) emptyEl.classList.toggle('show', uniq.length===0);
  const pts=[];
  withPt.forEach(({r,p})=>{
    const d=r.lastReportAt?new Date(r.lastReportAt).toLocaleDateString('de-DE'):'–';
    const meta=[r.stadtteil,r.baumnr].filter(Boolean).map(dlEsc).join(' · ');
    const gt=(typeof geomTypeOf==='function')?geomTypeOf(r):null;
    const gtLabel=gt==='flaeche'?' (Fläche)':gt==='linie'?' (Strecke)':'';
    const popup=`<b>${dlEsc(r.name||'Objekt')}${gtLabel}</b>`+(meta?`<br>${meta}`:'')+(r.art?`<br><i>${dlEsc(r.art)}</i>`:'')+
      `<br>Grund: <b style="color:#dc2626;">${dlEsc(r.lastReason||'nicht angegeben')}</b>`+
      (r.lastNote?`<br>Notiz: ${dlEsc(r.lastNote)}`:'')+(r.lastDriver?`<br>Fahrer: ${dlEsc(r.lastDriver)}`:'')+`<br>${d}`;
    L.marker(p,{icon:dashNichtIcon()}).bindPopup(popup).addTo(dashNichtLayer);
    pts.push(p);
  });
  if(pts.length>0) dashNichtMap.fitBounds(L.latLngBounds(pts),{padding:[40,40],maxZoom:16});
  else {
    // Keine „nicht erledigt"-Punkte mit Koordinaten → auf die Projekt-Objekte zentrieren (richtige Region),
    // sonst auf den Mittelpunkt der Hauptkarte — NICHT auf einem festen Fremd-Default hängenbleiben.
    const proj=(trees||[]).filter(t=>isActive(t)&&t.lat&&t.lng).map(t=>[t.lat,t.lng]);
    if(proj.length) dashNichtMap.fitBounds(L.latLngBounds(proj),{padding:[40,40],maxZoom:14});
    else { try{ if(map&&map.getCenter){ dashNichtMap.setView(map.getCenter(), Math.min(map.getZoom()||12,13)); } }catch(_){} }
  }
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

// ─── EINSATZPLANER (eigener Menüpunkt) ───────────────────────────────────────
// Verfügbarkeit (Personal & Fahrzeuge) ist MANDANTENWEIT (orgs-Ressourcen, je Tag);
// die Tour-Besetzung ist PROJEKTSCHARF. Superadmin wählt Mandant + Projekt, sonst Mandant fix.
let _epOrg='', _epProject='', _epDate='', _epTab='plan';
let _epOrgs=[], _epPersons=[], _epVehicles=[], _epProjects=[], _epTours=[], _epFunktionen=[];
let _epAvail={persons:{}, vehicles:{}}, _epSaveTimer=null;
const EP_PSTATES=[['anwesend','Anwesend','#15803d','#e7f3ea'],['krank','Krank','#c0392b','#fbeaea'],['urlaub','Urlaub','#b45309','#fbf0df'],['abwesend','Abwesend','#5f5e5a','#eeece6']];
const EP_VSTATES=[['verfuegbar','Verfügbar','#15803d','#e7f3ea'],['werkstatt','Werkstatt','#b45309','#fbf0df'],['ausgefallen','Ausgefallen','#c0392b','#fbeaea']];
function _epToday(){ const d=new Date(); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
let _epWeekMon=''; // Montag (YYYY-MM-DD) der angezeigten Woche im Reiter „Woche"
let _epWeekQuery=''; // Live-Filter (Tourname) im Reiter „Woche"
let _epWeekHideEmpty=true; // Touren ohne Termin in dieser Woche standardmäßig ausblenden
let _epDayQuery=''; // Live-Filter (Tour/Fahrer/Fahrzeug) im Reiter „Einsatzplan"
function _epFmtDate(dt){ return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0'); }
function _epMondayOf(date){ const [Y,M,D]=date.split('-').map(Number); const dt=new Date(Y,M-1,D); const wd=dt.getDay(); dt.setDate(dt.getDate()+(wd===0?-6:1-wd)); return _epFmtDate(dt); }
function _epAddDays(date,n){ const [Y,M,D]=date.split('-').map(Number); const dt=new Date(Y,M-1,D); dt.setDate(dt.getDate()+n); return _epFmtDate(dt); }
function _epIsoWeek(date){ const [Y,M,D]=date.split('-').map(Number); const dt=new Date(Date.UTC(Y,M-1,D)); const day=dt.getUTCDay()||7; dt.setUTCDate(dt.getUTCDate()+4-day); const ys=new Date(Date.UTC(dt.getUTCFullYear(),0,1)); return Math.ceil((((dt-ys)/86400000)+1)/7); }
function _epIntervalLabel(t){ const iv=(t&&t.interval)||''; if(iv==='bedarf') return 'nur bei Bedarf'; if(!iv) return 'immer (Bestand)'; const base={taeglich:'täglich',woechentlich:'wöchentlich','14taeglich':'14-täglich','4woechentlich':'4-wöchentlich'}[iv]||iv; return (iv!=='taeglich'&&t.startDate)?base+' ('+_epWdLetter(t.startDate)+')':base; }
function epWeekShift(d){ _epWeekMon=_epAddDays(_epWeekMon||_epMondayOf(_epDate||_epToday()),7*(d|0)); renderEp(); }
function epWeekThis(){ _epWeekMon=_epMondayOf(_epToday()); renderEp(); }
function epWeekToggleEmpty(){ _epWeekHideEmpty=!_epWeekHideEmpty; renderEp(); }
// Live-Filter im Wochenraster: blendet Zeilen ohne Treffer aus (kein Re-Render → Fokus bleibt)
function epWeekFilter(q){
  _epWeekQuery=(q||'').trim().toLowerCase();
  let vis=0, total=0;
  document.querySelectorAll('#ep-week-tbody tr').forEach(tr=>{ total++; const n=tr.getAttribute('data-epname')||''; const show=!_epWeekQuery||n.includes(_epWeekQuery); tr.style.display=show?'':'none'; if(show) vis++; });
  const c=document.getElementById('ep-week-count'); if(c) c.textContent=_epWeekQuery?`${vis} / ${total} Touren`:`${total} Tour${total===1?'':'en'} mit Rhythmus`;
}
// Live-Filter im Einsatzplan (Tagesansicht): Tour/Fahrer/Fahrzeug; blendet Zeilen aus (kein Re-Render)
function epDayFilter(q){
  _epDayQuery=(q||'').trim().toLowerCase();
  document.querySelectorAll('.ep-table tr[data-epname]').forEach(tr=>{ const n=tr.getAttribute('data-epname')||''; tr.style.display=(!_epDayQuery||n.includes(_epDayQuery))?'':'none'; });
  let vis=0,total=0; document.querySelectorAll('#ep-day-tbody tr[data-epname]').forEach(tr=>{ total++; if(tr.style.display!=='none') vis++; });
  const c=document.getElementById('ep-day-count'); if(c) c.textContent=_epDayQuery?`${vis} / ${total}`:'';
}
let _epAbsMonth=''; // YYYY-MM für die Abwesenheits-Timeline
let _epShowBedarf=false; // Bedarfstouren-Abschnitt im Einsatzplan aufgeklappt?
function epToggleBedarf(){ _epShowBedarf=!_epShowBedarf; renderEp(); }
const EP_ABS={urlaub:['Urlaub','#FAC775','#633806'], krank:['Krank','#F09595','#501313'], abwesend:['Abwesend','#B4B2A9','#2C2C2A']};
// Abwesenheit (Zeitraum an der Person) für ein Datum → Status oder null
function _epAbsenceFor(p,date){ if(!p||!Array.isArray(p.absences)) return null; return p.absences.find(a=>a&&a.from<=date&&a.to>=date)||null; }
function _epAbsenceStatus(p){ const a=_epAbsenceFor(p,_epDate); return a?a.type:null; }
// Tagesstatus des Personals = ausschließlich aus den Abwesenheiten abgeleitet (eine Quelle)
function _epPStatus(id){ const p=_epPersons.find(x=>x.id===id); return _epAbsenceStatus(p)||'anwesend'; }
function _epVStatus(id){ return _epAvail.vehicles[id]||'verfuegbar'; }
function _epPersonAvail(p){ return _epPStatus(p.id)==='anwesend'; }
function _epVehAvail(v){ return _epVStatus(v.id)==='verfuegbar'; }
// Wer erscheint im Einsatzplaner: expliziter Schalter (einsatz) gewinnt; sonst alle außer Büro-Rollen.
function _epPersonInPlan(p){ if(typeof p.einsatz==='boolean') return p.einsatz; return !['superadmin','orgadmin','admin','planer'].includes(p.role||''); }
// Läuft die Tour am gewählten Tag? (Besetzung sitzt an der Tour, belegt Ressourcen aber nur an deren Lauftagen.)
function _epRunsOn(t){ return !!t && ((t.interval||'')==='bedarf' ? _tourInValidity(t,_epDate) : tourDueOn(t,_epDate)); }
function _epPersonActive(p){ return !!p && p.active!==false; } // inaktive werden im Personal-Reiter grau gezeigt, aber nicht verplant
function _epHasLogin(p){ return !!p && !p.noLogin && (p.pinHash || p.role); }
function _epPersonName(id){ const p=_epPersons.find(x=>x.id===id); return p?p.name:id; }

async function initEinsatzplaner(){
  const root=document.getElementById('ep-root'); if(!root) return;
  root.innerHTML='<div style="padding:48px;text-align:center;color:var(--text3);font-size:13px;">Lädt…</div>';
  if(!_epDate) _epDate=_epToday();
  let orgs=[];
  if(currentRole==='superadmin'){ try{ const qs=await db.collection('orgs').get(); qs.forEach(d=>orgs.push({id:d.id,name:d.data().name||d.id})); }catch(e){ console.warn('ep orgs',e); } }
  else if(currentOrg){ orgs=[{id:currentOrg, name:_psOrgNames[currentOrg]||currentOrg}]; }
  orgs.sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  _epOrgs=orgs;
  if(!_epOrg || !orgs.find(o=>o.id===_epOrg)) _epOrg=(orgs.find(o=>o.id===currentProjectData?.orgId)?.id)||orgs[0]?.id||currentOrg||'';
  await epLoadOrgScope();
  renderEp();
}
async function epLoadOrgScope(){
  _epPersons=[]; _epVehicles=[]; _epProjects=[];
  if(!_epOrg) return;
  try{ const qs=await db.collection('drivers').where('orgId','==',_epOrg).get(); _epPersons=qs.docs.map(d=>({id:d.id,...d.data()})).filter(p=>_epPersonInPlan(p)).sort((a,b)=>(a.name||'').localeCompare(b.name||'')); }catch(e){ console.warn('ep drivers',e); }
  try{ const os=await db.collection('orgs').doc(_epOrg).get(); const od=os.exists?os.data():{}; const r=od.dispoResources; _epVehicles=(Array.isArray(r)&&r.length)?r.map(x=>({...x})):DISPO_DEFAULT_RES.map(x=>({...x})); _epFunktionen=_effFunktionen(od.funktionen, _epPersons); }catch(e){ _epVehicles=DISPO_DEFAULT_RES.map(x=>({...x})); _epFunktionen=_effFunktionen(null, _epPersons); }
  try{ const qs=await db.collection('projects').where('orgId','==',_epOrg).get(); _epProjects=qs.docs.map(d=>({id:d.id,name:d.data().name||d.id})).sort((a,b)=>a.name.localeCompare(b.name)); }catch(e){ console.warn('ep projects',e); }
  if(!_epProject || !_epProjects.find(p=>p.id===_epProject)) _epProject=(_epProjects.find(p=>p.id===currentProjectId)?.id)||_epProjects[0]?.id||'';
  await epLoadAvail(); await epLoadTours();
}
async function epLoadAvail(){
  _epAvail={persons:{}, vehicles:{}};
  if(!_epOrg||!_epDate) return;
  try{ const s=await db.collection('availability').doc(_epOrg+'_'+_epDate).get(); if(s.exists){ const d=s.data(); _epAvail={persons:d.persons||{}, vehicles:d.vehicles||{}}; } }catch(e){ console.warn('ep avail',e); }
}
async function epLoadTours(){
  _epTours=[];
  if(!_epProject) return;
  try{ const qs=await db.collection('projects').doc(_epProject).collection('tours').get(); _epTours=qs.docs.map(d=>({id:d.id,...d.data()})).filter(t=>!t.uebersicht).sort((a,b)=>(a.name||'').localeCompare(b.name||'')); }catch(e){ console.warn('ep tours',e); }
}
async function epChangeOrg(v){ _epOrg=v; _epProject=''; _epWeekQuery=''; _epDayQuery=''; const r=document.getElementById('ep-root'); if(r) r.innerHTML='<div style="padding:48px;text-align:center;color:var(--text3);">Lädt…</div>'; await epLoadOrgScope(); renderEp(); }
async function epChangeProject(v){ _epProject=v; _epWeekQuery=''; _epDayQuery=''; await epLoadTours(); renderEp(); }
async function epChangeDate(v){ _epDate=v||_epToday(); await epLoadAvail(); renderEp(); }
function epSetTab(t){ _epTab=t; renderEp(); }
function _epCanWrite(){ return currentRole==='superadmin'||currentCap==='admin'||currentCap==='editor'; }
function epPersist(){
  if(!_epCanWrite()) return;
  clearTimeout(_epSaveTimer);
  const org=_epOrg, date=_epDate, persons={..._epAvail.persons}, vehicles={..._epAvail.vehicles};
  _epSaveTimer=setTimeout(()=>{
    db.collection('availability').doc(org+'_'+date).set({orgId:org,date,persons,vehicles,updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true})
      .catch(e=>notify('Verfügbarkeit speichern fehlgeschlagen: '+(e.message||e)));
  },400);
}
function epSetVehicleStatus(id,st){ if(!_epCanWrite())return; if(st==='verfuegbar') delete _epAvail.vehicles[id]; else _epAvail.vehicles[id]=st; epPersist(); renderEp(); }

// Tour-Schreibvorgänge projektscharf (rohes db, KEIN _injectOrg — Projekt-Org kann vom aktuellen abweichen)
async function epTourUpdate(tid, patch){
  if(!_epCanWrite()){ notify('Nur Lesezugriff'); return false; }
  try{ await db.collection('projects').doc(_epProject).collection('tours').doc(tid).update(patch); return true; }
  catch(e){ notify('Fehler: '+(e.message||e)); return false; }
}
async function epAssignVehicle(tid, vehId){
  if(vehId){ const other=_epTours.find(x=>x.id!==tid && _epRunsOn(x) && x.vehicleId===vehId); if(other){ notify('Dieses Fahrzeug ist heute schon in „'+(other.name||'Tour')+'" verplant'); return; } }
  const v=_epVehicles.find(x=>x.id===vehId);
  if(await epTourUpdate(tid,{vehicleId:vehId||'', vehicleName:v?v.name:''})){ const t=_epTours.find(x=>x.id===tid); if(t){ t.vehicleId=vehId||''; t.vehicleName=v?v.name:''; } renderEp(); }
}
async function epAddDriver(tid, name){
  if(!name) return;
  const t=_epTours.find(x=>x.id===tid); const drivers=[...(t&&t.drivers||(t&&t.assignedDriver?[t.assignedDriver]:[]))];
  if(drivers.includes(name)){ notify('Bereits zugewiesen'); return; }
  const other=_epTours.find(x=>x.id!==tid && _epRunsOn(x) && (x.drivers||[]).includes(name));
  if(other){ notify('„'+name+'" ist heute schon in „'+(other.name||'Tour')+'" verplant'); return; }
  drivers.push(name);
  if(await epTourUpdate(tid,{drivers, assignedDriver:drivers[0]})){ if(t){ t.drivers=drivers; t.assignedDriver=drivers[0]; } renderEp(); }
}
async function epRemoveDriver(tid, idx){
  const t=_epTours.find(x=>x.id===tid); const drivers=[...(t&&t.drivers||(t&&t.assignedDriver?[t.assignedDriver]:[]))];
  drivers.splice(idx,1);
  if(await epTourUpdate(tid,{drivers, assignedDriver:drivers[0]||''})){ if(t){ t.drivers=drivers; t.assignedDriver=drivers[0]||''; } renderEp(); }
}
// Aktuelle Besetzung als festen Standard der Tour speichern (projektscharf am Tour-Doc)
async function epSetStandard(tid){
  const t=_epTours.find(x=>x.id===tid); if(!t) return;
  const stdDrivers=[...(t.drivers||(t.assignedDriver?[t.assignedDriver]:[]))];
  if(await epTourUpdate(tid,{stdVehicleId:t.vehicleId||'', stdVehicleName:t.vehicleName||'', stdDrivers})){
    t.stdVehicleId=t.vehicleId||''; t.stdVehicleName=t.vehicleName||''; t.stdDrivers=stdDrivers;
    notify('★ Standard für „'+(t.name||'Tour')+'" gespeichert'); renderEp();
  }
}
async function epApplyStandards(){
  if(!_epCanWrite()) return;
  const withStd=_epTours.filter(t=>_epRunsOn(t) && (t.stdVehicleId||(t.stdDrivers&&t.stdDrivers.length)));
  if(!withStd.length){ notify('Für den gewählten Tag sind keine Standardbesetzungen hinterlegt.'); return; }
  if(!confirm('Heutige Besetzung mit den gespeicherten Standards überschreiben?\n\n'+withStd.length+' Touren · nur heute verfügbare Ressourcen werden gesetzt.')) return;
  const availVehIds=new Set(_epVehicles.filter(_epVehAvail).map(v=>v.id));
  const availNames=new Set(_epPersons.filter(p=>_epPersonActive(p)&&_epPersonAvail(p)).map(p=>p.name));
  let skipped=0;
  try{
    const usedNames=new Set(), usedVeh=new Set();
    const batch=db.batch();
    withStd.forEach(t=>{
      const veh=(t.stdVehicleId&&availVehIds.has(t.stdVehicleId)&&!usedVeh.has(t.stdVehicleId))?t.stdVehicleId:'';
      if(veh) usedVeh.add(veh);
      const vehName=veh?((_epVehicles.find(v=>v.id===veh)||{}).name||''):'';
      const drivers=(t.stdDrivers||[]).filter(n=>availNames.has(n)&&!usedNames.has(n));
      drivers.forEach(n=>usedNames.add(n));
      if((t.stdVehicleId&&!veh)||((t.stdDrivers||[]).length>drivers.length)) skipped++;
      batch.update(db.collection('projects').doc(_epProject).collection('tours').doc(t.id), {vehicleId:veh, vehicleName:vehName, drivers, assignedDriver:drivers[0]||''});
      t.vehicleId=veh; t.vehicleName=vehName; t.drivers=drivers; t.assignedDriver=drivers[0]||'';
    });
    await batch.commit();
    renderEp();
    notify('✓ Standardbesetzung übernommen ('+withStd.length+' Touren'+(skipped?', '+skipped+' mit nicht verfügbaren Ressourcen':'')+')');
  }catch(e){ notify('Fehler: '+(e.message||e)); }
}

function _epInitials(n){ return (n||'?').split(/\s+/).map(w=>w[0]||'').join('').slice(0,2).toUpperCase(); }
function _epSeg(states, cur, fn, id){
  return `<div class="ep-seg">${states.map(([k,lbl,col,bg])=>`<button class="${cur===k?'on':''}" style="${cur===k?`background:${bg};color:${col};border-color:${col}55;`:''}" onclick="${fn}('${id}','${k}')">${lbl}</button>`).join('')}</div>`;
}
function epVerfuegbarHtml(){
  const ro=!_epCanWrite();
  const vAvail=_epVehicles.filter(_epVehAvail).length;
  const vCards=_epVehicles.length? _epVehicles.map(v=>{
    const st=_epVStatus(v.id); const meta=EP_VSTATES.find(s=>s[0]===st);
    return `<div class="ep-card">
      <div class="ep-card-head"><span class="ep-ava" style="background:${meta[3]};color:${meta[2]};"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17h13V7H3zM16 10h3l2 3v4h-5z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg></span><div style="min-width:0;"><div class="ep-name">${dlEsc(v.name||'–')}</div>${(v.art||v.kennzeichen)?`<div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${dlEsc([v.art,v.kennzeichen].filter(Boolean).join(' · '))}</div>`:''}<div class="ep-sub" style="color:${meta[2]};">${meta[1]}</div></div></div>
      ${ro?'':_epSeg(EP_VSTATES, st, 'epSetVehicleStatus', v.id)}</div>`;
  }).join('') : '<div class="ep-empty">Keine Fahrzeuge hinterlegt. (Reiter „Fuhrpark")</div>';
  return `
    <div class="ep-sec-head"><h3>Fahrzeuge — heute <span class="ep-count">${vAvail}/${_epVehicles.length} verfügbar</span></h3>
      <span style="margin-left:auto;font-size:11px;color:var(--text3);">Stammdaten unter „Fuhrpark" · Personal im Reiter „Personal"</span></div>
    <div class="ep-grid">${vCards}</div>`;
}
// ── Wochenübersicht: welche Tour an welchem Tag fällig ist (reiner Lesemodus, Rhythmus aus tourDueOn) ──
function epWeekHtml(){
  if(!_epProject) return '<div class="ep-empty">Kein Projekt vorhanden.</div>';
  if(!_epTours.length) return '<div class="ep-empty">Dieses Projekt hat keine (echten) Touren.</div>';
  if(!_epWeekMon) _epWeekMon=_epMondayOf(_epDate||_epToday());
  const days=[]; for(let i=0;i<7;i++) days.push(_epAddDays(_epWeekMon,i));
  const today=_epToday();
  const cw=_epCanWrite();
  const real=_epTours.filter(t=>(t.interval||'')!=='bedarf');
  const bedarf=_epTours.filter(t=>(t.interval||'')==='bedarf');
  const dueCount=days.map(d=>real.filter(t=>tourDueOn(t,d)).length);
  const a=_epWeekMon.split('-'), b=days[6].split('-');
  const rangeLbl='KW '+_epIsoWeek(_epWeekMon)+' · '+(+a[2])+'.'+(+a[1])+'.–'+(+b[2])+'.'+(+b[1])+'.'+b[0];
  const head=days.map(d=>{ const we=_epWeekend(d), to=d===today; return `<th style="padding:6px 0;font-size:11px;font-weight:${to?'700':'400'};color:${to?'#0f6e56':'var(--text3)'};background:${we?'var(--surface2)':'var(--surface)'};position:sticky;top:0;z-index:2;${to?'box-shadow:inset 0 -2px 0 #1d9e75;':''}">${_epWdLetter(d)}<br><span style="font-size:10px;">${+d.slice(8)}.${+d.slice(5,7)}.</span></th>`; }).join('');
  const rowFor=t=>{
    const col=t.color||'#888';
    const cnt=days.filter(d=>tourDueOn(t,d)).length;
    const hay=((t.name||'Tour')+' '+_epIntervalLabel(t)).toLowerCase();
    const hide=_epWeekQuery && !hay.includes(_epWeekQuery);
    const cells=days.map(d=>{
      const we=_epWeekend(d);
      if(tourDueOn(t,d)) return `<td style="padding:3px;${we?'background:var(--surface2);':''}"><div title="${dlEsc(t.name||'Tour')} — ${_epWdLetter(d)} ${+d.slice(8)}.${+d.slice(5,7)}." style="height:22px;border-radius:5px;background:${col}26;border:1px solid ${col}66;display:flex;align-items:center;justify-content:center;"><span style="width:7px;height:7px;border-radius:50%;background:${col};"></span></div></td>`;
      return `<td style="padding:3px;${we?'background:var(--surface2);':''}"><div style="height:22px;"></div></td>`;
    }).join('');
    return `<tr data-epname="${dlEsc(hay)}" style="border-top:1px solid var(--border);${cnt?'':'opacity:.5;'}${hide?'display:none;':''}"${cw?` oncontextmenu="epTourCtx(event,'${t.id}')"`:''}><td style="padding:6px 10px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"><span class="ep-dot" style="background:${col};"></span>${dlEsc(t.name||'Tour')}<div style="font-size:10px;color:var(--text3);margin-left:16px;">${dlEsc(_epIntervalLabel(t))}${cnt?'':' · diese Woche kein Termin'}</div></td>${cells}</tr>`;
  };
  const _dueThisWeek=t=>days.some(d=>tourDueOn(t,d));
  const emptyCount=real.filter(t=>!_dueThisWeek(t)).length;
  const shown=_epWeekHideEmpty?real.filter(_dueThisWeek):real;
  const rows=shown.map(rowFor).join('')||`<tr><td colspan="${days.length+1}" style="padding:18px;text-align:center;color:var(--text3);">Diese Woche ist keine Tour fällig.</td></tr>`;
  const visCount=_epWeekQuery?shown.filter(t=>(((t.name||'Tour')+' '+_epIntervalLabel(t)).toLowerCase()).includes(_epWeekQuery)).length:shown.length;
  const countTxt=_epWeekQuery?`${visCount} / ${shown.length} Touren`:`${shown.length} Tour${shown.length===1?'':'en'}${(_epWeekHideEmpty&&emptyCount)?` (von ${real.length})`:' mit Rhythmus'}`;
  const footCells=dueCount.map((c,i)=>`<td style="text-align:center;padding:7px 0;font-size:12px;font-weight:500;color:var(--text2);background:${_epWeekend(days[i])?'var(--surface2)':'var(--surface)'};border-top:2px solid var(--border);position:sticky;bottom:0;z-index:2;">${c||'–'}</td>`).join('');
  const bedarfNote=bedarf.length?`<div class="ep-foot" style="margin-top:10px;"><b>${bedarf.length} Bedarfstour${bedarf.length>1?'en':''}</b> ohne festen Rhythmus (${dlEsc(bedarf.map(t=>t.name||'Tour').join(', '))}) — erscheinen hier nicht, da sie nur bei Bedarf eingeplant werden.</div>`:'';
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn btn-secondary" style="padding:4px 11px;font-size:14px;" onclick="epWeekShift(-1)">‹</button>
      <span style="font-size:14px;font-weight:700;min-width:200px;text-align:center;">${rangeLbl}</span>
      <button class="btn btn-secondary" style="padding:4px 11px;font-size:14px;" onclick="epWeekShift(1)">›</button>
      <button class="btn btn-secondary" style="font-size:12px;padding:5px 12px;" onclick="epWeekThis()">Diese Woche</button>
      <input id="ep-week-search" value="${dlEsc(_epWeekQuery)}" oninput="epWeekFilter(this.value)" placeholder="🔍 Tour suchen…" autocomplete="off" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);min-width:170px;font-family:inherit;">
      ${(emptyCount>0||!_epWeekHideEmpty)?`<button class="btn btn-secondary" style="font-size:12px;padding:5px 12px;" onclick="epWeekToggleEmpty()" title="Touren, die diese Woche nicht laufen">${_epWeekHideEmpty?`Ohne Termin einblenden${emptyCount?` (${emptyCount})`:''}`:'Ohne Termin ausblenden'}</button>`:''}
      <span id="ep-week-count" style="margin-left:auto;font-size:11px;color:var(--text3);">${countTxt}</span>
    </div>
    <div style="overflow:auto;max-height:calc(100vh - 250px);border:1px solid var(--border);border-radius:10px;background:var(--surface);">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:560px;">
        <colgroup><col style="width:190px;">${days.map(()=>'<col>').join('')}</colgroup>
        <thead><tr><th style="text-align:left;padding:6px 10px;font-size:10px;color:var(--text3);position:sticky;top:0;left:0;z-index:3;background:var(--surface);">Tour</th>${head}</tr></thead>
        <tbody id="ep-week-tbody">${rows}</tbody>
        <tfoot><tr><td style="padding:7px 10px;font-size:10px;color:var(--text3);border-top:2px solid var(--border);position:sticky;bottom:0;left:0;z-index:3;background:var(--surface);">fällige Touren</td>${footCells}</tr></tfoot>
      </table>
    </div>
    <div class="ep-foot">Gefüllte Zelle = die Tour ist an dem Tag fällig (aus Intervall, Startdatum und Gültigkeitszeiträumen der Tour). Wochenende grau hinterlegt, heute grün markiert.${cw?' · Rechtsklick auf eine Tour öffnet „Tour bearbeiten".':''}</div>
    ${bedarfNote}`;
}
// ── Rechtsklick auf eine Tour → Kontextmenü „Tour bearbeiten" (springt in die Touren-Verwaltung) ──
let _epCtxEl=null;
function _epCloseCtx(){ if(_epCtxEl){ _epCtxEl.remove(); _epCtxEl=null; document.removeEventListener('mousedown',_epCtxOutside,true); document.removeEventListener('keydown',_epCtxKey,true); } }
function _epCtxOutside(e){ if(_epCtxEl && !_epCtxEl.contains(e.target)) _epCloseCtx(); }
function _epCtxKey(e){ if(e.key==='Escape') _epCloseCtx(); }
function epTourCtx(ev, tid){
  ev.preventDefault(); _epCloseCtx();
  if(!_epCanWrite()) return;
  const t=_epTours.find(x=>x.id===tid);
  const el=document.createElement('div'); el.className='ep-ctx';
  el.innerHTML=`<button onmouseover="this.style.background='var(--surface2)'" onmouseout="this.style.background='transparent'" onclick="_epCloseCtx();epEditTour('${_jsArg(tid)}')" style="display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;background:transparent;padding:8px 10px;font-size:13px;color:var(--text);border-radius:6px;cursor:pointer;"><span class="ep-dot" style="background:${t&&t.color||'#888'};"></span>Tour „${dlEsc((t&&t.name)||'Tour')}" bearbeiten</button>`;
  document.body.appendChild(el);
  const w=240; let left=Math.min(ev.clientX, window.innerWidth-w-8), top=ev.clientY;
  if(top+72>window.innerHeight) top=window.innerHeight-80;
  el.style.cssText=`position:fixed;left:${Math.max(8,left)}px;top:${Math.max(8,top)}px;width:${w}px;z-index:100000;background:var(--surface);border:1px solid var(--border);border-radius:9px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:4px;`;
  _epCtxEl=el;
  setTimeout(()=>{ document.addEventListener('mousedown',_epCtxOutside,true); document.addEventListener('keydown',_epCtxKey,true); },0);
}
function _epWaitForTour(tid){ return new Promise(res=>{ const t0=Date.now(); const iv=setInterval(()=>{ if((Array.isArray(tours)&&tours.find(x=>x.id===tid))||Date.now()-t0>4000){ clearInterval(iv); res(); } },120); }); }
async function epEditTour(tid){
  if(!tid || !_epCanWrite()) return;
  // Einsatzplaner kann ein anderes Projekt zeigen als das offene → erst dieses Projekt öffnen (Dialog schreibt projektscharf)
  if(_epProject && _epProject!==currentProjectId){
    const pname=(_epProjects.find(p=>p.id===_epProject)||{}).name||'Projekt';
    notify('Öffne Projekt „'+pname+'" …');
    try{ await openProject(_epProject); }catch(e){ notify('Projekt öffnen fehlgeschlagen: '+(e.message||e)); return; }
    await _epWaitForTour(tid); // tours laden per Snapshot — kurz warten, bis die Tour da ist
  }
  if(!(Array.isArray(tours)&&tours.find(x=>x.id===tid))){ notify('Tour nicht gefunden — bitte im Reiter „Touren" öffnen'); return; }
  switchView('touren');
  openTourModal(tid);
}
function epPlanHtml(){
  if(!_epProject) return '<div class="ep-empty">Kein Projekt vorhanden.</div>';
  if(!_epTours.length) return '<div class="ep-empty">Dieses Projekt hat keine (echten) Touren.</div>';
  const ro=!_epCanWrite();
  const availVeh=_epVehicles.filter(_epVehAvail), availPers=_epPersons.filter(p=>_epPersonActive(p)&&_epPersonAvail(p));
  // Nur die am gewählten Tag laufenden Touren belegen Personal/Fahrzeuge — an anderen Tagen ist die Ressource frei.
  const dueTours=_epTours.filter(t=>tourDueOn(t,_epDate));
  const bedarfTours=_epTours.filter(t=>t.interval==='bedarf' && _tourInValidity(t,_epDate));
  const activeTours=dueTours.concat(bedarfTours);
  // Auslastung (Personen-Verplanung) zählen — nur über die heute laufenden Touren
  const load={}; activeTours.forEach(t=>(t.drivers||[]).forEach(n=>load[n]=(load[n]||0)+1));
  const anyStd=activeTours.some(t=>t.stdVehicleId||(t.stdDrivers&&t.stdDrivers.length));
  const rowFor=t=>{
    const drivers=t.drivers||(t.assignedDriver?[t.assignedDriver]:[]);
    const _hay=((t.name||'Tour')+' '+drivers.join(' ')+' '+(t.vehicleName||'')).toLowerCase();
    const _hide=_epDayQuery && !_hay.includes(_epDayQuery);
    const vehOk=!t.vehicleId || availVeh.find(v=>v.id===t.vehicleId);
    const badVeh=t.vehicleId && !vehOk;
    const driverChips=drivers.length?drivers.map((n,i)=>{
      const pp=_epPersons.find(x=>x.name===n);
      const stat=pp?_epPStatus(pp.id):'anwesend';
      const unavail=!!pp && stat!=='anwesend';
      const dup=(load[n]||0)>1;
      const reason=unavail?((EP_PSTATES.find(s=>s[0]===stat)||[])[1]||'nicht verfügbar'):(dup?'doppelt':'');
      const bad=unavail||dup;
      const tip=n+(unavail?' — heute '+reason:(dup?' — an diesem Tag in mehreren Touren verplant':''));
      return `<span class="ep-chip${bad?' warn':''}" title="${dlEsc(tip)}">${dlEsc(n)}${bad?` <span class="ep-chip-r">${dlEsc(reason)}</span>`:''}${ro?'':`<i onclick="epRemoveDriver('${t.id}',${i})">×</i>`}</span>`;
    }).join(''):'';
    const vehSel=ro
      ? (t.vehicleName?`<span class="ep-chip${badVeh?' warn':''}">${dlEsc(t.vehicleName)}</span>`:'<span class="ep-dash">–</span>')
      : (t.vehicleId
          ? `<span class="ep-chip${badVeh?' warn':''}" style="cursor:pointer;" title="ändern" onclick="epOpenPicker('vehicle','${t.id}',this)">${dlEsc(t.vehicleName||'Fahrzeug')}</span> <i class="ep-clearx" title="entfernen" onclick="epAssignVehicle('${t.id}','')">×</i>`
          : `<button class="ep-pick-btn" onclick="epOpenPicker('vehicle','${t.id}',this)">＋ Fahrzeug</button>`);
    const drvAdd=ro?'':`<button class="ep-pick-btn" onclick="epOpenPicker('driver','${t.id}',this)">＋ Fahrer</button>`;
    const stdSet=!!(t.stdVehicleId||(t.stdDrivers&&t.stdDrivers.length));
    const stdTxt=[t.stdVehicleName||'',...(t.stdDrivers||[])].filter(Boolean).join(' · ');
    const stdHint=stdSet?`<div class="ep-std-hint" title="Standard">★ ${dlEsc(stdTxt)}</div>`:'';
    const star=ro?'':`<button class="ep-star${stdSet?' on':''}" title="${stdSet?'Standard: '+dlEsc(stdTxt)+' — ':''}aktuelle Besetzung als Standard für diese Tour speichern" onclick="epSetStandard('${t.id}')">★</button>`;
    return `<tr data-epname="${dlEsc(_hay)}"${_hide?' style="display:none;"':''} ${ro?'':`oncontextmenu="epTourCtx(event,'${t.id}')" ondragover="epDragOver(event)" ondragenter="this.classList.add('ep-drop')" ondragleave="this.classList.remove('ep-drop')" ondrop="this.classList.remove('ep-drop');epDrop(event,'${t.id}')"`}>
      <td><span class="ep-dot" style="background:${t.color||'#888'};"></span>${dlEsc(t.name||'Tour')}${stdHint}</td>
      <td>${vehSel}${badVeh?'<div class="ep-warn">⚠ Fahrzeug nicht verfügbar</div>':''}</td>
      <td><div class="ep-chips">${driverChips}${drvAdd}</div></td>
      <td style="text-align:center;">${star}</td>
    </tr>`;
  };
  const notRunning=_epTours.length-dueTours.length-bedarfTours.length;
  const besetzt=dueTours.filter(t=>(t.drivers&&t.drivers.length)||t.vehicleId).length;
  const _dayHay=t=>((t.name||'Tour')+' '+(t.drivers||(t.assignedDriver?[t.assignedDriver]:[])).join(' ')+' '+(t.vehicleName||'')).toLowerCase();
  const dayCountTxt=_epDayQuery?`${dueTours.filter(t=>_dayHay(t).includes(_epDayQuery)).length} / ${dueTours.length}`:'';
  const rows=dueTours.map(rowFor).join('')||`<tr><td colspan="4" style="padding:18px;text-align:center;color:var(--text3);">Heute läuft keine planmäßige Tour.</td></tr>`;
  const usedVehIds=new Set(activeTours.map(x=>x.vehicleId).filter(Boolean));
  const poolPers=availPers.map(p=>{ const used=(load[p.name]||0)>0; return `<span class="ep-pool${used?' used':''}" ${used?'':`draggable="true" ondragstart="epDragStart(event,'driver','${_jsArg(p.name)}')"`} title="${used?'bereits verplant':'auf eine Tour ziehen'}">${dlEsc(p.name)}${used?' ✓':''}</span>`; }).join('')||'<span class="ep-dash">keine anwesend</span>';
  const poolVeh=availVeh.map(v=>{ const used=usedVehIds.has(v.id); return `<span class="ep-pool veh${used?' used':''}" ${used?'':`draggable="true" ondragstart="epDragStart(event,'vehicle','${_jsArg(v.id)}')"`} title="${used?'bereits verplant':'auf eine Tour ziehen'}">${dlEsc(v.name)}${used?' ✓':''}</span>`; }).join('')||'<span class="ep-dash">keine verfügbar</span>';
  const stdBar=ro?'':`<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;">
    <button class="btn btn-secondary" style="font-size:12px;padding:6px 12px;${anyStd?'':'opacity:.5;cursor:not-allowed;'}" ${anyStd?'onclick="epApplyStandards()"':'disabled title="Noch keine Standards gespeichert"'}>★ Standardbesetzung übernehmen</button>
    <span style="font-size:11px;color:var(--text3);">Stern je Tour = aktuelle Besetzung als Standard merken. „Übernehmen" füllt den Tag aus den Standards (nur verfügbare).</span></div>`;
  return `
    ${stdBar}
    <div class="ep-pool-wrap"><div class="ep-pool-bar"><span class="ep-pool-lbl">Personen</span>${poolPers}</div><div class="ep-pool-bar"><span class="ep-pool-lbl">Fahrzeuge</span>${poolVeh}</div><div class="ep-pool-tip">Chip auf eine Tourzeile ziehen oder im „＋"-Feld per Tippsuche wählen.</div></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><input id="ep-day-search" value="${dlEsc(_epDayQuery)}" oninput="epDayFilter(this.value)" placeholder="🔍 Tour oder Fahrer suchen…" autocomplete="off" style="padding:5px 10px;font-size:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);min-width:200px;font-family:inherit;"><span id="ep-day-count" style="font-size:11px;color:var(--text3);">${dayCountTxt}</span></div>
    <div style="overflow:auto;max-height:calc(100vh - 340px);border:1px solid var(--border);border-radius:12px;"><table class="ep-table" style="border:none;border-radius:0;overflow:visible;"><thead><tr><th style="width:36%;position:sticky;top:0;z-index:2;">Tour</th><th style="width:25%;position:sticky;top:0;z-index:2;">Fahrzeug</th><th style="position:sticky;top:0;z-index:2;">Fahrer</th><th style="width:48px;text-align:center;position:sticky;top:0;z-index:2;" title="Standard für diese Tour">Std.</th></tr></thead><tbody id="ep-day-tbody">${rows}</tbody></table></div>
    ${bedarfTours.length?`<div style="margin-top:16px;">
      <button class="ep-bedarf-h" onclick="epToggleBedarf()">${_epShowBedarf?'▾':'▸'} Bedarfstouren (${bedarfTours.length}) — nur bei Bedarf einplanen</button>
      ${_epShowBedarf?`<table class="ep-table" style="margin-top:6px;"><thead><tr><th style="width:36%;">Tour</th><th style="width:25%;">Fahrzeug</th><th>Fahrer</th><th style="width:48px;text-align:center;">Std.</th></tr></thead><tbody>${bedarfTours.map(rowFor).join('')}</tbody></table>`:''}
    </div>`:''}
    <div class="ep-foot">${besetzt} / ${dueTours.length} fällige Touren besetzt${notRunning>0?` · ${notRunning} laufen heute nicht`:''}${ro?' · nur Lesezugriff':' · Rechtsklick auf eine Tour öffnet „Tour bearbeiten".'}</div>`;
}
// ── Suchbarer Picker (Tippsuche) für Fahrer/Fahrzeug — skaliert für 100+ Einträge ──
let _epPickerEl=null;
function _epClosePicker(){ if(_epPickerEl){ _epPickerEl.remove(); _epPickerEl=null; document.removeEventListener('mousedown',_epPickerOutside,true); document.removeEventListener('keydown',_epPickerKey,true); } }
function _epPickerOutside(e){ if(_epPickerEl && !_epPickerEl.contains(e.target)) _epClosePicker(); }
function _epPickerKey(e){ if(e.key==='Escape') _epClosePicker(); }
const _EP_TRUCK='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17h13V7H3zM16 10h3l2 3v4h-5z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>';
function epOpenPicker(type, tid, btn){
  _epClosePicker();
  const t=_epTours.find(x=>x.id===tid); if(!t) return;
  let items=[];
  if(type==='driver'){
    const drivers=t.drivers||(t.assignedDriver?[t.assignedDriver]:[]);
    const elsewhere={}; _epTours.forEach(x=>{ if(x.id!==tid && _epRunsOn(x))(x.drivers||[]).forEach(n=>{ elsewhere[n]=x.name; }); }); // heute schon in anderer (laufender) Tour
    items=_epPersons.filter(p=>_epPersonActive(p)&&_epPersonAvail(p)).filter(p=>!drivers.includes(p.name)).map(p=>({v:p.name, l:p.name, sub:p.funktion||'', right:elsewhere[p.name]?('in '+elsewhere[p.name]):'', warn:!!elsewhere[p.name], dis:!!elsewhere[p.name]}))
      .sort((a,b)=>(a.dis?1:0)-(b.dis?1:0)||a.l.localeCompare(b.l));
  } else {
    const used={}; _epTours.forEach(x=>{ if(x.id!==tid && _epRunsOn(x) && x.vehicleId) used[x.vehicleId]=x.name; });
    items=_epVehicles.map(v=>{ const av=_epVehAvail(v), u=used[v.id]; return {v:v.id, l:v.name, sub:[v.art,v.kennzeichen].filter(Boolean).join(' · '), right:!av?'nicht verfügbar':(u?('in '+u):''), warn:!!u, dis:!av||!!u}; })
      .sort((a,b)=>(a.dis?1:0)-(b.dis?1:0)||a.l.localeCompare(b.l));
  }
  const el=document.createElement('div'); el.className='ep-picker';
  el.innerHTML=`<div class="ep-picker-search"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg><input type="text" placeholder="${type==='driver'?'Fahrer suchen…':'Fahrzeug suchen…'}" autocomplete="off"><span class="ep-picker-cnt"></span></div><div class="ep-picker-list"></div>`;
  document.body.appendChild(el);
  const r=btn.getBoundingClientRect(), w=270;
  let left=Math.max(8, Math.min(r.left, window.innerWidth-w-12)), top=r.bottom+4;
  if(top+288>window.innerHeight) top=Math.max(8, r.top-292);
  el.style.cssText=`position:fixed;left:${left}px;top:${top}px;width:${w}px;z-index:100000;`;
  _epPickerEl=el;
  const input=el.querySelector('input'), listEl=el.querySelector('.ep-picker-list'), cntEl=el.querySelector('.ep-picker-cnt');
  const draw=q=>{
    q=(q||'').toLowerCase().trim();
    const f=items.filter(it=>!q || (it.l+' '+(it.sub||'')).toLowerCase().includes(q));
    cntEl.textContent=f.length+' / '+items.length;
    listEl.innerHTML=f.length?f.map(it=>`<div class="ep-picker-item${it.dis?' dis':''}" data-v="${dlEsc(it.v)}"><span class="ep-picker-ava">${type==='vehicle'?_EP_TRUCK:_epInitials(it.l)}</span><span class="ep-picker-l">${dlEsc(it.l)}${it.sub?`<span class="ep-picker-s">${dlEsc(it.sub)}</span>`:''}</span>${it.right?`<span class="ep-picker-x${it.warn?' warn':''}">${dlEsc(it.right)}</span>`:''}</div>`).join('')
      : '<div class="ep-picker-empty">Kein Treffer</div>';
  };
  draw('');
  input.oninput=()=>draw(input.value);
  const pick=v=>{ _epClosePicker(); if(type==='driver') epAddDriver(tid,v); else epAssignVehicle(tid,v); };
  listEl.onclick=e=>{ const it=e.target.closest('.ep-picker-item'); if(it && !it.classList.contains('dis')) pick(it.dataset.v); };
  input.onkeydown=e=>{ if(e.key==='Enter'){ const first=listEl.querySelector('.ep-picker-item:not(.dis)'); if(first) pick(first.dataset.v); } };
  setTimeout(()=>{ input.focus(); document.addEventListener('mousedown',_epPickerOutside,true); document.addEventListener('keydown',_epPickerKey,true); },0);
}
// ── Abwesenheiten (Zeiträume je Person) — eigener Reiter ──
function _epMonthDays(ym){ const [y,m]=ym.split('-').map(Number); const n=new Date(y,m,0).getDate(); const out=[]; for(let d=1;d<=n;d++) out.push(ym+'-'+String(d).padStart(2,'0')); return out; }
function _epWeekend(date){ const [Y,M,D]=date.split('-').map(Number); const wd=new Date(Y,M-1,D).getDay(); return wd===0||wd===6; }
function _epWdLetter(date){ const [Y,M,D]=date.split('-').map(Number); return ['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(Y,M-1,D).getDay()]; }
function _epMonthLabel(ym){ const [y,m]=ym.split('-').map(Number); return ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'][m-1]+' '+y; }
function epAbsShiftMonth(delta){ if(!_epAbsMonth) _epAbsMonth=_epDate.slice(0,7); let [y,m]=_epAbsMonth.split('-').map(Number); m+=delta; while(m<1){m+=12;y--;} while(m>12){m-=12;y++;} _epAbsMonth=y+'-'+String(m).padStart(2,'0'); renderEp(); }
function epAbsenceHtml(){
  if(!_epAbsMonth) _epAbsMonth=_epDate.slice(0,7);
  const ro=!_epCanWrite();
  const days=_epMonthDays(_epAbsMonth);
  const colW=Math.max(22, Math.floor(760/days.length));
  const activePersons=_epPersons.filter(_epPersonActive);
  const sel=_epDate, anw=activePersons.filter(_epPersonAvail).length;
  const reqCount=_epPersons.filter(p=>p.loginRequested && !_epHasLogin(p)).length;
  const todayMark=d=>d===sel?'box-shadow:inset 2px 0 0 #1d9e75,inset -2px 0 0 #1d9e75;':'';
  const headCells=days.map(d=>`<th style="padding:4px 0;font-weight:${d===sel?'700':'400'};font-size:9px;color:${d===sel?'#0f6e56':'var(--text3)'};${_epWeekend(d)?'background:var(--surface2);':''}${todayMark(d)}">${+d.slice(8)}<br>${_epWdLetter(d)}</th>`).join('');
  const rows=_epPersons.map(p=>{
    const cells=days.map(d=>{
      const a=_epAbsenceFor(p,d), we=_epWeekend(d);
      if(a){ const c=EP_ABS[a.type]||EP_ABS.abwesend; return `<td style="padding:1px;${we?'background:var(--surface2);':''}${todayMark(d)}"><div title="${c[0]} ${a.from}–${a.to}" ${ro?'':`onclick="epAbsOpenForm('${p.id}','${a.id||''}','')"`} style="height:18px;background:${c[1]};border-radius:3px;cursor:${ro?'default':'pointer'};"></div></td>`; }
      return `<td style="padding:1px;${we?'background:var(--surface2);':''}${todayMark(d)}" ${ro?'':`onclick="epAbsOpenForm('${p.id}','','${d}')"`}><div style="height:18px;cursor:${ro?'default':'pointer'};"></div></td>`;
    }).join('');
    const inactive=!_epPersonActive(p);
    const badge=inactive
      ? '<span style="font-size:9px;font-weight:700;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:5px;">inaktiv</span>'
      : (p.loginRequested && !_epHasLogin(p)
          ? '<span style="font-size:9px;font-weight:700;color:#9a6700;background:#fcefcb;padding:1px 6px;border-radius:5px;" title="App-Login beim Superadmin angefordert">🔑 Login angefordert</span>'
          : (_epHasLogin(p) ? '' : '<span style="font-size:9px;font-weight:700;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:5px;">ohne Login</span>'));
    const nameCell=ro
      ? `${dlEsc(p.name)}${p.funktion?` <span style="font-size:10px;color:var(--text3);">${dlEsc(p.funktion)}</span>`:''} ${badge}`
      : `<span onclick="epPersonOpenCard('${_jsArg(p.id)}')" title="Person verwalten" style="cursor:pointer;border-radius:5px;padding:1px 3px;">${dlEsc(p.name)}${p.funktion?` <span style="font-size:10px;color:var(--text3);">${dlEsc(p.funktion)}</span>`:''} ${badge}</span>`;
    return `<tr style="border-top:1px solid var(--border);${inactive?'opacity:.5;':''}"><td style="padding:4px 10px;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${nameCell}</td>${cells}</tr>`;
  }).join('')||`<tr><td colspan="${days.length+1}" style="padding:18px;color:var(--text3);text-align:center;">Noch kein Personal in diesem Mandanten — oben „＋ Mitarbeiter".</td></tr>`;
  const legend=Object.values(EP_ABS).map(c=>`<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--text2);"><span style="width:11px;height:11px;border-radius:3px;background:${c[1]};"></span>${c[0]}</span>`).join('');
  return `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
      <button class="btn btn-secondary" style="padding:4px 11px;font-size:14px;" onclick="epAbsShiftMonth(-1)">‹</button>
      <span style="font-size:14px;font-weight:700;min-width:130px;text-align:center;">${_epMonthLabel(_epAbsMonth)}</span>
      <button class="btn btn-secondary" style="padding:4px 11px;font-size:14px;" onclick="epAbsShiftMonth(1)">›</button>
      <span style="font-size:12px;background:var(--surface2);padding:4px 11px;border-radius:99px;color:var(--text2);" title="Anwesend am oben gewählten Tag">Gewählter Tag: <b>${anw}/${activePersons.length}</b> anwesend</span>
      ${ro?'':`<button class="btn btn-secondary" style="font-size:12px;padding:5px 12px;" onclick="epAbsOpenForm('','','')">+ Abwesenheit</button>
      <button class="btn btn-primary" style="font-size:12px;padding:5px 12px;" onclick="epPersonOpenCard('')">+ Mitarbeiter</button>`}
      <span style="margin-left:auto;display:flex;gap:12px;align-items:center;">${legend}</span>
    </div>
    <div style="overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--surface);">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed;min-width:${124+days.length*colW}px;">
        <colgroup><col style="width:124px;">${days.map(()=>`<col style="width:${colW}px;">`).join('')}</colgroup>
        <thead><tr><th style="text-align:left;padding:6px 10px;font-size:10px;color:var(--text3);">Person</th>${headCells}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="ep-foot">Klick auf einen <b>Namen</b> verwaltet die Person (umbenennen, Funktion, App-Login anfordern, deaktivieren/löschen). Klick auf eine <b>Tageszelle</b> setzt/bearbeitet eine Abwesenheit (auch „heute krank" = 1 Tag). „＋ Mitarbeiter" legt eine Person ohne Login an (kostenlos, sofort planbar). Den App-Login aktiviert nur der Superadmin.${reqCount?` · <b style="color:#9a6700;">${reqCount} Login-Anfrage${reqCount>1?'n':''} offen</b>`:''}</div>`;
}
// ── Person verwalten (Login-lose Mitarbeiter anlegen/pflegen; Login anfordern; deaktivieren/löschen) ──
function epPersonOpenCard(personId){
  if(!_epCanWrite()) return;
  if(!_epOrg){ notify('Kein Mandant gewählt'); return; }
  const p=personId?_epPersons.find(x=>x.id===personId):null;
  const isNew=!p, hasLogin=_epHasLogin(p), inactive=p&&!_epPersonActive(p), requested=p&&p.loginRequested&&!hasLogin;
  const canAdmin=(currentRole==='superadmin'||currentCap==='admin');
  const readOnly=hasLogin&&!canAdmin; // Login-Personen darf nur der Admin umbenennen (Rules erzwingen das)
  const orgName=(_epOrgs.find(o=>o.id===_epOrg)||{}).name||_epOrg;
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  const loginBox = isNew ? '' : (hasLogin
    ? `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#e7f3ea;border-radius:8px;"><span style="font-size:18px;">✓</span><div style="flex:1;font-size:12px;color:#15803d;">Hat einen App-Login. PIN/Deaktivierung verwaltet der Superadmin unter Admin → Benutzer.</div></div>`
    : `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:${requested?'#fcefcb':'var(--surface2)'};border-radius:8px;">
        <span style="font-size:20px;">🔑</span>
        <div style="flex:1;"><div style="font-size:13px;font-weight:700;color:${requested?'#9a6700':'var(--text)'};">${requested?'App-Login angefordert':'App-Login anfordern'}</div><div style="font-size:11px;color:var(--text3);">${requested?'Der Superadmin vergibt die PIN (kostenpflichtig).':'Meldet dem Superadmin: Person braucht einen Login.'}</div></div>
        <button id="pc-req" class="btn ${requested?'btn-secondary':'btn-primary'}" style="padding:6px 12px;font-size:12px;">${requested?'Anfrage zurückziehen':'Anfordern'}</button>
      </div>`);
  const dangerRow = (isNew||hasLogin) ? '' : `<div style="display:flex;gap:8px;">
      <button id="pc-active" class="btn btn-secondary" style="flex:1;padding:7px;font-size:12px;">${inactive?'Reaktivieren':'Deaktivieren'}</button>
      <button id="pc-del" class="btn btn-secondary" style="flex:1;padding:7px;font-size:12px;color:#c0392b;">Löschen</button>
    </div>`;
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:400px;max-width:94vw;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">${isNew?'Mitarbeiter anlegen':'Person verwalten'}<div style="font-size:11px;font-weight:400;color:var(--text3);margin-top:2px;">${dlEsc(orgName)}</div></div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;">
      <label style="font-size:12px;color:var(--text3);">Name<input id="pc-name" class="form-control" style="width:100%;margin-top:3px;" value="${dlEsc(p?p.name:'')}" placeholder="Vor- und Nachname" ${readOnly?'readonly':''}></label>
      <label style="font-size:12px;color:var(--text3);">Funktion / Einsatzgruppe<select id="pc-funktion" class="form-control" style="width:100%;margin-top:3px;" ${readOnly?'disabled':''}>${funktionenOptions(_epFunktionen, p?p.funktion||'':'')}</select></label>
      ${loginBox}
      ${dangerRow}
      <div style="font-size:11px;color:var(--text3);border-top:1px solid var(--border);padding-top:8px;">🔒 Kein PIN-Feld — den App-Login aktiviert ausschließlich der Superadmin (kostenpflichtig).</div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="pc-cancel" class="btn btn-secondary" style="padding:7px 12px;">${readOnly?'Schließen':'Abbrechen'}</button>
      ${readOnly?'':`<button id="pc-save" class="btn btn-primary" style="padding:7px 14px;">${isNew?'Anlegen':'Speichern'}</button>`}
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#pc-cancel').onclick=close;
  const saveBtn=m.querySelector('#pc-save');
  if(saveBtn) saveBtn.onclick=async()=>{
    const name=(m.querySelector('#pc-name').value||'').trim();
    const funktion=(m.querySelector('#pc-funktion').value||'').trim();
    if(!name){ notify('Bitte Name eingeben'); return; }
    close();
    if(isNew) await epPersonCreate(name, funktion);
    else await epPersonSave(p.id, name, funktion);
  };
  const reqBtn=m.querySelector('#pc-req'); if(reqBtn) reqBtn.onclick=()=>{ close(); epPersonRequestLogin(p.id, !requested); };
  const actBtn=m.querySelector('#pc-active'); if(actBtn) actBtn.onclick=()=>{ close(); epPersonToggleActive(p.id, !inactive); };
  const delBtn=m.querySelector('#pc-del'); if(delBtn) delBtn.onclick=()=>{ close(); epPersonDelete(p.id, p.name); };
  setTimeout(()=>m.querySelector('#pc-name')?.focus(),0);
}
async function epPersonCreate(name, funktion){
  if(!_epCanWrite()||!_epOrg) return;
  try{
    await db.collection('drivers').add({ orgId:_epOrg, name, nameLower:name.toLowerCase(), funktion, einsatz:true, noLogin:true, role:'', active:true, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
    notify('✓ „'+name+'" angelegt (ohne Login)');
    await epLoadOrgScope(); renderEp();
  }catch(e){ notify('Anlegen fehlgeschlagen: '+(e.message||e)); }
}
async function epPersonSave(id, name, funktion){
  const p=_epPersons.find(x=>x.id===id); if(!p) return;
  try{
    await db.collection('drivers').doc(id).update({ name, nameLower:name.toLowerCase(), funktion });
    p.name=name; p.nameLower=name.toLowerCase(); p.funktion=funktion; notify('✓ Gespeichert'); renderEp();
  }catch(e){ notify('Speichern fehlgeschlagen: '+(e.message||e)); }
}
async function epPersonRequestLogin(id, want){
  const p=_epPersons.find(x=>x.id===id); if(!p) return;
  try{
    await db.collection('drivers').doc(id).update({ loginRequested:!!want });
    p.loginRequested=!!want; notify(want?'🔑 App-Login angefordert — der Superadmin vergibt die PIN':'Anfrage zurückgezogen'); renderEp();
  }catch(e){ notify('Fehler: '+(e.message||e)); }
}
async function epPersonToggleActive(id, deactivate){
  const p=_epPersons.find(x=>x.id===id); if(!p) return;
  try{
    await db.collection('drivers').doc(id).update({ active:!deactivate });
    p.active=!deactivate; notify(deactivate?'Person deaktiviert':'Person reaktiviert'); renderEp();
  }catch(e){ notify('Fehler: '+(e.message||e)); }
}
async function epPersonDelete(id, name){
  const p=_epPersons.find(x=>x.id===id); if(!p) return;
  if(_epHasLogin(p)){ notify('Personen mit Login löscht der Superadmin (Admin → Benutzer).'); return; }
  if(!await confirmByName({label:'Person', name:name||'Person', warn:`<b style="color:var(--text);">${dlEsc(name||'Person')}</b> wirklich löschen? Nur möglich, weil die Person keinen App-Login hat.`})) return;
  try{
    await db.collection('drivers').doc(id).delete();
    notify('Person gelöscht');
    await epLoadOrgScope(); renderEp();
  }catch(e){ notify('Löschen fehlgeschlagen: '+(e.message||e)); }
}
function epAbsOpenForm(personId, absId, prefillDate){
  if(!_epCanWrite()) return;
  let pers=personId?_epPersons.find(p=>p.id===personId):null;
  let abs=(absId&&pers)?(pers.absences||[]).find(a=>a.id===absId):null;
  const today=_epToday();
  const from=abs?abs.from:(prefillDate||today), to=abs?abs.to:(prefillDate||today), type=abs?abs.type:'urlaub';
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:380px;max-width:94vw;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">${abs?'Abwesenheit bearbeiten':'Abwesenheit eintragen'}</div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:10px;">
      <label style="font-size:12px;color:var(--text3);">Person<select id="abf-person" class="form-control" style="width:100%;margin-top:3px;" ${personId?'disabled':''}>${_epPersons.map(p=>`<option value="${dlEsc(p.id)}"${p.id===personId?' selected':''}>${dlEsc(p.name)}</option>`).join('')}</select></label>
      <label style="font-size:12px;color:var(--text3);">Typ<select id="abf-type" class="form-control" style="width:100%;margin-top:3px;">${Object.entries(EP_ABS).map(([k,c])=>`<option value="${k}"${k===type?' selected':''}>${c[0]}</option>`).join('')}</select></label>
      <div style="display:flex;gap:10px;">
        <label style="font-size:12px;color:var(--text3);flex:1;">von<input id="abf-from" type="date" class="form-control" value="${from}" style="width:100%;margin-top:3px;"></label>
        <label style="font-size:12px;color:var(--text3);flex:1;">bis<input id="abf-to" type="date" class="form-control" value="${to}" style="width:100%;margin-top:3px;"></label>
      </div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:space-between;align-items:center;">
      <div>${abs?`<button id="abf-del" class="btn btn-danger" style="padding:7px 12px;">Löschen</button>`:''}</div>
      <div style="display:flex;gap:8px;"><button id="abf-cancel" class="btn btn-secondary" style="padding:7px 12px;">Abbrechen</button><button id="abf-save" class="btn btn-primary" style="padding:7px 14px;">Speichern</button></div>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#abf-cancel').onclick=close;
  if(abs) m.querySelector('#abf-del').onclick=()=>{ close(); epAbsDelete(personId, absId); };
  m.querySelector('#abf-save').onclick=async()=>{
    const pid=personId||m.querySelector('#abf-person').value;
    const t=m.querySelector('#abf-type').value, f=m.querySelector('#abf-from').value, tt=m.querySelector('#abf-to').value;
    if(!pid||!f||!tt){ notify('Bitte Person und Zeitraum angeben'); return; }
    if(tt<f){ notify('„bis" liegt vor „von"'); return; }
    close();
    await epAbsSave(pid, {id:absId||('a'+Math.random().toString(36).slice(2,8)), type:t, from:f, to:tt});
  };
}
async function epAbsSave(personId, entry){
  const p=_epPersons.find(x=>x.id===personId); if(!p) return;
  const list=(Array.isArray(p.absences)?p.absences.filter(a=>a.id!==entry.id):[]).concat([entry]);
  try{ await db.collection('drivers').doc(personId).update({absences:list}); p.absences=list; notify('✓ Abwesenheit gespeichert'); renderEp(); }
  catch(e){ notify('Fehler: '+(e.message||e)); }
}
async function epAbsDelete(personId, absId){
  const p=_epPersons.find(x=>x.id===personId); if(!p) return;
  const list=(p.absences||[]).filter(a=>a.id!==absId);
  try{ await db.collection('drivers').doc(personId).update({absences:list}); p.absences=list; notify('Abwesenheit gelöscht'); renderEp(); }
  catch(e){ notify('Fehler: '+(e.message||e)); }
}
// Drag & Drop: Pool-Chip auf eine Tourzeile ziehen
let _epDrag=null;
function epDragStart(e,type,val){ _epDrag={type,val}; try{ e.dataTransfer.setData('text/plain',type+':'+val); e.dataTransfer.effectAllowed='copy'; }catch(_){ } }
function epDragOver(e){ e.preventDefault(); try{ e.dataTransfer.dropEffect='copy'; }catch(_){ } }
function epDrop(e,tid){ e.preventDefault(); let d=_epDrag; if(!d){ let s=''; try{ s=e.dataTransfer.getData('text/plain')||''; }catch(_){ } const p=s.split(':'); if(p.length>=2) d={type:p[0],val:p.slice(1).join(':')}; } _epDrag=null; if(!d||!d.val) return; if(d.type==='driver') epAddDriver(tid,d.val); else if(d.type==='vehicle') epAssignVehicle(tid,d.val); }
function epVehById(id){ return _epVehicles.find(v=>v.id===id); }
function epVehField(id,field,val){
  const v=epVehById(id); if(!v) return;
  if(field==='arbeitszeitH'){ const h=parseFloat(val); v.arbeitszeitMin=isNaN(h)?0:Math.round(h*60); }
  else v[field]=val;
}
function epVehAdd(){ if(!(currentRole==='superadmin'||currentCap==='admin'))return; _epVehicles.push({id:'v'+Math.random().toString(36).slice(2,8), name:'Neues Fahrzeug', art:'', kennzeichen:'', arbeitszeitMin:420, notiz:'', depot:null, maxBins:0}); renderEp(); }
function epVehRemove(id){ if(!(currentRole==='superadmin'||currentCap==='admin'))return; _epVehicles=_epVehicles.filter(v=>v.id!==id); renderEp(); }
async function epVehSave(){
  if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Administratoren dürfen den Fuhrpark ändern'); return; }
  try{
    await dlFnCall('setOrgDispo',{orgId:_epOrg, resources:_epVehicles});
    if(_epOrg===currentProjectData?.orgId) currentDispoResources=_epVehicles.map(x=>({...x}));
    notify('✓ Fuhrpark gespeichert');
  }catch(e){ notify(fnErr(e)); }
}
function _epH(min){ return min?(+(min/60).toFixed(1))+' h':'–'; }
function epFuhrparkHtml(){
  const canEdit=currentRole==='superadmin'||currentCap==='admin';
  const arten=['PKW','Kleintransporter','LKW','Schlepper','Kehrmaschine','Anhänger','Sonstiges'];
  const rows=_epVehicles.map(v=>{
    if(!canEdit) return `<tr><td><span class="ep-dot" style="background:#888;"></span>${dlEsc(v.name||'–')}</td><td>${dlEsc(v.art||'–')}</td><td>${dlEsc(v.kennzeichen||'–')}</td><td>${_epH(v.arbeitszeitMin)}</td><td>${dlEsc(v.notiz||'')}</td></tr>`;
    return `<tr>
      <td><input class="ep-mini" style="width:100%;" value="${dlEsc(v.name||'')}" onchange="epVehField('${v.id}','name',this.value)" placeholder="Bezeichnung"></td>
      <td><input class="ep-mini" style="width:100%;" list="ep-veh-arten" value="${dlEsc(v.art||'')}" onchange="epVehField('${v.id}','art',this.value)" placeholder="Art/Typ"></td>
      <td><input class="ep-mini" style="width:100%;" value="${dlEsc(v.kennzeichen||'')}" onchange="epVehField('${v.id}','kennzeichen',this.value)" placeholder="z. B. RÜS-AB 123"></td>
      <td><input class="ep-mini" type="number" min="0" step="0.5" style="width:64px;" value="${v.arbeitszeitMin?+(v.arbeitszeitMin/60):''}" onchange="epVehField('${v.id}','arbeitszeitH',this.value)" title="Arbeitszeit Std/Tag"></td>
      <td><input class="ep-mini" style="width:100%;" value="${dlEsc(v.notiz||'')}" onchange="epVehField('${v.id}','notiz',this.value)" placeholder="Notiz"></td>
      <td style="text-align:right;"><button class="btn btn-danger" style="padding:3px 8px;font-size:12px;" onclick="epVehRemove('${v.id}')">✕</button></td>
    </tr>`;
  }).join('');
  const head=canEdit?'<th style="width:24%;">Bezeichnung</th><th style="width:18%;">Art/Typ</th><th style="width:18%;">Kennzeichen</th><th style="width:80px;">Std/Tag</th><th>Notiz</th><th style="width:40px;"></th>'
                    :'<th style="width:28%;">Bezeichnung</th><th>Art/Typ</th><th>Kennzeichen</th><th style="width:80px;">Std/Tag</th><th>Notiz</th>';
  return `
    <datalist id="ep-veh-arten">${arten.map(a=>`<option value="${a}">`).join('')}</datalist>
    <div class="ep-sec-head"><h3>Fuhrpark <span class="ep-count">${_epVehicles.length} Fahrzeuge</span></h3>
      ${canEdit?`<button class="btn btn-secondary" style="font-size:11px;padding:4px 10px;" onclick="epVehAdd()">+ Fahrzeug</button><button class="btn btn-primary" style="font-size:11px;padding:5px 14px;margin-left:auto;" onclick="epVehSave()">Speichern</button>`:'<span class="ep-count" style="margin-left:auto;">nur Lesezugriff</span>'}</div>
    <table class="ep-table"><thead><tr>${head}</tr></thead><tbody>${rows||'<tr><td colspan="6" style="color:var(--text3);">Noch keine Fahrzeuge — „+ Fahrzeug" anlegen.</td></tr>'}</tbody></table>
    <div class="ep-foot">Gemeinsame Fahrzeugquelle für Einsatzplaner und Disposition. Änderungen erst mit „Speichern" sichern.</div>`;
}
function renderEp(){
  const root=document.getElementById('ep-root'); if(!root) return;
  const orgSel=(currentRole==='superadmin'&&_epOrgs.length>1)
    ? `<label class="ep-field">Mandant<select onchange="epChangeOrg(this.value)">${_epOrgs.map(o=>`<option value="${dlEsc(o.id)}"${o.id===_epOrg?' selected':''}>${dlEsc(o.name)}</option>`).join('')}</select></label>` : '';
  const projSel=`<label class="ep-field">Projekt<select onchange="epChangeProject(this.value)">${_epProjects.length?_epProjects.map(p=>`<option value="${dlEsc(p.id)}"${p.id===_epProject?' selected':''}>${dlEsc(p.name)}</option>`).join(''):'<option value="">—</option>'}</select></label>`;
  const dateSel=`<label class="ep-field">Tag<input type="date" value="${_epDate}" onchange="epChangeDate(this.value)"></label>`;
  const tab=(k,lbl)=>`<button class="ep-tab${_epTab===k?' on':''}" onclick="epSetTab('${k}')">${lbl}</button>`;
  root.innerHTML=`
    <div class="ep-top">
      <div class="ep-top-l"><div class="ep-title">Einsatzplaner</div>${orgSel}${projSel}${dateSel}</div>
      <div class="ep-tabs">${tab('plan','Einsatzplan')}${tab('woche','Woche')}${tab('abwesenheiten','Personal')}${tab('verfuegbar','Fahrzeuge')}${tab('fuhrpark','Fuhrpark')}</div>
    </div>
    <div class="ep-body">${_epTab==='verfuegbar'?epVerfuegbarHtml():_epTab==='woche'?epWeekHtml():_epTab==='plan'?epPlanHtml():_epTab==='abwesenheiten'?epAbsenceHtml():epFuhrparkHtml()}</div>`;
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
    // Nach einer LEERUNG (letzte Meldung 'bewaessert') ist der Behälter leer → Prognose ab 0.
    // Nur wenn zuletzt NICHT geleert wurde (z. B. „nicht erledigt"), zählt der gemeldete Füllstand weiter.
    const base=(t.lastStatus==='bewaessert')?0:((typeof t.lastFuellgrad==='number')?t.lastFuellgrad:0);
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
  return `<div class="dispo-list-row" data-bin="${b.id}" onclick="dispoFocusPoint('${b.id}',event)" oncontextmenu="event.preventDefault()" style="cursor:pointer;">
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
    let _dc=[52.279,8.047], _dz=12; try{ if(map&&map.getCenter){ const mc=map.getCenter(); _dc=[mc.lat,mc.lng]; _dz=Math.min(map.getZoom()||12,13); } }catch(_){}
    dispoMap=L.map('dispo-map',{zoomControl:false,attributionControl:false}).setView(_dc,_dz);   // Start am Projekt, nicht am alten Hessen-Default
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
    return `<div class="ds-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px;" data-depot='${dAttr}' data-id="${dlEsc(r.id||'')}">
      <input class="form-control ds-r-name" style="flex:1;min-width:0;padding:5px 8px;font-size:12px;" value="${dlEsc(r.name||('Fahrzeug '+(i+1)))}">
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
    const _origRes=dispoGetResources();
    const newRes=[...listEl.querySelectorAll('.ds-row')].map((row,i)=>{
      let depot=null; const da=row.getAttribute('data-depot'); if(da){ try{ depot=JSON.parse(da); }catch(e){} }
      const id=row.getAttribute('data-id')||('v'+Math.random().toString(36).slice(2,8));
      const prev=_origRes.find(o=>o.id===id)||{}; // Zusatzfelder (art/kennzeichen/notiz) erhalten + stabile id
      return { ...prev, id, name:row.querySelector('.ds-r-name').value.trim()||('Fahrzeug '+(i+1)),
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
  // Geometrie/Mengen nur ausgeben, wenn vorhanden (Flächen-/Strecken-Projekte) — sonst weglassen
  const geomCount={punkt:0,flaeche:0,linie:0}; active.forEach(t=>{ const g=geomTypeOf(t); if(geomCount[g]!=null) geomCount[g]++; });
  let flSum=0, liSum=0; active.forEach(t=>{ const m=parseFloat(t.menge); if(!(m>0)) return; if(t.einheit==='m') liSum+=m; else flSum+=m; });
  const lines=[
    `Projekt: ${currentProjectData?.name||currentProjectId}`,
    `Auswertungszeitraum: ${r.label}${r.from?` (${fmtDateDE(r.from)} bis ${fmtDateDE(r.to)})`:''}`,
    `Objekte gesamt (aktiv): ${active.length}`,
    `${FL.zustand} (Bestand): ${rankList('zustand').map(e=>`${e.label} ${active.filter(t=>(t.zustand||'')===e.id).length}`).join(', ')}`,
    `Meldungen im Zeitraum: ${reps.length} gesamt — erledigt ${bew}, nicht erledigt ${nicht}; betroffene Objekte: ${objMitMeldung}; ohne Meldung im Zeitraum: ${active.length-objMitMeldung}`,
    `Gründe „nicht erledigt" (Zeitraum): ${gruende}`,
    `„Nicht erledigt" je ${FL.stadtteil} (Zeitraum): ${nichtStadtteil}`,
    `Objekte je ${FL.stadtteil} (Bestand): ${grp(active,t=>t.stadtteil)}`,
    `${FL.art} (Top): ${grp(active,t=>t.art,8)}`,
    `${FL.pflanzjahr} (Top): ${grp(active,t=>t.pflanzjahr,8)}`,
    `Touren (${tours.length}): ${tourStr}`,
  ];
  // Zeitlicher Verlauf (für Trend-Analysen) — je Tag, bei langem Zeitraum je Monat
  const byDay={}; reps.forEach(x=>{ (byDay[x.date]=byDay[x.date]||{b:0,n:0}); if(x.status==='nicht') byDay[x.date].n++; else byDay[x.date].b++; });
  const days=Object.keys(byDay).sort();
  if(days.length>=2){
    const useMonth=days.length>21, buck={};
    days.forEach(d=>{ const k=useMonth?d.slice(0,7):d; (buck[k]=buck[k]||{b:0,n:0}); buck[k].b+=byDay[d].b; buck[k].n+=byDay[d].n; });
    lines.push(`Verlauf (${useMonth?'je Monat':'je Tag'}, erledigt✓/nicht✗): ${Object.keys(buck).sort().map(k=>`${k} ${buck[k].b}✓/${buck[k].n}✗`).join(', ')}`);
  }
  if(geomCount.flaeche||geomCount.linie){
    lines.push(`Objekttypen: Punkte ${geomCount.punkt}, Flächen ${geomCount.flaeche}, Strecken ${geomCount.linie}`);
    if(flSum>0) lines.push(`Fläche gesamt: ${Math.round(flSum).toLocaleString('de-DE')} m²`);
    if(liSum>0) lines.push(`Länge gesamt: ${Math.round(liSum).toLocaleString('de-DE')} m`);
  }
  return lines.join('\n');
}

// Analysen sind objekt-neutral formuliert (Grünpflege, Straßenreinigung, Kontrollgänge …).
// „jung" ist bewusst objekt-spezifisch und kann je Projekt ausgeblendet werden.
const KI_PROMPTS=[
  {id:'ausfall',icon:'⚠️',title:'Ausfallanalyse',desc:'Warum werden Objekte nicht erledigt? Muster & Maßnahmen.',
   build:c=>`Du bist Fachexperte für kommunales Objekt- und Flächenmanagement (z. B. Grünpflege, Straßenreinigung, Kontrollgänge, Winterdienst). Analysiere die folgenden Daten. Finde Muster bei den nicht erledigten Objekten (Gründe, Gebiete, Touren), nenne die 3 wichtigsten Ursachen und konkrete, umsetzbare Maßnahmen zur Reduzierung der Ausfälle.\n\nDaten:\n${c}`},
  {id:'touren',icon:'🚐',title:'Tour-Effizienz',desc:'Ineffiziente Touren erkennen, Objekte sinnvoll umverteilen.',
   build:c=>`Analysiere die Touren hinsichtlich Effizienz (Anzahl Objekte je Tour, Streckenlänge, ggf. Mengen). Identifiziere unausgewogene oder ineffiziente Touren und schlage eine bessere Aufteilung der Objekte vor, um den Fahr- und Arbeitsaufwand zu minimieren. Begründe kurz.\n\nDaten:\n${c}`},
  {id:'kapazitaet',icon:'⚙️',title:'Kapazität & Auslastung',desc:'Über-/Unterlast je Tour, Umverteilung, Kapazitätsbedarf.',
   build:c=>`Bewerte die Auslastung je Tour anhand der Objektzahl, ggf. Mengen (m²/m) und Streckenlänge. Wo besteht Über- oder Unterlast? Schlage eine ausgewogenere Verteilung vor und schätze grob den nötigen Kapazitätsbedarf (Personal/Fahrzeuge).\n\nDaten:\n${c}`},
  {id:'risiko',icon:'🌡️',title:'Zustands-Priorisierung',desc:'Objekte/Gebiete mit schlechtem Zustand priorisieren.',
   build:c=>`Priorisiere nach ${FL.zustand} und Erledigungsstand: Welche Gebiete oder Objektgruppen mit schlechtem Zustand und ausbleibender Erledigung sind besonders dringend? Erstelle eine priorisierte Handlungsliste für die kommende Woche.\n\nDaten:\n${c}`},
  {id:'abdeckung',icon:'🗺️',title:'Abdeckungs-Lücken',desc:'Wo fehlt Erledigung? Erledigungsgrad je Gebiet.',
   build:c=>`Ermittle Erledigungslücken: Welche Objekte/Gebiete sind „offen" (keine Meldung im Zeitraum)? Wie hoch ist der Erledigungsgrad je Gebiet und Tour? Wo besteht der größte Handlungsbedarf?\n\nDaten:\n${c}`},
  {id:'gebiete',icon:'🏙️',title:'Gebiets-Vergleich',desc:'Bezirke/Gebiete vergleichen: Quote, offene Objekte.',
   build:c=>`Vergleiche die Gebiete (${FL.stadtteil}) miteinander: Erledigungsquote, Anzahl „nicht erledigt" und offene Objekte. Erstelle eine priorisierte Rangliste der Gebiete mit dem größten Handlungsbedarf und je einer konkreten Empfehlung.\n\nDaten:\n${c}`},
  {id:'trend',icon:'📈',title:'Entwicklung im Zeitverlauf',desc:'Trends bei Erledigung & Ausfällen, kurze Prognose.',
   build:c=>`Analysiere die zeitliche Entwicklung im Auswertungszeitraum (siehe „Verlauf"): Wie verändern sich Erledigungen und Ausfälle? Gibt es Trends, saisonale Muster oder Ausreißer? Leite eine kurze Einschätzung und eine Prognose für die nächsten Wochen ab.\n\nDaten:\n${c}`},
  {id:'qualitaet',icon:'🔎',title:'Grund-Analyse',desc:'Wiederkehrende Gründe für „nicht erledigt".',
   build:c=>`Untersuche die Gründe für „nicht erledigt" im Zeitverlauf und je Gebiet. Welche Probleme treten wiederholt auf, wo häufen sie sich, und welche organisatorischen oder technischen Gegenmaßnahmen empfiehlst du? Nach Wirkung/Aufwand priorisieren.\n\nDaten:\n${c}`},
  {id:'mengen',icon:'📐',title:'Flächen-/Mengen-Auswertung',desc:'Aufwand nach Fläche/Länge (m²/m).',
   build:c=>`Werte die Mengen (Flächen in m², Strecken in m) aus: Wo konzentriert sich der Aufwand (Gebiete, Touren, Objekttypen)? Gibt es Auffälligkeiten zwischen Mengen und Erledigungsquote? Falls kaum Mengendaten vorliegen, weise ausdrücklich darauf hin.\n\nDaten:\n${c}`},
  {id:'jung',icon:'🌱',title:'Jungbaum-Check',desc:'Nur Baumpflege: werden frisch gepflanzte Bäume ausreichend versorgt?',
   build:c=>`Jung gepflanzte Bäume benötigen besonders viel Wasser. Prüfe anhand der ${FL.pflanzjahr}-Angaben, ob die jüngsten Objekte ausreichend versorgt werden, und gib konkrete Empfehlungen für deren Pflege.\n\nDaten:\n${c}`},
  {id:'bericht',icon:'📋',title:'Management-Bericht',desc:'Kompakter Wochenbericht für die Amtsleitung.',
   build:c=>`Erstelle einen prägnanten Management-Wochenbericht (max. 1 Seite): aktuelle Lage, Fortschritt, nicht erledigte Objekte/Ausfälle, Risiken und 3 Empfehlungen. Sachlicher Ton, für die Amtsleitung.\n\nDaten:\n${c}`},
  {id:'frei',icon:'💬',title:'Eigene Frage',desc:'Freie Frage an die KI – Projektdaten als Kontext.',
   build:c=>`Beantworte die folgende Frage anhand der Projektdaten.\n\nFRAGE: [hier deine Frage eintragen]\n\nDaten:\n${c}`},
];

// Projektweite Auswahl, welche Analysen sichtbar sind (am Projekt-Doc, Feld kiAnalysen)
function _kiOn(id){ const w=currentProjectData&&currentProjectData.kiAnalysen; if(!w||typeof w!=='object') return true; return w[id]!==false; }
function _kiCanConfig(){ return currentRole==='superadmin'||currentCap==='admin'; }
function renderKi(){
  const grid=document.getElementById('ki-grid'); if(!grid) return;
  const list=KI_PROMPTS.filter(p=>_kiOn(p.id));
  grid.innerHTML=list.length?list.map(p=>`<button class="ki-card" onclick="openKiPrompt('${p.id}')">
    <div class="ki-ic">${p.icon}</div>
    <div class="ki-tt">${p.title}</div>
    <div class="ki-dd">${p.desc}</div>
  </button>`).join(''):'<div style="grid-column:1/-1;color:var(--text3);font-size:13px;padding:20px;">Für dieses Projekt sind keine Analysen freigeschaltet.</div>';
  const btn=document.getElementById('ki-cfg-btn'); if(btn) btn.style.display=(currentProjectId&&_kiCanConfig())?'':'none';
}
async function toggleKiAnalyse(id,on){
  if(!_kiCanConfig()||!currentProjectId) return;
  const w=Object.assign({},(currentProjectData&&currentProjectData.kiAnalysen)||{});
  w[id]=!!on;
  if(currentProjectData) currentProjectData.kiAnalysen=w;
  renderKi();
  try{ await updateDoc(doc(db,'projects',currentProjectId),{kiAnalysen:w}); }
  catch(e){ console.warn('kiAnalysen speichern',e); notify(dlErr(e)); }
}
async function resetKiAnalysen(){
  if(!_kiCanConfig()||!currentProjectId) return;
  if(currentProjectData) currentProjectData.kiAnalysen={};
  renderKi();
  const m=document.getElementById('ki-cfg-menu'); if(m) m.querySelectorAll('input[type=checkbox]').forEach(c=>c.checked=true);
  try{ await updateDoc(doc(db,'projects',currentProjectId),{kiAnalysen:{}}); }
  catch(e){ console.warn('kiAnalysen reset',e); notify(dlErr(e)); }
}
function openKiConfigMenu(btn){
  const ex=document.getElementById('ki-cfg-menu'); if(ex){ ex.remove(); return; }
  if(!_kiCanConfig()) return;
  const r=btn.getBoundingClientRect();
  const m=document.createElement('div'); m.id='ki-cfg-menu';
  m.style.cssText=`position:fixed;top:${Math.round(r.bottom+4)}px;left:${Math.round(Math.max(8,r.right-300))}px;z-index:9999;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:8px;width:300px;max-height:76vh;overflow:auto;`;
  let html=`<div style="font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:var(--text2);padding:4px 6px 6px;">Sichtbare Analysen (projektweit)</div>`;
  html+=KI_PROMPTS.map(p=>`<label style="display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:6px;cursor:pointer;font-size:13px;" onmouseenter="this.style.background='var(--surface2)'" onmouseleave="this.style.background=''">
      <input type="checkbox" ${_kiOn(p.id)?'checked':''} onchange="toggleKiAnalyse('${p.id}',this.checked)" style="width:15px;height:15px;cursor:pointer;margin-top:2px;">
      <span><span style="margin-right:5px;">${p.icon}</span>${dlEsc(p.title)}<span style="display:block;color:var(--text3);font-size:11px;">${dlEsc(p.desc)}</span></span></label>`).join('');
  html+=`<div style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px;"><button class="btn btn-secondary" style="width:100%;padding:5px;font-size:11px;" onclick="resetKiAnalysen()">Alle einblenden</button></div>`;
  m.innerHTML=html;
  document.body.appendChild(m);
  setTimeout(()=>{ const close=ev=>{ if(!m.contains(ev.target)&&ev.target!==btn&&!btn.contains(ev.target)){ m.remove(); document.removeEventListener('mousedown',close); } }; document.addEventListener('mousedown',close); },0);
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
// ── Flächen-Bundle einspielen (Superadmin): Geometrie → Storage, Datensätze → Firestore ──
async function flaechenImportOpen(){
  if(currentRole!=='superadmin'){ notify('Nur Superadmin'); return; }
  let projs=[];
  try{ const [pq,oq]=await Promise.all([db.collection('projects').get(),db.collection('orgs').get()]);
    const on={}; oq.forEach(d=>on[d.id]=d.data().name||d.id);
    projs=pq.docs.map(d=>({id:d.id,name:d.data().name||d.id,orgId:d.data().orgId,org:on[d.data().orgId]||d.data().orgId})).sort((a,b)=>((a.org||'')+a.name).localeCompare((b.org||'')+b.name));
  }catch(e){ notify('Projekte laden fehlgeschlagen'); return; }
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:460px;max-width:94vw;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">⬗ Flächen-Bundle einspielen</div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;font-size:13px;">
      <label style="font-size:12px;color:var(--text3);">Zielprojekt<select id="fi-proj" class="form-control" style="width:100%;margin-top:3px;">${projs.map(p=>`<option value="${dlEsc(p.id)}|${dlEsc(p.orgId)}"${p.id===currentProjectId?' selected':''}>${dlEsc(p.org)} · ${dlEsc(p.name)}</option>`).join('')}</select></label>
      <label style="font-size:12px;color:var(--text3);">Geometrie-Bundle (essen-flaechen.geojson)<input id="fi-bundle" type="file" accept=".geojson,.json" class="form-control" style="width:100%;margin-top:3px;"></label>
      <label style="font-size:12px;color:var(--text3);">Datensätze (essen-flaechen-docs.json)<input id="fi-docs" type="file" accept=".json" class="form-control" style="width:100%;margin-top:3px;"></label>
      <div id="fi-status" style="font-size:12px;color:var(--text2);min-height:18px;"></div>
      <div style="font-size:11px;color:var(--text3);">Lädt das Bundle nach Storage und schreibt die Flächen ins gewählte Projekt. Es wird NICHTS überschrieben — bitte nur ein leeres Zielprojekt verwenden.</div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="fi-cancel" class="btn btn-secondary" style="padding:7px 12px;">Abbrechen</button>
      <button id="fi-run" class="btn btn-primary" style="padding:7px 14px;">Einspielen</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#fi-cancel').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#fi-run').onclick=()=>flaechenImportRun(close);
}
async function flaechenImportRun(close){
  if(currentRole!=='superadmin') return;
  const sel=document.getElementById('fi-proj')?.value||''; const [pid,org]=sel.split('|');
  const bundleFile=document.getElementById('fi-bundle')?.files?.[0];
  const docsFile=document.getElementById('fi-docs')?.files?.[0];
  const setMsg=t=>{ const e=document.getElementById('fi-status'); if(e) e.textContent=t; };
  if(!pid||!org){ setMsg('Kein Zielprojekt.'); return; }
  if(!bundleFile||!docsFile){ setMsg('Bitte beide Dateien wählen.'); return; }
  const run=document.getElementById('fi-run'); if(run){ run.disabled=true; run.style.opacity=.5; }
  try{
    setMsg('Bundle wird hochgeladen…');
    await storage.ref(`objektgeom/${org}/${pid}/flaechen.json`).put(bundleFile,{contentType:'application/json',cacheControl:'public,max-age=3600'});
    setMsg('Datensätze werden gelesen…');
    const docs=JSON.parse(await docsFile.text());
    if(!Array.isArray(docs)||!docs.length){ setMsg('Datei enthält keine Datensätze.'); if(run){ run.disabled=false; run.style.opacity=1; } return; }
    for(let i=0;i<docs.length;i+=400){
      const batch=db.batch();
      docs.slice(i,i+400).forEach(d=>{ const ref=db.collection('projects').doc(pid).collection('trees').doc();
        batch.set(ref,{...d, orgId:org, aktiv:true, tourIds:[], baumId:d.extId||'', createdAt:firebase.firestore.FieldValue.serverTimestamp()}); });
      await batch.commit();
      setMsg(`${Math.min(i+400,docs.length)} / ${docs.length} Flächen geschrieben…`);
    }
    await db.collection('projects').doc(pid).update({hatFlaechen:true, geomVersion:Date.now()});
    setMsg('✓ Fertig: '+docs.length+' Flächen eingespielt.');
    notify('✓ '+docs.length+' Flächen eingespielt');
    setTimeout(()=>{ if(close) close(); },1500);
  }catch(e){ setMsg('Fehler: '+(e.message||e)); notify('Fehler: '+(e.message||e)); if(run){ run.disabled=false; run.style.opacity=1; } }
}
// ─── FLÄCHEN: Sommer-/Winter-Touren aus Reinigungsplan erzeugen ───────────────
// Je (Saison × Fahrzeug × Wochentag) eine Tour. Wochentag = wöchentlicher Rhythmus
// über ein Anker-Startdatum; Saison = Feld auf der Tour (tourDueOn filtert per Datum).
// Idempotent: erzeugte Touren tragen autoFlaeche+genKey, werden wiederverwendet/ersetzt.
const _FL_WD=['Mo','Di','Mi','Do','Fr','Sa','So'];
const _FL_ANCHOR={Mo:'2024-01-01',Di:'2024-01-02',Mi:'2024-01-03',Do:'2024-01-04',Fr:'2024-01-05',Sa:'2024-01-06',So:'2024-01-07'}; // 2024-01-01 = Montag
function _flTourColor(fz){ let h=0; const s=String(fz||''); for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return TOUR_COLORS[h%TOUR_COLORS.length]; }
function _flTourPlan(){
  const parse=s=>String(s||'').split(',').map(x=>x.trim()).filter(x=>_FL_WD.includes(x));
  const flTrees=trees.filter(t=>geomTypeOf(t)==='flaeche' && String(t.fahrzeug||'').trim());
  const byKey=new Map(), treeMap=new Map();
  for(const t of flTrees){
    const fz=String(t.fahrzeug).trim(), keys=[];
    for(const [saison,field] of [['sommer',t.sommerTage],['winter',t.winterTage]]){
      for(const wd of parse(field)){
        const genKey=saison+'|'+fz+'|'+wd;
        if(!byKey.has(genKey)) byKey.set(genKey,{ genKey, saison, fahrzeug:fz, wd, startDate:_FL_ANCHOR[wd], color:_flTourColor(fz),
          name:wd+' · Fzg '+fz+' · '+(saison==='sommer'?'Sommer':'Winter') });
        keys.push(genKey);
      }
    }
    treeMap.set(t.id, keys);
  }
  return { tourList:[...byKey.values()], treeMap, flCount:flTrees.length };
}
function flaechenTourGenOpen(){
  if(!(currentRole==='superadmin'||currentCap==='admin')){ notify('Nur Admin/Superadmin'); return; }
  const p=_flTourPlan();
  if(!p.tourList.length){ notify('Keine Flächen mit Fahrzeug und Reinigungstagen gefunden.'); return; }
  const som=p.tourList.filter(t=>t.saison==='sommer').length, win=p.tourList.length-som;
  const existing=tours.filter(t=>t.autoFlaeche).length;
  const ok=confirm(`Touren aus Reinigungsplan erzeugen?\n\n`
    +`• ${p.tourList.length} Touren (${som} Sommer, ${win} Winter)\n`
    +`• ${p.flCount} Flächen werden den passenden Touren zugeordnet\n`
    +`• Wochentag = wöchentlicher Rhythmus, Saison automatisch über die Zeiträume\n\n`
    +(existing?`${existing} bereits erzeugte Touren werden aktualisiert/ersetzt.\n\n`:'')
    +`Manuell angelegte Touren und Zuordnungen bleiben erhalten.`);
  if(ok) flaechenTourGenRun();
}
async function flaechenTourGenRun(){
  if(!(currentRole==='superadmin'||currentCap==='admin')) return;
  const org=currentProjectData&&currentProjectData.orgId; if(!org){ notify('Kein Projekt geladen.'); return; }
  const p=_flTourPlan(); if(!p.tourList.length) return;
  notify('Touren werden erzeugt…');
  try{
    const tcol=db.collection('projects').doc(currentProjectId).collection('tours');
    const existing=tours.filter(t=>t.autoFlaeche);
    const byKey=new Map(existing.map(t=>[t.genKey,t]));
    const keyToId=new Map(), wanted=new Set();
    let batch=db.batch(), ops=0;
    const flush=async()=>{ if(ops){ await batch.commit(); batch=db.batch(); ops=0; } };
    for(const tt of p.tourList){
      wanted.add(tt.genKey);
      const ex=byKey.get(tt.genKey);
      const ref=ex?tcol.doc(ex.id):tcol.doc();
      keyToId.set(tt.genKey, ref.id);
      batch.set(ref,{ orgId:org, name:tt.name, color:tt.color, interval:'woechentlich', startDate:tt.startDate,
        saison:tt.saison, wochentag:tt.wd, fahrzeugNr:tt.fahrzeug, vehicleName:'Fzg '+tt.fahrzeug,
        autoFlaeche:true, genKey:tt.genKey, gueltig:[], createdAt:firebase.firestore.FieldValue.serverTimestamp() },{merge:true});
      if(++ops>=400) await flush();
    }
    for(const ex of existing){ if(!wanted.has(ex.genKey)){ batch.delete(tcol.doc(ex.id)); if(++ops>=400) await flush(); } }
    await flush();
    // Flächen zuordnen: manuelle (Nicht-auto) Tour-IDs behalten, auto-IDs durch neu berechnete ersetzen
    const autoIds=new Set([...keyToId.values(), ...existing.map(e=>e.id)]);
    const trcol=db.collection('projects').doc(currentProjectId).collection('trees');
    let nTrees=0;
    for(const t of trees.filter(x=>geomTypeOf(x)==='flaeche')){
      const computed=(p.treeMap.get(t.id)||[]).map(k=>keyToId.get(k)).filter(Boolean);
      const manual=getTreeTourIds(t).filter(id=>!autoIds.has(id));
      const newIds=[...manual,...computed], cur=getTreeTourIds(t);
      if(newIds.length!==cur.length || newIds.some((x,i)=>x!==cur[i])){
        batch.update(trcol.doc(t.id),{tourIds:newIds,tourId:newIds[0]||''});
        nTrees++; if(++ops>=400) await flush();
      }
    }
    await flush();
    // Ansicht aktualisieren: Touren-Tabelle zählt treeInTour, Flächen werden nach Tour eingefärbt.
    // Der Trees-Listener rendert das Touren-Grid nicht selbst → hier explizit nachziehen.
    try{ if(currentView==='touren') renderTourenGrid(); }catch(_){}
    try{ _flaechenLayerKey=''; await renderFlaechen(); }catch(_){}
    try{ refreshMarkers(); }catch(_){}
    notify(`✓ ${p.tourList.length} Touren erzeugt · ${nTrees} Flächen zugeordnet`);
  }catch(e){ console.warn('flaechenTourGen', e); notify('Fehler: '+(e.message||e)); }
}

// ── Geometrie-Datensätze einspielen (Superadmin): Linien/Flächen mit geomStr am Doc (kein Bundle) ──
// Für gezeichnete-/OSM-Geometrie (z. B. Ahlen-Straßen aus import-osm-ahlen.mjs).
async function geomDocsImportOpen(){
  if(currentRole!=='superadmin'){ notify('Nur Superadmin'); return; }
  let projs=[];
  try{ const [pq,oq]=await Promise.all([db.collection('projects').get(),db.collection('orgs').get()]);
    const on={}; oq.forEach(d=>on[d.id]=d.data().name||d.id);
    projs=pq.docs.map(d=>({id:d.id,name:d.data().name||d.id,orgId:d.data().orgId,org:on[d.data().orgId]||d.data().orgId})).sort((a,b)=>((a.org||'')+a.name).localeCompare((b.org||'')+b.name));
  }catch(e){ notify('Projekte laden fehlgeschlagen'); return; }
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;box-shadow:0 8px 32px rgba(0,0,0,.2);width:460px;max-width:94vw;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">／ Geometrie-Datensätze einspielen</div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;font-size:13px;">
      <label style="font-size:12px;color:var(--text3);">Zielprojekt<select id="gd-proj" class="form-control" style="width:100%;margin-top:3px;">${projs.map(p=>`<option value="${dlEsc(p.id)}|${dlEsc(p.orgId)}"${p.id===currentProjectId?' selected':''}>${dlEsc(p.org)} · ${dlEsc(p.name)}</option>`).join('')}</select></label>
      <label style="font-size:12px;color:var(--text3);">Datensätze (z. B. ahlen-strecken-docs.json)<input id="gd-docs" type="file" accept=".json" class="form-control" style="width:100%;margin-top:3px;"></label>
      <div id="gd-status" style="font-size:12px;color:var(--text2);min-height:18px;"></div>
      <div style="font-size:11px;color:var(--text3);">Linien-/Flächen-Objekte mit Geometrie direkt am Doc (geomStr). Es wird nichts überschrieben — am besten ein leeres Zielprojekt.</div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="gd-cancel" class="btn btn-secondary" style="padding:7px 12px;">Abbrechen</button>
      <button id="gd-run" class="btn btn-primary" style="padding:7px 14px;">Einspielen</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const close=()=>m.remove();
  m.querySelector('#gd-cancel').onclick=close;
  m.addEventListener('click',e=>{ if(e.target===m) close(); });
  m.querySelector('#gd-run').onclick=()=>geomDocsImportRun(close);
}
async function geomDocsImportRun(close){
  if(currentRole!=='superadmin') return;
  const sel=document.getElementById('gd-proj')?.value||''; const [pid,org]=sel.split('|');
  const f=document.getElementById('gd-docs')?.files?.[0];
  const setMsg=t=>{ const e=document.getElementById('gd-status'); if(e) e.textContent=t; };
  if(!pid||!org){ setMsg('Kein Zielprojekt.'); return; }
  if(!f){ setMsg('Bitte Datei wählen.'); return; }
  const run=document.getElementById('gd-run'); if(run){ run.disabled=true; run.style.opacity=.5; }
  try{
    const docs=JSON.parse(await f.text());
    if(!Array.isArray(docs)||!docs.length){ setMsg('Datei enthält keine Datensätze.'); if(run){run.disabled=false;run.style.opacity=1;} return; }
    for(let i=0;i<docs.length;i+=400){
      const batch=db.batch();
      docs.slice(i,i+400).forEach(d=>{ const ref=db.collection('projects').doc(pid).collection('trees').doc();
        batch.set(ref,{...d, orgId:org, aktiv:true, tourIds:[], tourId:'', history:[], createdAt:firebase.firestore.FieldValue.serverTimestamp()}); });
      await batch.commit();
      setMsg(`${Math.min(i+400,docs.length)} / ${docs.length} geschrieben…`);
    }
    setMsg('✓ Fertig: '+docs.length+' Objekte eingespielt.');
    notify('✓ '+docs.length+' Geometrie-Objekte eingespielt');
    setTimeout(()=>{ if(close) close(); },1500);
  }catch(e){ setMsg('Fehler: '+(e.message||e)); notify('Fehler: '+(e.message||e)); if(run){run.disabled=false;run.style.opacity=1;} }
}
// Migration: flache Linien-Straßen → Abschnitt-Container + 4 Seiten (Fahrbahn/Gehweg L/R).
// Räumt zuerst versehentlich eingespielte Container/Seiten weg (nicht _migrated), wandelt dann die
// flachen Straßen an Ort und Stelle um; bisherige Tour-Zuordnung wandert auf die Fahrbahn-Seiten.
// Idempotent: migrierte Docs tragen _migrated=true und werden beim Aufräumen verschont.
async function strMigOpen(){
  if(currentRole!=='superadmin'){ notify('Nur Superadmin'); return; }
  let projs=[];
  try{ const [pq,oq]=await Promise.all([db.collection('projects').get(),db.collection('orgs').get()]);
    const on={}; oq.forEach(d=>on[d.id]=d.data().name||d.id);
    projs=pq.docs.map(d=>({id:d.id,name:d.data().name||d.id,orgId:d.data().orgId,org:on[d.data().orgId]||d.data().orgId})).sort((a,b)=>((a.org||'')+a.name).localeCompare((b.org||'')+b.name));
  }catch(e){ notify('Projekte laden fehlgeschlagen'); return; }
  const m=document.createElement('div'); m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100001;display:flex;align-items:center;justify-content:center;padding:20px;';
  m.innerHTML=`<div style="background:var(--surface);border-radius:10px;width:500px;max-width:94vw;overflow:hidden;">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);font-size:15px;font-weight:700;">Flache Straßen → Abschnitte umwandeln</div>
    <div style="padding:16px 18px;display:flex;flex-direction:column;gap:12px;font-size:13px;">
      <label style="font-size:12px;color:var(--text3);">Projekt<select id="sm-proj" class="form-control" style="width:100%;margin-top:3px;">${projs.map(p=>`<option value="${dlEsc(p.id)}"${p.id===currentProjectId?' selected':''}>${dlEsc(p.org)} · ${dlEsc(p.name)}</option>`).join('')}</select></label>
      <button id="sm-analyze" class="btn btn-secondary" style="padding:7px 12px;">Analysieren</button>
      <div id="sm-info" style="font-size:12px;color:var(--text2);white-space:pre-line;min-height:20px;"></div>
      <div style="font-size:11px;color:var(--text3);">Schritt 1: versehentlich eingespielte Container/Seiten entfernen (ohne Tour-Zuordnung). Schritt 2: flache Straßen → Abschnitt + 4 Seiten (Fahrbahn/Gehweg L/R); bisherige Tour-Zuordnung wandert auf die Fahrbahn-Seiten. Danach Routen neu berechnen.</div>
    </div>
    <div style="padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:8px;justify-content:flex-end;">
      <button id="sm-cancel" class="btn btn-secondary" style="padding:7px 12px;">Abbrechen</button>
      <button id="sm-run" class="btn btn-primary" style="padding:7px 14px;opacity:.5;" disabled>Ausführen</button>
    </div></div>`;
  document.body.appendChild(m);
  const close=()=>m.remove(); m.querySelector('#sm-cancel').onclick=close; m.addEventListener('click',e=>{ if(e.target===m) close(); });
  const info=()=>document.getElementById('sm-info'); const runBtn=()=>document.getElementById('sm-run');
  let _data=null;
  m.querySelector('#sm-analyze').onclick=async()=>{
    const pid=document.getElementById('sm-proj').value; info().textContent='Lade…';
    try{
      const snap=await db.collection('projects').doc(pid).collection('trees').get();
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
      const remove=all.filter(t=>(t.containerTyp||t.containerExtId)&&!t._migrated); // versehentlich Eingespieltes
      const flat=all.filter(t=>!t.containerTyp&&!t.containerExtId&&t.geomStr&&geomTypeOf(t)==='linie'&&t.extId);
      const planned=flat.filter(t=>(t.tourIds&&t.tourIds.length)||t.tourId).length;
      _data={pid,flat,removeIds:remove.map(x=>x.id)};
      info().textContent=`Zu entfernen (eingespielte Container/Seiten): ${remove.length}\nFlache Straßen → Abschnitte: ${flat.length}\n  davon mit Tour-Zuordnung → Fahrbahn: ${planned}\nNeue Seiten: ${flat.length*4}`;
      if(!remove.length&&!flat.length) info().textContent+='\n\nNichts zu tun (bereits umgewandelt?).';
      runBtn().disabled=false; runBtn().style.opacity=1;
    }catch(e){ info().textContent='Fehler: '+(e.message||e); }
  };
  m.querySelector('#sm-run').onclick=async()=>{
    if(!_data) return; const {pid,flat,removeIds}=_data; const rb=runBtn(); rb.disabled=true; rb.style.opacity=.5;
    const col=db.collection('projects').doc(pid).collection('trees');
    try{
      for(let i=0;i<removeIds.length;i+=400){ const b=db.batch(); removeIds.slice(i,i+400).forEach(id=>b.delete(col.doc(id))); await b.commit(); info().textContent=`Entferne… ${Math.min(i+400,removeIds.length)}/${removeIds.length}`; }
      for(let i=0;i<flat.length;i+=90){ // je Straße 1 Update + 4 Sets = 5 Ops → 90×5=450 < 500
        const b=db.batch();
        for(const s of flat.slice(i,i+90)){
          const fbArt=s.zustFahrbahn==='stadt'?'Fahrbahn (Stadt)':s.zustFahrbahn==='anlieger'?'Fahrbahn (Anlieger)':'Fahrbahn';
          const gwArt=s.zustGehweg==='stadt'?'Gehweg (Stadt)':s.zustGehweg==='anlieger'?'Gehweg (Anlieger)':'Gehweg';
          const oldT=(s.tourIds&&s.tourIds.length)?s.tourIds:(s.tourId?[s.tourId]:[]);
          b.update(col.doc(s.id),{containerTyp:'strecke',art:'Straßenabschnitt',tourIds:[],tourId:'',_migrated:true});
          [['fahrbahn_l','Fahrbahn links',fbArt,oldT],['fahrbahn_r','Fahrbahn rechts',fbArt,oldT],['gehweg_l','Gehweg links',gwArt,[]],['gehweg_r','Gehweg rechts',gwArt,[]]].forEach(([element,label,art,tids])=>{
            b.set(col.doc(),{ name:label, element, elementLabel:label, art, geomType:'linie', containerExtId:s.extId, baumId:(s.baumId||('S-'+s.extId))+'-'+element, orgId:s.orgId||'', aktiv:true, tourIds:tids, tourId:tids[0]||'', history:[], _migrated:true, createdAt:firebase.firestore.FieldValue.serverTimestamp() });
          });
        }
        await b.commit(); info().textContent=`Wandle um… ${Math.min(i+90,flat.length)}/${flat.length} Straßen`;
      }
      info().textContent=`✓ Fertig: ${removeIds.length} entfernt, ${flat.length} Abschnitte mit ${flat.length*4} Seiten. Bitte Routen neu berechnen.`;
      notify('✓ Migration fertig — '+flat.length+' Abschnitte');
    }catch(e){ info().textContent='Fehler: '+(e.message||e); notify('Fehler: '+(e.message||e)); rb.disabled=false; rb.style.opacity=1; }
  };
}
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
      <select onchange="if(this.value){moveProjectUi('${_jsArg(p.id)}','${_jsArg(p.name||'')}',this.value);this.selectedIndex=0;}" style="padding:3px 6px;font-size:11px;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-family:inherit;">
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
    <div style="margin-bottom:16px;"><button class="btn btn-secondary" style="font-size:12px;padding:7px 12px;" onclick="flaechenImportOpen()">⬗ Flächen-Bundle einspielen</button> <button class="btn btn-secondary" style="font-size:12px;padding:7px 12px;" onclick="geomDocsImportOpen()">／ Geometrie-Datensätze einspielen</button> <button class="btn btn-secondary" style="font-size:12px;padding:7px 12px;" onclick="strMigOpen()">⇄ Straßen → Abschnitte</button> <span style="font-size:11px;color:var(--text3);">Bundle = importierte Flächen · Datensätze = Linien/Flächen mit Geometrie am Doc (z. B. Ahlen-Straßen).</span></div>
    ${orgs.map(o=>`<div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
        <span style="font-size:14px;font-weight:700;">${dlEsc(o.name||o.id)}</span>
        ${o.code?`<span style="font-size:10px;font-weight:700;background:var(--green-light);color:var(--green);padding:2px 8px;border-radius:99px;">${dlEsc(o.code)}</span>`:''}
        <label title="Navi-Funktion in der Fahrer-App für diesen Mandanten freischalten" style="font-size:11px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;color:var(--text2);background:var(--bg);border:1px solid var(--border);border-radius:99px;padding:2px 9px;"><input type="checkbox" ${o.naviEnabled?'checked':''} onchange="setOrgNaviUi('${_jsArg(o.id)}',this.checked)" style="width:13px;height:13px;cursor:pointer;margin:0;">Navi-App</label>
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
async function setOrgNaviUi(orgId, enabled){
  try{ await dlFnCall('setOrgNavi',{orgId,naviEnabled:!!enabled}); notify(enabled?'✓ Navi-App für Mandant aktiviert':'Navi-App für Mandant deaktiviert'); }
  catch(e){ notify(fnErr(e)); renderMandanten(); }
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
function setHbTab(t){ if(t==='updates' && currentRole!=='superadmin') return; _hbTab=t; renderHandbuch(); }
function hbMark(s,q){
  const e=dlEsc(s);
  if(!q) return e;
  try{ return e.replace(new RegExp('('+q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark style="background:#fde68a;border-radius:3px;padding:0 1px;">$1</mark>'); }
  catch(_){ return e; }
}
function renderHandbuch(){
  const cont=document.getElementById('hb-content'); if(!cont) return;
  const q=(document.getElementById('hb-search')?.value||'').trim();
  // „Aktualisierungen" (Changelog aus Commits) nur für Superadmin
  const isSuper=currentRole==='superadmin';
  if(!isSuper && _hbTab==='updates') _hbTab='handbuch';
  // Tab-Optik
  const tb=document.getElementById('hb-tab-handbuch'), tu=document.getElementById('hb-tab-updates');
  if(tu) tu.style.display=isSuper?'':'none';
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
              <img src="${im.src}" loading="lazy" onclick="openHbImg('${im.src}','${_jsArg(im.cap||'')}')" alt="${dlEsc(im.cap||'')}" style="max-width:100%;max-height:420px;width:auto;border:1px solid var(--border);border-radius:8px;cursor:zoom-in;box-shadow:0 1px 4px rgba(0,0,0,.10);">
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
  openKiPrompt,renderKi,setKiMode,renderKiConfig,openKiConfigMenu,toggleKiAnalyse,resetKiAnalysen,
  renderHandbuch,setHbTab,hbSearchDebounced,openHbImg,closeHbImg,
  dispoSimulate,dispoLoadReal,dispoPlan,dispoOpenObjectDetail,dispoOpenSettings,dispoToggle,dispoAssign,dispoUnassign,dispoFocusBin,dispoFocusPoint,dispoResetDepot,dispoFocusVehicle,dispoToggleVehicle,dispoShowAllVehicles,
  epChangeOrg,epChangeProject,epChangeDate,epSetTab,epSetVehicleStatus,epAssignVehicle,epAddDriver,epRemoveDriver,epSetStandard,epApplyStandards,epToggleBedarf,epOpenPicker,epDragStart,epDragOver,epDrop,epAbsShiftMonth,epAbsOpenForm,epVehField,epVehAdd,epVehRemove,epVehSave,epWeekShift,epWeekThis,epWeekToggleEmpty,epWeekFilter,epDayFilter,epTourCtx,epEditTour,_epCloseCtx,epPersonOpenCard,
  dashSetPeriod,renderDashboard,refreshDashboard,dashFilterTours,
  saveInlineFields,toggleOverviewInDetail,renderInlineTourChips,filterInlineTours,filterDetailTable,filterBaeumeTable,switchBaeumeTab,buildArten,addArt,renameArt,mergeArt,deleteArt,
  filterAbschnitteTable,filterAbschnitteTableDebounced,toggleAbschnShowAll,downloadAbschnitteExport,
  nmSetType,nmSetAudience,nmToggleSel,nmToggle,_nmSetTour,nmSend,nmArchive,
  nmUnarchive,nmToggleArchived,nmDelArm,nmDelCancel,nmDeleteDo,setPushEnabled,
  renderFieldCatalogView,openFieldDetail,closeFieldDetail,addListVal,renameListVal,mergeListVal,deleteListVal,buildListFromObjects,addCustomField,renameCustomField,removeCustomField,_fillMerge,cfGeomToggle,
  rankAdd,rankRename,rankSetColor,rankSetZahl,rankSetZahlWinter,rankMove,rankMerge,rankDelete,
  saveHistoryEdits,deleteHistoryEntry,refreshControlling,loadTourHistoryForControlling,loadErfasser,addErfasser,removeErfasser,addReason,deleteReason,saveDriverAssignment,setCtrlPeriod,renderControlling,exportCtrlCSV,initControlling,
  openCtrlWidgetMenu,toggleCtrlWidget,resetCtrlWidgets,siSet,siSearch,siExportCsv,siQuickFilter,siResetFilters,initVerwaltung,addDriver,removeDriver,addReasonMgmt,deleteReasonMgmt,seedDefaultReasons,resetObjFilter,loadTourHistory,showHistoryDetail,exportHistoryCSV,resetCtrlFilters,ctrlShowOnMap,
  importExcel,calculateAndSaveRoute,calculateAllRoutes,closeCtxMenu,ctxCalcActive,cancelAssign,setAssignTour,startAssignMode,rebuildAssignPills,lassoAction,clearLassoSelection,
  createProject,openProject,showProjectScreen,psSetOrgFilter,setSiTab,
  switchView,openDetail,openAbschnitt,abschnittAddSeite,selectTree,closePanel,logWatering,applyClusterMode,
  openFoto,stepFoto,closeFoto,deleteFoto,
  docUploadStart,docUploadFiles,docAddLink,docDelete,switchModalTab,
  openAddTree,openEditTree,closeTreeModal,saveTree,deleteTree,
  archiveTree,reactivateTree,archiveTreeFromModal,reactivateTreeFromModal,deleteTreeFromModal,toggleShowInactive,showTreeOnMapFromModal,bulkSetInactive,bulkDelete,
  openTourModal,closeTourModal,saveTour,deleteTour,toggleTourUebersicht,toggleOverviewInGrid,filterTourenGrid,showTourViolations,
  tourZusatzAdd,tourZusatzDel,tourRegelToggle,tourUpdWeekday,tourRhythmusUI,tourGueltigAdd,tourGueltigDel,tourGueltigSet,_sx,_sxClear,
  openTourReport,closeReportModal,repAddCol,repRemoveCol,repMoveCol,repApplyFromControls,
  printReport,exportReportExcel,saveReportTemplate,loadReportTemplate,printTourMap,
  openOrderEditor,repOrderMove,closeOrderEditor,saveManualOrder,
  focusTour,focusTourAndSwitch,
  startPlacement,cancelMode,setDepotOnMap,startDraw,finishDraw,cancelDraw,
  startAssignMode,setAssignTour,cancelAssign,assignTreeToTour,
  openSettings,closeSettings,geocodeDepot,applySettings,confirmDeleteProject,openImport,openAllgemein,openProjekte,
  pickProjIcon,artSetIcon,artSetTime,artSetRate,setArtDefaultTime,artApplyTimeToAll,artSetKlasse,
  renderReinigungssysteme,rsAdd,rsUpdate,rsDelete,
  renderMandanten,createOrgUi,moveProjectUi,setOrgNaviUi,checkBaumIdDuplicates,flaechenImportOpen,flaechenImportRun,geomDocsImportOpen,geomDocsImportRun,strMigOpen,flaechenTourGenOpen,flaechenTourGenRun,
  addWmsLayer,deleteWmsLayer,editWmsLayer,cancelWmsEdit,renderWmsList,
  setFilter,pickColor,renderList,renderListDebounced,filterBaeumeTableDebounced,filterDetailTableDebounced,setListMode,
  toggleLassoMode,switchDetailTab,toggleRoutePlanning,setLassoTour,toggleRouteLines,toggleMapFilter,openObjFilterConfig,setObjFilterField,toggleTourCounts,toggleRouteNums,toggleVersatz,toggleTypeFilter,setTypeVisible,simulateActiveTour,fitToCity,setSimSpeed,toggleSimSkipBew,
  openPilotScope,closePilot,pilotSetField,pilotAddValue,pilotRemoveValue,pilotToggleActive,pilotToggleShowAll,pilotSave,
  apGenerate,apSelect,apDelete,apSetSolverUrl,apAssignSel,apClearSel,apRecalc,apSelectDay,apRahmenDay,apRahmenFreqDay,apSetSaison,apRahmenMode,apRahmenErlaubtDay,apToggleTourVis,apShowAllTours,apColorBy,apClearLocks,archivBereinigen,
  renderDriverLogins,addDriverLogin,saveDriverPin,toggleDriverLoginActive,dlEditPin,dlCancelPin,changeDriverRole,saveOrgCode,dlToggleNoLogin,setDriverFunktion,setDriverEinsatz,dlDismissLoginRequest,dlFunktionAdd,dlFunktionRemove,
  renderUserMgmt,addOrgUser,saveUserPass,toggleUserActive,urEditPass,urCancelPass,
  changeUserRole,deleteOrgUserUi,deleteDriverUi,
  renderRollenView,saveRole,addRole,deleteRole,toggleBenutzerRollen,toggleBenutzerTouren,changeBenutzerOrg,changeDtaProject,renderUsage,exportUsageCSV,
  startGpsPlacement,startMoveObject,saveMoveObject,cancelMoveObject,toggleFilterNoGps,updateBtnFilterNoGps,toggleShowAll,clearBaeumeFilters,
  openBaeumeColMenu,toggleBaeumeCol,resetBaeumeCols,
  saveFieldLabels, setFieldLabel, toggleMobilFeld, migrateTourIds, deriveHaeufigkeitFromZustaendigkeit,
  addObjektklasse, renameObjektklasse, setKlasseStruktur, toggleKlasseFeld, deleteObjektklasse,
  addReinigungsklasse, renameReinigungsklasse, setRkFreq, setRkColor, deleteReinigungsklasse, onKlasseChange, setColorMode, togglePlanCheck, toggleOverdueCheck, checkToggleStatus, checkShowProblems, checkShowAll, setOverdueTol, setCheckSaison, toggleCheckMenu, checkMenuPick, checkMenuGoDq, dqPick, dqExportCsv, gSet, gExportCsv, setAbschnittRk, toggleDisplayPanel, setGeomStyle, saveDisplayDefaults, setRouteLineStyle, setSollFeld,
  doLogin, doLogout, toggleLoginMode,
});

// Topbar-Menüs klick-basiert öffnen (zuverlässiger als Hover — kein „Lücke verloren") :
// Klick auf den Hauptpunkt öffnet/schließt; Auswahl eines Unterpunkts, Klick außerhalb oder Esc schließt.
function setupNavMenus(){
  const groups=[...document.querySelectorAll('nav.topbar-nav .nav-group')];
  if(!groups.length) return;
  const closeAll=()=>groups.forEach(g=>g.classList.remove('open'));
  groups.forEach(g=>{
    const trigger=g.querySelector(':scope > button'); if(!trigger) return; // Hauptpunkt oder Avatar
    trigger.addEventListener('click',e=>{ e.stopPropagation(); const open=g.classList.contains('open'); closeAll(); if(!open) g.classList.add('open'); });
    g.querySelectorAll('.nav-dropdown button').forEach(b=>b.addEventListener('click',closeAll));
  });
  document.addEventListener('click',e=>{ if(!e.target.closest('.nav-group')) closeAll(); });
  document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeAll(); });
}
if(document.readyState!=='loading') setupNavMenus(); else document.addEventListener('DOMContentLoaded',setupNavMenus);

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
    const res=await firebase.app().functions('europe-west3').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(),name,pin,allowParallel:true});
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