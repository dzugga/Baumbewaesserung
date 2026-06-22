// Smoke-Test: öffnet alle 5 Apps in einem unsichtbaren Browser und prüft, dass sie OHNE
// JavaScript-Fehler laden und sichtbar etwas rendern. Kein Login (keine echten Konten) —
// fängt v. a. „beim letzten Edit etwas Grundlegendes zerschossen" ab.
// Voraussetzung: Dev-Server läuft (npm run dev -- --port 3001).  Aufruf: npm run smoke
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  (process.env.LOCALAPPDATA || '') + '\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('✗ Chrome nicht gefunden (ggf. CHROME_PATH setzen).'); process.exit(1); }

const BASE = (process.env.SMOKE_URL || 'http://localhost:3001').replace(/\/$/, '');
const APPS = [
  { name: 'Desktop',       path: '/index.html',         sel: '#login-name' },
  { name: 'Fahrer-App',    path: '/mobil.html',         sel: 'input, button' },
  { name: 'Navi',          path: '/navi.html',          sel: 'input, button' },
  { name: 'Erfassung',     path: '/erfassung.html',     sel: 'input, button' },
  { name: 'Einsatzleiter', path: '/einsatzleiter.html', sel: 'input, button' },
];

// Bekanntes, folgenloses Headless-Rauschen (App Check/reCAPTCHA liefern headless kein gültiges
// Token; externe Kartenkacheln/Analytics können fehlschlagen) → kein Test-Fehler.
const IGNORE = /app[- ]?check|recaptcha|appcheck|firebase installations|favicon|net::ERR|Failed to load resource|ERR_BLOCKED|the server responded with a status/i;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Vorab: läuft der Server überhaupt?
try { const r = await fetch(BASE + '/index.html'); if (!r.ok) throw new Error('HTTP ' + r.status); }
catch (e) { console.error(`✗ Server ${BASE} nicht erreichbar (${e.message}). Bitte Dev-Server starten:  npm run dev -- --port 3001`); process.exit(1); }

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--lang=de-DE', '--no-sandbox', '--disable-gpu'] });
let failed = 0;

for (const app of APPS) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('JS-Ausnahme: ' + (e.message || e)));
  page.on('console', m => { if (m.type() === 'error') { const t = m.text(); if (!IGNORE.test(t)) errors.push('Konsolenfehler: ' + t); } });
  const probleme = [];
  try {
    const resp = await page.goto(BASE + app.path, { waitUntil: 'load', timeout: 25000 });
    if (!resp || !resp.ok()) probleme.push('Seite lädt nicht (HTTP ' + (resp ? resp.status() : '—') + ')');
    await sleep(3500); // async-Init abwarten (Firebase, Module)
    if (!(await page.$(app.sel))) probleme.push('Kein erwartetes Element (' + app.sel + ') — evtl. weißer Bildschirm');
    const len = await page.evaluate(() => ((document.body && document.body.innerText) || '').trim().length);
    if (len === 0) probleme.push('Seite ist leer (kein Text gerendert)');
  } catch (e) { probleme.push('Navigation/Render-Fehler: ' + (e.message || e)); }
  await page.close();

  const all = [...probleme, ...errors];
  if (all.length) { failed++; console.log(`✗ ${app.name}  (${app.path})`); all.forEach(x => console.log('    • ' + x)); }
  else console.log(`✓ ${app.name}  (${app.path})`);
}

await browser.close();
console.log('');
if (failed) { console.error(`✗ Smoke-Test: ${failed}/${APPS.length} App(s) mit Problemen — bitte vor dem Deploy prüfen.`); process.exit(1); }
console.log(`✓ Smoke-Test bestanden — alle ${APPS.length} Apps laden ohne Fehler.`);
