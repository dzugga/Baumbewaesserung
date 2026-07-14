// ============================================================================
//  FES Frankfurt „PK.-Planung": Leerungshäufigkeit aus der Original-Importdatei
//  nachtragen. Beim Erst-Import blieb die Spalte „Leerungshäufigkeit" (Zahlen
//  1–10) liegen, weil das Zielfeld (Werteliste zustand = „Leerungshäufigkeit")
//  über Label/id abgleicht, nicht über die Zahl → kein Treffer.
//
//  Dieses Skript mappt die Zahl über das `zahl`-Attribut der Werteliste auf den
//  passenden Eintrag (1→„1x/wo" … 10→„10x/wo") und setzt `zustand` (= ID) je
//  Objekt, gematcht über die FES-ID (Excel-Spalte „FES-ID" ↔ Objektfeld
//  `pflanzzeitpunkt`). Admin-SDK. Idempotent (korrekte Werte werden übersprungen).
//
//    node scripts/backfill-fes-leerungshaeufigkeit.mjs            # DRY-RUN
//    node scripts/backfill-fes-leerungshaeufigkeit.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';
import zlib from 'zlib';

const PID = 'JMQMe7TMLcSopaxsquKW'; // PK.-Planung (org_fes_frankfurt)
const XLSX = 'C:/INFA/FES-PK/Importdatei-WEB-App-FES.xlsx';
const APPLY = process.argv.includes('--apply');
const BATCH = 400;

// ── Minimaler xlsx-Reader (ZIP central directory → inflate der benötigten XML) ──
function readZipEntries(buf, wanted) {
  // EOCD suchen (von hinten)
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD nicht gefunden — keine gültige xlsx?');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  const out = {};
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const comp = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    // Local header am lho: filename+extra-Längen erneut lesen (können abweichen)
    const lNameLen = buf.readUInt16LE(lho + 26);
    const lExtraLen = buf.readUInt16LE(lho + 28);
    const dataStart = lho + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    out[name] = comp === 0 ? raw : zlib.inflateRawSync(raw);
  }
  return out;
}
const decodeXml = s => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g; let m;
  while ((m = siRe.exec(xml))) {
    let txt = ''; const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g; let tm;
    while ((tm = tRe.exec(m[1]))) txt += tm[1];
    out.push(decodeXml(txt));
  }
  return out;
}
const colLetters = ref => ref.match(/^[A-Z]+/)[0];
// Zeile → {colLetter: value(string)}; shared strings aufgelöst
function parseSheet(xml, ss) {
  const rows = [];
  const rowRe = /<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g; let rm;
  while ((rm = rowRe.exec(xml))) {
    const rnum = +rm[1]; const cells = {};
    const cRe = /<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g; let cm;
    while ((cm = cRe.exec(rm[2]))) {
      const col = colLetters(cm[1]); const attr = cm[2] || ''; const body = cm[3] || '';
      const tMatch = attr.match(/\bt="([^"]+)"/); const t = tMatch ? tMatch[1] : '';
      let val = '';
      if (t === 'inlineStr') { const im = body.match(/<t[^>]*>([\s\S]*?)<\/t>/); val = im ? decodeXml(im[1]) : ''; }
      else { const vm = body.match(/<v>([\s\S]*?)<\/v>/); const raw = vm ? vm[1] : ''; val = t === 's' ? (ss[+raw] ?? '') : decodeXml(raw); }
      if (val !== '') cells[col] = val;
    }
    rows.push({ rnum, cells });
  }
  return rows;
}

// ── Excel lesen ──
const buf = fs.readFileSync(XLSX);
const entries = readZipEntries(buf, n => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet1\.xml$/.test(n) || n === 'xl/workbook.xml');
const ss = parseSharedStrings(entries['xl/sharedStrings.xml']?.toString('utf8'));
const sheetXml = entries['xl/worksheets/sheet1.xml']?.toString('utf8');
if (!sheetXml) throw new Error('sheet1.xml nicht gefunden');
const rows = parseSheet(sheetXml, ss);
if (!rows.length) throw new Error('Keine Zeilen im Sheet');

