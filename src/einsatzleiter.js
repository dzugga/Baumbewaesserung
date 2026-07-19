import { initAppCheck } from './appcheck.js';
import { installErrorHandler } from './errlog.js'; installErrorHandler('einsatzleiter');
import { BASEMAP_FARBE, BASEMAP_ATTR, TILE_PERF } from './basemaps.js';
import { firebaseConfig } from './firebase-config.js';
import { esc } from './esc.js';
import { titelOf as orTitel, buildContainerIndex } from './objektrollen.js';
// Tourkalender (Soll-Logik) — geteilt mit dem Desktop: beide Apps rechnen das Soll identisch
import { tourDueOn as tkDueOn, SAISON_DEFAULT, todayStr, addDays } from './tour-kalender.js';
import { startSession, endSession } from './session.js';
import { startPresence } from './presence.js';
import { startAccountGuard, checkAccountLive } from './session-guard.js';
let _presence = null;   // Präsenz-Sitzung (src/presence.js)
import { initVersionCheck } from './version-check.js';
initVersionCheck();   // erkennt neue Deploys während die App offen ist → „Neu laden"-Banner
// Lazy Container-Index für Anzeige-Rollen; baut neu, sobald sich trees ändert.
let _elIdx = null, _elIdxRef = null;
function _elGetContainer(extId){
  if(_elIdxRef !== trees){ _elIdx = buildContainerIndex(trees); _elIdxRef = trees; }
  return _elIdx.getContainer(extId);
}
function _onSessionKicked(){ try{ alert('Abgemeldet: Diese Kennung wurde an einem anderen Gerät angemeldet.'); }catch(_){}; try{ firebase.auth().signOut(); }catch(_){}; location.reload(); }
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
let unsubTours = null;
let unsubHistory = null;
let nichtMap = null;
let nichtLayer = null;
// Tages-Lagebild (identisch zum Desktop-Dashboard): fester Tagesbezug + Rückblick bis 2 Tage
let dayOffset = 0;                    // 0=heute, 1/2=Rückblick (Zähler dann = Meldungen des Tages)
let heuteTourIds = new Set();         // am gewählten Tag gültige Touren → Basis für KPIs/Karte/Gründe
let heuteDueTourIds = new Set();      // davon regulär fällig (für die Aufteilung heute/Vortage)
let heuteMin = (()=>{ try{ return localStorage.getItem('el_heute_min')==='1'; }catch(_){ return false; } })();
// ── Betriebshof-Filter (wie Desktop-Dashboard/Einsatzplaner): Ansicht, Unzugeordnetes bleibt sichtbar ──
let bhScope = '';
function bhVis(n){ n=(n||'').trim(); return !bhScope || !n || n===bhScope; }
function bhOptions(){
  const s=new Set((((currentProjectData||{}).listValues||{}).betriebshof||[]).map(b=>(b.label||'').trim()).filter(Boolean));
  tours.forEach(t=>{ const n=(t.betriebshof||'').trim(); if(n) s.add(n); });
  return [...s].sort((a,b)=>a.localeCompare(b));
}
function setBh(v){ bhScope=(v||'').trim(); try{ localStorage.setItem('el_bh_'+currentProjectId,bhScope); }catch(_){} render(); }
window.elSetBh=setBh;
async function bhPreset(){ // gemerkte Auswahl je Projekt, sonst eigener Hof der angemeldeten Person (PIN-Login)
  bhScope='';
  let saved=null; try{ saved=localStorage.getItem('el_bh_'+currentProjectId); }catch(_){}
  if(saved!==null){ bhScope=saved; return; }
  try{
    const uid=(firebase.auth().currentUser||{}).uid||'';
    if(!uid.startsWith('drv_')) return;
    const s=await db.collection('drivers').doc(uid.slice(4)).get();
    const hof=s.exists?((s.data().betriebshof||'').trim()):'';
    if(hof) bhScope=hof;
  }catch(e){ console.warn('bh preset',e); }
}

// ─── n:m TOUR-HELFER ──────────────────────────────────────────
function getTreeTourIds(tree){
  if(Array.isArray(tree.tourIds)) return tree.tourIds.filter(Boolean);
  if(tree.tourId) return [tree.tourId];
  return [];
}

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

