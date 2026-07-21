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
  { status: 'ok',    label: 'Datenschutzerklärung & Impressum', note: 'In der Desktop-App (Planungsmanager) verlinkt — Avatar-Menü und Anmeldeseite.' },
  { status: 'ok',    label: 'Platzhalter der Datenschutzerklärung ausgefüllt', note: 'Betreiber/Auftragsverarbeiter (INFA GmbH, mit Kontakt) eingetragen; Verantwortlicher allgemein gefasst (jeweilige Stadt/Arbeitgeber, kein Platzhalter je Stadt mehr); Speicherfrist als Regelfall (3 Jahre / Verjährung) formuliert. Text durchgehend objekt-neutral. Inhaltliche Endabnahme durch den DSB empfohlen.' },
  { status: 'offen', label: 'Auftragsverarbeitungsvertrag (AVV) mit Google Cloud', note: 'Google bietet die EU-Standardklauseln/AVV an — Abschluss dokumentieren.' },
  { status: 'offen', label: 'TOMs dokumentieren', note: 'Technische und organisatorische Maßnahmen schriftlich festhalten (Grundlage: Reiter „Sicherheit").' },
  { status: 'offen', label: 'Löschkonzept', note: 'Aufbewahrungs- und Löschfristen für Meldungen, Verläufe und Fotos festlegen.' },
  { status: 'offen', label: 'Verzeichnis von Verarbeitungstätigkeiten (VVT)', note: 'Verarbeitung in das VVT des Betreibers aufnehmen.' },
  { status: 'offen', label: 'Personalrat / Betriebsvereinbarung', note: 'Meldungen sind personenbezogen auswertbar (Leistungskontrolle möglich) — Beteiligung klären.' },
  { status: 'offen', label: 'Datenschutz-Folgenabschätzung (DSFA) prüfen', note: 'Bei GPS-Ortung der Fahrer ggf. erforderlich — Einschätzung des DSB einholen.' },
  { status: 'ok', label: 'Schriften lokal ausgeliefert', note: 'DM Sans/DM Mono werden mit der App selbst ausgeliefert (woff2 unter /fonts), nicht mehr vom Google-CDN nachgeladen → es wird keine IP-Adresse mehr an Google übertragen (erledigt; vgl. LG München 2022).' },
];

