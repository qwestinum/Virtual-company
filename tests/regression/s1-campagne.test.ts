/**
 * S1 — Cycle de vie campagne (création, édition, boîte mail, statuts).
 * Parcours par les routes API réelles ; assertions sur l'état base + réponses.
 *
 * ⚠️ Assertion STRICTE (décision DO 26/07/2026) : l'invariant « active ⇒ fiche
 * de scoring validée » doit être appliqué CÔTÉ SERVEUR. Si ce test échoue,
 * c'est un trou réel à corriger côté API — ne JAMAIS affaiblir l'assertion.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as listCampaigns, PUT as putCampaign } from '@/app/api/campaigns/route';
import { PATCH as patchCampaign } from '@/app/api/campaigns/[id]/route';
import { GET as getCampaignMailboxes } from '@/app/api/campaigns/[id]/mailboxes/route';
import { POST as createMailbox } from '@/app/api/mailboxes/route';
import { POST as associateMailbox } from '@/app/api/mailboxes/[id]/associate/route';

import { call, callWithId, testCampaignPayload } from './helpers/api';
import { cleanAll, newTestCampaignId, readRow } from './helpers/db';

const campA = newTestCampaignId('s1a');
const campB = newTestCampaignId('s1b');

beforeAll(async () => {
  await cleanAll();
});
afterAll(async () => {
  await cleanAll();
});

describe('S1 — cycle de vie campagne', () => {
  it('créer une campagne → persistée, statut correct, visible en liste', async () => {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: campA, thresholdLow: 30, thresholdHigh: 75 }),
    });
    expect(res.status).toBe(200);

    const row = await readRow<{ status: string; threshold_low: number; threshold_high: number; name: string }>(
      'campaigns',
      campA,
    );
    expect(row.status).toBe('draft');
    expect(row.threshold_low).toBe(30);
    expect(row.threshold_high).toBe(75);

    const list = await call(listCampaigns);
    expect(list.status).toBe(200);
    const ids = (list.json.campaigns as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toContain(campA);
  });

  it('modifier intitulé + poignées HITL → persistés et relus', async () => {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({
        id: campA,
        jobTitle: 'Testeur Logiciel Senior TREG',
        thresholdLow: 40,
        thresholdHigh: 80,
      }),
    });
    expect(res.status).toBe(200);

    const row = await readRow<{ threshold_low: number; threshold_high: number }>(
      'campaigns',
      campA,
    );
    expect(row.threshold_low).toBe(40);
    expect(row.threshold_high).toBe(80);

    const list = await call(listCampaigns);
    const camp = (list.json.campaigns as Array<{ id: string; fdp: { fields: Record<string, { value?: unknown }> } }>).find(
      (c) => c.id === campA,
    );
    expect(camp?.fdp.fields.job_title?.value).toBe('Testeur Logiciel Senior TREG');
  });

  it('associer une boîte mail → association effective', async () => {
    const created = await call(createMailbox, {
      method: 'POST',
      body: {
        label: '[TREG] boite de test',
        imapHost: 'imap.test.local',
        imapPort: 993,
        imapSsl: true,
        userEmail: 'boite-s1@test.local',
        password: 'motdepasse-factice',
        isEnabled: false,
      },
    });
    expect(created.status).toBe(200);
    const mailboxId = (created.json.mailbox as { id: string }).id;

    const assoc = await callWithId(associateMailbox, mailboxId, {
      method: 'POST',
      body: { campaignId: campA },
    });
    expect(assoc.status).toBe(204);

    const listed = await callWithId(getCampaignMailboxes, campA, { method: 'GET' });
    expect(listed.json.mailboxIds).toContain(mailboxId);
  });

  it("INVARIANT STRICT : activer une campagne SANS fiche validée est REFUSÉ par l'API", async () => {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: campB, sheetValidated: false }),
    });
    expect(res.status).toBe(200);

    const activated = await callWithId(patchCampaign, campB, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    // Prémisse de l'écartement C4 : une campagne active a TOUJOURS une fiche
    // validée. Le serveur doit la garantir, pas seulement le client.
    expect(activated.status).toBe(409);
    expect(activated.json.error).toBe('scoring_sheet_not_validated');

    const row = await readRow<{ status: string }>('campaigns', campB);
    expect(row.status).toBe('draft');
  });

  it('désactiver / réactiver → statut cohérent à chaque transition', async () => {
    const activate = await callWithId(patchCampaign, campA, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    expect(activate.status).toBe(200);
    expect((await readRow<{ status: string }>('campaigns', campA)).status).toBe('active');

    const pause = await callWithId(patchCampaign, campA, {
      method: 'PATCH',
      body: { status: 'paused' },
    });
    expect(pause.status).toBe(200);
    expect((await readRow<{ status: string }>('campaigns', campA)).status).toBe('paused');

    const reactivate = await callWithId(patchCampaign, campA, {
      method: 'PATCH',
      body: { status: 'active' },
    });
    expect(reactivate.status).toBe(200);
    expect((await readRow<{ status: string }>('campaigns', campA)).status).toBe('active');
  });
});
