# INFA / Baumbewässerung — Projekt-Handoff

> **Stand: 04.07.2026.** Dies ist die **einzige gültige Handoff-Fassung** — sie ersetzt alle älteren Stände.
> Bei widersprüchlichen Notizen/Erinnerungen gilt IMMER die hier datierte neueste Fassung.
> Im Zweifel gegen den echten Code/Live-Stand verifizieren, nicht raten.

---

## Projekt & Stack
- **Repo:** `C:\Users\mdzugga\Documents\GitHub\Baumbewaesserung` · GitHub `dzugga/Baumbewaesserung` · Branch `main`
- **Plattform:** Windows 11. Shells: PowerShell **und** Git-Bash (jeweils eigene Syntax). GPO: PowerShell = `AllSigned` → **unsignierte `.ps1` laufen NIE**; `npx.ps1` in PowerShell blockiert.
- **Build:** Vite → `npm run build` (→ `dist/`). Dev: `npm run dev -- --port 3001` (immer **3001**).
- **Hosting:** Firebase `baumbewaesserung`, live: https://baumbewaesserung.web.app.
- **Backend:** Firestore (compat SDK v10.12.0), Firebase Auth (E-Mail + Custom Token), Cloud Functions v2 **Node 22, europe-west3**, Storage, App Check (reCAPTCHA v3). **Alles europe-west3 (Frankfurt).**
- **Libs:** Leaflet 1.9.4 + basemap.de-Kacheln, OpenRouteService (Routing), Chart.js, SheetJS, Gemini (`geminiAnalyse`).

## Die 4 Apps
| App | HTML | JS |
|---|---|---|
| Desktop-Planer | `index.html` | `src/desktop.js` (~13k Z.) |
| Fahrer-App (inkl. Navi-Modus, Flag `naviEnabled`) | `mobil.html` | `src/mobile.js` |
| Erfassung | `erfassung.html` | `src/erfassung.js` |
| Einsatzleiter (Live) | `einsatzleiter.html` | `src/einsatzleiter.js` |
Geteilte Module: `src/firebase-config.js`, `src/esc.js` (Escape, im Desktop als `dlEsc`), `src/appcheck.js`, `src/objektrollen.js`, `src/driver-fields.js`, `src/version-check.js`.

## Befehle
- **Test:** `npm test` (Rules-Vertrag ↔ `driver-fields.js` **+** Inline-Handler-Allowlist-Check).
- **Build:** `npm run build`.
- **Smoke:** Preview auf :4173 starten, dann `SMOKE_URL=http://localhost:4173 node scripts/smoke.mjs` (headless, alle 4 Apps laden ohne JS-Fehler).
- **Deploy (nur via Git-Bash):** `npx --no-install firebase deploy --only hosting`. PowerShell kennt `firebase` nicht.
- **CI:** `.github/workflows/ci.yml` — Test + Build + Smoke bei Push/PR (Smoke wartet auf Element, 1 Retry).

## Auth & Mandanten
- **Login überall:** Stadt-Code + Name + PIN (`driverLogin` → Custom Token). Umschalter „Admin-Anmeldung (E-Mail)" für Planer/Admins. **Superadmin = `dzugga@infa.de`.**
- **Claims:** `{orgId, role, cap, name}`. `cap` (admin|editor|readonly|driver) steuert die Rules; `role` steuert UI-Module. BUILTIN_BASETYPE: superadmin/orgadmin→admin, planer/erfasser→editor, fahrer→driver.
- **PIN-Personen** in `drivers/{id}` `{orgId, name, nameLower, pinSalt, pinHash, role, active, failedAttempts, lockedUntil}` — Hash = `crypto.scryptSync(pin, salt, 32)` (16-Byte-Hex-Salt), exakt in `functions/auth.js`.
- **Rules scharf** (`firestore.rules`): Helfer `cap()/isSuper()/inOrg()/canManage/canPlan/onlyStatusFields()/onlyTourStatusFields()/onlyMessageStatusFields()`. orgId ist auf allen Docs denormalisiert (Rules ohne `get()`). Fahrer dürfen an Objekten NUR `onlyStatusFields`. Deploy: `firebase deploy --only firestore:rules` — **nur auf explizites Go.**
- **Mehrere Mandanten (wachsend),** je mit Stadt-Code. Konkrete Projekt-IDs/Objektzahlen bei Bedarf live prüfen (nicht aus alten Notizen übernehmen).

