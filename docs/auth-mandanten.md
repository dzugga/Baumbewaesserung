# Auth & Mehrmandantenfähigkeit — Design + Aktivierungs-Runbook

Stand: Phase 1 angelegt (Code im Repo, **nichts deployt/aktiv**). Der Produktiv­betrieb läuft unverändert weiter, bis die Aktivierung (unten) bewusst durchgeführt wird.

## Modell (minimal-invasiv)
- Projekte bleiben **top-level** (`projects/{id}/…`) — kein Pfad-Umbau.
- Jedes Dokument trägt **`orgId`** (denormalisiert) → Security Rules prüfen Mandanten-Zugehörigkeit **ohne** teures `get()` auf das Parent-Projekt (wichtig für Fahrer-Schreiblast/Kosten).
- Rolle & Org kommen aus **Custom Claims**: `request.auth.token.{orgId, role}`.

```
orgs/{orgId}             name, code (Kürzel für Fahrer-Login), createdAt
users/{uid}             email, displayName, orgId, role  (für Admin-UI; maßgeblich sind die Claims)
drivers/{driverId}      orgId, name, nameLower, pinSalt, pinHash, active, failedAttempts, lockedUntil
projects/{projectId}    + orgId
  trees|tours|routes|reasons|tourHistory/{id}   + orgId
```

## Rollen
| Rolle | App | Rechte |
|---|---|---|
| `superadmin` | – | alles, über alle Mandanten |
| `orgadmin` | Desktop | eigene Org: Nutzer/Fahrer/Projekte, alle Daten |
| `planer` | Desktop | lesen/schreiben aller Projektdaten der Org |
| `erfasser` | Erfassung | Objekte anlegen/bearbeiten in der Org |
| `fahrer` | Mobile | **nur** Status-Felder an Bäumen der Org schreiben |

Fahrer-Feldschutz (Rules): ein `fahrer` darf nur
`lastStatus, lastReason, lastNote, lastDriver, lastReportAt, history, datum, zustand`
ändern und **nicht** `orgId`.

## Fahrer-Login: Name + PIN
Firebase Auth kann „Name+PIN" nicht direkt → Lösung über **Custom Tokens**:
1. Admin vergibt PIN (`setDriverPin`) → es wird **nur ein scrypt-Hash + Salt** gespeichert, nie die PIN im Klartext.
2. Fahrer gibt Name + PIN ein → Cloud Function `driverLogin` prüft den Hash und stellt ein Custom Token mit Claims `{orgId, role:'fahrer', driverId}` aus.
3. App meldet sich an: `firebase.auth().signInWithCustomToken(token)`.

Schutz: **6-stellige PIN**, **Sperre nach 5 Fehlversuchen** (15 Min), generische Fehlermeldung (keine Account-Enumeration). Blast-Radius minimal, da `fahrer` nur Status-Felder schreiben darf.

## Was im Repo liegt (Phase 1, inert)
| Datei | Zweck |
|---|---|
| `firestore.rules` | Mandanten-/Rollen-Regeln (noch nicht in `firebase.json` verdrahtet → nicht deploybar bis Aktivierung) |
| `functions/auth.js` | `driverLogin`, `setDriverPin`, `setUserRole` |
| `functions/scripts/backfill-orgid.mjs` | `orgId` auf Bestandsdaten + `orgs` anlegen (Dry-Run-Default) |
| `functions/scripts/set-claims.mjs` | Bootstrap der ersten Custom Claims |

`firestore.rules` ist **bewusst noch nicht** in `firebase.json` referenziert, damit ein versehentliches `firebase deploy` die strikten Rules **nicht** scharfschaltet.

---

# Aktivierungs-Runbook (das machst DU, in dieser Reihenfolge)

> Bis Schritt 6 ändert sich **nichts** am Live-Verhalten. Schritt 6 (Rules scharf) ist der Punkt, ab dem alle Apps Login brauchen — vorher Auth + Backfill erledigen!

### 1. Firebase Authentication aktivieren
Konsole → **Authentication** → Sign-in method:
- **E-Mail/Passwort** aktivieren (für Planer/Admins).
- Custom Tokens (Fahrer) brauchen **keinen** extra Provider — funktionieren immer.

### 2. Functions deployen
```
cd functions
npm install                  # firebase-admin ist neu dazugekommen
cd ..
npx.cmd firebase deploy --only functions:driverLogin,functions:setDriverPin,functions:setUserRole
```

**Wichtig (einmalig): `createCustomToken`-Berechtigung.** Damit `driverLogin`
Tokens signieren darf, braucht das Laufzeit-Service-Konto der Functions die Rolle
**Service Account Token Creator** (sonst Fehler `iam.serviceAccounts.signBlob denied`):
```
gcloud.cmd projects add-iam-policy-binding baumbewaesserung ^
  --member="serviceAccount:1001991004222-compute@developer.gserviceaccount.com" ^
  --role="roles/iam.serviceAccountTokenCreator" --condition=None
```
(Bereits gesetzt am 09.06.2026.)

### 3. Backfill ausführen (orgId auf Bestandsdaten + orgs anlegen)
Erst Credentials bereitstellen (eines):
```
gcloud auth application-default login
# ODER:  $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\pfad\serviceAccount.json"
```
Mapping in `functions/scripts/backfill-orgid.mjs` prüfen (ORGS + PROJECT_ORG_MAP), dann:
```
cd functions
node scripts/backfill-orgid.mjs            # DRY-RUN: zeigt, was passieren würde
node scripts/backfill-orgid.mjs --apply    # schreibt wirklich
```

### 4. Ersten Admin anlegen + Claims setzen
- Konsole → Authentication → **Nutzer hinzufügen** (E-Mail/Passwort). UID kopieren.
- Claims setzen:
```
cd functions
node scripts/set-claims.mjs <UID> org_ruesselsheim superadmin
```
- Weitere Admins/Planer dann bequem per `setUserRole` aus einer Admin-UI.

### 5. Fahrer + PINs anlegen
Aufruf von `setDriverPin` (als orgadmin/superadmin eingeloggt), z. B. aus der Desktop-Admin-UI:
```
setDriverPin({ name: "Max Mustermann", orgId: "org_ruesselsheim", pin: "123456" })
```
→ legt `drivers/{id}` mit Hash an. Bestehende PIN ändern: gleiches Aufruf mit `driverId`.

### 6. App-Integration (separater Build) — dann Rules scharf
- App-Logins einbauen (Mobile: Name+PIN → `driverLogin` → `signInWithCustomToken`; Desktop/Erfassung: E-Mail-Login; `orgId` beim Anlegen mitschreiben; Projekte nach Org filtern).
- **Rules testen** (Emulator / Konsole „Rules Playground") mit echten Token-Claims.
- `firestore` in `firebase.json` ergänzen:
```json
"firestore": { "rules": "firestore.rules" }
```
- Scharfschalten:
```
npx.cmd firebase deploy --only firestore:rules
```

> ⚠ Ab hier: kein Zugriff mehr ohne gültiges Token mit `orgId`/`role`. Vorher sicherstellen, dass alle Apps angemeldet sind und der Backfill vollständig war (jedes Dokument hat `orgId`).

## Rollback
Solange `firestore.rules` **nicht** deployt ist, gilt die bisherige (offene) Regel — einfach Schritt 6 nicht ausführen. Nach dem Scharfschalten: vorherige Rules-Version in der Firebase-Konsole (Firestore → Rules → Verlauf) wiederherstellen.
