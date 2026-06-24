// OSM-Straßenextraktion für den Pilot Ahlen → Linien-Objekte (geomType 'linie') für die Planung.
// Holt das Straßennetz aus OpenStreetMap (Overpass), baut je Straßen-Way ein Objekt mit
// LineString-Geometrie (als geomStr-String, Firestore-tauglich) + Länge (m).
// Ausgabe: eine JSON-Datei mit Datensätzen, die über die Superadmin-Aktion
// „Geometrie-Datensätze einspielen" (Admin → Mandanten) in ein Projekt geladen werden.
//
// Aufruf:  node scripts/import-osm-ahlen.mjs
//   Ausgabe: Downloads/_ahlen_out/ahlen-strecken-docs.json
//
// Lizenz: OpenStreetMap-Daten © OpenStreetMap-Mitwirkende, ODbL — Namensnennung erforderlich,
// Eintrag in „Lizenzen & Dienste" (SI_DIENSTE) ergänzen, bevor produktiv genutzt.

import { mkdirSync, writeFileSync } from 'node:fs';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const OUT_DIR = `${HOME}/Downloads/_ahlen_out`;
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// Welche Straßentypen als reinigungsrelevante Abschnitte (anpassbar):
const HIGHWAY = ['primary','secondary','tertiary','unclassified','residential','living_street','pedestrian','service'];

// Stadt-Filter: Ahlen in Westfalen (Kreis Warendorf). admin_level 8 = Stadt/Gemeinde.
// Falls mehrere „Ahlen" matchen, ggf. über area-id (siehe Kommentar) eingrenzen.
const QUERY = `[out:json][timeout:180];
area["name"="Ahlen"]["boundary"="administrative"]["admin_level"="8"]->.a;
way(area.a)["highway"~"^(${HIGHWAY.join('|')})$"];
out geom tags;`;

function lenM(coords){ // Haversine-Summe über [lon,lat]-Paare
  const R=6371000; let d=0;
  for(let i=1;i<coords.length;i++){
    const [lo1,la1]=coords[i-1],[lo2,la2]=coords[i];
    const dLat=(la2-la1)*Math.PI/180, dLon=(lo2-lo1)*Math.PI/180;
    const s=Math.sin(dLat/2)**2+Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    d+=2*R*Math.asin(Math.sqrt(s));
  }
  return Math.round(d);
}

console.log('Frage Overpass nach Ahlener Straßen …');
const res = await fetch(OVERPASS, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:'data='+encodeURIComponent(QUERY) });
if(!res.ok){ console.error('Overpass-Fehler:', res.status, await res.text()); process.exit(1); }
const data = await res.json();
const ways = (data.elements||[]).filter(e=>e.type==='way' && Array.isArray(e.geometry) && e.geometry.length>=2);

const docs=[]; let totalM=0;
for(const w of ways){
  const coords = w.geometry.map(p=>[+p.lon.toFixed(7), +p.lat.toFixed(7)]);
  const m = lenM(coords); totalM += m;
  const t = w.tags||{};
  docs.push({
    extId: 'osm-'+w.id,
    geomType: 'linie',
    geomStr: JSON.stringify({ type:'LineString', coordinates: coords }),
    menge: m, einheit: 'm',
    name: t.name || t.ref || ('Straße '+w.id),
    art: 'Fahrbahn',                 // Standard-Art; Reinigungsklasse/Häufigkeit später aus Ahlener Verzeichnis
    strassentyp: t.highway || '',    // Kundenfeld-Kandidat
    belag: t.surface || '',
    baumId: 'S-'+w.id,               // Objekt-ID
  });
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/ahlen-strecken-docs.json`, JSON.stringify(docs));
const named = docs.filter(d=>!/^Straße \d+$/.test(d.name)).length;
console.log('\n================ ERGEBNIS ================');
console.log('Straßen-Abschnitte:', docs.length.toLocaleString('de-DE'));
console.log('davon mit Namen:   ', named.toLocaleString('de-DE'));
console.log('Gesamtlänge:       ', (totalM/1000).toFixed(1), 'km');
console.log('Geschrieben nach:  ', `${OUT_DIR}/ahlen-strecken-docs.json`);
console.log('\nNächster Schritt: Admin → Mandanten → „Geometrie-Datensätze einspielen" → Datei wählen → Zielprojekt Ahlen.');
