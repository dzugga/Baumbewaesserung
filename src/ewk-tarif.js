// EWKFondsG / § 3 EWKFondsV — Punktesätze der sechs Leistungsarten. NORMATIV und VERSIONIERT.
// Quelle: Einwegkunststofffondsverordnung, BGBl. 2023 I Nr. 274, in Kraft seit 01.01.2024.
// Diese Werte dürfen NICHT geraten oder interpoliert werden. KEINE Euro-Umrechnung — der Punktewert
// steht nicht fest (UBA veröffentlicht ihn erst nach Prüfung der Meldungen über DIVID). Die App zeigt
// ausschließlich Punkte + Datenqualität.
//
// Änderungen per Rechtsverordnung: NEUE Version mit Gültigkeitszeitraum anhängen, alte NIE ändern —
// historische Meldungen müssen mit dem damals gültigen Satz reproduzierbar bleiben (tarifVersion am Ereignis).

// Leistungsart (Enum, 1:1 zur Verordnung) → Basiseinheit des Ereignisses.
export const EINHEITEN = {
  reinigung_strecke:    'km',
  sammlung_papierkorb:  'liter',
  reinigung_flaeche:    'qm',
  reinigung_sinkkasten: 'stueck',
  entsorgung_abfall:    'tonne',
  sensibilisierung:     'stunde',
};
export const LEISTUNGSARTEN = Object.keys(EINHEITEN);

// Versionierte Sätze. Je Leistungsart: { innerorts, ausserorts (null = entfällt), pro (Bezugsmenge) }.
export const EWK_TARIFE = [
  {
    version: '2024',
    gueltigVon: '2024-01-01',
    gueltigBis: null,
    quelle: 'EWKFondsV § 3, BGBl. 2023 I Nr. 274 (in Kraft seit 01.01.2024)',
    saetze: {
      reinigung_strecke:    { innerorts: 10.0, ausserorts: 7.3,  pro: 1 },      // pro 1 km
      sammlung_papierkorb:  { innerorts: 1.0,  ausserorts: 0.7,  pro: 100 },     // pro 100 Liter
      reinigung_flaeche:    { innerorts: 3.0,  ausserorts: 2.4,  pro: 1000 },    // pro 1.000 m²
      reinigung_sinkkasten: { innerorts: 2.4,  ausserorts: null, pro: 1 },       // pro Stück; außerorts entfällt
      entsorgung_abfall:    { innerorts: 31.5, ausserorts: 31.5, pro: 1 },       // pro 1 Tonne (lage-unabhängig)
      sensibilisierung:     { innerorts: 15.8, ausserorts: 15.8, pro: 1 },       // pro Mitarbeiterstunde (lage-unabhängig)
    },
  },
];

// Für die Punkte ist die Lage nur relevant, wenn sich innerorts/außerorts im Satz unterscheiden.
// Bei Sensibilisierung und Abfallmenge sind beide Sätze gleich → Lage ohne Punkt-Effekt.
export function ortslageRelevant(leistungsart) {
  return !(leistungsart === 'sensibilisierung' || leistungsart === 'entsorgung_abfall');
}

// Tarif, der an einem Datum ('YYYY-MM-DD') galt — oder null.
export function tarifFuer(datumStr) {
  const d = String(datumStr || '');
  return EWK_TARIFE.find(t => d >= t.gueltigVon && (t.gueltigBis == null || d <= t.gueltigBis)) || null;
}

// Punkte für ein einzelnes Ereignis. { punkte, tarifVersion, satz } oder null bei ungültiger Kombination.
// Bei nicht-lagerelevanten Arten wird der (gleiche) innerorts-Satz genommen. Sinkkasten außerorts → 0 (entfällt).
export function punkteFuer({ leistungsart, menge, ortslage, datumStr }) {
  const tarif = tarifFuer(datumStr);
  if (!tarif) return null;
  const s = tarif.saetze[leistungsart];
  if (!s) return null;
  if (typeof menge !== 'number' || !(menge >= 0) || !isFinite(menge)) return null;
  const lage = ortslageRelevant(leistungsart) ? ortslage : 'innerorts';
  const satz = s[lage];
  if (satz == null) return { punkte: 0, tarifVersion: tarif.version, satz: 0 }; // z. B. Sinkkasten außerorts
  return { punkte: (menge / s.pro) * satz, tarifVersion: tarif.version, satz };
}
