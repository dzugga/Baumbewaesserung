// ─────────────────────────────────────────────────────────────────────────────
// Vor-Ort-Kontrolle — reine Zuordnung Status → Farbe/Label (kein DOM/Firebase).
// Feld tree.kontrolle: 'ok' | 'loeschen' | '' (ungeprüft). Zusätzlich am Objekt:
// kontrolliertAm (ISO), kontrolliertVon (Name). Genutzt von Erfassungs- und Desktop-App.
// ─────────────────────────────────────────────────────────────────────────────
export const KONTROLLE = {
  ok:       { label: 'In Ordnung',    color: '#16a34a' },
  loeschen: { label: 'Löschvorschlag', color: '#dc2626' },
  '':       { label: 'ungeprüft',      color: '#b4b2a9' },
};
export function kontrolleNorm(v) { return (v === 'ok' || v === 'loeschen') ? v : ''; }
export function kontrolleColor(v) { return KONTROLLE[kontrolleNorm(v)].color; }
export function kontrolleLabel(v) { return KONTROLLE[kontrolleNorm(v)].label; }

// Zählt eine Objektliste nach Kontroll-Status → {ok, loeschen, ungeprueft, gesamt}
export function kontrolleCounts(trees) {
  const c = { ok: 0, loeschen: 0, ungeprueft: 0, gesamt: 0 };
  (trees || []).forEach(t => {
    const v = kontrolleNorm(t && t.kontrolle);
    c.gesamt++;
    if (v === 'ok') c.ok++; else if (v === 'loeschen') c.loeschen++; else c.ungeprueft++;
  });
  return c;
}
