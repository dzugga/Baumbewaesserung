// EWKFondsG-Leistungsmeldung — Domänenlogik (Modul-First, Node-testbar; keine App-/DOM-Globals).
// Baut die unveränderlichen Nachweis-Ereignisse. Der Schreib-Layer (Desktop) setzt serverAt/zeitpunkt als
// Firestore-Timestamps und schreibt in die Collections `leistungsereignisse` (Nachweis, OHNE Personenbezug)
// bzw. `leistungszuordnung` (Personenbezug GETRENNT — DSGVO, nur Verwaltung liest).
import { LEISTUNGSARTEN, EINHEITEN, ortslageRelevant } from './ewk-tarif.js';

// Aufbewahrung: PLATZHALTER — vom Kunden zu bestätigen. Grundlage: Meldung 15.05. fürs Vorjahr + UBA-Prüfung
// (§ 17/§ 18 EWKFondsG) + Puffer. NICHT rechtsverbindlich, bewusst endlich statt implizit unbegrenzt.
export const AUFBEWAHRUNG_PLATZHALTER_MONATE = 60; // TODO Kunde/Recht bestätigen

// Erfassungsart → wie belastbar der Nachweis ist (für die Datenqualitätsanzeige, Schritt 7).
export const ERFASST_DURCH = ['gps', 'nfc', 'qr', 'waage', 'erledigt-meldung', 'manuell'];

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

// Personenbezug GETRENNT vom Nachweis (DSGVO, Zweck: Leistungskontrolle ≠ Nachweis). Nur Verwaltung liest.
export function buildLeistungszuordnung({ orgId, ereignisId, mitarbeiterRef = null, fahrzeugRef = null }) {
  if (!orgId) throw new Error('orgId erforderlich');
  if (!ereignisId) throw new Error('ereignisId erforderlich');
  return { orgId, ereignisId, mitarbeiterRef, fahrzeugRef };
}
