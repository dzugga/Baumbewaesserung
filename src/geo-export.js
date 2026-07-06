// ─── Shapefile-Export (abhängigkeitsfrei) ───────────────────────────────────
// Erzeugt aus Features (GeoJSON-Geometrie in [lng,lat]) einen Shapefile-Satz
// (.shp/.shx/.dbf/.prj/.cpg) je Geometrietyp und packt alles in ein ZIP.
// Reprojektion wird als Funktion injiziert (Browser: globales proj4; Test: npm-proj4).
//
// Shapefile fasst nur EINEN Geometrietyp je Datei → Punkte/Strecken/Flächen = 3 Layer.
// DBF-Grenzen bewusst behandelt: Feldnamen ≤10 Zeichen (+ Kollisionsauflösung, Mapping-Datei),
// Text in UTF-8 mit begleitender .cpg, damit Umlaute erhalten bleiben.

const SHP_TYPE = { Point: 1, PolyLine: 3, Polygon: 5 };

// WKT für ETRS89 / UTM 32N (EPSG:25832) — von QGIS/ArcGIS/GDAL erkannt.
export const PRJ_ETRS89_UTM32N =
  'PROJCS["ETRS89 / UTM zone 32N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],AUTHORITY["EPSG","6258"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4258"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",9],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG","25832"]]';

