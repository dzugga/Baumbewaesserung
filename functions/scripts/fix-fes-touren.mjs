// ============================================================================
//  FES Frankfurt „PK.-Planung": Touren-Zuordnung KORRIGIEREN auf Basis der
//  neuen Liste C:/INFA/FES-PK/Touren-FES.xlsx (A=FES-ID, B=Touren).
//  WICHTIG: Die neue Liste ist n:m — ein Objekt kann in MEHREREN Touren stehen
//  (je Mitgliedschaft eine Zeile, FES-ID wiederholt sich). tourIds wird zum
//  vollständigen Set der Touren je Objekt gesetzt (ersetzt die alte 1:1-Zuordnung).
//   - fehlende Touren anlegen (Farbe + orgId)
//   - je Objekt tourIds/tourId = alle Touren laut Liste (Match FES-ID↔pflanzzeitpunkt)
//   - tour.betriebshof aus dem (Mehrheits-)Betriebshof der zugeordneten Objekte ableiten
//     (die neue Liste hat keine BS-Spalte; tree.betriebshof wurde separat gesetzt)
//   - Touren, die es in der neuen Liste NICHT mehr gibt und die danach LEER sind, löschen
//  Admin-SDK, idempotent. DRY-RUN default.
//
//    node scripts/fix-fes-touren.mjs            # DRY-RUN
//    node scripts/fix-fes-touren.mjs --apply    # schreibt
// ============================================================================
import admin from 'firebase-admin';
import fs from 'fs';
import zlib from 'zlib';

const PID = 'JMQMe7TMLcSopaxsquKW';
const XLSX = 'C:/INFA/FES-PK/Touren-FES.xlsx';
const APPLY = process.argv.includes('--apply');
const BATCH = 400;
const NO = /^k\.?\s*a\.?$/i;
const COLORS = ['#d11149','#27ae60','#2980b9','#e67e22','#7c3aed','#16a085','#c71585','#808000','#d4ac0d','#3f51b5','#d81b60','#9a6324','#1099a8','#5d6d7e','#e74c3c','#1e8449','#1e40af','#f58231','#6c3483','#0e7d6e','#ad1457','#6b8e23','#b8860b','#283593','#ec407a','#784212','#0e7490','#34495e'];

// ── xlsx-Reader ──
function readZip(buf, want){ let e=-1; for(let i=buf.length-22;i>=0&&i>buf.length-22-65536;i--) if(buf.readUInt32LE(i)===0x06054b50){e=i;break;}
  if(e<0) throw new Error('EOCD nicht gefunden'); const off=buf.readUInt32LE(e+16),cnt=buf.readUInt16LE(e+10),out={}; let p=off;
  for(let n=0;n<cnt;n++){ if(buf.readUInt32LE(p)!==0x02014b50)break; const comp=buf.readUInt16LE(p+10),cs=buf.readUInt32LE(p+20),nl=buf.readUInt16LE(p+28),xl=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32),lho=buf.readUInt32LE(p+42),name=buf.toString('utf8',p+46,p+46+nl); p+=46+nl+xl+cl; if(!want(name))continue; const lnl=buf.readUInt16LE(lho+26),lxl=buf.readUInt16LE(lho+28),ds=lho+30+lnl+lxl,raw=buf.subarray(ds,ds+cs); out[name]=comp===0?raw:zlib.inflateRawSync(raw);} return out; }
