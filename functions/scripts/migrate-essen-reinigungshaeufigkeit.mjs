// ============================================================================
//  Essen „Grünflächen": Reinigungshäufigkeit als geordnetes Soll-Feld aufbauen.
//  Widmet das (leere) Rang-Feld `zustand` zu „Reinigungshäufigkeit" um:
//   - Soll = Anzahl Reinigungstage/Woche (sommerTage/winterTage); Rückfall auf
//     die Zahl haeufigkeitS/W nur bei unter-wöchentlich (<1, z. B. 0,25).
//   - je Sommer/Winter-Paar ein geordneter Listenwert (zahl=Sommer, zahlWinter=Winter)
//   - jedem Objekt den passenden Wert zuweisen; sollFeld = zustand; Feld umbenennen.
//  Rohfelder haeufigkeitS/W + sommerTage/winterTage bleiben unverändert erhalten.
//
//    node scripts/migrate-essen-reinigungshaeufigkeit.mjs           # DRY-RUN
//    node scripts/migrate-essen-reinigungshaeufigkeit.mjs --apply
// ============================================================================
import admin from 'firebase-admin';
const PROJECT='GBkDIDN67YvxkAVgg31T';
const FIELD='zustand';                 // umgewidmetes Rang-Feld
const LABEL='Reinigungshäufigkeit';
const APPLY=process.argv.includes('--apply');
const BATCH=400;

const DAYS=['mo','di','mi','do','fr','sa','so'];
function countDays(s){ if(!s) return 0; const set=new Set(); String(s).toLowerCase().split(/[^a-zäöü]+/).forEach(w=>{ const d=w.slice(0,2); if(DAYS.includes(d)) set.add(d); }); return set.size; }
// Maßgebliche Soll-Zahl je Saison: Tage zählen; unter-wöchentlich (<1) → Zahl; sonst Tage; sonst Zahl; sonst 0
function sollFor(hRaw, tage){
  const h=parseFloat(hRaw); const d=countDays(tage);
  if(!isNaN(h)&&h>0&&h<1) return h;
  if(d>0) return d;
  if(!isNaN(h)&&h>0) return h;
  return 0;
}
function fmtN(n){ return Number.isInteger(n)?String(n):n.toLocaleString('de-DE'); }
function labelFor(s,w){
  if(s===0&&w===0) return 'K. A.';
  if(s===w) return s===0.25?'alle 4 Wochen':fmtN(s)+'× wöchentlich';
  return 'Sommer '+fmtN(s)+'× · Winter '+fmtN(w)+'×';
}
const idFor=(s,w)=>'rh_'+String(s).replace('.','_')+'_'+String(w).replace('.','_');
const PALETTE=['#15803d','#16a34a','#22c55e','#0891b2','#0ea5e9','#3b82f6','#7c3aed','#a855f7','#db2777','#d97706','#ea580c','#dc2626'];

admin.initializeApp({ projectId:'baumbewaesserung' });
const db=admin.firestore();
const log=(...a)=>console.log(...a);
const projRef=db.collection('projects').doc(PROJECT);
const proj=await projRef.get();

const trees=await projRef.collection('trees').get();
const pairCount=new Map(); const treeAssign=[];
trees.forEach(d=>{ const t=d.data(); if(t.geomType!=='flaeche') return;
  const s=sollFor(t.haeufigkeitS,t.sommerTage), w=sollFor(t.haeufigkeitW,t.winterTage);
  const id=idFor(s,w); pairCount.set(id,(pairCount.get(id)||0)+1);
  if((t[FIELD]||'')!==id) treeAssign.push({ref:d.ref,id});
});
// Werte ordnen: Sommer desc, dann Winter desc; K.A. (0/0) ganz unten
const pairs=[...pairCount.keys()].map(id=>{ const m=id.slice(3).split('_'); const s=parseFloat(m.slice(0,m.length-2).join('.'))||( id==='rh_0_25_0_25'?0.25:0 ); return {id}; });
// robust: aus den Objekten die (s,w) je id neu ableiten
const sw={}; trees.forEach(d=>{ const t=d.data(); if(t.geomType!=='flaeche') return; const s=sollFor(t.haeufigkeitS,t.sommerTage), w=sollFor(t.haeufigkeitW,t.winterTage); sw[idFor(s,w)]={s,w}; });
const ordered=Object.keys(sw).map(id=>({id,...sw[id],cnt:pairCount.get(id)||0}))
  .sort((a,b)=> (b.s-a.s)|| (b.w-a.w));
let rang=1; const values=ordered.map((p,i)=>{
  const farbe=(p.s===0&&p.w===0)?'#9ca3af':(p.s<1?'#6b7280':PALETTE[i%PALETTE.length]);
  return { id:p.id, label:labelFor(p.s,p.w), rang:rang++, farbe, zahl:p.s, zahlWinter:p.w, cnt:p.cnt };
});

log(`\n=== Reinigungshäufigkeit-Migration (${APPLY?'APPLY — schreibt!':'DRY-RUN'}) ===`);
log(`Feld „${FIELD}" → „${LABEL}", als Soll-Feld; Basis: Reinigungstage (Rückfall Zahl <1/Wo).\n`);
log('RANG  WERT                              SOMMER  WINTER  OBJEKTE  FARBE');
values.forEach(v=>log(`${String(v.rang).padStart(3)}   ${v.label.padEnd(32)}  ${fmtN(v.zahl).padStart(6)}  ${fmtN(v.zahlWinter).padStart(6)}  ${String(v.cnt||0).padStart(6)}   ${v.farbe}`));
log(`\nWerte gesamt: ${values.length} | Objekt-Zuweisungen zu schreiben: ${treeAssign.length} | sollFeld=${FIELD}`);

if(!APPLY){ log('\nHinweis: mit --apply schreiben.\n'); process.exit(0); }
// 1) Werteliste + Label + sollFeld am Projekt
const lv=JSON.parse(JSON.stringify(proj.data().listValues||{})); lv[FIELD]=values.map(({cnt,...v})=>v);
const fl={...(proj.data().fieldLabels||{})}; fl[FIELD]=LABEL;
await projRef.set({ listValues:lv, fieldLabels:fl, sollFeld:FIELD }, { merge:true });
log('Projekt: Werteliste + Label + sollFeld geschrieben.');
// 2) Objekte zuweisen
let n=0; for(let i=0;i<treeAssign.length;i+=BATCH){ const b=db.batch(); treeAssign.slice(i,i+BATCH).forEach(u=>b.update(u.ref,{[FIELD]:u.id})); await b.commit(); n+=Math.min(BATCH,treeAssign.length-i); log(`  Objekte: ${n}/${treeAssign.length}`); }
log('\n=== fertig ===');
process.exit(0);
