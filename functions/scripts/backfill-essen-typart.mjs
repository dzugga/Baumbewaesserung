// ============================================================================
//  Essen „Grünflächen": Objektart als Typ/Art führen + Objektnummer ins Standardfeld.
//  - art   = objektart   (nur wo art leer)   → Typ/Art-Liste, Symbole, Filter, Gruppierung
//  - baumnr= objektnummer (nur wo baumnr leer) → Standard-„Objektnummer"
//  - arten-Einträge je distinct objektart anlegen (mit orgId)
//  Admin-SDK (umgeht Rules). Nicht-destruktiv (füllt nur leere Felder).
//
//    node scripts/backfill-essen-typart.mjs            # DRY-RUN
//    node scripts/backfill-essen-typart.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';

const PROJECT = 'GBkDIDN67YvxkAVgg31T'; // org_essen / "Grünflächen"
const APPLY = process.argv.includes('--apply');
const BATCH = 400;

admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const log = (...a) => console.log(...a);

const projRef = db.collection('projects').doc(PROJECT);
const proj = await projRef.get();
const orgId = proj.data()?.orgId || null;
log(`\n=== Essen Typ/Art-Backfill (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) === org=${orgId}\n`);

const snap = await projRef.collection('trees').get();
const artCounts = {};
const artUpdates = [], nrUpdates = [];
let baumnrAlready = 0, artAlready = 0;
snap.forEach(d => {
  const t = d.data();
  const oa = (t.objektart || '').toString().trim();
  if (oa) artCounts[oa] = (artCounts[oa] || 0) + 1;
  if (oa) { if ((t.art || '').toString().trim()) artAlready++; else artUpdates.push({ ref: d.ref, art: oa }); }
  const onr = (t.objektnummer != null && t.objektnummer !== '') ? String(t.objektnummer) : '';
  if (onr) { if ((t.baumnr || '').toString().trim()) baumnrAlready++; else nrUpdates.push({ ref: d.ref, baumnr: onr }); }
});

log('Objektarten (→ art + arten-Einträge):');
Object.entries(artCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => log(`   ${String(v).padStart(5)}  ${k}`));
log(`\nart zu setzen: ${artUpdates.length}  (bereits gesetzt: ${artAlready})`);
log(`baumnr zu setzen: ${nrUpdates.length}  (bereits gesetzt: ${baumnrAlready})`);

// Bestehende arten
const artenSnap = await projRef.collection('arten').get();
const haveArten = new Set(artenSnap.docs.map(d => (d.data().name || '').trim()));
const newArten = Object.keys(artCounts).filter(n => !haveArten.has(n));
log(`arten-Einträge neu: ${newArten.length} (${newArten.join(', ') || '—'}); vorhanden: ${artenSnap.size}`);

if (!APPLY) { log('\nHinweis: mit --apply schreiben.\n'); process.exit(0); }

async function commit(ups, field) {
  let n = 0;
  for (let i = 0; i < ups.length; i += BATCH) {
    const b = db.batch();
    ups.slice(i, i + BATCH).forEach(u => b.update(u.ref, { [field]: u[field] }));
    await b.commit(); n += Math.min(BATCH, ups.length - i);
    log(`  ${field}: ${n}/${ups.length}`);
  }
}
await commit(artUpdates, 'art');
await commit(nrUpdates, 'baumnr');
for (const name of newArten) {
  await projRef.collection('arten').add({ name, orgId, createdAt: new Date().toISOString() });
}
log(`\n=== Fertig: ${artUpdates.length} art, ${nrUpdates.length} baumnr, ${newArten.length} arten-Einträge ===`);
process.exit(0);
