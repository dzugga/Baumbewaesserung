# Baumbewaesserung

## Projektziel
Web-App zur Planung und Dokumentation der kommunalen Baumbewässerung im Stadtgebiet.
Zwei Frontends: Desktop-Planer (`index.html`) und mobile Fahrer-App (`mobil.html`).

## Architektur
- **Build:** Vite – `npm run dev -- --port 3001` (immer Port **3001**: localhost:3001) · `npm run build` (→ dist/)
- **Hosting:** Firebase Hosting (`dist/` wird deployed) – **nur auf explizite Aufforderung deployen**
- **Backend:** Google Firebase Firestore (Echtzeit-Datenbank, compat SDK v10.12.0)
- **Karten:** Leaflet 1.9.4 + OpenStreetMap Tiles
- **Routing:** OpenRouteService API (ORS, optionaler API-Key)
- **Charts:** Chart.js 4.4.0 (nur Desktop)
- **Excel-Import:** SheetJS (nur Desktop)

## Datenmodell (Firestore)
```
projects/{projectId}
  ├── trees/{treeId}          – Baumdaten + lastStatus/lastDriver/history[]
  ├── tours/{tourId}          – Tourname, Farbe, Status, Fahrer[]
  ├── routes/{tourId}         – Berechnete Route (GeoJSON + orderIds)
  ├── reasons/{reasonId}      – Gründe „nicht bewässert"
  └── tourHistory/{histId}    – Abgeschlossene Touren (Snapshot)
```

## Baum-Felder
`name` (Anlage/Str.), `stadtteil`, `baumnr`, `art` (Baumart), `pflanzjahr`, `pflanzzeitpunkt`, `lat`, `lng`, `wasserbedarf`, `zustand`, `datum` (letzte Bew.), `tourId`, `notiz`, `lastStatus` ('bewaessert'|'nicht'|null), `lastReason`, `lastNote`, `lastDriver`, `lastReportAt`, `history[]`

## Dateien
| Datei | Beschreibung |
|---|---|
| `index.html` | Desktop-Planer (v7.3): Karte, Bäume, Touren, Controlling, Verwaltung |
| `mobil.html` | Fahrer-App (v-35): Login → Tour → Map/Liste → Abschluss |
| `erfassung.html` | Erfassungs-App (v1.0): Vor-Ort-Baumerfassung, 2 Modi |
| `einsatzleiter.html` | Einsatzleiter-App (v1.0): Live-Übersicht offener/laufender Touren (Leaflet + Chart.js) |

## Desktop (`index.html`) – Views
- **Karte** – Leaflet-Karte, Baum-Marker, Lasso-Auswahl, Tour-Routen
- **Bäume** – Tabelle aller Bäume mit Suche
- **Touren** – Verwaltung + Routenberechnung
- **Controlling** – KPIs, Charts (Pie/Bar/Timeline), Detailtabelle, CSV-Export
- **Verwaltung** – Fahrer pro Tour, Gründe, Erfasser

## Mobile App (`mobil.html`) – Screens
- **Login** – Projekt → Tour → Fahrername (aus Firestore)
- **Map-Tab** – Leaflet-Karte, GPS-Tracking, Route, „Nächster Baum"-Pill
- **List-Tab** – Bäume mit Status-Dots, Suche
- **Detail-Sheet** – Status setzen (bewässert/nicht), Grund-Chips, Props bearbeiten
- **Tour-Abschluss** – Batch-Writes in Firestore, Fortschrittsanzeige

## Selbstkontrolle via Browser
Nach Änderungen immer per **Claude in Chrome Extension** prüfen:
1. Dev-Server läuft (`npm run dev -- --port 3001` → localhost:3001)
2. `mcp__Claude_in_Chrome__list_connected_browsers` → Browser verbunden?
3. `mcp__Claude_in_Chrome__tabs_context_mcp` → Tab holen
4. `mcp__Claude_in_Chrome__navigate` → URL öffnen
5. `mcp__Claude_in_Chrome__computer` (action: screenshot) → visuell prüfen
- Desktop: `http://localhost:3001/index.html`
- Mobil: `http://localhost:3001/mobil.html`
- Einsatzleiter: `http://localhost:3001/einsatzleiter.html`
- Erfassung: `http://localhost:3001/erfassung.html`

