import { initAppCheck } from './appcheck.js';
import { BASEMAP_FARBE, BASEMAP_ATTR } from './basemaps.js';
import { firebaseConfig } from './firebase-config.js';
import { esc } from './esc.js';
// ─── FIREBASE CONFIG (zentral in firebase-config.js) ──────────
const fbApp = firebase.initializeApp(firebaseConfig);
initAppCheck();
const db = firebase.firestore(fbApp);

const TOUR_COLORS = ['#2d6a4f','#1e40af','#7c3aed','#be123c','#b45309','#0e7490','#064e3b','#b91c1c'];

// ─── STATE ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProjectData = null;
let currentUser = null, currentRole = '', currentCap = '', currentOrg = '';
let elRoles = {}; // roleKey -> {modules,...}
function canUseEinsatzleiter(){
  if(currentRole==='superadmin' || currentCap==='admin') return true;
  const r=elRoles[currentRole];
  return !!(r && r.modules && r.modules.einsatzleiter);
}
let trees = [];
let tours = [];
let tourHistory = [];
let tourHistoryLoaded = false;
let unsubTrees = null;
let unsubTours = null;
let unsubHistory = null;
let period = 'month';
let timelineChart = null;
let nichtMap = null;
let nichtLayer = null;

// ─── n:m TOUR-HELFER ──────────────────────────────────────────
function getTreeTourIds(tree){
  if(Array.isArray(tree.tourIds)) return tree.tourIds.filter(Boolean);
  if(tree.tourId) return [tree.tourId];
  return [];
}
function treeInTour(tree, tourId){ return getTreeTourIds(tree).includes(tourId); }

// ─── UTILS ────────────────────────────────────────────────────
function toast(msg, dur=2200){
  const el=document.getElementById('toast');
  el.textContent=msg; el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'), dur);
}
function hideLoading(){
  const el=document.getElementById('screen-loading');
  if(el){ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300); }
}

