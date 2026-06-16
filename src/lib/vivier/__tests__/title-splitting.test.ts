import { describe, expect, it } from 'vitest';

import { splitTitleIntoBlocks } from '@/lib/vivier/title-splitting';

describe('splitTitleIntoBlocks', () => {
  it('titre simple ⇒ uniquement le titre complet', () => {
    expect(splitTitleIntoBlocks('Test Manager')).toEqual(['Test Manager']);
  });

  it('slash ⇒ complet + blocs, complet en tête', () => {
    expect(splitTitleIntoBlocks('Test Manager / QA Lead')).toEqual([
      'Test Manager / QA Lead',
      'Test Manager',
      'QA Lead',
    ]);
  });

  it('pipe et esperluette séparent', () => {
    expect(splitTitleIntoBlocks('Dev Back | Dev API')).toEqual([
      'Dev Back | Dev API',
      'Dev Back',
      'Dev API',
    ]);
    expect(splitTitleIntoBlocks('Sales & Marketing')).toEqual([
      'Sales & Marketing',
      'Sales',
      'Marketing',
    ]);
  });

  it('« et » entouré d’espaces sépare', () => {
    expect(splitTitleIntoBlocks('Comptable et Auditeur')).toEqual([
      'Comptable et Auditeur',
      'Comptable',
      'Auditeur',
    ]);
  });

  it('tiret entouré d’espaces sépare (simple et demi-cadratin)', () => {
    expect(splitTitleIntoBlocks('Test Manager - QA Lead')).toEqual([
      'Test Manager - QA Lead',
      'Test Manager',
      'QA Lead',
    ]);
    expect(splitTitleIntoBlocks('Test Manager – QA Lead')).toEqual([
      'Test Manager – QA Lead',
      'Test Manager',
      'QA Lead',
    ]);
  });

  it('RÈGLE CRITIQUE — tiret collé NE sépare PAS', () => {
    expect(splitTitleIntoBlocks('Sous-directeur')).toEqual(['Sous-directeur']);
    expect(splitTitleIntoBlocks('Ingénieur-conseil')).toEqual([
      'Ingénieur-conseil',
    ]);
    expect(splitTitleIntoBlocks('QA-Lead')).toEqual(['QA-Lead']);
  });

  it('combine tiret collé (intact) et slash (sépare)', () => {
    expect(splitTitleIntoBlocks('Sous-directeur / QA-Lead')).toEqual([
      'Sous-directeur / QA-Lead',
      'Sous-directeur',
      'QA-Lead',
    ]);
  });

  it('titre vide ⇒ liste vide', () => {
    expect(splitTitleIntoBlocks('   ')).toEqual([]);
  });

  it('déduplique (insensible à la casse) si un bloc répète le complet', () => {
    // Un seul bloc effectif ⇒ pas de doublon avec le complet.
    expect(splitTitleIntoBlocks('QA Lead ')).toEqual(['QA Lead']);
  });
});
