import { describe, expect, it } from 'vitest';

import {
  campaignFilterResultLabel,
  campaignsMatchingFilters,
  matchesCampaignState,
  parseCampaignState,
} from '@/lib/referent/campaign-state';
import { applyReferentFilter } from '@/lib/today/referent-view';

const REF = (id: string, displayName: string) => ({ id, displayName, isActive: true });
const REFERENTS = {
  C1: REF('me', 'Moi Même'),
  C2: REF('me', 'Moi Même'),
  C3: REF('jane', 'Jane Rivière'),
  C4: REF('me', 'Moi Même'),
};
const CAMPAGNES = [
  { id: 'C1', status: 'active' as const },
  { id: 'C2', status: 'paused' as const },
  { id: 'C3', status: 'active' as const },
  { id: 'C4', status: 'in_progress' as const },
];

describe('filtre d’état de campagne', () => {
  it('« Brouillons » agrège le cadrage en cours ; « Toutes » ne masque rien', () => {
    expect(matchesCampaignState('in_progress', 'draft')).toBe(true);
    expect(matchesCampaignState('draft', 'draft')).toBe(true);
    expect(matchesCampaignState('closed', 'all')).toBe(true);
    expect(matchesCampaignState('paused', 'active')).toBe(false);
  });

  it('préférence illisible ⇒ « Actives », jamais un filtre inventé', () => {
    expect(parseCampaignState('closed')).toBe('closed');
    expect(parseCampaignState('nimporte')).toBe('active');
    expect(parseCampaignState(null)).toBe('active');
  });

  it('CUMULATIFS par construction : Mes campagnes ∧ Actives = mes campagnes actives', () => {
    const mine = { kind: 'recruiter', id: 'me' } as const;
    expect(campaignsMatchingFilters(CAMPAGNES, REFERENTS, mine, 'active').map((c) => c.id)).toEqual(['C1']);
    expect(campaignsMatchingFilters(CAMPAGNES, REFERENTS, mine, 'all').map((c) => c.id)).toEqual(['C1', 'C2', 'C4']);
    expect(
      campaignsMatchingFilters(CAMPAGNES, REFERENTS, { kind: 'all' }, 'active').map((c) => c.id),
    ).toEqual(['C1', 'C3']);
  });

  it('le libellé de résultat dit ce qui est filtré', () => {
    expect(
      campaignFilterResultLabel({ selection: { kind: 'recruiter', id: 'me' }, currentUserId: 'me', state: 'active', count: 7 }),
    ).toBe('Mes campagnes · actives (7 campagnes)');
    expect(
      campaignFilterResultLabel({ selection: { kind: 'all' }, currentUserId: 'me', state: 'closed', count: 1 }),
    ).toBe('Toutes les campagnes · clôturées (1 campagne)');
    expect(
      campaignFilterResultLabel({
        selection: { kind: 'recruiter', id: 'jane' },
        currentUserId: 'me',
        referentLabel: 'Jane R.',
        state: 'paused',
        count: 2,
        unit: { one: 'entretien en cours', many: 'entretiens en cours' },
      }),
    ).toBe('Campagnes de Jane R. · suspendues (2 entretiens en cours)');
  });
});

describe('Aujourd’hui — l’état se cumule au référent, sans toucher aux alertes', () => {
  const item = (id: string, campaignId: string | null, referentId: string) => ({
    id,
    campaignId,
    referent: { id: referentId, displayName: 'X Y', isActive: true },
  });
  const board = {
    allClear: false,
    validation: { total: 3, aLire: { items: [item('a', 'C1', 'me'), item('b', 'C2', 'me'), item('c', null, 'me')], total: 3 }, aEcarter: { total: 0 } },
    entretiens: { total: 0, aConfirmer: { items: [], total: 0 }, aDecider: { items: [], total: 0 } },
    verify: { total: 2, items: [] },
  };

  it('« Actives » masque la candidature d’une campagne suspendue, jamais une sans campagne', () => {
    const statut = new Map([['C1', 'active'], ['C2', 'paused']]);
    const vue = applyReferentFilter(board as never, { kind: 'all' }, 'me', (id) =>
      matchesCampaignState(statut.get(id) as never, 'active'),
    );
    expect(vue.board.validation.aLire.items.map((i: { id: string }) => i.id)).toEqual(['a', 'c']);
    expect(vue.masked.validation).toBe(1);
    // « À vérifier » (alertes) : intact.
    expect(vue.board.verify.total).toBe(2);
  });
});