// ─── ZEITRAUM ─────────────────────────────────────────────────
function getDateRange(){
  const now=new Date();
  const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  if(period==='today'){
    return {from:today, to:new Date(today.getTime()+86400000-1)};
  } else if(period==='week'){
    const mon=new Date(today); mon.setDate(today.getDate()-((today.getDay()+6)%7));
    return {from:mon, to:new Date(mon.getTime()+7*86400000-1)};
  } else if(period==='month'){
    return {from:new Date(now.getFullYear(),now.getMonth(),1),
            to:new Date(now.getFullYear(),now.getMonth()+1,0,23,59,59)};
  } else if(period==='all'){
    return {from:new Date(0), to:new Date(now.getTime())};
  } else {
    const f=document.getElementById('date-from')?.value;
    const t=document.getElementById('date-to')?.value;
    return {from:f?new Date(f+'T00:00:00'):new Date(0),
            to:t?new Date(t+'T23:59:59'):new Date()};
  }
}
function dayStr(dateStr){
  if(!dateStr) return null;
  return typeof dateStr==='string' ? dateStr.slice(0,10) : new Date(dateStr).toISOString().slice(0,10);
}
function inRange(dateStr){
  const ds=dayStr(dateStr); if(!ds) return false;
  const d=new Date(ds+'T12:00:00');
  const {from,to}=getDateRange();
  return d>=from && d<=to;
}
function fmtDE(d){ return d.toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit',year:'numeric'}); }

// Ältere tourHistory-Docs speichern die Baumliste als `results` (status/reason/driver/note)
// statt als `trees` (lastStatus/lastReason/...). In einheitliches trees-Schema überführen.
function normalizeHistory(h){
  if(h && !Array.isArray(h.trees)){
    h.trees = Array.isArray(h.results) ? h.results.map(r=>({
      id:r.id, name:r.name, baumnr:r.baumnr, stadtteil:r.stadtteil, art:r.art,
      lat:r.lat, lng:r.lng,
      lastStatus:r.status||null, lastReason:r.reason||null,
      lastDriver:r.driver||null, lastNote:r.note||null,
      lastReportAt:r.reportAt||null,
    })) : [];
  }
  return h;
}

// ─── MELDUNGEN AUFBAUEN (Quelle: tourHistory, Fallback: tree.history) ─
function buildReported(){
  const out=[];
  const seen=new Set(); // BaumID|YYYY-MM-DD — verhindert Doppelzählung
  const treeById={}; trees.forEach(t=>{ treeById[t.id]=t; });
  if(tourHistoryLoaded){
    // Historischer Bestand: abgeschlossene Touren (autoritativ, editierbar)
    tourHistory.forEach(h=>{
      if(!inRange(h.date)) return;
      (h.trees||[]).forEach(tree=>{
        if(!tree.lastStatus || tree.lastStatus==='offen') return;
        // h.tourId = Tour, die bewässert hat (Baum-Snapshot trägt keine Tour-Zuordnung)
        const at=tree.lastReportAt||h.date;
        out.push({...tree, lastReportAt: at, _tourId: h.tourId});
        seen.add((tree.id||'')+'|'+dayStr(at));
      });
    });
  } else {
    // Fallback während tourHistory lädt: tree.history[]
    trees.forEach(tree=>{
      (tree.history||[]).forEach(h=>{
        if(!h.date || !inRange(h.date)) return;
        if(!h.status || h.status==='offen') return;
        out.push({...tree, lastStatus:h.status, lastReason:h.reason||null,
                  lastDriver:h.driver||null, lastReportAt:h.date});
        seen.add((tree.id||'')+'|'+dayStr(h.date));
      });
    });
  }
  // Live-Meldungen ergänzen: laufende, noch nicht abgeschlossene Touren stehen
  // nur in tree.lastStatus/lastReportAt und (noch) nicht in tourHistory.
  trees.forEach(tree=>{
    if(!tree.lastStatus || tree.lastStatus==='offen' || !tree.lastReportAt) return;
    const d=dayStr(tree.lastReportAt);
    if(!inRange(d)) return;
    const key=(tree.id||'')+'|'+d;
    if(seen.has(key)) return;
    seen.add(key);
    out.push({...tree});
  });
  // Snapshots aus dem results-Schema haben keine Koordinaten/Stammdaten —
  // aus dem Live-Baum (per ID) anreichern, damit die "Nicht erledigt"-Karte greift.
  return out.map(r=>{ const lt=treeById[r.id]; return lt ? {...lt, ...r} : r; });
}

// ─── RENDER ───────────────────────────────────────────────────
function render(){
  if(!currentProjectId) return;
  const {from,to}=getDateRange();
  const reported=buildReported();

  // Range-Label
  const rl=document.getElementById('range-label');
  if(period==='all'){
    rl.textContent='Gesamter Zeitraum';
  } else {
    rl.textContent=`${fmtDE(from)} – ${fmtDE(to)}`;
  }

  const bew=reported.filter(r=>r.lastStatus==='bewaessert');
  const nicht=reported.filter(r=>r.lastStatus==='nicht');
  const meldungen=bew.length+nicht.length;
  const pct=meldungen>0?Math.round(bew.length/meldungen*100):0;
  const aktiveFahrer=new Set(reported.map(r=>r.lastDriver).filter(Boolean)).size;
  const aktive=trees.filter(t=>t.aktiv!==false);
  // Offen = Summe der offenen je Tour (exakt wie "Fortschritt je Tour"); nicht verplante zählen hier nicht
  const offen=tourStats(reported).reduce((s,x)=>s+x.offen,0);

  // KPI-Kacheln
  document.getElementById('kpi-grid').innerHTML=[
    {val:aktive.length, lbl:'Objekte gesamt', sub:'im Projekt', color:'var(--text)'},
    {val:bew.length, lbl:'Erledigt', sub:`${pct}% der Meldungen`, color:'var(--green-dark)'},
    {val:nicht.length, lbl:'Nicht erledigt', sub:'im Zeitraum', color:'var(--red)'},
    {val:offen, lbl:'Offen', sub:'offen in Touren', color:'var(--text2)'},
    {val:meldungen, lbl:'Meldungen', sub:'gesamt im Zeitraum', color:'var(--blue)'},
    {val:aktiveFahrer, lbl:'Aktive Fahrer', sub:'im Zeitraum', color:'var(--amber)'},
  ].map(k=>`<div class="kpi-tile">
    <div class="kpi-val" style="color:${k.color};">${k.val}</div>
    <div class="kpi-lbl">${k.lbl}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');

  renderTourProgress(reported);
  renderReasons(nicht);
  renderNichtMap(nicht);
  renderTimeline(reported, from, to);

  const u=document.getElementById('header-updated');
  if(u) u.textContent='Stand: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}

// Pro-Tour-Statistik (geteilte Quelle für KPI "Offen" und "Fortschritt je Tour").
// Tour-Zuordnung der Meldungen über die Baum-ID auflösen (tourHistory-Snapshots
// tragen die Zuordnung nicht zuverlässig).
function tourStats(reported){
  return tours.map(t=>{
    // Nur Meldungen zu aktuell AKTIVEN Tour-Objekten zählen -> Fortschritt nie >100%
    // (bewässerte, danach deaktivierte/entfernte Objekte verzerren sonst den Zähler).
    const activeIds=new Set(trees.filter(x=>treeInTour(x,t.id)&&x.aktiv!==false).map(x=>x.id));
    const total=activeIds.size;
    const rep=reported.filter(r=>activeIds.has(r.id));
    const bewIds=new Set(rep.filter(r=>r.lastStatus==='bewaessert').map(r=>r.id));
    const nichtIds=new Set(rep.filter(r=>r.lastStatus==='nicht' && !bewIds.has(r.id)).map(r=>r.id));
    const bewN=bewIds.size, nichtN=nichtIds.size;
    return {t, total, bewN, nichtN, offen:Math.max(0, total-bewN-nichtN)};
  });
}

function filterTours(q){
  q=(q||'').toLowerCase().trim();
  document.querySelectorAll('#tour-progress .tour-row').forEach(row=>{
    row.style.display = !q || (row.dataset.name||'').includes(q) ? '' : 'none';
  });
}
window.filterTours=filterTours;

function renderTourProgress(reported){
  const el=document.getElementById('tour-progress');
  const cntEl=document.getElementById('tour-count');
  if(tours.length===0){ el.innerHTML='<div class="empty">Keine Touren angelegt</div>'; if(cntEl)cntEl.textContent=''; return; }

  const stats=tourStats(reported);
  if(cntEl) cntEl.textContent=`(${stats.length})`;
  el.innerHTML=stats.map(({t,total,bewN,nichtN,offen})=>{
    const base=Math.max(total, bewN+nichtN, 1);
    const bewW=bewN/base*100, nichtW=nichtN/base*100, offenW=offen/base*100;
    const pct=total>0?Math.round(bewN/total*100):(bewN+nichtN>0?Math.round(bewN/(bewN+nichtN)*100):0);
    const color=t.color||TOUR_COLORS[0];
    return `<div class="tour-row" data-name="${(t.name||'Tour').toLowerCase().replace(/"/g,'')}">
      <div class="tour-head">
        <span class="tour-dot" style="background:${color};"></span>
        <span class="tour-name">${esc(t.name||'Tour')}</span>
        <span class="tour-pct">${pct}%</span>
      </div>
      <div class="tour-bar">
        <div class="seg" style="width:${bewW}%;background:var(--green);"></div>
        <div class="seg" style="width:${nichtW}%;background:var(--red-mid);"></div>
        <div class="seg" style="width:${offenW}%;background:transparent;"></div>
      </div>
      <div class="tour-meta">
        <span><b style="color:var(--green-dark);">${bewN}</b> erl.</span>
        <span><b style="color:var(--red);">${nichtN}</b> n. erl.</span>
        <span><b>${offen}</b> offen</span>
        <span style="margin-left:auto;">${total} Objekte</span>
      </div>
    </div>`;
  }).join('');
  const s=document.getElementById('tour-search'); if(s&&s.value) filterTours(s.value);
}

function renderReasons(nichtTrees){
  const el=document.getElementById('reasons');
  const map={};
  nichtTrees.forEach(t=>{ const r=t.lastReason||'Kein Grund angegeben'; map[r]=(map[r]||0)+1; });
  const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(sorted.length===0){ el.innerHTML='<div class="empty">Keine Ausfälle im Zeitraum 🎉</div>'; return; }
  const max=sorted[0][1];
  el.innerHTML=sorted.map(([reason,cnt])=>`
    <div class="reason-row">
      <div class="reason-head"><span>${esc(reason)}</span><b>${cnt}</b></div>
      <div class="reason-bar"><div class="fill" style="width:${Math.round(cnt/max*100)}%;"></div></div>
    </div>`).join('');
}

function nichtIcon(){
  return window.L.divIcon({
    className:'',
    html:'<div style="width:18px;height:18px;border-radius:50%;background:#dc2626;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);"></div>',
    iconSize:[18,18], iconAnchor:[9,9]
  });
}

function renderNichtMap(nichtReports){
  const L=window.L;
  const wrap=document.getElementById('nicht-map');
  if(!L || !wrap) return;
  if(!nichtMap){
    nichtMap=L.map('nicht-map',{zoomControl:true,attributionControl:false}).setView([50.0,8.42],12);
    L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18,attribution:BASEMAP_ATTR}).addTo(nichtMap);
    nichtLayer=L.layerGroup().addTo(nichtMap);
    setTimeout(()=>nichtMap.invalidateSize(),200);
  }
  nichtLayer.clearLayers();

  // Pro Baum nur die jüngste „nicht"-Meldung
  const byId={};
  nichtReports.forEach(r=>{
    const k=r.id||(r.lat+','+r.lng);
    if(!byId[k] || (r.lastReportAt||'')>(byId[k].lastReportAt||'')) byId[k]=r;
  });
  const uniq=Object.values(byId);
  const withCoords=uniq.filter(r=>r.lat&&r.lng);
  const ohne=uniq.length-withCoords.length;

  const countEl=document.getElementById('map-count');
  if(countEl) countEl.textContent=uniq.length>0?`${uniq.length} Objekte`:'';
  const noteEl=document.getElementById('map-note');
  if(noteEl) noteEl.textContent=ohne>0?`${ohne} ohne Koordinaten (nicht auf der Karte)`:'';
  const emptyEl=document.getElementById('map-empty');
  if(emptyEl) emptyEl.classList.toggle('show', uniq.length===0);

  const pts=[];
  withCoords.forEach(r=>{
    const d=r.lastReportAt?new Date(r.lastReportAt).toLocaleDateString('de-DE'):'–';
    const meta=[r.stadtteil,r.baumnr].filter(Boolean).join(' · ');
    const popup=`<b>${r.name||'Objekt'}</b>`+
      (meta?`<br>${meta}`:'')+
      (r.art?`<br><i>${r.art}</i>`:'')+
      `<br>Grund: <b style="color:#dc2626;">${r.lastReason||'nicht angegeben'}</b>`+
      (r.lastNote?`<br>Notiz: ${r.lastNote}`:'')+
      (r.lastDriver?`<br>Fahrer: ${r.lastDriver}`:'')+
      `<br>${d}`;
    window.L.marker([r.lat,r.lng],{icon:nichtIcon()}).bindPopup(popup).addTo(nichtLayer);
    pts.push([r.lat,r.lng]);
  });
  if(pts.length>0) nichtMap.fitBounds(window.L.latLngBounds(pts),{padding:[40,40],maxZoom:16});
  setTimeout(()=>nichtMap.invalidateSize(),100);
}

function renderTimeline(reported, from, to){
  const canvas=document.getElementById('timeline-chart');
  if(!canvas || !window.Chart) return;

  // Effektiver Bereich (bei "Gesamt" frühestes Meldedatum)
  let start=from, end=to;
  if(period==='all'){
    const dates=reported.map(r=>dayStr(r.lastReportAt)).filter(Boolean).sort();
    start=dates.length?new Date(dates[0]+'T00:00:00'):new Date(to.getTime()-30*86400000);
    end=new Date();
  }
  const spanDays=Math.round((end-start)/86400000)+1;
  const monthly=spanDays>92;

  const buckets={}; const order=[];
  // Schlüssel über lokale Datums-Komponenten (konsistent für Buckets + Meldungen,
  // sonst Zeitzonen-Versatz durch toISOString)
  const pad=n=>String(n).padStart(2,'0');
  const keyOf=(d)=> monthly ? `${d.getFullYear()}-${pad(d.getMonth()+1)}`
                            : `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const cur=new Date(start.getFullYear(),start.getMonth(),monthly?1:start.getDate());
  let guard=0;
  while(cur<=end && guard++<2000){
    const k=keyOf(cur);
    if(!(k in buckets)){ buckets[k]={bew:0,nicht:0}; order.push(k); }
    if(monthly) cur.setMonth(cur.getMonth()+1); else cur.setDate(cur.getDate()+1);
  }
  reported.forEach(r=>{
    if(!r.lastReportAt) return;
    const rd=new Date(r.lastReportAt); if(isNaN(rd)) return;
    const k=keyOf(rd);
    if(!buckets[k]) return;
    if(r.lastStatus==='bewaessert') buckets[k].bew++;
    else if(r.lastStatus==='nicht') buckets[k].nicht++;
  });

  const labels=order.map(k=>{
    if(monthly){ const[y,m]=k.split('-'); return `${m}/${y.slice(2)}`; }
    const d=new Date(k+'T12:00:00'); return `${d.getDate()}.${d.getMonth()+1}.`;
  });

  if(timelineChart) timelineChart.destroy();
  timelineChart=new Chart(canvas,{
    type:'line',
    data:{ labels, datasets:[
      {label:'Erledigt', data:order.map(k=>buckets[k].bew), borderColor:'#16a34a',
       backgroundColor:'rgba(22,163,74,.12)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
      {label:'Nicht erledigt', data:order.map(k=>buckets[k].nicht), borderColor:'#dc2626',
       backgroundColor:'rgba(220,38,38,.08)', fill:true, tension:.3, pointRadius:labels.length>40?0:3, borderWidth:2},
    ]},
    options:{ responsive:true, maintainAspectRatio:false,
      interaction:{mode:'index',intersect:false},
      plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:12,boxWidth:14}}},
      scales:{ x:{ticks:{font:{size:10},maxRotation:0,autoSkip:true,maxTicksLimit:12}, grid:{display:false}},
               y:{beginAtZero:true,ticks:{font:{size:11},precision:0}}}
    }
  });
}