// ─── TAGESBEZUG ───────────────────────────────────────────────
function selDay(){ return dayOffset ? addDays(todayStr(),-dayOffset) : todayStr(); }
function getDateRange(){
  const [Y,M,D]=selDay().split('-').map(Number);
  const from=new Date(Y,M-1,D);
  return {from, to:new Date(from.getTime()+86400000-1)};
}
function tourDueOn(t,date){
  const s={von:currentProjectData?.sommerVon||SAISON_DEFAULT.von, bis:currentProjectData?.sommerBis||SAISON_DEFAULT.bis};
  return tkDueOn(t,date,s);
}
function isActive(tree){ return !tree || tree.aktiv!==false; }
function lastDueBefore(t,day){ for(let i=1;i<=14;i++){ const d=addDays(day,-i); if(tourDueOn(t,d)) return d; } return null; }
// Wirksame Besetzung heute — gleiche Regel wie im Desktop (_dashCrewToday): Tages-Ersatz (crewDate)
// gilt nur am gestempelten Tag, an fremden Tagen gewinnt die Standard-Besetzung.
function crewToday(t){
  const cur=t.drivers||(t.assignedDriver?[t.assignedDriver]:[]);
  const hasStd=!!(t.stdVehicleId||(t.stdDrivers&&t.stdDrivers.length));
  if(!t.crewDate || t.crewDate===todayStr() || !hasStd) return [...cur];
  return [...(t.stdDrivers||[])];
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

// ─── RENDER (Tages-Lagebild, identisch zum Desktop-Dashboard) ──
function render(){
  if(!currentProjectId) return;
  renderHeute(); // setzt heuteTourIds/heuteDueTourIds (am Tag gültige Touren)
  const rueck=dayOffset>0;
  const day=selDay();
  const dayLbl=rueck?day.slice(8,10)+'.'+day.slice(5,7)+'.':'heute';

  // Nur Meldungen des Tages zu den am Tag gültigen Touren
  const reported=buildReported().filter(r=>getTreeTourIds(r).some(id=>heuteTourIds.has(id)));
  const bew=reported.filter(r=>r.lastStatus==='bewaessert');
  const nicht=reported.filter(r=>r.lastStatus==='nicht');
  const meldungen=bew.length+nicht.length;
  const pct=meldungen>0?Math.round(bew.length/meldungen*100):0;
  const aktiveFahrer=new Set(reported.map(r=>r.lastDriver).filter(Boolean)).size;

  // Auftragsbestand: eindeutige Objekte der am Tag gültigen Touren; heute geteilt in „heute"/„aus Vortagen"
  let aufHeute=0, aufVortage=0, gemeldet=0;
  trees.forEach(x=>{ if(!isActive(x)) return; const tids=getTreeTourIds(x);
    const inDue=tids.some(id=>heuteDueTourIds.has(id));
    if(!inDue&&!tids.some(id=>heuteTourIds.has(id))) return;
    if(inDue) aufHeute++; else aufVortage++;
    if(!rueck&&x.lastStatus) gemeldet++; }); // gemeldet heute = laufender Durchgang (wie Fahrer-App)
  if(rueck) gemeldet=new Set(reported.map(r=>r.id)).size;
  const auftraege=aufHeute+aufVortage;
  const aufSub=(!rueck&&aufVortage)?`${aufHeute} heute · ${aufVortage} aus Vortagen · ${gemeldet} gemeldet`
    :`${gemeldet} gemeldet · ${heuteTourIds.size} Tour${heuteTourIds.size===1?'':'en'}`;

  document.getElementById('kpi-grid').innerHTML=[
    {val:auftraege, lbl:'Aufträge '+dayLbl, sub:aufSub, color:'var(--text)'},
    {val:bew.length, lbl:'Erledigt', sub:`${dayLbl} · ${pct}% der Meldungen`, color:'var(--green-dark)'},
    {val:nicht.length, lbl:'Nicht erledigt', sub:dayLbl, color:'var(--red)'},
    {val:meldungen, lbl:'Meldungen', sub:dayLbl+' gesamt', color:'var(--blue)'},
    {val:aktiveFahrer, lbl:'Aktive Fahrer', sub:dayLbl, color:'var(--amber)'},
  ].map(k=>`<div class="kpi-tile">
    <div class="kpi-val" style="color:${k.color};">${k.val}</div>
    <div class="kpi-lbl">${k.lbl}</div>
    <div class="kpi-sub">${k.sub}</div>
  </div>`).join('');
  const mapDay=document.getElementById('map-day'); if(mapDay) mapDay.textContent=dayLbl;

  renderReasons(nicht);
  renderNichtMap(nicht);

  const u=document.getElementById('header-updated');
  if(u) u.textContent='Stand: '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
}

const WD_FULL=['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];
function setDay(off){ dayOffset=Math.max(0,Math.min(2,off)); render(); }
function toggleHeuteMin(){ heuteMin=!heuteMin; try{ localStorage.setItem('el_heute_min',heuteMin?'1':''); }catch(_){} render(); }
window.elSetDay=setDay; window.elToggleHeute=toggleHeuteMin;

// Heute-Block: Soll aus dem Tourkalender + Ist je Tour (Port von dashRenderHeute im Desktop).
// Heute: ✓/✕/gemeldet = laufender Durchgang JE TOUR (runStatus[tourId], deckungsgleich mit der Fahrer-App;
// NICHT das globale lastStatus — das zählt bei geteilten Objekten/Tour-Kopien doppelt);
// Rückblick: letzte Meldung des gewählten Tages je Objekt (Live-Zustand ist nicht rückwirkend gespeichert).
function renderHeute(){
  const el=document.getElementById('el-heute'); if(!el) return;
  const day=selDay(), rueck=dayOffset>0, today=todayStr();
  const memTour={}, repTour={}, cntTour={}, lastTour={}, bewTour={}, nichtTour={};
  trees.forEach(x=>{
    if(!isActive(x)) return;
    const tids=getTreeTourIds(x); if(!tids.length) return;
    tids.forEach(tid=>{ memTour[tid]=(memTour[tid]||0)+1;
      const _rs=(!rueck&&x.runStatus)?x.runStatus[tid]:null;
      if(_rs&&_rs.status){ repTour[tid]=(repTour[tid]||0)+1;
        if(_rs.status==='bewaessert') bewTour[tid]=(bewTour[tid]||0)+1; else nichtTour[tid]=(nichtTour[tid]||0)+1; } });
    let n=0,last='',lastStatus='';
    (x.history||[]).forEach(h=>{ if(h&&h.status&&h.date===day){ n++; if(!h.at||h.at>=last){ last=h.at||last; lastStatus=h.status; } } });
    if(n) tids.forEach(tid=>{ cntTour[tid]=(cntTour[tid]||0)+n;
      if(!lastTour[tid]||last>lastTour[tid]) lastTour[tid]=last;
      if(rueck){ repTour[tid]=(repTour[tid]||0)+1;
        if(lastStatus==='bewaessert') bewTour[tid]=(bewTour[tid]||0)+1; else nichtTour[tid]=(nichtTour[tid]||0)+1; } });
  });
  const rows=[];
  tours.forEach(t=>{
    if(!bhVis(t.betriebshof)) return; // Betriebshof-Filter (KPIs/Karte/Gründe folgen via heuteTourIds)
    const closedToday=rueck?(t.lastClosedDate===day):(t.status==='abgeschlossen'&&t.lastClosedDate===day);
    let dueToday=false, since=null;
    if(rueck){ // Rückblick: nur regulär fällige Touren des Tages (Überhänge/Bedarfs-Stand nicht rekonstruierbar)
      dueToday=(t.interval||'')==='bedarf'?t.crewDate===day:tourDueOn(t,day);
      if(!dueToday) return;
    } else if((t.interval||'')==='bedarf'){
      if(!t.crewDate||t.crewDate>day) return;
      const closedSince=t.lastClosedDate&&t.lastClosedDate>=t.crewDate;
      if(closedSince&&!closedToday) return;
      dueToday=t.crewDate===day; since=dueToday?null:t.crewDate;
    } else {
      dueToday=tourDueOn(t,day);
      if(!dueToday){
        const ld=lastDueBefore(t,day); if(!ld) return;
        const closedSince=t.lastClosedDate&&t.lastClosedDate>=ld;
        if(closedSince&&!closedToday) return;
        since=ld;
      }
    }
    const total=memTour[t.id]||0, rep=repTour[t.id]||0, bewN=bewTour[t.id]||0, nichtN=nichtTour[t.id]||0;
    const state=closedToday?'done':((cntTour[t.id]||0)>0?'run':'none');
    rows.push({t,dueToday,since,total,rep,bewN,nichtN,offenN:Math.max(0,total-rep),
      last:lastTour[t.id]?String(lastTour[t.id]).slice(11,16):'',
      closedTime:(closedToday&&t.closedAt)?String(t.closedAt).slice(11,16):'',state,crew:crewToday(t)});
  });
  rows.sort((a,b)=>{ const o={none:0,run:1,done:2}; return (o[a.state]-o[b.state])||((a.since?0:1)-(b.since?0:1))||String(a.t.name||'').localeCompare(String(b.t.name||'')); });
  heuteTourIds=new Set(rows.map(r=>r.t.id));
  heuteDueTourIds=new Set(rows.filter(r=>r.dueToday).map(r=>r.t.id));
  const doneN=rows.filter(r=>r.state==='done').length, runN=rows.filter(r=>r.state==='run').length, noneN=rows.length-doneN-runN;
  const dueN=rows.filter(r=>r.dueToday).length, lateN=rows.length-dueN;
  const extra=tours.filter(t=>!heuteTourIds.has(t.id)&&cntTour[t.id]&&bhVis(t.betriebshof)).map(t=>({t,n:cntTour[t.id]}));
  const _seit=r=>r.since?` · fällig ${r.since.slice(5).split('-').reverse().join('.')}`:'';
  const pill=r=>r.state==='done'?`<span style="font-size:10.5px;font-weight:600;color:#166534;background:#dcfce7;border-radius:99px;padding:2px 9px;white-space:nowrap;">✓ abgeschlossen${r.closedTime?' '+r.closedTime:''}${_seit(r)}</span>`
    :r.state==='run'?`<span style="font-size:10.5px;font-weight:600;color:#1e40af;background:#dbeafe;border-radius:99px;padding:2px 9px;white-space:nowrap;">▶ ${rueck?'gemeldet':'läuft'}${r.last?' · zuletzt '+r.last:''}${_seit(r)}</span>`
    :r.since?`<span style="font-size:10.5px;font-weight:600;color:#991b1b;background:#fee2e2;border-radius:99px;padding:2px 9px;white-space:nowrap;">⏰ nicht abgeschlossen${_seit(r)}</span>`
    :`<span style="font-size:10.5px;font-weight:600;color:#854f0b;background:#fef3c7;border-radius:99px;padding:2px 9px;white-space:nowrap;">○ keine Rückmeldung</span>`;
  const kpi=(v,l,c)=>`<div style="background:var(--surface2);border-radius:8px;padding:7px 12px;"><div style="font-size:18px;font-weight:800;line-height:1.1;color:${c};">${v}</div><div style="font-size:10.5px;color:var(--text2);">${l}</div></div>`;
  const wd=WD_FULL[new Date(day+'T12:00:00').getDay()];
  const dayBtns=[2,1,0].map(o=>{ const d=o?addDays(today,-o):today; const lbl=o?d.slice(8,10)+'.'+d.slice(5,7)+'.':'Heute'; const act=o===dayOffset;
    return `<button onclick="elSetDay(${o})" style="background:${act?'var(--surface2)':'none'};border:1px solid ${act?'var(--text3)':'var(--border)'};border-radius:6px;padding:3px 9px;cursor:pointer;color:${act?'var(--text)':'var(--text3)'};font-family:inherit;font-size:11px;font-weight:${act?'700':'400'};">${lbl}</button>`; }).join('');
  const bhOpts=bhOptions(); if(bhScope&&!bhOpts.includes(bhScope)) bhOpts.push(bhScope);
  const bhSel=bhOpts.length?`<select onchange="elSetBh(this.value)" title="Betriebshof-Filter — Unzugeordnetes bleibt sichtbar" style="border:1px solid ${bhScope?'#d97706':'var(--border)'};border-radius:6px;padding:3px 6px;font-family:inherit;font-size:11px;color:${bhScope?'var(--text)':'var(--text3)'};background:var(--surface);max-width:140px;">
      <option value="">Alle Höfe</option>${bhOpts.map(b=>`<option value="${esc(b)}"${b===bhScope?' selected':''}>${esc(b)}</option>`).join('')}</select>`:'';
  const tgl=`<span style="margin-left:auto;display:flex;gap:4px;align-items:center;flex-wrap:wrap;">${bhSel}${dayBtns}<button onclick="elToggleHeute()" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer;color:var(--text3);font-family:inherit;font-size:11px;">${heuteMin?'▸ aufklappen':'▾ minimieren'}</button></span>`;
  const border=rueck?'#d97706':'var(--green)';
  const titel=`${rueck?'Rückblick':'Heute'} — ${wd}, ${day.split('-').reverse().join('.')}`;
  const hinweis=(rueck?'Meldungen und Abschlüsse des Tages — Live-Status nur in der Heute-Ansicht':'Soll aus dem Tourkalender')+(bhScope?` · Hof „${esc(bhScope)}" + ohne Zuordnung`:'');
  if(heuteMin){
    el.innerHTML=`<div class="card" style="border:2px solid ${border};padding:10px 14px;">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <span style="font-size:12.5px;font-weight:700;">${titel}</span>
        <span style="font-size:11.5px;color:var(--text2);"><b style="font-weight:700;">${dueN}</b> fällig${lateN?` · <b style="font-weight:700;color:#991b1b;">${lateN}</b> ⏰ aus Vortagen`:''} · <b style="font-weight:700;color:var(--green-dark);">${doneN}</b> ✓ · <b style="font-weight:700;color:#1e40af;">${runN}</b> ▶ · <b style="font-weight:700;color:${noneN?'#b45309':'var(--text3)'};">${noneN}</b> ○${extra.length?` · <span style="color:#854f0b;">⚠ ${extra.length} außerplanmäßig</span>`:''}</span>
        ${tgl}
      </div>
    </div>`;
    return;
  }
  el.innerHTML=`<div class="card" style="border:2px solid ${border};">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap;">
      <span style="font-size:13px;font-weight:700;">${titel}</span>
      <span style="font-size:10.5px;color:var(--text3);">${hinweis}</span>
      ${tgl}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin-bottom:${rows.length?'12px':'0'};">
      ${kpi(dueN,'Touren fällig (Soll)','var(--text)')}${lateN?kpi(lateN,'aus Vortagen offen','#991b1b'):''}${kpi(doneN,'abgeschlossen','var(--green-dark)')}${kpi(runN,rueck?'hat gemeldet':'läuft (meldet)','#1e40af')}${kpi(noneN,'ohne Rückmeldung',noneN?'#b45309':'var(--text3)')}
    </div>
    ${rows.length?rows.map(r=>`
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid var(--surface2);flex-wrap:wrap;">
        <span style="width:9px;height:9px;border-radius:50%;background:${r.t.color||'#888'};flex-shrink:0;"></span>
        <span style="font-size:12.5px;font-weight:600;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(r.t.name||'Tour')}${(bhScope&&!(r.t.betriebshof||'').trim())?' <span style="font-size:9px;font-weight:700;color:var(--text3);background:var(--surface2);padding:1px 6px;border-radius:5px;">ohne Betriebshof</span>':''} <span style="font-weight:400;color:${r.crew.length?'var(--text3)':'var(--red)'};font-size:11px;">· ${r.crew.length?esc(r.crew.join(', ')):'unbesetzt'}</span></span>
        <span style="font-size:11px;color:var(--text2);white-space:nowrap;"><b style="font-weight:700;color:var(--green-dark);">${r.bewN}</b> ✓ · <b style="font-weight:700;color:${r.nichtN?'var(--red)':'var(--text3)'};">${r.nichtN}</b> ✕ · ${r.offenN} offen · ${r.total} Obj.</span>
        <span style="display:flex;width:60px;height:5px;border-radius:3px;background:var(--surface2);overflow:hidden;flex-shrink:0;"><span style="width:${r.total?Math.round(r.bewN/r.total*100):0}%;background:var(--green);"></span><span style="width:${r.total?Math.round(r.nichtN/r.total*100):0}%;background:var(--red-mid);"></span></span>
        ${pill(r)}
      </div>`).join(''):`<div style="font-size:12px;color:var(--text3);">${rueck?'An diesem Tag waren laut Tourkalender keine Touren fällig.':'Heute sind laut Tourkalender keine Touren fällig — und aus den Vortagen ist nichts offen.'}</div>`}
    ${extra.length?`<div style="display:flex;align-items:baseline;gap:8px;margin-top:9px;padding-top:8px;border-top:1px solid var(--border);font-size:11px;color:var(--text2);flex-wrap:wrap;">
      <span style="color:#854f0b;font-weight:600;">⚠ Außerplanmäßig gefahren:</span>
      ${extra.map(x=>`<span><b style="font-weight:600;">${esc(x.t.name||'Tour')}</b> — ${x.n} Meldung${x.n===1?'':'en'} ${rueck?'an diesem Tag':'heute'}, laut Kalender nicht fällig</span>`).join(' · ')}
    </div>`:''}
  </div>`;
}

function renderReasons(nichtTrees){
  const el=document.getElementById('reasons');
  const map={};
  nichtTrees.forEach(t=>{ const r=t.lastReason||'Kein Grund angegeben'; map[r]=(map[r]||0)+1; });
  const sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]);
  if(sorted.length===0){ el.innerHTML='<div class="empty">Keine Ausfälle 🎉</div>'; return; }
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
    L.tileLayer(BASEMAP_FARBE,{maxZoom:20,maxNativeZoom:18,attribution:BASEMAP_ATTR,...TILE_PERF}).addTo(nichtMap);
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
    const popup=`<b>${esc(orTitel(r,_elGetContainer)||'Objekt')}</b>`+
      (meta?`<br>${esc(meta)}`:'')+
      (r.art?`<br><i>${esc(r.art)}</i>`:'')+
      `<br>Grund: <b style="color:#dc2626;">${esc(r.lastReason||'nicht angegeben')}</b>`+
      (r.lastNote?`<br>Notiz: ${esc(r.lastNote)}`:'')+
      (r.lastDriver?`<br>Fahrer: ${esc(r.lastDriver)}`:'')+
      `<br>${esc(d)}`;
    window.L.marker([r.lat,r.lng],{icon:nichtIcon()}).bindPopup(popup).addTo(nichtLayer);
    pts.push([r.lat,r.lng]);
  });
  if(pts.length>0) nichtMap.fitBounds(window.L.latLngBounds(pts),{padding:[40,40],maxZoom:16});
  setTimeout(()=>nichtMap.invalidateSize(),100);
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

