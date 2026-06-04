// Gemini-Proxy: hält den API-Key serverseitig geheim (als Secret GEMINI_KEY).
// Aufruf vom Frontend per POST /api/gemini  { prompt: "...", model?: "..." }
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const GEMINI_KEY = defineSecret('GEMINI_KEY');

exports.geminiAnalyse = onRequest(
  { region: 'us-central1', secrets: [GEMINI_KEY], cors: true, maxInstances: 5, timeoutSeconds: 120 },
  async (req, res) => {
    if (req.method !== 'POST') { res.status(405).json({ error: 'Nur POST erlaubt' }); return; }
    const prompt = (req.body && req.body.prompt) || '';
    const model = (req.body && req.body.model) || 'gemini-2.5-flash';
    if (!prompt) { res.status(400).json({ error: 'prompt fehlt' }); return; }
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY.value()}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      });
      const data = await r.json();
      if (!r.ok) {
        res.status(502).json({ error: 'Gemini-Fehler', detail: (data && data.error && data.error.message) || data });
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