// ─── DATEN LADEN ──────────────────────────────────────────────
async function loadTourHistory(){
  if(!currentProjectId) return;
  try{
    const snap=await db.collection('projects').doc(currentProjectId).collection('tourHistory').get();
    tourHistory=snap.docs.map(d=>normalizeHistory({id:d.id,...d.data()}));
    tourHistoryLoaded=true;
    render();
  }catch(e){ console.warn('tourHistory:',e); }
}

function subscribe(){
  unsubTrees=db.collection('projects').doc(currentProjectId).collection('trees')
    .onSnapshot(snap=>{ trees=snap.docs.map(d=>({id:d.id,...d.data()})); render(); },
                e=>console.warn('trees:',e));
  unsubTours=db.collection('projects').doc(currentProjectId).collection('tours')
    .onSnapshot(snap=>{
      // Übersichtstouren sind keine echten Touren → nicht im Einsatzleiter anzeigen
      tours=snap.docs.filter(d=>!d.data().uebersicht).map((d,i)=>({id:d.id,color:TOUR_COLORS[i%TOUR_COLORS.length],...d.data()}));
      render();
    }, e=>console.warn('tours:',e));
  // tourHistory live statt 60s-Polling: nur bei Änderung Reads (kostengünstig)
  unsubHistory=db.collection('projects').doc(currentProjectId).collection('tourHistory')
    .onSnapshot(snap=>{
      tourHistory=snap.docs.map(d=>normalizeHistory({id:d.id,...d.data()}));
      tourHistoryLoaded=true; render();
    }, e=>console.warn('tourHistory:',e));
}

