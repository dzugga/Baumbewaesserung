// FES „PK.-Planung": Feld `plz` aus der Original-Touren-Datei korrigieren (war verrutscht wie die Koordinaten).
//   node scripts/fix-fes-plz.mjs           # DRY-RUN
//   node scripts/fix-fes-plz.mjs --apply
import admin from 'firebase-admin';
import fs from 'fs'; import zlib from 'zlib';
const APPLY=process.argv.includes('--apply'); const PID='JMQMe7TMLcSopaxsquKW'; const B=400;
function rz(buf,w){let eocd=-1;for(let i=buf.length-22;i>=0&&i>buf.length-22-65536;i--)if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}const co=buf.readUInt32LE(eocd+16),cc=buf.readUInt16LE(eocd+10);const o={};let p=co;for(let n=0;n<cc;n++){if(buf.readUInt32LE(p)!==0x02014b50)break;const comp=buf.readUInt16LE(p+10),cs=buf.readUInt32LE(p+20);const nl=buf.readUInt16LE(p+28),el=buf.readUInt16LE(p+30),cl=buf.readUInt16LE(p+32);const lho=buf.readUInt32LE(p+42),nm=buf.toString('utf8',p+46,p+46+nl);p+=46+nl+el+cl;if(!w(nm))continue;const lnl=buf.readUInt16LE(lho+26),lel=buf.readUInt16LE(lho+28);const ds=lho+30+lnl+lel;o[nm]=comp===0?buf.subarray(ds,ds+cs):zlib.inflateRawSync(buf.subarray(ds,ds+cs));}return o;}
const dec=s=>String(s).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(+d));
function pss(x){if(!x)return[];const o=[];const re=/<si>([\s\S]*?)<\/si>/g;let m;while((m=re.exec(x))){let t='';const tr=/<t[^>]*>([\s\S]*?)<\/t>/g;let y;while((y=tr.exec(m[1])))t+=y[1];o.push(dec(t));}return o;}
function psh(x,ss){const rows=[];const rre=/<row[^>]*>([\s\S]*?)<\/row>/g;let rm;while((rm=rre.exec(x))){const c={};const cre=/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;let cm;while((cm=cre.exec(rm[1]))){const col=cm[1],a=cm[2]||'',b=cm[3]||'';const t=(a.match(/\bt="([^"]+)"/)||[])[1]||'';const vm=b.match(/<v>([\s\S]*?)<\/v>/);const raw=vm?vm[1]:'';const v=t==='s'?(ss[+raw]??''):dec(raw);if(v!=='')c[col]=v;}rows.push(c);}return rows;}
const buf=fs.readFileSync('C:/INFA/FES-PK/Erzeugung Touren.xlsx');
const e=rz(buf,n=>n==='xl/sharedStrings.xml'||n==='xl/worksheets/sheet1.xml');
const ss=pss(e['xl/sharedStrings.xml']?.toString('utf8'));
const rows=psh(e['xl/worksheets/sheet1.xml']?.toString('utf8'),ss);
const plz=new Map();
for(let i=1;i<rows.length;i++){const id=(rows[i]['A']||'').trim();if(!id||plz.has(id))continue;plz.set(id,(rows[i]['G']||'').trim());}
console.log(`\n=== FES PLZ-Korrektur (${APPLY?'APPLY':'DRY-RUN'}) ===`);
admin.initializeApp({projectId:'baumbewaesserung'});
const db=admin.firestore(); const pref=db.collection('projects').doc(PID);
const snap=await pref.collection('trees').select('pflanzzeitpunkt','plz').get();
let gleich=0,noMatch=0; const upd=[];
snap.forEach(d=>{const x=d.data();const id=String(x.pflanzzeitpunkt??'').trim();const p=plz.get(id);if(!p){noMatch++;return;}if(String(x.plz??'').trim()===p){gleich++;return;}upd.push({ref:d.ref,plz:p});});
console.log(`Objekte ${snap.size} · zu korrigieren ${upd.length} · bereits korrekt ${gleich} · ohne Match ${noMatch}`);
if(APPLY){for(let i=0;i<upd.length;i+=B){const bt=db.batch();upd.slice(i,i+B).forEach(u=>bt.update(u.ref,{plz:u.plz}));await bt.commit();}console.log('✓ Fertig.');}
else console.log('DRY-RUN — nichts geschrieben.');
process.exit(0);
