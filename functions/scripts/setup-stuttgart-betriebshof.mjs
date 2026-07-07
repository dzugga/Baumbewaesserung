// ============================================================================
//  Stuttgart „SR-Reinigung": Feld „Betriebshof" (Auswahl-Liste) anlegen.
//  Gilt für alle Objekttypen; ermöglicht Filter „alle/je Betriebshof" und die
//  Bulk-Feldzuweisung (Grenzen verschieben). Werte (5 Betriebshöfe) optional als
//  Argumente übergeben; sonst leer (Namen im UI unter Felder & Listen ergänzen).
//
//    node scripts/setup-stuttgart-betriebshof.mjs                          # DRY-RUN
//    node scripts/setup-stuttgart-betriebshof.mjs --apply                  # Feld anlegen (leere Liste)
//    node scripts/setup-stuttgart-betriebshof.mjs --apply "Nord" "Süd" ... # + Werte
// ============================================================================
import admin from 'firebase-admin';
const PROJECT='L1h2eE8NKfiXCVVCmzTP'; // org_stuttgart / SR-Reinigung
const APPLY=process.argv.includes('--apply');
const NAMES=process.argv.slice(2).filter(a=>a!=='--apply');

admin.initializeApp({ projectId:'baumbewaesserung' });
const db=admin.firestore();
const ref=db.collection('projects').doc(PROJECT);
const d=(await ref.get()).data()||{};
const cf=[...(d.customFields||[])];
const lv=JSON.parse(JSON.stringify(d.listValues||{}));

const has=cf.some(c=>c.key==='betriebshof');
if(!has) cf.push({ key:'betriebshof', label:'Betriebshof', aktiv:true, type:'liste' }); // keine geomTypes → gilt für alle
const have=new Set((lv.betriebshof||[]).map(e=>e.label));
const list=[...(lv.betriebshof||[])]; let added=0;
NAMES.forEach(n=>{ n=n.trim(); if(n&&!have.has(n)){ list.push({ id:'bh_'+Math.random().toString(36).slice(2,10), label:n }); have.add(n); added++; } });
lv.betriebshof=list;

console.log(`\n=== Betriebshof-Feld Stuttgart (${APPLY?'APPLY':'DRY-RUN'}) ===`);
console.log('Feld „Betriebshof" (Liste):', has?'bereits vorhanden':'wird angelegt');
console.log('Werte:', list.length?list.map(e=>e.label).join(', '):'(leer — im UI ergänzen)', added?`(+${added} neu)`:'');
if(!APPLY){ console.log('\nHinweis: mit --apply schreiben; Namen als Argumente anhängen.\n'); process.exit(0); }
await ref.set({ customFields:cf, listValues:lv }, { merge:true });
console.log('\n=== geschrieben ===');
process.exit(0);
