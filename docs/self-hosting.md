# Self-Hosting: Routing & Karten für die INFA-Navi

Anleitung, um Navigation (Routing) und Kartenkacheln **selbst zu betreiben** —
unabhängig von den kostenlosen Community-/Demo-Servern, ohne Anfragelimit und
DSGVO-freundlich (Daten in Deutschland).

> **Warum?** Die Navi-Beta (`navi.html`) nutzt im Test den **OSRM-Demo-Server**
> (`router.project-osrm.org`) und **OSM-Tiles** (`tile.openstreetmap.org`). Beide
> sind gratis, aber **Fair-Use** und **nicht für den gewerblichen Dauerbetrieb**
> freigegeben — bei Last wird gedrosselt/geblockt. Self-Hosting löst das für
> ~15 €/Monat.

---

## Empfehlung: OSRM (nicht Valhalla)
Die App ist auf die **OSRM-API** gebaut. Ein selbst gehostetes OSRM spricht
**dieselbe API** → der Umstieg ist nur ein **URL-Wechsel** in `src/navi.js`
(siehe unten), kein Code-Umbau.

## Komponenten (alles Open Source)
| Dienst | Aufgabe | ersetzt |
|---|---|---|
| **OSRM** | Routing + Turn-by-turn | `router.project-osrm.org` |
| **TileServer-GL** | Kartenkacheln | `tile.openstreetmap.org` |
| **Caddy** | Reverse-Proxy + automatisch HTTPS | — (Pflicht, sonst „Mixed Content") |

> **HTTPS ist Pflicht:** Die App läuft auf HTTPS (Firebase Hosting). Routing-/
> Tile-Endpunkte **müssen** ebenfalls HTTPS sein, sonst blockt der Browser.

---

## 1) Server
Kleiner VPS in Deutschland, z. B. **Hetzner CPX31** (4 vCPU / 8 GB RAM / 160 GB).
Docker + Docker-Compose installieren. Eine (Sub-)Domain mit zwei A-Records auf
die Server-IP zeigen lassen:
- `route.infra.example.de`
- `tiles.infra.example.de`

## 2) Regions-Daten vorbereiten (einmalig)
```bash
mkdir -p ~/navi && cd ~/navi

# OSM-Extrakt der Region (Beispiel: Hessen). Liste: https://download.geofabrik.de
wget https://download.geofabrik.de/europe/germany/hessen-latest.osm.pbf -O region.osm.pbf

# OSRM vorverarbeiten (MLD-Pipeline, 3 Befehle)
docker run -t -v $PWD:/data osrm/osrm-backend osrm-extract  -p /opt/car.lua /data/region.osm.pbf
docker run -t -v $PWD:/data osrm/osrm-backend osrm-partition /data/region.osrm
docker run -t -v $PWD:/data osrm/osrm-backend osrm-customize /data/region.osrm

# Kacheln: fertige MBTiles der Region holen und nach ./tiles/region.mbtiles legen.
# Quellen: https://data.maptiler.com/downloads/  oder  https://extract.bbbike.org
mkdir -p tiles
# cp <download>.mbtiles tiles/region.mbtiles
```

## 3) docker-compose.yml
```yaml
services:
  osrm:
    image: osrm/osrm-backend
    command: osrm-routed --algorithm mld /data/region.osrm
    volumes: ["./:/data"]
    restart: unless-stopped

  tiles:
    image: maptiler/tileserver-gl
    command: --mbtiles /data/region.mbtiles
    volumes: ["./tiles:/data"]
    restart: unless-stopped

  caddy:
    image: caddy
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    restart: unless-stopped

volumes:
  caddy_data: {}
```

## 4) Caddyfile (HTTPS automatisch via Let's Encrypt)
```
route.infra.example.de {
    reverse_proxy osrm:5000
}
tiles.infra.example.de {
    reverse_proxy tiles:8080
}
```

## 5) Starten
```bash
docker compose up -d
# Test:
curl "https://route.infra.example.de/route/v1/driving/8.19,52.118;8.175,52.111?overview=false"
# erwartet: {"code":"Ok",...}
```

---

## 6) App umstellen (1-Zeilen-Switch)
In **`src/navi.js`** ganz oben die zwei Konstanten anpassen:
```js
const NAVI_OSRM_BASE = 'https://route.infra.example.de';
const NAVI_TILE_URL  = 'https://tiles.infra.example.de/{z}/{x}/{y}.png';
```
Dann `npm run build` + deploy. Mehr ist nicht nötig — die gesamte Navi nutzt
ausschließlich diese beiden Konstanten.

> Die TileServer-GL-URL kann je nach Style abweichen
> (z. B. `/styles/<style>/{z}/{x}/{y}.png` oder `/data/region/{z}/{x}/{y}.pbf`
> für Vektor). Nach dem Start zeigt `https://tiles.infra.example.de/` die
> verfügbaren Endpunkte.

---

## Kosten & Dimensionierung (eine Region)
| Posten | Bedarf | Kosten |
|---|---|---|
| Server (Hetzner CPX31, Standort DE) | OSRM ~2–4 GB RAM, Tiles ~1–2 GB | **~14 €/Monat** |
| Domain / Subdomain | 1 Eintrag | ~1 €/Monat |
| Software (OSRM, TileServer-GL, Caddy) | — | **0 €** |
| **Gesamt** | | **~15 €/Monat** |

- **Kein Anfragelimit, keine Drosselung, keine API-Abrechnung.**
- OSRM schafft auf dieser Hardware tausende Anfragen/Sekunde → 5 Fahrer mit
  Reroutes sind ein Bruchteil davon.

## Pflege
- OSM-Daten alle paar Wochen/Monate aktualisieren:
  `wget` neuer `.pbf` → die **3 OSRM-Befehle** erneut → `docker compose restart osrm`.
  Lässt sich als Cronjob automatisieren.

## Pragmatische Zwischenstufe
Nur **OSRM** selbst hosten und für Kacheln die **MapTiler-Gratisstufe**
(~100k Kachel-Ladungen/Monat) nutzen → spart den Tile-Teil für den Start.
Dafür `NAVI_TILE_URL` auf die MapTiler-URL (mit eigenem Key) setzen.
