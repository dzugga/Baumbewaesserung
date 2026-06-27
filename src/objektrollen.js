// Zentrale Anzeige-, Gruppierungs- und Hierarchie-Rollen für Objekte.
// Geteiltes Modul — in ALLEN Apps (Desktop, Fahrer, Erfassung, Einsatzleiter) gleich verwendet,
// damit "wo wird was angezeigt" eine einzige Regel ist.
//
// Hintergrund: das Feld `name` ist überladen — Punkt/Fläche/Strecke = Anlage/Straße,
// Abschnitt = Straße, Seite = Element ("Fahrbahn links"). Diese Resolver liefern je Anzeige-Rolle
// den richtigen Wert, statt überall direkt `tree.name` zu lesen.
//
// Container-Zugriff ist app-spezifisch (verschiedene Datenquellen) → wird als Lookup übergeben:
//   getContainer(containerExtId) => Container-Objekt | null
// Apps bauen ihn einmal aus ihrer Objektliste via buildContainerIndex().

export const ELEM_ORDER = ['fahrbahn_l','fahrbahn_r','gehweg_l','gehweg_r','radweg_l','radweg_r','mittelinsel','parkstreifen','gruenstreifen'];
export const ELEM_LABEL = { fahrbahn_l:'Fahrbahn links', fahrbahn_r:'Fahrbahn rechts', gehweg_l:'Gehweg links', gehweg_r:'Gehweg rechts', radweg_l:'Radweg links', radweg_r:'Radweg rechts', mittelinsel:'Mittelinsel', parkstreifen:'Parkstreifen', gruenstreifen:'Grünstreifen' };
// Objektart (ohne Lage) je Element-Gruppe — die „Seite" benennt nur die Lage, nicht das Objekt
export const ELEM_ART = { fahrbahn:'Fahrbahn', gehweg:'Gehweg', radweg:'Radweg', mittelinsel:'Mittelinsel', parkstreifen:'Parkstreifen', gruenstreifen:'Grünstreifen' };
// Objektart eines Abschnitts-Objekts (Fahrbahn/Gehweg/Mittelinsel …), ohne Lage
export function objektartOf(t){ if(!isSeite(t)) return ''; const g=elementGruppeOf(t); return ELEM_ART[g] || t.elementLabel || (ELEM_LABEL[t.element]||'').replace(/ (links|rechts)$/,'') || ''; }
// Lage des Objekts: links | rechts | '' (lage-neutral, „Seite 0", z. B. Mittelinsel)
export function lageOf(t){ const el=(t&&t.element)||''; if(/_l$/.test(el)) return 'links'; if(/_r$/.test(el)) return 'rechts'; return ''; }

export function isContainer(t){ return !!(t && t.containerTyp); }       // Abschnitt-Container (trägt Linie + Länge)
export function isSeite(t){ return !!(t && t.containerExtId); }          // Seite (referenziert Abschnitt)
export function geomTypeOf(t){ return (t && t.geomType) || 'punkt'; }    // punkt (Default) | linie | flaeche

// Objekt-Kategorie für Filter/Icons: punkt | linie | flaeche | abschnitt (Container ODER Seite)
export function kategorieOf(t){
  if(isContainer(t) || isSeite(t)) return 'abschnitt';
  const gt = geomTypeOf(t);
  return (gt==='flaeche' || gt==='linie') ? gt : 'punkt';
}

// Element-Label einer Seite ("Fahrbahn links"); leer für Nicht-Seiten
export function elementOf(t){
  if(!isSeite(t)) return '';
  return ELEM_LABEL[t.element] || t.elementLabel || t.name || 'Seite';
}

// Standort ("Anlage/Straße") — Gruppierungs-/Sortier-Anker. Seite erbt die Straße vom Abschnitt.
export function standortOf(t, getContainer){
  if(!t) return '';
  if(isSeite(t)){ const c = getContainer && getContainer(t.containerExtId); return (c && c.name) || t.name || ''; }
  return t.name || '';   // Punkt/Fläche/Strecke/Abschnitt
}

// Titel/Anzeige — selbsterklärend. Seite = "Straße – Element"; alles andere = name.
export function titelOf(t, getContainer){
  if(!t) return '';
  if(isSeite(t)){
    const strasse = standortOf(t, getContainer);
    const el = elementOf(t);
    if(strasse && el) return strasse + ' – ' + el;
    return strasse || el || '';
  }
  return t.name || '';
}

// Typ/Art — Abschnitt-Container hat keinen Tätigkeits-Typ
export function typOf(t){
  if(!t || isContainer(t)) return '';
  return t.art || '';
}

// Effektive Menge (Länge/Fläche) + Einheit — Seite erbt vom Container
export function mengeOf(t, getContainer){
  if(!t) return 0;
  if(t.menge!=null && t.menge!=='') return parseFloat(t.menge)||0;
  const c = getContainer && getContainer(t.containerExtId);
  return c ? (parseFloat(c.menge)||0) : 0;
}
export function einheitOf(t, getContainer){
  if(t && t.einheit) return t.einheit;
  const c = getContainer && getContainer(t.containerExtId);
  return c ? (c.einheit||'') : '';
}

