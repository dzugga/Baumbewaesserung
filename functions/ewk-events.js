// EWKFondsG — leitet aus einem Tour-Abschluss (tourHistory) unveränderliche Leistungsnachweise ab.
//
// Integrität: Menge/Ortslage stammen aus den AUTORITATIVEN tree-Docs (Planer-Stammdaten), NICHT aus dem
//   Fahrer-Snapshot → der Fahrer kann Länge/Fläche nicht fälschen (er meldet nur erledigt/nicht).
// Idempotent: feste Event-ID `${histId}_${treeId}` + .create() → kein Doppel-Nachweis bei Re-Trigger.
// Nur eindeutige Arten (Strecke/Fläche/Sinkkasten). Papierkorb (installiert/geleert offen, UBA) +
//   Abfall/Sensibilisierung bleiben MANUELL. Ohne ortslage kein Auto-Event (Datenqualität flaggt später).
// Schreibt per Admin-SDK (umgeht Rules bewusst; die append-only-Rules blockieren nur Client-Update/Delete).

const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
const { AUTO_LEISTUNGSARTEN, tarifVersionFuer, ewkLeistungsartOf, ewkMengeAusObjekt } = require('./ewk-derive');

const REGION = 'europe-west3';
const _num = v => (typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? parseFloat(v.replace(',', '.')) : NaN));
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

exports.onTourHistoryCreated = onDocumentCreated(
  { region: REGION, document: 'projects/{pid}/tourHistory/{histId}', maxInstances: 10 },
  async (event) => {
    const snap = event.data; if (!snap) return;
    const hist = snap.data() || {};
    const pid = event.params.pid, histId = event.params.histId;
    const db = admin.firestore();

    // Nur EWK-Projekte (ewkArtMap gesetzt)
    let orgId = hist.orgId || '', artMap = null;
    try {
      const proj = await db.collection('projects').doc(pid).get();
      if (!proj.exists) return;
      const pd = proj.data() || {};
      artMap = pd.ewkArtMap || null;
      if (!orgId) orgId = pd.orgId || '';
    } catch (e) { console.error('ewk: Projekt lesen', e); return; }
    if (!artMap || !orgId) return;

    // Erledigte Objekte aus dem Snapshot (WELCHE + WANN)
    const erledigt = (Array.isArray(hist.trees) ? hist.trees : []).filter(t => t && t.id && t.lastStatus === 'bewaessert');
    if (!erledigt.length) return;

    const dateStr = hist.date || (hist.closedAt ? String(hist.closedAt).slice(0, 10) : '');
    const tarifVersion = tarifVersionFuer(dateStr);
    const meldejahr = parseInt(String(dateStr).slice(0, 4), 10) || null;
    let zeitpunkt; try { zeitpunkt = hist.closedAt ? admin.firestore.Timestamp.fromDate(new Date(hist.closedAt)) : admin.firestore.Timestamp.now(); } catch (_) { zeitpunkt = admin.firestore.Timestamp.now(); }

    // Autoritative tree-Docs laden
    const treesCol = db.collection('projects').doc(pid).collection('trees');
    let treeById = new Map();
    try {
      const refs = erledigt.map(t => treesCol.doc(t.id));
      const docs = await db.getAll(...refs);
      docs.forEach(d => { if (d.exists) treeById.set(d.id, d.data()); });
    } catch (e) { console.error('ewk: trees lesen', e); return; }

    // Container-Mengen für Kinder ohne eigene Menge auflösen (Container = tree mit extId === child.containerExtId)
    const needExt = new Set();
    treeById.forEach(t => { if (t.containerExtId && !(_num(t.menge) > 0)) needExt.add(t.containerExtId); });
    const contByExt = new Map();
    if (needExt.size) {
      for (const grp of chunk([...needExt], 30)) {
        try {
          const qs = await treesCol.where('extId', 'in', grp).get();
          qs.forEach(d => { const dd = d.data(); if (dd && dd.extId) contByExt.set(dd.extId, dd); });
        } catch (e) { console.error('ewk: Container lesen', e); }
      }
    }

    let created = 0, skipped = 0;
    await Promise.all(erledigt.map(async (s) => {
      const tree = treeById.get(s.id); if (!tree) { skipped++; return; }
      const la = ewkLeistungsartOf(tree, artMap);
      if (!la || AUTO_LEISTUNGSARTEN.indexOf(la) < 0) { skipped++; return; }   // manuell / nicht zugeordnet
      const md = ewkMengeAusObjekt(tree, la, tree.containerExtId ? contByExt.get(tree.containerExtId) : null);
      if (!md) { skipped++; return; }
      const ortslage = tree.ortslage;
      if (ortslage !== 'innerorts' && ortslage !== 'ausserorts') { skipped++; return; }   // Pflicht → sonst kein Auto-Event
      const data = {
        orgId, projektId: pid, objektRef: `trees/${s.id}`,
        leistungsart: la, menge: md.menge, einheit: md.einheit, ortslage,
        meldejahr, zeitpunkt, serverAt: admin.firestore.FieldValue.serverTimestamp(),
        erfasstDurch: 'erledigt-meldung',
        quelleId: `tourHistory:${histId}#${s.id}`,
        tarifVersion, korrigiertVon: null,
      };
      try { await db.collection('leistungsereignisse').doc(`${histId}_${s.id}`).create(data); created++; }
      catch (e) {
        if (e && (e.code === 6 || e.code === 'already-exists')) { /* idempotent — Event existiert schon */ }
        else console.error('ewk: create', `${histId}_${s.id}`, e && e.message);
      }
    }));
    console.log(`ewk: tourHistory ${pid}/${histId} → ${created} Nachweise, ${skipped} übersprungen`);
  }
);
