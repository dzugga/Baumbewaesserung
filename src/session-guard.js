// Konto-Liveness-Wächter: verhindert, dass eine im Browser persistente Session eines
// DEAKTIVIERTEN oder GELÖSCHTEN Kontos noch Zugriff gewährt (Firebase-Auth-Persistenz ist LOCAL,
// Custom-Token-Sessions werden durch Löschen des drivers-/users-Docs NICHT automatisch widerrufen).
//
// Grundprinzip: FAIL-OPEN. Nur bei EINDEUTIGEM Signal abmelden — nie bei Netz-/Rechtefehlern
// (sonst würden legitime Nutzer, v. a. die mobile Feld-App offline, fälschlich rausgeworfen).
//
// Zwei Konto-Arten, unterschiedlich zu behandeln:
//  - 'email'  (E-Mail/Passwort, users-Sammlung): Deaktivieren/Löschen macht schon den erzwungenen
//             Token-Refresh ungültig → das ist das maßgebliche Signal. Ein FEHLENDES users-Doc gilt
//             bewusst NICHT als „weg" (manche gültigen Konten, z. B. Superadmin, haben keins).
//  - 'driver' (Name+PIN, drivers-Sammlung, Custom-Token): der Refresh bleibt gültig → nur das
//             drivers-Doc entscheidet: fehlt es → weg, active===false → deaktiviert.

// Auth-Fehlercodes, die ein endgültig ungültiges Konto bedeuten (Token nicht mehr erneuerbar).
export const INVALID_TOKEN_CODES = [
  'auth/user-disabled', 'auth/user-not-found', 'auth/user-token-expired',
  'auth/invalid-user-token', 'auth/user-token-revoked', 'auth/session-cookie-revoked',
];

// Reine Entscheidungslogik (Node-testbar).
//  kind:      'driver' | 'email'
//  tokenErrorCode: Fehlercode des erzwungenen Token-Refresh (oder null)
//  docRead:   'exists' | 'missing' | 'unknown'
//  active:    Wert des active-Felds (undefined = Feld fehlt = aktiv)
// → 'ok' | 'gone' | 'inactive' | 'unknown'  (unknown ⇒ Aufrufer meldet NICHT ab)
export function classifyAccount({ kind = 'email', tokenErrorCode = null, docRead = 'unknown', active } = {}) {
  if (tokenErrorCode && INVALID_TOKEN_CODES.includes(tokenErrorCode)) return 'gone';
  if (docRead === 'exists' && active === false) return 'inactive';
  if (kind === 'driver' && docRead === 'missing') return 'gone';
  if (docRead === 'exists') return 'ok';
  return 'unknown';
}

// Live-Prüfung gegen Firebase (compat). auth = firebase.auth(), db = firebase.firestore().
export async function checkAccountLive({ auth, db }) {
  const user = auth.currentUser;
  if (!user) return 'gone';
  const uid = user.uid || '';
  const isDrv = uid.indexOf('drv_') === 0;
  const kind = isDrv ? 'driver' : 'email';

  let tokenErrorCode = null;
  try { await user.getIdToken(true); }            // erzwingt Server-Refresh (fängt deaktivierte/gelöschte E-Mail-Konten)
  catch (e) { tokenErrorCode = (e && e.code) || 'unknown'; }

  let docRead = 'unknown', active;
  try {
    const ref = isDrv ? db.collection('drivers').doc(uid.slice(4)) : db.collection('users').doc(uid);
    const s = await ref.get();
    if (s.exists) { docRead = 'exists'; active = s.data().active; }
    else docRead = 'missing';
  } catch (_) { docRead = 'unknown'; }             // Netz/Rechte → kein Signal → fail-open

  return classifyAccount({ kind, tokenErrorCode, docRead, active });
}

// Periodischer Wächter. onInvalid(status) wird NUR bei 'gone'/'inactive' aufgerufen; danach stoppt er sich.
export function startAccountGuard({ auth, db, onInvalid, intervalMs = 90000 }) {
  let stopped = false, timer = null;
  function stop() { stopped = true; if (timer) { clearInterval(timer); timer = null; } }
  const tick = async () => {
    if (stopped) return;
    const st = await checkAccountLive({ auth, db });
    if (stopped) return;
    if (st === 'gone' || st === 'inactive') { stop(); if (typeof onInvalid === 'function') onInvalid(st); }
  };
  timer = setInterval(tick, intervalMs);
  return { stop, checkNow: tick };
}
