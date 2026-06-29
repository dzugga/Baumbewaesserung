// Einzige Quelle der Wahrheit für die Felder, die ein Fahrer (cap 'driver') laut Firestore-Rules
// ändern darf. MUSS exakt mit firestore.rules übereinstimmen:
//   onlyStatusFields()     ↔ TREE_STATUS_FIELDS
//   onlyTourStatusFields() ↔ TOUR_STATUS_FIELDS
// Der Abgleich wird automatisch geprüft (scripts/test-rules-contract.mjs, `npm test`).
// Hintergrund: Ein früherer Bug schrieb wasser/notiz mit → Rules lehnten ab, der Client deutete das
// fälschlich als „offline". Der Client filtert seine Fahrer-Schreibvorgänge jetzt auf diese Liste.
export const TREE_STATUS_FIELDS = ['lastStatus','lastReason','lastNote','lastDriver','lastReportAt','history','datum','zustand','lastFuellgrad'];
export const TOUR_STATUS_FIELDS = ['status','closedAt','closedBy','lastClosedDate','reopenedAt','reopenedBy'];

// Filtert ein Update-Objekt auf die erlaubten Baum-Status-Felder (Defense-in-Depth).
export function onlyTreeStatusFields(obj){
  const out = {};
  for(const k of Object.keys(obj || {})) if(TREE_STATUS_FIELDS.includes(k)) out[k] = obj[k];
  return out;
}
