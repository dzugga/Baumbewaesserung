// ============================================================================
//  Backfill: stadtteil aus Koordinaten ableiten (Wiesbaden, Projekt "Container-Leerung")
//  Punkt-in-Polygon gegen die 26 offiziellen Ortsbezirke (OSM admin_level=9, ODbL).
//  Grenzdaten: scripts/data/wiesbaden-ortsbezirke.json  (aus Overpass, reproduzierbar).
//  Admin-SDK (umgeht Rules) — wird von DIR ausgefuehrt.
//
//  Credentials (eines von beiden):
//    - gcloud auth application-default login, ODER
//    - $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\pfad\serviceAccount.json"
//
//  Ausfuehren (aus dem functions-Ordner):
//    node scripts/backfill-stadtteil-wiesbaden.mjs                 # DRY-RUN (nur Anzeige)
//    node scripts/backfill-stadtteil-wiesbaden.mjs --apply         # schreibt stadtteil (nur wo leer)
//    node scripts/backfill-stadtteil-wiesbaden.mjs --apply --force # auch schon gesetzte ueberschreiben
//    node scripts/backfill-stadtteil-wiesbaden.mjs --apply --liste # zusaetzlich Werteliste stadtteil fuellen
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PROJECT_ID = 'baumbewaesserung';
const TARGET_PROJECT = 'uqbf6BcLnsTkGTZA7dOE'; // org_wiesbaden / "Container-Leerung"
const BATCH = 400;

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const LISTE = process.argv.includes('--liste');

const __dir = path.dirname(fileURLToPath(import.meta.url));
const geo = JSON.parse(fs.readFileSync(path.join(__dir, 'data', 'wiesbaden-ortsbezirke.json'), 'utf8'));

// Grenzen: je Ortsbezirk Bounding-Box (Schnell-Ausschluss) + Segmente
const districts = geo.ortsbezirke.map(d => {
  let laMin=90,laMax=-90,lnMin=180,lnMax=-180;
  d.ways.forEach(w => w.forEach(([la,ln]) => { if(la<laMin)laMin=la; if(la>laMax)laMax=la; if(ln<lnMin)lnMin=ln; if(ln>lnMax)lnMax=ln; }));
  return { name: d.name, ways: d.ways, bb:{laMin,laMax,lnMin,lnMax} };
});

// Ray-Casting ueber die echten Segmente (Ways bilden gemeinsam geschlossene Ringe);
// Paritaet zaehlt Loecher (inner) und Multipolygone korrekt.
function inDistrict(lat, lng, d) {
  const b = d.bb; if (lat < b.laMin || lat > b.laMax || lng < b.lnMin || lng > b.lnMax) return false;
  let cross = 0;
  for (const w of d.ways) {
    for (let i = 0; i + 1 < w.length; i++) {
      const yi=w[i][0], xi=w[i][1], yj=w[i+1][0], xj=w[i+1][1];
      if (((yi>lat)!==(yj>lat)) && (lng < (xj-xi)*(lat-yi)/(yj-yi)+xi)) cross++;
    }
  }
  return (cross & 1) === 1;
}
function classify(lat, lng) {
  const hits = [];
  for (const d of districts) if (inDistrict(lat, lng, d)) hits.push(d.name);
  return hits;
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function log(...a){ console.log(...a); }

async function run() {
  log(`\n=== Backfill stadtteil Wiesbaden  (${APPLY?'APPLY — schreibt!':'DRY-RUN'}${FORCE?', FORCE':''}${LISTE?', +Werteliste':''}) ===`);
  log(`Grenzen: ${districts.length} Ortsbezirke (${geo.quelle}, Stand ${geo.stand})\n`);

  const trees = await db.collection('projects').doc(TARGET_PROJECT).collection('trees').get();
  const dist = new Map();
  const updates = [];
  let noGeo=0, unmatched=0, conflict=0, skipSet=0;
  const problems = [];

  trees.forEach(docSnap => {
    const t = docSnap.data();
    const lat=+t.lat, lng=+t.lng;
    if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat===0||lng===0){ noGeo++; return; }
    const hits = classify(lat, lng);
    if(hits.length!==1){
      if(hits.length===0) unmatched++; else conflict++;
      if(problems.length<20) problems.push({id:docSnap.id, lat, lng, name:t.name||'', hits});
      return;
    }
    const name = hits[0];
    dist.set(name,(dist.get(name)||0)+1);
    const cur=(t.stadtteil||'').toString().trim();
    if(cur && !FORCE){ skipSet++; return; }        // bereits gesetzt, nicht ueberschreiben
    if(cur===name){ return; }                        // identisch -> nichts zu tun
    updates.push({ ref: docSnap.ref, stadtteil: name });
  });

  log('=== Verteilung (eindeutig zugeordnet) ===');
  [...dist.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>log(`  ${v.toString().padStart(5)}  ${k}`));
  log(`\ngesamt: ${trees.size} | eindeutig: ${[...dist.values()].reduce((a,b)=>a+b,0)} | ohne Treffer: ${unmatched} | Mehrfach: ${conflict} | ohne Koords: ${noGeo}`);
  log(`bereits gesetzt (ohne --force uebersprungen): ${skipSet}`);
  log(`zu schreiben: ${updates.length}`);
  if(problems.length){ log('\nNicht eindeutige/leere Punkte (max 20):'); problems.forEach(p=>log('  ',JSON.stringify(p))); }

  if(APPLY){
    let written=0;
    for(let i=0;i<updates.length;i+=BATCH){
      const slice=updates.slice(i,i+BATCH);
      const batch=db.batch();
      slice.forEach(u=>batch.set(u.ref,{stadtteil:u.stadtteil},{merge:true}));
      await batch.commit();
      written+=slice.length;
      log(`  ... ${written}/${updates.length} geschrieben`);
    }

    if(LISTE){
      const names=[...new Set(districts.map(d=>d.name))].sort((a,b)=>a.localeCompare(b));
      const projRef=db.collection('projects').doc(TARGET_PROJECT);
      const proj=await projRef.get();
      const lv=(proj.data()&&proj.data().listValues)||{};
      const have=new Set((lv.stadtteil||[]).map(e=>e.label));
      const list=[...(lv.stadtteil||[])];
      let added=0;
      names.forEach(n=>{ if(!have.has(n)){ list.push({id:'st_'+Math.random().toString(36).slice(2,10), label:n}); have.add(n); added++; } });
      lv.stadtteil=list;
      await projRef.set({listValues:lv},{merge:true});
      log(`\nWerteliste stadtteil: ${added} neue Eintraege (jetzt ${list.length}).`);
    }
    log(`\n=== Fertig: ${written} Objekte geschrieben ===`);
  } else {
    log('\nHinweis: mit  --apply  wirklich schreiben' + (LISTE?' (inkl. --liste Werteliste).':', optional --liste fuer die Werteliste.'));
  }
}

run().then(()=>process.exit(0)).catch(e=>{ console.error(e); process.exit(1); });
