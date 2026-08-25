/**
 * S16 — « Corriger la décision » : une décision posée par erreur se répare en
 * POSANT l'état voulu, jamais en effaçant le passé.
 *
 * Parcours complet sur routes réelles :
 *   1. un entretien marqué « réalisé » par erreur → la GOMME (`cleared`) fait
 *      retomber l'étape sur ses colonnes, PARTOUT (ruban de compteurs) — c'est
 *      l'invariant central : l'étape n'est stockée nulle part, elle est dérivée ;
 *   2. le contexte servi au dialog dit la vérité sur les envois — « aucun
 *      message » pour un marquage, « un mail est parti » pour un refus tranché ;
 *   3. la correction n'envoie RIEN, quel que soit le nouvel état — y compris
 *      quand ce nouvel état correspondrait normalement à un envoi ;
 *   4. `decision_corrected` porte ancien/nouvel état, motif et AUTEUR (capté de
 *      la session serveur), et le marqueur d'origine reste au journal ;
 *   5. corriger deux fois de suite : dernier-gagne, sans état bâtard ;
 *   6. une cible qui n'est pas dans les options relues côté serveur est
 *      REFUSÉE (409) — le client ne décide pas de ce qui est corrigible.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

// Le setup global fige `getApiUser` à `null`. Ici on veut prouver que l'auteur
// de la correction vient de la SESSION SERVEUR : on rebranche l'export.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/require-api-user')
  >('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => authState.user };
});

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { GET as getCorrectionContext } from '@/app/api/candidatures/[id]/correction-context/route';
import { POST as correctDecision } from '@/app/api/candidatures/[id]/correct-decision/route';
import { POST as postJournal } from '@/app/api/journal/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';
import type { DecisionCorrectionContext } from '@/types/decision-correction';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
  TEST_JOB_TITLE,
} from './helpers/api';
import { cleanAll, newTestCampaignId, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s16');
const SARAH = { id: '00000000-0000-4000-8000-0000000016ab', email: 'sarah@treg.local' };

/** uid d'analyse = taskId ; l'id d'analyse en dérive (`can_<taskId>`). */
let invitedUid = '';
let invitedAnalysisId = '';
let refusedUid = '';
let refusedAnalysisId = '';

type StageCounts = Record<string, number>;

async function counters(): Promise<StageCounts> {
  const res = await call(getCounters, { query: `campaignId=${camp}` });
  expect(res.status).toBe(200);
  return (res.json as { counts: StageCounts }).counts;
}

async function analyze(
  profile: 'fort' | 'faible',
  taskId: string,
): Promise<CVApplication> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile,
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
  return res.json.application as CVApplication;
}

async function analysisIdFor(uid: string): Promise<string> {
  const rows = await readRows<{ id: string; uid: string }>('candidate_analyses', {
    uid,
  });
  expect(rows.length).toBe(1);
  return rows[0]!.id;
}

async function contextFor(analysisId: string): Promise<DecisionCorrectionContext> {
  const res = await callWithId(getCorrectionContext, analysisId);
  expect(res.status).toBe(200);
  return res.json as unknown as DecisionCorrectionContext;
}

async function correct(
  analysisId: string,
  target: string,
  reason?: string,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return callWithId(correctDecision, analysisId, {
    method: 'POST',
    body: { target, ...(reason ? { reason } : {}) },
  });
}

