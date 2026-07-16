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
export const APP_CHECK_SITE_KEY = "6Le_3RktAAAAALLHmpGKCKiqj8s0JPdQJYDUcfG6"; // reCAPTCHA-v3-Site-Key (öffentlich)

export function initAppCheck() {
  try {
    if (APP_CHECK_SITE_KEY && typeof firebase !== 'undefined' && firebase.appCheck) {
      // Nur im DEV-Modus auf localhost: den bereits in der Firebase-Konsole registrierten FESTEN Debug-Token
      // setzen, damit jeder Entwickler-Browser nach dem "Erzwingen" sofort läuft — ohne je Browser einen
      // neuen Zufalls-Token registrieren zu müssen. `import.meta.env.DEV` sorgt dafür, dass dieser Zweig
      // (inkl. Token-String) im Production-Build KOMPLETT wegoptimiert wird — der Token landet NIE im
      // ausgelieferten Bundle. Einen VORAB gesetzten Token (Screenshot-Skript injiziert denselben Wert)
      // NICHT überschreiben.
      try {
        if (import.meta.env.DEV
            && (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
            && self.FIREBASE_APPCHECK_DEBUG_TOKEN === undefined) {
          self.FIREBASE_APPCHECK_DEBUG_TOKEN = '5b0c7e2a-4f1d-4e9a-9c3b-8a2f6d1e0c74';
        }
      } catch (_) {}
      firebase.appCheck().activate(APP_CHECK_SITE_KEY, /* autoRefresh */ true);
    }
  } catch (e) {
    console.warn('App Check konnte nicht aktiviert werden:', e);
  }
}
