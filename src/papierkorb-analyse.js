// Pure Analyse-Logik: findet räumlich NAHE Objekte mit UNTERSCHIEDLICHER Leerungshäufigkeit und fasst
// sie zu Clustern zusammen. Bewusst ohne App-/DOM-Abhängigkeiten (Modul-First) → Node-testbar.
//
// Regel (Nutzer-Spec):
//   A — Häufigkeit unterscheidet sich (Standard: jede Abweichung zählt; über minDiff einstellbar), UND
//   B — die beiden Objekte liegen ≤ maxDistM Meter auseinander (einstellbar, Standard 20 m).
// Nur Paare, die A UND B erfüllen, bilden eine Kante; verbundene Kanten ergeben ein Cluster.

// Entfernung zweier WGS84-Punkte in Metern (Haversine).
export function haversineM(aLat, aLng, bLat, bLng) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

// objs: [{ id, lat:number, lng:number, freq:number|null, name?:string }]
// opts: { maxDistM=20, minDiff=0, sameStreetOnly=false }
//   minDiff        = geforderte |Δ Häufigkeit|; 0 = jede Abweichung
//   sameStreetOnly = true → Kante nur zwischen Objekten mit GLEICHEM name (=Straße); verhindert, dass sich
//                    bei großem Radius das ganze dichte Netz transitiv zu einem Stadt-Klumpen verkettet.
// → cluster[]: { ids[], count, freqs[](sortiert), spread, minDist(m, zwischen zwei versch. Häufigkeiten),
//               street(häufigster name), streets[] }  — sortiert nach Schwere (großer Sprung + nah zuerst)
export function findFreqClusters(objs, opts) {
  const maxDist = (opts && opts.maxDistM) || 20;
  const minDiff = (opts && opts.minDiff) || 0;
  const sameStreetOnly = !!(opts && opts.sameStreetOnly);
  const nrm = o => ((o.name || '').trim().toLowerCase());
  const pts = (objs || []).filter(o => o && o.freq != null && typeof o.lat === 'number' && typeof o.lng === 'number');
  const n = pts.length;
  if (n < 2) return [];

  // Räumliches Raster (Zellengröße ≈ maxDist in Grad, lat-basiert) → nur Nachbarzellen vergleichen,
  // damit auch „Alle" (tausende Objekte) schnell bleibt statt O(n²).
  const cell = Math.max(1e-6, maxDist / 111320);
  const grid = new Map();
  const key = (cx, cy) => cx + ':' + cy;
  pts.forEach((p, i) => {
    p._cx = Math.floor(p.lng / cell); p._cy = Math.floor(p.lat / cell);
    const k = key(p._cx, p._cy); let a = grid.get(k); if (!a) { a = []; grid.set(k, a); } a.push(i);
  });

  // Union-Find über die Kanten (Paare, die A UND B erfüllen).
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  for (let i = 0; i < n; i++) {
    const p = pts[i];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const arr = grid.get(key(p._cx + dx, p._cy + dy)); if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue; const q = pts[j];
        if (p.freq === q.freq) continue;                 // keine Abweichung
        if (Math.abs(p.freq - q.freq) < minDiff) continue; // A: unter Toleranz
        if (sameStreetOnly && nrm(p) !== nrm(q)) continue; // nur gleiche Straße (verhindert Stadt-Klumpen)
        if (haversineM(p.lat, p.lng, q.lat, q.lng) > maxDist) continue; // B: zu weit
        union(i, j);
      }
    }
  }

  // Komponenten sammeln (nur solche mit ≥2 Objekten UND tatsächlich verschiedenen Häufigkeiten).
  const comp = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); let a = comp.get(r); if (!a) { a = []; comp.set(r, a); } a.push(i); }
  const clusters = [];
  comp.forEach(idxs => {
    if (idxs.length < 2) return;
    const members = idxs.map(i => pts[i]);
    const freqs = [...new Set(members.map(m => m.freq))].sort((a, b) => a - b);
    if (freqs.length < 2) return;
    let minD = Infinity;
    for (let a = 0; a < members.length; a++) for (let b = a + 1; b < members.length; b++) {
      if (members[a].freq === members[b].freq) continue;
      const d = haversineM(members[a].lat, members[a].lng, members[b].lat, members[b].lng);
      if (d < minD) minD = d;
    }
    const nameCount = {};
    members.forEach(m => { const nm = ((m.name || '').trim()) || '—'; nameCount[nm] = (nameCount[nm] || 0) + 1; });
    const streets = Object.keys(nameCount).sort((a, b) => nameCount[b] - nameCount[a]);
    clusters.push({
      ids: members.map(m => m.id), count: members.length, freqs,
      spread: freqs[freqs.length - 1] - freqs[0],
      minDist: isFinite(minD) ? Math.round(minD) : null,
      street: streets[0], streets,
    });
  });
  clusters.sort((a, b) => b.spread - a.spread || (a.minDist - b.minDist) || b.count - a.count);
  return clusters;
}
