// Einmal-Aufbereitung der Essener Reinigungsflächen (Phase 1): Shapefile + Excel → zwei Dateien,
// OHNE Firebase-Schreibzugriff. Erzeugt das Geometrie-Bundle (WGS84-Polygone) und die leichten
// Firestore-Datensätze (Plan denormalisiert je Fläche). Danach prüfen, dann im Browser einspielen.
//
// Aufruf:  node scripts/import-essen.mjs
//   SHP-Dir:  Downloads/_essen_inspect/reinigung   (entpacktes Shapefile)
//   XLSX-Dir: Downloads/_essen_ga/xl               (entpackte Essen-GA.xlsx)
//   Ausgabe:  Downloads/_essen_out/
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const HOME = process.env.USERPROFILE || 'C:/Users/mdzugga';
const SHP_DIR = `${HOME}/Downloads/_essen_inspect/reinigung`;
const XLSX_DIR = `${HOME}/Downloads/_essen_ga/xl`;
const OUT_DIR = `${HOME}/Downloads/_essen_out`;

// ── ETRS89/UTM → WGS84 (Snyder-Inverse), inkl. Zonenpräfix in der Ostkoordinate (EPSG:4647) ──
function utmToLatLng(easting, northing, zone) {
  const a = 6378137.0, f = 1 / 298.257223563, e2 = f * (2 - f);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2)), k0 = 0.9996;
  const x = easting - 500000.0, y = northing;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 * e2 * e2 / 256));
  const phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const ep2 = e2 / (1 - e2), C1 = ep2 * Math.cos(phi1) ** 2, T1 = Math.tan(phi1) ** 2;
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(phi1) ** 2), R1 = a * (1 - e2) / Math.pow(1 - e2 * Math.sin(phi1) ** 2, 1.5), D = x / (N1 * k0);
  const lat = phi1 - (N1 * Math.tan(phi1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon0 = (zone * 6 - 183) * Math.PI / 180;
  const lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(phi1);
  return [+(lon * 180 / Math.PI).toFixed(7), +(lat * 180 / Math.PI).toFixed(7)]; // [lng,lat] für GeoJSON
}
function projToWgs(e, n) {
  let zone = 32;
  if (e >= 1000000) { const z = Math.floor(e / 1000000); if (z === 32 || z === 33) { zone = z; e = e % 1000000; } }
  return utmToLatLng(e, n, zone);
}

// ── DBF (UTF-8) ──
function readDbf(path) {
  const buf = readFileSync(path);
  const N = buf.readUInt32LE(4), HL = buf.readUInt16LE(8), RL = buf.readUInt16LE(10);
  const fields = []; let o = 32;
  while (buf[o] !== 0x0D && o < HL) { fields.push({ nm: buf.slice(o, o + 11).toString('latin1').replace(/\0+$/, '').trim(), len: buf[o + 16] }); o += 32; }
  let off = 1; const FO = {}; for (const fd of fields) { FO[fd.nm] = [off, fd.len]; off += fd.len; }
  // Feldnamen mit Umlaut kommen latin1-verstümmelt → tolerante Suche
  const find = re => Object.keys(FO).find(k => re.test(k));
  const colFlaeche = find(/^Fl.+che$/i);
  const rows = [];
  for (let r = 0; r < N; r++) {
    const base = HL + r * RL;
    const g = nm => { const fo = FO[nm]; return fo ? buf.slice(base + fo[0], base + fo[0] + fo[1]).toString('utf8').trim() : ''; };
    rows.push({
      extId: g('ID'), objektnummer: g('Objektnumm'), name: g('Objekt'), belag: g('Pflegeei_1'),
      pflegeeinheit: g('Pflegeeinh'), objektart: g('Objektart'), stadtteil: g('Stadtteil'),
      shapeArea: parseFloat(g('SHAPE_Area')) || parseFloat(g(colFlaeche)) || 0,
    });
  }
  return rows;
}

// ── SHP (Polygon) → Ringe in WGS84 + m² (Shoelace, UTM) ──
function readShp(path) {
  const buf = readFileSync(path);
  const out = []; let p = 100;
  while (p < buf.length) {
    const contentLen = buf.readInt32BE(p + 4); const cs = p + 8;
    const numParts = buf.readInt32LE(cs + 36), numPoints = buf.readInt32LE(cs + 40);
    const partsAt = cs + 44, pointsAt = partsAt + numParts * 4;
    const rings = []; let m2 = 0;
    for (let k = 0; k < numParts; k++) {
      const start = buf.readInt32LE(partsAt + k * 4);
      const end = (k + 1 < numParts) ? buf.readInt32LE(partsAt + (k + 1) * 4) : numPoints;
      const ring = []; let s = 0;
      for (let i = start; i < end; i++) {
        const x = buf.readDoubleLE(pointsAt + i * 16), y = buf.readDoubleLE(pointsAt + i * 16 + 8);
        ring.push(projToWgs(x, y));
        const j = (i + 1 < end) ? i + 1 : start;
        const x2 = buf.readDoubleLE(pointsAt + j * 16), y2 = buf.readDoubleLE(pointsAt + j * 16 + 8);
        s += x * y2 - x2 * y;
      }
      m2 += s / 2; rings.push(ring);
    }
    out.push({ rings, m2: Math.round(Math.abs(m2)) });
    p = cs + contentLen * 2;
  }
  return out;
}

// ── XLSX (eine Tabelle) → Plan je Objektnummer ──
function readXlsx(xdir) {
  const dec = s => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  const sst = []; for (const si of readFileSync(`${xdir}/sharedStrings.xml`, 'utf8').match(/<si>[\s\S]*?<\/si>/g) || []) sst.push([...si.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(m => dec(m[1])).join(''));
  const sh = readFileSync(`${xdir}/worksheets/sheet1.xml`, 'utf8');
  const cn = ref => { const m = ref.match(/^[A-Z]+/)[0]; let n = 0; for (const ch of m) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const map = {};
  for (const rm of sh.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []) {
    const c = [];
    for (const cm of [...rm.matchAll(/<c r="([A-Z]+\d+)"(?:[^>]*?\st="([^"]+)")?[^>]*>(?:<v>([\s\S]*?)<\/v>)?<\/c>/g)]) { const v = cm[3]; c[cn(cm[1])] = v == null ? '' : (cm[2] === 's' ? (sst[+v] ?? '') : dec(v)); }
    const on = String(c[3] || '').trim();
    if (!on || on === 'Objektnummer') continue;
    const days = (base) => WD.filter((_, d) => (c[base + d] || '').trim().toLowerCase() === 'x').join(', ');
    map[on] = {
      betriebshof: c[1] || '', objektbemerkung: c[5] || '', reinigungsflaecheListe: parseFloat(String(c[6]).replace(',', '.')) || null,
      haeufigkeitS: c[7] || '', haeufigkeitW: c[8] || '', fahrzeug: String(c[9] || '').trim(),
      sommerTage: days(11), winterTage: days(19),
    };
  }
  return map;
}

// ── Hauptlauf ──
console.log('Lese Shapefile + Excel …');
const dbf = readDbf(`${SHP_DIR}/reinigungsflaechen.dbf`);
const shp = readShp(`${SHP_DIR}/reinigungsflaechen.shp`);
const plan = readXlsx(XLSX_DIR);
if (dbf.length !== shp.length) console.warn('⚠ DBF/SHP Anzahl ungleich:', dbf.length, shp.length);

const features = [], docs = [];
let withPlan = 0, sumM2 = 0;
for (let i = 0; i < dbf.length; i++) {
  const d = dbf[i], g = shp[i]; if (!g) continue;
  const pl = plan[d.objektnummer] || null; if (pl) withPlan++;
  sumM2 += g.m2;
  const props = {
    extId: d.extId, geomType: 'flaeche', einheit: 'm2', menge: g.m2,
    name: d.name || pl?.objektbemerkung || ('Fläche ' + d.objektnummer),
    belag: d.belag, objektart: d.objektart, stadtteil: d.stadtteil,
    objektnummer: d.objektnummer, pflegeeinheit: d.pflegeeinheit,
    reinigungsflaecheListe: pl?.reinigungsflaecheListe ?? null,
    betriebshof: pl?.betriebshof || '', fahrzeug: pl?.fahrzeug || '',
    sommerTage: pl?.sommerTage || '', winterTage: pl?.winterTage || '',
    haeufigkeitS: pl?.haeufigkeitS || '', haeufigkeitW: pl?.haeufigkeitW || '',
    hatPlan: !!pl,
  };
  // Bundle-Feature: Geometrie + props (statisch)
  features.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: g.rings }, properties: { extId: d.extId } });
  // Firestore-Doc: leicht, ohne Geometrie
  docs.push(props);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/essen-flaechen.geojson`, JSON.stringify({ type: 'FeatureCollection', features }));
writeFileSync(`${OUT_DIR}/essen-flaechen-docs.json`, JSON.stringify(docs));

const fmt = n => n.toLocaleString('de-DE');
console.log('\n================ ERGEBNIS ================');
console.log('Flächen gesamt:        ', fmt(docs.length));
console.log('mit Reinigungsplan:    ', fmt(withPlan), '(' + Math.round(withPlan / docs.length * 100) + '%)');
console.log('ohne Plan:             ', fmt(docs.length - withPlan));
console.log('Gesamtfläche (m²):     ', fmt(sumM2));
console.log('Bundle-Datei (GeoJSON):', fmt(Buffer.byteLength(JSON.stringify({ type: 'FeatureCollection', features })) / 1024 | 0) + ' KB');
console.log('\nBeispiel-Datensatz:');
console.log(JSON.stringify(docs.find(d => d.hatPlan), null, 2));
console.log('\nGeschrieben nach:', OUT_DIR);
