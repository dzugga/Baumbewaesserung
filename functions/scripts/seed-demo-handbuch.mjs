// ============================================================================
//  Seed der DEMO-Umgebung fuer die Handbuch-Screenshots.
//  Legt Mandant, zwei PIN-Logins, Projekt mit Demo-Objekten/Touren/Meldungen
//  sowie ein Symbol-Demoprojekt an — idempotent (feste Doc-IDs, ueberschreibt).
//
//  Credentials wie bei den anderen functions/scripts (gcloud ADC ODER
//  GOOGLE_APPLICATION_CREDENTIALS auf einen Service-Konto-Schluessel).
//
//  Ausfuehren (aus functions/):
//    node scripts/seed-demo-handbuch.mjs          # anlegen/aktualisieren
//    node scripts/seed-demo-handbuch.mjs clean    # Demo-Umgebung wieder loeschen
//
//  Danach (aus dem Repo-Root, Dev-Server auf :3001):
//    node scripts/handbuch-screenshots.mjs
// ============================================================================
import admin from 'firebase-admin';
import crypto from 'node:crypto';

const PROJECT_ID = 'baumbewaesserung';
admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();

const ORG = 'org_demo_hb';
const PROJ = 'demo_handbuch';
const SYM = 'demo_symbole';

// PIN-Hash exakt wie functions/auth.js (scrypt, 16-Byte-Hex-Salt, 32-Byte-Key)
const makeSalt = () => crypto.randomBytes(16).toString('hex');
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
const driverDoc = (orgId, role, name, pin) => {
  const salt = makeSalt();
  return { orgId, role, name, nameLower: name.toLowerCase(), pinSalt: salt, pinHash: hashPin(pin, salt),
    active: true, failedAttempts: 0, lockedUntil: 0, createdAt: new Date().toISOString() };
};

// Datum-Helfer (lokaler Kalendertag)
const iso = (d) => d.toISOString();
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

// Kompakter Objekt-Cluster in Osnabrueck (damit die Karte Strassen zeigt)
const C = { lat: 52.2799, lng: 8.0472 };
const STR = ['Marktplatz', 'Herrenteichswall', 'Johannisstraße', 'Große Straße', 'Neumarkt', 'Hasestraße',
  'Redlingerstraße', 'Bierstraße', 'Krahnstraße', 'Lortzingstraße', 'Rolandsmauer', 'Kamp',
  'Dielingerstraße', 'Natruper Straße', 'Bergstraße', 'Möserstraße', 'Wittekindstraße'];
const STADTTEIL = ['Innenstadt', 'Innenstadt', 'Nordstadt', 'Westerberg'];

function demoTrees() {
  const out = [];
  for (let i = 1; i <= 28; i++) {
    const id = 'b' + String(i).padStart(2, '0');
    const hasCoord = i <= 25; // b26–b28 ohne Koordinaten → fuer die Erfassungs-Koordinatenliste
    const ang = (i * 137.5) * Math.PI / 180, rad = 0.0008 + (i % 6) * 0.0005;
    const lat = hasCoord ? +(C.lat + Math.cos(ang) * rad).toFixed(6) : null;
    const lng = hasCoord ? +(C.lng + Math.sin(ang) * rad * 1.5).toFixed(6) : null;
    let tourIds = [];
    if (i <= 12) tourIds = ['t_nord'];
    else if (i <= 24) tourIds = ['t_sued'];
    const t = {
      name: STR[(i - 1) % STR.length], stadtteil: STADTTEIL[i % STADTTEIL.length],
      art: 'Papierkorb', baumnr: String(100 + i), lat, lng,
      wasser: 'mittel', zustand: i % 7 === 0 ? 'schlecht' : 'gut',
      tourIds, tourId: tourIds[0] || '', baumId: 'B-' + String(i).padStart(5, '0'),
      orgId: ORG, aktiv: true, history: [], createdAt: iso(daysAgo(30)),
    };
    // Meldungen fuer Controlling/Dashboard/Soll-Ist (b01–b08, verteilt ueber die letzten Tage)
    if (i <= 8) {
      const erledigt = i <= 6;
      const when = daysAgo(i);
      const entry = { at: iso(when), date: ymd(when), status: erledigt ? 'bewaessert' : 'nicht',
        reason: erledigt ? null : (i === 7 ? 'Zugang gesperrt' : 'Behälter defekt'),
        note: erledigt ? 'Erledigt' : 'Nicht erledigt', driver: 'Max Muster',
        fuellgrad: erledigt ? [0, 25, 50, 75, 100, 50][i % 6] : undefined };
      if (entry.fuellgrad === undefined) delete entry.fuellgrad;
      t.history = [entry];
      t.lastStatus = entry.status; t.lastReason = entry.reason; t.lastNote = entry.note;
      t.lastDriver = 'Max Muster'; t.lastReportAt = entry.at;
      if (entry.fuellgrad !== undefined) t.lastFuellgrad = entry.fuellgrad;
    }
    out.push({ id, data: t });
  }
  return out;
}

