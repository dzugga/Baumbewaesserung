// ============================================================================
//  Essen „Grünflächen": Fach-Rohfelder als Kundenfelder (mit Typ) registrieren
//  + Wertelisten für die Auswahl-Felder aus den Echtdaten aufbauen.
//  Schreibt NUR die Projekt-Feldkonfiguration (customFields/listValues) — die
//  Objektwerte liegen bereits unter genau diesen Schlüsseln (keine Daten-Migration).
//
//    node scripts/migrate-essen-felder.mjs           # DRY-RUN
//    node scripts/migrate-essen-felder.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';

const PROJECT = 'GBkDIDN67YvxkAVgg31T';
const APPLY = process.argv.includes('--apply');

// key → {label, type}. Liste = Auswahl (mit Werteliste), zahl/text = Direkteingabe.
const FELDER = [
  { key:'betriebshof',            label:'Betriebshof',              type:'liste' },
  { key:'fahrzeug',               label:'Fahrzeug',                 type:'liste' },
  { key:'pflegeeinheit',          label:'Pflegeeinheit',            type:'liste' },
  { key:'sommerTage',             label:'Reinigungstage Sommer',    type:'liste' },
  { key:'winterTage',             label:'Reinigungstage Winter',    type:'liste' },
  { key:'belag',                  label:'Belag',                    type:'text'  },
  { key:'teilflaechen',           label:'Teilflächen',              type:'zahl'  },
  { key:'reinigungsflaecheListe', label:'Reinigungsfläche (Liste)', type:'zahl'  },
  { key:'haeufigkeitS',           label:'Häufigkeit Sommer/Woche',  type:'zahl'  },
  { key:'haeufigkeitW',           label:'Häufigkeit Winter/Woche',  type:'zahl'  },
];
const GEOM = ['flaeche'];
// Fahrer-App-Sichtbarkeit (mobilFelder): fahrerrelevante Felder, ohne Planungs-Interna/leere Felder.
const MOBIL_FELDER = ['art','baumnr','stadtteil','belag','sommerTage','winterTage','teilflaechen','reinigungsflaecheListe'];

admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const log = (...a)=>console.log(...a);
const projRef = db.collection('projects').doc(PROJECT);
const proj = await projRef.get();
const pd = proj.data()||{};

// Distinct-Werte je Liste-Feld aus den Objekten
const trees = await projRef.collection('trees').get();
const distinct = {};
FELDER.filter(f=>f.type==='liste').forEach(f=>distinct[f.key]=new Set());
trees.forEach(d=>{ const t=d.data(); FELDER.forEach(f=>{ if(f.type==='liste'){ const v=(t[f.key]==null?'':t[f.key]).toString().trim(); if(v) distinct[f.key].add(v); } }); });

log(`\n=== Essen Feld-Migration (${APPLY?'APPLY — schreibt!':'DRY-RUN'}) ===\n`);
const existing = new Set((pd.customFields||[]).map(c=>c.key));
const cf = [...(pd.customFields||[])];
const lv = JSON.parse(JSON.stringify(pd.listValues||{}));
let added=0, lvAdded=0;
for(const f of FELDER){
  if(existing.has(f.key)){ log(`  = ${f.key} (${f.type}) — bereits vorhanden`); }
  else { cf.push({ key:f.key, label:f.label, aktiv:true, type:f.type, geomTypes:GEOM }); added++; log(`  + ${f.key.padEnd(22)} ${f.type.padEnd(6)} "${f.label}"`); }
  if(f.type==='liste'){
    const have=new Set((lv[f.key]||[]).map(e=>e.label));
    const list=[...(lv[f.key]||[])];
    [...distinct[f.key]].sort((a,b)=>a.localeCompare(b)).forEach(val=>{ if(!have.has(val)){ list.push({ id:'lv_'+Math.random().toString(36).slice(2,10), label:val }); have.add(val); lvAdded++; } });
    lv[f.key]=list;
    log(`      Werteliste ${f.key}: ${list.length} Werte`);
  }
}
log(`\nKundenfelder neu: ${added} | Werteliste-Einträge neu: ${lvAdded}`);
log(`customFields gesamt danach: ${cf.length}`);
log(`Fahrer-App (mobilFelder): ${MOBIL_FELDER.join(', ')}`);

if(!APPLY){ log('\nHinweis: mit --apply schreiben.\n'); process.exit(0); }
await projRef.set({ customFields:cf, listValues:lv, mobilFelder:MOBIL_FELDER }, { merge:true });
log('\n=== geschrieben ===');
process.exit(0);
