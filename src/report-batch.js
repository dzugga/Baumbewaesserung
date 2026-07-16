// Massen-Berichtsdruck: baut aus fertigen Abschnitten je Tour EIN Druckdokument
// (je Tour ab neuer Seite; Karten als gerasterte Bilder). Pure HTML-Montage ohne
// App-Globals — die Datenbeschaffung (Tabellen, Karten-Rasterung) bleibt in desktop.js
// (Modul-First-Grenzfall: Kern pur, Orchestrierung im Aufrufer).
import { esc } from './esc.js';

// Gemeinsame Druck-Styles (auch vom Einzel-Tourbericht genutzt): A4 quer, margin 0
// (keine Browser-Kopf-/Fußzeile), Rand liegt im Seiten-Padding.
export const REPORT_PRINT_CSS =
  '@page{size:landscape;margin:0;} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;}'
  + '.sec{padding:12mm;} .sec+.sec{page-break-before:always;}'
  + 'h1{font-size:15px;font-style:italic;margin:0 0 2px;} .sub{font-size:11px;color:#444;margin:0 0 10px;}'
  + 'table{border-collapse:collapse;width:100%;} th,td{border:1px solid #888;padding:4px 6px;font-size:10px;text-align:left;vertical-align:top;}'
  + 'th{background:#eee;} td.num,th.num{text-align:right;} .nr{text-align:right;width:26px;}'
  + '.rem{font-style:italic;color:#555;font-size:9px;} tr.sum td{font-weight:bold;background:#f3f3f3;}'
  + '.mappg{display:flex;align-items:center;justify-content:center;height:186mm;overflow:hidden;}'
  + '.mappg img{max-width:100%;max-height:100%;}';

// sections: [{name, tableHtml (fertiges Innen-HTML mit h1/sub/table) | null, mapImgs: [dataUrl,…]}]
export function buildBatchDocHtml(docTitle, sections) {
  const parts = [];
  (sections || []).forEach(s => {
    if (s.tableHtml) parts.push('<div class="sec">' + s.tableHtml + '</div>');
    (s.mapImgs || []).forEach((src, i) => {
      parts.push('<div class="sec"><h1>' + esc(s.name || '') + '</h1><div class="sub">Kartenausdruck' + (s.mapImgs.length > 1 ? ' · Seite ' + (i + 1) + '/' + s.mapImgs.length : '') + '</div><div class="mappg"><img src="' + src + '"></div></div>');
    });
  });
  return '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>' + esc(docTitle || 'Berichte') + '</title>'
    + '<style>' + REPORT_PRINT_CSS + '</style></head><body>' + parts.join('') + '</body></html>';
}