async function manualRefresh(){
  const icon=document.getElementById('refresh-icon');
  if(icon) icon.style.animation='spin .7s linear infinite';
  await loadTourHistory();
  if(icon) setTimeout(()=>icon.style.animation='',700);
  toast('Aktualisiert');
}

// ─── AUTH / LOGIN (E-Mail -> Projektauswahl) ──────────────────
function _elErr(m){ const e=document.getElementById('login-error'); if(e){ e.textContent=m; e.style.display=m?'block':'none'; } }
function _elBtn(txt,dis){ const b=document.getElementById('btn-login'),l=document.getElementById('btn-login-label'); if(l)l.textContent=txt; if(b)b.disabled=!!dis; }
let elLoginMode='pin';
function _elSetMode(){
  const pm=document.getElementById('lg-pin-mode'), em=document.getElementById('lg-email-mode');
  if(pm) pm.style.display=elLoginMode==='pin'?'':'none';
  if(em) em.style.display=elLoginMode==='email'?'':'none';
}
function toggleLoginMode(){
  elLoginMode = elLoginMode==='pin'?'email':'pin';
  _elSetMode();
  const tg=document.getElementById('login-toggle'); if(tg) tg.textContent=elLoginMode==='pin'?'Admin-Anmeldung (E-Mail)':'Anmeldung mit Stadt-Code + PIN';
  _elErr('');
}
function showLoginStep1(msg){
  document.getElementById('screen-app')?.classList.remove('active');
  document.getElementById('screen-login').classList.add('active');
  _elSetMode();
  const pg=document.getElementById('lg-project'); if(pg) pg.style.display='none';
  const tg=document.getElementById('login-toggle'); if(tg) tg.style.display='';
  _elBtn('Anmelden', false); _elErr(msg||'');
  try{ const oc=localStorage.getItem('bwt_mobile_orgcode'); const e2=document.getElementById('login-orgcode'); if(oc&&e2&&!e2.value)e2.value=oc;
       const nm=localStorage.getItem('bwt_mobile_name'); const e3=document.getElementById('login-name'); if(nm&&e3&&!e3.value)e3.value=nm; }catch(_){}
}
async function showProjectStep(){
  document.getElementById('screen-login').classList.add('active');
  const pm=document.getElementById('lg-pin-mode'), em=document.getElementById('lg-email-mode');
  if(pm) pm.style.display='none'; if(em) em.style.display='none';
  const tg=document.getElementById('login-toggle'); if(tg) tg.style.display='none';
  const pg=document.getElementById('lg-project'); if(pg) pg.style.display='';
  _elBtn('Starten', false); _elErr('');
  await loadProjects();
}

