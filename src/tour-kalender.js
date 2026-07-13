// Geteilte Tourkalender-Logik (Soll-Berechnung): Desktop UND Einsatzleiter-App importieren
// dieselben Regeln, damit die Soll-Anzeigen der Apps nie auseinanderlaufen.
// Modell: BETRIEBSTAGE (Wochentage) × WOCHEN-RHYTHMUS (jede / jede 2. / jede 4. Woche)
// × Gültigkeitszeiträume × Saison. Bedarfstouren sind NIE automatisch fällig.

export const SAISON_DEFAULT = { von: '04-01', bis: '10-31' }; // Sommer 1.4.–31.10.

// Saison eines Datums (YYYY-MM-DD oder Date): 'sommer' im Zeitraum (auch über Jahreswechsel), sonst 'winter'
export function saisonForDate(date, saison){
  const s = saison || SAISON_DEFAULT;
  let md;
  if(date instanceof Date) md = String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0');
  else md = String(date||'').slice(5,10);
  if(!md) return 'sommer';
  const inRange = (s.von<=s.bis) ? (md>=s.von && md<=s.bis) : (md>=s.von || md<=s.bis);
  return inRange ? 'sommer' : 'winter';
}

export function tourInValidity(t, date){
  const g = t && t.gueltig;
  if(!Array.isArray(g) || !g.length) return true;
  return g.some(p=>p && p.from<=date && p.to>=date);
}

// Betriebstage (getDay-Nummern). Abwärtskompatibel für Alt-Touren ohne das Feld:
//  - Legacy „täglich" → alle 7 Tage;  - Legacy Wochen-Rhythmen mit Startdatum → dessen Wochentag.
export function tourBetriebstage(t){
  if(!t) return [];
  if(Array.isArray(t.betriebstage)) return t.betriebstage;
  if(t.interval==='taeglich') return [1,2,3,4,5,6,0];
  if(t.startDate && (t.interval==='woechentlich'||t.interval==='14taeglich'||t.interval==='4woechentlich')){
    const [Y,M,D]=t.startDate.split('-').map(Number); return [new Date(Y,M-1,D).getDay()];
  }
  return [];
}

// Kalenderwochen-Index (Mo-basiert) für die Wochen-Parität bei 2-/4-wöchentlichem Rhythmus.
export function isoWeekIndex(dateStr){
  const [Y,M,D]=dateStr.split('-').map(Number);
  const ms=Date.UTC(Y,M-1,D);
  const dow=(new Date(ms).getUTCDay()+6)%7;
  return Math.floor((ms-dow*86400000)/(7*86400000));
}

// Läuft die Tour am Datum (YYYY-MM-DD)? saison = {von,bis} des Projekts (Sommer-Zeitraum).
export function tourDueOn(t, date, saison){
  if(!t || !tourInValidity(t,date)) return false;
  if(t.saison && saisonForDate(date,saison)!==t.saison) return false; // Sommer-/Winter-Tour: nur in der passenden Saison
  const iv=t.interval||'';
  if(iv==='bedarf') return false;                          // Bedarfstour: nie automatisch fällig
  const bt=tourBetriebstage(t);
  if(!bt.length) return false;                             // ohne Betriebstage → nicht fällig (bewusst)
  const [Y,M,D]=date.split('-').map(Number);
  if(!bt.includes(new Date(Y,M-1,D).getDay())) return false; // kein Betriebstag
  if(t.startDate && date<t.startDate) return false;
  if(iv==='14taeglich'||iv==='4woechentlich'){             // Wochen-Rhythmus ab Startdatum-Woche
    if(!t.startDate) return true;
    const wk=isoWeekIndex(date)-isoWeekIndex(t.startDate);
    return iv==='14taeglich'?wk%2===0:wk%4===0;
  }
  return true;                                             // jede Woche (woechentlich / '' / legacy täglich)
}

export function todayStr(){
  const d=new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

export function addDays(date, n){
  const [Y,M,D]=date.split('-').map(Number);
  const dt=new Date(Y,M-1,D); dt.setDate(dt.getDate()+n);
  return dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
}
