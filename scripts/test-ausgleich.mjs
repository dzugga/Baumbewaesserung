// Tests für src/ausgleich.js (pure Analyse-Logik des Ausgleichs-Assistenten)
import { ausgleichAnalyse, ausreisserJeTour } from '../src/ausgleich.js';

let ok = 0, fail = 0;
const t = (name, cond) => { if (cond) { ok++; console.log('✓ ' + name); } else { fail++; console.error('✗ ' + name); } };

// ── Lage-Check: strukturelle Überlast (Screenshot-Fall: 28h21 Last auf 3×7h48 AZ) ──
const A = ausgleichAnalyse([
  { id: 'a', name: 'PK-2', gesamtMin: 750, azMin: 468 },  // 160 %
  { id: 'b', name: 'PK-3', gesamtMin: 501, azMin: 468 },  // 107 %
  { id: 'c', name: 'PK-1', gesamtMin: 450, azMin: 468 },  //  96 %
]);
t('strukturell erkannt (Σ > AZ)', A.verdict === 'strukturell');
t('Fehlminuten = Last − AZ', A.fehlMin === (750 + 501 + 450) - 3 * 468);
t('Ziel-Auslastung ≈ 121 %', A.zielAusl === 121);
t('überbuchte Touren gezählt', A.ueberbucht.length === 2);
t('sortiert: höchste Auslastung zuerst', A.proTour[0].id === 'a');
t('delta: Überbuchte gibt ab', A.proTour[0].deltaMin > 0);

// ── Lage-Check: ausgleichbar ──
const B = ausgleichAnalyse([
  { id: 'a', name: 'X', gesamtMin: 500, azMin: 468 },
  { id: 'b', name: 'Y', gesamtMin: 300, azMin: 468 },
]);
t('ausgleichbar → ok/knapp', B.verdict === 'ok' || B.verdict === 'knapp');
t('Ziel unter 100 %', B.zielAusl <= 100);

// ── Sonderfälle: ohne Route / ohne Arbeitszeit zählen nicht in die Rechnung ──
const C = ausgleichAnalyse([
  { id: 'a', name: 'X', gesamtMin: 400, azMin: 468 },
  { id: 'b', name: 'ohneRoute', gesamtMin: null, azMin: 468 },
  { id: 'c', name: 'ohneAz', gesamtMin: 300, azMin: null },
]);
t('ohne Route ausgewiesen', C.ohneRoute.length === 1 && C.ohneRoute[0].id === 'b');
t('ohne Arbeitszeit ausgewiesen', C.ohneAz.length === 1 && C.ohneAz[0].id === 'c');
t('nur rechenbare in der Quote', C.rechenbar === 1 && C.zielAusl === Math.round(400 / 468 * 100));
t('leere Eingabe crasht nicht', ausgleichAnalyse([]).verdict === 'unbestimmt');

// ── Ausreißer: 1 Punkt ~5 km außerhalb eines kompakten Clusters ──
const cluster = Array.from({ length: 20 }, (_, i) => ({ lat: 52.0 + (i % 5) * 0.001, lng: 7.0 + Math.floor(i / 5) * 0.001 }));
const R1 = ausreisserJeTour([{ tourId: 't1', tourName: 'T', points: [...cluster, { lat: 52.045, lng: 7.0 }] }]);
t('Ausreißer erkannt', R1.length === 1 && R1[0].n === 1);
const R2 = ausreisserJeTour([{ tourId: 't1', tourName: 'T', points: cluster }]);
t('kompakter Cluster → kein Ausreißer', R2.length === 0);
t('zu wenig Punkte → keine Aussage', ausreisserJeTour([{ tourId: 't1', tourName: 'T', points: cluster.slice(0, 3) }]).length === 0);

console.log(`ausgleich: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exit(1);
