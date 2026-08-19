import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  plugins: [react()],
  css: {
    postcss: path.resolve(here, '../postcss.config.js')
  },
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: false,
    cssCodeSplit: false,
    target: 'es2020'
  }
});
