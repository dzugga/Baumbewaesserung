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

const REGION = 'us-central1';
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 Min Sperre nach zu vielen Fehlversuchen

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

// Basis-Typ (cap) einer Rolle auflösen — steuert die Firestore-Rules
const BUILTIN_BASETYPE = { superadmin: 'admin', orgadmin: 'admin', planer: 'editor', erfasser: 'editor', fahrer: 'driver' };
async function capForRole(roleKey) {
  if (roleKey === 'superadmin') return 'admin';
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
  if (!oid) throw new HttpsError('invalid-argument', 'orgId oder orgCode erforderlich');

  const nameLower = String(name).trim().toLowerCase();
  const qs = await db.collection('drivers')
    .where('orgId', '==', oid).where('nameLower', '==', nameLower).limit(1).get();
  // Bewusst generische Fehlermeldung (keine Account-Enumeration)
  if (qs.empty) throw new HttpsError('permission-denied', 'Name oder PIN falsch');

  const ref = qs.docs[0].ref;
  const d = qs.docs[0].data();
  if (d.active === false) throw new HttpsError('permission-denied', 'Konto deaktiviert');
  if (d.lockedUntil && d.lockedUntil > nowMs())
    throw new HttpsError('resource-exhausted', 'Zu viele Versuche — bitte später erneut');

  if (!verifyPin(pin, d.pinSalt, d.pinHash)) {
    const fails = (d.failedAttempts || 0) + 1;
    const upd = fails >= MAX_FAILS
      ? { failedAttempts: 0, lockedUntil: nowMs() + LOCK_MS }
      : { failedAttempts: fails };
    await ref.update(upd);
    throw new HttpsError('permission-denied', 'Name oder PIN falsch');
  }

  await ref.update({ failedAttempts: 0, lockedUntil: 0, lastLogin: new Date().toISOString() });
  const personRole = d.role || 'fahrer';
  const personCap = await capForRole(personRole);
  const uid = 'drv_' + ref.id;
  const token = await admin.auth().createCustomToken(uid, {
    orgId: oid, role: personRole, cap: personCap, driverId: ref.id, name: d.name,
  });
  return { token, driverId: ref.id, name: d.name, orgId: oid, role: personRole };
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
  const cap = await capForRole(newRole);
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
  const cap = await capForRole(newRole);
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
