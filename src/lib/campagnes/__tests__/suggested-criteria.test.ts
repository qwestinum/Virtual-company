import { describe, expect, it } from 'vitest';

import { markAsSuggested } from '@/lib/campagnes/suggested-criteria';
import { buildCriterion, countUntreatedSuggestions } from '@/types/scoring';

const critere = (id: string, suggere?: boolean) =>
  buildCriterion({ id, label: id, level: 'important', ...(suggere === undefined ? {} : { suggere }) });

describe('une grille qui ne vient pas du recruteur se confirme', () => {
  it('marque tout ce qui n’a pas déjà été tranché', () => {
    const sortie = markAsSuggested([critere('a'), critere('b')]);
    expect(sortie.every((c) => c.suggere === true)).toBe(true);
    expect(
      countUntreatedSuggestions({ campaignId: 'x', criteria: sortie, isValidated: false }),
    ).toBe(2);
  });

  it('marque AUSSI ce qu’une archive portait déjà confirmé', () => {
    // Une confirmation donnée il y a six mois sur un AUTRE poste n'est pas une
    // confirmation pour celui-ci : ce qui est repris est une proposition.
    const sortie = markAsSuggested([critere('venu-d-archive', false), critere('neuf')]);
    expect(sortie.every((c) => c.suggere === true)).toBe(true);
  });

  it('est idempotent', () => {
    const une = markAsSuggested([critere('a')]);
    expect(markAsSuggested(une)).toEqual(une);
  });

  it('ne perd aucun champ du critère', () => {
    const source = buildCriterion({
      id: 'a',
      label: 'Node.js',
      level: 'critique',
      weight: 8,
      verificationMethod: 'hybrid_keywords_llm',
      keywords: ['node'],
    });
    const [sortie] = markAsSuggested([source]);
    expect(sortie).toEqual({ ...source, suggere: true });
  });
});
