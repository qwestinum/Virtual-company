import { describe, expect, it } from 'vitest';

import {
  addKeywords,
  parseKeywords,
  removeKeywordAt,
} from '@/lib/scoring/keywords-input';

describe('parseKeywords', () => {
  it('découpe par lignes ET virgules, trim, ignore les vides', () => {
    expect(parseKeywords('React, ReactJS\n  React.js \n,, ')).toEqual([
      'React',
      'ReactJS',
      'React.js',
    ]);
  });
  it('chaîne vide → []', () => {
    expect(parseKeywords('   ')).toEqual([]);
  });
});

describe('addKeywords', () => {
  it('ajoute en ignorant doublons (insensible casse) et blancs', () => {
    expect(addKeywords(['React'], 'react, Redux,  , REACT')).toEqual([
      'React',
      'Redux',
    ]);
  });
  it('préserve la casse et l’ordre de l’existant', () => {
    expect(addKeywords(['JavaScript'], 'JS, ECMAScript')).toEqual([
      'JavaScript',
      'JS',
      'ECMAScript',
    ]);
  });
  it('saisie multiple en une fois', () => {
    expect(addKeywords([], 'a\nb,c')).toEqual(['a', 'b', 'c']);
  });
});

describe('removeKeywordAt', () => {
  it('retire par index', () => {
    expect(removeKeywordAt(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('hors borne → inchangé', () => {
    expect(removeKeywordAt(['a'], 5)).toEqual(['a']);
    expect(removeKeywordAt(['a'], -1)).toEqual(['a']);
  });
});