// Mehrere Snapshot-Callbacks im selben Frame (z. B. die Chunk-Listener beim Start) lösen nur
// EINEN render() aus — sonst rechnet das Lagebild 7-9× hintereinander komplett neu.
let _renderRaf=null;
function scheduleRender(){
  if(_renderRaf) return;
  _renderRaf=requestAnimationFrame(()=>{ _renderRaf=null; render(); });
}
function subscribe(){
  unsubTours=db.collection('projects').doc(currentProjectId).collection('tours')
    .onSnapshot(snap=>{
      // Übersichten sind keine echten Touren → nicht im Einsatzleiter anzeigen
      tours=snap.docs.filter(d=>!d.data().uebersicht).map((d,i)=>({id:d.id,color:TOUR_COLORS[i%TOUR_COLORS.length],...d.data()}));
      _subscribeTrees(); // Objekte NUR der Touren laden — folgt der Tour-Menge automatisch
      scheduleRender();
    }, e=>console.warn('tours:',e));
  // tourHistory live statt 60s-Polling: nur bei Änderung Reads (kostengünstig)
  unsubHistory=db.collection('projects').doc(currentProjectId).collection('tourHistory')
    .onSnapshot(snap=>{
      tourHistory=snap.docs.map(d=>normalizeHistory({id:d.id,...d.data()}));
      tourHistoryLoaded=true; scheduleRender();
    }, e=>console.warn('tourHistory:',e));
}
// Objekt-Listener auf die TOUR-Objekte begrenzt (statt aller Objekte des Projekts — das Lagebild
// wertet ausschließlich Objekte MIT Tour-Zuordnung aus; bei großen Segmentnetzen spart das den
// Löwenanteil). tourIds-Chunks à 10 (array-contains-any-Limit konservativ); Alt-Feld tourId einmalig.
let _treeChunkUnsubs=[], _treeChunks=[], _legacyTrees=[], _treeSetKey=null;
function _subscribeTrees(){
  const ids=tours.map(t=>t.id);
  const key=ids.slice().sort().join(',');
  if(key===_treeSetKey) return; // Tour-Menge unverändert → Listener stehen lassen
  _treeSetKey=key;
  _treeChunkUnsubs.forEach(u=>{ try{u();}catch(_){} }); _treeChunkUnsubs=[]; _treeChunks=[]; _legacyTrees=[];
  if(!ids.length){ trees=[]; _elLoadHint(false); scheduleRender(); return; }
  const col=db.collection('projects').doc(currentProjectId).collection('trees');
  const chunks=[]; for(let i=0;i<ids.length;i+=10) chunks.push(ids.slice(i,i+10));
  chunks.forEach((c,i)=>{
    _treeChunkUnsubs.push(col.where('tourIds','array-contains-any',c).onSnapshot(s=>{
      _treeChunks[i]=s.docs.map(d=>({id:d.id,...d.data()}));
      _mergeTrees();
    }, e=>console.warn('trees:',e)));
  });
  // Objekte, die NUR das Alt-Feld tourId tragen (einmalig, ohne Live-Updates — Alt-Datenbestände)
  Promise.all(chunks.map(c=>col.where('tourId','in',c).get().catch(()=>null))).then(snaps=>{
    const seen=new Set(); _legacyTrees=[];
    snaps.forEach(s=>{ if(s) s.forEach(d=>{ if(!seen.has(d.id)){ seen.add(d.id); _legacyTrees.push({id:d.id,...d.data()}); } }); });
    _mergeTrees();
  });
}
function _mergeTrees(){
  const m=new Map();
  _legacyTrees.forEach(t=>m.set(t.id,t));
  _treeChunks.forEach(a=>(a||[]).forEach(t=>m.set(t.id,t))); // Live-Stand gewinnt über Alt-Feld-Kopie
  trees=[...m.values()];
  _elLoadHint(false);
  scheduleRender();
}
// Dezenter Lade-Hinweis, bis die ersten Objekte da sind (das Lagebild zeigt sonst stumm Nullen)
function _elLoadHint(on){
  let el=document.getElementById('el-load-hint');
  if(on){
    if(!el){
      el=document.createElement('div'); el.id='el-load-hint';
      el.style.cssText='position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:5000;background:var(--surface,#fff);border:1px solid var(--border,#e2e8f0);border-radius:20px;padding:7px 16px;font-size:13px;font-weight:600;box-shadow:0 2px 10px rgba(0,0,0,.15);display:flex;align-items:center;gap:8px;';
      el.innerHTML='<span style="width:12px;height:12px;border:2px solid var(--green,#2d6a4f);border-top-color:transparent;border-radius:50%;display:inline-block;animation:spin .8s linear infinite;"></span>Objekte werden geladen…';
      document.body.appendChild(el);
    }
    el.style.display='flex';
  } else if(el) el.style.display='none';
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
    docs.map(d=>`<option value="${esc(d.id)}">${esc(d.data().name||d.id)}</option>`).join('');
  if(docs.length===1) sel.value=docs[0].id;
}

