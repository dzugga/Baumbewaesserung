# INFA / Baumbewässerung — Projekt-Handoff (Stand 08.06.2026)

## Projekt & Stack
- **Repo:** github.com/dzugga/Baumbewaesserung · Branch `main` · lokal: `C:\Users\mdzugga\Documents\GitHub\Baumbewaesserung`
- **Build:** Vite. Dev: `npm.cmd run dev -- --port 3001` (immer Port 3001). Build: `npm.cmd run build` → `dist/`
- **Hosting:** Firebase (`baumbewaesserung`), live: https://baumbewaesserung.web.app
  Deploy: `npx.cmd firebase deploy --only hosting` (Windows → npx.cmd). **Nur auf ausdrückliche Aufforderung.** Functions nie ohne Aufforderung.
- **Backend:** Firebase Firestore (compat SDK v10.12.0), Leaflet+OSM, OpenRouteService (Desktop-Routing), Chart.js, SheetJS, Gemini via Cloud Function `geminiAnalyse`.
- **Apps:**
  - `index.html` + `src/desktop.js` — Desktop-Planer „INFA-Auftragsbearbeitung"
  - `mobil.html` + `src/mobile.js` — Fahrer-App „INFA-LRM-Objekte" (produktiv)
  - `navi.html` + `src/navi.js` — **Navi-Klon (Beta)** mit Turn-by-turn (Sandbox, siehe unten)
  - `erfassung.html` + `src/erfassung.js` — Objekterfassung
  - `einsatzleiter.html` + `src/einsatzleiter.js` — Einsatzleiter-Live-Übersicht

