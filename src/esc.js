// HTML-Escape gegen Stored-XSS: Firestore-Daten (Objekt-/Tour-/Grund-/Mandantennamen) werden vor dem
// Einsetzen in innerHTML maskiert. Zentral für alle Apps (vorher 4× kopiert + abweichende dlEsc-Variante
// im Desktop). Maskiert die 5 HTML-kritischen Zeichen inkl. einfacher Anführungszeichen.
export function esc(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
