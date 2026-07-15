// ============================================================================
//  FES Frankfurt „PK.-Planung": Touren aus „Erzeugung Touren.xlsx" anlegen und
//  Objekte zuordnen (n:m über ExternalID3 ↔ pflanzzeitpunkt).
//  Quelle: C:/INFA/FES-PK/Erzeugung Touren.xlsx (Blatt INFA-Touren)
//    A=ExternalID3 · B=Category(=Tourname) · C=Wochentag · D=Betriebshof
//  - Tour je Category: betriebstage=[Wochentag], interval='woechentlich', betriebshof=Spalte D.
//  - Objekt: tourIds = alle Touren seiner ExternalID3 (ein Objekt an mehreren Wochentagen möglich).
//  Idempotent (Touren per Name wiederverwendet, korrekte Objekte übersprungen).
//
//    node scripts/import-fes-erzeugung-touren.mjs            # DRY-RUN (+ Soll/Plan-Statistik)
//    node scripts/import-fes-erzeugung-touren.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';
import zlib from 'zlib';

const PID = 'JMQMe7TMLcSopaxsquKW';
const XLSX = 'C:/INFA/FES-PK/Erzeugung Touren.xlsx';
const APPLY = process.argv.includes('--apply');
const BATCH = 400;
// Farbpalette wie im Desktop (TOUR_COLORS) — zyklisch über die Touren
const COLORS = ['#d11149', '#27ae60', '#2980b9', '#e67e22', '#7c3aed', '#16a085', '#c71585',
  '#f39c12', '#2c3e50', '#8e44ad', '#d35400', '#1abc9c', '#c0392b', '#2471a3', '#e84393', '#00b894'];
// Wochentag (deutsch) → betriebstage-Codes (0=So … 6=Sa), wie set-fes-betriebstage.mjs
const WD = { 'montag': [1], 'dienstag': [2], 'mittwoch': [3], 'donnerstag': [4], 'freitag': [5], 'samstag': [6], 'sonntag': [0] };

// ── Minimaler xlsx-Reader (ZIP central directory → inflate) ──
function readZipEntries(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('EOCD nicht gefunden');
  const cdOffset = buf.readUInt32LE(eocd + 16), cdCount = buf.readUInt16LE(eocd + 10);
  const out = {}; let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const comp = buf.readUInt16LE(p + 10), compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const lNameLen = buf.readUInt16LE(lho + 26), lExtraLen = buf.readUInt16LE(lho + 28);
    const ds = lho + 30 + lNameLen + lExtraLen, raw = buf.subarray(ds, ds + compSize);
    out[name] = comp === 0 ? raw : zlib.inflateRawSync(raw);
  }
  return out;
}
const decodeXml = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
function parseSharedStrings(xml) { if (!xml) return []; const out = []; const re = /<si>([\s\S]*?)<\/si>/g; let m; while ((m = re.exec(xml))) { let t = ''; const tr = /<t[^>]*>([\s\S]*?)<\/t>/g; let x; while ((x = tr.exec(m[1]))) t += x[1]; out.push(decodeXml(t)); } return out; }
function parseSheet(xml, ss) {
  const rows = []; const rre = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rre.exec(xml))) {
    const cells = {}; const cre = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cre.exec(rm[2]))) {
      const col = cm[1], attr = cm[2] || '', body = cm[3] || ''; const t = (attr.match(/\bt="([^"]+)"/) || [])[1] || ''; let v = '';
      if (t === 'inlineStr') { const im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); v = im ? decodeXml(im[1]) : ''; }
      else { const vm = body.match(/<v>([\s\S]*?)<\/v>/); const raw = vm ? vm[1] : ''; v = t === 's' ? (ss[+raw] ?? '') : decodeXml(raw); }
      if (v !== '') cells[col] = v;
    }
    rows.push(cells);
  }
  return rows;
}

