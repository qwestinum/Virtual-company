/**
 * S25 — Compte rendu d'entretien et commentaire du recruteur.
 * Spec : docs/specs/compte-rendu-entretien.md (arbitrages §14).
 *
 * LOT 2 — le verdict MOTIVÉ, sur routes réelles :
 *   1. un verdict ne se pose QU'EN attente de verdict (409 ailleurs) ;
 *   2. le commentaire est FACULTATIF (arbitrage du 19/09/2026) : sans lui, le
 *      verdict se pose, aucune ligne de commentaire n'est écrite, et le marqueur
 *      n'en désigne aucune ;
 *   3. `/api/journal` refuse le marqueur de verdict (409) — la règle n'est pas
 *      une convention d'écran ;
 *   4. verdict motivé : le commentaire est au dossier avec son auteur (session
 *      serveur), le marqueur porte son IDENTIFIANT et jamais son texte ;
 *   5. un second verdict sur un dossier décidé : 409 ;
 *   6. RÉTRO-COMPATIBILITÉ : un dossier décidé AVANT la règle (marqueur sans
 *      commentaire) n'est jamais bloqué — « Corriger la décision » reste
 *      possible, sans commentaire, et le dialog dit honnêtement qu'aucun
 *      commentaire n'avait été enregistré ;
 *   7. le dialog de correction d'un dossier MOTIVÉ montre le commentaire et
 *      son auteur ; la frise du dossier le porte.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

// Le setup global fige `getApiUser` à `null` : on rebranche l'export pour
// prouver que l'AUTEUR du commentaire vient de la session serveur.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/require-api-user')>(
    '@/lib/auth/require-api-user',
  );
  return { ...actual, getApiUser: async () => authState.user };
});

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getCorrectionContext } from '@/app/api/candidatures/[id]/correction-context/route';
import { POST as correctDecision } from '@/app/api/candidatures/[id]/correct-decision/route';
import { POST as postJournal } from '@/app/api/journal/route';
import { GET as getAudit } from '@/app/api/reporting/audit/candidates/[id]/route';
import type { DecisionCorrectionContext } from '@/types/decision-correction';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
} from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';
import { analysisIdOf, postVerdict, REGRESSION_VERDICT_COMMENT } from './helpers/verdict';

const camp = newTestCampaignId('s25');
const SARAH = { id: '00000000-0000-4000-8000-0000000025ab', email: 'sarah@treg.local' };
const motivatedUid = `treg_s25_motive_${Date.now().toString(36)}`;
const legacyUid = `treg_s25_legacy_${Date.now().toString(36)}`;
const bareUid = `treg_s25_sans_${Date.now().toString(36)}`;

async function analyze(taskId: string): Promise<void> {
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
}

async function markInterview(uid: string): Promise<void> {
  const res = await call(postJournal, {
    method: 'POST',
    body: {
      action: 'candidate_interview_marked',
      campaignId: camp,
      actor: 'user',
      payload: { uid, candidate: 'Victor Fort', status: 'realized' },
    },
  });
  expect(res.status).toBe(204);
}

async function verdictMarkers(uid: string) {
  const rows = await readRows<{ payload: Record<string, unknown> }>('journal', {
    action: 'candidate_validation_marked',
    campaign_id: camp,
  });
  return rows.filter((r) => r.payload.uid === uid);
}

async function contextFor(uid: string): Promise<DecisionCorrectionContext> {
  const res = await callWithId(getCorrectionContext, await analysisIdOf(uid));
  expect(res.status).toBe(200);
  return res.json as unknown as DecisionCorrectionContext;
}

beforeAll(async () => {
  await cleanAll();
  authState.user = SARAH;
  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(created.status).toBe(200);
  await analyze(motivatedUid);
  await analyze(legacyUid);
  await analyze(bareUid);
});

afterAll(async () => {
  authState.user = null;
  await cleanAll();
});

describe('S25.1 — un verdict ne se pose qu’en attente de verdict', () => {
  it('candidature seulement invitée : 409, rien écrit', async () => {
    const res = await postVerdict(motivatedUid, 'validated');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('not_awaiting_verdict');
    expect(await verdictMarkers(motivatedUid)).toHaveLength(0);
  });
});

describe('S25.2 — le commentaire est facultatif', () => {
  beforeAll(async () => {
    await markInterview(motivatedUid);
    await markInterview(bareUid);
  });

  it('verdict SANS commentaire : 200, aucune ligne de commentaire, marqueur sans commentId', async () => {
    const res = await postVerdict(bareUid, 'rejected', '');
    expect(res.status).toBe(200);
    expect(res.json.commentId).toBeNull();
    expect(
      await readRows('verdict_comments', { analysis_id: await analysisIdOf(bareUid) }),
    ).toHaveLength(0);
    const markers = await verdictMarkers(bareUid);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.payload).not.toHaveProperty('commentId');
  });

  it('le dossier le dit honnêtement : aucun commentaire', async () => {
    const ctx = await contextFor(bareUid);
    expect(ctx.verdictComment).toBeNull();
  });
});

describe('S25.3 — le journal générique refuse le verdict', () => {
  it('candidate_validation_marked par /api/journal : 409, rien écrit', async () => {
    const res = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_validation_marked',
        campaignId: camp,
        actor: 'user',
        payload: { uid: motivatedUid, candidate: 'Victor Fort', status: 'validated' },
      },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('use_verdict_route');
    expect(await verdictMarkers(motivatedUid)).toHaveLength(0);
  });
});

describe('S25.4 — verdict motivé', () => {
  it('200 : commentaire au dossier, auteur de la SESSION, marqueur qui le désigne', async () => {
    const res = await postVerdict(motivatedUid, 'validated');
    expect(res.status).toBe(200);
    const commentId = res.json.commentId as string;

    const [row] = await readRows<{
      id: string;
      body: string;
      verdict: string;
      author_user_id: string | null;
      author_email: string | null;
    }>('verdict_comments', { analysis_id: await analysisIdOf(motivatedUid) });
    expect(row).toMatchObject({
      id: commentId,
      body: REGRESSION_VERDICT_COMMENT,
      verdict: 'validated',
      author_user_id: SARAH.id,
      author_email: SARAH.email,
    });

    const markers = await verdictMarkers(motivatedUid);
    expect(markers).toHaveLength(1);
    expect(markers[0]!.payload).toMatchObject({ status: 'validated', commentId, actorEmail: SARAH.email });
  });

  it('le TEXTE du commentaire n’est nulle part dans le journal de la campagne', async () => {
    const all = await readRows<{ payload: Record<string, unknown> }>('journal', { campaign_id: camp });
    expect(JSON.stringify(all)).not.toContain('attentes du poste confirmées');
  });

  it('un commentaire ne se réécrit pas (ajout seul, tenu par la base)', async () => {
    const { error } = await db()
      .from('verdict_comments')
      .update({ body: 'réécrit après coup' })
      .eq('analysis_id', await analysisIdOf(motivatedUid));
    expect(error).not.toBeNull();
  });
});

describe('S25.5 — un dossier décidé n’attend plus de verdict', () => {
  it('second verdict : 409', async () => {
    const res = await postVerdict(motivatedUid, 'rejected');
    expect(res.status).toBe(409);
    expect(res.json.stage).toBe('retenu');
  });
});

describe('S25.6 — rétro-compatibilité : l’historique n’est jamais bloqué', () => {
  beforeAll(async () => {
    // Un verdict posé AVANT la règle : le marqueur d'époque, sans commentaire,
    // écrit en direct (plus aucune route ne sait le poser ainsi).
    await markInterview(legacyUid);
    const { error } = await db().from('journal').insert({
      action: 'candidate_validation_marked',
      campaign_id: camp,
      actor: 'user',
      payload: { uid: legacyUid, candidate: 'Victor Fort', status: 'validated' },
    });
    expect(error).toBeNull();
  });

  it('le dialog dit qu’aucun commentaire n’avait été enregistré — sans rien inventer', async () => {
    const ctx = await contextFor(legacyUid);
    expect(ctx.current).toEqual({ kind: 'final_verdict', value: 'validated' });
    expect(ctx.verdictComment).toBeNull();
    expect(ctx.decidedBy).toBeNull();
  });

  it('« Corriger la décision » reste possible, SANS commentaire', async () => {
    const res = await callWithId(correctDecision, await analysisIdOf(legacyUid), {
      method: 'POST',
      body: { target: 'verdict_rejected' },
    });
    expect(res.status).toBe(200);
    expect(res.json.nextStage).toBe('non_retenu');
  });
});

describe('S25.7 — le dossier raconte la décision', () => {
  it('le dialog de correction montre le commentaire et son auteur', async () => {
    const ctx = await contextFor(motivatedUid);
    expect(ctx.verdictComment).toMatchObject({
      body: REGRESSION_VERDICT_COMMENT,
      authorEmail: SARAH.email,
      writtenFor: 'validated',
      matchesCurrent: true,
    });
    expect(ctx.decidedBy).toBe(SARAH.email);
  });

  it('la frise porte le commentaire sur « Retenu définitivement »', async () => {
    const res = await callWithId(getAudit, await analysisIdOf(motivatedUid));
    expect(res.status).toBe(200);
    const timeline = res.json.timeline as { key: string; detail: string | null }[];
    const final = timeline.find((e) => e.key === 'final_validated');
    expect(final?.detail).toBe(`« ${REGRESSION_VERDICT_COMMENT} » — ${SARAH.email}`);
  });
});
