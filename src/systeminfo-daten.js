// Daten für den Superadmin-Bereich „System & Compliance" (Avatar-Menü → System & Compliance).
// PFLEGEPFLICHT (siehe CLAUDE.md): Bei Änderungen an Technik-Stack, Regionen, Sicherheits-
// maßnahmen oder DSGVO-Status diese Datei mitpflegen. Bibliotheks-Versionen werden zur
// Laufzeit live ausgelesen (versionKey), App-Versionen aus den HTML-Köpfen geladen.

// ── DSGVO-Checkliste ─────────────────────────────────────────
// status: 'ok' (umgesetzt) | 'offen' (organisatorisch/inhaltlich offen)
export const SI_DSGVO = [
  { status: 'ok',    label: 'Datenhaltung in der EU', note: 'Datenbank, Datei-Speicher, Server-Funktionen und KI-Endpunkt laufen in Frankfurt (europe-west3).' },
  { status: 'ok',    label: 'Verschlüsselte Übertragung', note: 'Alle Apps und Schnittstellen ausschließlich über HTTPS.' },
  { status: 'ok',    label: 'Zugriffskontrolle & Rollen', note: 'Rechte je Rolle (Administrator, Planer, Erfasser, Fahrer, Nur-Lesen), serverseitig durchgesetzt.' },
  { status: 'ok',    label: 'Mandantentrennung', note: 'Jeder Datensatz ist einem Mandanten zugeordnet; Zugriff nur innerhalb des eigenen Mandanten.' },
  { status: 'ok',    label: 'Sichere Anmeldung', note: 'PINs werden nur als Hash gespeichert (scrypt); Sperre nach mehreren Fehlversuchen.' },
  { status: 'ok',    label: 'Keine Tracking-Cookies', note: 'Kein Werbe-Tracking, keine Analyse-Dienste Dritter.' },
  { status: 'ok',    label: 'Karten von amtlichen Servern', note: 'Hintergrundkarten kommen von basemap.de (Bundesamt für Kartographie/BKG), nicht von Google/Esri — keine Standortdaten-Übertragung an kommerzielle Drittanbieter.' },
  { status: 'ok',    label: 'Datensparsamkeit', note: 'Von Personen werden nur Name, Rolle und Anmeldedaten verarbeitet.' },
  { status: 'ok',    label: 'Datenschutzerklärung & Impressum', note: 'In allen Apps verlinkt (Avatar-Menü bzw. Anmeldeseite).' },
  { status: 'offen', label: 'Platzhalter der Datenschutzerklärung ausfüllen', note: 'Betreiber, Datenschutzbeauftragter und Speicherfristen sind noch als Platzhalter hinterlegt.' },
  { status: 'offen', label: 'Auftragsverarbeitungsvertrag (AVV) mit Google Cloud', note: 'Google bietet die EU-Standardklauseln/AVV an — Abschluss dokumentieren.' },
  { status: 'offen', label: 'TOMs dokumentieren', note: 'Technische und organisatorische Maßnahmen schriftlich festhalten (Grundlage: Reiter „Sicherheit").' },
  { status: 'offen', label: 'Löschkonzept', note: 'Aufbewahrungs- und Löschfristen für Meldungen, Verläufe und Fotos festlegen.' },
  { status: 'offen', label: 'Verzeichnis von Verarbeitungstätigkeiten (VVT)', note: 'Verarbeitung in das VVT des Betreibers aufnehmen.' },
  { status: 'offen', label: 'Personalrat / Betriebsvereinbarung', note: 'Meldungen sind personenbezogen auswertbar (Leistungskontrolle möglich) — Beteiligung klären.' },
  { status: 'offen', label: 'Datenschutz-Folgenabschätzung (DSFA) prüfen', note: 'Bei GPS-Ortung der Fahrer ggf. erforderlich — Einschätzung des DSB einholen.' },
  { status: 'offen', label: 'Google Fonts lokal hosten', note: 'Die Schriften (DM Sans/DM Mono) werden noch vom Google-CDN nachgeladen → überträgt die IP-Adresse an Google (Abmahnrisiko, vgl. LG München 2022). Schriften lokal mit der App ausliefern, dann entfällt die Übertragung. Siehe Reiter „Lizenzen & Dienste".' },
];

