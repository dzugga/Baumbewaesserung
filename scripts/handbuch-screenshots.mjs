// Erzeugt die Handbuch-Screenshots automatisiert (Demo-Daten erforderlich, siehe unten).
// Aufruf:  node scripts/handbuch-screenshots.mjs   (Dev-Server muss auf :3001 laufen)
// Voraussetzung: Demo-Mandant org_demo_hb mit Projekt demo_handbuch und den Logins
//   „Demo Admin"/135790 (orgadmin) und „Max Muster"/246800 (fahrer).
// Bilder landen in public/handbuch/ und werden mit dem nächsten Deploy ausgeliefert.
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:3001';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'handbuch');
mkdirSync(OUT, { recursive: true });

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: join(OUT, name + '.jpg'), type: 'jpeg', quality: 82 });

// FESTER App-Check-Debug-Token: App Check schuetzt inzwischen den Login. Damit der Headless-Browser
// nicht bei jedem Lauf einen neuen (nicht registrierten) Zufalls-Token erzeugt, injizieren wir vor
// dem Laden IMMER denselben Token. Dieser eine Token muss EINMAL in der Firebase-Konsole unter
// App Check → Apps → „Debug-Tokens verwalten" hinterlegt werden (siehe Skript-Kopf / README).
const APPCHECK_DEBUG_TOKEN = process.env.APPCHECK_DEBUG_TOKEN || '5b0c7e2a-4f1d-4e9a-9c3b-8a2f6d1e0c74';
// Neue Seite mit vorab gesetztem Debug-Token (appcheck.js respektiert einen bereits gesetzten Wert).
async function newPage() {
  const p = await browser.newPage();
  await p.evaluateOnNewDocument(t => { self.FIREBASE_APPCHECK_DEBUG_TOKEN = t; }, APPCHECK_DEBUG_TOKEN);
  return p;
}

// Auf eine Bedingung im Browser warten
async function waitFor(page, fn, timeout = 15000) {
  await page.waitForFunction(fn, { timeout });
}

