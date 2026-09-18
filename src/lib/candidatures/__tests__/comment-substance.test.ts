import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assessCommentSubstance,
  countedWords,
  describeCommentShortfall,
  MIN_ACCEPTED_CHARS,
  MIN_COMMENT_DISTINCT_WORDS,
  MIN_COMMENT_WORDS,
} from '@/lib/candidatures/comment-substance';

const REAL =
  'Solide sur la recette et le pilotage du lot, il a su expliquer ses arbitrages ; ' +
  'réserve sur la mobilité géographique, à confirmer avec le client.';

describe('assessCommentSubstance — ce qui passe', () => {
  it('un vrai motif passe', () => {
    const s = assessCommentSubstance(REAL);
    expect(s.ok).toBe(true);
    expect(s.shortfall).toBeNull();
    expect(describeCommentShortfall(s)).toBeNull();
  });

  it('pile au seuil : 15 mots dont 10 distincts', () => {
    const text = 'un deux trois quatre cinq six sept huit neuf dix un deux trois quatre cinq';
    const s = assessCommentSubstance(text);
    expect(s.words).toBe(MIN_COMMENT_WORDS);
    expect(s.distinctWords).toBe(MIN_COMMENT_DISTINCT_WORDS);
    expect(s.ok).toBe(true);
  });

  it('apostrophes et traits d’union internes : un mot', () => {
    expect(countedWords("qu'il peut-être aujourd’hui")).toEqual(["qu'il", 'peut-être', 'aujourd’hui']);
  });

  it('les accents décomposés (NFD) ne coupent pas un mot', () => {
    const nfd = 'réserve'.normalize('NFD');
    expect(countedWords(nfd)).toHaveLength(1);
  });
});

describe('assessCommentSubstance — la case cochée déguisée ne passe pas', () => {
  it.each([
    ['vide', ''],
    ['espaces', '     '],
    ['« ok pour moi »', 'ok pour moi'],
    ['« ok pour moi, bon profil »', 'ok pour moi, bon profil'],
    ['« RAS »', 'RAS'],
    ['« GO »', 'GO !!!'],
  ])('%s', (_label, text) => {
    const s = assessCommentSubstance(text);
    expect(s.ok).toBe(false);
    expect(s.shortfall).toBe('too_few_words');
  });

  it('chiffres, ponctuation, émojis et lettres isolées ne comptent pas', () => {
    const text = '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 — ✅ 👍 a b c d e f g h i j k l m n o p';
    expect(assessCommentSubstance(text).words).toBe(0);
  });

  it('« bla » ×15 : assez de mots, trop peu de distincts', () => {
    const s = assessCommentSubstance(Array(15).fill('bla').join(' '));
    expect(s.words).toBe(15);
    expect(s.ok).toBe(false);
    expect(s.shortfall).toBe('too_repetitive');
    expect(describeCommentShortfall(s)).toContain('se répète');
  });

  it('la casse et les accents ne fabriquent pas de mots distincts', () => {
    const text = 'Bien BIEN bien Bièn ok OK Ok oké bon Bon BON top Top TOP très';
    expect(assessCommentSubstance(text).distinctWords).toBeLessThan(MIN_COMMENT_DISTINCT_WORDS);
  });

  it('le message dit combien de mots manquent', () => {
    expect(describeCommentShortfall(assessCommentSubstance('bon profil technique'))).toBe(
      'Encore 12 mots : expliquez ce qui motive votre décision.',
    );
    const fourteen = 'un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze';
    expect(describeCommentShortfall(assessCommentSubstance(fourteen))).toBe(
      'Encore un mot : expliquez ce qui motive votre décision.',
    );
  });
});

describe('couplage avec la base — le plancher reste SOUS la règle', () => {
  const sql = readFileSync(resolve(__dirname, '../../../../scripts/migrate.sql'), 'utf8');
  const m = sql.match(
    /verdict_comments_body_chk\s+check\s*\(\s*char_length\(btrim\(body\)\)\s*>=\s*(\d+)\s*\)/u,
  );

  it('le plancher est lu dans migrate.sql', () => {
    expect(m, 'contrainte verdict_comments_body_chk introuvable ou réécrite').not.toBeNull();
  });

  it('le plancher en base ≤ le plus court texte que la route accepte', () => {
    // Sinon : la route accepte, la base refuse — un 500 au lieu d'un 400.
    expect(Number(m![1])).toBeLessThanOrEqual(MIN_ACCEPTED_CHARS);
  });

  it('MIN_ACCEPTED_CHARS est bien atteignable (la borne n’est pas théorique)', () => {
    const shortest = 'aa ab ac ad ae af ag ah ai aj ak al am an ao';
    expect(shortest).toHaveLength(MIN_ACCEPTED_CHARS);
    expect(assessCommentSubstance(shortest).ok).toBe(true);
  });
});
