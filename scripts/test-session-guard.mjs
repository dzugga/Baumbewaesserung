// Test: classifyAccount — Konto-Liveness-Entscheidung (fail-open).
import { classifyAccount, INVALID_TOKEN_CODES } from '../src/session-guard.js';

let pass = 0, fail = 0;
function eq(name, got, want) {
  if (got === want) { pass++; }
  else { fail++; console.error(`✗ ${name}: erwartet ${want}, war ${got}`); }
}

// --- Fahrer (driver): drivers-Doc ist maßgeblich ---
eq('driver, Doc fehlt → gone', classifyAccount({ kind: 'driver', docRead: 'missing' }), 'gone');
eq('driver, aktiv (Feld fehlt) → ok', classifyAccount({ kind: 'driver', docRead: 'exists' }), 'ok');
eq('driver, active:true → ok', classifyAccount({ kind: 'driver', docRead: 'exists', active: true }), 'ok');
eq('driver, active:false → inactive', classifyAccount({ kind: 'driver', docRead: 'exists', active: false }), 'inactive');
eq('driver, Lesefehler → unknown (fail-open)', classifyAccount({ kind: 'driver', docRead: 'unknown' }), 'unknown');

// --- E-Mail: Token-Refresh ist maßgeblich; fehlendes users-Doc NICHT als „weg" werten ---
eq('email, Doc fehlt → unknown (fail-open, z. B. Superadmin)', classifyAccount({ kind: 'email', docRead: 'missing' }), 'unknown');
eq('email, user-disabled → gone', classifyAccount({ kind: 'email', tokenErrorCode: 'auth/user-disabled', docRead: 'unknown' }), 'gone');
eq('email, user-not-found → gone', classifyAccount({ kind: 'email', tokenErrorCode: 'auth/user-not-found', docRead: 'missing' }), 'gone');
eq('email, active:false → inactive', classifyAccount({ kind: 'email', docRead: 'exists', active: false }), 'inactive');
eq('email, active:true → ok', classifyAccount({ kind: 'email', docRead: 'exists', active: true }), 'ok');

// --- Netzfehler beim Token-Refresh darf NICHT abmelden (nicht in der Liste) ---
eq('Netzfehler-Token, Doc unknown → unknown', classifyAccount({ kind: 'driver', tokenErrorCode: 'auth/network-request-failed', docRead: 'unknown' }), 'unknown');
eq('Netzfehler-Token, driver Doc exists → ok', classifyAccount({ kind: 'driver', tokenErrorCode: 'auth/network-request-failed', docRead: 'exists', active: true }), 'ok');

// --- Endgültiger Token-Fehler schlägt jede Doc-Angabe (gone hat Vorrang) ---
eq('token invalid schlägt exists → gone', classifyAccount({ kind: 'driver', tokenErrorCode: 'auth/user-token-revoked', docRead: 'exists', active: true }), 'gone');

// --- inactive schlägt gültigen Token (deaktiviert, aber Token noch frisch) ---
eq('active:false ohne Token-Fehler → inactive', classifyAccount({ kind: 'driver', tokenErrorCode: null, docRead: 'exists', active: false }), 'inactive');

// --- Sanity: Liste nicht leer ---
eq('INVALID_TOKEN_CODES nicht leer', INVALID_TOKEN_CODES.length > 0, true);

console.log(`session-guard: ${pass} ok, ${fail} fehlgeschlagen`);
if (fail) process.exit(1);
