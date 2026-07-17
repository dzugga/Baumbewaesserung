// Regressionstest für die pure Papierkorb-Analyse-Logik (src/papierkorb-analyse.js).
// Aufruf: node scripts/test-analyse.mjs   (Teil von `npm test`)
import { findFreqClusters, haversineM } from '../src/papierkorb-analyse.js';

let ok = true;
const check = (name, cond) => { console.log((cond ? '✓ ' : '✗ ') + name); if (!cond) ok = false; };

// ~15 m Nord-Versatz bei ~50° Breite: 15/111320 ≈ 0.000135° lat
const base = { lat: 50.11, lng: 8.68 };
const near = (m) => ({ lat: base.lat + m / 111320, lng: base.lng }); // m Meter nördlich

check('Haversine ~15 m stimmt (±1 m)', Math.abs(haversineM(base.lat, base.lng, near(15).lat, near(15).lng) - 15) < 1);

// A+B: zwei versch. Häufigkeiten, 15 m auseinander → 1 Cluster
{
  const c = findFreqClusters([
    { id: 'a', ...base, freq: 1, name: 'Musterstr.' },
    { id: 'b', ...near(15), freq: 6, name: 'Musterstr.' },
  ], { maxDistM: 20, minDiff: 0 });
  check('nahe Abweichung → 1 Cluster', c.length === 1 && c[0].count === 2 && c[0].street === 'Musterstr.');
  check('Cluster meldet Sprung + Abstand', c.length === 1 && c[0].spread === 5 && c[0].minDist <= 16);
}

// B: gleiche zwei Häufigkeiten, aber ~500 m auseinander → kein Cluster (lange Straße, plausibel)
{
  const c = findFreqClusters([
    { id: 'a', ...base, freq: 1, name: 'Langstr.' },
    { id: 'b', ...near(500), freq: 6, name: 'Langstr.' },
  ], { maxDistM: 20, minDiff: 0 });
  check('weit auseinander → kein Cluster', c.length === 0);
}

// gleiche Häufigkeit, nah → kein Cluster
{
  const c = findFreqClusters([
    { id: 'a', ...base, freq: 2, name: 'X' }, { id: 'b', ...near(10), freq: 2, name: 'X' },
  ], { maxDistM: 20, minDiff: 0 });
  check('gleiche Häufigkeit → kein Cluster', c.length === 0);
}

// A-Toleranz: Δ=1 (1↔2), minDiff=2, nah → herausgefiltert
{
  const c = findFreqClusters([
    { id: 'a', ...base, freq: 1, name: 'Y' }, { id: 'b', ...near(10), freq: 2, name: 'Y' },
  ], { maxDistM: 20, minDiff: 2 });
  check('kleiner Sprung unter Toleranz → kein Cluster', c.length === 0);
  const c2 = findFreqClusters([
    { id: 'a', ...base, freq: 1, name: 'Y' }, { id: 'b', ...near(10), freq: 2, name: 'Y' },
  ], { maxDistM: 20, minDiff: 0 });
  check('derselbe Sprung ohne Toleranz → 1 Cluster', c2.length === 1);
}

// Transitive Kette: 1× — 2× — 3×, je 12 m → EIN Cluster mit 3 Objekten
{
  const c = findFreqClusters([
    { id: 'a', ...base, freq: 1, name: 'Z' },
    { id: 'b', ...near(12), freq: 2, name: 'Z' },
    { id: 'c', ...near(24), freq: 3, name: 'Z' },
  ], { maxDistM: 20, minDiff: 0 });
  check('transitive Nähe → 1 Cluster mit 3', c.length === 1 && c[0].count === 3 && c[0].freqs.length === 3);
}

// leere/zu kleine Eingabe
check('leere Eingabe → []', findFreqClusters([], {}).length === 0);
check('freq=null ignoriert', findFreqClusters([{ id: 'a', ...base, freq: null }, { id: 'b', ...near(5), freq: 3 }], {}).length === 0);

if (ok) { console.log('\n✓ Papierkorb-Analyse: alle Prüfungen bestanden.'); process.exit(0); }
console.error('\n✗ Papierkorb-Analyse: Abweichungen — bitte src/papierkorb-analyse.js prüfen.'); process.exit(1);
