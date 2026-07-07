# Konzept: Tag-/QR-/NFC-Zuordnung in der Fahrer-App

> Entscheidungsvorlage, Stand 06.07.2026. Noch nichts implementiert.
> Ziel: Vor Ort ein Objekt (z. B. Papierkorb) per Scan sofort aufrufen und melden
> (Füllgrad / erledigt / nicht erledigt).

## 1. Ausgangslage / Nutzungsszenario
Mitarbeiter steht am Objekt, hält das Gerät an ein **NFC-Tag** oder scannt einen
**QR-Code** → die Fahrer-App springt direkt auf den Datensatz → Füllgrad melden
(ein Tipp = erledigt). Ersetzt das manuelle Suchen in Liste/Karte.

**Gerätepark: gemischt iOS + Android** (bestätigt). Das ist die zentrale Randbedingung.

## 2. Was heute schon existiert (Anknüpfungspunkte, `src/mobile.js`)
- Objekte der Tour liegen als Array `trees` vor, adressiert über die Firestore-Doc-`id`.
- `openSheet(id)` öffnet das Detail-Sheet eines Objekts.
- **Füllgrad-Schnellmeldung existiert** (`reportFuellgrad(id,v)` → `saveReport`), ein Tipp = erledigt.
- Tour ist **offline gecached** (IndexedDB-Queue, backend-unabhängig).
- Rules: Fahrer darf an Objekten nur `onlyStatusFields` schreiben — der Scan öffnet nur,
  gemeldet wird über den bestehenden, regelkonformen Pfad. **Kein Rules-Eingriff nötig.**

→ Der Kern „Scan → Datensatz → Meldung" ist **nur**: Kennung scannen → `trees.find(...)` → `openSheet(id)`.

## 3. Realitäts-Checks (bestimmen den Aufwand mehr als der Code)
- **„Automatisch beim Annähern" gibt es im Web nicht.** NFC ist ein **Tap** (~1–4 cm),
  kein Funk auf Distanz. Hands-free-Proximity bräuchte BLE-Beacons (aus dem Browser nicht
  ansprechbar). Realistische UX: *App offen → ans Tag tippen → Datensatz offen*.
- **Web NFC (`NDEFReader`) nur auf Android-Chromium.** Nicht iOS (dort NFC nur in nativen
  Apps via Core NFC), nicht Desktop-Safari/Firefox. Bei gemischtem Park **funktioniert NFC
  auf den iPhones nie**.
- **QR/Barcode per Kamera läuft plattformübergreifend inkl. iOS.** Der native
  `BarcodeDetector` ist Chromium-only → auf iOS eine kleine JS/WASM-Decoder-Lib als Fallback.

## 4. Empfehlung: QR als Basis + Web-NFC als Android-Zusatz (Progressive Enhancement)
Da der App-seitige Anknüpfungspunkt für beide identisch ist (`openSheet(id)`), lässt sich
**ein** Scan-Ergebnis-Pfad bauen und mit **mehreren Eingängen** füttern:

- **Eingang 1 – QR (alle Geräte):** Kamera-Overlay, Code dekodieren.
- **Eingang 2 – NFC (nur Android, optional):** `NDEFReader.scan()`, Button nur zeigen wenn verfügbar (Feature-Detection).
- **Eingang 3 – Deep-Link `mobil.html?obj=<kennung>`:** funktioniert auch, wenn der QR
  mit der **System-Kamera** gescannt wird (öffnet dann die App direkt auf dem Objekt).

### Tag-Inhalt
Eine URL: `https://baumbewaesserung.web.app/mobil.html?obj=<KENNUNG>`
- **KENNUNG = Doc-`id`** → robusteste Auflösung (direkt `openSheet`), aber opak.
- **oder KENNUNG = `baumnr`/`baumId`** (Objektnummer) → menschenlesbar, steht ggf. eh am Objekt;
  erfordert eindeutige Objektnummern + Auflösung `baumnr → id`.
- Entscheidung offen (siehe §9). Beides mit dem gleichen `?obj=`-Mechanismus abbildbar.

### Auflösungs-Logik
1. In geladener Tour suchen (offline) → gefunden: `openSheet`.
2. Sonst projektweiter Nachschlag (1 Firestore-Read, nur online) → „Objekt gehört nicht zu
   deiner Tour" sauber anzeigen statt Fehler.
