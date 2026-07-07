// ============================================================================
//  Einmalige Migration: bestehendes Einzel-Projekt-Depot → erster Betriebshof.
//  Für jedes Projekt mit `depot.lat/lng`, das noch KEINEN Betriebshof mit
//  Koordinaten hat: lege einen Betriebshof-Werteliste-Eintrag (Name/Koords/Farbe)
//  an + stelle das Kundenfeld „betriebshof" (liste) sicher. Idempotent.
//  Objekte/Touren bleiben unangetastet (Routing fällt ohnehin aufs Depot zurück).
//
//    node scripts/migrate-depot-to-betriebshof.mjs           # DRY-RUN
//    node scripts/migrate-depot-to-betriebshof.mjs --apply
// ============================================================================
import admin from 'firebase-admin';
const APPLY = process.argv.includes('--apply');
admin.initializeApp({ projectId: 'baumbewaesserung' });
const db = admin.firestore();
const log = (...a) => console.log(...a);

log(`\n=== Depot → Betriebshof (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
const snap = await db.collection('projects').get();
let changed = 0;
for (const doc of snap.docs) {
  const d = doc.data();
  const dep = d.depot;
  const name = (d.name || doc.id);
  if (!dep || dep.lat == null || dep.lng == null) { continue; } // kein Einzel-Depot → nichts zu tun
  const cf = [...(d.customFields || [])];
  const lv = JSON.parse(JSON.stringify(d.listValues || {}));
  const bhList = lv.betriebshof || [];
  // Nur echte Einzel-Depot-Projekte: hat die Betriebshof-Liste schon Einträge, nicht anfassen
  // (z. B. Essen mit eigenen Betriebshof-Werten) → idempotent + keine Verwässerung.
  if (bhList.length) { log(`= ${name}: hat bereits ${bhList.length} Betriebshof-Eintrag/e — übersprungen`); continue; }
  const label = (dep.address && String(dep.address).trim()) || 'Betriebshof';
  const entry = { id: 'bh_' + Math.random().toString(36).slice(2, 10), label, lat: +dep.lat, lng: +dep.lng, address: dep.address || '', color: '#2d6a4f' };
  bhList.push(entry); lv.betriebshof = bhList;
  if (!cf.some(c => c.key === 'betriebshof')) cf.push({ key: 'betriebshof', label: 'Betriebshof', aktiv: true, type: 'liste' });
  log(`+ ${name}: Betriebshof „${label}" (${entry.lat.toFixed(5)}, ${entry.lng.toFixed(5)})${bhList.length > 1 ? ` — Liste hatte schon ${bhList.length - 1} Einträge` : ''}`);
  changed++;
  if (APPLY) await doc.ref.set({ customFields: cf, listValues: lv }, { merge: true });
}
log(`\n=== ${changed} Projekt(e) ${APPLY ? 'migriert' : '(Dry-Run)'} ===`);
if (!APPLY) log('Hinweis: mit --apply schreiben.\n');
process.exit(0);
