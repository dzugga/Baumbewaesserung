// ============================================================================
//  Backfill: orgId auf alle Bestandsdaten schreiben + orgs anlegen
//  Phase-1-Artefakt — wird von DIR ausgefuehrt (Admin-SDK, umgeht Rules).
//
//  Voraussetzung Credentials (eines von beiden):
//    - gcloud auth application-default login        (einfachster Weg), ODER
//    - $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\pfad\serviceAccount.json"
//
//  Ausfuehren (aus dem functions-Ordner, damit firebase-admin gefunden wird):
//    cd functions
//    node scripts/backfill-orgid.mjs            # DRY-RUN (zeigt nur an)
//    node scripts/backfill-orgid.mjs --apply    # schreibt wirklich
//    node scripts/backfill-orgid.mjs --apply --force   # auch schon gesetzte ueberschreiben
// ============================================================================
import admin from 'firebase-admin';

// ─── KONFIG: hier deine Zuordnung pflegen ───────────────────────────────────
const PROJECT_ID = 'baumbewaesserung';

// Mandanten, die angelegt werden (id frei waehlbar, code = Kuerzel fuer Fahrer-Login)
const ORGS = [
  { id: 'org_ruesselsheim',   name: 'Rüsselsheim',            code: 'RUESSEL' },
  { id: 'org_bad_rothenfelde', name: 'Bad Rothenfelde',       code: 'BADROTH' },
  { id: 'org_rheine',         name: 'Rheine',                 code: 'RHEINE'  },
];

// Projekt -> Mandant (Projekt-IDs aus dem Handoff; bei Bedarf anpassen/ergaenzen)
const PROJECT_ORG_MAP = {
  'Lumi5fkOU70s89XZf4Dv': 'org_ruesselsheim',     // Rüsselsheim (Echtdaten)
  'WDXQv3gb1gl2kuzsVSpj': 'org_bad_rothenfelde',  // Bad Rothenfelde (Test)
  '8iqStiWyrDx444Gq88uS': 'org_rheine',           // Rheine Papierkorbleerung
};

// Unterkollektionen, die orgId erhalten
const SUBCOLLECTIONS = ['trees', 'tours', 'routes', 'reasons', 'tourHistory'];
// ────────────────────────────────────────────────────────────────────────────

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const BATCH = 400;

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

function log(...a) { console.log(...a); }

async function commitInChunks(updates) {
  // updates: [{ ref, orgId }]
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    if (APPLY) {
      const batch = db.batch();
      slice.forEach((u) => batch.set(u.ref, { orgId: u.orgId }, { merge: true }));
      await batch.commit();
    }
    written += slice.length;
  }
  return written;
}

async function run() {
  log(`\n=== Backfill orgId  (${APPLY ? 'APPLY — schreibt!' : 'DRY-RUN — nur Anzeige'}${FORCE ? ', FORCE' : ''}) ===\n`);

  // 1) Orgs anlegen
  for (const o of ORGS) {
    log(`org  ${o.id}  "${o.name}"  code=${o.code}`);
    if (APPLY) {
      await db.collection('orgs').doc(o.id).set(
        { name: o.name, code: o.code, createdAt: new Date().toISOString() }, { merge: true });
    }
  }

  // 2) Projekte + Unterkollektionen
  let totalDocs = 0;
  const snap = await db.collection('projects').get();
  for (const proj of snap.docs) {
    const pid = proj.id;
    const orgId = PROJECT_ORG_MAP[pid];
    if (!orgId) { log(`\n⚠ Projekt ${pid} ("${proj.data().name || ''}") — NICHT im Mapping, übersprungen`); continue; }

    log(`\nProjekt ${pid} ("${proj.data().name || ''}") -> ${orgId}`);
    const updates = [];

    if (FORCE || proj.data().orgId !== orgId) updates.push({ ref: proj.ref, orgId });

    for (const sub of SUBCOLLECTIONS) {
      const subSnap = await proj.ref.collection(sub).get();
      let n = 0;
      subSnap.forEach((d) => {
        if (FORCE || d.data().orgId !== orgId) { updates.push({ ref: d.ref, orgId }); n++; }
      });
      log(`  ${sub}: ${subSnap.size} Dok., ${n} zu setzen`);
    }

    const w = await commitInChunks(updates);
    totalDocs += w;
    log(`  -> ${w} Dokumente ${APPLY ? 'geschrieben' : '(Dry-Run, würden geschrieben)'}`);
  }

  log(`\n=== Fertig: ${totalDocs} Dokumente ${APPLY ? 'geschrieben' : 'im Dry-Run'} ===`);
  if (!APPLY) log('Hinweis: Mit  --apply  wirklich schreiben.\n');
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
