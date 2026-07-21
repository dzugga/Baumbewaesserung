// ─────────────────────────────────────────────────────────────────────────────
// Ausgleichs-Assistent (Stufe 1) — reine Analyse-Logik, ohne DOM/Firebase.
// Beantwortet für eine Menge vergleichbarer Touren: Passt die Gesamtlast überhaupt
// in die verfügbaren Arbeitszeiten (Lage-Check)? Wie sähe eine gleichmäßige
// Verteilung aus (Ziel-Auslastung je Tour)? Und welche Auffälligkeiten gibt es
// (Ausreißer-Objekte weit außerhalb des Tourgebiets)?
// Verändert NICHTS — liefert nur Zahlen/Befunde für die Anzeige.
// ─────────────────────────────────────────────────────────────────────────────

// rows: [{ id, name, gesamtMin (null = keine Route), azMin (null = keine Arbeitszeit) }]
// Liefert Lage-Check + Ziel-Verteilung. Touren ohne Zeitgrundlage werden ausgewiesen,
// zählen aber nicht in die Rechnung (sonst wäre das Ergebnis irreführend).
export function ausgleichAnalyse(rows) {
  const all = Array.isArray(rows) ? rows : [];
  const rechenbar = all.filter(r => typeof r.gesamtMin === 'number' && typeof r.azMin === 'number' && r.azMin > 0);
  const ohneRoute = all.filter(r => typeof r.gesamtMin !== 'number');
  const ohneAz = all.filter(r => typeof r.gesamtMin === 'number' && !(typeof r.azMin === 'number' && r.azMin > 0));

  const sumLast = rechenbar.reduce((s, r) => s + r.gesamtMin, 0);
  const sumAz = rechenbar.reduce((s, r) => s + r.azMin, 0);
  const quote = sumAz > 0 ? sumLast / sumAz : null;          // Gesamt-Auslastung bei perfekter Verteilung
  const zielAusl = quote != null ? Math.round(quote * 100) : null;

  // Urteil: strukturell (>100 % gesamt — Verschieben allein löst es nicht) | knapp (95–100 %) | ok
  let verdict = 'unbestimmt';
  if (quote != null) verdict = quote > 1.0001 ? 'strukturell' : (quote > 0.95 ? 'knapp' : 'ok');

  // Je Tour: Ist-Auslastung und Minuten-Abstand zur gleichmäßigen Ziel-Verteilung
  // (deltaMin > 0 = müsste abgeben, < 0 = könnte aufnehmen)
  const proTour = rechenbar.map(r => {
    const istAusl = Math.round(r.gesamtMin / r.azMin * 100);
    const zielMin = quote != null ? Math.round(r.azMin * quote) : null;
    return { id: r.id, name: r.name, istAusl, zielMin, deltaMin: zielMin != null ? r.gesamtMin - zielMin : null };
  }).sort((a, b) => b.istAusl - a.istAusl);

  const ueberbucht = proTour.filter(r => r.istAusl > 100);
  const fehlMin = verdict === 'strukturell' ? sumLast - sumAz : 0;   // was strukturell zu viel ist

  return { rechenbar: rechenbar.length, ohneRoute, ohneAz, sumLast, sumAz, zielAusl, verdict, fehlMin, proTour, ueberbucht };
}

// ── Ausreißer: Objekte weit außerhalb ihres Tourgebiets (lange Anfahrt) ──
// tourObjs: [{ tourId, tourName, points: [{lat,lng}] }]. Maß: Abstand zum Schwerpunkt
// der Tour; Ausreißer = weiter als maxDistM UND weiter als das 3-fache des mittleren
// Abstands (sonst schlagen großflächige Landgebiets-Touren fälschlich an).
export function ausreisserJeTour(tourObjs, maxDistM = 3000) {
  const out = [];
  (tourObjs || []).forEach(t => {
    const pts = (t.points || []).filter(p => typeof p.lat === 'number' && typeof p.lng === 'number');
    if (pts.length < 5) return; // zu wenig Punkte für ein sinnvolles "Gebiet"
    const cLat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const cLng = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    const dists = pts.map(p => _distM(p.lat, p.lng, cLat, cLng));
    const mean = dists.reduce((s, d) => s + d, 0) / dists.length;
    const limit = Math.max(maxDistM, mean * 3);
    const n = dists.filter(d => d > limit).length;
    if (n > 0) out.push({ tourId: t.tourId, tourName: t.tourName, n, limitM: Math.round(limit) });
  });
  return out.sort((a, b) => b.n - a.n);
}

// Haversine (Meter) — bewusst lokal, damit das Modul autark/testbar bleibt
function _distM(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
