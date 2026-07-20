// ─────────────────────────────────────────────────────────────────────────────
// Mandanten-Backup / -Restore (mandantengenau, ohne andere Kunden anzufassen).
//
// Sichert bzw. stellt ALLE Daten EINES Mandanten (orgId) wieder her:
//   • orgs/{orgId}                         (+ Untercollections, z. B. roles)
//   • projects/* mit orgId==X              (+ ALLE Untercollections: trees, tours,
//                                           routes, reasons, tourHistory, arten, …)
//   • drivers / leistungsereignisse / messages / recipients / users  (orgId==X)
// Global-Collections (config, appsettings, usage, errors, presence, tokens,
// availability) werden BEWUSST NICHT angefasst — sie sind nicht mandantengebunden.
//
// AUTH: Service-Account-Schlüssel (JSON) aus Firebase Console → Projekteinstellungen
//   → Dienstkonten → „Neuen privaten Schlüssel generieren". Pfad übergeben via
//   --key <datei.json>  ODER  Umgebungsvariable GOOGLE_APPLICATION_CREDENTIALS.
//
// AUFRUFE:
//   node scripts/tenant-backup.mjs list --key sa.json
//   node scripts/tenant-backup.mjs export  --org <orgId> --key sa.json [--out backups]
//   node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key sa.json        (Dry-Run)
//   node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key sa.json --yes  (schreibt)
//   node scripts/tenant-backup.mjs restore --file … --key sa.json --yes --prune             (löscht auch neuere Docs)
//
// 7-TAGE-PITR (unvorhergesehener Vorfall, keine frische Sicherung vorhanden):
//   In der Firebase Console / gcloud die DB per Point-in-Time auf einen Zeitpunkt der
//   letzten 7 Tage in eine NEUE Datenbank klonen (z. B. Name "recovered"), dann:
//     node scripts/tenant-backup.mjs export --org <orgId> --database recovered --key sa.json
//   und die erzeugte Datei mit `restore` in die Live-DB zurückspielen.
// ─────────────────────────────────────────────────────────────────────────────
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const { Firestore, Timestamp, GeoPoint, DocumentReference } =
  require(join(__dirname, '..', 'functions', 'node_modules', '@google-cloud', 'firestore'));

const PROJECT_ID = 'baumbewaesserung';
// Mandantengebundene Top-Level-Collections (Abfrage where orgId==X). Bewusst NICHT dabei:
const ORG_SCOPED = ['drivers', 'leistungsereignisse', 'messages', 'recipients', 'users', 'availability'];
// Bewusst NICHT gesichert: config/appsettings (global), usage/errors (Telemetrie), presence/tokens
// (flüchtig, regenerieren sich), roles (top-level = Legacy-Global; die aktiven Rollen liegen mandanten-
// scharf unter orgs/{org}/roles und werden rekursiv miterfasst).
const SKIPPED_GLOBAL = ['config', 'appsettings', 'usage', 'errors', 'presence', 'tokens', 'roles'];

// ── Argumente ──
const argv = process.argv.slice(2);
const mode = argv[0];
function opt(name) { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; return (v && !v.startsWith('--')) ? v : true; }
function flag(name) { return argv.includes(name); }
function die(msg) { console.error('✗ ' + msg); process.exit(1); }

const keyFile = (typeof opt('--key') === 'string') ? opt('--key') : process.env.GOOGLE_APPLICATION_CREDENTIALS;
const databaseId = (typeof opt('--database') === 'string') ? opt('--database') : undefined;

function makeDb() {
  const cfg = { projectId: PROJECT_ID };
  if (keyFile) cfg.keyFilename = resolve(keyFile);
  if (databaseId) cfg.databaseId = databaseId;
  const db = new Firestore(cfg);
  return db;
}

// ── (De)serialisierung: Firestore-Typen ↔ JSON (verlustfrei) ──
function enc(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Timestamp) return { __t: 'ts', s: v.seconds, n: v.nanoseconds };
  if (v instanceof GeoPoint) return { __t: 'geo', lat: v.latitude, lng: v.longitude };
  if (v instanceof DocumentReference) return { __t: 'ref', path: v.path };
  if (Buffer.isBuffer(v)) return { __t: 'b64', b: v.toString('base64') };
  if (Array.isArray(v)) return v.map(enc);
  if (typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = enc(v[k]); return o; }
  return v;
}
function dec(v, db) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(x => dec(x, db));
  if (v.__t === 'ts') return new Timestamp(v.s, v.n);
  if (v.__t === 'geo') return new GeoPoint(v.lat, v.lng);
  if (v.__t === 'ref') return db.doc(v.path);
  if (v.__t === 'b64') return Buffer.from(v.b, 'base64');
  const o = {}; for (const k of Object.keys(v)) o[k] = dec(v[k], db); return o;
}

