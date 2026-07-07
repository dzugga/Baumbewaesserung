// ─── Shapefile-Import (abhängigkeitsfrei) ────────────────────────────────────
// Liest ein Shapefile-ZIP (.shp/.shx/.dbf/.prj/.cpg, auch mehrere Ebenen je ZIP)
// und liefert GeoJSON-Geometrien in WGS84 ([lng,lat]) + Attribute je Datensatz.
// ZIP-Entpacken nativ über DecompressionStream (Browser + Node 18+, keine Bibliothek);
// Reprojektion über das injizierte proj4 (liest die .prj-WKT; Fallback-Heuristik).
// Gegenstück zum Export-Modul src/geo-export.js.

// ── ZIP lesen (Store + Deflate) ───────────────────────────────────────────────
async function _inflateRaw(u8){
  const ds=new DecompressionStream('deflate-raw');
  const buf=await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
async function _unzip(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  // End-of-Central-Directory von hinten suchen
  let eocd=-1;
  for(let i=u8.length-22;i>=0&&i>u8.length-22-65536;i--){ if(dv.getUint32(i,true)===0x06054b50){ eocd=i; break; } }
  if(eocd<0) throw new Error('Kein gültiges ZIP-Archiv');
  const count=dv.getUint16(eocd+10,true); const cdOff=dv.getUint32(eocd+16,true);
  const out=[]; let p=cdOff;
  for(let n=0;n<count;n++){
    if(dv.getUint32(p,true)!==0x02014b50) break;
    const method=dv.getUint16(p+10,true), csize=dv.getUint32(p+20,true);
    const nameLen=dv.getUint16(p+28,true), extraLen=dv.getUint16(p+30,true), cmtLen=dv.getUint16(p+32,true);
    const lho=dv.getUint32(p+42,true);
    const name=new TextDecoder().decode(u8.subarray(p+46,p+46+nameLen));
    // Lokaler Header: eigene Name-/Extra-Längen (können vom Central Directory abweichen)
    const lnl=dv.getUint16(lho+26,true), lel=dv.getUint16(lho+28,true);
    const dataOff=lho+30+lnl+lel;
    const raw=u8.subarray(dataOff,dataOff+csize);
    if(method===0) out.push({name,data:raw});
    else if(method===8) out.push({name,data:await _inflateRaw(raw)});
    // andere Methoden: überspringen
    p+=46+nameLen+extraLen+cmtLen;
  }
  return out;
}

// ── SHP (Geometrie) ──────────────────────────────────────────────────────────
function _parseShp(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  if(dv.getInt32(0,false)!==9994) throw new Error('Keine gültige .shp-Datei');
  const shapes=[]; let p=100;
  while(p+8<=u8.byteLength){
    const contentWords=dv.getInt32(p+4,false); const c=p+8; const bytes=contentWords*2;
    if(bytes<4||c+bytes>u8.byteLength) break;
    const type=dv.getInt32(c,true);
    if(type===1||type===11||type===21){ shapes.push({t:'point',x:dv.getFloat64(c+4,true),y:dv.getFloat64(c+12,true)}); }
    else if(type===3||type===5||type===13||type===15||type===23||type===25){
      const nParts=dv.getInt32(c+36,true), nPts=dv.getInt32(c+40,true);
      const parts=[]; for(let i=0;i<nParts;i++) parts.push(dv.getInt32(c+44+4*i,true));
      const pts=[]; const base=c+44+4*nParts;
      for(let i=0;i<nPts;i++) pts.push([dv.getFloat64(base+16*i,true),dv.getFloat64(base+16*i+8,true)]);
      const rings=[]; for(let i=0;i<nParts;i++) rings.push(pts.slice(parts[i], i+1<nParts?parts[i+1]:nPts));
      shapes.push({t:(type===5||type===15||type===25)?'polygon':'line',rings});
    }
    else shapes.push({t:'null'});
    p=c+bytes;
  }
  return shapes;
}
function _ringArea(r){ let a=0; for(let i=0,j=r.length-1;i<r.length;j=i++) a+=(r[j][0]*r[i][1]-r[i][0]*r[j][1]); return a/2; }
function _shapeToGeoJSON(s,rp){
  if(s.t==='point'){ const c=rp(s.x,s.y); return c?{type:'Point',coordinates:c}:null; }
  if(s.t==='line'){
    const ls=s.rings.map(r=>r.map(([x,y])=>rp(x,y))).filter(r=>r.length>=2);
    if(!ls.length) return null;
    return ls.length===1?{type:'LineString',coordinates:ls[0]}:{type:'MultiLineString',coordinates:ls};
  }
  if(s.t==='polygon'){
    // Shapefile: Außenring im Uhrzeigersinn (Shoelace < 0), Löcher gegen den Uhrzeigersinn → dem letzten Außenring zuordnen
    const polys=[];
    for(const r of s.rings){ const rr=r.map(([x,y])=>rp(x,y)); if(rr.length<4) continue;
      if(_ringArea(r)<0||!polys.length) polys.push([rr]); else polys[polys.length-1].push(rr); }
    if(!polys.length) return null;
    return polys.length===1?{type:'Polygon',coordinates:polys[0]}:{type:'MultiPolygon',coordinates:polys};
  }
  return null;
}

// ── DBF (Attribute) ──────────────────────────────────────────────────────────
function _parseDbf(u8,enc){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  const nRec=dv.getUint32(4,true), headerSize=dv.getUint16(8,true), recSize=dv.getUint16(10,true);
  const dec=new TextDecoder(enc||'windows-1252');
  const fields=[]; let p=32;
  while(p+32<=headerSize-1 && u8[p]!==0x0D){
    let name=''; for(let i=0;i<11&&u8[p+i];i++) name+=String.fromCharCode(u8[p+i]);
    fields.push({name,type:String.fromCharCode(u8[p+11]),len:u8[p+16],dec:u8[p+17]});
    p+=32;
  }
  const out=[];
  for(let r=0;r<nRec;r++){
    const off=headerSize+r*recSize;
    if(off+recSize>u8.byteLength) break;
    if(u8[off]===0x2A){ out.push(null); continue; }  // gelöschter Datensatz
    const o={}; let fp=off+1;
    for(const f of fields){
      const raw=dec.decode(u8.subarray(fp,fp+f.len)).trim(); fp+=f.len;
      if(f.type==='N'||f.type==='F'){ o[f.name]=raw===''?'':(isNaN(parseFloat(raw))?raw:parseFloat(raw)); }
      else if(f.type==='L'){ o[f.name]=/[TtYyJj]/.test(raw)?'ja':(raw===''?'':'nein'); }
      else o[f.name]=raw;
    }
    out.push(o);
  }
  return {fields:fields.map(f=>f.name), records:out};
}

// ── Reprojektion ──────────────────────────────────────────────────────────────
function _makeReproject(prjWkt, sample, proj4, warnings, base){
  if(prjWkt && proj4){
    try{ const t=proj4(prjWkt,'WGS84'); const c=t.forward([sample[0],sample[1]]);
      if(isFinite(c[0])&&isFinite(c[1])) return (x,y)=>{ const r=t.forward([x,y]); return (isFinite(r[0])&&isFinite(r[1]))?[+r[0].toFixed(7),+r[1].toFixed(7)]:null; };
    }catch(e){ warnings.push(base+': .prj nicht lesbar — Heuristik verwendet'); }
  }
  if(Math.abs(sample[0])<=180 && Math.abs(sample[1])<=90) return (x,y)=>[+x.toFixed(7),+y.toFixed(7)]; // schon WGS84
  if(proj4){
    warnings.push(base+': kein Koordinatensystem angegeben — ETRS89/UTM 32N angenommen');
    const t=proj4('+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs','WGS84');
    return (x,y)=>{ const r=t.forward([x,y]); return [+r[0].toFixed(7),+r[1].toFixed(7)]; };
  }
  return null;
}
function _firstCoord(shapes){
  for(const s of shapes){ if(s.t==='point') return [s.x,s.y]; if(s.rings&&s.rings[0]&&s.rings[0][0]) return s.rings[0][0]; }
  return null;
}

// ── öffentliche API ───────────────────────────────────────────────────────────
// data: ArrayBuffer/Uint8Array eines Shapefile-ZIPs. opts.proj4: proj4-Instanz.
// → { layers:[{name, features:[{geometry(GeoJSON WGS84), attrs{}}]}], warnings:[] }
export async function readShapefileZip(data, opts={}){
  const u8=data instanceof Uint8Array?data:new Uint8Array(data);
  const entries=await _unzip(u8);
  const by={};
  for(const e of entries){
    const m=e.name.toLowerCase().match(/([^\/\\]+)\.(shp|shx|dbf|prj|cpg)$/); if(!m) continue;
    (by[m[1]]=by[m[1]]||{})[m[2]]=e.data;
  }
  const layers=[], warnings=[];
  for(const base of Object.keys(by)){
    const p=by[base]; if(!p.shp) continue;
    let shapes; try{ shapes=_parseShp(p.shp); }catch(e){ warnings.push(base+': '+e.message); continue; }
    if(!shapes.length){ warnings.push(base+': keine Geometrien'); continue; }
    const prj=p.prj?new TextDecoder('utf-8').decode(p.prj).trim():null;
    const enc=p.cpg&&/utf/i.test(new TextDecoder().decode(p.cpg))?'utf-8':'windows-1252';
    const dbf=p.dbf?_parseDbf(p.dbf,enc):{fields:[],records:[]};
    const sample=_firstCoord(shapes);
    if(!sample){ warnings.push(base+': nur leere Geometrien'); continue; }
    const rp=_makeReproject(prj,sample,opts.proj4,warnings,base);
    if(!rp){ warnings.push(base+': Koordinatensystem unbekannt — Ebene übersprungen'); continue; }
    const features=[];
    shapes.forEach((s,i)=>{ const g=_shapeToGeoJSON(s,rp); if(g) features.push({geometry:g, attrs:dbf.records[i]||{}}); });
    if(features.length) layers.push({name:base, fields:dbf.fields, features});
  }
  return {layers, warnings};
}
