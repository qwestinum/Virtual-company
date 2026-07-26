/**
 * S2 — Fiche de scoring : création, modification, validation-gate.
 * La fiche vit dans le snapshot campagne (PUT /api/campaigns) — c'est le
 * contrat client réel (pas de route fiche dédiée).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as listCampaigns, PUT as putCampaign } from '@/app/api/campaigns/route';
import { PATCH as patchCampaign } from '@/app/api/campaigns/[id]/route';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';

import { call, callWithId, testCampaignPayload, testScoringSheet } from './helpers/api';
import { cleanAll, newTestCampaignId } from './helpers/db';

const camp = newTestCampaignId('s2');

beforeAll(async () => {
  await cleanAll();
});
afterAll(async () => {
  await cleanAll();
});

async function readSheetFromApi(id: string): Promise<ScoringSheet | null> {
  const list = await call(listCampaigns);
  const campaign = (list.json.campaigns as Array<{ id: string; scoringSheet: ScoringSheet | null }>).find(
    (c) => c.id === id,
  );
  return campaign?.scoringSheet ?? null;
}

describe('S2 — fiche de scoring', () => {
  it('créer une fiche (rédhibitoire + souhaités + pondérations) → persistée conforme', async () => {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: camp, sheetValidated: false }),
    });
    expect(res.status).toBe(200);

    const sheet = await readSheetFromApi(camp);
    expect(sheet).not.toBeNull();
    expect(sheet!.isValidated).toBe(false);
    expect(sheet!.criteria).toHaveLength(4);
    const ko = sheet!.criteria.find((c) => c.id === 'treg-ko');
    expect(ko?.level).toBe('redhibitoire');
    expect(ko?.weight).toBe(0);
    const c1 = sheet!.criteria.find((c) => c.id === 'treg-c1');
    expect(c1?.level).toBe('critique');
    expect(c1?.weight).toBe(8);
  });

  it('modifier un critère / une pondération → relu correctement', async () => {
    const payload = testCampaignPayload({ id: camp, sheetValidated: false });
    payload.scoringSheet = {
      ...testScoringSheet(camp, { validated: false }),
      criteria: [
        ...testScoringSheet(camp, { validated: false }).criteria.filter(
          (c) => c.id !== 'treg-c3',
        ),
        buildCriterion({
          id: 'treg-c3',
          label: 'Anglais courant exigé',
          level: 'important',
          weight: 5,
        }),
      ],
    };
    const res = await call(putCampaign, { method: 'PUT', body: payload });
    expect(res.status).toBe(200);

    const sheet = await readSheetFromApi(camp);
    const c3 = sheet!.criteria.find((c) => c.id === 'treg-c3');
    expect(c3?.label).toBe('Anglais courant exigé');
    expect(c3?.weight).toBe(5);
  });

  it('fiche non validée → activation refusée ; fiche validée → activation possible', async () => {
    // Fiche encore en brouillon → l'activation DOIT être refusée (invariant S1).
    const refused = await callWithId(patchCampaign, camp, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    expect(refused.status).toBe(409);
    expect(refused.json.error).toBe('scoring_sheet_not_validated');

    // Validation de la fiche (PUT du snapshot avec isValidated: true).
    const validated = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: camp, sheetValidated: true }),
    });
    expect(validated.status).toBe(200);
    expect((await readSheetFromApi(camp))?.isValidated).toBe(true);

    const activated = await callWithId(patchCampaign, camp, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    expect(activated.status).toBe(200);
    expect((activated.json.campaign as { status: string }).status).toBe('active');
  });

  it('cohérence serveur : fiche VALIDÉE avec critère déterministe sans mots-clés → 422', async () => {
    const payload = testCampaignPayload({ id: camp, sheetValidated: true });
    payload.scoringSheet = {
      campaignId: camp,
      isValidated: true,
      criteria: [
        buildCriterion({
          id: 'treg-det',
          label: 'Certification exigée',
          level: 'critique',
          verificationMethod: 'keywords_exact',
          // volontairement AUCUN mot-clé → fiche incohérente
        }),
      ],
    };
    const res = await call(putCampaign, { method: 'PUT', body: payload });
    expect(res.status).toBe(422);
    expect(res.json.error).toBe('invalid_scoring_sheet');
  });
});
