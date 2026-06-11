// Screenshots für das Handbuch-Thema „Objekt-Symbole" (separat vom Haupt-Skript,
// damit die Baum-Demo-Screenshots unberührt bleiben).
// Voraussetzung: Demo-Login „Demo Admin"/135790 (org_demo_hb) + Projekt demo_symbole
// (icon 🗑️, Arten mit/ohne Symbol). Aufruf: node scripts/symbol-screenshots.mjs (Dev-Server :3001)
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'http://localhost:3001';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'handbuch');
mkdirSync(OUT, { recursive: true });
const CHROME = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean).find(p => existsSync(p));
if (!CHROME) { console.error('Chrome nicht gefunden'); process.exit(1); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--lang=de-DE'] });
try {
  const d = await browser.newPage();
  await d.setViewport({ width: 1440, height: 810, deviceScaleFactor: 1.5 });
  await d.goto(BASE + '/index.html', { waitUntil: 'networkidle2' });
  await d.waitForSelector('#login-name', { visible: true });
  await d.evaluate(() => {
    document.getElementById('login-name').value = 'Demo Admin';
    document.getElementById('login-pin').value = '135790';
    (document.getElementById('login-btn') || document.getElementById('btn-login')).click();
  });
  await d.waitForFunction(() => getComputedStyle(document.getElementById('project-screen')).display !== 'none', { timeout: 20000 });
  await d.evaluate(() => window.openProject('demo_symbole'));
  await d.waitForFunction(() => document.querySelectorAll('.leaflet-marker-icon').length >= 8, { timeout: 20000 });
  await sleep(1800);
  await d.screenshot({ path: join(OUT, 'symbole-karte.jpg'), type: 'jpeg', quality: 82 });
  console.log('✓ symbole-karte');

  await d.evaluate(() => { window.switchView('baeume'); window.switchBaeumeTab('arten'); });
  await d.waitForFunction(() => document.querySelectorAll('#baeume-arten tbody tr').length >= 3, { timeout: 15000 });
  await sleep(400);
  await d.screenshot({ path: join(OUT, 'symbole-arten.jpg'), type: 'jpeg', quality: 82 });
  console.log('✓ symbole-arten');

  await d.evaluate(() => { const a = window.artenListFirstId ? null : null; });
  await d.evaluate(() => { const btn = document.querySelector('#baeume-arten tbody button'); if (btn) btn.click(); });
  await sleep(500);
  await d.screenshot({ path: join(OUT, 'symbole-picker.jpg'), type: 'jpeg', quality: 82 });
  console.log('✓ symbole-picker');
  await d.close();
  console.log('Fertig → public/handbuch/');
} finally {
  await browser.close();
}