async function correctionEntries(uid: string) {
  const rows = await readRows<{
    action: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>('journal', { action: 'decision_corrected', campaign_id: camp });
  return rows
    .filter((r) => r.payload.uid === uid)
    .sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  authState.user = SARAH;

  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(created.status).toBe(200);

  // Candidature ACCEPTÉE (fort, auto-accept) → étape « Invité ».
  invitedUid = `treg_s16_inv_${Date.now().toString(36)}`;
  await analyze('fort', invitedUid);
  invitedAnalysisId = await analysisIdFor(invitedUid);

  // Candidature REFUSÉE par la chaîne humaine réelle (mail relu réellement
  // « envoyé » via le transport mocké) → étape « Non retenu », mail PARTI.
  refusedUid = `treg_s16_rej_${Date.now().toString(36)}`;
  const app = await analyze('faible', refusedUid);
  refusedAnalysisId = await analysisIdFor(refusedUid);
  const validationId = `val_treg_${refusedUid}`;
  const enqueued = await call(postValidation, {
    method: 'POST',
    body: {
      id: validationId,
      campaignId: camp,
      candidateName: app.candidate.fullName,
      candidateEmail: app.candidate.email,
      score: app.scoringResult.totalScore,
      decision: 'reject',
      payload: {
        uid: refusedUid,
        candidate: cvApplicationToMailCandidate(app),
        jobTitle: TEST_JOB_TITLE,
      },
    },
  });
  expect(enqueued.status).toBe(200);
  const reserved = await callWithId(reserveSend, validationId, { method: 'POST' });
  expect(reserved.json.reserved).toBe(true);
  const composed = await call(composeMail, {
    method: 'POST',
    body: {
      artifactId: `art_treg_${refusedUid}`,
      campaignId: camp,
      jobTitle: TEST_JOB_TITLE,
      mode: 'reject',
      candidate: cvApplicationToMailCandidate(app),
      mail: { subject: '[TREG] Refus relu S16', html: '<p>Refus relu.</p>' },
      validationId,
    },
  });
  expect(composed.json.status).toBe('sent');
  const finalized = await callWithId(markSent, validationId, {
    method: 'POST',
    body: { mailStatus: 'sent' },
  });
  expect(finalized.status).toBe(200);
}, 120_000);

afterAll(async () => {
  authState.user = null;
  await cleanAll();
});

describe('S16.1 — un marquage d’entretien posé par erreur', () => {
  it('le marquage « réalisé » déplace l’étape dans le ruban', async () => {
    const before = await counters();
    expect(before.invite).toBe(1);

    const marked = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_interview_marked',
        campaignId: camp,
        actor: 'user',
        payload: { uid: invitedUid, candidate: 'Test', status: 'realized' },
      },
    });
    expect(marked.status).toBe(204);

    const after = await counters();
    expect(after.entretien_fait).toBe(1);
    expect(after.invite).toBe(0);
  });

  it('l’identité de l’auteur est captée CÔTÉ SERVEUR sur le marquage normal', async () => {
    const rows = await readRows<{ payload: Record<string, unknown> }>('journal', {
      action: 'candidate_interview_marked',
      campaign_id: camp,
    });
    expect(rows.length).toBe(1);
    // Le client n'envoie que `actor: 'user'` : l'identité vient de la session.
    expect(rows[0]!.payload.actorEmail).toBe(SARAH.email);
    expect(rows[0]!.payload.actorUserId).toBe(SARAH.id);
  });

  it('le dialog dit qu’AUCUN message n’est parti pour cette décision', async () => {
    const ctx = await contextFor(invitedAnalysisId);
    expect(ctx.current).toEqual({ kind: 'interview', value: 'realized' });
    expect(ctx.sideEffects.length).toBeGreaterThan(0);
    expect(ctx.sideEffects.some((e) => e.code === 'mail_sent')).toBe(false);
    expect(ctx.sideEffects.some((e) => e.code === 'no_mail')).toBe(true);
    // La gomme est proposée : basculer vers « absent » poserait une décision.
    expect(ctx.options.map((o) => o.target)).toContain('interview_cleared');
  });

  it('la gomme fait retomber l’étape sur ses colonnes, dans le ruban', async () => {
    const mailsBefore = sentEmails.length;

    const res = await correct(
      invitedAnalysisId,
      'interview_cleared',
      'erreur de manipulation — mauvaise ligne',
    );
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('corrected');
    expect(res.json.previousStage).toBe('entretien_fait');
    expect(res.json.nextStage).toBe('invite');

    const after = await counters();
    expect(after.invite).toBe(1);
    expect(after.entretien_fait).toBe(0);

    // Invariant n°1 : rien n'est parti.
    expect(sentEmails.length).toBe(mailsBefore);
  });

  it('le marqueur d’origine RESTE au journal — ajout seul, jamais réécriture', async () => {
    const rows = await readRows<{ payload: Record<string, unknown> }>('journal', {
      action: 'candidate_interview_marked',
      campaign_id: camp,
    });
    const statuses = rows
      .filter((r) => r.payload.uid === invitedUid)
      .map((r) => r.payload.status);
    expect(statuses).toContain('realized');
    expect(statuses).toContain('cleared');
  });

  it('`decision_corrected` porte ancien/nouvel état, motif et auteur', async () => {
    const [entry] = await correctionEntries(invitedUid);
    expect(entry).toBeDefined();
    expect(entry!.payload).toMatchObject({
      uid: invitedUid,
      analysisId: invitedAnalysisId,
      previousStage: 'entretien_fait',
      nextStage: 'invite',
      previousLabel: 'Entretien réalisé',
      reason: 'erreur de manipulation — mauvaise ligne',
      by: SARAH.email,
    });
  });
});

