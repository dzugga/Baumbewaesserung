# INFA / Baumbewässerung — Projekt-Handoff (Stand 09.06.2026)

## Projekt & Stack
- **Repo:** github.com/dzugga/Baumbewaesserung · Branch `main` · lokal: `C:\Users\mdzugga\Documents\GitHub\Baumbewaesserung`
- **Build:** Vite 8. Dev: `npm.cmd run dev` (Port **3001**, in vite.config.js fixiert). Build: `npm.cmd run build` → `dist/`
- **Hosting:** Firebase (`baumbewaesserung`), live: https://baumbewaesserung.web.app
  Deploy Hosting: `npx.cmd firebase deploy --only hosting`. Functions: `--only functions:NAME`. Rules: `--only firestore:rules`. **Nur auf ausdrückliche Aufforderung.**
- **Backend:** Firebase Firestore (compat SDK v10.12.0), **Firebase Auth** (E-Mail + Custom Token), Cloud Functions (Node 22, 2nd Gen, us-central1), Leaflet+OSM, OpenRouteService (Desktop-Routing), Chart.js, SheetJS, Gemini via `geminiAnalyse`.
- **Apps:** `index.html`+`src/desktop.js` (Desktop-Planer) · `mobil.html`+`src/mobile.js` (Fahrer) · `erfassung.html`+`src/erfassung.js` (Erfassung) · `einsatzleiter.html`+`src/einsatzleiter.js` (Live-Übersicht) · `navi.html`+`src/navi.js` (Navi-Klon Beta).

## ⭐ GROSSES THEMA DIESER SESSION: Mehrmandantenfähigkeit + Auth + Rollen — UMGESETZT & LIVE (Rules scharf!)
Die offene Mehrmandanten-/Auth-Aufgabe ist **vollständig produktiv**. Alle Apps verlangen Login, Firestore-Rules sind **scharf** (Mandanten-Isolation erzwungen).

### Login (alle Apps gleich)
- **Stadt-Code + Name + PIN** auf Desktop/Mobil/Erfassung/Einsatzleiter. Ein Umschalter „Admin-Anmeldung (E-Mail)" bietet zusätzlich E-Mail/Passwort (Master-/Notzugang).
- Die **Rolle der Person** bestimmt Module/Rechte. Modul-Sperren greifen (z. B. Erfasser-App, Einsatzleiter-App).
- **Superadmin** = `dzugga@infa.de` (E-Mail-Login, mandantenübergreifend) — der Master-Zugang.

### Datenmodell (Firestore) — Erweiterungen
- `orgs/{orgId}` = Mandant `{name, code}`. Codes: **RUESSEL** (Rüsselsheim), **BADROTH** (Bad Rothenfelde), **RHEINE** (Rheine).
- `users/{uid}` = E-Mail-Konten `{email, orgId, role, active}`.
- `drivers/{id}` = **PIN-Personen** `{orgId, name, nameLower, pinHash, pinSalt, role, active}` (role kann jede Rolle sein, nicht nur Fahrer).
- `roles/{roleKey}` = **globale Rollen** `{name, baseType, modules{...}, builtin}`. Built-ins: superadmin/orgadmin/planer/erfasser/fahrer.
- **Jedes** Projekt + Unterkollektions-Dokument trägt **`orgId`** (denormalisiert; per Backfill gesetzt, neue Docs via Shim/Funktion). Projekt-IDs: Rüsselsheim `Lumi5fkOU70s89XZf4Dv`, Bad Rothenfelde `WDXQv3gb1gl2kuzsVSpj`, **Rheine `itJxlz9sMO3Aq1biDUaY`** (Handoff-ID `8iqStiWyrDx444Gq88uS` war veraltet/falsch).

### Claims & Rules
- Custom Claims: `{orgId, role, cap, name}`. `cap` = Basis-Typ (`admin`|`editor`|`readonly`|`driver`) steuert die Rules; `role` = Rollen-Key (steuert UI/Module via `roles`-Collection).
- `firestore.rules` (scharf, in firebase.json verdrahtet): `inOrg`/`canPlan`/`canManage` cap-basiert, Superadmin-Bypass. **Unterkollektions-Lesen via `get()` aufs Parent-Projekt** (denn App-Queries sind nicht org-gefiltert — sonst werden unbeschränkte Collection-Queries abgelehnt!). Schreiben prüft `resource.data.orgId` (kein get).
- **Rollback** falls nötig: Firebase-Konsole → Firestore → Regeln → Versionsverlauf → vorige Version.

### Cloud Functions (functions/auth.js, alle deployt, us-central1)
`driverLogin` (Name+PIN → Custom Token mit Rolle/cap), `setDriverPin` (Person anlegen/ändern, role+PIN), `setUserRole`, `createOrgUser`, `setUserPassword`, `setUserActive`, `deleteOrgUser` — alle admin-only (Superadmin oder cap=admin). Plus `geminiAnalyse`.
⚠ `createCustomToken` braucht die IAM-Rolle **Service Account Token Creator** auf dem Compute-SA (bereits gesetzt; bei Neuaufsetzen siehe docs/auth-mandanten.md).