// ── Technik-Stack ────────────────────────────────────────────
// versionKey: wird zur Laufzeit aufgelöst (leaflet/chartjs/sheetjs/firebase) — passt sich
// damit automatisch an, wenn eine Bibliothek aktualisiert wird. Ohne versionKey: statisch.
export const SI_STACK = [
  { gruppe: 'Frontend', items: [
    { name: 'JavaScript (Vanilla) + Vite', zweck: 'Anwendungslogik und Build-Werkzeug, keine Framework-Abhängigkeit' },
    { name: 'Leaflet', zweck: 'Interaktive Karten in allen Apps', versionKey: 'leaflet' },
    { name: 'OpenStreetMap', zweck: 'Kartenkacheln (Standard-Hintergrundkarte)' },
    { name: 'Chart.js', zweck: 'Diagramme im Controlling und Einsatzleiter', versionKey: 'chartjs' },
    { name: 'SheetJS', zweck: 'Excel-Import im Planungsmanager', versionKey: 'sheetjs' },
  ]},
  { gruppe: 'Backend (Google Firebase)', items: [
    { name: 'Cloud Firestore', zweck: 'Echtzeit-Datenbank für alle Projekt- und Bewegungsdaten', versionKey: 'firebase' },
    { name: 'Firebase Authentication', zweck: 'Anmeldung per Custom Token nach Name + PIN' },
    { name: 'Cloud Storage', zweck: 'Fotos und Dokumente an Objekten' },
    { name: 'Cloud Functions (Node 22)', zweck: 'Geschützte Server-Funktionen (Anmeldung, Benutzerverwaltung, Mandanten, KI)' },
    { name: 'Firebase Hosting', zweck: 'Auslieferung aller Apps über HTTPS' },
  ]},
  { gruppe: 'Externe Dienste', items: [
    { name: 'OpenRouteService', zweck: 'Routenberechnung der Touren (API-Key je Mandant)' },
    { name: 'Vertex AI (Gemini)', zweck: 'KI-Analyse — EU-Endpunkt Frankfurt, Modell gemini-2.5-flash' },
  ]},
];

// ── Datenstandorte & Regionen ────────────────────────────────
export const SI_REGIONEN = [
  { dienst: 'Cloud Firestore (Datenbank)', region: 'europe-west3', ort: 'Frankfurt am Main' },
  { dienst: 'Cloud Storage (Fotos & Dokumente)', region: 'europe-west3', ort: 'Frankfurt am Main' },
  { dienst: 'Cloud Functions (Server-Funktionen)', region: 'europe-west3', ort: 'Frankfurt am Main' },
  { dienst: 'Vertex AI (KI-Analyse)', region: 'europe-west3', ort: 'Frankfurt am Main' },
  { dienst: 'Firebase Hosting (App-Auslieferung)', region: 'global (CDN)', ort: 'Weltweites Auslieferungsnetz — nur statische App-Dateien, keine Nutzdaten' },
];

// ── Apps ─────────────────────────────────────────────────────
// Version wird zur Laufzeit aus dem Versions-Kommentar im Kopf der jeweiligen HTML-Datei gelesen.
export const SI_APPS = [
  { file: 'index.html', name: 'Planungsmanager (Desktop)', zweck: 'Planung, Karte, Touren, Controlling, Verwaltung' },
  { file: 'mobil.html', name: 'Auftragsbearbeitung (Fahrer-App)', zweck: 'Touren abarbeiten, Meldungen erfassen, Tour-Abschluss' },
  { file: 'erfassung.html', name: 'Erfassung', zweck: 'Vor-Ort-Erfassung neuer Objekte inkl. Fotos' },
  { file: 'einsatzleiter.html', name: 'Einsatzleiter', zweck: 'Live-Übersicht offener und laufender Touren' },
  { file: 'navi.html', name: 'Navigation (Beta)', zweck: 'Navigations-Ansicht für Fahrer' },
];

