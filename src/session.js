// Single-Session-Schutz für die PIN-Apps (Fahrer-App, Navi, Erfassung, Einsatzleiter):
// hält die eigene Sitzung per Heartbeat am Leben und meldet, wenn sie übernommen wurde.
// Der Desktop nutzt das NICHT (dort sind parallele Anmeldungen erlaubt).
let _hb = null, _sess = null;
const _fn = name => firebase.app().functions('europe-west3').httpsCallable(name);

export function startSession(sessionId, onKicked) {
  _sess = sessionId || null;
  if (_hb) { clearInterval(_hb); _hb = null; }
  if (!_sess) return;
  const beat = async () => {
    try {
      const r = await _fn('driverHeartbeat')({ sessionId: _sess });
      if (r && r.data && r.data.ok === false) { // Sitzung wurde übernommen → dieser Client ist raus
        if (_hb) { clearInterval(_hb); _hb = null; }
        _sess = null;
        if (typeof onKicked === 'function') onKicked();
      }
    } catch (_) { /* Netzfehler ignorieren — nächster Beat versucht es erneut */ }
  };
  _hb = setInterval(beat, 45000);
}

export async function endSession() {
  const s = _sess; _sess = null;
  if (_hb) { clearInterval(_hb); _hb = null; }
  if (s) { try { await _fn('driverLogout')({ sessionId: s }); } catch (_) {} }
}
