// ============================================================================
//  Auth-/Mandanten-Cloud-Functions  (Phase 1 — angelegt, NICHT deployt)
//  - driverLogin   : Fahrername + PIN  -> Firebase Custom Token (Rolle 'fahrer')
//  - setDriverPin  : Admin vergibt/aendert eine Fahrer-PIN (nur Hash gespeichert)
//  - setUserRole   : Admin setzt Custom Claims {orgId, role} fuer Planer/Admins
//  Aktivierung erst nach Firebase-Auth + Backfill, siehe docs/auth-mandanten.md
// ============================================================================
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3'; // Frankfurt — wie Firestore/Storage (EU-Datenverarbeitung)
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 Min Sperre nach zu vielen Fehlversuchen
const SESSION_STALE_MS = 90 * 1000; // ältere aktive Sitzung gilt als tot (Gerät zu/abgestürzt) → Übernahme erlaubt

// ---- PIN-Hashing (scrypt, ohne Zusatz-Abhaengigkeit) ----
function makeSalt() { return crypto.randomBytes(16).toString('hex'); }
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function verifyPin(pin, salt, hash) {
  if (!salt || !hash) return false;
  const h = Buffer.from(hashPin(pin, salt), 'hex');
  const b = Buffer.from(hash, 'hex');
  return h.length === b.length && crypto.timingSafeEqual(h, b);
}
function nowMs() { return Date.now(); }

// Basis-Typ (cap) einer Rolle auflösen — steuert die Firestore-Rules.
// Rollen sind mandantenscharf (orgs/{orgId}/roles); Fallback: alter globaler Katalog.
const BUILTIN_BASETYPE = { superadmin: 'admin', orgadmin: 'admin', planer: 'editor', erfasser: 'editor', fahrer: 'driver' };
async function capForRole(roleKey, orgId) {
  if (roleKey === 'superadmin') return 'admin';
  try {
    if (orgId) {
      const s = await db.collection('orgs').doc(orgId).collection('roles').doc(roleKey).get();
      if (s.exists && s.data().baseType) return s.data().baseType;
    }
  } catch (e) {}
  try { const s = await db.collection('roles').doc(roleKey).get(); if (s.exists && s.data().baseType) return s.data().baseType; } catch (e) {}
  return BUILTIN_BASETYPE[roleKey] || 'readonly';
}