// Stabiler Gruppierungsschlüssel (Straße) — robust gegen "Schillerstr." vs "Schillerstraße"
export function gruppeKeyOf(t, getContainer){ return _normStrasse(standortOf(t, getContainer)); }
function _normStrasse(s){
  return (s||'').toString().toLowerCase().trim()
    .replace(/stra(ß|ss)e|str\.?(?=\s|$)/g,'str')   // Straße/Strasse/Str. → str
    .replace(/\s+/g,' ');
}

// Feld-Allowlist der Objektklasse eines Objekts; null = keine/leere Klasse → alle Felder (Default).
export function klasseFelderOf(t, objektklassen){
  const kl = (objektklassen||[]).find(k=>k.id===(t&&t.klasse));
  return (kl && Array.isArray(kl.felder) && kl.felder.length) ? kl.felder : null;
}

// ── Reinigungsklasse / Häufigkeit (Straßenreinigung) ────────────────────────
// Satzungs-Reinigungsklasse definiert Häufigkeit je Element-GRUPPE (Fahrbahn/Gehweg/…),
// nicht je Seite links/rechts. element 'fahrbahn_l' → Gruppe 'fahrbahn'.
export const ELEM_GRUPPE_ORDER = ['fahrbahn','gehweg','radweg','mittelinsel','parkstreifen','gruenstreifen'];
export const ELEM_GRUPPE_LABEL = { fahrbahn:'Fahrbahn', gehweg:'Gehweg', radweg:'Radweg', mittelinsel:'Mittelinsel', parkstreifen:'Parkstreifen', gruenstreifen:'Grünstreifen' };
export function elementGruppeOf(t){
  const el = (t && t.element) || '';
  return el ? el.replace(/_[lr]$/,'') : '';
}
// Effektive Häufigkeit einer Seite: manueller Override gewinnt, sonst aus der
// Reinigungsklasse des Abschnitts × Element-Gruppe, sonst null (nicht abgedeckt).
//   getReinigungsklasse(id) => { freq: { fahrbahn:2, gehweg:1, … } } | null
export function haeufigkeitOf(t, getReinigungsklasse, getContainer){
  if(!t) return null;
  if(t.haeufigkeit!=null && t.haeufigkeit!=='') return parseFloat(t.haeufigkeit)||0; // manuelle Ausnahme
  if(!isSeite(t)) return null;
  const c = getContainer && getContainer(t.containerExtId);
  const rkId = c && c.reinigungsklasse;
  const rk = rkId && getReinigungsklasse && getReinigungsklasse(rkId);
  if(!rk || !rk.freq) return null;
  const g = elementGruppeOf(t);
  const v = rk.freq[g];
  return (v!=null && v!=='') ? (parseFloat(v)||0) : null;
}
// Quelle der Häufigkeit (für Anzeige „geerbt/eigen"): 'manuell' | 'klasse' | null
export function haeufigkeitQuelleOf(t, getReinigungsklasse, getContainer){
  if(t && t.haeufigkeit!=null && t.haeufigkeit!=='') return 'manuell';
  return haeufigkeitOf(t, getReinigungsklasse, getContainer)!=null ? 'klasse' : null;
}

// ── Hierarchie / Gruppierung über eine Objektliste ──────────────────────────
// Index extId→Container, containerExtId→Seiten[] — EINMAL je Liste bauen.
export function buildContainerIndex(objekte){
  const byExtId = new Map(), seitenByExtId = new Map();
  for(const t of (objekte||[])){
    if(t.containerTyp && t.extId) byExtId.set(t.extId, t);
    if(t.containerExtId){ let a = seitenByExtId.get(t.containerExtId); if(!a){ a=[]; seitenByExtId.set(t.containerExtId, a); } a.push(t); }
  }
  return {
    getContainer: (extId)=> extId ? (byExtId.get(extId)||null) : null,
    seitenVon: (extId)=> seitenByExtId.get(extId) || [],
  };
}

// Seiten nach Element-Reihenfolge sortieren (Fahrbahn l/r, Gehweg l/r …)
export function sortSeiten(seiten){
  const rank = s => { const i = ELEM_ORDER.indexOf(s.element); return i<0?99:i; };
  return [...(seiten||[])].sort((a,b)=> rank(a)-rank(b) || elementOf(a).localeCompare(elementOf(b)));
}

// Objekte nach Straße gruppieren → [{ key, label, items[] }], alphabetisch
export function gruppiereNachStrasse(objekte, getContainer){
  const map = new Map();
  for(const t of (objekte||[])){
    const key = gruppeKeyOf(t, getContainer);
    let g = map.get(key);
    if(!g){ g = { key, label: standortOf(t, getContainer) || '–', items: [] }; map.set(key, g); }
    g.items.push(t);
  }
  return [...map.values()].sort((a,b)=> a.label.localeCompare(b.label,'de'));
}
