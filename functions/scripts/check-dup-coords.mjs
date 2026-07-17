// READ-ONLY: listet doppelte Koordinatenpaare in einem Projekt (Papierkörbe auf identischer Position).
// Aufruf:  cd functions && node scripts/check-dup-coords.mjs [projectId]
// Credentials: gcloud auth application-default login  ODER  GOOGLE_APPLICATION_CREDENTIALS
import admin from 'firebase-admin';
import { writeFileSync } from 'node:fs';
admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();

const PID = process.argv[2] || 'JMQMe7TMLcSopaxsquKW'; // FES Frankfurt PK.-Planung
const DEC = 6; // Rundung der Koordinate (~0,1 m) → „identische" Position

const proj = (await db.collection('projects').doc(PID).get()).data() || {};
const SF = proj.sollFeld || ''; // Feld, das die Leerungshäufigkeit trägt
const freqOf = t => t.haeufigkeit != null && t.haeufigkeit !== '' ? t.haeufigkeit : (SF ? (t[SF] ?? '') : '');
console.log(`Soll-/Häufigkeits-Feld: ${SF || '(keins gesetzt)'}\n`);

const snap = await db.collection('projects').doc(PID).collection('trees').get();
const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
const active = all.filter(t => t.aktiv !== false);
const withCoords = active.filter(t => typeof t.lat === 'number' && typeof t.lng === 'number');

const groups = new Map();
for (const t of withCoords) {
  const key = t.lat.toFixed(DEC) + ',' + t.lng.toFixed(DEC);
  let g = groups.get(key); if (!g) { g = []; groups.set(key, g); }
  g.push(t);
}
const dups = [...groups.entries()].filter(([, g]) => g.length > 1).sort((a, b) => b[1].length - a[1].length);
const dupRecords = dups.reduce((s, [, g]) => s + g.length, 0);

console.log(`Projekt ${PID}`);
console.log(`Objekte gesamt: ${all.length} · aktiv: ${active.length} · mit Koordinaten: ${withCoords.length}`);
console.log(`Eindeutige Positionen: ${groups.size}`);
console.log(`Doppelte Koordinatenpaare: ${dups.length} Position(en), betreffen ${dupRecords} Datensätze\n`);

let diffFreq = 0;
const csv = ['lat,lng,anzahl,verschiedene_haeufigkeit,name,objId,haeufigkeit,tourIds,docId'];
for (const [key, g] of dups) {
  const freqs = [...new Set(g.map(t => String(freqOf(t))))];
  const diff = freqs.length > 1; if (diff) diffFreq++;
  console.log(`● ${key}  ×${g.length}${diff ? '  ⚠ VERSCHIEDENE Häufigkeit' : ''}`);
  g.forEach(t => {
    const tids = (Array.isArray(t.tourIds) ? t.tourIds : [t.tourId]).filter(Boolean);
    console.log(`    - ${t.name || '—'} · Obj-ID ${t.baumId || '—'} · Häufigkeit=${freqOf(t) || '–'} · ${tids.length} Tour(en) · doc ${t.id}`);
    csv.push([key.split(',')[0], key.split(',')[1], g.length, diff ? 'ja' : 'nein', (t.name || '').replace(/,/g, ' '), t.baumId || '', String(freqOf(t)).replace(/,/g, ' '), tids.join(' '), t.id].join(','));
  });
}
if (!dups.length) console.log('Keine doppelten Koordinatenpaare gefunden.');
else {
  console.log(`\n➤ Davon mit UNTERSCHIEDLICHER Häufigkeit an gleicher Stelle: ${diffFreq} Position(en) — das sind die planerisch heiklen.`);
  const out = new URL('./dup-coords.csv', import.meta.url); writeFileSync(out, '﻿' + csv.join('\n'), 'utf8');
  console.log(`➤ Vollständige Liste als CSV: functions/scripts/dup-coords.csv`);
}
process.exit(0);
