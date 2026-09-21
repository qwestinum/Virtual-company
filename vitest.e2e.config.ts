/**
 * Config vitest de la suite E2E (tests/e2e/) — celle qui CLIQUE.
 *
 * ⚠️ Elle exige l'inverse de la régression : l'application DOIT TOURNER
 * (`npm run dev`). Les deux ne se lancent donc jamais ensemble — la régression
 * mesure des compteurs globaux qu'un serveur vivant décale.
 *
 * Séquentiel : un seul navigateur, une seule session, une seule base.
 */
import { resolve } from 'node:path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