// ── Fahrer-Login: Name + PIN -> Custom Token ────────────────────────────────
exports.driverLogin = onCall({ region: REGION }, async (req) => {
  const { orgId, orgCode, name, pin } = req.data || {};
  if (!name || !pin) throw new HttpsError('invalid-argument', 'Name und PIN erforderlich');

  let oid = orgId;
  if (!oid && orgCode) {
    const qs = await db.collection('orgs').where('code', '==', String(orgCode)).limit(1).get();
    if (qs.empty) throw new HttpsError('not-found', 'Mandant nicht gefunden');
    oid = qs.docs[0].id;
  }

  const nameLower = String(name).trim().toLowerCase();
  // Mit Stadt: nur diese Org. Ohne Stadt: ueber alle Staedte per Name suchen (PIN entscheidet).
  const cand = oid
    ? (await db.collection('drivers').where('orgId', '==', oid).where('nameLower', '==', nameLower).get()).docs
    : (await db.collection('drivers').where('nameLower', '==', nameLower).get()).docs;
  if (!cand.length) throw new HttpsError('permission-denied', 'Name oder PIN falsch'); // generisch (keine Enumeration)

  const now = nowMs();
  const active = cand.map(s => ({ ref: s.ref, d: s.data() })).filter(x => x.d.active !== false);
  // PIN gegen nicht-gesperrte Kandidaten pruefen
  const matches = active.filter(x => !(x.d.lockedUntil && x.d.lockedUntil > now) && verifyPin(pin, x.d.pinSalt, x.d.pinHash));

  if (matches.length > 1)
    throw new HttpsError('failed-precondition', 'Name in mehreren Staedten — bitte Stadt-Code angeben');

  if (matches.length === 1) {
    const { ref, d } = matches[0];
    const oid2 = d.orgId;
    // Single-Session: nur EIN Gerät je Kennung gleichzeitig (Desktop schickt allowParallel=true → ausgenommen).
    const allowParallel = !!(req.data && req.data.allowParallel);
    const upd = { failedAttempts: 0, lockedUntil: 0, lastLogin: new Date().toISOString() };
    let sessionId = '';
    if (!allowParallel) {
      const s = d.session;
      if (s && s.lastSeen && (now - s.lastSeen) < SESSION_STALE_MS) {
        throw new HttpsError('already-exists', 'Diese Kennung ist bereits an einem anderen Gerät angemeldet. Bitte dort abmelden oder kurz warten.');
      }
      sessionId = makeSalt();
      upd.session = { id: sessionId, lastSeen: now, app: String((req.data && req.data.app) || '') };
    }
    await ref.update(upd);
    const personRole = d.role || 'fahrer';
    const personCap = await capForRole(personRole, oid2);
    // Mandanten-Feature-Flags (Navi) + Routing-Key — Default aus; Fahrer dürfen das orgs-Doc nicht direkt lesen.
    let naviEnabled = false, orsKey = '';
    try { const og = await db.collection('orgs').doc(oid2).get(); if (og.exists) { const od = og.data(); naviEnabled = !!od.naviEnabled; orsKey = od.orsKey || ''; } } catch (_) {}
    const token = await admin.auth().createCustomToken('drv_' + ref.id, {
      orgId: oid2, role: personRole, cap: personCap, driverId: ref.id, name: d.name,
    });
    return { token, driverId: ref.id, name: d.name, orgId: oid2, role: personRole, sessionId, naviEnabled, orsKey };
  }

  // Kein Treffer: Fehlversuch auf ALLE getesteten (nicht gesperrten) Kandidaten zaehlen.
  // Sonst waere der Lockout bei Namensgleichheit ueber Staedte umgehbar (unbegrenztes PIN-Raten).
  const tested = active.filter(x => !(x.d.lockedUntil && x.d.lockedUntil > now));
  await Promise.all(tested.map(x => {
    const fails = (x.d.failedAttempts || 0) + 1;
    return x.ref.update(fails >= MAX_FAILS ? { failedAttempts: 0, lockedUntil: now + LOCK_MS } : { failedAttempts: fails });
  }));
  throw new HttpsError('permission-denied', 'Name oder PIN falsch');
});

// ── Heartbeat: hält die eigene Sitzung am Leben; meldet, wenn sie übernommen wurde ──
exports.driverHeartbeat = onCall({ region: REGION }, async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid || uid.indexOf('drv_') !== 0) throw new HttpsError('unauthenticated', 'Nicht angemeldet');
  const driverId = uid.slice(4);
  const { sessionId } = req.data || {};
  const ref = db.collection('drivers').doc(driverId);
  const s = await ref.get();
  if (!s.exists) return { ok: false };
  const sess = s.data().session;
  if (!sess || sess.id !== sessionId) return { ok: false }; // andere Sitzung aktiv → dieser Client ist „raus"
  await ref.update({ 'session.lastSeen': nowMs() });
  return { ok: true };
});

// ── Logout: gibt die eigene Sitzung frei (sofortige Neuanmeldung möglich) ──
exports.driverLogout = onCall({ region: REGION }, async (req) => {
  const uid = req.auth && req.auth.uid;
  if (!uid || uid.indexOf('drv_') !== 0) return { ok: true };
  const driverId = uid.slice(4);
  const { sessionId } = req.data || {};
  const ref = db.collection('drivers').doc(driverId);
  const s = await ref.get();
  if (s.exists) { const sess = s.data().session; if (sess && sess.id === sessionId) await ref.update({ session: admin.firestore.FieldValue.delete() }); }
  return { ok: true };
});