3. Sonst „Tag/Code unbekannt".

## 5. Tag-Provisionierung (eigener Arbeitsblock, skaliert mit Objektzahl)
Wiesbaden hat z. B. **3.142 Objekte** — Provisionierung ist der eigentliche Roll-out-Aufwand.
- **QR-Labels erzeugen:** QR-Generator (z. B. npm `qrcode`) im Desktop/Erfassung, Batch-Druck-
  Layout (Objektnummer + QR), wetterfeste Aufkleber. Kosten Label ~0,05–0,20 €/Stück.
- **NFC-Tags beschreiben (optional, Android):** Tag-Typ NTAG213/215, per Web-NFC-Schreibfunktion
  in der App oder anfangs mit Tool wie „NFC Tools". Kosten Tag ~0,10–0,30 €/Stück.
- **Anbringung:** wetter-/UV-fest, Vandalismus bedenken; Position reproduzierbar (immer gleiche Stelle).

## 6. Aufwand (Code, grobe Schätzung)
| Baustein | Aufwand |
|---|---|
| Deep-Link `?obj=` + Auflösung (Tour → projektweit → Fehler) | 0,5–1 T |
| QR-Scanner in App (Lib, Kamera-Overlay, Decode, `BarcodeDetector`+WASM-Fallback) | 1–2 T |
| Web-NFC-Leser (Android, Feature-Detection, Button) | 0,5 T |
| QR-Label-Erzeugung + Druck-Layout (Desktop/Erfassung) | 1–2 T |
| NFC-Schreibfunktion (optional) | 0,5–1 T |
| Offline-Verhalten, Tests, Feinschliff | ~1 T |
| **Nutzbarer QR-Kern (Scan→Datensatz→Meldung)** | **~2–3 T** |
| **Voll-Ausbau QR+NFC+Provisionierung** | **~1–1,5 Wochen** |

**Verdict: Kein sehr großer Eingriff** für den App-Teil (Detail-Sheet + Füllgrad existieren).
Kostentreiber sind nicht der Code, sondern (1) Provisionierung/Hardware, (2) neue Lib
(→ Pflege-Eintrag „Lizenzen & Dienste"), (3) operatives Anbringen der Tags.

## 7. Kosten (Hardware, Beispiel 3.142 Objekte)
- QR-Labels: ~160–630 € Material + Druck/Klebe-Arbeit.
- NFC-Tags (falls Android-Zusatz gewünscht): ~310–950 € + Beschreiben/Kleben.
- Empfehlung: QR flächig, NFC nur optional/pilotweise.

## 8. Risiken & Grenzen
- **iOS-NFC unmöglich** ohne native App → QR ist Pflicht-Basis.
- **„Auto beim Annähern"** nicht realisierbar (Tap/Scan nötig) — Erwartung im Team steuern.
- **Tag-Verlust/Beschädigung** → Fallback manuelle Suche muss bleiben.
- **Mehrere Objekte am selben Standort** (vgl. Konzept „Standort-Bündel deckungsgleich") →
  ein Tag je Objekt, nicht je Standort; sonst Verwechslung.
- **Neue Abhängigkeit** (QR-Decoder/-Generator) → `SI_DIENSTE`-Eintrag (Lizenz/Kosten).

## 9. Offene Entscheidungen
1. Tag-Inhalt: Doc-`id` (robust) vs. Objektnummer (`baumnr`, lesbar)?
2. NFC-Android-Zusatz jetzt mitnehmen oder erst QR flächig?
3. Provisionierung: Labels zentral drucken vs. in der Erfassung „on demand"?
4. Pilot-Umfang (welches Projekt / wie viele Objekte zuerst)?

## 10. Empfohlene Phasen
1. **Spike (<1 T):** `?obj=`-Deep-Link + ein Scan-Eingang, Kette an 2–3 Test-QRs zeigen.
2. **QR-Pilot:** Labels für einen kleinen Objekt-Satz, Feldtest mit 1–2 Fahrern.
3. **Rollout QR** flächig; **NFC** optional für Android-Geräte als Komfort-Zusatz.