async function loginPin(page, name, pin) {
  await page.waitForSelector('#login-name', { visible: true });
  await page.evaluate((n, p) => {
    document.getElementById('login-name').value = n;
    document.getElementById('login-pin').value = p;
    (document.getElementById('btn-login') || document.getElementById('login-btn')).click();
  }, name, pin);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--lang=de-DE'] });

try {
  // ── DESKTOP (1440×810) ─────────────────────────────────────────────────────
  const d = await newPage();
  await d.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1.5 });
  await d.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
  await loginPin(d, 'Demo Admin', '135790');
  await waitFor(d, () => getComputedStyle(document.getElementById('project-screen')).display !== 'none');
  await d.evaluate(() => window.openProject('demo_handbuch'));
  await waitFor(d, () => document.querySelectorAll('.leaflet-marker-icon').length >= 20, 20000);
  await sleep(1800); // Kartenkacheln nachladen
  await shot(d, 'desktop-karte');                              console.log('✓ desktop-karte');

  await d.evaluate(() => window.openDetail('b02'));
  await sleep(700);
  await shot(d, 'desktop-detail');                             console.log('✓ desktop-detail');
  await d.evaluate(() => window.closePanel());

  await d.evaluate(() => window.switchView('baeume'));
  await sleep(700);
  await shot(d, 'desktop-baeume');                             console.log('✓ desktop-baeume');

  await d.evaluate(() => window.switchView('touren'));
  await sleep(900);
  await shot(d, 'desktop-touren');                             console.log('✓ desktop-touren');

  await d.evaluate(() => window.switchView('controlling'));
  await sleep(2200); // tourHistory + Charts
  await shot(d, 'desktop-controlling');                        console.log('✓ desktop-controlling');

  await d.evaluate(() => window.switchView('benutzer'));
  await sleep(1500);
  await shot(d, 'desktop-benutzer');                           console.log('✓ desktop-benutzer');

  await d.evaluate(() => { window.switchView('handbuch'); });
  await sleep(500);
  await shot(d, 'desktop-handbuch');                           console.log('✓ desktop-handbuch');

  // ── Weitere Desktop-Ansichten (Superadmin, Projekt offen) — resilient ──
  const viewShot = async (view, name, wait = 1400) => {
    try { await d.evaluate(v => window.switchView(v), view); await sleep(wait); await shot(d, name); console.log('✓ ' + name); }
    catch (e) { console.log('⚠ ' + name + ' übersprungen: ' + (e.message || e)); }
  };
  await viewShot('dashboard', 'desktop-dashboard', 2600);
  await viewShot('sollist', 'desktop-sollist', 1800);
  await viewShot('datenqualitaet', 'desktop-datenqualitaet', 1600);
  await viewShot('ausfaelle', 'desktop-ausfaelle', 1600);
  await viewShot('ki', 'desktop-ki', 1400);
  await viewShot('autoplan', 'desktop-autoplan', 1600);
  await viewShot('einsatzplaner', 'desktop-einsatzplaner', 2200);
  await viewShot('disposition', 'desktop-disposition', 2200);
  await viewShot('nachrichten', 'desktop-nachrichten', 1600);
  await viewShot('wmskarten', 'desktop-wms', 1400);
  await viewShot('mandanten', 'desktop-mandanten', 1600);
  await viewShot('usage', 'desktop-usage', 1600);
  await viewShot('systeminfo', 'desktop-systeminfo', 1800);

  // Felder & Listen (Reiter in der Objekte-Ansicht)
  try { await d.evaluate(() => { window.switchView('baeume'); window.switchBaeumeTab && window.switchBaeumeTab('arten'); }); await sleep(1400); await shot(d, 'desktop-felder'); console.log('✓ desktop-felder'); }
  catch (e) { console.log('⚠ desktop-felder übersprungen: ' + (e.message || e)); }

  // Modale/Dialoge
  const modalShot = async (open, name, close, wait = 900) => {
    try { await d.evaluate(open); await sleep(wait); await shot(d, name); console.log('✓ ' + name); if (close) await d.evaluate(close); await sleep(300); }
    catch (e) { console.log('⚠ ' + name + ' übersprungen: ' + (e.message || e)); }
  };
  await modalShot(() => window.openSettings(), 'desktop-einstellungen', () => window.closeSettings());
  await modalShot(() => window.openPilotScope(), 'desktop-pilot', () => window.closePilot());
  await modalShot(() => window.openTourModal('t_nord'), 'desktop-tour', () => window.closeTourModal(), 1100);

  // Karten-Werkzeuge (Filter-Panel, Kontrolle-Menü)
  try { await d.evaluate(() => window.switchView('karte')); await sleep(1200);
    await d.evaluate(() => window.toggleMapFilter()); await sleep(700); await shot(d, 'desktop-filter'); console.log('✓ desktop-filter');
    await d.evaluate(() => window.toggleMapFilter()); await sleep(300);
  } catch (e) { console.log('⚠ desktop-filter übersprungen: ' + (e.message || e)); }

  await d.close();

  // ── FAHRER-APP (Mobil-Format 414×860) ──────────────────────────────────────
  const m = await newPage();
  await m.setViewport({ width: 414, height: 860, deviceScaleFactor: 2 });
  await m.goto(BASE + '/mobil.html', { waitUntil: 'networkidle2' });
  await loginPin(m, 'Max Muster', '246800');
  // Tour-Auswahl erscheint (2 Touren zugeordnet)
  await waitFor(m, () => {
    const g = document.getElementById('login-tour-group');
    return g && getComputedStyle(g).display !== 'none' && document.querySelectorAll('#login-tour option').length > 1;
  }, 20000);
  await m.evaluate(() => {
    const s = document.getElementById('login-tour');
    s.value = s.querySelectorAll('option')[1].value;
  });
  await m.click('#btn-login');
  await waitFor(m, () => document.querySelectorAll('.leaflet-marker-icon').length >= 5, 25000);
  await sleep(1800);
  await shot(m, 'mobil-karte');                                console.log('✓ mobil-karte');

  await m.click('#tab-btn-list');
  await sleep(600);
  await shot(m, 'mobil-liste');                                console.log('✓ mobil-liste');

  await m.evaluate(() => {
    const row = document.querySelector('.tree-row');
    if (row) row.click();
  });
  await sleep(700);
  await m.evaluate(() => { const b = document.getElementById('btn-nok'); if (b) b.click(); }); // Grund-Chips zeigen
  await sleep(500);
  await shot(m, 'mobil-detail');                               console.log('✓ mobil-detail');
  await m.close();

  // ── ERFASSUNGS-APP ──────────────────────────────────────────────────────────
  const e = await newPage();
  await e.setViewport({ width: 414, height: 860, deviceScaleFactor: 2 });
  await e.goto(BASE + '/erfassung.html', { waitUntil: 'networkidle2' });
  await loginPin(e, 'Demo Admin', '135790');
  await waitFor(e, () => {
    const g = document.getElementById('lg-project');
    return g && getComputedStyle(g).display !== 'none' && document.querySelectorAll('#login-project option').length > 1;
  }, 20000);
  await e.evaluate(() => { document.getElementById('login-project').value = 'demo_handbuch'; });
  await e.click('#btn-login');
  await waitFor(e, () => document.querySelectorAll('.koord-item').length >= 2, 25000);
  await sleep(800);
  await shot(e, 'erfassung-koord');                            console.log('✓ erfassung-koord');

  await e.click('#tab-neu');
  await sleep(1200);
  await e.click('#btn-erfassen');
  await sleep(700);
  await shot(e, 'erfassung-neu');                              console.log('✓ erfassung-neu');
  await e.close();

  // ── EINSATZLEITER ───────────────────────────────────────────────────────────
  const l = await newPage();
  await l.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1.5 });
  await l.goto(BASE + '/einsatzleiter.html', { waitUntil: 'networkidle2' });
  // Auth besteht ggf. schon aus der vorigen App (gleicher Browser-Kontext) → dann direkt Projektwahl
  await waitFor(l, () => {
    const n = document.getElementById('login-name'), g = document.getElementById('lg-project');
    return (g && getComputedStyle(g).display !== 'none') || (n && n.offsetParent);
  }, 20000);
  const needsLogin = await l.evaluate(() => { const g = document.getElementById('lg-project'); return !(g && getComputedStyle(g).display !== 'none'); });
  if (needsLogin) await loginPin(l, 'Demo Admin', '135790');
  await waitFor(l, () => {
    const g = document.getElementById('lg-project');
    return g && getComputedStyle(g).display !== 'none' && document.querySelectorAll('#login-project option').length > 1;
  }, 20000);
  await l.evaluate(() => { document.getElementById('login-project').value = 'demo_handbuch'; });
  await l.click('#btn-login');
  await sleep(3500); // Listener + Charts
  await shot(l, 'einsatzleiter');                              console.log('✓ einsatzleiter');
  await l.close();

  console.log('Fertig → public/handbuch/');
} finally {
  await browser.close();
}
