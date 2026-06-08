import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
        main:         resolve(__dirname, 'index.html'),
        mobil:        resolve(__dirname, 'mobil.html'),
        navi:         resolve(__dirname, 'navi.html'),
        erfassung:    resolve(__dirname, 'erfassung.html'),
        einsatzleiter: resolve(__dirname, 'einsatzleiter.html'),
      },
    },
  },
});