## Datenmodell (Firestore)
`projects/{id}/{trees, tours, routes, reasons, tourHistory}`
- **trees:** name, stadtteil, art, baumnr, pflanzjahr, pflanzzeitpunkt, lat, lng, wasser, zustand, **aktiv** (false = inaktiv), tourId/**tourIds[]**, lastStatus ('bewaessert'|'nicht'|null), lastReason/lastNote/lastDriver/lastReportAt, history[], baumId (B-00001…)
- **reasons:** `{text}` — **pro Projekt** (kein Auto-Seed mehr, optionaler Button „Standard-Gründe hinzufügen")
- **tourHistory:** Snapshots abgeschlossener Touren. **Schema vereinheitlicht auf `trees`** (früher `results`).

## WICHTIGE KONVENTIONEN
- **Status-Keys `'bewaessert'`/`'nicht'`** (mit „ae") sind interne Logik — **NIE umbenennen** (nur Anzeigetexte „Erledigt"/„Nicht erledigt").
- JS-Logik in `src/*.js`, nicht im HTML. Inline-CSS bevorzugt. Änderungen minimal halten.
- **Commit-Messages enden mit:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- **Firestore-Batch-Limit = 500** (wir nutzen ≤450 pro Batch).

## DEV-/UMGEBUNGS-QUIRKS (wichtig!)
- Windows: immer `npm.cmd` / `npx.cmd`.
- **PowerShell here-strings brechen bei `"`/Sonderzeichen** in Commit-Messages → Commit-Text in Datei schreiben und `git commit -F datei` nutzen.
- **Dev-Server (3001) live in Chrome funktioniert** (Stand 08.06.2026): `vite.config.js` hat `server`-Block mit `watch.usePolling` (Windows-Watcher) + `Cache-Control: no-store` (kein Stale) → `npm.cmd run dev` reicht, Edits erscheinen sofort in der Chrome-Extension. (Früher kaputtes HMR/stale Module; Fallback build+`preview --port 3010` nur falls nötig.)
- **Browser-MCP kann NICHT zu `web.app` navigieren** (blockiert) → für Firebase-Zugriff/Tests `localhost`-Preview nutzen (`window.firebase.firestore()` ist auf den Seiten verfügbar).
- Bad Rothenfelde (`WDXQv3gb1gl2kuzsVSpj`) = Testprojekt; Rüsselsheim (`Lumi5fkOU70s89XZf4Dv`) = große Echtdaten; „Rheine Papierkorbleerung" (`8iqStiWyrDx444Gq88uS`) = Papierkorb-Projekt.

## WAS IN DER LETZTEN SESSION GEMACHT WURDE (alles committet/deployt)
1. **Schema-Vereinheitlichung `results` → `trees`:** Detail-Modal, Controlling, Einsatzleiter lesen `trees`; `normalizeHistory()` als Sicherheitsnetz; **Fahrer-App schreibt jetzt `trees`**; Bestandsdaten migriert, `results`-Backups entfernt.
2. **Controlling-Fixes:** „Diese Woche" ISO-Montag, Timeline UTC-Off-by-one + eine Datenquelle, results-Meldungen werden gezählt.
3. **Projektwechsel-Refresh:** Controlling/Dashboard **und** Historie-Liste aktualisieren beim Projektwechsel (vorher nur nach Reload).
4. **Historie-Detail:** Status-Korrektur optional in Live-Ansicht/Karte übernehmen (Schutz: keine neuere Meldung überschreiben); **Grund = Dropdown** der Projekt-Gründe.
5. **Tour-Fortschritt nie >100%** (Dashboard + Einsatzleiter): zählt nur aktuell **aktive** Tour-Objekte.
6. **„Fortschritt je Tour" + „Gründe":** Suchfeld + Zähler + feste Scrollhöhe (max. 3 Touren / 5 Gründe, Rest scrollbar).
7. **Inaktive Objekte** werden überall ausgeschlossen (Navi-Liste/Marker/Route, Desktop-Routenberechnung). Bestehende Rheine-Route bereinigt.
8. **Import-Vorschau (Desktop):** Koordinaten-Kontrolle vor dem Schreiben — Plausibilitätsprüfung, Warnung bei Punkten außerhalb DE, **Mini-Karte**, Schalter **„lat ↔ lng tauschen"** (Auto-Erkennung), Dezimal-Komma-Parsing. Import erst nach Bestätigung.
9. **Import beschleunigt:** Batch-Writes statt Einzel-Roundtrips (Zähler einmal lesen/lokal hochzählen). **Projekt-Löschen** ebenso (Batch-Deletes).
10. **Gründe strikt pro Projekt:** Reload bei Projektwechsel (Leak weg); Auto-Seed entfernt → optionaler Button.
11. **Planung-Eigenschaftsfilter (NEU, deployt, noch nicht final verifiziert):** Filter im Objekte-Panel (Stadtteil/Typ/Jahr/Zustand/Priorität/Status) + Schalter „Nur gefilterte auf der Karte zeigen".

## NAVI-KLON (Beta) — `navi.html` / `src/navi.js`
Eigenständige Kopie der Fahrer-App (Sandbox), **echte `mobil.html` bleibt unberührt**. Funktionen:
- Turn-by-turn **keyless via OSRM-Demo** (`router.project-osrm.org`), deutsche Manöver, ETA, Vorab-Ansage.
- **Sprachausgabe** (Web Speech, mit Entsperr-Priming + 🔊-Schalter), **Karten-Rotation** (leaflet-rotate + iOS-Kompass via DeviceOrientation, 🧭-Schalter), **Wake-Lock**, **Off-Route-Reroute**.
- **Nächstes Ziel = nächstgelegenes** offenes Objekt; Reihenfolge wird beim Navi-Start ab GPS neu sortiert (Nummern passen sich an); Ankunft an **jedem** offenen Stopp; **Auto-Weiter**.
- **🗺️/📍-Schalter:** ganze Restroute (Standard) vs. nur nächste Etappe.
- **Bedienelemente als schwebende Buttons** rechts auf der Karte (Banner frei für die Anweisung).
- **Deeplink** „In Google Maps navigieren" je Objekt (für CarPlay/Hintergrund-Navi).
- **Konfigurierbare Endpunkte** oben in `navi.js`: `NAVI_OSRM_BASE`, `NAVI_TILE_URL` (1-Zeilen-Switch für Self-Hosting).
- **Beta-Test-Hooks** (window.naviSimulateGps / naviDebug / naviSetBearing) zum Testen ohne Fahrt.

## INFRASTRUKTUR / KOSTEN (Doku im Repo: `docs/self-hosting.md`)
- OSRM-Demo + OSM-Tiles sind **gratis aber Fair-Use, nicht für gewerblichen Dauerbetrieb** (Drosselung möglich, keine Abrechnung).
- **Self-Hosting empfohlen** (OSRM + TileServer-GL + Caddy auf Hetzner): ~15–50 €/Monat, kein Limit, DSGVO-freundlich. Anleitung: `docs/self-hosting.md`.
- **Mapbox** bei 50 Fahrern grob 450–1.000 €/Monat (geschätzt) → Self-Hosting 10–30× günstiger.
- **CarPlay:** Web-App lässt sich NICHT direkt anzeigen (kein Browser auf CarPlay). Weg: Deeplink → Google/Apple Maps (laufen auf CarPlay) oder native App (großes Projekt).
- Lokale (nicht committete) Vorlagen: `INFA-Navigation-Kostenvergleich.docx`, `INFA-Umzug-Hetzner-Analyse.docx`, `Navi-Mockups.html`.

## OFFENE PUNKTE / TODO
- **Rheine-Koordinaten final bereinigen:** lat/lng waren vertauscht (Punkte vor Afrika). ~580 schon getauscht, aber Objektzahl wuchs während der Korrektur (laufender Import?). Sobald **kein Import mehr läuft**: alle Rest-„vor-Afrika"-Punkte (lat 0–20 & lng 40–60) tauschen + Endkontrolle (alle in DE: lat 47–55, lng 5–16). Projekt-pid `8iqStiWyrDx444Gq88uS`.
- **Planung-Eigenschaftsfilter** im Live-Lauf verifizieren (deployt, Browser-Test wurde unterbrochen).
- **Navi am echten Gerät** final prüfen: kommt die iOS-Bewegungs-/Ausrichtungs-Freigabe? Dreht die Karte richtig herum (sonst Vorzeichen `360 − Richtung`)? Stimme hörbar?
- **Mehrmandantenfähigkeit/Auth** (offene Firestore-Rules!) — noch nicht umgesetzt. Reihenfolge: Auth+Rules zuerst.
- **Foto-Funktion** — zurückgestellt (Firebase Storage).
- **Self-Hosting** ggf. tatsächlich aufsetzen (Doku liegt vor).
- Optional: Navi-Abruf-Zähler (Routing-Requests) in INFA-Admin sichtbar machen.

## LETZTE COMMITS (Auswahl)
- `56b2154` Planung: Eigenschaften-Filter
- `e796ae1` Reasons-Button-Label
- `21c22f1` Projekt-Löschen Batch
- `a4f3e02` Import Batch-Speedup
- `f9764b9` Gründe strikt pro Projekt
- `bb1e72f` Import-Vorschau mit Koordinaten-Kontrolle
- `b59d52b` Tour-Fortschritt ≤100%