// ── Sicherheit ───────────────────────────────────────────────
export const SI_SICHERHEIT = [
  { label: 'Anmeldung', note: 'Name + PIN; PINs liegen nur als scrypt-Hash vor. Nach mehreren Fehlversuchen wird das Konto zeitweise gesperrt.' },
  { label: 'Authentifizierung', note: 'Jeder Datenzugriff erfordert ein gültiges Anmelde-Token (Firebase Auth, Custom Token).' },
  { label: 'Datenbank-Regeln', note: 'Serverseitige Firestore-Regeln prüfen Rolle und Mandant bei jedem Lese- und Schreibzugriff.' },
  { label: 'Mandantentrennung', note: 'Alle Dokumente tragen die Mandanten-Kennung; mandantenfremde Zugriffe werden serverseitig abgewiesen.' },
  { label: 'Datei-Uploads', note: 'Nur freigegebene Dateitypen (Bilder, PDF, Office), maximal 20 MB pro Datei.' },
  { label: 'KI-Endpunkt', note: 'Nur für angemeldete Nutzer; feste Modell-Liste und Längenbegrenzung der Anfragen.' },
  { label: 'Eingabe-Schutz (XSS)', note: 'Alle Nutzereingaben werden bei der Anzeige maskiert.' },
  { label: 'App Check (Echtheitsprüfung)', note: 'Anfragen werden über reCAPTCHA v3 als „von der echten App stammend" bestätigt. Aktiv im Monitoring-Modus; Erzwingung je Dienst nach Beobachtungsphase.' },
  { label: 'API-Schlüssel-Beschränkung', note: 'Der öffentliche Web-Schlüssel akzeptiert nur Anfragen von den freigegebenen Domains (baumbewaesserung.web.app u. a.).' },
  { label: 'Transportverschlüsselung', note: 'Sämtliche Verbindungen ausschließlich über HTTPS.' },
];

