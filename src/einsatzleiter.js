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

const TOUR_COLORS = ['#2d6a4f','#1e40af','#7c3aed','#be123c','#b45309','#0e7490','#064e3b','#b91c1c'];

// ─── STATE ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProjectData = null;
let trees = [];
let tours = [];
let tourHistory = [];
let tourHistoryLoaded = false;
let unsubTrees = null;
let unsubTours = null;
let refreshTimer = null;
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

function renderTourProgress(reported){
  const el=document.getElementById('tour-progress');
  if(tours.length===0){ el.innerHTML='<div class="empty">Keine Touren angelegt</div>'; return; }

  el.innerHTML=tourStats(reported).map(({t,total,bewN,nichtN,offen})=>{
    const base=Math.max(total, bewN+nichtN, 1);
    const bewW=bewN/base*100, nichtW=nichtN/base*100, offenW=offen/base*100;
    const pct=total>0?Math.round(bewN/total*100):(bewN+nichtN>0?Math.round(bewN/(bewN+nichtN)*100):0);
    const color=t.color||TOUR_COLORS[0];
    return `<div class="tour-row">
      <div class="tour-head">
        <span class="tour-dot" style="background:${color};"></span>
        <span class="tour-name">${t.name||'Tour'}</span>
        <span class="tour-pct">${pct}%</span>
      </div>
      <div class="tour-bar">
        <div class="seg" style="width:${bewW}%;background:var(--green);"></div>
        <div class="seg" style="width:${nichtW}%;background:var(--red-mid);"></div>
        <div class="seg" style="width:${offenW}%;background:transparent;"></div>
      </div>
      <div class="tour-meta">
        <span><b style="color:var(--green-dark);">${bewN}</b> bew.</span>
        <span><b style="color:var(--red);">${nichtN}</b> nicht</span>
        <span><b>${offen}</b> offen</span>
        <span style="margin-left:auto;">${total} Objekte</span>
      </div>
    </div>`;
  }).join('');
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
      <div class="reason-head"><span>${reason}</span><b>${cnt}</b></div>
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
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(nichtMap);
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
      tours=snap.docs.map((d,i)=>({id:d.id,color:TOUR_COLORS[i%TOUR_COLORS.length],...d.data()}));
      render();
    }, e=>console.warn('tours:',e));
}

async function manualRefresh(){
  const icon=document.getElementById('refresh-icon');
  if(icon) icon.style.animation='spin .7s linear infinite';
  await loadTourHistory();
  if(icon) setTimeout(()=>icon.style.animation='',700);
  toast('Aktualisiert');
}

// ─── LOGIN ────────────────────────────────────────────────────
async function loadProjects(){
  const snap=await db.collection('projects').get();
  const sel=document.getElementById('login-project');
  sel.innerHTML='<option value="">– Projekt wählen –</option>'+
    snap.docs.map(d=>`<option value="${d.id}">${d.data().name||d.id}</option>`).join('');
  if(snap.size===1) sel.value=snap.docs[0].id;
}

async function doLogin(){
  const pid=document.getElementById('login-project').value;
  const errEl=document.getElementById('login-error');
  errEl.style.display='none';
  if(!pid){ errEl.textContent='Bitte ein Projekt wählen.'; errEl.style.display='block'; return; }

  const snap=await db.collection('projects').doc(pid).get();
  currentProjectId=pid;
  currentProjectData={id:pid,...snap.data()};

  document.getElementById('header-project').textContent=currentProjectData.name||pid;
  document.getElementById('screen-login').classList.remove('active');
  document.getElementById('screen-app').classList.add('active');

  subscribe();
  loadTourHistory();
  clearInterval(refreshTimer);
  refreshTimer=setInterval(loadTourHistory, 60000); // Live: tourHistory alle 60s nachladen
}

function doLogout(){
  if(!confirm('Projekt wechseln?')) return;
  if(unsubTrees) unsubTrees(); if(unsubTours) unsubTours();
  clearInterval(refreshTimer);
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
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-refresh').addEventListener('click', manualRefresh);
  document.querySelectorAll('.tf-chip').forEach(c=>
    c.addEventListener('click', ()=>setPeriod(c.dataset.period)));
  document.getElementById('date-from').addEventListener('change', render);
  document.getElementById('date-to').addEventListener('change', render);

  loadProjects().then(()=>{
    hideLoading();
    document.getElementById('screen-login').classList.add('active');
  }).catch(e=>{
    console.error(e); hideLoading();
    document.getElementById('screen-login').classList.add('active');
  });
});