async function loadProjects(){
  const ref=db.collection('projects');
  const snap = currentRole==='superadmin' ? await ref.get() : await ref.where('orgId','==',currentOrg).get();
  const sel=document.getElementById('login-project');
  const docs=snap.docs;
  sel.innerHTML='<option value="">– Projekt wählen –</option>'+
    docs.map(d=>`<option value="${d.id}">${d.data().name||d.id}</option>`).join('');
  if(docs.length===1) sel.value=docs[0].id;
}

async function doLogin(){
  _elErr('');
  const projGroup=document.getElementById('lg-project');
  if(currentUser && projGroup && projGroup.style.display!=='none'){
    const pid=document.getElementById('login-project').value;
    if(!pid){ _elErr('Bitte ein Projekt wählen.'); return; }
    await startEinsatzleiter(pid);
    return;
  }
  if(elLoginMode==='email'){
    const email=(document.getElementById('login-email')?.value||'').trim();
    const pass=document.getElementById('login-pass')?.value||'';
    if(!email||!pass){ _elErr('Bitte E-Mail und Passwort eingeben.'); return; }
    _elBtn('Anmelden…', true);
    try{ await firebase.auth().signInWithEmailAndPassword(email,pass); }
    catch(e){ const c=e&&e.code||''; _elErr(/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)?'E-Mail oder Passwort falsch':('Fehler: '+(e.message||c))); _elBtn('Anmelden',false); }
    return;
  }
  const orgcode=(document.getElementById('login-orgcode')?.value||'').trim();
  const name=(document.getElementById('login-name')?.value||'').trim();
  const pin=(document.getElementById('login-pin')?.value||'').trim();
  if(!orgcode||!name||!pin){ _elErr('Bitte Stadt/Code, Name und PIN ausfüllen.'); return; }
  if(!/^\d{6}$/.test(pin)){ _elErr('PIN muss 6-stellig sein.'); return; }
  _elBtn('Anmelden…', true);
  try{
    const res=await firebase.app().functions('europe-west3').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(),name,pin});
    try{ localStorage.setItem('bwt_mobile_orgcode',orgcode.toUpperCase()); localStorage.setItem('bwt_mobile_name',name); }catch(_){}
    await firebase.auth().signInWithCustomToken(res.data.token);
  }catch(e){ const c=e&&e.code||'',m=e&&e.message||''; _elErr(/permission-denied|not-found|unauthenticated|resource-exhausted/.test(c)?(m||'Name oder PIN falsch'):('Fehler: '+(m||c))); _elBtn('Anmelden',false); }
}

