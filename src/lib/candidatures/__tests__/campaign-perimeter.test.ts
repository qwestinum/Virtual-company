import { describe, expect, it } from 'vitest';

import {
  AUCUNE_CAMPAGNE,
  perimetreCampagnes,
} from '../campaign-perimeter';

const base = { campaignId: '', campaignIds: [] as string[], referentCampaignIds: null };

describe('périmètre de campagnes', () => {
  it('« Tous » laisse le sélecteur décider seul', () => {
    expect(perimetreCampagnes({ ...base, campaignIds: ['A', 'B'] })).toEqual({
      campaignId: '',
      campaignIdsParam: 'A,B',
    });
    expect(perimetreCampagnes({ ...base, campaignId: 'A' })).toEqual({
      campaignId: 'A',
      campaignIdsParam: undefined,
    });
    expect(perimetreCampagnes(base)).toEqual({
      campaignId: '',
      campaignIdsParam: undefined,
    });
  });

  it('les deux réglages se COMBINENT (actives ∩ mes campagnes)', () => {
    expect(
      perimetreCampagnes({
        campaignId: '',
        campaignIds: ['A', 'B', 'C'],
        referentCampaignIds: ['B', 'C', 'D'],
      }),
    ).toEqual({ campaignId: '', campaignIdsParam: 'B,C' });
  });

  it('sans sélecteur, le référent définit seul le périmètre', () => {
    expect(
      perimetreCampagnes({ ...base, referentCampaignIds: ['A', 'B'] }),
    ).toEqual({ campaignId: '', campaignIdsParam: 'A,B' });
  });

  it('une campagne unique hors du référent vide le périmètre', () => {
    expect(
      perimetreCampagnes({ campaignId: 'Z', campaignIds: [], referentCampaignIds: ['A'] }),
    ).toEqual({ campaignId: '', campaignIdsParam: AUCUNE_CAMPAGNE });
  });

  it('une campagne unique DANS le référent passe telle quelle', () => {
    expect(
      perimetreCampagnes({ campaignId: 'A', campaignIds: [], referentCampaignIds: ['A'] }),
    ).toEqual({ campaignId: 'A', campaignIdsParam: undefined });
  });

  it('⚠️ une intersection VIDE n’est jamais « toutes »', () => {
    // Le piège : `undefined` vaut « aucune restriction » côté serveur. Rendre
    // une liste vide afficherait TOUT à quelqu'un qui a demandé un
    // sous-ensemble sans résultat.
    for (const entree of [
      { campaignId: '', campaignIds: ['A'], referentCampaignIds: ['B'] },
      { campaignId: '', campaignIds: [], referentCampaignIds: [] },
    ]) {
      expect(perimetreCampagnes(entree).campaignIdsParam).toBe(AUCUNE_CAMPAGNE);
    }
  });
});
