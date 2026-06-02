# Baumbewaesserung

## Projektziel
Web-App zur Planung und Dokumentation der kommunalen Baumbewässerung im Stadtgebiet.
Zwei Frontends: Desktop-Planer (`index.html`) und mobile Fahrer-App (`mobil.html`).

## Architektur
- **Reines Frontend** – kein Build-System, kein npm. Alles in einzelnen HTML-Dateien mit inline CSS und JS.
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

## Entwicklungshinweise für Claude
- Kein Build-Schritt – Änderungen direkt in die HTML-Datei, kein Transpiling.
- Firebase compat SDK (nicht modular) – `firebase.firestore()`, `db.collection()`, `db.batch()`.
- Inline-CSS bevorzugen (Projekt-Konvention); keine externen CSS-Dateien anlegen.
- Token sparsam: keine ausschweifenden Erklärungen, kein redundantes Code-Echo.
- Änderungen minimal halten – nur das Notwendige anpassen.
- Keine unnötigen Kommentare – nur nicht-offensichtliche Eigenheiten dokumentieren.
