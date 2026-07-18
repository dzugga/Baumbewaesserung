// Test: EWKFondsG Punktesätze (§ 3 EWKFondsV) + Ereignis-Builder. Normative Werte hart geprüft.
import { punkteFuer, tarifFuer, ortslageRelevant, EINHEITEN, LEISTUNGSARTEN } from '../src/ewk-tarif.js';
import { buildLeistungsereignis, meldejahrVon, buildLeistungszuordnung, ewkLeistungsartOf, LEISTUNGSART_LABELS, ewkMengeAusObjekt, AUTO_LEISTUNGSARTEN, aggregateEreignisse, ewkDatenqualitaet } from '../src/ewk.js';

let pass = 0, fail = 0;
const approx = (a, b) => Math.abs(a - b) < 1e-9;
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('✗ ' + name); } }
function pkt(la, menge, lage) { const r = punkteFuer({ leistungsart: la, menge, ortslage: lage, datumStr: '2024-06-01' }); return r ? r.punkte : null; }

// --- Normative Punktesätze § 3 EWKFondsV (2024) ---
ok('strecke innerorts 2,4 km = 24', approx(pkt('reinigung_strecke', 2.4, 'innerorts'), 24));
ok('strecke außerorts 10 km = 73', approx(pkt('reinigung_strecke', 10, 'ausserorts'), 73));
ok('papierkorb innerorts 250 L = 2,5 (pro 100 L)', approx(pkt('sammlung_papierkorb', 250, 'innerorts'), 2.5));
ok('papierkorb außerorts 100 L = 0,7', approx(pkt('sammlung_papierkorb', 100, 'ausserorts'), 0.7));
ok('fläche innerorts 5000 m² = 15 (pro 1000)', approx(pkt('reinigung_flaeche', 5000, 'innerorts'), 15));
ok('fläche außerorts 1000 m² = 2,4', approx(pkt('reinigung_flaeche', 1000, 'ausserorts'), 2.4));
ok('sinkkasten innerorts 10 Stück = 24', approx(pkt('reinigung_sinkkasten', 10, 'innerorts'), 24));
ok('sinkkasten AUSSERORTS entfällt = 0', pkt('reinigung_sinkkasten', 10, 'ausserorts') === 0);
ok('abfall 3 t = 94,5 (lage-egal innerorts)', approx(pkt('entsorgung_abfall', 3, 'innerorts'), 94.5));
ok('abfall 3 t außerorts = 94,5 (gleich)', approx(pkt('entsorgung_abfall', 3, 'ausserorts'), 94.5));
ok('sensibilisierung 10 h = 158', approx(pkt('sensibilisierung', 10, 'innerorts'), 158));

// --- Struktur / Meta ---
ok('6 Leistungsarten', LEISTUNGSARTEN.length === 6);
ok('Einheit Papierkorb = liter', EINHEITEN.sammlung_papierkorb === 'liter');
ok('ortslage relevant bei Strecke', ortslageRelevant('reinigung_strecke') === true);
ok('ortslage irrelevant bei Sensibilisierung', ortslageRelevant('sensibilisierung') === false);
ok('Tarif vor 2024 = null', tarifFuer('2023-12-31') === null);
ok('Tarif 2024-01-01 vorhanden', tarifFuer('2024-01-01') && tarifFuer('2024-01-01').version === '2024');
ok('ungültige menge → null', punkteFuer({ leistungsart: 'reinigung_strecke', menge: -1, ortslage: 'innerorts', datumStr: '2024-06-01' }) === null);
ok('meldejahrVon 2024-05-14 = 2024', meldejahrVon('2024-05-14') === 2024);

// --- Ereignis-Builder: Pflichtfelder / Validierung ---
function throws(fn) { try { fn(); return false; } catch (_) { return true; } }
const base = { orgId: 'o1', leistungsart: 'reinigung_strecke', menge: 2.4, ortslage: 'innerorts', datumStr: '2024-06-01', quelleId: 'track:abc' };
ok('gültiges Ereignis baut', (() => { const e = buildLeistungsereignis(base); return e.einheit === 'km' && e.meldejahr === 2024 && e.ortslage === 'innerorts' && e.korrigiertVon === null; })());
ok('ohne quelleId wirft', throws(() => buildLeistungsereignis({ ...base, quelleId: '' })));
ok('ungültige leistungsart wirft', throws(() => buildLeistungsereignis({ ...base, leistungsart: 'blitz' })));
ok('ohne ortslage bei Strecke wirft', throws(() => buildLeistungsereignis({ ...base, ortslage: undefined })));
ok('Sensibilisierung ohne ortslage ok → ortslage null', (() => { const e = buildLeistungsereignis({ orgId: 'o1', leistungsart: 'sensibilisierung', menge: 5, datumStr: '2024-03-01', quelleId: 'zeiterf:42' }); return e.ortslage === null && e.einheit === 'stunde'; })());
ok('manuell ohne objektRef ok', (() => { const e = buildLeistungsereignis({ ...base, erfasstDurch: 'manuell' }); return e.objektRef === null && e.projektId === null; })());
ok('Zuordnung getrennt gebaut', (() => { const z = buildLeistungszuordnung({ orgId: 'o1', ereignisId: 'e1', mitarbeiterRef: 'm1' }); return z.ereignisId === 'e1' && z.mitarbeiterRef === 'm1'; })());

