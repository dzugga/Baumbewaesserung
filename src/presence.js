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
export function startPresence(opts) {
  const o = opts || {};
  const db = o.db;
  if (!db || !o.orgId || !o.userKey) return { stop() {}, id: null };
  const now = () => Date.now();
  const doc = {
    orgId: o.orgId, kind: o.kind || '', userKey: o.userKey, name: o.name || '',
    role: o.role || '', app: o.app || '', buildId: o.buildId || '',
    loginAt: now(), lastSeen: now(), logoutAt: null,
  };
  let ref, timer = null, stopped = false;
  try { ref = db.collection('presence').doc(); ref.set(doc); }
  catch (e) { try { console.warn('presence start', e); } catch (_) {} return { stop() {}, id: null }; }
  const beat = () => { if (stopped) return; try { ref.update({ lastSeen: now() }); } catch (_) {} };
  timer = setInterval(beat, o.intervalMs || PRESENCE_HEARTBEAT_MS);
  const logout = () => {
    if (stopped) return; stopped = true;
    try { clearInterval(timer); } catch (_) {}
    try { ref.update({ lastSeen: now(), logoutAt: now() }); } catch (_) {}
  };
  try {
    window.addEventListener('pagehide', logout);
    window.addEventListener('beforeunload', logout);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') beat(); });
  } catch (_) {}
  return { stop: logout, beat, id: ref.id };
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