// ── Admin legt Person an / aendert PIN, Name oder Rolle ─────────────────────
exports.setDriverPin = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { driverId, name, orgId, pin, personRole } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  const pr = personRole || 'fahrer';
  if (!isSuper && pr === 'superadmin') throw new HttpsError('permission-denied', 'Rolle nicht erlaubt');

  const setPin = pin !== undefined && pin !== null && pin !== '';
  if (setPin && !/^\d{6}$/.test(String(pin))) throw new HttpsError('invalid-argument', 'PIN muss 6-stellig sein');

  if (driverId) {
    const ref = db.collection('drivers').doc(driverId);
    const s = await ref.get();
    if (!s.exists) throw new HttpsError('not-found', 'Person nicht gefunden');
    if (!isSuper && s.data().orgId !== targetOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
    const upd = { failedAttempts: 0, lockedUntil: 0 };
    if (personRole !== undefined) upd.role = pr;   // Rolle nur aendern, wenn mitgeschickt
    if (name) { upd.name = String(name).trim(); upd.nameLower = String(name).trim().toLowerCase(); }
    if (setPin) { const salt = makeSalt(); upd.pinSalt = salt; upd.pinHash = hashPin(pin, salt); }
    await ref.update(upd);
    return { driverId };
  }

  if (!name) throw new HttpsError('invalid-argument', 'Name erforderlich');
  if (!setPin) throw new HttpsError('invalid-argument', 'PIN erforderlich');
  const salt = makeSalt();
  const ref = db.collection('drivers').doc();
  await ref.set({
    orgId: targetOrg, role: pr,
    name: String(name).trim(), nameLower: String(name).trim().toLowerCase(),
    pinSalt: salt, pinHash: hashPin(pin, salt),
    active: true, failedAttempts: 0, lockedUntil: 0,
    createdAt: new Date().toISOString(),
  });
  return { driverId: ref.id };
});

// ── Admin setzt/aendert den Stadt-Code seines Mandanten (eindeutig) ─────────
exports.setOrgCode = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, code } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');

  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(c)) throw new HttpsError('invalid-argument', 'Code: 2–12 Zeichen, nur A–Z und 0–9');

  // Eindeutigkeit ueber alle Mandanten pruefen
  const qs = await db.collection('orgs').where('code', '==', c).limit(1).get();
  if (!qs.empty && qs.docs[0].id !== targetOrg)
    throw new HttpsError('already-exists', 'Code ist bereits vergeben');

  await db.collection('orgs').doc(targetOrg).set({ code: c }, { merge: true });
  return { ok: true, code: c };
});

// ── Admin setzt den ORS-Routing-Key seines Mandanten (stadtscharf) ──────────
exports.setOrgOrsKey = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, orsKey } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  const key = String(orsKey || '').trim();
  if (key.length > 200) throw new HttpsError('invalid-argument', 'Key zu lang');
  await db.collection('orgs').doc(targetOrg).set({ orsKey: key }, { merge: true });
  return { ok: true };
});

// ── Superadmin schaltet die Navi-Funktion eines Mandanten frei (Feature-Flag) ──
exports.setOrgNavi = onCall({ region: REGION }, async (req) => {
  const { role } = requireAdmin(req.auth);
  if (role !== 'superadmin') throw new HttpsError('permission-denied', 'Nur Superadmin');
  const { orgId, naviEnabled } = req.data || {};
  if (!orgId) throw new HttpsError('invalid-argument', 'orgId fehlt');
  await db.collection('orgs').doc(String(orgId)).set({ naviEnabled: !!naviEnabled }, { merge: true });
  return { ok: true, naviEnabled: !!naviEnabled };
});

