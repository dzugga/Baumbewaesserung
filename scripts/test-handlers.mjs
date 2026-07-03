// Mechanischer Audit-Check: Jeder in HTML/Template-Strings referenzierte Inline-Handler
// (onclick="fn(...)" usw.) muss in desktop.js in der Object.assign(window,{...})-Allowlist stehen,
// sonst stirbt der Klick stumm (Modul-Scope). Gleiches Muster für mobile/erfassung/einsatzleiter,
// falls dort Object.assign(window,...) genutzt wird.
import fs from 'fs';

const read=p=>fs.readFileSync(p,'utf8');
const desktop=read('src/desktop.js');
const html=read('index.html');

// 1) Handler-Namen einsammeln (aus index.html + allen Template-Strings in desktop.js)
const HANDLER_RE=/on(?:click|change|input|contextmenu|mouseenter|mouseleave|mousedown|mouseup|submit|dblclick|keydown|keyup|blur|focus)\s*=\s*(?:"|\\?")\s*([A-Za-z_$][\w$]*)\s*\(/g;
const used=new Set();
for(const src of [html,desktop]){
  let m; while((m=HANDLER_RE.exec(src))) used.add(m[1]);
}

// 2) window-Allowlist aus desktop.js parsen (Object.assign(window,{ ... }))
const start=desktop.indexOf('Object.assign(window,{');
if(start<0){ console.error('Allowlist nicht gefunden'); process.exit(1); }
// Block bis zur schließenden }) — Klammern zählen
let depth=0,end=start;
for(let i=desktop.indexOf('{',start);i<desktop.length;i++){
  const c=desktop[i];
  if(c==='{')depth++;
  if(c==='}'){depth--; if(depth===0){ end=i; break; }}
}
const block=desktop.slice(start,end).replace(/\/\/[^\n]*/g,''); // Kommentare raus
const allowed=new Set();
for(const m of block.matchAll(/[A-Za-z_$][\w$]*/g)) allowed.add(m[0]); // alle Identifikatoren (Kurzform-Objekt)

// 3) Ausnahmen: Browser-Globals, echte window-Funktionen anderswo definiert, this-Aufrufe
const IGNORE=new Set(['this','window','document','event','alert','confirm','prompt','open','print','location','if','for','while','return','void']);
// Funktionen, die per `window.foo=`-Zuweisung existieren:
for(const m of desktop.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) allowed.add(m[1]);

const missing=[...used].filter(n=>!allowed.has(n)&&!IGNORE.has(n)).sort();
console.log(`Handler referenziert: ${used.size} · in Allowlist/window: ${allowed.size}`);
if(missing.length){
  console.log('\n⚠ FEHLEN in der window-Allowlist (Klick stirbt stumm):');
  missing.forEach(n=>console.log('  -',n));
  process.exit(2);
}
console.log('✓ Alle Inline-Handler sind erreichbar.');
