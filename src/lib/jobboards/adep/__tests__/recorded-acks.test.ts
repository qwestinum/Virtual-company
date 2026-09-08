/**
 * Anti-divergence : la copie inline et les `.xml` de référence.
 *
 * `recorded-acks.ts` recopie les acquittements enregistrés parce que le
 * transport de recette est appelé depuis une route Next, et qu'un `readFileSync`
 * vers `__tests__` casserait dans un bundle de production.
 *
 * Une copie qu'aucun test ne surveille finit toujours par mentir : on
 * remplacerait un `.xml` par une vraie réponse de l'Apec, le mock continuerait
 * à jouer l'ancienne, et la recette validerait un comportement qui n'existe
 * plus. Ce test rend cette divergence impossible — dans les DEUX sens : un
 * fichier ajouté sans être recopié est vu, une constante ajoutée sans fichier
 * aussi.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RECORDED_ACKS } from '../recorded-acks';

const FIXTURES = resolve(__dirname, 'fixtures');

describe('acquittements enregistrés', () => {
  it('la copie inline est identique aux .xml de référence', () => {
    for (const [name, inlined] of Object.entries(RECORDED_ACKS)) {
      const onDisk = readFileSync(resolve(FIXTURES, name), 'utf8');
      expect(inlined, `${name} a divergé de sa copie inline`).toBe(onDisk);
    }
  });

  it('tout .xml de fixture est recopié — aucun oubli', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.xml'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(
        Object.keys(RECORDED_ACKS),
        `${file} n'a pas de copie dans recorded-acks.ts`,
      ).toContain(file);
    }
  });
});
