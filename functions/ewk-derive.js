// EWKFondsG — strukturelle Ableitungs-Logik für den serverseitigen Trigger (CommonJS).
// SPIEGELT src/ewk-tarif.js + src/ewk.js (LEISTUNGSARTEN/EINHEITEN/AUTO/ewkLeistungsartOf/ewkMengeAusObjekt).
// Bei Änderung BEIDE Seiten pflegen. Enthält bewusst KEINE Punktwerte — die liegen ausschließlich clientseitig
// in src/ewk-tarif.js. Der Trigger schreibt nur menge/einheit/leistungsart/ortslage/tarifVersion.

const EINHEITEN = {
  reinigung_strecke: 'km', sammlung_papierkorb: 'liter', reinigung_flaeche: 'qm',
  reinigung_sinkkasten: 'stueck', entsorgung_abfall: 'tonne', sensibilisierung: 'stunde',
};
// Automatisch aus „erledigt" ableitbar (eindeutige Menge). Papierkorb/Abfall/Sensibilisierung → manuell.
const AUTO_LEISTUNGSARTEN = ['reinigung_strecke', 'reinigung_flaeche', 'reinigung_sinkkasten'];
// NUR Versionsgrenzen (KEINE Punktwerte) — tarifVersion am Ereignis für Reproduzierbarkeit.
const TARIF_VERSIONEN = [{ version: '2024', gueltigVon: '2024-01-01', gueltigBis: null }];

function tarifVersionFuer(datumStr) {
  const d = String(datumStr || '');
  const t = TARIF_VERSIONEN.find(x => d >= x.gueltigVon && (x.gueltigBis == null || d <= x.gueltigBis));
  return t ? t.version : null;
}

function ewkLeistungsartOf(tree, artMap) {
  if (!tree) return null;
  const m = artMap || {};
  if (tree.artId != null && m[tree.artId]) return m[tree.artId];
  if ((tree.geomType || 'punkt') === 'linie') return 'reinigung_strecke';
  return null;
}

function _num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = parseFloat(v.replace(',', '.')); return isFinite(n) ? n : NaN; }
  return NaN;
}
function _effMengeRaw(tree, container) {
  let m = _num(tree && tree.menge); if (m > 0) return m;
  m = _num(container && container.menge); if (m > 0) return m;
  return 0; // Geometrie-Fallback bewusst nicht serverseitig (v1)
}
function ewkMengeAusObjekt(tree, leistungsart, container) {
  if (leistungsart === 'reinigung_sinkkasten') return { menge: 1, einheit: 'stueck' };
  const raw = _effMengeRaw(tree, container);
  if (!(raw > 0)) return null;
  if (leistungsart === 'reinigung_strecke') return { menge: raw / 1000, einheit: 'km' };
  if (leistungsart === 'reinigung_flaeche') return { menge: raw, einheit: 'qm' };
  return null;
}

module.exports = { EINHEITEN, AUTO_LEISTUNGSARTEN, tarifVersionFuer, ewkLeistungsartOf, ewkMengeAusObjekt };