// --- Leistungsart-Resolver ---
ok('explizites Mapping nach artId', ewkLeistungsartOf({ artId: 'a1', geomType: 'punkt' }, { a1: 'sammlung_papierkorb' }) === 'sammlung_papierkorb');
ok('Linie ohne Mapping → Strecke', ewkLeistungsartOf({ geomType: 'linie' }, {}) === 'reinigung_strecke');
ok('Punkt ohne Mapping → null', ewkLeistungsartOf({ artId: 'x', geomType: 'punkt' }, {}) === null);
ok('Mapping schlägt Linie-Default', ewkLeistungsartOf({ artId: 'a2', geomType: 'linie' }, { a2: 'reinigung_flaeche' }) === 'reinigung_flaeche');
ok('Label vorhanden', LEISTUNGSART_LABELS.reinigung_strecke === 'Reinigung Strecke');

// --- Mengen-Ableitung aus dem Objekt (Schritt 2) ---
ok('Strecke eigene Länge 2400 m → 2,4 km', (() => { const r = ewkMengeAusObjekt({ menge: 2400 }, 'reinigung_strecke'); return r && approx(r.menge, 2.4) && r.einheit === 'km'; })());
ok('Strecke geerbt vom Container', (() => { const r = ewkMengeAusObjekt({ menge: '' }, 'reinigung_strecke', { menge: 500 }); return r && approx(r.menge, 0.5); })());
ok('Fläche 5000 m² → qm', (() => { const r = ewkMengeAusObjekt({ menge: 5000 }, 'reinigung_flaeche'); return r && approx(r.menge, 5000) && r.einheit === 'qm'; })());
ok('Sinkkasten → 1 Stück', (() => { const r = ewkMengeAusObjekt({}, 'reinigung_sinkkasten'); return r && r.menge === 1 && r.einheit === 'stueck'; })());
ok('Strecke ohne Menge → null', ewkMengeAusObjekt({ menge: '' }, 'reinigung_strecke', {}) === null);
ok('Papierkorb nicht auto-ableitbar → null', ewkMengeAusObjekt({ volumen: 120 }, 'sammlung_papierkorb') === null);
ok('AUTO-Set hat 3 Arten', AUTO_LEISTUNGSARTEN.length === 3 && AUTO_LEISTUNGSARTEN.indexOf('sammlung_papierkorb') < 0);

// --- Aggregation (Schritt 7) ---
{
  const events = [
    { leistungsart: 'reinigung_strecke', menge: 2.4, ortslage: 'innerorts', meldejahr: 2024 },
    { leistungsart: 'reinigung_strecke', menge: 10, ortslage: 'ausserorts', meldejahr: 2024 },
    { leistungsart: 'reinigung_sinkkasten', menge: 1, ortslage: 'innerorts', meldejahr: 2024, erfasstDurch: 'manuell' },
  ];
  const agg = aggregateEreignisse(events);
  ok('Aggregat gesamt = 99,4', approx(agg.gesamtPunkte, 24 + 73 + 2.4));
  ok('Aggregat Strecke = 97 Punkte', approx(agg.perArt.reinigung_strecke.punkte, 97));
  ok('Aggregat count 3 · manuell 1', agg.count === 3 && agg.manuell === 1);
}
{
  const events = [
    { id: 'a', leistungsart: 'reinigung_sinkkasten', menge: 1, ortslage: 'innerorts', meldejahr: 2024 },
    { id: 'b', leistungsart: 'reinigung_sinkkasten', menge: 1, ortslage: 'innerorts', meldejahr: 2024, korrigiertVon: 'a' },
  ];
  const agg = aggregateEreignisse(events);
  ok('Korrektur schließt ersetztes Ereignis aus', agg.count === 1 && approx(agg.gesamtPunkte, 2.4));
}

// --- Datenqualität (Schritt 7b) ---
{
  const artMap = { a_park: 'reinigung_flaeche', a_sk: 'reinigung_sinkkasten', a_pk: 'sammlung_papierkorb' };
  const objs = [
    { id: '1', name: 'Fläche gut', artId: 'a_park', geomType: 'flaeche', ortslage: 'innerorts', effMenge: 500 }, // ok
    { id: '2', name: 'Fläche ohne Lage', artId: 'a_park', geomType: 'flaeche', ortslage: '', effMenge: 500 },   // ohneOrtslage
    { id: '3', name: 'Fläche ohne Menge', artId: 'a_park', geomType: 'flaeche', ortslage: 'innerorts', effMenge: 0 }, // ohneMenge
    { id: '4', name: 'Sinkkasten', artId: 'a_sk', geomType: 'punkt', ortslage: 'innerorts', effMenge: 0 },       // ok (Stück, keine Menge nötig)
    { id: '5', name: 'Papierkorb', artId: 'a_pk', geomType: 'punkt', ortslage: '', effMenge: 0 },                 // manuell → kein Fehler
    { id: '6', name: 'Baum', art: 'Baum', geomType: 'punkt', ortslage: '', effMenge: 0 },                        // unmapped art
  ];
  const dq = ewkDatenqualitaet(objs, artMap);
  ok('DQ ohneOrtslage = 1', dq.ohneOrtslage.length === 1 && dq.ohneOrtslage[0].id === '2');
  ok('DQ ohneMenge = 1', dq.ohneMenge.length === 1 && dq.ohneMenge[0].id === '3');
  ok('DQ Papierkorb NICHT als Fehler', !dq.ohneOrtslage.some(o => o.id === '5') && !dq.ohneMenge.some(o => o.id === '5'));
  ok('DQ unmapped art = Baum', dq.unmappedArts.length === 1 && dq.unmappedArts[0] === 'Baum');
  ok('DQ Sinkkasten ohne Menge = ok', !dq.ohneMenge.some(o => o.id === '4'));
}

console.log(`ewk: ${pass} ok, ${fail} fehlgeschlagen`);
if (fail) process.exit(1);