## Terminologie (verbindlich)
- Das Produkt ist allgemeingültig: Im **Handbuch niemals** „Baum/Bäume/Bewässerung" — immer **Objekt(e)**, „Tätigkeit", „Meldungen", „erledigt/nicht erledigt", „Zeitaufwand".
- Gilt auch für **Commit-Betreffzeilen** (sie speisen den Handbuch-Reiter „Aktualisierungen").
- Neue UI-Texte ebenfalls objekt-neutral formulieren.

## Handbuch (Pflegepflicht)
- Digitales Handbuch unter Desktop → Admin → Handbuch; Inhalte in `src/handbuch-daten.js` (nach Apps gegliedert, `keywords` für die Suche).
- **Bei jeder neuen/geänderten Funktion den passenden Handbuch-Abschnitt mitpflegen** (Endnutzer-Sprache, keine Technik-Details).
- Reiter „Aktualisierungen" entsteht automatisch aus Git-Commits (`scripts/gen-changelog.mjs`, läuft bei `npm run build`) → Commit-Betreffzeilen deutsch und endnutzer-verständlich halten.
- Screenshots (public/handbuch/) bei UI-Änderungen neu erzeugen: Demo-Daten anlegen (Mandant org_demo_hb, Projekt demo_handbuch, Logins „Demo Admin"/135790 + „Max Muster"/246800 — siehe Kopf von `scripts/handbuch-screenshots.mjs`) → `node scripts/handbuch-screenshots.mjs` (Dev-Server :3001 nötig) → Demo-Daten wieder löschen. Symbol-Screenshots separat: Projekt demo_symbole (icon 🗑️, Arten mit/ohne Symbol) → `node scripts/symbol-screenshots.mjs`.

## System & Compliance (Pflegepflicht)
- Superadmin-Bereich „System & Compliance" (Avatar-Menü, Desktop); Inhalte in `src/systeminfo-daten.js`.
- **Bei Änderungen an Technik-Stack, Regionen, Sicherheitsmaßnahmen oder DSGVO-Status diese Datei mitpflegen** (DSGVO-Punkte: status 'ok'/'offen').
- **Reiter „Lizenzen & Dienste" (`SI_DIENSTE`):** Bei jeder NEUEN externen Bibliothek, Karten-/Routing-/Geocoding-Quelle, CDN oder Cloud-Dienst dort einen Eintrag ergänzen (status 'ok'/'achtung'/'risiko', Lizenz, Kostenrahmen, Hinweis) — Ziel: rechtliche/Kosten-Transparenz für den kommunalen Einsatz.
- Bibliotheks- und App-Versionen werden zur Laufzeit live ausgelesen — nicht manuell pflegen.

## Entwicklungshinweise für Claude
- JS-Logik liegt in `src/desktop.js` (Desktop) und `src/mobile.js` (Fahrer-App) – nicht in den HTML-Dateien.
- **Niemals `firebase deploy` ausführen** ohne explizite Aufforderung.
- Firebase compat SDK (nicht modular) – `firebase.firestore()`, `db.collection()`, `db.batch()`.
- **Geteilte Module:** Firebase-Konfiguration (`src/firebase-config.js`), HTML-Escape (`src/esc.js` → im Desktop als `dlEsc` importiert), App Check (`src/appcheck.js`) liegen zentral und werden in alle Apps importiert — dort NICHT erneut definieren.
- **Compat-Shims (`collection`/`doc`/`getDoc`/`onSnapshot`…) bewusst NICHT zentralisiert:** Desktop instrumentiert sie mit `_bumpUsage` (Nutzungszählung); `_injectOrg` hängt per Closure an der Modul-Variable `currentProjectData` (orgId-Denormalisierung für Rules). Ein Auslagern bräche entweder die Nutzungszählung oder die orgId-Injektion → Schreibvorgänge würden von den Rules abgelehnt.
- **Fehlerbehandlung:** `catch` nur stumm lassen, wenn das Scheitern erwartbar/folgenlos ist (best-effort localStorage, optionales Nachladen). Bei unerwarteten Fehlern `catch(e){ console.warn('Kontext', e); }` — nicht still verschlucken.
- Inline-CSS bevorzugen (Projekt-Konvention); keine externen CSS-Dateien anlegen.
- Token sparsam: keine ausschweifenden Erklärungen, kein redundantes Code-Echo.
- Änderungen minimal halten – nur das Notwendige anpassen.
- Keine unnötigen Kommentare – nur nicht-offensichtliche Eigenheiten dokumentieren.
