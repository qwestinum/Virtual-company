import { describe, expect, it } from 'vitest';

import {
  verifyKeywordsExact,
  verifyKeywordsWithVariants,
} from '@/lib/scoring/keyword-matcher';

describe('verifyKeywordsExact', () => {
  it('trouvé → satisfait + mot-clé + citation avec contexte', () => {
    const r = verifyKeywordsExact(
      'Développeur front avec 5 ans de React et Redux en production.',
      ['React'],
    );
    expect(r.verdict).toBe('satisfait');
    expect(r.matchedKeyword).toBe('React');
    expect(r.citation).toMatch(/React/);
    expect(r.citation.length).toBeGreaterThan('React'.length);
  });

  it('non trouvé → non, citation vide, matchedKeyword null', () => {
    const r = verifyKeywordsExact('Profil Java backend.', ['React']);
    expect(r).toEqual({ verdict: 'non', citation: '', matchedKeyword: null });
  });

  it('insensible à la casse', () => {
    expect(verifyKeywordsExact('expert REACT.js', ['react']).verdict).toBe('satisfait');
    expect(verifyKeywordsExact('expert react', ['REACT']).verdict).toBe('satisfait');
  });

  it('frontières de mot : « JS » ne matche pas dans « jsdom »', () => {
    expect(verifyKeywordsExact('Tests via jsdom uniquement.', ['JS']).verdict).toBe('non');
    expect(verifyKeywordsExact('Maîtrise de JS et TS.', ['JS']).verdict).toBe('satisfait');
  });

  it('caractères spéciaux préservés : « C++ » matche « C++ » mais pas « C »', () => {
    expect(verifyKeywordsExact('Dev C++ embarqué.', ['C++']).verdict).toBe('satisfait');
    expect(verifyKeywordsExact('Langage C pur.', ['C++']).verdict).toBe('non');
    expect(verifyKeywordsExact('Stack .NET et C#.', ['.NET']).verdict).toBe('satisfait');
  });

  it('accents gérés (Unicode)', () => {
    expect(verifyKeywordsExact('Expérience en aéronautique.', ['aéronautique']).verdict).toBe(
      'satisfait',
    );
  });

  it('ignore les mots-clés vides / blancs', () => {
    const r = verifyKeywordsExact('Profil React.', ['', '   ', 'React']);
    expect(r.verdict).toBe('satisfait');
    expect(r.matchedKeyword).toBe('React');
  });

  it('premier mot-clé trouvé (ordre de la liste) retenu', () => {
    const r = verifyKeywordsExact('Compétences : Vue et React.', ['Angular', 'React', 'Vue']);
    // Angular absent, React présent avant Vue dans la liste → React.
    expect(r.matchedKeyword).toBe('React');
  });
});

describe('verifyKeywordsWithVariants', () => {
  it('mécanique identique : matche n’importe quelle variante', () => {
    expect(
      verifyKeywordsWithVariants('Maîtrise d’ECMAScript et TypeScript.', [
        'JavaScript',
        'JS',
        'ECMAScript',
      ]).matchedKeyword,
    ).toBe('ECMAScript');
  });

  it('aucune variante présente → non', () => {
    expect(
      verifyKeywordsWithVariants('Backend Python.', ['JavaScript', 'JS', 'Node.js']).verdict,
    ).toBe('non');
  });
});
