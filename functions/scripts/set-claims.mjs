// ============================================================================
//  Bootstrap: Custom Claims {orgId, role} fuer einen Nutzer setzen.
//  Noetig fuer den ERSTEN Admin (setUserRole verlangt ja bereits einen Admin).
//
//  Voraussetzung: Nutzer existiert bereits in Firebase Auth (z. B. per E-Mail
//  angelegt). UID findest du in der Firebase-Konsole -> Authentication.
//
//  Credentials wie beim Backfill (gcloud ADC oder GOOGLE_APPLICATION_CREDENTIALS).
//
//  Ausfuehren (aus functions/):
//    node scripts/set-claims.mjs <UID> <orgId> <role>
//  Beispiele:
//    node scripts/set-claims.mjs abc123UID org_ruesselsheim superadmin
//    node scripts/set-claims.mjs def456UID org_rheine orgadmin
// ============================================================================
import admin from 'firebase-admin';

const PROJECT_ID = 'baumbewaesserung';
const [uid, orgId, role] = process.argv.slice(2);
const VALID = ['superadmin', 'orgadmin', 'planer', 'erfasser', 'fahrer'];

if (!uid || !orgId || !role) {
  console.error('Aufruf: node scripts/set-claims.mjs <UID> <orgId> <role>');
  process.exit(1);
}
if (!VALID.includes(role)) {
  console.error(`Ungültige Rolle "${role}". Erlaubt: ${VALID.join(', ')}`);
  process.exit(1);
}

admin.initializeApp({ projectId: PROJECT_ID });

const run = async () => {
  await admin.auth().setCustomUserClaims(uid, { orgId, role });
  await admin.firestore().collection('users').doc(uid).set(
    { orgId, role, updatedAt: new Date().toISOString() }, { merge: true });
  console.log(`✓ Claims gesetzt: uid=${uid}  orgId=${orgId}  role=${role}`);
  console.log('Hinweis: Der Nutzer muss sich neu anmelden (Token-Refresh), damit die Claims greifen.');
};

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
