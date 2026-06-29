// Vertrags-Test: Die Fahrer-Schreibfelder im Client (src/driver-fields.js) MÜSSEN exakt mit den
// Allowlists in firestore.rules übereinstimmen. Verhindert das stille Auseinanderdriften, das zum
// „offline gespeichert"-Bug führte (Client schrieb wasser/notiz, Rules lehnten ab).
// Aufruf: npm test   (Exit 1 bei Abweichung)
import { readFileSync } from 'node:fs';
import { TREE_STATUS_FIELDS, TOUR_STATUS_FIELDS } from '../src/driver-fields.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

// Liest die hasOnly([...])-Liste aus einer Rules-Funktion.
function extractHasOnly(fnName){
  const i = rules.indexOf('function ' + fnName);
  if(i < 0) throw new Error(`firestore.rules: Funktion ${fnName}() nicht gefunden`);
  const m = rules.slice(i, i + 800).match(/hasOnly\(\[([^\]]*)\]\)/);
  if(!m) throw new Error(`firestore.rules: hasOnly(...) in ${fnName}() nicht gefunden`);
  return m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
}
const sameSet = (a, b) => { const x=[...a].sort(), y=[...b].sort(); return x.length===y.length && x.every((v,i)=>v===y[i]); };

const checks = [
  { fn: 'onlyStatusFields',     konst: TREE_STATUS_FIELDS, name: 'TREE_STATUS_FIELDS' },
  { fn: 'onlyTourStatusFields', konst: TOUR_STATUS_FIELDS, name: 'TOUR_STATUS_FIELDS' },
];

let ok = true;
for(const c of checks){
  const rulesList = extractHasOnly(c.fn);
  if(sameSet(rulesList, c.konst)){
    console.log(`✓ ${c.fn}() ↔ ${c.name} (${c.konst.length} Felder)`);
  } else {
    ok = false;
    console.error(`✗ ${c.fn}() ≠ ${c.name}`);
    console.error('    Rules :', [...rulesList].sort().join(', '));
    console.error('    Client:', [...c.konst].sort().join(', '));
  }
}

if(ok){ console.log('\n✓ Rules-Vertrag stimmt mit src/driver-fields.js überein.'); process.exit(0); }
console.error('\n✗ Rules und Client-Felder weichen ab — firestore.rules und src/driver-fields.js angleichen.');
process.exit(1);