### Verwaltung (alles in der App)
- **INFA-Admin → „Benutzer"** (Admins): Schritt 1 **Rollen & Module** (einklappbar, Superadmin), 2 **Personen & PINs** (Name+Rolle+PIN), 3 **E-Mail-Konten** (optional), 4 Link zur Tour-Zuweisung.
- **Verwaltung → „Fahrer pro Tour"** (projektbezogen): weist **angelegte Personen** (Dropdown) den Touren zu → bestimmt, welche Tour ein Fahrer mobil sieht.
- Nav-Gating: `data-module="..."` + `applyModulePermissions()`. Tokens `__superadmin__`, `__admin__`. Admin-Punkte erscheinen erst nach Öffnen eines Projekts (Top-Nav).
- gcloud ist installiert + ADC eingerichtet (für Admin-Skripte). Skripte: `functions/scripts/{backfill-orgid,set-claims}.mjs`. Runbook: `docs/auth-mandanten.md`.

## Weitere Features dieser Session (Desktop-Planung)
- **Mehrfach-Tour-Auswahl** (Checkboxen in der Legende, Summen-Info, „Routen berechnen (N)").
- **Routenlinien-Schalter** (Auge-Button oben rechts auf der Karte).
- **Abfahr-Simulation:** Button „▶ Abfahrt simulieren" in der Legende (nur bei **genau 1** gewählter Tour **mit berechneter Route**) → Wiedergabe-Leiste (Play/Pause, Tempo 0.5–8×, Zeitleiste mit Phasen Fahrt/Bewässerung/Depot, scrubbbar), 🚚 fährt die Route ab.
- **„Nicht verplant" additiv** (Checkbox, gleichzeitig mit Touren einblendbar).
- **Objektfilter einklappbar** + **Tour-Suchfeld** (ab 8 Touren) in der Sidebar.
- Schwebende Routen-Info-Pille entfernt (Infos im Seitenpanel).
- Toast-Klick-Bug gefixt (pointer-events:none) in allen Apps.

## DEV-/UMGEBUNGS-QUIRKS (wichtig!)
- Windows: immer `npm.cmd` / `npx.cmd` / `gcloud.cmd` (PS-ExecutionPolicy blockiert .ps1).
- Dev-Server (3001) live in Chrome ok (vite.config.js: `watch.usePolling` + `Cache-Control: no-store`). **Aber: `location.reload()` via JS holt manchmal alten Stand → lieber frisch navigieren (`?v=`).**
- **Browser-MCP kann NICHT zu `web.app` navigieren** (blockiert) → lokal über `localhost:3001` testen; deployten Stand per `curl` prüfen.
- **Rules scharf:** Zum Testen via Browser muss man als passende Person angemeldet sein. Test-Konten per Admin-SDK anlegen + **nach dem Test wieder löschen** (so in dieser Session gehandhabt).
- Commit-Messages enden mit `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`; bei Sonderzeichen `git commit -F datei`.
- Status-Keys `'bewaessert'`/`'nicht'` nie umbenennen. Inline-CSS bevorzugt.

## OFFENE PUNKTE / TODO
- **Rheine-Koordinaten** final bereinigen (lat/lng waren teils vertauscht — „vor Afrika"). Projekt `itJxlz9sMO3Aq1biDUaY`.
- **Navi** am echten Gerät prüfen (iOS-Kompass/Rotation/Stimme).
- **Echte Konten/PINs** anlegen (bisher v. a. Test/Marc/Alex + dzugga). Über INFA-Admin → Benutzer.
- Optional: Admin-Punkte (Benutzer) auch **vor** der Projektauswahl zugänglich machen.
- Optional: Superadmin-PIN unter Master-Code statt E-Mail.
- Optional: Mobil/Navi konsequent auf Modul-Sperre prüfen (aktuell: Mobil = Fahrer per PIN).
- Foto-Funktion (zurückgestellt, Firebase Storage). Self-Hosting OSRM/Tiles (docs/self-hosting.md).

## LETZTE COMMITS (Auswahl)
- `831437d` Benutzer: Rollen & Module als Schritt 1 eingebettet, Menüpunkt entfernt
- `d2689c4` INFA-Admin: eigener Menüpunkt „Benutzer" mit Schritt-Reihenfolge
- `07df63c` Fahrer pro Tour: Personen-Dropdown statt Freitext
- `c6c95c5` Login: alle Apps auf Stadt-Code + Name + PIN
- `35c48b1` Cutover: Firestore-Rules scharf (cap-basiert)
- `ba84c15` Rollen & Module: frei definierbare Rollen + Modul-Berechtigungen
- `6f88e08` Auth/Mehrmandanten Phase 1 (Rules, Functions, Backfill, Runbook)
- `35afe8a` Abfahr-Simulation + Routen-Info-Leiste entfernt
