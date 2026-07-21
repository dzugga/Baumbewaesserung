// Tests für src/kontrolle.js (Vor-Ort-Kontrolle: Status-Mapping)
import { kontrolleNorm, kontrolleColor, kontrolleLabel, kontrolleCounts } from '../src/kontrolle.js';

let ok = 0, fail = 0;
const t = (name, cond) => { if (cond) { ok++; console.log('✓ ' + name); } else { fail++; console.error('✗ ' + name); } };

t('norm ok', kontrolleNorm('ok') === 'ok');
t('norm loeschen', kontrolleNorm('loeschen') === 'loeschen');
t('norm leer', kontrolleNorm('') === '');
t('norm unbekannt → leer', kontrolleNorm('quatsch') === '' && kontrolleNorm(undefined) === '');
t('label ungeprüft', kontrolleLabel('') === 'ungeprüft');
t('label löschvorschlag', kontrolleLabel('loeschen') === 'Löschvorschlag');
t('farbe ok grün', kontrolleColor('ok') === '#16a34a');
t('farbe loeschen rot', kontrolleColor('loeschen') === '#dc2626');
t('farbe ungeprüft grau', kontrolleColor('x') === '#b4b2a9');

const c = kontrolleCounts([{ kontrolle: 'ok' }, { kontrolle: 'ok' }, { kontrolle: 'loeschen' }, { kontrolle: '' }, { kontrolle: 'mist' }, {}]);
t('counts gesamt', c.gesamt === 6);
t('counts ok', c.ok === 2);
t('counts loeschen', c.loeschen === 1);
t('counts ungeprüft (leer+ungültig+fehlend)', c.ungeprueft === 3);
t('leere Liste', kontrolleCounts([]).gesamt === 0 && kontrolleCounts(undefined).gesamt === 0);

console.log(`kontrolle: ${ok} ok, ${fail} fehlgeschlagen`);
if (fail) process.exit(1);
