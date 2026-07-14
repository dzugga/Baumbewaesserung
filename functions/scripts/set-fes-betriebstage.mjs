// ============================================================================
//  FES Frankfurt „PK.-Planung": Betriebstage je Tour aus dem Tournamen setzen,
//  damit der Soll/Plan-Check greift (Plan = Wochen-Einsätze der Touren).
//  Kürzel (letztes Namens-Token): MO→Mo DI→Di MI→Mi DO→Do FR→Fr SO→So,
//  WE→Sa+So. Sondertouren FE_1/FE_2/alles bleiben ohne Betriebstage (unklar).
//  interval='woechentlich'. Admin-SDK, idempotent. DRY-RUN default.
//
//    node scripts/set-fes-betriebstage.mjs            # DRY-RUN (+ Soll/Plan-Statistik)
//    node scripts/set-fes-betriebstage.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';

const PID = 'JMQMe7TMLcSopaxsquKW';
const APPLY = process.argv.includes('--apply');
// Date.getDay(): So=0 Mo=1 Di=2 Mi=3 Do=4 Fr=5 Sa=6
const WD = { MO: [1], DI: [2], MI: [3], DO: [4], FR: [5], SO: [0], WE: [6, 0] };

admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const proj = await pref.get();
// Leerungshäufigkeit-Werteliste: id → zahl (für Soll)
const zList = (proj.data()?.listValues?.zustand) || [];
const zahlById = new Map(zList.map(e => [e.id, Number(e.zahl ?? 0)]));

console.log(`\n=== FES Betriebstage setzen (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) ===`);

const toursSnap = await pref.collection('tours').get();
const btByTourId = new Map(); // tourId → betriebstage[] (für Plan-Statistik)
const upd = []; const skipped = [];
toursSnap.forEach(d => {
  const x = d.data(); if (x.uebersicht) return;
  const name = (x.name || '').trim();
  const last = name.split(/[_-]/).pop();
  const bt = WD[last];
  if (!bt) { skipped.push(name); btByTourId.set(d.id, Array.isArray(x.betriebstage) ? x.betriebstage : []); return; }
  btByTourId.set(d.id, bt);
  const cur = Array.isArray(x.betriebstage) ? x.betriebstage : null;
  const same = cur && cur.length === bt.length && [...cur].sort().join() === [...bt].sort().join() && (x.interval || '') === 'woechentlich';
  if (same) return;
  upd.push({ ref: d.ref, name, betriebstage: bt });
});
console.log(`Touren gesamt: ${toursSnap.size} · Betriebstage zu setzen: ${upd.length} · ohne Kürzel (übersprungen): ${skipped.length}${skipped.length ? ' (' + skipped.join(', ') + ')' : ''}`);

if (APPLY) {
  const B = 400;
  for (let i = 0; i < upd.length; i += B) {
    const b = db.batch();
    upd.slice(i, i + B).forEach(u => b.update(u.ref, { betriebstage: u.betriebstage, interval: 'woechentlich' }));
    await b.commit();
  }
  console.log(`  ✓ ${upd.length} Touren mit Betriebstagen versehen`);
}

// ── Soll/Plan-Plausibilität (nach dem geplanten Setzen) ──
const snap = await pref.collection('trees').select('zustand', 'tourIds', 'tourId').get();
let kein = 0; const stat = { passt: 0, unter: 0, ueber: 0, planNull: 0 };
snap.forEach(d => {
  const t = d.data();
  const soll = zahlById.get(String(t.zustand ?? '')) ?? null;
  if (!soll) { kein++; return; }
  const ids = Array.isArray(t.tourIds) ? t.tourIds.filter(Boolean) : (t.tourId ? [t.tourId] : []);
  let plan = 0; ids.forEach(id => plan += (btByTourId.get(id) || []).length);
  if (plan === 0) stat.planNull++;
  else if (Math.abs(plan - soll) < 1e-6) stat.passt++;
  else if (plan < soll) stat.unter++;
  else stat.ueber++;
});
console.log(`\nSoll/Plan-Plausibilität (Soll = Leerungshäufigkeit, Plan = Wochen-Einsätze der Touren):`);
console.log(`  passt: ${stat.passt} · unterplant: ${stat.unter} · überplant: ${stat.ueber} · Plan 0 (nicht verplant): ${stat.planNull} · ohne Soll: ${kein}`);
if (!APPLY) console.log('\nDRY-RUN — nichts geschrieben (Statistik = Vorschau nach dem Setzen). Mit --apply ausführen.');
process.exit(0);
