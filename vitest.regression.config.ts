/**
 * Config vitest DÉDIÉE à la suite de régression (tests/regression/).
 *
 * Séparée de la suite unitaire (vitest.config.ts, src/**) : la régression
 * traverse les routes API réelles contre la base DEV (seed → test → clean),
 * elle est plus lente et s'exécute AVANT un déploiement (npm run test:regression),
 * pas à chaque tour de boucle locale.
 *
 * Séquentiel obligatoire : les scénarios écrivent dans la même base — on ne
 * parallélise ni les fichiers ni les tests d'un fichier.
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
    include: ['tests/regression/**/*.test.ts'],
    setupFiles: ['tests/regression/setup.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