async function seed() {
  const B = db.bulkWriter();
  // Mandant
  B.set(db.doc(`orgs/${ORG}`), { name: 'Demo Handbuch', code: 'DEMOHB' }, { merge: true });
  // Logins
  // Superadmin, damit auch die Superadmin-Ansichten (Auto-Planung, Pilot-Bereich, System &
  // Compliance, Mandanten …) fuer die Screenshots sichtbar sind. NACH den Screenshots loeschen!
  B.set(db.doc('drivers/demo_admin_hb'), driverDoc(ORG, 'superadmin', 'Demo Admin', '135790'));
  B.set(db.doc('drivers/demo_fahrer_hb'), driverDoc(ORG, 'fahrer', 'Max Muster', '246800'));

  // Projekt
  const trees = demoTrees();
  B.set(db.doc(`projects/${PROJ}`), {
    name: 'Demo Handbuch', orgId: ORG, treeCount: trees.length, tourCount: 2,
    depot: { lat: C.lat, lng: C.lng, address: 'Betriebshof Demo' }, depotMode: 'round',
    orsKey: '', fuellgradAktiv: true, icon: '🗑️', createdAt: iso(daysAgo(30)),
  }, { merge: true });
  // Touren (mit Betriebstagen Mo–Fr, Fahrer zugewiesen)
  B.set(db.doc(`projects/${PROJ}/tours/t_nord`), { name: 'Tour Nord', color: '#2563eb', orgId: ORG,
    drivers: ['Max Muster'], betriebstage: [1, 2, 3, 4, 5], interval: '', startDate: '', createdAt: iso(daysAgo(30)) });
  B.set(db.doc(`projects/${PROJ}/tours/t_sued`), { name: 'Tour Süd', color: '#16a34a', orgId: ORG,
    drivers: ['Max Muster'], betriebstage: [1, 2, 3, 4, 5], interval: '', startDate: '', createdAt: iso(daysAgo(30)) });
  // Objekte
  for (const t of trees) B.set(db.doc(`projects/${PROJ}/trees/${t.id}`), t.data);
  // Abgeschlossene Tour (fuer Controlling/Dashboard)
  const snapTrees = trees.filter(t => t.id <= 'b08' && t.data.lat).map(t => ({
    id: t.id, baumnr: t.data.baumnr, name: t.data.name, stadtteil: t.data.stadtteil, art: t.data.art,
    lat: t.data.lat, lng: t.data.lng, lastStatus: t.data.lastStatus, lastReason: t.data.lastReason || null,
    lastNote: t.data.lastNote || null, lastDriver: 'Max Muster', lastReportAt: t.data.lastReportAt,
  }));
  const bew = snapTrees.filter(t => t.lastStatus === 'bewaessert').length;
  const nicht = snapTrees.filter(t => t.lastStatus === 'nicht').length;
  B.set(db.doc(`projects/${PROJ}/tourHistory/th_nord_1`), {
    orgId: ORG, tourId: 't_nord', tourName: 'Tour Nord', date: ymd(daysAgo(1)), closedAt: iso(daysAgo(1)),
    closedBy: 'Max Muster', stats: { total: 8, bewaessert: bew, nicht, offen: 8 - bew - nicht }, trees: snapTrees,
  });
  // Standard-Gruende (fuer die Grund-Chips in der Fahrer-App)
  ['Zugang gesperrt', 'Behälter defekt', 'Witterung', 'Sonstiges'].forEach((text, i) =>
    B.set(db.doc(`projects/${PROJ}/reasons/r${i}`), { text, orgId: ORG }));

  // Symbol-Demoprojekt (fuer symbol-screenshots.mjs)
  B.set(db.doc(`projects/${SYM}`), { name: 'Demo Symbole', orgId: ORG, icon: '🗑️', depotMode: 'round',
    treeCount: 6, tourCount: 0, orsKey: '', createdAt: iso(daysAgo(30)) }, { merge: true });
  B.set(db.doc(`projects/${SYM}/arten/a_pk`), { name: 'Papierkorb', icon: '🗑️', orgId: ORG });
  B.set(db.doc(`projects/${SYM}/arten/a_hund`), { name: 'Beutelspender', icon: '🐕', orgId: ORG });
  B.set(db.doc(`projects/${SYM}/arten/a_halt`), { name: 'Haltestelle', orgId: ORG }); // ohne Symbol → Projekt-Standard
  for (let i = 1; i <= 6; i++) {
    const ang = (i * 120) * Math.PI / 180;
    B.set(db.doc(`projects/${SYM}/trees/s${i}`), {
      name: STR[i], stadtteil: 'Innenstadt', art: ['Papierkorb', 'Beutelspender', 'Haltestelle'][i % 3],
      baumnr: String(i), lat: +(C.lat + Math.cos(ang) * 0.0012).toFixed(6), lng: +(C.lng + Math.sin(ang) * 0.0018).toFixed(6),
      tourIds: [], tourId: '', baumId: 'S-' + String(i).padStart(5, '0'), orgId: ORG, aktiv: true, history: [], createdAt: iso(daysAgo(30)),
    });
  }

  await B.close();
  console.log('✓ Demo-Umgebung angelegt:');
  console.log('  Mandant  org_demo_hb (Code DEMOHB)');
  console.log('  Logins   „Demo Admin" / 135790   ·   „Max Muster" / 246800');
  console.log('  Projekte demo_handbuch (' + trees.length + ' Objekte, 2 Touren, Meldungen) · demo_symbole');
}

async function clean() {
  for (const p of [PROJ, SYM]) await db.recursiveDelete(db.doc(`projects/${p}`));
  await db.doc('drivers/demo_admin_hb').delete().catch(() => {});
  await db.doc('drivers/demo_fahrer_hb').delete().catch(() => {});
  await db.recursiveDelete(db.doc(`orgs/${ORG}`));
  console.log('✓ Demo-Umgebung gelöscht.');
}

const mode = process.argv[2] === 'clean' ? clean : seed;
mode().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