const dec=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(+d)).replace(/&amp;/g,'&');
function shared(xml){ if(!xml)return[]; const o=[];const re=/<si>([\s\S]*?)<\/si>/g;let m;while((m=re.exec(xml))){let t='';const tr=/<t[^>]*>([\s\S]*?)<\/t>/g;let z;while((z=tr.exec(m[1])))t+=z[1];o.push(dec(t));}return o; }
function sheet(xml,ss){ const rows=[];const rre=/<row[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;let rm; while((rm=rre.exec(xml))){const c={};const cre=/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;let cm; while((cm=cre.exec(rm[2]))){const col=cm[1],attr=cm[2]||'',b=cm[3]||'';const t=(attr.match(/\bt="([^"]+)"/)||[])[1]||'';let v='';const vm=b.match(/<v>([\s\S]*?)<\/v>/);if(t==='inlineStr'){const im=b.match(/<t[^>]*>([\s\S]*?)<\/t>/);v=im?dec(im[1]):'';}else{const raw=vm?vm[1]:'';v=t==='s'?(ss[+raw]??''):dec(raw);}if(v!=='')c[col]=v;} rows.push(c);} return rows; }

// ── Excel lesen ──
const buf=fs.readFileSync(XLSX);
const e=readZip(buf,n=>n==='xl/sharedStrings.xml'||n==='xl/worksheets/sheet1.xml');
const ss=shared(e['xl/sharedStrings.xml']?.toString('utf8'));
const rows=sheet(e['xl/worksheets/sheet1.xml']?.toString('utf8'),ss);
const hdr=rows[0]||{}; let cF=null,cT=null;
for(const[col,txt] of Object.entries(hdr)){const t=(txt||'').trim().toLowerCase();if(t==='fes-id'||t==='fes id')cF=col;if(/^tour/.test(t))cT=col;}
console.log(`\n=== FES Touren-KORREKTUR (${APPLY?'APPLY — schreibt!':'DRY-RUN'}) ===`);
console.log(`Excel: ${rows.length-1} Datenzeilen · FES-ID=${cF} · Touren=${cT}`);
if(!cF||!cT) throw new Error('Spalte FES-ID/Touren nicht gefunden');

// n:m — FES-ID → Set von Tournamen (aus mehreren Zeilen)
const fesToTours=new Map(); const allTours=new Set();
for(let i=1;i<rows.length;i++){ const c=rows[i]; const fes=(c[cF]||'').trim(); if(!fes)continue;
  if(!fesToTours.has(fes)) fesToTours.set(fes,new Set());
  const tn=(c[cT]||'').trim(); if(tn&&!NO.test(tn)){ fesToTours.get(fes).add(tn); allTours.add(tn); }
}
const tourNames=[...allTours].sort((a,b)=>a.localeCompare(b));
const multi=[...fesToTours.values()].filter(s=>s.size>1).length;
console.log(`Eindeutige FES-IDs: ${fesToTours.size} · Tournamen: ${tourNames.length} · Objekte in >1 Tour: ${multi}`);

// ── DB ──
admin.initializeApp({ projectId:'baumbewaesserung' });
const db=admin.firestore();
const pref=db.collection('projects').doc(PID);
const orgId=(await pref.get()).data()?.orgId;

const toursSnap=await pref.collection('tours').get();
const tourIdByName=new Map(); const tourDocByName=new Map();
toursSnap.forEach(d=>{ if(d.data().uebersicht)return; const nm=(d.data().name||'').trim(); tourIdByName.set(nm,d.id); tourDocByName.set(nm,d); });

// Fehlende Touren: IDs vorab vergeben (auch im DRY-RUN, damit tourIds vollständig planbar)
let created=0; const newTours=[];
tourNames.forEach((nm,i)=>{ if(tourIdByName.has(nm))return; const ref=pref.collection('tours').doc(); tourIdByName.set(nm,ref.id); newTours.push({ref,name:nm,color:COLORS[i%COLORS.length]}); created++; });
console.log(`Touren anzulegen: ${created}${created?' ('+newTours.map(r=>r.name).join(', ')+')':''}`);

// ── Objekte neu zuordnen (n:m) + Betriebshof je Tour aus Objekten sammeln ──
const snap=await pref.collection('trees').select('pflanzzeitpunkt','tourIds','tourId','betriebshof').get();
const treeUpd=[]; let noFes=0,noExcel=0,already=0; const finalCount={}; const bhByTour={};
const eq=(a,b)=>{ if(a.length!==b.length)return false; const A=[...a].sort(),B=[...b].sort(); return A.every((x,k)=>x===B[k]); };
snap.forEach(d=>{ const fes=String(d.data().pflanzzeitpunkt??'').trim(); if(!fes){noFes++;return;}
  if(!fesToTours.has(fes)){noExcel++;return;}
  const names=[...fesToTours.get(fes)].sort((a,b)=>a.localeCompare(b));
  const wantIds=names.map(n=>tourIdByName.get(n));
  const bh=(d.data().betriebshof||'').trim();
  names.forEach(n=>{ finalCount[n]=(finalCount[n]||0)+1; if(bh){ (bhByTour[n]=bhByTour[n]||{})[bh]=(bhByTour[n][bh]||0)+1; } });
  const cur=d.data(); const curIds=Array.isArray(cur.tourIds)?cur.tourIds.filter(Boolean):(cur.tourId?[cur.tourId]:[]);
  if(eq(curIds,wantIds)){ already++; return; }
  treeUpd.push({ref:d.ref, tourIds:wantIds, tourId:wantIds[0]||''});
});
console.log(`\nObjekte: ${snap.size} · ohne FES-ID: ${noFes} · ohne Excel-Zeile: ${noExcel} · bereits korrekt: ${already}`);
console.log(`Objekt-Zuordnungen zu ändern: ${treeUpd.length} (davon auf „keine Tour": ${treeUpd.filter(u=>!u.tourIds.length).length})`);

// ── tour.betriebshof (neu + bestehend) aus Mehrheits-Betriebshof der Objekte ──
const tourBhUpd=[];
tourNames.forEach(nm=>{ const maj=Object.entries(bhByTour[nm]||{}).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
  const doc=tourDocByName.get(nm); const isNew=!doc;
  const cur=isNew?undefined:String(doc.data().betriebshof??'').trim();
  if(isNew){ const nt=newTours.find(t=>t.name===nm); if(nt) nt.betriebshof=maj; }
  else if(cur!==maj) tourBhUpd.push({ref:doc.ref,betriebshof:maj,name:nm}); });
console.log(`Tour-Betriebsstätte zu aktualisieren (bestehende): ${tourBhUpd.length}`);

// ── Verwaiste Touren: nicht in neuer Liste UND final leer ──
const orphan=[];
tourDocByName.forEach((d,nm)=>{ if(allTours.has(nm))return; if((finalCount[nm]||0)>0)return; orphan.push({ref:d.ref,name:nm,id:d.id}); });
console.log(`Verwaiste Touren (entfallen + leer) zu löschen: ${orphan.length}${orphan.length?' ('+orphan.map(o=>o.name).join(', ')+')':''}`);

if(APPLY){
  for(const t of newTours) await t.ref.set({ name:t.name, desc:'', color:t.color, betriebshof:t.betriebshof||'', orgId, createdAt:admin.firestore.FieldValue.serverTimestamp() });
  if(created) console.log(`  ✓ ${created} Touren angelegt`);
  for(let i=0;i<treeUpd.length;i+=BATCH){ const b=db.batch(); treeUpd.slice(i,i+BATCH).forEach(u=>b.update(u.ref,{tourIds:u.tourIds,tourId:u.tourId})); await b.commit(); console.log(`  Objekte … ${Math.min(i+BATCH,treeUpd.length)}/${treeUpd.length}`); }
  for(let i=0;i<tourBhUpd.length;i+=BATCH){ const b=db.batch(); tourBhUpd.slice(i,i+BATCH).forEach(u=>b.update(u.ref,{betriebshof:u.betriebshof})); await b.commit(); }
  for(const o of orphan){ await o.ref.delete(); await pref.collection('routes').doc(o.id).delete().catch(()=>{}); }
  if(orphan.length) console.log(`  ✓ ${orphan.length} verwaiste Touren gelöscht`);
  console.log('\n✓ Fertig: Touren-Zuordnung korrigiert (n:m).');
} else {
  console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
}
process.exit(0);