// ── Technik-Stack ────────────────────────────────────────────
// versionKey: wird zur Laufzeit aufgelöst (leaflet/chartjs/sheetjs/firebase) — passt sich
// damit automatisch an, wenn eine Bibliothek aktualisiert wird. Ohne versionKey: statisch.
export const SI_STACK = [
  { gruppe: 'Frontend', items: [
    { name: 'JavaScript (Vanilla) + Vite', zweck: 'Anwendungslogik und Build-Werkzeug, keine Framework-Abhängigkeit' },
    { name: 'Leaflet', zweck: 'Interaktive Karten in allen Apps', versionKey: 'leaflet' },
    { name: 'basemap.de (BKG / AdV)', zweck: 'Amtliche Kartenkacheln (Standard-Hintergrundkarte)' },
    { name: 'Chart.js', zweck: 'Diagramme im Controlling und Einsatzleiter', versionKey: 'chartjs' },
    { name: 'SheetJS', zweck: 'Excel-Import im Planungsmanager', versionKey: 'sheetjs' },
  ]},
  { gruppe: 'Backend (Google Firebase)', items: [
    { name: 'Cloud Firestore', zweck: 'Echtzeit-Datenbank für alle Projekt- und Bewegungsdaten', versionKey: 'firebase' },
    { name: 'Firebase Authentication', zweck: 'Anmeldung per Custom Token nach Name + PIN' },
    { name: 'Cloud Storage', zweck: 'Fotos und Dokumente an Objekten' },
    { name: 'Cloud Functions (Node 22)', zweck: 'Geschützte Server-Funktionen (Anmeldung, Benutzerverwaltung, Mandanten, KI, Push-Versand)' },
    { name: 'Firebase Cloud Messaging (FCM)', zweck: 'Geräte-Benachrichtigungen für Nachrichten an Fahrer (pro Mandant aktivierbar); Token gerätegebunden' },
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
  { file: 'mobil.html', name: 'Auftragsbearbeitung (Fahrer-App)', zweck: 'Touren abarbeiten, Meldungen erfassen, Tour-Abschluss, optionale Navigation' },
  { file: 'erfassung.html', name: 'Erfassung', zweck: 'Vor-Ort-Erfassung neuer Objekte inkl. Fotos' },
  { file: 'einsatzleiter.html', name: 'Einsatzleiter', zweck: 'Live-Übersicht offener und laufender Touren' },
];

// ── Sicherheit ───────────────────────────────────────────────
export const SI_SICHERHEIT = [
  { label: 'Anmeldung', note: 'Name + PIN; PINs liegen nur als scrypt-Hash vor. Nach mehreren Fehlversuchen wird das Konto zeitweise gesperrt.' },
  { label: 'Authentifizierung', note: 'Jeder Datenzugriff erfordert ein gültiges Anmelde-Token (Firebase Auth, Custom Token).' },
  { label: 'Konto-Gültigkeit laufender Sitzungen', note: 'Wird ein Konto deaktiviert oder gelöscht, verliert eine noch offene Anmeldung den Zugang: Beim Öffnen und laufend während der Nutzung wird die Gültigkeit des Kontos geprüft und andernfalls automatisch abgemeldet. Bei vorübergehenden Netzfehlern bleibt eine gültige Sitzung bestehen (kein ungewolltes Abmelden).' },
  { label: 'Abmeldung beim Schließen (Desktop)', note: 'Der Planungsmanager (Desktop) beendet die Anmeldung beim Schließen des Fensters/Tabs; erneutes Öffnen erfordert eine neue Anmeldung. Die mobile Fahrer-App ist ausgenommen (bleibt für den Feldeinsatz angemeldet).' },
  { label: 'Datenbank-Regeln', note: 'Serverseitige Firestore-Regeln prüfen Rolle und Mandant bei jedem Lese- und Schreibzugriff.' },
  { label: 'Mandantentrennung', note: 'Alle Dokumente tragen die Mandanten-Kennung; mandantenfremde Zugriffe werden serverseitig abgewiesen. Personen-Datensätze können nicht per Direktzugriff in einen anderen Mandanten verschoben werden, und die Superadmin-Rolle wird ausschließlich serverseitig vergeben (nie über einen Personen-Datensatz).' },
  { label: 'Schutzebenen: Grundrechte vs. Bereichs-Menü', note: 'Die serverseitig durchgesetzte Schreib-/Lesegrenze ist die Kombination aus Mandant und Grundrolle (Administrator / Planer / Erfasser / Nur-Lesen / Fahrer). Die feinere Zuordnung einzelner Programm-Bereiche (Module) je Rolle steuert die Menü-Sichtbarkeit und Bedienführung; sie ist eine Organisations-/Komforthilfe innerhalb des Mandanten und kein Schutz gegen böswillige Nutzer. Wo Bereiche echte Vertraulichkeit gegenüber eigenen Mitarbeitern erfordern, ist die Grundrolle (z. B. Nur-Lesen) das maßgebliche Mittel.' },
  { label: 'Datei-Uploads', note: 'Nur freigegebene Dateitypen (Bilder, PDF, Office), maximal 20 MB pro Datei.' },
  { label: 'KI-Endpunkt', note: 'Nur für angemeldete Nutzer; feste Modell-Liste und Längenbegrenzung der Anfragen.' },
  { label: 'Eingabe-Schutz (XSS)', note: 'Alle Nutzereingaben werden bei der Anzeige maskiert.' },
  { label: 'App Check (Echtheitsprüfung)', note: 'Anfragen werden über reCAPTCHA v3 als „von der echten App stammend" bestätigt. Für Datenbank (Firestore), Datei-Speicher (Storage) und die serverseitigen Funktionen erzwungen; nur die Anmeldung läuft (als Vorabversion) im Monitoring-Modus mit.' },
  { label: 'API-Schlüssel-Beschränkung', note: 'Der öffentliche Web-Schlüssel akzeptiert nur Anfragen von den freigegebenen Domains (infa-planungsmanager.web.app, baumbewaesserung.web.app u. a.).' },
  { label: 'Transportverschlüsselung', note: 'Sämtliche Verbindungen ausschließlich über HTTPS.' },
  { label: 'Datensicherung', note: 'Firestore: kontinuierliche Wiederherstellung der letzten 7 Tage (Point-in-Time) plus tägliche (7 Tage) und wöchentliche (14 Wochen) Backups. Datei-Speicher (Fotos/Dokumente) mit Objekt-Versionierung. Lösch-Schutz der Datenbank aktiv.' },
  { label: 'Fehler-Protokollierung', note: 'Unerwartete Laufzeitfehler werden zentral protokolliert (Collection „errors", nur für Administratoren einsehbar) — zur frühzeitigen Erkennung von Problemen im Betrieb.' },
];

// ── Datensicherung & Wiederherstellung (Betreiber-Vorgehen) ──────────────
// Erklärt, was automatisch läuft und wie einzelne Mandanten wiederhergestellt werden.
export const SI_SICHERUNG = {
  intro: 'Alle Kundendaten werden automatisch gesichert. Für die gezielte Wiederherstellung eines einzelnen Mandanten gibt es zusätzlich ein Betreiber-Werkzeug. Weder Betreiber noch Kunde müssen für die laufende Sicherung etwas tun.',
  bloecke: [
    { titel: 'Automatisch – läuft ohne Zutun (alle Mandanten)', typ: 'ok', punkte: [
      'Datenbank: Wiederherstellung auf jede Minute der letzten 7 Tage (Point-in-Time).',
      'Zusätzlich tägliche Sicherung (7 Tage aufbewahrt) und wöchentliche Sicherung (14 Wochen aufbewahrt).',
      'Lösch-Schutz der Datenbank aktiv – sie kann nicht versehentlich gelöscht werden.',
      'Fotos/Dokumente: Objektversionierung + vorläufiges Löschen (7 Tage) – überschriebene/gelöschte Dateien bleiben wiederherstellbar.',
    ]},
    { titel: 'Schnelle Sicherung vor riskanten Aktionen (optional)', typ: 'info', punkte: [
      'Vor großen Importen oder Massen-Änderungen empfiehlt sich ein Sofort-Export des betroffenen Mandanten.',
      'Betreiber-Werkzeug (Kommandozeile, mit Admin-Schlüssel): scripts/tenant-backup.mjs',
      'Aufruf: export --org <Mandant>  → erzeugt eine JSON-Sicherung nur dieses Mandanten.',
    ]},
    { titel: 'Einen einzelnen Mandanten wiederherstellen', typ: 'info', punkte: [
      'Firebase spielt Sicherungen immer in eine NEUE Datenbank zurück (nie direkt „an Ort und Stelle").',
      '1. Sicherung bzw. Zeitpunkt in eine neue Datenbank klonen: Firestore → Notfallwiederherstellung.',
      '2. Nur den einen Mandanten aus dem Klon holen: export --org <Mandant> --database <Klon-Name>.',
      '3. In die Live-Datenbank zurückspielen: restore --file <JSON> --yes – schreibt AUSSCHLIESSLICH diesen Mandanten.',
      'Alle anderen Kunden bleiben unberührt. Danach die Klon-Datenbank wieder löschen.',
    ]},
    { titel: 'Wichtig zu wissen', typ: 'warn', punkte: [
      'Wiederhergestellt werden kann nur, was zum Sicherungszeitpunkt vorhanden war – vor riskanten Aktionen also zuerst sichern.',
      'Sicherung und Wiederherstellung sind reine Betreiber-Aufgaben; der Kunde führt so etwas nie aus.',
      'Ausführliche Befehle: Dateien KUNDEN-ONBOARDING.md und NOTFALL-RESTORE.md im Projekt.',
    ]},
  ],
};

// ── Kunden-Onboarding (Betreiber-Ablauf, neuen Mandanten anlegen) ──────────────
export const SI_ONBOARDING = {
  intro: 'Reihenfolge zum Einrichten eines neuen Kunden (Mandant) – jeder Schritt baut auf dem vorigen auf. Alles im Desktop als Superadmin. URL für den Kunden: infa-planungsmanager.web.app',
  schritte: [
    { nr: 1, titel: 'Mandant anlegen', wo: 'Admin → Mandanten → „Anlegen"', punkte: [
      'Name (z. B. „Stadt Musterhausen") + eindeutiger Stadt-Code (Anmelde-Code für alle Nutzer).',
      'Keine Demo-Codes/-Mandanten verwenden oder vermischen.' ]},
    { nr: 2, titel: 'Module & Rollen festlegen', wo: 'Admin → Benutzer & Rollen → „Rollen & Module"', punkte: [
      'Je Kundenrolle festlegen, welche Module sichtbar sind (z. B. Reinigungssysteme, Einsatzplaner, EWK, KI-Analysen).' ]},
    { nr: 3, titel: 'Lizenzen hinterlegen', wo: 'Admin → Lizenzen', punkte: [
      'Artikel-/Personen-Lizenzen, AGK-Satz und ggf. Rabatt für diesen Mandanten; Ist-Zähler prüfen.' ]},
    { nr: 4, titel: 'Zugänge anlegen', wo: 'Admin → Benutzer & Rollen → „Personen & PINs"', punkte: [
      'Admin-Zugang des Kunden (Name + PIN + Rolle Org-Admin); weitere Personen nach Bedarf.',
      'PIN sicher übergeben (nicht per unverschlüsselter E-Mail).' ]},
    { nr: 5, titel: 'Projekt & Datenmodell', wo: 'Verwaltung → Projekte / Felder & Listen', punkte: [
      'Erstes Projekt anlegen; Wertelisten, Kundenfelder, Soll-/Häufigkeitsfeld und Pflichtfelder konfigurieren.' ]},
    { nr: 6, titel: 'Daten importieren', wo: 'Verwaltung → Import / Export', punkte: [
      'Excel/CSV oder Shapefile über den Import-Assistenten (Spalte → Feld). Nur echte Kundendaten.' ]},
    { nr: 7, titel: 'Touren & Fahrer-Zuweisung', wo: 'Verwaltung → Touren / Fahrer-Zuweisung', punkte: [
      'Touren anlegen, ggf. Routen berechnen; festlegen, welche Person welche Tour sieht.',
      'Hinweis: Fahrer ohne jede Zuweisung sieht ALLE Touren.' ]},
    { nr: 8, titel: 'Erste Sicherung ziehen', wo: 'Kommandozeile (Betreiber)', punkte: [
      'scripts/tenant-backup.mjs export --org <orgId>  → Ausgangs-Snapshot; vor riskanten Aktionen wiederholen.' ]},
    { nr: 9, titel: 'Übergabe an den Kunden', wo: '—', punkte: [
      'URL infa-planungsmanager.web.app, Stadt-Code + Zugangsdaten (sicher), Hinweis aufs Handbuch (Avatar-Menü).' ]},
  ],
  hinweise: [
    'Rechtlich: AV-Vertrag (Auftragsverarbeitung, DSGVO) mit der Kommune abschließen. Der Mandanten-Export dient zugleich dem Auskunfts-/Löschanspruch.',
    'Testdaten-Hygiene: eindeutiger Stadt-Code, keine Demo-Objekte im Mandanten, nur benötigte Module freigeschaltet, erster Backup-Export gezogen.',
  ],
};

// ── Lizenzen & Dienste (Komponenten-Compliance) ──────────────
// status: 'ok' (rechtlich/kommerziell unbedenklich) | 'achtung' (Bedingung/Restrisiko beachten) | 'risiko' (vor breitem Produktiveinsatz klären)
// Gruppen je Einsatzgebiet. Pflegepflicht: bei neuer externer Bibliothek/Dienst hier ergänzen.
export const SI_DIENSTE = [
  { gruppe: 'Programmbibliotheken (im Browser)', items: [
    { name: 'Leaflet (lokal ausgeliefert)', zweck: 'Kartendarstellung in allen Apps', lizenz: 'BSD-2-Clause (Open Source)', frei: 'Ja, dauerhaft – auch kommerziell', status: 'ok', hinweis: 'Frei nutzbar, keine Lizenzkosten; Copyright-Hinweis im Quellcode. Seit 21.07.2026 samt Marker-Clustering und Rotations-Erweiterung mit der App selbst ausgeliefert (/vendor, prüfsummen-verifizierte Originale) — kein Nachladen von unpkg.com mehr: robust gegen blockierende Firmen-Proxys und keine IP-Übertragung an den CDN-Betreiber.' },
    { name: 'Chart.js', zweck: 'Diagramme (Controlling, Einsatzleiter)', lizenz: 'MIT (Open Source)', frei: 'Ja, dauerhaft – auch kommerziell', status: 'ok', hinweis: 'Frei nutzbar, keine Auflagen.' },
    { name: 'SheetJS (Community)', zweck: 'Excel-Import', lizenz: 'Apache-2.0 (Open Source)', frei: 'Ja – Community-Edition kommerziell frei', status: 'ok', hinweis: 'Die genutzte Community-Edition ist frei; nur die optionale „Pro"-Variante kostet.' },
    { name: 'proj4js', zweck: 'Koordinaten-Umrechnung bei Import und Shapefile-Export (Gauß-Krüger/UTM ↔ WGS84)', lizenz: 'MIT (Open Source)', frei: 'Ja, dauerhaft – auch kommerziell', status: 'ok', hinweis: 'Reine Rechen-Bibliothek im Browser, keine externen Aufrufe/Datenübertragung. Beim Excel-Import: alte Katasterkoordinaten (Gauß-Krüger, EPSG:31466/67) → WGS84. Beim Shapefile-Export: WGS84 → ETRS89/UTM 32N (EPSG:25832).' },
    { name: 'Firebase JS SDK', zweck: 'Verbindung zur Datenbank/Anmeldung', lizenz: 'Apache-2.0 (Client-Bibliothek)', frei: 'Ja – Kosten nur über die Dienste (s. u.)', status: 'ok', hinweis: 'Die Bibliothek ist frei; Kosten entstehen nur durch die Nutzung der Google-Dienste.' },
  ]},
  { gruppe: 'Karten & Geodaten', items: [
    { name: 'basemap.de (amtliche Standardkarte — Farbe + Graustufen)', zweck: 'Standard-Hintergrundkarte in allen Apps', lizenz: 'CC BY 4.0 (BKG / AdV)', frei: 'Ja – auch kommerziell/kommunal, mit Quellenangabe', status: 'ok', hinweis: 'Amtliche Karte der deutschen Vermessungsverwaltung (Bundesamt für Kartographie und Geodäsie). Kostenfrei, DSGVO-konform (deutsche Behördenserver), bundesweit einheitlich. Ersetzt seit 15.06.2026 den OSM-Kachelserver UND das Esri-Satellitenbild (beide waren rechtlich riskant).' },
    { name: 'Amtliche Luftbilder/WMS (Landes-DOP, je Stadt)', zweck: 'Scharfes Luftbild (20 cm) je Projekt — als „Luftbild" wählbar', lizenz: 'dl-de/by-2-0 bzw. dl-de/zero-2-0 / CC BY 4.0 (Landesvermessung)', frei: 'Ja – auch kommerziell, mit Quellenangabe', status: 'ok', hinweis: 'Amtliche Geobasisdaten der Landesvermessung — rechtlich sauberste, schärfste Luftbildquelle. Eingebunden: RLP (Ludwigshafen), Hessen (Rüsselsheim), NRW (Rheine, Ahlen, Bonn — inkl. transparentem Beschriftungs-Overlay mit Straßennamen, Dienst wms_nw_dop_overlay), Niedersachsen (Bad Rothenfelde, Wilhelmshaven). Hinweis: Ein freies transparentes Straßennamen-Overlay gibt es bisher nur in NRW; Hessen/Niedersachsen bieten dafür keinen kostenfreien Dienst. Neue Städte: passenden Landesdienst unter WMS-Karten ergänzen.' },
    { name: 'OpenRouteService (Routing inkl. Optimierung)', zweck: 'Tour-Fahrstrecken + Reihenfolge-Optimierung (Matrix bis 50 Stopps, ab 51 der Optimierungs-Endpunkt /optimization) sowie Routenlinie und Navigation in der Fahrer-App', lizenz: 'Dienst von HeiGIT; Daten OSM/ODbL', frei: 'Kostenloser Plan mit Tageslimit (ca. 2.000 Routen/Tag, 500 Matrix/Tag, 500 Optimierungen/Tag) + Job-Limit je Optimierungs-Anfrage', status: 'achtung', hinweis: 'WICHTIG: Der öffentliche ORS-Schlüssel ist gratis, aber „Fair-Use" — laut Nutzungsbedingungen NICHT für kommerziellen Dauerbetrieb gedacht und ohne Verfügbarkeitsgarantie. Je Stadt eigener API-Schlüssel; Navigation (Turn-by-turn) und Optimierung erhöhen das Volumen. VOR produktivem/breitem Rollout: eigenen ORS-Server selbst hosten (Open Source, eigene OSM-Daten → keine Fremd-ToS, kein Tages-/Job-Limit, nur Serverkosten) ODER kostenpflichtigen Tarif buchen. OSM-Namensnennung bleibt. Der frühere öffentliche OSRM-Demo-Server wird nicht mehr genutzt. Kosten (grobe Schätzung): gehosteter Pay-per-Call-Dienst ~0,50–5 €/1.000 Routen bzw. ~5–15 €/1.000 Optimierungen (oft Gratis-Kontingent) — Kostentreiber ist die Live-Navigation, nicht die Routenplanung (nur Planung meist gratis/wenige €; mit Navigation über viele Fahrer/Städte schnell drei-/vierstellig €/Monat). Self-Host ~20–60 €/Monat pauschal, unbegrenzt. Routing im Code gekapselt → Anbieterwechsel ohne großen Umbau.' },
    { name: 'Nominatim (Adress-/Straßensuche)', zweck: 'Adress-Suchfeld auf der Karte + Betriebshof-Adresse → Koordinaten', lizenz: 'Adressdaten ODbL (OSM); OSMF-Nutzungsrichtlinie', frei: 'Ja, aber nur Einzelsuchen (kein Tippen-Autocomplete), max. 1/Sek., mit Quellenangabe', status: 'achtung', hinweis: 'Das Suchfeld sucht nur bei Enter (eine Anfrage pro Suche) und ist auf Deutschland/Stadt eingegrenzt — damit policy-konform. Quellenangabe ist eingebunden. Für intensive Nutzung oder amtliche Genauigkeit kann der Dienst gegen den BKG-Geokodierungsdienst (für Kommunen kostenfrei, Zugang beim BKG/ZSGT beantragen) getauscht werden — die Suchfunktion ist dafür gekapselt.' },  ]},
  { gruppe: 'Plattform & Sicherheit', items: [
    { name: 'Google Firebase / Cloud (Datenbank, Hosting, Speicher, Anmeldung, Funktionen, KI)', zweck: 'Gesamtes Backend', lizenz: 'Kommerzieller Google-Cloud-Vertrag (Pay-as-you-go)', frei: 'Großzügiges Gratis-Kontingent, danach nutzungsbasiert', status: 'ok', hinweis: 'Rechtlich sauber (kommerzieller Anbieter, EU-Region Frankfurt). Für DSGVO Auftragsverarbeitungsvertrag mit Google abschließen (s. DSGVO-Checkliste).' },
    { name: 'Google reCAPTCHA v3 (App Check)', zweck: 'Schutz vor fremden Clients', lizenz: 'Google-Nutzungsbedingungen', frei: 'Gratis bis 1 Mio Prüfungen/Monat', status: 'ok', hinweis: 'Kostenlos im erwartbaren Rahmen. In der Datenschutzerklärung (Ziffer 4) erwähnt: reCAPTCHA v3 läuft unsichtbar zur Missbrauchsabwehr und übermittelt technische Geräte-/Nutzungssignale an Google, nicht zu Werbezwecken.' },
  ]},
  { gruppe: 'Schriften', items: [
    { name: 'DM Sans / DM Mono (lokal ausgeliefert)', zweck: 'Schriftarten der Desktop-Oberfläche', lizenz: 'SIL Open Font License 1.1', frei: 'Ja – mit der App selbst ausgeliefert', status: 'ok', hinweis: 'DSGVO-konform: Schriften liegen lokal als woff2 unter /fonts und werden von der eigenen Domain geladen — keine Übertragung an Google, kein Nachladen vom Google-CDN (vgl. LG München 2022). Mobile-/Erfassungs-/Einsatzleiter-App nutzen System-Schriften.' },
  ]},
];
