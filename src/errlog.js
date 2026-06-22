// Globaler Fehler-Handler für ALLE Apps: verhindert stillen Abbruch, zeigt eine dezente
// freundliche Meldung und protokolliert best-effort nach Firestore (errors/) — gedrosselt
// gegen Spam/Kosten. Bewusst ohne App-Abhängigkeiten, nur globales `firebase` (compat).
let _errCount = 0, _lastMsg = '', _lastAt = 0;

// Bekannte, folgenlose Browser-Meldungen → ganz ignorieren (kein Toast, kein Log)
function _ignore(msg) {
  msg = String(msg || '');
  return /ResizeObserver loop/i.test(msg) || msg === 'Script error.' || msg === '';
}

function _toast() {
  try {
    let el = document.getElementById('global-err-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-err-toast';
      el.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#501313;color:#fff;padding:10px 16px;border-radius:8px;font:500 13px/1.4 system-ui,-apple-system,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.3);z-index:2147483647;max-width:90vw;text-align:center;';
      (document.body || document.documentElement).appendChild(el);
    }
    el.textContent = '⚠ Es ist ein unerwarteter Fehler aufgetreten. Bitte die Aktion wiederholen — tritt es erneut auf, die Seite neu laden.';
    el.style.display = 'block';
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.display = 'none'; }, 6000);
  } catch (_) {}
}

function _log(app, kind, msg, stack) {
  try {
    const now = Date.now();
    if (msg === _lastMsg && now - _lastAt < 10000) return; // gleiche Meldung max. alle 10 s
    _lastMsg = msg; _lastAt = now;
    if (_errCount >= 20) return;                            // Deckel pro Sitzung
    _errCount++;
    const fb = window.firebase;
    if (fb && fb.firestore && fb.auth && fb.auth().currentUser) {
      fb.firestore().collection('errors').add({
        app, kind,
        message: String(msg || '').slice(0, 500),
        stack: String(stack || '').slice(0, 2000),
        url: location.pathname,
        ua: (navigator.userAgent || '').slice(0, 200),
        uid: fb.auth().currentUser.uid || '',
        at: fb.firestore.FieldValue.serverTimestamp()
      }).catch(() => {}); // Logging darf nie selbst stören
    }
  } catch (_) {}
}

export function installErrorHandler(app) {
  window.addEventListener('error', e => {
    if (_ignore(e && e.message)) return;
    console.warn('[' + app + '] Laufzeitfehler:', (e && (e.error || e.message)));
    _toast(); _log(app, 'error', e && e.message, e && e.error && e.error.stack);
  });
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    const m = (r && r.message) || String(r);
    if (_ignore(m)) return;
    console.warn('[' + app + '] Unbehandelte Promise-Ablehnung:', r);
    _toast(); _log(app, 'promise', m, r && r.stack);
  });
}
