import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Si los datos de edificios están en otro servidor (VITE_DATA_BASE_URL), no hace
 * falta llevarlos dentro de dist/: Vite copia todo public/, y los datos pesan decenas de MB.
 */
function pruneLocalData(externalData: boolean): Plugin {
  return {
    name: 'prune-local-data',
    apply: 'build',
    closeBundle() {
      if (externalData) rmSync(resolve('dist/data'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');

  return {
    // Rutas relativas: el build se puede servir desde cualquier subcarpeta
    // de un hosting estático (GitHub Pages, Netlify, etc.) sin tocar config.
    base: './',
    plugins: [pruneLocalData(Boolean(env['VITE_DATA_BASE_URL']))],
    build: {
      // MapLibre por sí solo pesa ~1 MB minificado (~280 KB gzip); es esperable.
      chunkSizeWarningLimit: 1500,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
