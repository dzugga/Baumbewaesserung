// EWKFondsG-Leistungsmeldung — Domänenlogik (Modul-First, Node-testbar; keine App-/DOM-Globals).
// Baut die unveränderlichen Nachweis-Ereignisse. Der Schreib-Layer (Desktop) setzt serverAt/zeitpunkt als
// Firestore-Timestamps und schreibt in die Collections `leistungsereignisse` (Nachweis, OHNE Personenbezug)
// bzw. `leistungszuordnung` (Personenbezug GETRENNT — DSGVO, nur Verwaltung liest).
import { LEISTUNGSARTEN, EINHEITEN, ortslageRelevant, punkteFuer } from './ewk-tarif.js';

// Aufbewahrung: PLATZHALTER — vom Kunden zu bestätigen. Grundlage: Meldung 15.05. fürs Vorjahr + UBA-Prüfung
// (§ 17/§ 18 EWKFondsG) + Puffer. NICHT rechtsverbindlich, bewusst endlich statt implizit unbegrenzt.
export const AUFBEWAHRUNG_PLATZHALTER_MONATE = 60; // TODO Kunde/Recht bestätigen

// Erfassungsart → wie belastbar der Nachweis ist (für die Datenqualitätsanzeige, Schritt 7).
export const ERFASST_DURCH = ['gps', 'nfc', 'qr', 'waage', 'erledigt-meldung', 'manuell'];

// Anzeige-Labels der Leistungsarten (UI).
export const LEISTUNGSART_LABELS = {
  reinigung_strecke:    'Reinigung Strecke',
  sammlung_papierkorb:  'Sammlung Papierkorb',
  reinigung_flaeche:    'Reinigung Fläche',
  reinigung_sinkkasten: 'Reinigung Sinkkasten',
  entsorgung_abfall:    'Entsorgung Abfallmenge',
  sensibilisierung:     'Sensibilisierung',
};

// Kurzbeschreibung je Leistungsart (§ 3 EWKFondsV) + was in der Menge einzutragen ist. Sachlich, keine Euro.
export const LEISTUNGSART_INFO = {
  reinigung_strecke:    'Reinigung befestigter Flächen (Fahrbahn, Geh- und Radwege, Plätze). Menge: gereinigte Länge in Kilometern (km).',
  sammlung_papierkorb:  'Sammlung/Leerung öffentlicher Papierkörbe. Menge: Papierkorb-Volumen in Litern (L). Ob installiertes oder geleertes Volumen gilt, ist beim UBA noch offen.',
  reinigung_flaeche:    'Reinigung unbefestigter Flächen (Grünflächen u. Ä.). Menge: gereinigte Fläche in Quadratmetern (m²).',
  reinigung_sinkkasten: 'Reinigung von Straßenabläufen/Sinkkästen. Menge: Anzahl gereinigter Sinkkästen (Stück). Nur innerorts — außerorts entfällt.',
  entsorgung_abfall:    'Entsorgung der gesammelten Abfallmenge. Menge: Tonnen (t). Beleg z. B. Wiegeschein.',
  sensibilisierung:     'Aufklärungs-/Sensibilisierungsarbeit gegen Vermüllung (Kampagnen, Aktionen, Öffentlichkeitsarbeit). Menge: aufgewendete Mitarbeiterstunden (h).',
};

// Beleg-Referenz-Beispiel je Leistungsart (Platzhalter im manuellen Formular) — welcher Nachweis passt.
export const LEISTUNGSART_BELEG = {
  reinigung_strecke:    'z. B. Tour-/GPS-Nachweis, Kehrbuch',
  sammlung_papierkorb:  'z. B. Leerungsnachweis / Kataster-Export',
  reinigung_flaeche:    'z. B. Tour-/Leistungsnachweis',
  reinigung_sinkkasten: 'z. B. Reinigungsprotokoll',
  entsorgung_abfall:    'z. B. Wiegeschein-Nr.',
  sensibilisierung:     'z. B. Zeiterfassungs-Export / Stundennachweis',
};

// Leistungsart eines Objekts auflösen: explizites Projekt-Mapping (Objektart → Leistungsart) vor geomType-Default.
// artMap: { [artId]: leistungsart }. Straßenabschnitts-Objekte (geomType 'linie') gelten ohne Zuordnung als
// Reinigung Strecke; Punkte/Flächen brauchen ein explizites Mapping (keine stille Klassifizierung).
export function ewkLeistungsartOf(tree, artMap) {
  if (!tree) return null;
  const m = artMap || {};
  if (tree.artId != null && m[tree.artId]) return m[tree.artId];
  if ((tree.geomType || 'punkt') === 'linie') return 'reinigung_strecke';
  return null;
}

// Automatisch (aus „erledigt") ableitbare Leistungsarten mit EINDEUTIGER Menge.
// Papierkorb (installiert/geleert offen), Abfall + Sensibilisierung bleiben MANUELL.
export const AUTO_LEISTUNGSARTEN = ['reinigung_strecke', 'reinigung_flaeche', 'reinigung_sinkkasten'];