// ── Excel lesen ──
const buf = fs.readFileSync(XLSX);
const e = readZipEntries(buf, n => n === 'xl/sharedStrings.xml' || n === 'xl/worksheets/sheet1.xml');
const ss = parseSharedStrings(e['xl/sharedStrings.xml']?.toString('utf8'));
const rows = parseSheet(e['xl/worksheets/sheet1.xml']?.toString('utf8'), ss);
const header = rows[0] || {};
// Spalten über die Überschriften finden (robuster als feste A/B/C/D)
let cExt = null, cCat = null, cWd = null, cBs = null;
for (const [col, txt] of Object.entries(header)) {
  const t = (txt || '').trim().toLowerCase();
  if (t === 'externalid3') cExt = col;
  if (t === 'category') cCat = col;
  if (t === 'wochentag') cWd = col;
  if (t === 'betriebshof') cBs = col;
}
if (!cExt || !cCat || !cWd || !cBs) throw new Error(`Spalten nicht gefunden: ExternalID3=${cExt} Category=${cCat} Wochentag=${cWd} Betriebshof=${cBs}`);

// Category → {wd:betriebstage[], bs, wdName}; ExternalID3 → Set(Category)
const tourMeta = new Map();
const extToCats = new Map();
const badWd = new Set();
for (let i = 1; i < rows.length; i++) {
  const r = rows[i];
  const ext = (r[cExt] || '').trim();
  const cat = (r[cCat] || '').trim();
  const wdName = (r[cWd] || '').trim();
  const bs = (r[cBs] || '').trim();
  if (!cat) continue;
  const bt = WD[wdName.toLowerCase()];
  if (!bt) badWd.add(wdName);
  if (!tourMeta.has(cat)) tourMeta.set(cat, { betriebstage: bt || [], bs, wdName });
  if (ext) { const s = extToCats.get(ext) || new Set(); s.add(cat); extToCats.set(ext, s); }
}
const tourNames = [...tourMeta.keys()].sort();
console.log(`\n=== FES „Erzeugung Touren" (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) ===`);
console.log(`Excel: ${rows.length - 1} Zeilen · ${tourNames.length} Touren · ${extToCats.size} distinct ExternalID3`);
if (badWd.size) console.log('⚠ Unbekannte Wochentage (Tour bekäme leere Betriebstage!):', [...badWd].join(', '));

// ── Projekt / Werteliste ──
admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const proj = await pref.get();
if (!proj.exists) throw new Error('Projekt fehlt');
const orgId = proj.data()?.orgId;
const sollFeld = proj.data()?.sollFeld || null;
const bhLabels = new Set(((proj.data()?.listValues?.betriebshof) || []).map(b => (b.label || '').trim()));
const usedBs = [...new Set([...tourMeta.values()].map(m => m.bs).filter(Boolean))];
const missingBs = usedBs.filter(b => !bhLabels.has(b));
console.log(`Projekt: ${proj.data()?.name} · orgId=${orgId} · sollFeld=${sollFeld}`);
console.log(`Betriebshöfe in Datei: ${usedBs.join(', ')}${missingBs.length ? ' · ⚠ NICHT in Werteliste: ' + missingBs.join(', ') : ' (alle in Werteliste)'}`);

// zustand-Werteliste (id → zahl) für Soll
const zList = (proj.data()?.listValues?.[sollFeld]) || [];
const sollZahl = new Map(); zList.forEach(v => sollZahl.set(String(v.id ?? v.label), Number(v.zahl)));

// ── Objekte laden (über pflanzzeitpunkt = ExternalID3) ──
const snap = await pref.collection('trees').select('pflanzzeitpunkt', 'tourIds', 'tourId', sollFeld || 'pflanzzeitpunkt').get();
const byExt = new Map();
snap.forEach(d => { const v = String(d.data().pflanzzeitpunkt ?? '').trim(); if (v) byExt.set(v, d); });

