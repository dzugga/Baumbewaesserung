// FES „PK.-Planung": Objekt-Koordinaten aus der Original-Touren-Datei korrigieren.
// Die importierte Stammdaten-Datei hatte verrutschte Koordinaten (Ø ~2,2 km falsch).
// Quelle: Erzeugung Touren.xlsx (A=ExternalID3, K/L = Coordinate_Lat/Lng, E6). Match über pflanzzeitpunkt.
//   node scripts/fix-fes-koordinaten.mjs           # DRY-RUN
//   node scripts/fix-fes-koordinaten.mjs --apply   # schreibt
import admin from 'firebase-admin';
import fs from 'fs'; import zlib from 'zlib';
const APPLY=process.argv.includes('--apply'); const PID='JMQMe7TMLcSopaxsquKW'; const B=400;
function rz(buf,w){let eocd=-1;for(let i=buf.length-22;i>=0&&i>buf.length-22-65536;i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}const co=buf.readUInt32LE(eocd+16),cc=buf.readUInt16LE(eocd+10);const o={};let p=co;for(let n=0;n<cc;n++){if(buf.readUInt32LE(p)!==0x02014b50)break;const comp=buf.readUInt16LE(p+10),cs=buf.readUInt32LE(p+20);const nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32);const lho=buf.readUInt32LE(p+42),nm=buf.toString('utf8',p+46,p+46+nl);p+=46+nl+el+cl;if(!w(nm))continue;const lnl=buf.readUInt16LE(lho+26),lel=buf.readUInt16LE(lho+28);const ds=lho+30+lnl+lel;o[nm]=comp===0?buf.subarray(ds,ds+cs):zlib.inflateRawSync(buf.subarray(ds,ds+cs));}return o;}
const dec=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(+d));
function pss(x){if(!x)return[];const o=[];const re=/<si>([\s\S]*?)<\/si>/g;let m;while((m=re.exec(x))){let t='';const tr=/<t[^>]*>([\s\S]*?)<\/t>/g;let y;while((y=tr.exec(m[1])))t+=y[1];o.push(dec(t));}return o;}
function psh(x,ss){const rows=[];const rre=/<row[^>]*>([\s\S]*?)<\/row>/g;let rm;while((rm=rre.exec(x))){const c={};const cre=/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;let cm;while((cm=cre.exec(rm[1]))){const col=cm[1],a=cm[2]||'',b=cm[3]||'';const t=(a.match(/\bt="([^"]+)"/)||[])[1]||'';const vm=b.match(/<v>([\s\S]*?)<\/v>/);const raw=vm?vm[1]:'';const v=t==='s'?(ss[+raw]??''):dec(raw);if(v!=='')c[col]=v;}rows.push(c);}return rows;}
const toDeg=v=>{v=Math.abs(parseFloat(v));return v>1e6?v/1e6:v;};
const hav=(a,b,c,d)=>{const R=6371000,r=Math.PI/180;const x=Math.sin((c-a)*r/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin((d-b)*r/2)**2;return 2*R*Math.asin(Math.sqrt(x));};
const buf=fs.readFileSync('C:/INFA/FES-PK/Erzeugung Touren.xlsx');
const e=rz(buf,n=>n==='xl/sharedStrings.xml'||n==='xl/worksheets/sheet1.xml');
const ss=pss(e['xl/sharedStrings.xml']?.toString('utf8'));
const rows=psh(e['xl/worksheets/sheet1.xml']?.toString('utf8'),ss);
const coord=new Map();
for(let i=1;i<rows.length;i++){const ext=(rows[i]['A']||'').trim();if(!ext||coord.has(ext))continue;coord.set(ext,{lat:toDeg(rows[i]['K']),lng:toDeg(rows[i]['L'])});}
console.log(`\n=== FES Koordinaten-Korrektur (${APPLY?'APPLY — schreibt!':'DRY-RUN'}) ===`);
console.log(`Original-Datei: ${coord.size} Objekte mit Koordinaten`);
admin.initializeApp({projectId:'baumbewaesserung'});
const db=admin.firestore(); const pref=db.collection('projects').doc(PID);
const snap=await pref.collection('trees').select('pflanzzeitpunkt','lat','lng').get();
let noMatch=0, gleich=0; const upd=[]; let sum=0,max=0,maxId='';
snap.forEach(d=>{const x=d.data();const id=String(x.pflanzzeitpunkt??'').trim();const c=coord.get(id);if(!c||!isFinite(c.lat)||!isFinite(c.lng)){noMatch++;return;}
  const dist=(typeof x.lat==='number'&&typeof x.lng==='number')?hav(x.lat,x.lng,c.lat,c.lng):999999;
  if(dist<1){gleich++;return;} sum+=dist;if(dist>max){max=dist;maxId=id;} upd.push({ref:d.ref,lat:c.lat,lng:c.lng});});
console.log(`Objekte: ${snap.size} · zu korrigieren: ${upd.length} · bereits korrekt: ${gleich} · ohne Datei-Match: ${noMatch}`);
if(upd.length) console.log(`Ø-Verschiebung: ${Math.round(sum/upd.length)} m · max ${Math.round(max)} m (ID ${maxId})`);
if(APPLY){ for(let i=0;i<upd.length;i+=B){const bt=db.batch();upd.slice(i,i+B).forEach(u=>bt.update(u.ref,{lat:u.lat,lng:u.lng}));await bt.commit();console.log(`  … ${Math.min(i+B,upd.length)}/${upd.length}`);} console.log('✓ Fertig.'); }
else console.log('\nDRY-RUN — nichts geschrieben. Mit --apply ausführen.');
process.exit(0);
