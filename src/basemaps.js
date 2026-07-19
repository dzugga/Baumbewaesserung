// ── Amtliche Standardkarte: basemap.de (BKG / AdV) ───────────────────────────
// Ersetzt den öffentlichen OpenStreetMap-Kachelserver, dessen Nutzungsrichtlinie
// kommerzielle Dauer-/Massennutzung untersagt. basemap.de ist die amtliche Karte der
// deutschen Vermessungsverwaltung: kostenfrei (CC BY 4.0), kommerziell/kommunal nutzbar
// mit Quellenangabe, DSGVO-konform (deutsche Behördenserver), EPSG:3857 (Leaflet-kompatibel).
// WMTS-Kacheln (gecacht, schnell). Quellenangabe ist Pflicht (BASEMAP_ATTR).
export const BASEMAP_ATTR  = '© GeoBasis-DE / BKG · CC BY 4.0';
export const BASEMAP_FARBE = 'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_farbe/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png';
export const BASEMAP_GRAU  = 'https://sgx.geodatenzentrum.de/wmts_basemapde/tile/1.0.0/de_basemapde_web_raster_grau/default/GLOBAL_WEBMERCATOR/{z}/{y}/{x}.png';

// Gemeinsame Tile-Performance-Optionen (flüssigeres Pan/Zoom, weniger Nachladen). crossOrigin für
// den Kartenausdruck (Canvas) und Caching — für basemap.de bewiesen (Fahrer-App nutzt es erfolgreich).
export const TILE_PERF = { keepBuffer: 8, updateWhenZooming: false, updateWhenIdle: false, crossOrigin: true };

// Fertige Leaflet-Ebene (window.L muss geladen sein — Aufruf erst beim Kartenaufbau).
export function basemapLayer(variant = 'farbe', extra = {}) {
  const url = variant === 'grau' ? BASEMAP_GRAU : BASEMAP_FARBE;
  return window.L.tileLayer(url, { maxZoom: 20, maxNativeZoom: 18, attribution: BASEMAP_ATTR, ...TILE_PERF, ...extra });
}
