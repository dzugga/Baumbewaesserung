// ============================================================================
//  FES Frankfurt „PK.-Planung": Touren aus CSV anlegen + Objekte zuordnen.
//  Quelle: C:/INFA/FES-PK/FES-PK.csv (FES-ID;Tour) — FES-ID matcht das
//  Objekt-Feld `pflanzzeitpunkt` (trägt seit dem Erst-Import die FES-ID).
//  „k.A." = keine Tour. Admin-SDK (umgeht Rules). Idempotent:
//  vorhandene gleichnamige Touren werden wiederverwendet, Zuordnung wird gesetzt
//  (überschreibt tourIds/tourId der gematchten Objekte).
//
//    node scripts/import-fes-touren.mjs            # DRY-RUN
//    node scripts/import-fes-touren.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';

const PID = 'JMQMe7TMLcSopaxsquKW'; // PK.-Planung (org_fes_frankfurt)
const CSV = 'C:/INFA/FES-PK/FES-PK.csv';
const APPLY = process.argv.includes('--apply');
const BATCH = 400;
// Farbpalette wie im Desktop (TOUR_COLORS) — zyklisch über die Touren
const COLORS = ['#d11149','#27ae60','#2980b9','#e67e22','#7c3aed','#16a085','#c71585',
  '#808000','#d4ac0d','#3f51b5','#d81b60','#9a6324','#1099a8','#5d6d7e',
  '#e74c3c','#1e8449','#1e40af','#f58231','#6c3483','#0e7d6e','#ad1457',
  '#6b8e23','#b8860b','#283593','#ec407a','#784212','#0e7490','#34495e'];

admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const proj = await pref.get();
const orgId = proj.data()?.orgId;
console.log(`\n=== FES Touren-Import (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) — ${proj.data()?.name} / ${orgId} ===\n`);

// CSV lesen
const lines = fs.readFileSync(CSV, 'latin1').split(/\r?\n/).filter(Boolean);
const rows = lines.slice(1).map(l => l.split(';')).filter(a => a.length >= 2)
  .map(([id, tour]) => ({ id: id.trim(), tour: tour.trim() }));
const withTour = rows.filter(r => r.id && r.tour && r.tour.toLowerCase() !== 'k.a.');
// Tournamen auch aus Zeilen OHNE FES-ID übernehmen (Tour wird angelegt, bleibt leer — z. B. R2_PK_MD)
const tourNames = [...new Set(rows.filter(r => r.tour && r.tour.toLowerCase() !== 'k.a.').map(r => r.tour))].sort((a, b) => a.localeCompare(b));
console.log(`CSV: ${rows.length} Zeilen · ${withTour.length} mit Tour · ${tourNames.length} Tournamen`);

// Objekte laden und über FES-ID (pflanzzeitpunkt) indizieren
const snap = await pref.collection('trees').select('pflanzzeitpunkt', 'tourIds', 'tourId').get();
const byFes = new Map();
snap.forEach(d => { const v = String(d.data().pflanzzeitpunkt ?? '').trim(); if (v) byFes.set(v, d); });
console.log(`Objekte: ${snap.size} · davon mit FES-ID: ${byFes.size}`);

// Vorhandene Touren wiederverwenden (idempotent)
const toursSnap = await pref.collection('tours').get();
const tourIdByName = new Map();
toursSnap.forEach(d => tourIdByName.set((d.data().name || '').trim(), d.id));

// Touren anlegen
let toursNew = 0;
for (let i = 0; i < tourNames.length; i++) {
  const name = tourNames[i];
  if (tourIdByName.has(name)) continue;
  const ref = pref.collection('tours').doc();
  tourIdByName.set(name, ref.id);
  toursNew++;
  if (APPLY) await ref.set({
    name, desc: '', color: COLORS[i % COLORS.length], orgId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}
console.log(`Touren: ${toursNew} neu anzulegen · ${tourNames.length - toursNew} vorhanden (wiederverwendet)`);

// Zuordnung
const updates = [];
const missing = [];
for (const r of withTour) {
  const doc = byFes.get(r.id);
  if (!doc) { missing.push(r.id); continue; }
  const tid = tourIdByName.get(r.tour);
  const cur = doc.data();
  const curIds = Array.isArray(cur.tourIds) ? cur.tourIds : (cur.tourId ? [cur.tourId] : []);
  if (curIds.length === 1 && curIds[0] === tid) continue; // schon korrekt
  updates.push({ ref: doc.ref, tid });
}
console.log(`Zuordnung: ${updates.length} Objekte zu setzen · ${missing.length} CSV-IDs ohne Objekt${missing.length ? ' (' + missing.slice(0, 10).join(', ') + ')' : ''}`);
const noId = snap.size - byFes.size;
if (noId) console.log(`Hinweis: ${noId} Objekt(e) ohne FES-ID im Feld pflanzzeitpunkt — bleiben unverplant.`);

if (APPLY) {
  for (let i = 0; i < updates.length; i += BATCH) {
    const b = db.batch();
    updates.slice(i, i + BATCH).forEach(u => b.update(u.ref, { tourIds: [u.tid], tourId: u.tid }));
    await b.commit();
    console.log(`  … ${Math.min(i + BATCH, updates.length)}/${updates.length} geschrieben`);
  }
  console.log('\n✓ Fertig: Touren angelegt und Objekte zugeordnet.');
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
