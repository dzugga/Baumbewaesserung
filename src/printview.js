import { esc } from './esc.js';
// Druckvorschau als In-App-Overlay statt window.open('_blank').
// Grund: In der installierten PWA (display:standalone) gibt es kein zweites Fenster — window.open
// ersetzt das App-Fenster, und „das eigentliche Programm ist weg". Das Overlay bleibt im DOM; beim
// Drucken blendet @media print (Regeln in index.html) alles außer #print-overlay aus.
// Reines DOM/Print, keine App-Globals → eigenes Modul (Modul-First-Regel).
export function printA4(bodyHtml, title){
  document.getElementById('print-overlay')?.remove();
  const ov=document.createElement('div');
  ov.id='print-overlay';
  ov.innerHTML=`<div class="pv-bar">
      <span class="pv-title">${esc(title||'Druckansicht')}</span>
      <span style="flex:1;"></span>
      <button type="button" class="pv-print">🖨 Drucken / als PDF</button>
      <button type="button" class="pv-close">✕ Schließen</button>
    </div>
    <div class="pv-scroll"><div class="pv-sheet">${bodyHtml}</div></div>`;
  document.body.appendChild(ov);
  const close=()=>{ ov.remove(); document.removeEventListener('keydown',onKey); };
  function onKey(e){ if(e.key==='Escape') close(); }
  ov.querySelector('.pv-close').onclick=close;
  ov.querySelector('.pv-print').onclick=()=>{ try{ window.print(); }catch(_){}} ;
  document.addEventListener('keydown',onKey);
  return ov;
}
