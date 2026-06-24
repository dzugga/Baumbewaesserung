# INFA / Baumbewässerung — Projekt-Handoff (Stand 09.06.2026, verifiziert)

> Dieser Handoff wurde gegen den **echten Live-Stand** geprüft (Rules, Functions, Daten, UI). Nicht raten — bei Unsicherheit gegen Produktion verifizieren.

## Projekt & Stack
- **Repo:** github.com/dzugga/Baumbewaesserung · Branch `main` · lokal: `C:\Users\mdzugga\Documents\GitHub\Baumbewaesserung`
- **Build:** Vite 8 → `npm.cmd run build` (→ `dist/`). Dev: `npm.cmd run dev` (Port **3001**, in vite.config.js fixiert).
- **Hosting:** Firebase `baumbewaesserung`, live: https://baumbewaesserung.web.app. Deploy: `npx.cmd firebase deploy --only hosting` (Functions: `--only functions:NAME`, Rules: `--only firestore:rules`). **Nur auf ausdrückliche Aufforderung deployen.**
- **Backend:** Firestore (compat SDK v10.12.0), **Firebase Auth** (E-Mail + Custom Token), Cloud Functions (Node 22, 2nd Gen, us-central1), Leaflet+OSM, OpenRouteService (Desktop-Routing), OSRM/Tiles (Navi), Chart.js, SheetJS, Gemini (`geminiAnalyse`).
- **Apps (alle auf neuem Login):** `index.html`+`src/desktop.js` (Desktop-Planer) · `mobil.html`+`src/mobile.js` (Fahrer-App, inkl. integriertem Navi-Modus, per Mandanten-Flag `naviEnabled` schaltbar) · `erfassung.html`+`src/erfassung.js` (Erfassung) · `einsatzleiter.html`+`src/einsatzleiter.js` (Live). Der frühere `navi.html`-Klon ist in die Fahrer-App zusammengeführt.

## Auth & Mehrmandantenfähigkeit (LIVE, Rules SCHARF)
- **Login überall:** Stadt-Code + Name + PIN (`driverLogin` → Custom Token). Umschalter „Admin-Anmeldung (E-Mail)" für Planer/Admins. **Superadmin/Master = `dzugga@infa.de`** (E-Mail).
- **Custom Claims:** `{orgId, role, cap, name}`. `cap` (admin|editor|readonly|driver) steuert die Rules; `role` (Rollen-Key) steuert UI-Module via `roles`-Collection.
- **Rules scharf** (empirisch geprüft: anonyme Reads auf alle Collections → `PERMISSION_DENIED`). Helfer: `cap()`, `isSuper()`, `inOrg()`, `canManage`, `canPlan`, `onlyStatusFields()`, **`onlyTourStatusFields()`** (Fahrer dürfen Tour-Status setzen). Unterkollektions-**Lesen** via `get()` aufs Parent-Projekt (`canReadProj()`), weil App-Queries nicht org-gefiltert sind. Rollback: Firebase-Konsole → Firestore → Regeln → Versionsverlauf.
- **Cloud Functions (8, deployt, us-central1):** `driverLogin`, `setDriverPin`, `setUserRole`, `createOrgUser`, `setUserPassword`, `setUserActive`, `deleteOrgUser`, `geminiAnalyse`. ⚠ `createCustomToken` braucht IAM **Service Account Token Creator** (gesetzt).