// ── Rekursiver Dump eines Dokuments inkl. aller Untercollections ──
async function dumpDoc(docSnap) {
  const node = { data: enc(docSnap.data() || {}), sub: {} };
  const subs = await docSnap.ref.listCollections();
  for (const c of subs) {
    const cs = await c.get();
    const m = {};
    for (const d of cs.docs) m[d.id] = await dumpDoc(d);
    node.sub[c.id] = m;
  }
  return node;
}
function countNode(node) {
  let n = 1;
  for (const col of Object.keys(node.sub || {})) for (const id of Object.keys(node.sub[col])) n += countNode(node.sub[col][id]);
  return n;
}

// ── Sammel-Writer (Batch-Grenze 400) ──
class Writer {
  constructor(db) { this.db = db; this.batch = db.batch(); this.n = 0; this.total = 0; }
  async set(ref, data) { this.batch.set(ref, data); this.total++; if (++this.n >= 400) await this.flush(); }
  async del(ref) { this.batch.delete(ref); this.total++; if (++this.n >= 400) await this.flush(); }
  async flush() { if (this.n) { await this.batch.commit(); this.batch = this.db.batch(); this.n = 0; } }
}

async function writeNode(db, w, ref, node) {
  await w.set(ref, dec(node.data, db));
  for (const col of Object.keys(node.sub || {})) {
    for (const id of Object.keys(node.sub[col])) {
      await writeNode(db, w, ref.collection(col).doc(id), node.sub[col][id]);
    }
  }
}

// ── LIST ──
async function doList() {
  const db = makeDb();
  const orgs = await db.collection('orgs').get();
  const projs = await db.collection('projects').get();
  const byOrg = {};
  projs.forEach(p => { const o = p.data().orgId || '(ohne)'; byOrg[o] = (byOrg[o] || 0) + 1; });
  console.log('Mandanten (orgs):');
  orgs.forEach(o => console.log(`  ${o.id}  ·  ${o.data().name || '(kein Name)'}  ·  Projekte: ${byOrg[o.id] || 0}`));
  const orphan = Object.keys(byOrg).filter(o => !orgs.docs.find(d => d.id === o));
  if (orphan.length) console.log('  ⚠ Projekte mit orgId ohne orgs-Doc:', orphan.join(', '));
}

// ── EXPORT ──
async function doExport() {
  const org = opt('--org');
  if (!org || org === true) die('--org <orgId> erforderlich (Liste: `list`)');
  const db = makeDb();
  const bundle = {
    meta: { orgId: org, exportedAt: new Date().toISOString(), database: databaseId || '(default)', project: PROJECT_ID, tool: 'tenant-backup/1' },
    org: null, projects: {}, topLevel: {},
  };
  const orgSnap = await db.collection('orgs').doc(org).get();
  bundle.org = orgSnap.exists ? await dumpDoc(orgSnap) : null;

  const projs = await db.collection('projects').where('orgId', '==', org).get();
  for (const p of projs.docs) bundle.projects[p.id] = await dumpDoc(p);

  for (const col of ORG_SCOPED) {
    const qs = await db.collection(col).where('orgId', '==', org).get();
    const m = {}; for (const d of qs.docs) m[d.id] = await dumpDoc(d);
    bundle.topLevel[col] = m;
  }

  const outDir = (typeof opt('--out') === 'string') ? opt('--out') : join(__dirname, '..', 'backups');
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${org}_${bundle.meta.exportedAt.replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(bundle));

  let projDocs = 0; for (const id of Object.keys(bundle.projects)) projDocs += countNode(bundle.projects[id]);
  console.log(`✓ Export Mandant „${org}" (DB ${bundle.meta.database})`);
  console.log(`  orgs-Doc:          ${bundle.org ? 'ja' : 'FEHLT (kein orgs/' + org + ')'}`);
  console.log(`  projects:          ${Object.keys(bundle.projects).length} (inkl. Untercollections: ${projDocs} Docs)`);
  for (const col of ORG_SCOPED) console.log(`  ${col.padEnd(18)} ${Object.keys(bundle.topLevel[col]).length}`);
  console.log(`  NICHT enthalten (global): ${SKIPPED_GLOBAL.join(', ')}`);
  console.log(`  → ${file}`);
}