// Kopfzeile → Spaltenbuchstaben für FES-ID und Leerungshäufigkeit
const header = rows[0].cells;
let colFes = null, colHf = null;
for (const [col, txt] of Object.entries(header)) {
  const t = (txt || '').trim().toLowerCase();
  if (t === 'fes-id') colFes = col;
  if (t === 'leerungshäufigkeit' || t === 'leerungshaeufigkeit') colHf = col;
}
console.log(`\n=== FES Leerungshäufigkeit-Backfill (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN'}) ===`);
console.log(`Excel: ${rows.length - 1} Datenzeilen · FES-ID=Spalte ${colFes} · Leerungshäufigkeit=Spalte ${colHf}`);
if (!colFes || !colHf) throw new Error('Spalte „FES-ID" oder „Leerungshäufigkeit" nicht in der Kopfzeile gefunden');

// ── Projekt + Werteliste laden ──
admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const pref = db.collection('projects').doc(PID);
const proj = await pref.get();
const zList = (proj.data()?.listValues?.zustand) || [];
// Zahl → id (über das `zahl`-Attribut der Werteliste)
const zahlToId = new Map();
zList.forEach(e => { if (e && e.zahl != null) zahlToId.set(Number(e.zahl), e.id); });
console.log('Werteliste „Leerungshäufigkeit": ' + zList.map(e => `${e.zahl}→${e.label}`).join(', '));

// Excel: FES-ID → Häufigkeitszahl
const hfByFes = new Map(); const badVals = {};
for (let i = 1; i < rows.length; i++) {
  const c = rows[i].cells; const fes = (c[colFes] || '').trim(); const hfRaw = (c[colHf] || '').trim();
  if (!fes) continue;
  const num = Number(hfRaw);
  if (!Number.isFinite(num) || !zahlToId.has(num)) { if (hfRaw) badVals[hfRaw] = (badVals[hfRaw] || 0) + 1; continue; }
  hfByFes.set(fes, num);
}
console.log(`Excel-Zuordnungen mit gültiger Häufigkeit (1–${Math.max(...zahlToId.keys())}): ${hfByFes.size}`);
if (Object.keys(badVals).length) console.log('Nicht zuordenbare Häufigkeitswerte:', JSON.stringify(badVals));

// ── Objekte indizieren (FES-ID = pflanzzeitpunkt) und Differenz bilden ──
const snap = await pref.collection('trees').select('pflanzzeitpunkt', 'zustand').get();
let match = 0, already = 0, noFesId = 0, noExcel = 0;
const updates = [];
snap.forEach(d => {
  const fes = String(d.data().pflanzzeitpunkt ?? '').trim();
  if (!fes) { noFesId++; return; }
  if (!hfByFes.has(fes)) { noExcel++; return; }
  match++;
  const targetId = zahlToId.get(hfByFes.get(fes));
  if (String(d.data().zustand ?? '') === targetId) { already++; return; }
  updates.push({ ref: d.ref, zustand: targetId });
});
console.log(`\nObjekte: ${snap.size} · mit FES-ID passend zur Excel: ${match} · ohne FES-ID: ${noFesId} · ohne Excel-Zeile: ${noExcel}`);
console.log(`Zu setzen: ${updates.length} · bereits korrekt: ${already}`);
// Verteilung der zu setzenden Werte
const dist = {}; updates.forEach(u => { const lbl = (zList.find(e => e.id === u.zustand) || {}).label || u.zustand; dist[lbl] = (dist[lbl] || 0) + 1; });
if (updates.length) console.log('Verteilung (neu):', JSON.stringify(dist));

if (APPLY) {
  for (let i = 0; i < updates.length; i += BATCH) {
    const b = db.batch();
    updates.slice(i, i + BATCH).forEach(u => b.update(u.ref, { zustand: u.zustand }));
    await b.commit();
    console.log(`  … ${Math.min(i + BATCH, updates.length)}/${updates.length} geschrieben`);
  }
  console.log('\n✓ Fertig: Leerungshäufigkeit nachgetragen.');
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