// ── Superadmin verschiebt ein Projekt in einen anderen Mandanten ────────────
// Aktualisiert orgId am Projekt und auf ALLEN Dokumenten der Unterkollektionen
// (trees/tours/routes/reasons/arten/tourHistory — denormalisiert für die Rules).
// Hinweis: Bereits hochgeladene Fotos/Dokumente bleiben unter dem alten Storage-Pfad;
// ihre Download-URLs funktionieren weiter (Token-basiert), Löschen erfordert Superadmin.
exports.moveProjectToOrg = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const { role } = requireAdmin(req.auth);
  if (role !== 'superadmin') throw new HttpsError('permission-denied', 'Nur der Superadmin kann Projekte verschieben');
  const { projectId, targetOrgId } = req.data || {};
  if (!projectId || !targetOrgId) throw new HttpsError('invalid-argument', 'projectId und targetOrgId erforderlich');
  const orgSnap = await db.collection('orgs').doc(targetOrgId).get();
  if (!orgSnap.exists) throw new HttpsError('not-found', 'Ziel-Mandant nicht gefunden');
  const projRef = db.collection('projects').doc(projectId);
  const projSnap = await projRef.get();
  if (!projSnap.exists) throw new HttpsError('not-found', 'Projekt nicht gefunden');
  await projRef.update({ orgId: targetOrgId });
  let moved = 0;
  const subs = await projRef.listCollections();
  for (const col of subs) {
    const docs = await col.get();
    for (let i = 0; i < docs.docs.length; i += 400) {
      const batch = db.batch();
      docs.docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { orgId: targetOrgId }));
      await batch.commit();
    }
    moved += docs.size;
  }
  return { ok: true, moved };
});

// ── Admin setzt die WMS-Kartenebenen seines Mandanten (stadtscharf) ─────────
exports.setOrgWmsLayers = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, layers } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  if (!Array.isArray(layers)) throw new HttpsError('invalid-argument', 'layers muss ein Array sein');
  if (layers.length > 30) throw new HttpsError('invalid-argument', 'Zu viele Ebenen');
  await db.collection('orgs').doc(targetOrg).set({ wmsLayers: layers }, { merge: true });
  return { ok: true };
});

// ── Admin setzt die Dispo-Konfiguration seines Mandanten (stadtscharf) ──────
exports.setOrgDispo = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, config, resources } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  const upd = {};
  if (config && typeof config === 'object' && !Array.isArray(config)) upd.dispoConfig = config;
  if (Array.isArray(resources)) upd.dispoResources = resources.slice(0, 50);
  if (!Object.keys(upd).length) throw new HttpsError('invalid-argument', 'Nichts zu speichern');
  await db.collection('orgs').doc(targetOrg).set(upd, { merge: true });
  return { ok: true };
});

// ── Admin pflegt die Funktions-Liste (Einsatzgruppen) seines Mandanten ──────
exports.setOrgFunktionen = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, funktionen } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  if (!Array.isArray(funktionen)) throw new HttpsError('invalid-argument', 'funktionen muss ein Array sein');
  const clean = [...new Set(funktionen.map(s => String(s || '').trim()).filter(Boolean))].slice(0, 100);
  await db.collection('orgs').doc(targetOrg).set({ funktionen: clean }, { merge: true });
  return { ok: true, funktionen: clean };
});

// ── Admin setzt den KI-Analyse-Modus seines Mandanten (stadtscharf) ─────────
exports.setOrgKiMode = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { orgId, mode } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';
  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  if (!['off', 'manual', 'auto', 'both'].includes(mode)) throw new HttpsError('invalid-argument', 'Ungueltiger Modus');
  await db.collection('orgs').doc(targetOrg).set({ kiMode: mode }, { merge: true });
  return { ok: true, mode };
});

// ── Admin setzt Rolle/Org (Custom Claims) fuer Planer/Erfasser/Admins ───────
exports.setUserRole = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { targetUid, orgId, role: newRole } = req.data || {};
  if (!targetUid || !orgId || !newRole)
    throw new HttpsError('invalid-argument', 'targetUid, orgId, role erforderlich');
  const isSuper = role === 'superadmin';
  if (!isSuper) {
    if (orgId !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
    if (newRole === 'superadmin') throw new HttpsError('permission-denied', 'Rolle nicht erlaubt');
  }
  const cap = await capForRole(newRole, orgId);
  await admin.auth().setCustomUserClaims(targetUid, { orgId, role: newRole, cap });
  await db.collection('users').doc(targetUid).set(
    { orgId, role: newRole, updatedAt: new Date().toISOString() }, { merge: true });
  return { ok: true };
});

