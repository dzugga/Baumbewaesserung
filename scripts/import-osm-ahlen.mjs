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

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';

const HOME = process.env.USERPROFILE || process.env.HOME || '.';
const OUT_DIR = `${HOME}/Downloads/_ahlen_out`;
const OVERPASS = 'https://overpass-api.de/api/interpreter';

// Zuständigkeit aus dem Straßenverzeichnis (zuvor mit parse-ahlen-strv.mjs erzeugt), Match über normalisierten Namen.
// Robuste Namens-Normalisierung: ß→ss, Klammern/Punkte/Bindestriche/Leerzeichen raus, straße→str,
// gängige Abkürzungen vereinheitlichen → ein vergleichbarer Token. „Allensteiner Straße" == „Allensteiner Str.".
const normName = s => String(s||'')
  .toLowerCase()
  .replace(/ß/g,'ss')
  .replace(/\(.*$/s,'')                      // ab erster Klammer abschneiden (auch unvollständige/umbrochene Bedingungen)
  .replace(/\bx\b/g,' ')                     // einzelne, in den Namen gerutschte X-Markierungen entfernen
  .replace(/\bst\.\s/g,'sankt ')            // „St. “ → „Sankt “
  .replace(/strasse|str\b|str\./g,'str')    // straße/strasse/str./str → str
  .replace(/platz\b/g,'pl').replace(/\bdr\.?\b/g,'dr')
  .replace(/[^a-z0-9äöü]/g,'')               // Leerzeichen, Bindestriche, Punkte, Slashes … entfernen
  .trim();
let zMap = new Map();
try{
  const arr = JSON.parse(readFileSync(`${OUT_DIR}/ahlen-strv.json`,'utf8'));
  for(const r of arr){ const k=normName(r.name); if(k && !zMap.has(k)) zMap.set(k, r); }
  console.log('Zuständigkeit aus Verzeichnis geladen:', zMap.size, 'Straßen.');
}catch(e){ console.warn('Hinweis: ahlen-strv.json fehlt — Import OHNE Zuständigkeit. Erst „node scripts/parse-ahlen-strv.mjs" ausführen.'); }

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
const res = await fetch(OVERPASS, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json','User-Agent':'Baumbewaesserung-Import/1.0 (kommunale Reinigungsplanung; Kontakt: dzugga@infa.de)'}, body:'data='+encodeURIComponent(QUERY) });
if(!res.ok){ console.error('Overpass-Fehler:', res.status, await res.text()); process.exit(1); }
const data = await res.json();
const ways = (data.elements||[]).filter(e=>e.type==='way' && Array.isArray(e.geometry) && e.geometry.length>=2);

// Container-Modell: je Straße EIN Abschnitt-Container (trägt Linie + Länge) + 4 Seiten als Ausstattung
// (Fahrbahn/Gehweg links/rechts), die Geometrie + Länge ERBEN (kein geomStr/menge am Seiten-Doc).
// Die Seiten sind die planbaren Objekte (eigene Tour/Status); der Container ist die Klammer.
const docs=[]; let totalM=0, matched=0;
for(const w of ways){
  const coords = w.geometry.map(p=>[+p.lon.toFixed(7), +p.lat.toFixed(7)]);
  const t = w.tags||{};
  if(!t.name && !t.ref) continue; // unbenannte Wege (Zufahrten/Service) überspringen — keine Reinigungs-Straßen
  const m = lenM(coords); totalM += m;
  const name = t.name || t.ref;
  const z = zMap.get(normName(name)); if(z) matched++;
  const ext = 'osm-'+w.id;
  // Art nach Zuständigkeit je Seite → Aufwandssatz je Art (Stadt = echter min/100 m, Anlieger = 0)
  const fbArt = z?.zustFahrbahn==='stadt' ? 'Fahrbahn (Stadt)' : z?.zustFahrbahn==='anlieger' ? 'Fahrbahn (Anlieger)' : 'Fahrbahn';
  const gwArt = z?.zustGehweg  ==='stadt' ? 'Gehweg (Stadt)'   : z?.zustGehweg  ==='anlieger' ? 'Gehweg (Anlieger)'   : 'Gehweg';
  // Abschnitt-Container
  docs.push({
    extId: ext,
    containerTyp: 'strecke',
    geomType: 'linie',
    geomStr: JSON.stringify({ type:'LineString', coordinates: coords }),
    menge: m, einheit: 'm',
    name,
    art: 'Straßenabschnitt',
    strassentyp: t.highway || '',
    belag: t.surface || '',
    zustFahrbahn: z?.zustFahrbahn || '',   // 'stadt' | 'anlieger' | ''
    zustGehweg:   z?.zustGehweg   || '',
    strKategorie: z?.kategorie    || '',
    strSchluessel:z?.schluessel   || '',
    baumId: 'S-'+w.id,
  });
  // 4 Standard-Seiten (erben Geometrie + Länge vom Container)
  for(const [element,label,sart] of [['fahrbahn_l','Fahrbahn links',fbArt],['fahrbahn_r','Fahrbahn rechts',fbArt],['gehweg_l','Gehweg links',gwArt],['gehweg_r','Gehweg rechts',gwArt]]){
    docs.push({ containerExtId: ext, element, elementLabel: label, name: label, art: sart, geomType: 'linie', baumId: 'S-'+w.id+'-'+element });
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/ahlen-strecken-docs.json`, JSON.stringify(docs));
const containers = docs.filter(d=>d.containerTyp);
const sides = docs.filter(d=>d.containerExtId);
console.log('\n================ ERGEBNIS ================');
console.log('Abschnitte (Container):', containers.length.toLocaleString('de-DE'));
console.log('Seiten (Ausstattung):  ', sides.length.toLocaleString('de-DE'), '(4 je Abschnitt: Fahrbahn/Gehweg L+R)');
console.log('Datensätze gesamt:     ', docs.length.toLocaleString('de-DE'));
console.log('mit Zuständigkeit (Verzeichnis-Treffer):', matched.toLocaleString('de-DE'), '('+Math.round(matched/Math.max(containers.length,1)*100)+'% der Abschnitte)');
console.log('  davon Stadt-Fahrbahn:', containers.filter(d=>d.zustFahrbahn==='stadt').length.toLocaleString('de-DE'));
console.log('Gesamtlänge:           ', (totalM/1000).toFixed(1), 'km');
console.log('Geschrieben nach:      ', `${OUT_DIR}/ahlen-strecken-docs.json`);
console.log('\nNächster Schritt: in ein LEERES Zielprojekt einspielen (Admin → Mandanten → „Geometrie-Datensätze einspielen").');
