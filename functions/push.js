// Geräte-Push (FCM) beim Anlegen einer Postfach-Empfangsquittung.
// Trigger je recipient-Doc (deckt auch gechunkte Batches ab). admin ist via index.js/auth.js initialisiert.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');

const REGION = 'europe-west3';

exports.onMessageRecipientCreated = onDocumentCreated(
  { region: REGION, document: 'messages/{msgId}/recipients/{driverId}', maxInstances: 10 },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const rec = snap.data() || {};
    const orgId = rec.orgId, driverId = rec.driverId;
    if (!orgId || !driverId) return;

    const db = admin.firestore();

    // Mandanten-Schalter: nur senden, wenn pushEnabled aktiv ist
    try {
      const org = await db.collection('orgs').doc(orgId).get();
      if (!org.exists || org.data().pushEnabled !== true) return;
    } catch (e) { return; }

    // Tokens des Fahrers laden
    const tokSnap = await db.collection('drivers').doc(driverId).collection('tokens').get();
    const docs = tokSnap.docs.filter(d => d.data() && d.data().token);
    const tokens = docs.map(d => d.data().token);
    if (!tokens.length) return;

    const title = rec.title || 'Neue Nachricht';
    const body = rec.body || (rec.type === 'task' ? 'Neue Aufgabe' : 'Neue Information');
    const message = {
      tokens,
      notification: { title, body },
      webpush: {
        notification: { title, body },
        fcmOptions: { link: 'https://baumbewaesserung.web.app/mobil.html' }
      },
      data: { msgId: String(rec.msgId || ''), type: String(rec.type || 'info') }
    };

    try {
      const resp = await admin.messaging().sendEachForMulticast(message);
      // Ungültige Tokens aufräumen
      const stale = [];
      resp.responses.forEach((r, i) => {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token' ||
              code === 'messaging/invalid-argument') {
            stale.push(docs[i].ref);
          }
        }
      });
      await Promise.all(stale.map(ref => ref.delete().catch(() => {})));
    } catch (e) {
      console.error('FCM-Versand fehlgeschlagen', e);
    }
  }
);
