// ── Firebase App Check ────────────────────────────────────────────────────────
// Schützt Firestore/Storage/Functions davor, mit dem (öffentlichen) Firebase-Schlüssel
// von FREMDEN Seiten/Skripten angesprochen zu werden: Nur Anfragen von der echten App
// erhalten ein gültiges App-Check-Token.
//
// AKTIVIERUNG (einmalig, durch den Betreiber):
//   1. Firebase Console → App Check → Web-App registrieren → Anbieter „reCAPTCHA v3"
//      → erzeugten Site-Key unten bei APP_CHECK_SITE_KEY eintragen.
//   2. Neu deployen (App Check läuft dann zunächst nur im „Monitoring"-Modus mit).
//   3. In der Console die Kennzahlen prüfen; wenn legitimer Verkehr Tokens erhält,
//      App Check pro Dienst (Firestore/Storage/Functions) „erzwingen".
//
// Solange APP_CHECK_SITE_KEY leer ist, passiert NICHTS — sicher deploybar.
export const APP_CHECK_SITE_KEY = ""; // ← reCAPTCHA-v3-Site-Key hier eintragen

export function initAppCheck() {
  try {
    if (APP_CHECK_SITE_KEY && typeof firebase !== 'undefined' && firebase.appCheck) {
      firebase.appCheck().activate(APP_CHECK_SITE_KEY, /* autoRefresh */ true);
    }
  } catch (e) {
    console.warn('App Check konnte nicht aktiviert werden:', e);
  }
}
