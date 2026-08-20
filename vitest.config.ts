import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    /**
     * Budget de temps EXPLICITE — SEUL endroit où il vit.
     *
     * Les 5 s par défaut de vitest n'ont jamais été un budget CHOISI, et
     * plusieurs tests s'en approchaient : rendus `@react-pdf` (~4,5 s, un vrai
     * document, polices comprises) et handlers de routes à chaîne mockée
     * (~4 s). Ils tenaient donc à la charge de la machine — ajouter un test
     * AILLEURS dans la suite les faisait tomber, et le rouge accusait des
     * fichiers qui n'avaient pas bougé (constaté deux fois le 20/08/2026).
     *
     * 20 s : large pour le travail réel, court pour qu'un test réellement
     * bloqué le dise vite. La suite de régression a le sien (30 s), elle
     * traverse la base.
     */
    testTimeout: 20_000,
  },
});
