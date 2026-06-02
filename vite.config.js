import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main:  resolve(__dirname, 'index.html'),
        mobil: resolve(__dirname, 'mobil.html'),
      },
    },
  },
});
