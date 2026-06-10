// Erzeugt public/changelog.json aus der Git-Historie — läuft automatisch bei `npm run build`.
// Das Handbuch (Reiter „Aktualisierungen") zeigt diese Liste; Neuerungen landen so
// ohne Zusatzaufwand im Handbuch, sobald sie committet und deployt sind.
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const raw = execSync('git log --no-merges -200 --date=format:%d.%m.%Y --pretty=format:%ad%x09%s', {
    cwd: root, encoding: 'utf8',
  });
  const entries = raw.split('\n').filter(Boolean).map(line => {
    const [d, ...rest] = line.split('\t');
    return { d, t: rest.join('\t') };
  })
  // Interne/technische Einträge ausblenden
  .filter(e => e.t && !/^(merge|wip|tmp|revert)/i.test(e.t));
  mkdirSync(join(root, 'public'), { recursive: true });
  writeFileSync(join(root, 'public', 'changelog.json'), JSON.stringify(entries), 'utf8');
  console.log(`changelog.json: ${entries.length} Einträge`);
} catch (e) {
  console.warn('changelog: Git nicht verfügbar — überspringe.', e.message);
}
