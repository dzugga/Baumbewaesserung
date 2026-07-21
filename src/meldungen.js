// Entdopplung von Melde-History für Auswertungen (Konzept „B").
//
// Normale Tour: je Objekt darf pro Tour-Lauf (= gleiche tourId + gleicher Kalendertag) nur EINE
// Meldung zählen. Eine Korrektur (z. B. erst „erledigt", dann „nicht erledigt"; oder ein zweiter
// Füllstand-Tipp) ERSETZT die vorherige → am Ende ein Eintrag mit der letzten Entscheidung.
//
// Langzeittour (Tour-Flag `langzeit:true`): Mehrfachmeldungen sind gewollt → ALLE Einträge bleiben.
//
// Schreiben bleibt unverändert append-only (voller Audit-Trail in tree.history). Diese Funktion
// wirkt NUR beim Zählen/Anzeigen und kommt daher ohne Rules-Änderung und ohne Datenmigration aus.
//
// history: Array von Einträgen {status, date, at?, tourId?, ...} EINES Objekts.
// isLangzeit: (tourId) => boolean — true, wenn die Tour eine Langzeittour ist.
// Rückgabe: gefiltertes Array (Reihenfolge wie Eingabe; je Lauf der jüngste Eintrag).
export function dedupeReports(history, isLangzeit) {
  const out = [];
  const idx = new Map(); // key "tourId|tag" -> Index in out
  for (const h of (history || [])) {
    if (!h) continue;
    const tid = h.tourId || '';
    if (isLangzeit && isLangzeit(tid)) { out.push(h); continue; } // Langzeit: alle behalten
    const day = String(h.date || h.at || '').slice(0, 10);
    const key = tid + '|' + day;
    const at = String(h.at || h.date || '');
    if (idx.has(key)) {
      const i = idx.get(key);
      const prevAt = String(out[i].at || out[i].date || '');
      if (at >= prevAt) out[i] = h;   // spätere (oder gleich alte) Meldung gewinnt = Korrektur
    } else {
      idx.set(key, out.length);
      out.push(h);
    }
  }
  return out;
}
