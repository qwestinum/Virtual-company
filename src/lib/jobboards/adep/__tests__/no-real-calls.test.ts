/**
 * GARDE STRUCTURELLE — aucun appel réel à l'Apec depuis les tests.
 *
 * Un test qui joindrait vraiment l'Apec créerait une offre sur apec.fr à chaque
 * `npm test`. Le rejeu est impossible (une référence sert une fois), le
 * nettoyage passe par le support, et personne ne s'en apercevrait avant de voir
 * des annonces « SONDE » en ligne.
 *
 * Aucun test de logique ne peut tenir cette règle : elle porte sur ce que le
 * code IMPORTE, pas sur ce qu'il calcule. D'où une garde qui lit les fichiers,
 * sur le modèle de `scheduling/__tests__/frontier.test.ts`.
 *
 * Trois interdits, et le troisième est le vrai :
 *   1. aucun test n'importe la sonde (`scripts/adep-probe`) ;
 *   2. le seul test autorisé à toucher `http-transport` est celui qui le
 *      teste — et il DOIT injecter son `fetchImpl` ;
 *   3. aucun test ne pose `ADEP_ENABLED` sur le `process.env` réel, ce qui
 *      ferait basculer `resolveTransport` sur le vrai réseau pour tous les
 *      tests suivants du même processus.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = resolve(process.cwd(), 'src');

/** Tous les fichiers de test du dépôt. */
function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      testFiles(full, out);
    } else if (/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ⚠️ La garde s'EXCLUT elle-même : son propre source contient, par nécessité,
 * exactement les chaînes qu'elle traque. Sans cette exclusion elle échouerait
 * en permanence sur elle-même, et la première réaction serait de l'assouplir —
 * c'est-à-dire de la désarmer.
 */
const SELF = relative(process.cwd(), __filename);

const FILES = testFiles(SRC)
  .map((f) => ({ path: relative(process.cwd(), f), source: readFileSync(f, 'utf8') }))
  .filter((f) => f.path !== SELF);

describe('aucun appel réel à l’Apec depuis les tests', () => {
  it('le corpus balayé n’est pas vide', () => {
    // Une garde qui n'inspecte rien passe toujours.
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('aucun test n’importe la sonde', () => {
    // `adep-probe` fait de vrais appels : il n'a rien à faire dans une suite
    // automatisée, même importé « juste pour un helper ».
    const offenders = FILES.filter((f) => /adep-probe/.test(f.source)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it('seul son propre test touche au transport HTTP, et il injecte fetch', () => {
    const users = FILES.filter((f) => /from '.*http-transport'/.test(f.source));
    expect(users.map((f) => f.path)).toEqual([
      'src/lib/jobboards/adep/__tests__/http-transport.test.ts',
    ]);
    for (const file of users) {
      // Sans `fetchImpl`, `createHttpAdepTransport` utilise le `fetch` global.
      expect(file.source, `${file.path} doit injecter fetchImpl`).toContain('fetchImpl');
    }
  });

  it('aucun test ne pose ADEP_ENABLED sur le process.env réel', () => {
    // `resolveTransport` bascule sur le vrai réseau dès que la variable vaut
    // « 1 ». Un test qui la pose — même en la restaurant ensuite — la rend
    // active pour tout ce qui tourne entre-temps dans le même processus.
    const offenders = FILES.filter((f) =>
      /process\.env\.ADEP_ENABLED\s*=/.test(f.source),
    ).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