// ── Lizenzen & Dienste (Komponenten-Compliance) ──────────────
// status: 'ok' (rechtlich/kommerziell unbedenklich) | 'achtung' (Bedingung/Restrisiko beachten) | 'risiko' (vor breitem Produktiveinsatz klären)
// Gruppen je Einsatzgebiet. Pflegepflicht: bei neuer externer Bibliothek/Dienst hier ergänzen.
export const SI_DIENSTE = [
  { gruppe: 'Programmbibliotheken (im Browser)', items: [
    { name: 'Leaflet', zweck: 'Kartendarstellung in allen Apps', lizenz: 'BSD-2-Clause (Open Source)', frei: 'Ja, dauerhaft – auch kommerziell', status: 'ok', hinweis: 'Frei nutzbar, keine Lizenzkosten. Keine Auflagen außer Copyright-Hinweis im Quellcode.' },
    { name: 'Chart.js', zweck: 'Diagramme (Controlling, Einsatzleiter)', lizenz: 'MIT (Open Source)', frei: 'Ja, dauerhaft – auch kommerziell', status: 'ok', hinweis: 'Frei nutzbar, keine Auflagen.' },
    { name: 'SheetJS (Community)', zweck: 'Excel-Import', lizenz: 'Apache-2.0 (Open Source)', frei: 'Ja – Community-Edition kommerziell frei', status: 'ok', hinweis: 'Die genutzte Community-Edition ist frei; nur die optionale „Pro"-Variante kostet.' },
    { name: 'Firebase JS SDK', zweck: 'Verbindung zur Datenbank/Anmeldung', lizenz: 'Apache-2.0 (Client-Bibliothek)', frei: 'Ja – Kosten nur über die Dienste (s. u.)', status: 'ok', hinweis: 'Die Bibliothek ist frei; Kosten entstehen nur durch die Nutzung der Google-Dienste.' },
  ]},
  { gruppe: 'Karten & Geodaten', items: [
    { name: 'basemap.de (amtliche Standardkarte — Farbe + Graustufen)', zweck: 'Standard-Hintergrundkarte in allen Apps', lizenz: 'CC BY 4.0 (BKG / AdV)', frei: 'Ja – auch kommerziell/kommunal, mit Quellenangabe', status: 'ok', hinweis: 'Amtliche Karte der deutschen Vermessungsverwaltung (Bundesamt für Kartographie und Geodäsie). Kostenfrei, DSGVO-konform (deutsche Behördenserver), bundesweit einheitlich. Ersetzt seit 15.06.2026 den OSM-Kachelserver UND das Esri-Satellitenbild (beide waren rechtlich riskant).' },
    { name: 'Amtliche Luftbilder/WMS (Landes-DOP, je Stadt)', zweck: 'Scharfes Luftbild (20 cm) je Projekt — als „Luftbild" wählbar', lizenz: 'dl-de/by-2-0 bzw. dl-de/zero-2-0 / CC BY 4.0 (Landesvermessung)', frei: 'Ja – auch kommerziell, mit Quellenangabe', status: 'ok', hinweis: 'Amtliche Geobasisdaten der Landesvermessung — rechtlich sauberste, schärfste Luftbildquelle. Eingebunden: RLP (Ludwigshafen), Hessen (Rüsselsheim), NRW (Rheine/Ahlen), Niedersachsen (Bad Rothenfelde, Wilhelmshaven). Neue Städte: passenden Landesdienst unter WMS-Karten ergänzen.' },
    { name: 'OpenRouteService (Routing)', zweck: 'Berechnung der Tour-Fahrstrecken', lizenz: 'Dienst von HeiGIT; Daten OSM/ODbL', frei: 'Kostenloser Plan mit Tageslimit (ca. 2.000 Routen/Tag, 500 Matrix/Tag)', status: 'achtung', hinweis: 'Je Stadt eigener API-Schlüssel. Bei Überschreitung der Limits oder intensiver Nutzung: kostenpflichtiger Plan oder eigener ORS-Server. Für stark wachsende Nutzung einplanen.' },
    { name: 'Nominatim (Adress-/Straßensuche)', zweck: 'Adress-Suchfeld auf der Karte + Betriebshof-Adresse → Koordinaten', lizenz: 'Adressdaten ODbL (OSM); OSMF-Nutzungsrichtlinie', frei: 'Ja, aber nur Einzelsuchen (kein Tippen-Autocomplete), max. 1/Sek., mit Quellenangabe', status: 'achtung', hinweis: 'Das Suchfeld sucht nur bei Enter (eine Anfrage pro Suche) und ist auf Deutschland/Stadt eingegrenzt — damit policy-konform. Quellenangabe ist eingebunden. Für intensive Nutzung oder amtliche Genauigkeit kann der Dienst gegen den BKG-Geokodierungsdienst (für Kommunen kostenfrei, Zugang beim BKG/ZSGT beantragen) getauscht werden — die Suchfunktion ist dafür gekapselt.' },
  ]},
  { gruppe: 'Plattform & Sicherheit', items: [
    { name: 'Google Firebase / Cloud (Datenbank, Hosting, Speicher, Anmeldung, Funktionen, KI)', zweck: 'Gesamtes Backend', lizenz: 'Kommerzieller Google-Cloud-Vertrag (Pay-as-you-go)', frei: 'Großzügiges Gratis-Kontingent, danach nutzungsbasiert', status: 'ok', hinweis: 'Rechtlich sauber (kommerzieller Anbieter, EU-Region Frankfurt). Für DSGVO Auftragsverarbeitungsvertrag mit Google abschließen (s. DSGVO-Checkliste).' },
    { name: 'Google reCAPTCHA v3 (App Check)', zweck: 'Schutz vor fremden Clients', lizenz: 'Google-Nutzungsbedingungen', frei: 'Gratis bis 1 Mio Prüfungen/Monat', status: 'achtung', hinweis: 'Kostenlos im erwartbaren Rahmen. Datenschutz: reCAPTCHA bindet einen Google-Dienst ein – in der Datenschutzerklärung erwähnen.' },
  ]},
  { gruppe: 'Schriften', items: [
    { name: 'Google Fonts (vom Google-CDN)', zweck: 'Schriftarten DM Sans / DM Mono', lizenz: 'SIL Open Font License (Schrift gratis)', frei: 'Ja – aber Nachladen vom Google-Server', status: 'achtung', hinweis: 'DSGVO: Das Nachladen vom Google-CDN überträgt die IP-Adresse an Google (Abmahnrisiko, vgl. LG München 2022). Empfehlung: Schriften lokal selbst hosten statt vom Google-CDN laden.' },
  ]},
];
