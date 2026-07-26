/**
 * S5 — Vivier, parcours courant : capitalisation → recherche/présélection →
 * contact → repêchage (from_vivier=true).
 *
 * NOTE sur le seeding : la capitalisation passe par le VRAI chemin produit
 * (POST /api/cv-analyzer → hook `after()` → feedVivierFromApplication →
 * indexation). Le setup exécute les `after()` en microtâche (cf. setup.ts) :
 * on ATTEND donc l'état indexé par POLLING de la base — pas d'appel direct à
 * l'indexation. Si ce chemin devenait impossible hors serveur Next, la
 * dérogation validée (26/07/2026) autoriserait UNIQUEMENT ce seeding en appel
 * direct — jamais la recherche/présélection/repêchage, toujours testés par
 * l'API réelle.
 *
 * Embeddings mockés DÉTERMINISTES : même texte ⇒ même vecteur ⇒ le titre du
 * candidat (« Testeur Logiciel TREG », fixture d'entités) matche l'intitulé
 * de la campagne avec un cosinus de 1 — la mécanique pgvector (RPC réelles)
 * est traversée pour de vrai.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as keywordSearch } from '@/app/api/campaigns/[id]/vivier-keyword-search/route';
import { POST as runPreselection } from '@/app/api/campaigns/[id]/vivier-preselection/route';
import { POST as decidePreselection } from '@/app/api/campaigns/[id]/vivier-preselection/decisions/route';

import { call, callWithId, cvAnalyzerForm, testCampaignPayload, testScoringSheet, until } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRow } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

// DEUX campagnes : le vivier est un stock INTER-campagnes. Le candidat est
// capitalisé via sa candidature à la campagne A, puis retrouvé/repêché par la
// campagne B — un candidat ayant déjà postulé à une campagne est, par
// conception, EXCLU de la présélection de cette même campagne.
const campSource = newTestCampaignId('s5src');
const camp = newTestCampaignId('s5');
let vivierCandidateId = '';

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  for (const id of [campSource, camp]) {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({
        id,
        status: 'active',
        sources: ['manual', 'email', 'vivier'],
      }),
    });
    expect(res.status).toBe(200);
  }
});
afterAll(async () => {
  await cleanAll();
});

describe('S5 — vivier', () => {
  it('candidat capitalisé au vivier après analyse → présent et indexé', async () => {
    const taskId = `treg_s5_seed_${Date.now().toString(36)}`;
    const res = await call(analyzeCv, {
      method: 'POST',
      form: cvAnalyzerForm({
        profile: 'fort',
        campaignId: campSource,
        sheet: testScoringSheet(campSource),
        thresholdLow: 30,
        thresholdHigh: 75,
        taskId,
      }),
    });
    expect(res.status).toBe(200);

    // L'alimentation + l'indexation tournent en effet différé → polling.
    const candidate = await until(async () => {
      const { data } = await db()
        .from('vivier_candidates')
        .select('id, title, indexing_status')
        .eq('email', 'fort@test.local')
        .maybeSingle();
      return data && data.indexing_status === 'indexed' ? data : null;
    }, 'candidat vivier indexé');

    vivierCandidateId = candidate.id as string;
    expect(candidate.title).toBe('Testeur Logiciel TREG');

    // Indexé au sens PRÉSÉLECTIONNABLE : l'embedding du titre existe.
    const { data: emb } = await db()
      .from('vivier_embeddings')
      .select('candidate_id, title_embedding')
      .eq('candidate_id', vivierCandidateId)
      .maybeSingle();
    expect(emb?.title_embedding).toBeTruthy();
  });

  it('recherche par mot-clé → le retrouve', async () => {
    const res = await callWithId(keywordSearch, camp, {
      method: 'POST',
      body: { query: 'tregskill' },
    });
    expect(res.status).toBe(200);
    const ids = (res.json.results as Array<{ candidateId: string }>).map((r) => r.candidateId);
    expect(ids).toContain(vivierCandidateId);
  });

  it('présélection sur l’intitulé de la fiche → identifié, persisté', async () => {
    const res = await callWithId(runPreselection, camp, { method: 'POST', body: {} });
    expect(res.status).toBe(200);
    expect(res.json.persisted).toBe(true);
    const entries = res.json.entries as Array<{ candidateId: string }>;
    expect(entries.map((e) => e.candidateId)).toContain(vivierCandidateId);

    const rows = await db()
      .from('vivier_preselections')
      .select('state')
      .eq('campaign_id', camp)
      .eq('candidate_id', vivierCandidateId);
    expect(rows.data?.[0]?.state).toBe('identified');
  });

  it('contact (invitation à candidater) → state contacted + mail mocké parti', async () => {
    const before = sentEmails.length;
    const res = await callWithId(decidePreselection, camp, {
      method: 'POST',
      body: { candidateIds: [vivierCandidateId], decision: 'accept' },
    });
    expect(res.status).toBe(200);
    expect(res.json.updated).toContain(vivierCandidateId);

    const rows = await db()
      .from('vivier_preselections')
      .select('state, contacted_at')
      .eq('campaign_id', camp)
      .eq('candidate_id', vivierCandidateId);
    expect(rows.data?.[0]?.state).toBe('contacted');
    expect(rows.data?.[0]?.contacted_at).toBeTruthy();

    const invitation = sentEmails.slice(before).find((m) => JSON.stringify(m.to).includes('fort@test.local'));
    expect(invitation).toBeTruthy();
    // L'invitation porte la référence campagne (clé du rapprochement retour).
    expect(`${invitation!.subject} ${invitation!.html}`).toContain(camp);
  });

  it('repêchage : il candidate → analyse marquée from_vivier=true, sortie du cycle', async () => {
    const taskId = `treg_s5_apply_${Date.now().toString(36)}`;
    const res = await call(analyzeCv, {
      method: 'POST',
      form: cvAnalyzerForm({
        profile: 'fort',
        campaignId: camp,
        sheet: testScoringSheet(camp),
        thresholdLow: 30,
        thresholdHigh: 75,
        taskId,
      }),
    });
    expect(res.status).toBe(200);

    // Le rapprochement (email exact + proposition contactée) tourne en after().
    const analysis = await until(async () => {
      const row = await readRow<{ from_vivier: boolean | null; vivier_candidate_id: string | null }>(
        'candidate_analyses',
        taskId,
      );
      return row.from_vivier ? row : null;
    }, 'analyse marquée from_vivier');
    expect(analysis.vivier_candidate_id).toBe(vivierCandidateId);

    // La candidature sort le candidat du cycle « contacté » (applied_at posé).
    const rows = await db()
      .from('vivier_preselections')
      .select('applied_at')
      .eq('campaign_id', camp)
      .eq('candidate_id', vivierCandidateId);
    expect(rows.data?.[0]?.applied_at).toBeTruthy();
  });
});
