# Kunden-Onboarding — Runbook (neuen Mandanten anlegen)

Schritt-für-Schritt zum Einrichten eines neuen Kunden (Mandant). Reihenfolge einhalten —
jeder Schritt baut auf dem vorigen auf. Alles im Desktop-Planer als **Superadmin**.

URL für den Kunden: **https://infa-planungsmanager.web.app**

---

## 1. Mandant anlegen
**Admin → Mandanten → „Anlegen"**
- **Name** (z. B. „Stadt Musterhausen")
- **Stadt-Code** (kurz, eindeutig — der Code, mit dem sich alle Nutzer in den Apps anmelden). Eindeutigkeit wird geprüft.
- ⚠️ **Nicht** die Demo-Codes / Demo-Mandanten (`org_demo_hb`, `demo_symbole`) verwenden oder vermischen.

## 2. Module & Rollen festlegen
**Admin → Benutzer & Rollen → „Rollen & Module"**
- Für die Kundenrollen (Org-Admin / Planer / Fahrer …) festlegen, welche Module sichtbar sind.
- Bewusst entscheiden: z. B. **Reinigungssysteme**, **Einsatzplaner**, **EWK**, **KI-Analysen** an/aus.
- „Benutzer & Rollen" bleibt Superadmin-only (Lizenzkosten) — der Kunde bekommt nur die freigeschalteten Module zu sehen.

## 3. Lizenzen hinterlegen
**Admin → Lizenzen** (Superadmin)
- Für diesen Mandanten die Artikel/Personen-Lizenzen, AGK-Satz und ggf. Rabatt eintragen.
- Ist-Zähler prüfen (Personen mit Zugang etc.).

## 4. Zugänge anlegen
**Admin → Benutzer & Rollen → „Personen & PINs"**
- Den **Admin-Zugang des Kunden** anlegen: Name + PIN + Rolle (Org-Admin).
- Weitere Personen (Planer/Fahrer) nach Bedarf — Login-los (keine Lizenz) oder mit PIN (Lizenz).
- PIN **sicher** an den Kunden übergeben (nicht per unverschlüsselter E-Mail).

## 5. Erstes Projekt + Datenmodell
**Verwaltung → Projekte → anlegen**, dann:
- **Verwaltung → Felder & Listen**: Wertelisten, Kundenfelder, Soll-/Häufigkeitsfeld, Pflichtfelder konfigurieren.
- Objektarten/Reinigungsklassen nach Kundenanforderung.

## 6. Daten importieren
**Verwaltung → Import / Export**
- Excel/CSV oder Shapefile über den Import-Assistenten (Spalte→Feld-Zuordnung).
- ⚠️ Nur echte Kundendaten — keine Demo-Objekte im Mandanten.

## 7. Touren & Fahrer-Zuweisung
- Touren anlegen (**Verwaltung → Touren**), ggf. Routen berechnen.
- **Verwaltung → Fahrer-Zuweisung**: festlegen, welche Person welche Tour in der App sieht.
  (Erinnerung: Fahrer ohne jede Zuweisung sieht ALLE Touren.)

## 8. Erste Sicherung ziehen
Direkt nach der Einrichtung einen Mandanten-Export als Ausgangs-Snapshot:
```
node scripts/tenant-backup.mjs export --org <orgId> --key <sa.json>
```
(Und regelmäßig / vor riskanten Aktionen wiederholen. Wiederherstellung: siehe Kopf von `scripts/tenant-backup.mjs`.)

## 9. Übergabe an den Kunden
- URL: **infa-planungsmanager.web.app**
- Stadt-Code + Zugangsdaten (sicher)
- Hinweis aufs digitale **Handbuch** (Avatar-Menü → Handbuch)

---

## Rechtlich (parallel, nicht im System)
- **AV-Vertrag (Auftragsverarbeitung, DSGVO)** mit der Kommune abschließen.
- Bei Auskunfts-/Löschanspruch: Mandanten-Export (Schritt 8) liefert den vollständigen Datenbestand.

## Testdaten-Hygiene (Checkliste)
- [ ] Stadt-Code eindeutig, keine Demo-Codes
- [ ] Keine Demo-/Screenshot-Objekte im Mandanten
- [ ] Nur benötigte Module freigeschaltet
- [ ] Erster Backup-Export gezogen
