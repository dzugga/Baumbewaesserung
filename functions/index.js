// Gemini über Vertex AI – authentifiziert über den Service-Account des Projekts
// (Application Default Credentials), KEIN API-Key nötig.
// Aufruf vom Frontend per POST /api/gemini  { prompt: "...", model?: "..." }
const { onRequest } = require('firebase-functions/v2/https');

const PROJECT = 'baumbewaesserung';
const LOCATION = 'us-central1';
const DEFAULT_MODEL = 'gemini-2.5-flash';

// OAuth-Access-Token vom Metadata-Server holen (läuft in Cloud Functions/Run automatisch)
async function getAccessToken() {
  const r = await fetch(
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
    { headers: { 'Metadata-Flavor': 'Google' } }
  );
  if (!r.ok) throw new Error('Token-Abruf fehlgeschlagen: ' + r.status);
  const d = await r.json();
  return d.access_token;
}

exports.geminiAnalyse = onRequest(
  { region: LOCATION, cors: true, maxInstances: 5, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Nur POST erlaubt' }); return; }
    const prompt = (req.body && req.body.prompt) || '';
    const model = (req.body && req.body.model) || DEFAULT_MODEL;
    if (!prompt) { res.status(400).json({ error: 'prompt fehlt' }); return; }
    try {
      const token = await getAccessToken();
      const url = `https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${LOCATION}/publishers/google/models/${model}:generateContent`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }] }),
      });
      const data = await r.json();
      if (!r.ok) {
        res.status(502).json({ error: 'Vertex-Fehler', detail: (data && data.error && data.error.message) || data });
        return;
      }
      const parts = (data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
      const text = parts.map((p) => p.text || '').join('');
      res.json({ text });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  }
);