async function doLogin(){
  _elErr('');
  const projGroup=document.getElementById('lg-project');
  if(currentUser && projGroup && projGroup.style.display!=='none'){
    const pid=document.getElementById('login-project').value;
    if(!pid){ _elErr('Bitte ein Projekt wählen.'); return; }
    _elBtn('Projekt laden…', true); // sichtbares Lade-Feedback bis das Lagebild steht
    try{ await startEinsatzleiter(pid); }
    catch(e){ _elErr('Fehler: '+(e.message||e.code||e)); _elBtn('Starten', false); }
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
    const res=await firebase.app().functions('europe-west3').httpsCallable('driverLogin')({orgCode:orgcode.toUpperCase(),name,pin,app:'einsatzleiter'});
    try{ localStorage.setItem('bwt_mobile_orgcode',orgcode.toUpperCase()); localStorage.setItem('bwt_mobile_name',name); }catch(_){}
    await firebase.auth().signInWithCustomToken(res.data.token);
    startSession(res.data.sessionId, _onSessionKicked);
  }catch(e){ const c=e&&e.code||'',m=e&&e.message||''; if(/already-exists/.test(c)){ _elErr(m||'Diese Kennung ist bereits an einem anderen Gerät angemeldet.'); _elBtn('Anmelden',false); return; } _elErr(/permission-denied|not-found|unauthenticated|resource-exhausted/.test(c)?(m||'Name oder PIN falsch'):('Fehler: '+(m||c))); _elBtn('Anmelden',false); }
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
  _elLoadHint(true); // „Objekte werden geladen…" bis die ersten Daten da sind
  await bhPreset(); // Betriebshof-Vorbelegung (gemerkte Auswahl bzw. eigener Hof)
  subscribe(); // tours + tourHistory live; Objekte tour-gescoped über _subscribeTrees
}

