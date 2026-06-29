import { defineConfig } from 'vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

// Eindeutige Build-Kennung je Deploy: Git-Kurzhash + Zeitstempel (Fallback nur Zeitstempel).
// Wird als __BUILD_ID__ in alle Apps eingeprägt UND als /version.json mit ausgeliefert,
// damit laufende Apps einen neuen Deploy erkennen (siehe src/version-check.js).
function makeBuildId(command){
  if(command !== 'build') return 'dev';
  let git = '';
  try{ git = execSync('git rev-parse --short HEAD').toString().trim(); }catch(_){}
  return (git ? git + '-' : '') + Date.now();
}

export default defineConfig(({ command }) => {
  const BUILD = makeBuildId(command);
  let _emitted = false;
  return {
    define: { __BUILD_ID__: JSON.stringify(BUILD) },
    plugins: [{
      name: 'emit-version-json',
      generateBundle(){
        if(_emitted) return; _emitted = true;
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD }) });
      },
    }],
    server: {
      port: 3001,
      host: true,                       // auch über LAN/Extension erreichbar
      headers: { 'Cache-Control': 'no-store' }, // Browser cached Dev-Module nicht → kein "stale"
      watch: { usePolling: true, interval: 200 }, // Windows: Datei-Edits zuverlässig erkennen
      hmr: { overlay: true },
    },
    build: {
      rollupOptions: {
        input: {
          main:          resolve(__dirname, 'index.html'),
          mobil:         resolve(__dirname, 'mobil.html'),
          erfassung:     resolve(__dirname, 'erfassung.html'),
          einsatzleiter: resolve(__dirname, 'einsatzleiter.html'),
        },
      },
    },
  };
});
