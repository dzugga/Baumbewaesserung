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
  { status: 'ok',    label: 'Datensparsamkeit', note: 'Von Personen werden nur Name, Rolle und Anmeldedaten verarbeitet.' },
  { status: 'ok',    label: 'Datenschutzerklärung & Impressum', note: 'In allen Apps verlinkt (Avatar-Menü bzw. Anmeldeseite).' },
  { status: 'offen', label: 'Platzhalter der Datenschutzerklärung ausfüllen', note: 'Betreiber, Datenschutzbeauftragter und Speicherfristen sind noch als Platzhalter hinterlegt.' },
  { status: 'offen', label: 'Auftragsverarbeitungsvertrag (AVV) mit Google Cloud', note: 'Google bietet die EU-Standardklauseln/AVV an — Abschluss dokumentieren.' },
  { status: 'offen', label: 'TOMs dokumentieren', note: 'Technische und organisatorische Maßnahmen schriftlich festhalten (Grundlage: Reiter „Sicherheit").' },
  { status: 'offen', label: 'Löschkonzept', note: 'Aufbewahrungs- und Löschfristen für Meldungen, Verläufe und Fotos festlegen.' },
  { status: 'offen', label: 'Verzeichnis von Verarbeitungstätigkeiten (VVT)', note: 'Verarbeitung in das VVT des Betreibers aufnehmen.' },
  { status: 'offen', label: 'Personalrat / Betriebsvereinbarung', note: 'Meldungen sind personenbezogen auswertbar (Leistungskontrolle möglich) — Beteiligung klären.' },
  { status: 'offen', label: 'Datenschutz-Folgenabschätzung (DSFA) prüfen', note: 'Bei GPS-Ortung der Fahrer ggf. erforderlich — Einschätzung des DSB einholen.' },
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
  { label: 'Transportverschlüsselung', note: 'Sämtliche Verbindungen ausschließlich über HTTPS.' },
];
