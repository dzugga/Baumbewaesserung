// ============================================================================
//  FES „PK.-Planung": je Tour Startdatum (ISO-KW 28/2026, nach Wochentag der
//  Tour) und Gesamt-Arbeitszeit (7 h 48 min = 468 min) setzen.
//  Startdatum = Montag KW28 (2026-07-06) + Offset des Betriebstags der Tour.
//  Idempotent (nur abweichende Touren werden geschrieben).
//
//    node scripts/set-fes-tour-start-arbeitszeit.mjs            # DRY-RUN
//    node scripts/set-fes-tour-start-arbeitszeit.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';

const PID = 'JMQMe7TMLcSopaxsquKW';
const APPLY = process.argv.includes('--apply');
const ISO_YEAR = 2026, ISO_WEEK = 28;
const ARBEITSZEIT_MIN = 7 * 60 + 48; // 468

// Montag der ISO-Kalenderwoche (KW1 = Woche mit erstem Donnerstag)
function isoWeekMonday(year, week) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dow = (jan4.getUTCDay() + 6) % 7; // Mo=0 … So=6
  const w1mon = new Date(jan4); w1mon.setUTCDate(jan4.getUTCDate() - dow);
  const d = new Date(w1mon); d.setUTCDate(w1mon.getUTCDate() + (week - 1) * 7);
  return d;
}
const monday = isoWeekMonday(ISO_YEAR, ISO_WEEK);
const iso = d => d.toISOString().slice(0, 10);
// betriebstage-Code (Mo=1…Fr=5, Sa=6, So=0) → Offset ab Montag
const offsetOf = code => (code === 0 ? 6 : code - 1);
const WDNAME = { 0: 'So', 1: 'Mo', 2: 'Di', 3: 'Mi', 4: 'Do', 5: 'Fr', 6: 'Sa' };

console.log(`\n=== FES Tour-Startdatum + Arbeitszeit (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) ===`);
console.log(`Basis: ISO-KW ${ISO_WEEK}/${ISO_YEAR} · Montag = ${iso(monday)} · Arbeitszeit = ${ARBEITSZEIT_MIN} min (7 h 48 min)\n`);

admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const ts = await pref.collection('tours').get();

const upd = [];
let ohneBt = 0;
ts.forEach(d => {
  const t = d.data();
  const bt = Array.isArray(t.betriebstage) ? t.betriebstage.slice() : [];
  if (!bt.length) { ohneBt++; return; }
  const code = bt.slice().sort((a, b) => offsetOf(a) - offsetOf(b))[0]; // frühester Betriebstag
  const startDate = iso(new Date(monday.getTime() + offsetOf(code) * 86400000));
  const need = t.startDate !== startDate || t.arbeitszeitMin !== ARBEITSZEIT_MIN;
  upd.push({ ref: d.ref, name: t.name || d.id, wd: WDNAME[code], startDate, need });
});
upd.sort((a, b) => a.name.localeCompare(b.name));
for (const u of upd) console.log(`  ${u.name.padEnd(14)} ${u.wd}  → Start ${u.startDate}  Arbeitszeit ${ARBEITSZEIT_MIN} min${u.need ? '' : '  (unverändert)'}`);
const toWrite = upd.filter(u => u.need);
console.log(`\nTouren gesamt: ${ts.size} · zu aktualisieren: ${toWrite.length} · ohne Betriebstage (übersprungen): ${ohneBt}`);

if (APPLY) {
  const B = 400;
  for (let i = 0; i < toWrite.length; i += B) {
    const b = db.batch();
    toWrite.slice(i, i + B).forEach(u => b.update(u.ref, { startDate: u.startDate, arbeitszeitMin: ARBEITSZEIT_MIN }));
    await b.commit();
  }
  console.log(`✓ ${toWrite.length} Touren aktualisiert.`);
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