describe('S16.2 — corriger un refus déjà envoyé', () => {
  it('le dialog AVERTIT qu’un mail de refus est parti', async () => {
    const ctx = await contextFor(refusedAnalysisId);
    expect(ctx.current).toEqual({
      kind: 'screening_decision',
      value: 'rejected',
      auto: false,
    });
    const mail = ctx.sideEffects.find((e) => e.code === 'mail_sent');
    expect(mail?.emphasis).toBe('warning');
    expect(mail?.text).toContain('refus');
    // Ce que la correction NE fait pas, dit avant de confirmer.
    expect(ctx.notices.join(' ')).toContain('Renvoyer une invitation');
  });

  it('requalifier en accepté ne réenvoie RIEN — même si l’état vaut « invité »', async () => {
    const mailsBefore = sentEmails.length;
    const res = await correct(refusedAnalysisId, 'screening_accepted');
    expect(res.status).toBe(200);
    expect(res.json.nextStage).toBe('invite');
    expect(sentEmails.length).toBe(mailsBefore);

    const after = await counters();
    // Les deux candidatures sont maintenant « Invité ».
    expect(after.invite).toBe(2);
    expect(after.non_retenu).toBe(0);
  });
});

describe('S16.3 — corriger deux fois, et refuser l’impossible', () => {
  it('dernier-gagne, sans état bâtard', async () => {
    const back = await correct(refusedAnalysisId, 'screening_rejected');
    expect(back.status).toBe(200);
    expect(back.json.nextStage).toBe('non_retenu');
    expect((await counters()).non_retenu).toBe(1);

    const again = await correct(refusedAnalysisId, 'screening_accepted');
    expect(again.status).toBe(200);
    expect(again.json.nextStage).toBe('invite');
    const after = await counters();
    expect(after.invite).toBe(2);
    expect(after.non_retenu).toBe(0);

    // Trois corrections tracées sur ce dossier, aucune n'en écrase une autre.
    expect((await correctionEntries(refusedUid)).length).toBe(3);
  });

  it('une cible hors des options relues côté serveur est REFUSÉE', async () => {
    // Le dossier est « Invité » (décision de screening) : un verdict final n'y
    // est pas corrigible — le client ne décide pas de ce qui est corrigible.
    const res = await correct(refusedAnalysisId, 'verdict_validated');
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('invalid_target');
  });

  it('la partition du ruban somme toujours au total', async () => {
    const res = await call(getCounters, { query: `campaignId=${camp}` });
    const body = res.json as { counts: StageCounts; total: number };
    const sum = Object.values(body.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(body.total);
    expect(body.total).toBe(2);
  });
});
