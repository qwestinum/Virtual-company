import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { applyReferentFilter } from '@/lib/today/referent-view';
import type { TodayBoard } from '@/lib/today/board';
import type { ReferentInfo } from '@/lib/referent/filter';

const SAMI: ReferentInfo = { id: 'u-sami', displayName: 'Sami Bertin', isActive: true };
const JANE: ReferentInfo = { id: 'u-jane', displayName: 'Jane Roux', isActive: true };

const decision = (id: string, referent: ReferentInfo | null) => ({
  id,
  referent,
  candidateName: `Candidat ${id}`,
  score: 70,
  campaignId: 'CAMP-1',
  waitingDays: 3,
  href: '#',
});

const entretien = (id: string, referent: ReferentInfo | null, kind: 'a_eu_lieu' | 'retenu') => ({
  id,
  referent,
  uid: `uid-${id}`,
  candidateName: `Candidat ${id}`,
  campaignId: 'CAMP-1',
  jobTitle: null,
  startAt: null,
  kind,
  href: '#',
});

const proposition = (id: string, referent: ReferentInfo | null, waitingDays: number) => ({
  id,
  referent,
  campaignId: 'CAMP-1',
  waitingDays,
});

function board(over: Partial<TodayBoard> = {}): TodayBoard {
  return {
    validation: {
      total: 7,
      aLire: { total: 2, items: [decision('a', SAMI), decision('b', JANE)] },
      aEcarter: {
        total: 5,
        oldestDays: 10,
        href: '#',
        items: [
          proposition('p1', SAMI, 2),
          proposition('p2', JANE, 10),
          proposition('p3', SAMI, 4),
          proposition('p4', JANE, 1),
          proposition('p5', SAMI, 3),
        ],
      },
    },
    entretiens: {
      total: 2,
      aConfirmer: { total: 1, items: [entretien('c', SAMI, 'a_eu_lieu')] },
      aDecider: { total: 1, items: [entretien('d', JANE, 'retenu')] },
    },
    verify: {
      total: 2,
      items: [
        { key: 'availability_holidays_unblocked', message: 'm1', ctaLabel: 'x', href: '#' },
        { key: 'campaign_without_candidates', message: 'm2', ctaLabel: 'x', href: '#' },
      ],
    },
    allClear: false,
    ...over,
  };
}

describe('« Tous » ne touche à rien', () => {
  it('rend le MÊME objet, sans copie ni recalcul', () => {
    // L'identité de référence est la preuve qu'aucune ligne n'a été touchée :
    // une copie, même fidèle aujourd'hui, ouvrirait la porte à un filtrage
    // involontaire demain.
    const entree = board();
    const vue = applyReferentFilter(entree, { kind: 'all' }, 'u-sami');
    expect(vue.board).toBe(entree);
    expect(vue.masked).toEqual({ validation: 0, aLire: 0, aEcarter: 0, entretiens: 0 });
    expect(vue.emptiedByFilter).toBe(false);
  });
});

describe('le filtre réduit ce qui s’affiche, et DIT ce qu’il masque', () => {
  const vue = applyReferentFilter(board(), { kind: 'recruiter', id: 'u-sami' }, 'u-sami');

  it('ne garde que les lignes du référent choisi', () => {
    expect(vue.board.validation.aLire.items.map((i) => i.id)).toEqual(['a']);
    expect(vue.board.entretiens.aConfirmer.items.map((i) => i.id)).toEqual(['c']);
    expect(vue.board.entretiens.aDecider.items).toEqual([]);
  });

  it('compte ce qui est masqué, sous-bloc par sous-bloc — un dossier caché reste compté', () => {
    expect(vue.masked.aLire).toBe(1);
    expect(vue.masked.aEcarter).toBe(2);
    expect(vue.masked.validation).toBe(3);
    expect(vue.masked.entretiens).toBe(1);
  });

  it('le TOTAL du sujet n’est pas filtré : le titre de la carte reste vrai', () => {
    // « N candidatures attendent votre validation » est une affirmation.
    // Défaut du 03/10/2026 : le filtre (dont « Actives », par défaut) retirait
    // du total ce qu'il masquait, et l'accueil annonçait un chiffre faux.
    expect(vue.board.validation.total).toBe(7);
    expect(vue.board.entretiens.total).toBe(2);
    // Les LIGNES, elles, sont filtrées.
    expect(vue.board.validation.aLire.total).toBe(1);
  });

  it('même un filtre d’ÉTAT de campagne ne retire rien du total', () => {
    const v = applyReferentFilter(board(), { kind: 'all' }, null, () => false);
    expect(v.board.validation.total).toBe(7);
    expect(v.board.validation.aLire.items).toEqual([]);
    expect(v.board.validation.aEcarter.total).toBe(0);
    expect(v.masked.validation).toBe(7);
  });

  it('« Référent non défini » est une entrée du sélecteur', () => {
    // Un référent désactivé compte comme « non défini » : une catégorie sans
    // porte d'entrée masquerait des dossiers, ce qu'un filtre ne doit pas faire.
    const avecOrphelin = board({
      validation: {
        total: 1,
        aLire: { total: 1, items: [decision('z', null)] },
        aEcarter: { total: 0, oldestDays: 0, href: '#', items: [] },
      },
    });
    const v = applyReferentFilter(avecOrphelin, { kind: 'all' }, null);
    expect(v.options.some((o) => o.selection.kind === 'none')).toBe(true);
  });
});