async function doLogout(){
  if(!confirm('Abmelden?')) return;
  _treeChunkUnsubs.forEach(u=>{ try{u();}catch(_){} }); _treeChunkUnsubs=[]; _treeSetKey=null;
  if(unsubTours) unsubTours(); if(unsubHistory) unsubHistory();
  try{ _presence&&_presence.stop(); }catch(_){}
  try{ await endSession(); }catch(_){}
  try{ await firebase.auth().signOut(); }catch(_){}
  location.reload();
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('btn-login').addEventListener('click', doLogin);
  document.getElementById('login-pass')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('login-pin')?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
  document.getElementById('login-toggle')?.addEventListener('click', toggleLoginMode);
  document.getElementById('btn-logout').addEventListener('click', doLogout);
  document.getElementById('btn-refresh').addEventListener('click', manualRefresh);

  // Auth-Gate: Login -> Modul-Check -> Projektauswahl
  let _acctGuard=null, _authMsg='';
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
      // Konto-Liveness: wiederhergestellte Session eines deaktivierten/gelöschten Kontos abweisen (fail-open).
      const _acc=await checkAccountLive({auth:firebase.auth(), db});
      if(_acc==='gone'||_acc==='inactive'){ _authMsg=_acc==='inactive'?'Dieses Konto wurde deaktiviert. Bitte an den Administrator wenden.':'Dieses Konto ist nicht mehr gültig. Bitte neu anmelden.'; try{ await firebase.auth().signOut(); }catch(_){ showLoginStep1(_authMsg); _authMsg=''; } return; }
      try{ _presence=startPresence({db, orgId:currentOrg||('super:'+currentUser.uid), kind:'einsatzleiter', userKey:currentUser.uid, uid:currentUser.uid, name:currentUser.email||'', role:currentRole, app:'einsatzleiter'}); }catch(_){}
      try{ _acctGuard&&_acctGuard.stop(); }catch(_){}
      _acctGuard=startAccountGuard({auth:firebase.auth(), db, onInvalid:(st)=>{ _acctGuard=null; _authMsg=st==='inactive'?'Ihr Konto wurde deaktiviert — Sie wurden abgemeldet.':'Ihr Konto wurde entfernt — Sie wurden abgemeldet.'; try{_presence&&_presence.stop();}catch(_){}; firebase.auth().signOut().catch(()=>{ showLoginStep1(_authMsg); _authMsg=''; }); }});
      showProjectStep();
    } else {
      currentUser=null; currentRole=''; currentCap=''; currentOrg='';
      try{ _acctGuard&&_acctGuard.stop(); }catch(_){}; _acctGuard=null;
      showLoginStep1(_authMsg); _authMsg='';
    }
  });
});