// ── Hilfsfunktionen: Admin-Berechtigung prüfen ──────────────────────────────
function requireAdmin(caller) {
  if (!caller) throw new HttpsError('unauthenticated', 'Login erforderlich');
  const role = caller.token.role, cap = caller.token.cap;
  if (role !== 'superadmin' && cap !== 'admin') throw new HttpsError('permission-denied', 'Keine Berechtigung');
  return { role, cap, callerOrg: caller.token.orgId };
}
async function assertSameOrg(role, callerOrg, uid) {
  if (role === 'superadmin') return;
  const s = await db.collection('users').doc(uid).get();
  const tOrg = s.exists ? s.data().orgId : null;
  if (tOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
}

// ── Admin legt ein E-Mail-Konto an (Planer/Erfasser/Orgadmin) ───────────────
exports.createOrgUser = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { email, password, newRole, orgId, displayName } = req.data || {};
  const targetOrg = orgId || callerOrg;
  const isSuper = role === 'superadmin';

  if (!isSuper && targetOrg !== callerOrg) throw new HttpsError('permission-denied', 'Fremder Mandant');
  if (!newRole || (!isSuper && newRole === 'superadmin')) throw new HttpsError('permission-denied', 'Rolle nicht erlaubt');
  if (!email || !/.+@.+\..+/.test(String(email))) throw new HttpsError('invalid-argument', 'Gültige E-Mail erforderlich');
  if (!password || String(password).length < 6) throw new HttpsError('invalid-argument', 'Passwort min. 6 Zeichen');

  let user;
  try {
    user = await admin.auth().createUser({
      email: String(email).trim(), password: String(password),
      displayName: displayName || undefined, emailVerified: true,
    });
  } catch (e) {
    if (e.code === 'auth/email-already-exists') throw new HttpsError('already-exists', 'E-Mail ist bereits vergeben');
    if (e.code === 'auth/invalid-password') throw new HttpsError('invalid-argument', 'Passwort ungültig (min. 6 Zeichen)');
    throw new HttpsError('internal', e.message || 'Konnte Nutzer nicht anlegen');
  }
  const cap = await capForRole(newRole, targetOrg);
  await admin.auth().setCustomUserClaims(user.uid, { orgId: targetOrg, role: newRole, cap });
  await db.collection('users').doc(user.uid).set({
    email: user.email, displayName: displayName || '', orgId: targetOrg, role: newRole,
    active: true, createdAt: new Date().toISOString(),
  }, { merge: true });
  return { uid: user.uid };
});

// ── Admin setzt ein neues Passwort ──────────────────────────────────────────
exports.setUserPassword = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { uid, password } = req.data || {};
  if (!uid || !password || String(password).length < 6) throw new HttpsError('invalid-argument', 'uid + Passwort (min. 6) erforderlich');
  await assertSameOrg(role, callerOrg, uid);
  await admin.auth().updateUser(uid, { password: String(password) });
  return { ok: true };
});

// ── Admin löscht ein Konto endgültig (Login weg; Daten/Historie bleiben) ────
exports.deleteOrgUser = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { uid } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid erforderlich');
  if (uid === req.auth.uid) throw new HttpsError('failed-precondition', 'Das eigene Konto kann nicht gelöscht werden');
  await assertSameOrg(role, callerOrg, uid);
  try { await admin.auth().deleteUser(uid); }
  catch (e) { if (e.code !== 'auth/user-not-found') throw new HttpsError('internal', e.message || 'Löschen fehlgeschlagen'); }
  await db.collection('users').doc(uid).delete().catch(() => {});
  return { ok: true };
});

// ── Admin aktiviert/deaktiviert ein Konto ───────────────────────────────────
exports.setUserActive = onCall({ region: REGION }, async (req) => {
  const { role, callerOrg } = requireAdmin(req.auth);
  const { uid, active } = req.data || {};
  if (!uid) throw new HttpsError('invalid-argument', 'uid erforderlich');
  await assertSameOrg(role, callerOrg, uid);
  await admin.auth().updateUser(uid, { disabled: !active });
  await db.collection('users').doc(uid).set({ active: !!active }, { merge: true });
  return { ok: true };
});