// ── Touren idempotent anlegen/aktualisieren ──
const toursSnap = await pref.collection('tours').get();
const tourIdByName = new Map();
toursSnap.forEach(d => tourIdByName.set((d.data().name || '').trim(), d.id));
let toursNew = 0, toursUpd = 0;
const tourWrites = [];
for (let i = 0; i < tourNames.length; i++) {
  const name = tourNames[i];
  const m = tourMeta.get(name);
  const data = { name, desc: '', color: COLORS[i % COLORS.length], orgId, betriebstage: m.betriebstage, interval: 'woechentlich', betriebshof: m.bs };
  if (tourIdByName.has(name)) { toursUpd++; tourWrites.push({ id: tourIdByName.get(name), data, isNew: false }); }
  else { const ref = pref.collection('tours').doc(); tourIdByName.set(name, ref.id); toursNew++; tourWrites.push({ id: ref.id, data: { ...data, createdAt: admin.firestore.FieldValue.serverTimestamp() }, isNew: true }); }
}
console.log(`\nTouren: ${toursNew} neu · ${toursUpd} vorhanden (werden aktualisiert: Betriebstage/Betriebshof/Farbe)`);

// ── Objekt-Zuordnung berechnen ──
const arrEq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const updates = []; let missing = 0, already = 0;
for (const [ext, cats] of extToCats) {
  const doc = byExt.get(ext);
  if (!doc) { missing++; continue; }
  const tids = [...cats].sort().map(c => tourIdByName.get(c)).filter(Boolean);
  const cur = doc.data();
  const curIds = Array.isArray(cur.tourIds) ? [...cur.tourIds].sort() : (cur.tourId ? [cur.tourId] : []);
  if (arrEq(curIds, [...tids].sort())) { already++; continue; }
  updates.push({ ref: doc.ref, tourIds: tids });
}
console.log(`Zuordnung: ${updates.length} Objekte zu setzen · ${already} bereits korrekt · ${missing} Excel-IDs ohne Objekt`);

// ── Soll/Plan-Statistik (Plan = Σ 1×/Wo je Tour = Anzahl zugeordneter Touren) ──
if (sollFeld) {
  let passt = 0, unter = 0, ueber = 0, ohneSoll = 0;
  const beispieleUnter = [];
  for (const [ext, cats] of extToCats) {
    const doc = byExt.get(ext); if (!doc) continue;
    const plan = cats.size; // jede Tour wöchentlich, 1 Betriebstag → 1×/Wo
    const sv = String(doc.data()[sollFeld] ?? '');
    const soll = sollZahl.has(sv) ? sollZahl.get(sv) : NaN;
    if (!isFinite(soll)) { ohneSoll++; continue; }
    if (plan === soll) passt++;
    else if (plan < soll) { unter++; if (beispieleUnter.length < 5) beispieleUnter.push(`${ext}: Soll ${soll} / Plan ${plan}`); }
    else ueber++;
  }
  console.log(`\nSoll/Plan (Soll = ${sollFeld}-Zahl, Plan = Wochentage je Objekt):`);
  console.log(`  passt genau: ${passt} · unterplant: ${unter} · überplant: ${ueber} · ohne Soll-Wert: ${ohneSoll}`);
  if (beispieleUnter.length) console.log('  Beispiele unterplant:', beispieleUnter.join(' · '));
}

// ── Verteilung Touren-Größe ──
const size = tourNames.map(n => ({ n, c: [...extToCats.values()].filter(s => s.has(n)).length }));
console.log('\nTouren (Name · Wochentag · Objekte):');
for (const t of tourNames) { const m = tourMeta.get(t); const c = [...extToCats.values()].filter(s => s.has(t)).length; console.log(`  ${t.padEnd(14)} ${m.wdName.padEnd(11)} ${c}`); }

// ── Schreiben ──
if (APPLY) {
  for (const w of tourWrites) {
    const ref = pref.collection('tours').doc(w.id);
    if (w.isNew) await ref.set(w.data); else await ref.set(w.data, { merge: true });
  }
  console.log(`\n✓ ${tourWrites.length} Touren geschrieben.`);
  for (let i = 0; i < updates.length; i += BATCH) {
    const b = db.batch();
    updates.slice(i, i + BATCH).forEach(u => b.update(u.ref, { tourIds: u.tourIds, tourId: u.tourIds[0] }));
    await b.commit();
    console.log(`  … ${Math.min(i + BATCH, updates.length)}/${updates.length} Objekte zugeordnet`);
  }
  console.log('✓ Fertig.');
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