## Datenmodell (Firestore)
- `orgs/{id}` `{name, code}` — **3 Mandanten:** `org_ruesselsheim`/**RUESSEL**, `org_bad_rothenfelde`/**BADROTH**, `org_rheine`/**RHEINE**.
- `users/{uid}` E-Mail-Konten `{email, orgId, role, active}`.
- `drivers/{id}` PIN-Personen `{orgId, name, nameLower, pinHash, pinSalt, role, active, failedAttempts, lockedUntil}` (scrypt).
- `roles/{key}` `{name, baseType, modules{...}, builtin}` (global). Built-ins: superadmin/orgadmin/planer/erfasser/fahrer.
- `projects/{pid}` trägt **alle Stadt-Einstellungen**: `orgId, name, depot, depotMode, orsKey, routePlanning, bewDuration, routeOptMode, wmsLayers[], treeCount, tourCount, fieldLabels, lastBaumId`.
  - Unterkollektionen: `trees`, `tours`, `routes`, `reasons`, `tourHistory`, **`arten`** (neu).
- **Bäume** tragen u. a. `art` (Klartext) + **`artId`** (→ `arten`-Eintrag), `tourIds[]` (Multi-Tour), `lastStatus/lastReason/lastNote/lastDriver/lastReportAt`, `history[]`, `aktiv`.
- **Verifizierte Projekt-IDs:** Rüsselsheim **`Lumi5fkOU70s89XZf4Dv`** (357 Objekte/8 Touren) · Bad Rothenfelde **`WDXQv3gb1gl2kuzsVSpj`** (12/2) · Rheine-Papierkorbleerung **`itJxlz9sMO3Aq1biDUaY`** (805/2).

## Wichtige Features / Verhalten
- **Benutzer (Admin → Benutzer):** Schritt 1 Rollen&Module (einklappbar, Superadmin) · 2 Personen&PINs · 3 E-Mail-Konten · 4 Tour-Zuweisung (eigene Projekt-Auswahl). Oben **zentraler Stadt-Umschalter** steuert alle Schritte.
- **Menüs:** Verwaltung = Objekte/Touren/**Gründe**/Import · **Admin** = Benutzer/**Projekte**/Feldbezeichnungen/Allgemein/KI-Analyse. „Neue Stadt" nur Superadmin.
- **Karte – Button-Spalte oben rechts:** Planen (kleine Karte) · Auge (Routenlinien) · Filter (Panel) · # (Tour-Zähler ein/aus) · ▶ (Tour simulieren, nur bei 1 Tour mit Route). Filter-Panel öffnet links der Spalte.
- **Multi-Tour-Marker:** **gelb**, wenn ≥2 zugeordnete Touren **gleichzeitig aktiv**; sonst Tourfarbe. Oranger **Zähler** = Anzahl Tourzuordnungen (fix), per #-Button ausblendbar.
- **Abfahr-Simulation:** Tempo 10/20/30/50×, Legende „Tätigkeit/Fahrt/Depot".
- **Arten (Objekte → Tab „Arten"):** Liste je Projekt aufbauen (gleiche Schreibweise → gleiche `artId`), Häufigkeit, Umbenennen (propagiert), Zusammenführen (Tippfehler), Löschen bei 0. Import zieht Arten nach. In der Baum-Maske ist Typ/Art ein **Dropdown** (kein Freitext).
- **Einstellungen sind stadtspezifisch** (Projekt-Doc): Depot, Depot-Modus, ORS-Key, Reihenfolgeplanung, Zeitaufwand, Optimierung, WMS-Ebenen.
- **Lesezugriff (cap readonly):** „Touren speichern" + „Routen berechnen" deaktiviert.

## Kosten/Performance (heute optimiert)
- **A:** Projekt-Picker nutzt gespeicherte `treeCount`/`tourCount` statt alle Subcollections zu lesen (sparte ~1.186 Reads/Anzeige). Zähler heilen sich beim Öffnen (`maybeHealCount`).
- **B:** `projects`-Listener wird beim Öffnen abgemeldet (keine Hintergrund-Reads).
- **C:** Routen pro Projekt **einmal gecacht** (`_routesCache`/`_routesLoadedFor`), kein Re-Read bei jeder Baum-Änderung; nach Berechnung Cache-Update.
- **D (zurückgestellt):** Firestore Offline-Persistenz — heikel (Multi-Tab, Cache-Löschung beim Logout auf geteilten Rechnern). Nicht umgesetzt.

## DEV-/UMGEBUNGS-QUIRKS
- Windows: immer `npm.cmd`/`npx.cmd`/`gcloud.cmd`. gcloud unter `C:\Users\mdzugga\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd` (nicht im PATH).
- **Browser-MCP kann NICHT zu `web.app`** navigieren → lokal über `localhost:3001` testen; deployten Stand per `curl`/Bundle-Hash prüfen.
- **Rules scharf:** Browsertests nur als passend angemeldete Person. Muster: Wegwerf-Konto/-Fahrer per Admin-SDK anlegen (scrypt für PIN: `crypto.scryptSync(pin,salt,32)`), testen, **danach löschen**.
- `location.reload()` holt teils alten Stand → mit `?v=` frisch navigieren.
- Commit-Messages enden mit `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Status-Keys `'bewaessert'`/`'nicht'` nie umbenennen. Inline-CSS bevorzugt. JS-Logik in `src/*.js`, nicht im HTML.

## OFFENE PUNKTE / TODO
- **Echte Konten/PINs** für alle Städte anlegen (bisher v. a. Testkonten + `dzugga@infa.de`).
- **Navi-Klon:** Modul-Sperre/Rolle optional (läuft aktuell parallel als Beta); am echten Gerät prüfen (iOS-Kompass/Stimme).
- **Rheine:** sehr groß (805 Objekte) — Koordinaten/Datenqualität ggf. prüfen.
- Optional: D (Offline-Cache), Admin-Punkte vor Projektauswahl, Foto-Funktion (Firebase Storage).

## LETZTE COMMITS (heute, Auswahl)
- `3b6b619` Navi-Klon auf neuen Login (Stadt-Code+PIN)
- `521e812` WMS-Ebenen projektspezifisch · `5b38a31` Einstellungen projektspezifisch
- `1d0c11d`/`ee14215` Kosten C / A+B · `80fccf1`/`2c8a696` Arten-Stammdaten + Dropdown
- `42ca270` Multi-Tour-Marker gelb · `4624b78` Tour-Zähler-Button · `8f6a61b` Rules-Fix Fahrer-Tour-Status
- `2c00244` Admin-Menü · `c295249` Neue-Stadt nur Superadmin · `5bb3ad3` Lesezugriff-Sperren
- `39ce346` zentraler Stadt-Umschalter · `b131d90`/`9a6de10` Benutzer-Reorg
