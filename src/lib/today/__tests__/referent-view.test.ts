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

function board(over: Partial<TodayBoard> = {}): TodayBoard {
  return {
    validation: {
      total: 2,
      aLire: { total: 2, items: [decision('a', SAMI), decision('b', JANE)] },
      aEcarter: { total: 5, oldestDays: 10, href: '#' },
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
    expect(vue.masked).toEqual({ validation: 0, entretiens: 0 });
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

  it('compte ce qui est masqué — un dossier caché reste compté', () => {
    expect(vue.masked.validation).toBe(1);
    expect(vue.masked.entretiens).toBe(1);
  });

  it('« Référent non défini » est une entrée du sélecteur', () => {
    // Un référent désactivé compte comme « non défini » : une catégorie sans
    // porte d'entrée masquerait des dossiers, ce qu'un filtre ne doit pas faire.
    const avecOrphelin = board({
      validation: {
        total: 1,
        aLire: { total: 1, items: [decision('z', null)] },
        aEcarter: { total: 0, oldestDays: 0, href: '#' },
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

describe('la fournée n’est pas filtrée, et le compte le dit', () => {
  it('« passer en revue » reste entière', () => {
    // On ne sait pas, depuis l'accueil, quels dossiers elle contient : la
    // filtrer afficherait un compte qu'on ne peut pas tenir.
    const vue = applyReferentFilter(board(), { kind: 'recruiter', id: 'u-sami' }, 'u-sami');
    expect(vue.board.validation.aEcarter.total).toBe(5);
  });
});

describe('« il n’y a rien » et « le filtre cache tout » ne se confondent pas', () => {
  it('filtre qui masque TOUT ⇒ signalé', () => {
    const vide = board({
      validation: {
        total: 1,
        aLire: { total: 1, items: [decision('b', JANE)] },
        aEcarter: { total: 0, oldestDays: 0, href: '#' },
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
        aEcarter: { total: 0, oldestDays: 0, href: '#' },
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
