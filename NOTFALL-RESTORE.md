# Notfall-Restore — Runbook (Betreiber)

Wiederherstellung von Daten im Ernstfall. **Reine Betreiber-Aufgabe** (Admin-Schlüssel nötig) —
der Kunde führt das nie aus. Werkzeug: `scripts/tenant-backup.mjs` (Details im Datei-Kopf).

Voraussetzung: Service-Account-Schlüssel (Firebase Console → Projekteinstellungen → Dienstkonten →
„Neuen privaten Schlüssel generieren"). Pfad unten als `<sa.json>`.

---

## Was automatisch abgesichert ist
- **Datenbank (Firestore):** Point-in-Time 7 Tage + tägliche Backups (7 T) + wöchentliche (14 Wo) + Lösch-Schutz.
- **Fotos/Dokumente (Storage):** Objektversionierung + vorläufiges Löschen (7 T).
- Läuft automatisch für **alle** Mandanten. Nichts zu tun.

---

## Fall A — Schnelles Undo (Sicherung war VOR dem Vorfall vorhanden)
Wenn vor der riskanten Aktion ein `export` gezogen wurde:
```
node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key "<sa.json>"        # Dry-Run (zeigt Plan)
node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key "<sa.json>" --yes   # echt zurückspielen
```
Danach Desktop neu laden (Strg+F5). Schreibt **nur** den Mandanten aus der Datei; andere Kunden unberührt.

## Fall B — Einzelnen Mandanten aus dem automatischen Backup wiederherstellen
Wenn keine frische manuelle Sicherung existiert (Standardfall im Echtbetrieb):

**1. Backup/Zeitpunkt in eine NEUE Datenbank klonen**
Firebase Console → Firestore → **Notfallwiederherstellung** → „Alle Sicherungen aufrufen"
(bzw. Point-in-Time-Wiederherstellung) → Wiederherstellen in eine **neue** Datenbank, z. B. `recovered-JJJJMMTT`.
(Dauert einige Minuten; Live-Datenbank bleibt unberührt.)

**2. Nur den betroffenen Mandanten aus dem Klon exportieren**
```
node scripts/tenant-backup.mjs export --org <orgId> --database recovered-JJJJMMTT --key "<sa.json>"
```

**3. In die Live-Datenbank zurückspielen**
```
node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key "<sa.json>"          # Dry-Run
node scripts/tenant-backup.mjs restore --file backups/<datei>.json --key "<sa.json>" --yes     # echt
```

**4. Aufräumen:** die Klon-Datenbank `recovered-JJJJMMTT` wieder löschen (spart Speicherkosten).

---

## Optionen & Hinweise
- **`--prune`** (nur bewusst einsetzen): löscht beim Restore zusätzlich Dokumente dieses Mandanten, die
  in der Sicherung NICHT enthalten sind (also nach dem Sicherungszeitpunkt neu entstanden). Ohne `--prune`
  werden nur fehlende Docs neu angelegt und vorhandene überschrieben.
- **orgId ermitteln:** `node scripts/tenant-backup.mjs list --key "<sa.json>"`
- **Grenze:** Wiederhergestellt werden kann nur, was zum Sicherungszeitpunkt existierte.
- **Umfang je Mandant:** orgs/{X} (+ roles), projects (+ trees/tours/routes/reasons/tourHistory/arten …),
  drivers, leistungsereignisse, messages, recipients, users, availability. NICHT: globale/flüchtige
  Collections (config, appsettings, usage, errors, presence, tokens).
- Die JSON-Sicherungen (`backups/`) und der Schlüssel sind ge-gitignored — enthalten Kundendaten bzw.
  Vollzugriff und dürfen nicht ins Repo/geteilt werden.
