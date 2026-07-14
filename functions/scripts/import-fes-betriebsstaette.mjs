// ============================================================================
//  FES Frankfurt „PK.-Planung": Betriebsstätte (= Betriebshof) zuordnen.
//  Quelle: C:/INFA/FES-PK/Touren-FES.xlsx — Spalte A=FES-ID, B=Tour, C=Betriebsstätte.
//  - Objekte: Feld `betriebshof` = Betriebsstätte (Match über FES-ID ↔ pflanzzeitpunkt).
//  - Touren : Feld `betriebshof` = (eindeutige) Betriebsstätte ihrer Objekte laut Liste.
//  „K.A." = keine Betriebsstätte → Feld bleibt leer (erscheint als „ohne Betriebshof").
//  Betriebshof-Werteliste (BS 2/4/6/7/9) ist im Projekt bereits gepflegt; das Feld
//  speichert das Label. Admin-SDK, idempotent (korrekte Werte werden übersprungen).
//
//    node scripts/import-fes-betriebsstaette.mjs            # DRY-RUN
//    node scripts/import-fes-betriebsstaette.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';
import zlib from 'zlib';

const PID = 'JMQMe7TMLcSopaxsquKW';
const XLSX = 'C:/INFA/FES-PK/Touren-FES.xlsx';
const APPLY = process.argv.includes('--apply');
const BATCH = 400;
const NO_BS = /^k\.?\s*a\.?$/i; // „K.A." / „k.A." → keine Betriebsstätte

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
let cF = null, cT = null, cB = null;
for (const [col, txt] of Object.entries(header)) { const t = (txt || '').trim().toLowerCase(); if (t === 'fes-id') cF = col; if (t === 'tour') cT = col; if (/betriebsst/.test(t)) cB = col; }
console.log(`\n=== FES Betriebsstätte-Zuordnung (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) ===`);
console.log(`Excel: ${rows.length - 1} Datenzeilen · FES-ID=${cF} · Tour=${cT} · Betriebsstätte=${cB}`);
if (!cF || !cB) throw new Error('Spalte „FES-ID" oder „Betriebsstätte" nicht gefunden');

// FES-ID → Betriebsstätte; Tour → Betriebsstätten-Zähler
const bsByFes = new Map(); const bsByTour = new Map(); const bsCount = {};
for (let i = 1; i < rows.length; i++) {
  const c = rows[i]; const fes = (c[cF] || '').trim(); const tour = (c[cT] || '').trim(); const bs = (c[cB] || '').trim();
  const bsClean = (!bs || NO_BS.test(bs)) ? '' : bs;
  if (fes) bsByFes.set(fes, bsClean);
  bsCount[bsClean || '(ohne)'] = (bsCount[bsClean || '(ohne)'] || 0) + 1;
  if (tour && !NO_BS.test(tour) && bsClean) { const m = bsByTour.get(tour) || {}; m[bsClean] = (m[bsClean] || 0) + 1; bsByTour.set(tour, m); }
}
console.log('Betriebsstätten in der Liste:', JSON.stringify(bsCount));

// ── Projekt / Werteliste ──
admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const proj = await pref.get();
const bhLabels = new Set(((proj.data()?.listValues?.betriebshof) || []).map(b => (b.label || '').trim()));
const usedBs = [...new Set([...bsByFes.values()].filter(Boolean))];
const missing = usedBs.filter(b => !bhLabels.has(b));
console.log('Betriebshof-Werteliste vorhanden:', [...bhLabels].join(', ') || '(keine)');
if (missing.length) console.log('⚠ NICHT in der Werteliste (Filter/Marker zeigen sie erst nach Pflege):', missing.join(', '));

// ── Objekte ──
const snap = await pref.collection('trees').select('pflanzzeitpunkt', 'betriebshof').get();
let noFes = 0, noExcel = 0, already = 0;
const treeUpd = [];
snap.forEach(d => {
  const fes = String(d.data().pflanzzeitpunkt ?? '').trim();
  if (!fes) { noFes++; return; }
  if (!bsByFes.has(fes)) { noExcel++; return; }
  const target = bsByFes.get(fes); // '' = ohne Betriebsstätte
  if (String(d.data().betriebshof ?? '').trim() === target) { already++; return; }
  treeUpd.push({ ref: d.ref, betriebshof: target });
});
console.log(`\nObjekte: ${snap.size} · ohne FES-ID: ${noFes} · ohne Excel-Zeile: ${noExcel} · bereits korrekt: ${already}`);
console.log(`Objekte zu setzen: ${treeUpd.length} (davon „ohne Betriebsstätte": ${treeUpd.filter(u => !u.betriebshof).length})`);

// ── Touren ──
const toursSnap = await pref.collection('tours').get();
const tourUpd = []; const tourConflicts = [];
toursSnap.forEach(d => {
  const name = (d.data().name || '').trim();
  const m = bsByTour.get(name);
  if (!m) return; // Tour nicht in Liste oder ohne BS
  const entries = Object.entries(m).sort((a, b) => b[1] - a[1]);
  const target = entries[0][0];
  if (entries.length > 1) tourConflicts.push(`${name}: ${entries.map(([k, v]) => k + '×' + v).join(', ')} → ${target}`);
  if (String(d.data().betriebshof ?? '').trim() === target) return;
  tourUpd.push({ ref: d.ref, name, betriebshof: target });
});
console.log(`\nTouren: ${toursSnap.size} · Betriebsstätte zu setzen: ${tourUpd.length}`);
if (tourConflicts.length) { console.log('⚠ Touren mit gemischten Betriebsstätten (Mehrheit gewinnt):'); tourConflicts.forEach(c => console.log('   ' + c)); }
tourUpd.slice(0, 8).forEach(u => console.log(`   ${u.name} → ${u.betriebshof}`));
if (tourUpd.length > 8) console.log(`   … +${tourUpd.length - 8} weitere`);

if (APPLY) {
  for (let i = 0; i < treeUpd.length; i += BATCH) {
    const b = db.batch(); treeUpd.slice(i, i + BATCH).forEach(u => b.update(u.ref, { betriebshof: u.betriebshof })); await b.commit();
    console.log(`  Objekte … ${Math.min(i + BATCH, treeUpd.length)}/${treeUpd.length}`);
  }
  for (let i = 0; i < tourUpd.length; i += BATCH) {
    const b = db.batch(); tourUpd.slice(i, i + BATCH).forEach(u => b.update(u.ref, { betriebshof: u.betriebshof })); await b.commit();
  }
  console.log(`  Touren … ${tourUpd.length}/${tourUpd.length}`);
  console.log('\n✓ Fertig: Betriebsstätte an Objekten und Touren gesetzt.');
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