function _num(v) {
  if (typeof v === 'number') return isFinite(v) ? v : NaN;
  if (typeof v === 'string' && v.trim() !== '') { const n = parseFloat(v.replace(',', '.')); return isFinite(n) ? n : NaN; }
  return NaN;
}
// Effektive Roh-Menge (Meter bei Strecke, m² bei Fläche): eigener Wert, sonst geerbt vom Container.
// Geometrie-Fallback bewusst NICHT (v1) — ohne gespeicherte Menge entsteht kein Auto-Nachweis (Datenqualität flaggt).
function _effMengeRaw(tree, container) {
  let m = _num(tree && tree.menge); if (m > 0) return m;
  m = _num(container && container.menge); if (m > 0) return m;
  return 0;
}
// Menge eines erledigten Objekts in der EWK-Basiseinheit. null, wenn nicht eindeutig ableitbar.
export function ewkMengeAusObjekt(tree, leistungsart, container) {
  if (leistungsart === 'reinigung_sinkkasten') return { menge: 1, einheit: 'stueck' };
  const raw = _effMengeRaw(tree, container);
  if (!(raw > 0)) return null;
  if (leistungsart === 'reinigung_strecke') return { menge: raw / 1000, einheit: 'km' }; // menge in Metern → km
  if (leistungsart === 'reinigung_flaeche') return { menge: raw, einheit: 'qm' };        // menge in m²
  return null; // Papierkorb/Abfall/Sensibilisierung nicht auto-ableitbar
}

export function meldejahrVon(datumStr) {
  const y = parseInt(String(datumStr || '').slice(0, 4), 10);
  return Number.isInteger(y) ? y : null;
}

// Baut den Nachweis-Datensatz (ohne Personenbezug). Wirft bei ungültigen/fehlenden Pflichtangaben.
// Rückgabe ist reines JSON; der Aufrufer ergänzt serverAt (serverTimestamp) und wandelt zeitpunkt in Timestamp.
export function buildLeistungsereignis({
  orgId, leistungsart, menge, ortslage, datumStr, quelleId,
  erfasstDurch = 'manuell', projektId = null, objektRef = null, tarifVersion = null, korrigiertVon = null,
}) {
  if (!orgId) throw new Error('orgId erforderlich');
  if (!LEISTUNGSARTEN.includes(leistungsart)) throw new Error('leistungsart ungültig: ' + leistungsart);
  if (typeof menge !== 'number' || !(menge >= 0) || !isFinite(menge)) throw new Error('menge ungültig');
  const mj = meldejahrVon(datumStr);
  if (mj == null) throw new Error('datumStr (YYYY-MM-DD) erforderlich');
  if (!quelleId) throw new Error('quelleId erforderlich (jedes Ereignis muss auf einen Rohbeleg zeigen)');
  if (!ERFASST_DURCH.includes(erfasstDurch)) throw new Error('erfasstDurch ungültig: ' + erfasstDurch);
  const lageNoetig = ortslageRelevant(leistungsart);
  if (lageNoetig && ortslage !== 'innerorts' && ortslage !== 'ausserorts') {
    throw new Error('ortslage (innerorts|ausserorts) erforderlich für ' + leistungsart);
  }
  return {
    orgId,
    projektId,                 // null bei manueller Eingabe / Fremdsystem
    objektRef,                 // z. B. 'trees/<id>' im Herkunftsprojekt; null bei manuell
    leistungsart,
    menge,
    einheit: EINHEITEN[leistungsart],
    ortslage: lageNoetig ? ortslage : null,
    meldejahr: mj,
    zeitpunkt: datumStr,       // reale Leistungszeit (der Aufrufer wandelt in Timestamp)
    erfasstDurch,
    quelleId,                  // Rohbeleg-Verweis: Track-ID / Tag-UID / Wiegeschein-Foto / Fremdsystem / Meldungs-ID
    tarifVersion,              // Version der Punktetabelle (Reproduzierbarkeit); serverseitig aus zeitpunkt setzbar
    korrigiertVon,             // ID des ersetzten Ereignisses (Korrektur = NEUER Satz, nie Update)
  };
}

// Aggregiert Leistungsereignisse zu Punkten je Leistungsart + Gesamtpunkte (§ 3 EWKFondsV). KEINE Euro.
// events: [{ id?, leistungsart, menge, ortslage, einheit, meldejahr, quelleId, korrigiertVon }].
// Korrektur-Kette: ein Ereignis, auf das ein anderes per korrigiertVon verweist, wird ausgeschlossen.
export function aggregateEreignisse(events) {
  const list = Array.isArray(events) ? events : [];
  const superseded = new Set(list.filter(e => e && e.korrigiertVon).map(e => e.korrigiertVon));
  const perArt = {};
  let gesamtPunkte = 0, count = 0, ohneNachweis = 0, manuell = 0;
  for (const e of list) {
    if (!e || (e.id && superseded.has(e.id))) continue;
    count++;
    if (!e.quelleId) ohneNachweis++;
    if (e.erfasstDurch === 'manuell') manuell++;
    const menge = Number(e.menge) || 0;
    const datumStr = (e.meldejahr ? e.meldejahr + '-06-01' : '2024-06-01');
    const r = punkteFuer({ leistungsart: e.leistungsart, menge, ortslage: e.ortslage, datumStr });
    const a = perArt[e.leistungsart] || (perArt[e.leistungsart] = { menge: 0, punkte: 0, einheit: e.einheit || EINHEITEN[e.leistungsart] || '', innerorts: 0, ausserorts: 0, n: 0 });
    a.menge += menge; a.n++;
    if (e.ortslage === 'ausserorts') a.ausserorts += menge; else a.innerorts += menge;
    if (r) { a.punkte += r.punkte; gesamtPunkte += r.punkte; }
  }
  return { perArt, gesamtPunkte, count, ohneNachweis, manuell };
}

// Personenbezug GETRENNT vom Nachweis (DSGVO, Zweck: Leistungskontrolle ≠ Nachweis). Nur Verwaltung liest.
export function buildLeistungszuordnung({ orgId, ereignisId, mitarbeiterRef = null, fahrzeugRef = null }) {
  if (!orgId) throw new Error('orgId erforderlich');
  if (!ereignisId) throw new Error('ereignisId erforderlich');
  return { orgId, ereignisId, mitarbeiterRef, fahrzeugRef };
}
