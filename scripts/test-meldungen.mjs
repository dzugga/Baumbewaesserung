import { dedupeReports } from '../src/meldungen.js';

let ok = 0, fail = 0;
const eq = (name, got, exp) => {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { ok++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + '\n    erwartet ' + e + '\n    erhalten ' + g); }
};

const NORMAL = () => false;           // keine Tour ist Langzeit
const LZ = tid => tid === 'L';        // Tour "L" ist Langzeit

// Korrektur in normaler Tour: erledigt -> nicht am selben Tag, gleiche Tour → NUR letzte zählt
eq('Korrektur ersetzt (normal)',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A' },
    { status: 'nicht',      date: '2026-07-21', at: '2026-07-21T08:05:00Z', tourId: 'A' },
  ], NORMAL).map(h => h.status),
  ['nicht']);

// Reihenfolge egal — jüngster at gewinnt, auch wenn er zuerst kommt
eq('Jüngster at gewinnt unabhängig von Reihenfolge',
  dedupeReports([
    { status: 'nicht',      date: '2026-07-21', at: '2026-07-21T09:00:00Z', tourId: 'A' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A' },
  ], NORMAL).map(h => h.status),
  ['nicht']);

// Mehrfacher Füllstand-Tipp am selben Tag → letzter Wert bleibt
eq('Füllstand-Korrektur ersetzt',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A', fuellgrad: 60 },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:01:00Z', tourId: 'A', fuellgrad: 80 },
  ], NORMAL).map(h => h.fuellgrad),
  [80]);

// Verschiedene Tage derselben Tour → beide bleiben (je Lauf eine Meldung)
eq('Verschiedene Tage bleiben',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A' },
    { status: 'bewaessert', date: '2026-07-28', at: '2026-07-28T08:00:00Z', tourId: 'A' },
  ], NORMAL).length,
  2);

// Zwei verschiedene Touren am selben Tag → beide bleiben (Objekt in zwei Touren)
eq('Verschiedene Touren gleicher Tag bleiben',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T09:00:00Z', tourId: 'B' },
  ], NORMAL).length,
  2);

// Langzeittour: alle Meldungen bleiben, auch mehrfach am selben Tag
eq('Langzeittour behält alle',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'L' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T12:00:00Z', tourId: 'L' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T16:00:00Z', tourId: 'L' },
  ], LZ).length,
  3);

// Gemischt: normale Tour A entdoppelt, Langzeit L bleibt
eq('Gemischt normal+Langzeit',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T08:00:00Z', tourId: 'A' },
    { status: 'nicht',      date: '2026-07-21', at: '2026-07-21T08:30:00Z', tourId: 'A' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T09:00:00Z', tourId: 'L' },
    { status: 'bewaessert', date: '2026-07-21', at: '2026-07-21T15:00:00Z', tourId: 'L' },
  ], LZ).length,
  3); // A → 1 (letzte), L → 2

// Leere/robуste Eingaben
eq('leere Historie', dedupeReports([], NORMAL), []);
eq('null Historie', dedupeReports(null, NORMAL), []);
eq('null-Einträge werden übersprungen',
  dedupeReports([null, { status: 'bewaessert', date: '2026-07-21', at: 'x', tourId: 'A' }], NORMAL).length, 1);

// Legacy ohne at: nur date vorhanden, gleiche Tour+Tag → auf eins reduziert
eq('Legacy ohne at, gleicher Tag → eins',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', tourId: 'A' },
    { status: 'nicht',      date: '2026-07-21', tourId: 'A' },
  ], NORMAL).length,
  1);

// ohne isLangzeit-Funktion: alles wird als normal behandelt
eq('ohne isLangzeit → normal',
  dedupeReports([
    { status: 'bewaessert', date: '2026-07-21', at: '1', tourId: 'A' },
    { status: 'nicht',      date: '2026-07-21', at: '2', tourId: 'A' },
  ]).length,
  1);

console.log(`\nmeldungen: ${ok} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