describe('« À vérifier » n’est JAMAIS filtré', () => {
  it.each([
    ['all', { kind: 'all' as const }],
    ['un recruteur', { kind: 'recruiter' as const, id: 'u-sami' }],
    ['sans référent', { kind: 'none' as const }],
  ])('sélection « %s » : les alertes restent entières', (_, selection) => {
    // Un agenda mal réglé ou une campagne muette ne regardent pas un référent
    // en particulier. Les masquer éteindrait ce qui doit rester visible.
    const vue = applyReferentFilter(board(), selection, 'u-sami');
    expect(vue.board.verify.total).toBe(2);
    expect(vue.board.verify.items).toHaveLength(2);
  });
});

describe('la fournée se filtre COMME le reste de la carte', () => {
  it('« passer en revue » ne garde que les propositions du référent choisi', () => {
    // Défaut du 03/10/2026 : le lot restait entier pendant que les lignes
    // voisines étaient filtrées — deux « à examiner » masqués, treize
    // propositions du MÊME référent affichées.
    const vue = applyReferentFilter(board(), { kind: 'recruiter', id: 'u-sami' }, 'u-sami');
    expect(vue.board.validation.aEcarter.items.map((i) => i.id)).toEqual(['p1', 'p3', 'p5']);
    expect(vue.board.validation.aEcarter.total).toBe(3);
  });

  it('l’ancienneté annoncée est celle du lot AFFICHÉ', () => {
    // La plus ancienne (10 j) est à Jane : sous le filtre « Sami », annoncer
    // 10 jours renverrait à un dossier qu'on ne voit pas.
    const vue = applyReferentFilter(board(), { kind: 'recruiter', id: 'u-sami' }, 'u-sami');
    expect(vue.board.validation.aEcarter.oldestDays).toBe(4);
  });

  it('les propositions comptent dans « Mes campagnes » et dans les entrées du sélecteur', () => {
    const vue = applyReferentFilter(board(), { kind: 'all' }, 'u-jane');
    // 1 à lire (b) + 2 propositions (p2, p4) + 1 entretien (d).
    expect(vue.myCount).toBe(4);
  });
});

describe('« il n’y a rien » et « le filtre cache tout » ne se confondent pas', () => {
  it('filtre qui masque TOUT ⇒ signalé', () => {
    const vide = board({
      validation: {
        total: 1,
        aLire: { total: 1, items: [decision('b', JANE)] },
        aEcarter: { total: 0, oldestDays: 0, href: '#', items: [] },
      },
      entretiens: {
        total: 0,
        aConfirmer: { total: 0, items: [] },
        aDecider: { total: 0, items: [] },
      },
    });
    const vue = applyReferentFilter(vide, { kind: 'recruiter', id: 'u-sami' }, 'u-sami');
    expect(vue.emptiedByFilter).toBe(true);
    expect(vue.masked.validation).toBe(1);
  });

  it('journée RÉELLEMENT vide ⇒ pas signalé comme filtré', () => {
    const rien = board({
      validation: {
        total: 0,
        aLire: { total: 0, items: [] },
        aEcarter: { total: 0, oldestDays: 0, href: '#', items: [] },
      },
      entretiens: { total: 0, aConfirmer: { total: 0, items: [] }, aDecider: { total: 0, items: [] } },
      verify: { total: 0, items: [] },
      allClear: true,
    });
    const vue = applyReferentFilter(rien, { kind: 'recruiter', id: 'u-sami' }, 'u-sami');
    expect(vue.emptiedByFilter).toBe(false);
  });
});

describe('garde STRUCTURELLE — le filtre ne restreint pas les alertes', () => {
  it('le module ne touche jamais à `verify`', () => {
    // Aucun test de valeurs n'attrape une ligne ajoutée un jour qui filtrerait
    // les alertes « juste pour être cohérent ».
    const src = readFileSync(
      resolve(process.cwd(), 'src/lib/today/referent-view.ts'),
      'utf-8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(src).not.toContain('verify:');
    expect(src).not.toContain('board.verify.items.filter');
  });

  it('rien n’est persisté : ni URL ni stockage', () => {
    const vue = readFileSync(
      resolve(process.cwd(), 'src/components/today/TodayBoardView.tsx'),
      'utf-8',
    );
    expect(vue).not.toContain('localStorage');
    expect(vue).not.toContain('sessionStorage');
    expect(vue).not.toContain('useSearchParams');
  });
});