## Datenmodell (Firestore, Kurzform)
`orgs/{id}` · `users/{uid}` · `drivers/{id}` · `roles/{key}` · `projects/{pid}` (trägt alle Stadt-/Projekt-Einstellungen) mit Unterkollektionen `trees`, `tours`, `routes`, `reasons`, `arten`, `tourHistory`, **`planVarianten`** (Auto-Planung). Details siehe `CLAUDE.md` + Memory.

## ⚠ Nicht-offensichtliche Fallen (kosten sonst eine Sitzung)
1. **Deploy nur auf ausdrückliche Aufforderung.** Hosting per Deploy-Workflow; **Rules/Functions-Deploy braucht explizites Go.**
2. **Terminologie (verbindlich):** im **Handbuch UND in Commit-Betreffzeilen** niemals „Baum/Bäume/Bewässerung" → „Objekt(e)/Tätigkeit/Meldungen". Neue UI-Texte objekt-neutral.
3. **Neue Inline-`onclick`-Funktionen** MÜSSEN in die `Object.assign(window,{…})`-Allowlist in `desktop.js` — sonst stummer Klick. `npm test` prüft das jetzt.
4. **Nutzer-Rechner GPO `AllSigned`:** unsignierte `.ps1` laufen nie, `npx.ps1` in PowerShell blockiert → npx/Skripte über das **Bash-Tool** oder Docker-Befehle direkt; `firebase` nur via `npx --no-install firebase` in Bash.
5. **App Check schützt den Login:** Headless (Screenshots/Debug) braucht den festen Debug-Token `5b0c7e2a-4f1d-4e9a-9c3b-8a2f6d1e0c74` (in Firebase-Konsole registriert; das Screenshot-Skript injiziert ihn).
6. **Kein Login ins echte Konto.** Verifikation standardmäßig headless (Node-Tests + DOM-Checks). Für DB-Schreiben ohne Rules: Admin-Skripte in `functions/scripts/` (nutzen ADC/`GOOGLE_APPLICATION_CREDENTIALS`).
7. **Commit-Trailer:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
8. **Status-Keys `'bewaessert'`/`'nicht'` nie umbenennen.** Inline-CSS bevorzugt. JS-Logik in `src/*.js`, nicht im HTML.
9. **Handbuch-Screenshots** = 3 Schritte: `cd functions && node scripts/seed-demo-handbuch.mjs` → (Dev-Server :3001) `node scripts/handbuch-screenshots.mjs` → `node scripts/seed-demo-handbuch.mjs clean` (**löscht auch den temporären Superadmin-Demo-Login!**).

## Aktueller Zustand (04.07.2026)
- Software **zweimal komplett auditiert** (Funktions-/Plausibilitätsaudit, alle Befunde verifiziert, gefixt, deployt). Solide, testbereit.
- **Tour-Rhythmus neu:** Betriebstage (Mo–So ankreuzen) × Wochen-Rhythmus (jede/2./4. Woche) statt „täglich". `_tourWeeklyOcc` + `tourDueOn` konsistent.
- **Meldungs-Datenmodell** vereinheitlicht (jede Meldung `status`+`at`); alle Auswertungen zählen korrekt.
- **Pilot-Bereich** (Superadmin, Objektbestand je Projekt eingrenzen), **Auto-Planung** (Beta, VROOM-Varianten), **Archiv bereinigen** live.
- **Handbuch:** Bildabdeckung 13→30 Themen, Text mit Software abgeglichen.

## Offen / zurückgestellt
- **onclick-Injection-Härtung (K4):** systemischer Sweep (Werte in JS-String-Literalen) — kein konkret ausnutzbarer Fall gefunden, aber ausstehend.
- **App-Check-Erzwingung** je Dienst (aktuell Monitoring), Functions-Deploy Passwort-Mindestlänge, restliche Rules-Härtung → alle auf explizites Go.
- **Tourenplaner-Stack** (OSRM+VROOM, `docker/`, lokal Port 5010): läuft lokal, Cloud-Run-Produktivbetrieb noch offen.

## Wo die Details liegen
- **`CLAUDE.md`** — verbindliche Projekt-Instruktionen (Terminologie, Handbuch-/Compliance-Pflege, „Rat der Sprachmodelle").
- **Persistentes Gedächtnis** unter `.claude/.../memory/` (`MEMORY.md` als Index) — wird von jeder neuen Sitzung automatisch geladen; enthält die Tiefe (Audit, Auto-Tourenplanung, Pilot-Bereich, Handbuch-Screenshots, Security-Härtung …).