async function startEinsatzleiter(pid){
  const snap=await db.collection('projects').doc(pid).get();
  currentProjectId=pid;
  currentProjectData={id:pid,...snap.data()};
  const _hp=document.getElementById('header-project');
  _hp.textContent=currentProjectData.name||pid;
  // Mandant neben dem Projektnamen (1 Read)
  if(currentProjectData.orgId) db.collection('orgs').doc(currentProjectData.orgId).get().then(s=>{
    const o=s.exists&&s.data().name;
    if(o) _hp.innerHTML=esc(currentProjectData.name||pid)+' <span style="font-size:12px;font-weight:500;color:var(--text3);">· '+esc(o)+'</span>';
  }).catch(()=>{});
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');
  subscribe(); // trees + tours + tourHistory live (kein Polling mehr)
}

async function doLogout(){
  if(!confirm('Abmelden?')) return;
  if(unsubTrees) unsubTrees(); if(unsubTours) unsubTours(); if(unsubHistory) unsubHistory();
  try{ await firebase.auth().signOut(); }catch(_){}
  location.reload();
}

function setPeriod(p){
  period=p;
  document.querySelectorAll('.tf-chip').forEach(c=>c.classList.toggle('active', c.dataset.period===p));
  document.getElementById('tf-custom').classList.toggle('show', p==='custom');
  if(p!=='custom') render();
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('login-pin')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('login-toggle')?.addEventListener('click', toggleLoginMode);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-refresh').addEventListener('click', manualRefresh);
  document.querySelectorAll('.tf-chip').forEach(c=>
    c.addEventListener('click', ()=>setPeriod(c.dataset.period)));
  document.getElementById('date-from').addEventListener('change', render);
  document.getElementById('date-to').addEventListener('change', render);

  // Auth-Gate: Login -> Modul-Check -> Projektauswahl
  firebase.auth().onAuthStateChanged(async (user)=>{
    hideLoading();
    if(user){
      try{ const tok=await user.getIdTokenResult(); currentUser=user; currentRole=tok.claims.role||''; currentCap=tok.claims.cap||''; currentOrg=tok.claims.orgId||''; }
      catch(e){ currentRole=''; currentCap=''; currentOrg=''; }
      if(!currentRole){ showLoginStep1('Dieses Konto hat keine Berechtigung.'); return; }
      // Rollen mandantenscharf (orgs/{org}/roles); Fallback: alter globaler Katalog
      try{
        let rs=currentOrg?await db.collection('orgs').doc(currentOrg).collection('roles').doc(currentRole).get():null;
        if(!rs||!rs.exists) rs=await db.collection('roles').doc(currentRole).get();
        if(rs.exists) elRoles[currentRole]=rs.data();
      }catch(e){}
      if(!canUseEinsatzleiter()){ showLoginStep1('Diese Rolle hat keinen Zugriff auf die Einsatzleiter-App.'); return; }
      showProjectStep();
    } else {
      currentUser=null; currentRole=''; currentCap=''; currentOrg='';
      showLoginStep1('');
    }
  });
});