// ── kleine Byte-Helfer ───────────────────────────────────────────────────────
function concatBytes(chunks) {
  let len = 0; for (const c of chunks) len += c.length;
  const out = new Uint8Array(len); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
function utf8(s) { return new TextEncoder().encode(String(s == null ? '' : s)); }

// ── CRC32 (für ZIP) ───────────────────────────────────────────────────────────
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── ZIP (Store, ohne Kompression) ─────────────────────────────────────────────
export function zipStore(files) {
  // files: [{ name, data:Uint8Array }]
  const enc = files.map(f => ({ name: utf8(f.name), data: f.data, crc: crc32(f.data) }));
  const locals = []; const central = []; let offset = 0;
  const DOSTIME = 0, DOSDATE = 0x21; // fester Zeitstempel (1980-01-01), deterministisch
  for (const f of enc) {
    const lh = new Uint8Array(30 + f.name.length); const dv = new DataView(lh.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
    dv.setUint16(8, 0, true); dv.setUint16(10, DOSTIME, true); dv.setUint16(12, DOSDATE, true);
    dv.setUint32(14, f.crc, true); dv.setUint32(18, f.data.length, true); dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, f.name.length, true); dv.setUint16(28, 0, true);
    lh.set(f.name, 30);
    locals.push(lh, f.data);
    const ch = new Uint8Array(46 + f.name.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, DOSTIME, true); cv.setUint16(14, DOSDATE, true);
    cv.setUint32(16, f.crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, f.name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    ch.set(f.name, 46);
    central.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdBytes = concatBytes(central); const cdSize = cdBytes.length; const cdOffset = offset;
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, enc.length, true); ev.setUint16(10, enc.length, true);
  ev.setUint32(12, cdSize, true); ev.setUint32(16, cdOffset, true);
  return concatBytes([...locals, cdBytes, eocd]);
}

// ── Geometrie-Helfer ──────────────────────────────────────────────────────────
function ringSignedArea(ring) { // projizierte [x,y]; >0 = CCW
  let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
  return a / 2;
}
function ensureClosed(ring) {
  if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring = [...ring, ring[0]];
  return ring;
}
// GeoJSON-Ringe → projizierte, ESRI-orientierte Ringe (outer CW, holes CCW)
function projectPolygon(coords, reproject) {
  const rings = [];
  coords.forEach((ring, idx) => {
    let r = ring.map(([lng, lat]) => reproject(lng, lat));
    r = ensureClosed(r);
    const ccw = ringSignedArea(r) > 0;
    const wantCcw = idx > 0; // Loch = CCW, Außenring = CW
    if (ccw !== wantCcw) r = r.slice().reverse();
    rings.push(r);
  });
  return rings;
}

// ── DBF ────────────────────────────────────────────────────────────────────────
// Feldschema aus Attributen ableiten (JS-number → N, sonst C), Namen ≤10 Zeichen + Kollisionsauflösung.
export function buildDbfSchema(featureAttrs) {
  const keys = [];
  featureAttrs.forEach(a => Object.keys(a || {}).forEach(k => { if (!keys.includes(k)) keys.push(k); }));
  const used = new Set(); const fields = [];
  for (const key of keys) {
    let isNum = true, anyVal = false, maxLen = 1, dec = 0;
    for (const a of featureAttrs) {
      const v = a ? a[key] : null; if (v == null || v === '') continue; anyVal = true;
      if (typeof v === 'number' && isFinite(v)) {
        const s = _numStr(v); if (s.includes('.')) dec = Math.max(dec, Math.min(6, s.split('.')[1].length));
        maxLen = Math.max(maxLen, s.length);
      } else { isNum = false; maxLen = Math.max(maxLen, utf8(v).length); }
    }
    if (!anyVal) isNum = false;
    let name = _shortName(key, used);
    let len, decimals = 0, type;
    if (isNum) { type = 'N'; decimals = dec; len = Math.min(19, Math.max(maxLen, dec ? dec + 2 : 1)); }
    else { type = 'C'; len = Math.min(254, Math.max(1, maxLen)); }
    fields.push({ key, name, type, len, dec: decimals });
  }
  return fields;
}
function _numStr(v) { let s = (Math.round(v * 1e6) / 1e6).toString(); if (s.includes('e')) s = v.toFixed(6); return s; }
function _shortName(key, used) {
  let base = key.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 10) || 'F';
  let name = base, i = 1;
  while (used.has(name.toUpperCase())) { const suf = String(i++); name = base.slice(0, 10 - suf.length) + suf; }
  used.add(name.toUpperCase()); return name;
}
function dbfFieldValue(field, v) {
  if (v == null) v = '';
  if (field.type === 'N') {
    if (v === '' || (typeof v === 'number' && !isFinite(v))) return _padLeft('', field.len);
    let s = (typeof v === 'number') ? v.toFixed(field.dec) : String(v);
    if (s.length > field.len) s = s.slice(0, field.len);
    return _padLeft(s, field.len);
  }
  // C: UTF-8-Bytes, links, auf Länge (in Bytes) auffüllen/abschneiden
  let b = utf8(v);
  if (b.length > field.len) b = b.slice(0, field.len);
  const out = new Uint8Array(field.len).fill(0x20); out.set(b, 0); return out;
}
function _padLeft(s, len) { const b = utf8(s); const out = new Uint8Array(len).fill(0x20); out.set(b.slice(0, len), len - Math.min(b.length, len)); return out; }

function buildDbf(featureAttrs, fields) {
  const recLen = 1 + fields.reduce((s, f) => s + f.len, 0);
  const headerLen = 32 + 32 * fields.length + 1;
  const header = new Uint8Array(headerLen); const dv = new DataView(header.buffer);
  header[0] = 0x03; header[1] = 80; header[2] = 1; header[3] = 1; // Version 3, festes Datum 1980-01-01
  dv.setUint32(4, featureAttrs.length, true); dv.setUint16(8, headerLen, true); dv.setUint16(10, recLen, true);
  let p = 32;
  for (const f of fields) {
    const nb = utf8(f.name); for (let i = 0; i < 11; i++) header[p + i] = i < nb.length ? nb[i] : 0;
    header[p + 11] = f.type.charCodeAt(0); header[p + 16] = f.len; header[p + 17] = f.dec; p += 32;
  }
  header[headerLen - 1] = 0x0D;
  const rows = [header];
  for (const a of featureAttrs) {
    const rec = [new Uint8Array([0x20])];
    for (const f of fields) rec.push(dbfFieldValue(f, a ? a[f.key] : ''));
    rows.push(concatBytes(rec));
  }
  rows.push(new Uint8Array([0x1A]));
  return concatBytes(rows);
}

// ── SHP/SHX ─────────────────────────────────────────────────────────────────────
function shpHeader(fileWords, shapeType, bbox) {
  const h = new Uint8Array(100); const dv = new DataView(h.buffer);
  dv.setInt32(0, 9994, false); dv.setInt32(24, fileWords, false);
  dv.setInt32(28, 1000, true); dv.setInt32(32, shapeType, true);
  dv.setFloat64(36, bbox[0], true); dv.setFloat64(44, bbox[1], true);
  dv.setFloat64(52, bbox[2], true); dv.setFloat64(60, bbox[3], true);
  return h;
}
// Baut .shp + .shx für einen Layer. features: [{geometry:{type,coordinates}, ...}]
function buildShpShx(features, shapeType, reproject) {
  const recs = []; // {content:Uint8Array}
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  const ext = (x, y) => { if (x < bbox[0]) bbox[0] = x; if (y < bbox[1]) bbox[1] = y; if (x > bbox[2]) bbox[2] = x; if (y > bbox[3]) bbox[3] = y; };

  for (const f of features) {
    const g = f.geometry;
    if (shapeType === SHP_TYPE.Point) {
      const [x, y] = reproject(g.coordinates[0], g.coordinates[1]); ext(x, y);
      const c = new Uint8Array(20); const dv = new DataView(c.buffer);
      dv.setInt32(0, 1, true); dv.setFloat64(4, x, true); dv.setFloat64(12, y, true);
      recs.push(c);
    } else {
      let parts;
      if (shapeType === SHP_TYPE.Polygon) {
        const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
        parts = []; polys.forEach(poly => projectPolygon(poly, reproject).forEach(r => parts.push(r)));
      } else { // PolyLine
        const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
        parts = lines.map(l => l.map(([lng, lat]) => reproject(lng, lat)));
      }
      const pb = [Infinity, Infinity, -Infinity, -Infinity];
      let nPoints = 0; parts.forEach(pr => { nPoints += pr.length; pr.forEach(([x, y]) => { ext(x, y); if (x < pb[0]) pb[0] = x; if (y < pb[1]) pb[1] = y; if (x > pb[2]) pb[2] = x; if (y > pb[3]) pb[3] = y; }); });
      const content = new Uint8Array(44 + 4 * parts.length + 16 * nPoints); const dv = new DataView(content.buffer);
      dv.setInt32(0, shapeType, true);
      dv.setFloat64(4, pb[0], true); dv.setFloat64(12, pb[1], true); dv.setFloat64(20, pb[2], true); dv.setFloat64(28, pb[3], true);
      dv.setInt32(36, parts.length, true); dv.setInt32(40, nPoints, true);
      let off = 44, acc = 0;
      for (const pr of parts) { dv.setInt32(off, acc, true); off += 4; acc += pr.length; }
      for (const pr of parts) for (const [x, y] of pr) { dv.setFloat64(off, x, true); dv.setFloat64(off + 8, y, true); off += 16; }
      recs.push(content);
    }
  }

  // .shp zusammensetzen
  const shpChunks = []; const shxChunks = [];
  let fileWords = 50; // Header
  const shxRecs = [];
  recs.forEach((content, i) => {
    const rh = new Uint8Array(8); const rv = new DataView(rh.buffer);
    rv.setInt32(0, i + 1, false); rv.setInt32(4, content.length / 2, false);
    shxRecs.push({ offset: fileWords, len: content.length / 2 });
    shpChunks.push(rh, content);
    fileWords += 4 + content.length / 2;
  });
  if (!isFinite(bbox[0])) { bbox[0] = bbox[1] = bbox[2] = bbox[3] = 0; }
  const shp = concatBytes([shpHeader(fileWords, shapeType, bbox), ...shpChunks]);

  const shxFileWords = 50 + recs.length * 4;
  for (const r of shxRecs) { const rh = new Uint8Array(8); const rv = new DataView(rh.buffer); rv.setInt32(0, r.offset, false); rv.setInt32(4, r.len, false); shxChunks.push(rh); }
  const shx = concatBytes([shpHeader(shxFileWords, shapeType, bbox), ...shxChunks]);
  return { shp, shx };
}

// ── öffentliche API ─────────────────────────────────────────────────────────────
// layers: [{ name, shapeType:'Point'|'PolyLine'|'Polygon', features:[{geometry, attrs}] }]
// opts: { reproject:(lng,lat)=>[x,y], prj:string }
export function buildShapefileZip(layers, opts) {
  const reproject = opts.reproject;
  const prj = opts.prj || PRJ_ETRS89_UTM32N;
  const files = []; const mapping = [];
  for (const layer of layers) {
    const feats = layer.features || [];
    if (!feats.length) continue;
    const attrs = feats.map(f => f.attrs || {});
    const fields = buildDbfSchema(attrs);
    const { shp, shx } = buildShpShx(feats, SHP_TYPE[layer.shapeType], reproject);
    files.push({ name: layer.name + '.shp', data: shp });
    files.push({ name: layer.name + '.shx', data: shx });
    files.push({ name: layer.name + '.dbf', data: buildDbf(attrs, fields) });
    files.push({ name: layer.name + '.prj', data: utf8(prj) });
    files.push({ name: layer.name + '.cpg', data: utf8('UTF-8') });
    fields.forEach(f => { if (f.name.toUpperCase() !== f.key.toUpperCase().slice(0, 10)) mapping.push(`${layer.name}: ${f.name} = ${f.key}`); });
  }
  if (mapping.length) files.push({ name: 'feldnamen.txt', data: utf8('Gekürzte DBF-Feldnamen (max. 10 Zeichen) → Originalfeld:\n\n' + mapping.join('\n') + '\n') });
  return zipStore(files);
}
