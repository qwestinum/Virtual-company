import { describe, expect, it } from 'vitest';

import {
  anchorLabel,
  anchorWeight,
  buildAnchorSkeletons,
  matchAnchors,
  type TitleAnchor,
} from '@/lib/vivier/title-anchors';

// Normalisation de match alignée sur la présélection (casse + accents).
const norm = (s: string) =>
  s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

describe('buildAnchorSkeletons', () => {
  it('titre déclaré (depth 0) + 2 derniers postes (depth 1, 2), splittés', () => {
    const sk = buildAnchorSkeletons(
      'Ingénieur Qualité Logicielle en reconversion vers le DevOps',
      ['Ingénieur Qualité Logicielle', 'Testeur QA'],
    );
    expect(sk.map((a) => a.depth)).toEqual([0, 1, 2]);
    expect(sk[1].text).toBe('Ingénieur Qualité Logicielle');
    // Split appliqué (ici 1 bloc chacun).
    expect(sk[1].blocks).toEqual(['Ingénieur Qualité Logicielle']);
  });

  it('cap à 2 postes', () => {
    const sk = buildAnchorSkeletons('T', ['P1', 'P2', 'P3']);
    expect(sk.map((a) => a.text)).toEqual(['T', 'P1', 'P2']);
  });

  it('déduplique un poste identique au titre déclaré', () => {
    const sk = buildAnchorSkeletons('Testeur', ['testeur', 'QA Lead']);
    // « testeur » (poste) == « Testeur » (titre) ⇒ ignoré ; QA Lead reste à depth 2.
    expect(sk.map((a) => ({ t: a.text, d: a.depth }))).toEqual([
      { t: 'Testeur', d: 0 },
      { t: 'QA Lead', d: 2 },
    ]);
  });

  it('titre absent ⇒ les postes gardent leur palier (depth 1, 2), pas depth 0', () => {
    const sk = buildAnchorSkeletons(null, ['Dev', 'QA']);
    expect(sk.map((a) => a.depth)).toEqual([1, 2]);
  });

  it('applique la règle de split (slash) sur une ancre composée', () => {
    const sk = buildAnchorSkeletons('Test Manager / QA Lead', []);
    expect(sk[0].blocks).toEqual(['Test Manager / QA Lead', 'Test Manager', 'QA Lead']);
  });
});

describe('anchorWeight / anchorLabel', () => {
  it('poids par depth, repli sur le dernier', () => {
    const w = [1, 0.95, 0.9];
    expect(anchorWeight(0, w)).toBe(1);
    expect(anchorWeight(1, w)).toBe(0.95);
    expect(anchorWeight(2, w)).toBe(0.9);
    expect(anchorWeight(5, w)).toBe(0.9); // au-delà ⇒ dernier
  });
  it('libellés', () => {
    expect(anchorLabel(0)).toBe('Titre déclaré');
    expect(anchorLabel(1)).toBe('Dernier poste');
    expect(anchorLabel(2)).toBe('Poste précédent');
  });
});

describe('matchAnchors', () => {
  const anchors: TitleAnchor[] = [
    { text: 'Ingénieur QL en reconversion DevOps', depth: 0, terms: ['ingénieur ql en reconversion devops'] },
    { text: 'Ingénieur Qualité Logicielle', depth: 1, terms: ['Ingénieur Qualité Logicielle', 'QA Engineer'] },
    { text: 'Testeur QA', depth: 2, terms: ['Testeur QA', 'QA Tester'] },
  ];

  it('matche via une ancre de poste quand le titre déclaré échoue (variante partagée)', () => {
    const campaignSet = new Set(['qa engineer', 'tester']); // variantes du poste « testeur »
    const m = matchAnchors(anchors, campaignSet, norm);
    expect(m).toEqual({ term: 'QA Engineer', depth: 1, anchorText: 'Ingénieur Qualité Logicielle' });
  });

  it('récence d’abord : si deux ancres matchent, la plus récente (depth faible) gagne', () => {
    const campaignSet = new Set(['qa engineer', 'qa tester']);
    const m = matchAnchors(anchors, campaignSet, norm);
    expect(m?.depth).toBe(1); // depth 1 avant depth 2
  });

  it('aucune ancre ne matche ⇒ null', () => {
    expect(matchAnchors(anchors, new Set(['boulanger']), norm)).toBeNull();
  });
});
