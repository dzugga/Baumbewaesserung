// Parst das Ahlener Straßenverzeichnis (Satzung Straßenreinigung) in eine Zuständigkeitstabelle.
// Voraussetzung: Text mit pdftotext -table erzeugen:
//   pdftotext -table -enc UTF-8 "Strassenverzeichnis_2026-Satzung_Strassenreinigung.pdf" strv_t.txt
// Aufruf:  node scripts/parse-ahlen-strv.mjs [pfad/strv_t.txt]
// Ausgabe: Downloads/_ahlen_out/ahlen-strv.json  (je Straße: schluessel, name, zustFahrbahn, zustGehweg, kategorie)
//
// Spalten (Zeichenindex aus pdftotext -table, fix über alle Seiten):
//   Stadt-Fahrbahn ~70 · Stadt-Gehweg ~80 · Anlieger-Fahrbahn ~88 · Anlieger-Gehweg ~99
//   Kategorie: Anliegerstr ~107 · innerörtl ~123 · überörtl ~142 · Fußgängerzone ~160
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const TXT = process.argv[2] || `${HOME}/Downloads/strv_t.txt`;
const OUT_DIR = `${HOME}/Downloads/_ahlen_out`;

const COL = { sFB:[68,74], sGW:[77,84], aFB:[85,93], aGW:[96,104], kAnl:[105,114], kInner:[119,130], kUeber:[136,150], kFuss:[154,166] };
const hit = (s, [lo,hi]) => { for(let i=lo;i<Math.min(hi,s.length);i++) if(s[i]==='X') return true; return false; };
const anyX = s => /X/.test(s);
const keyRe = /^\s*(\d[\dlo]{2,4}(?:\s\d{1,2})?)\s+(\S.*)$/;
const norm = k => k.replace(/\s+/g,'').replace(/l/g,'1').replace(/[oO]/g,'0');
const kategorie = s => hit(s,COL.kAnl)?'Anliegerstraße':hit(s,COL.kInner)?'innerörtliche Straße':hit(s,COL.kUeber)?'überörtliche Straße':hit(s,COL.kFuss)?'Fußgängerzone':'';
const zust = (s, fbCol, gwCol, aCol, agCol) => ({ fb: hit(s,fbCol)?'stadt':(hit(s,aCol)?'anlieger':''), gw: hit(s,gwCol)?'stadt':(hit(s,agCol)?'anlieger':'') });

function applyZust(o, s){
  const z = { fb: hit(s,COL.sFB)?'stadt':(hit(s,COL.aFB)?'anlieger':''), gw: hit(s,COL.sGW)?'stadt':(hit(s,COL.aGW)?'anlieger':'') };
  if(z.fb && !o.zustFahrbahn) o.zustFahrbahn=z.fb;
  if(z.gw && !o.zustGehweg)   o.zustGehweg=z.gw;
  if(!o.kategorie){ const k=kategorie(s); if(k) o.kategorie=k; }
}

const lines = readFileSync(TXT,'utf8').split(/\r?\n/);
const rows=[]; let cur=null, curHasMarks=false;
const flush=()=>{ if(cur) rows.push(cur); };
for(const s of lines){
  const m=s.match(keyRe);
  const looksStreet = m && /[A-Za-zÄÖÜäöüß]/.test(s.slice(m[1].length,67));
  if(looksStreet){
    flush();
    cur={ schluessel:norm(m[1]), name:s.slice(m[1].length,67).trim().replace(/\s{2,}/g,' '), zustFahrbahn:'', zustGehweg:'', kategorie:'', sub:[] };
    curHasMarks=false;
    if(anyX(s)){ applyZust(cur,s); curHasMarks=true; }
  } else if(cur && anyX(s)){
    if(!curHasMarks){ applyZust(cur,s); curHasMarks=true; }       // Markierungen einer umbrochenen Namenszeile
    else { const sub={ name:s.slice(0,67).trim().replace(/\s{2,}/g,' '), zustFahrbahn:'', zustGehweg:'', kategorie:'' }; applyZust(sub,s); if(sub.name) cur.sub.push(sub); }  // Stichstraße/Teilstück
  }
}
flush();

const valid=rows.filter(r=>r.name && r.name.length>1 && !/^(Reinigungspflicht|Stadt Ahlen|Fahrbahn|Gehweg|Stand:)/.test(r.name));
mkdirSync(OUT_DIR,{recursive:true});
writeFileSync(`${OUT_DIR}/ahlen-strv.json`, JSON.stringify(valid));
const c=f=>valid.filter(f).length;
console.log('Straßen:', valid.length,
  '| Stadt-Fahrbahn:', c(r=>r.zustFahrbahn==='stadt'),
  '| Stadt-Gehweg:', c(r=>r.zustGehweg==='stadt'),
  '| Anlieger reinigt alles (Stadt nichts):', c(r=>r.zustFahrbahn!=='stadt'&&r.zustGehweg!=='stadt'),
  '| Teilstücke (sub):', valid.reduce((s,r)=>s+r.sub.length,0));
console.log('Geschrieben:', `${OUT_DIR}/ahlen-strv.json`);
console.log('--- Stichprobe ---');
for(const r of valid.slice(0,12)) console.log(`${r.schluessel}\t${r.name}\tFB:${r.zustFahrbahn||'–'} GW:${r.zustGehweg||'–'} ${r.kategorie}`);
