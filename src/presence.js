// Präsenz-/Sitzungserfassung + Auswertung — bewusst ohne App-Globals (Modul-First-Regel):
// alle Abhängigkeiten kommen als Parameter, damit alle vier Apps dasselbe Modul nutzen können.
//
// Datenmodell: Collection `presence`, ein Doc je Sitzung:
//   {orgId, kind:'desktop'|'fahrer'|'einsatzleiter'|'erfassung', userKey, name, role, app, buildId,
//    loginAt(ms), lastSeen(ms), logoutAt(ms|null)}
// Login → Doc anlegen · Lebenszeichen (~5 min) → lastSeen · Logout/Tab-schließen → logoutAt.
// Das Lebenszeichen misst KEINE Aktivität — es dient allein dazu, das Sitzungsende zu erkennen,
// wenn kein sauberer Logout kommt (Absturz/Tab zu/Netz weg): dann gilt die Sitzung nach
// Ablauf von PRESENCE_STALE_MS als beendet (kein logoutAt).

export const PRESENCE_HEARTBEAT_MS = 5 * 60 * 1000;   // 5 min — sparsam; nur Lebenszeichen
export const PRESENCE_STALE_MS = 11 * 60 * 1000;      // „online"/„läuft" = lastSeen jünger als das (≥ 2× Heartbeat)

// Erfassung. Gibt ein Handle mit stop() zurück. db = compat-Firestore-Instanz.
// Loggt nur, wenn der globale Erfassungs-Schalter aktiv ist: appsettings/presence.logging !== false
// (Standard = an; vom Superadmin im Präsenz-Reiter umschaltbar). So lässt sich das Loggen z. B. in
// der Entwicklung abschalten, ohne die Auswertung/Historie zu verlieren.
export function startPresence(opts) {
  const o = opts || {};
  const db = o.db;
  if (!db || !o.orgId || !o.userKey) return { stop() {}, id: null };
  const now = () => Date.now();
  let ref = null, timer = null, stopped = false;
  // Präsenz-Schreibvorgänge sind best-effort: JEDE Ablehnung (z. B. alte Doc-Version ohne uid nach dem
  // Owner-Bindungs-Umbau, oder Netz-/Rules-Fehler) MUSS still bleiben. `.catch()` fängt die Promise-Ablehnung
  // — das try/catch allein fängt nur synchrone Fehler und ließe die Ablehnung als „unhandledrejection" durch.
  const beat = () => { if (stopped || !ref) return; try { ref.update({ lastSeen: now() }).catch(() => {}); } catch (_) {} };
  const logout = () => {
    if (stopped) return; stopped = true;
    try { clearInterval(timer); } catch (_) {}
    try { if (ref) ref.update({ lastSeen: now(), logoutAt: now() }).catch(() => {}); } catch (_) {}
  };
  const begin = () => {
    if (stopped || ref) return;
    const doc = {
      orgId: o.orgId, kind: o.kind || '', userKey: o.userKey, name: o.name || '',
      role: o.role || '', app: o.app || '', buildId: o.buildId || '',
      uid: o.uid || '',   // Auth-UID (Owner-Bindung in den Rules); ohne Match wird der Write abgelehnt
      loginAt: now(), lastSeen: now(), logoutAt: null,
    };
    try { ref = db.collection('presence').doc(); ref.set(doc).catch(() => {}); }
    catch (e) { try { console.warn('presence start', e); } catch (_) {} return; }
    timer = setInterval(beat, o.intervalMs || PRESENCE_HEARTBEAT_MS);
  };
  // Globalen Erfassungs-Schalter lesen, dann ggf. loggen. Flag nicht lesbar → im Zweifel loggen.
  try {
    db.collection('appsettings').doc('presence').get()
      .then(s => { if (!s || !s.exists || s.data().logging !== false) begin(); })
      .catch(() => begin());
  } catch (_) { begin(); }
  try {
    window.addEventListener('pagehide', logout);
    window.addEventListener('beforeunload', logout);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beat(); });
  } catch (_) {}
  return { stop: logout, beat, get id() { return ref && ref.id; } };
}

// ── Auswertung (pure) ──
export function presenceIsOnline(s, nowMs, staleMs) {
  if (!s || s.logoutAt) return false;
  return (nowMs - (s.lastSeen || 0)) < (staleMs || PRESENCE_STALE_MS);
}
// Sitzungsende (ms): expliziter Logout, sonst letzter Heartbeat.
export function presenceSessionEnd(s) { return s.logoutAt || s.lastSeen || s.loginAt || 0; }
export function presenceDurationMs(s) { return Math.max(0, presenceSessionEnd(s) - (s.loginAt || 0)); }

// Maximale Parallelität im Zeitfenster [fromMs,toMs]; filter(s)→bool grenzt z. B. auf 'fahrer' ein.
// Rückgabe {max, atMs}. Sweep-Line über Login(+1)/Ende(-1)-Ereignisse.
export function presenceMaxParallel(sessions, fromMs, toMs, filter) {
  const ev = [];
  (sessions || []).forEach(s => {
    if (filter && !filter(s)) return;
    const a = s.loginAt || 0, b = presenceSessionEnd(s);
    if (b < fromMs || a > toMs) return; // außerhalb
    ev.push([Math.max(a, fromMs), 1]);
    ev.push([Math.min(b, toMs) + 1, -1]); // +1: gleichzeitiges Ende zählt nicht mehr mit dem nächsten Start
  });
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0, max = 0, atMs = fromMs;
  for (const [t, d] of ev) { cur += d; if (cur > max) { max = cur; atMs = t; } }
  return { max, atMs };
}