// ── RESTORE ──
async function doRestore() {
  const file = opt('--file');
  if (!file || file === true) die('--file <pfad> erforderlich');
  const bundle = JSON.parse(readFileSync(resolve(file), 'utf8'));
  const org = bundle.meta?.orgId;
  if (!org) die('Datei enthält keine meta.orgId — abgebrochen.');
  const db = makeDb();
  const doWrite = flag('--yes');
  const prune = flag('--prune');

  let projDocs = 0; for (const id of Object.keys(bundle.projects || {})) projDocs += countNode(bundle.projects[id]);
  console.log(`Restore-Plan — Mandant „${org}"  →  DB ${databaseId || '(default)'}  (Projekt ${PROJECT_ID})`);
  console.log(`  Sicherung vom:     ${bundle.meta.exportedAt}`);
  console.log(`  orgs-Doc:          ${bundle.org ? 'ja' : 'nein'}`);
  console.log(`  projects:          ${Object.keys(bundle.projects || {}).length} (${projDocs} Docs inkl. Untercollections)`);
  for (const col of ORG_SCOPED) console.log(`  ${col.padEnd(18)} ${Object.keys(bundle.topLevel?.[col] || {}).length}`);
  console.log(`  Modus:             ${doWrite ? 'SCHREIBEN' : 'DRY-RUN (nichts wird geschrieben)'}${prune ? ' + PRUNE (neuere Docs werden gelöscht)' : ''}`);

  if (!doWrite) { console.log('\nℹ Dry-Run. Zum tatsächlichen Zurückspielen `--yes` anhängen (und ggf. `--prune`).'); return; }

  const w = new Writer(db);
  if (bundle.org) await writeNode(db, w, db.collection('orgs').doc(org), bundle.org);
  for (const pid of Object.keys(bundle.projects || {})) await writeNode(db, w, db.collection('projects').doc(pid), bundle.projects[pid]);
  for (const col of ORG_SCOPED) for (const id of Object.keys(bundle.topLevel?.[col] || {})) await writeNode(db, w, db.collection(col).doc(id), bundle.topLevel[col][id]);
  await w.flush();
  console.log(`✓ Zurückgeschrieben: ${w.total} Schreibvorgänge.`);

  if (prune) {
    const p = new Writer(db);
    // projects dieses Mandanten, die NICHT in der Sicherung sind → löschen (inkl. Untercollections)
    const liveProjs = await db.collection('projects').where('orgId', '==', org).get();
    for (const lp of liveProjs.docs) if (!bundle.projects?.[lp.id]) await deleteRecursive(db, p, lp.ref);
    for (const col of ORG_SCOPED) {
      const live = await db.collection(col).where('orgId', '==', org).get();
      for (const d of live.docs) if (!bundle.topLevel?.[col]?.[d.id]) await deleteRecursive(db, p, d.ref);
    }
    await p.flush();
    console.log(`✓ Prune: ${p.total} Löschvorgänge (neuere/fremde Docs dieses Mandanten entfernt).`);
  }
  console.log('Fertig. Andere Mandanten wurden nicht berührt.');
}

async function deleteRecursive(db, w, ref) {
  const subs = await ref.listCollections();
  for (const c of subs) { const cs = await c.get(); for (const d of cs.docs) await deleteRecursive(db, w, d.ref); }
  await w.del(ref);
}

// ── Dispatch ──
(async () => {
  try {
    if (!keyFile && mode !== undefined) console.error('⚠ Kein Service-Account-Schlüssel (--key oder GOOGLE_APPLICATION_CREDENTIALS) — Zugriff scheitert vermutlich.');
    if (mode === 'list') await doList();
    else if (mode === 'export') await doExport();
    else if (mode === 'restore') await doRestore();
    else {
      console.log('Mandanten-Backup / -Restore\n');
      console.log('  node scripts/tenant-backup.mjs list    --key sa.json');
      console.log('  node scripts/tenant-backup.mjs export  --org <orgId> --key sa.json [--out backups] [--database <db>]');
      console.log('  node scripts/tenant-backup.mjs restore --file <datei.json> --key sa.json [--yes] [--prune] [--database <db>]');
      console.log('\nOhne --yes läuft restore als Dry-Run. Details im Datei-Kopf.');
    }
  } catch (e) {
    console.error('✗ Fehler:', e && (e.stack || e.message || e));
    process.exit(1);
  }
})();
