/**
 * S8 — Notifications métier (/api/notifications/business) : les deux signaux
 * v1 apparaissent quand l'action humaine tarde, et S'ÉTEIGNENT dès que
 * l'action est faite — LE comportement qui fait leur crédibilité.
 *
 * Vieillissement : les seuils portent sur des dates réelles (created_at de la
 * file, created_at du marqueur journal) — le test ANTIDATE ces lignes en base
 * après les avoir créées par l'API réelle (manipulation du temps du seed,
 * jamais de logique métier contournée).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as postJournal } from '@/app/api/journal/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { GET as getBusinessSignals } from '@/app/api/notifications/business/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { cvApplicationToMailCandidate, type MailCandidate } from '@/types/mail-candidate';
import type { BusinessSignal } from '@/types/notifications';
import type { CVApplication } from '@/types/cv-analysis';

import { call, callWithId, cvAnalyzerForm, testCampaignPayload, testScoringSheet, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, db, newTestCampaignId } from './helpers/db';
import { resetSentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s8');
const DAY = 86_400_000;

let grayTaskId = '';
let grayValidationId = '';
let grayCandidate: MailCandidate;
let interviewTaskId = '';

async function signalsNow(): Promise<BusinessSignal[]> {
  const res = await call(getBusinessSignals);
  expect(res.status).toBe(200);
  return res.json.signals as BusinessSignal[];
}

function ofKey(signals: BusinessSignal[], key: BusinessSignal['key']) {
  return signals.find((s) => s.key === key) ?? null;
}

async function analyze(profile: 'fort' | 'moyen', taskId: string): Promise<CVApplication> {
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

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(res.status).toBe(200);

  // ── Cas signal 1 : gris mis en file… il y a 5 jours (antidaté). ──
  grayTaskId = `treg_s8_gray_${Date.now().toString(36)}`;
  const grayApp = await analyze('moyen', grayTaskId);
  expect(grayApp.scoringResult.decisionZone).toBe('gray');
  grayCandidate = cvApplicationToMailCandidate(grayApp);
  grayValidationId = `val_treg_${grayTaskId}`;
  const enqueue = await call(postValidation, {
    method: 'POST',
    body: {
      id: grayValidationId,
      campaignId: camp,
      candidateName: grayApp.candidate.fullName,
      candidateEmail: grayApp.candidate.email,
      score: grayApp.scoringResult.totalScore,
      decision: 'reject',
      payload: { uid: grayTaskId, candidate: grayCandidate, jobTitle: TEST_JOB_TITLE },
    },
  });
  expect(enqueue.status).toBe(200);
  await db()
    .from('pending_validations')
    .update({ created_at: new Date(Date.now() - 5 * DAY).toISOString() })
    .eq('id', grayValidationId);

  // ── Cas signal 2 : accepté + « entretien réalisé »… il y a 4 jours. ──
  interviewTaskId = `treg_s8_itw_${Date.now().toString(36)}`;
  const strongApp = await analyze('fort', interviewTaskId);
  expect(strongApp.scoringResult.decisionZone).toBe('auto_accept');
  const marked = await call(postJournal, {
    method: 'POST',
    body: {
      action: 'candidate_interview_marked',
      campaignId: camp,
      actor: 'user',
      payload: {
        uid: interviewTaskId,
        candidate: strongApp.candidate.fullName,
        status: 'realized',
      },
    },
  });
  expect(marked.status).toBe(204);
  await db()
    .from('journal')
    .update({ created_at: new Date(Date.now() - 4 * DAY).toISOString() })
    .eq('action', 'candidate_interview_marked')
    .contains('payload', { uid: interviewTaskId });
});
afterAll(async () => {
  await cleanAll();
});

describe('S8 — notifications métier', () => {
  it('les deux signaux sont actifs, avec compte et ancienneté corrects', async () => {
    const signals = await signalsNow();

    const overdue = ofKey(signals, 'pending_validations_overdue');
    expect(overdue).not.toBeNull();
    expect(overdue!.count).toBeGreaterThanOrEqual(1);
    expect(overdue!.oldestDays).toBeGreaterThanOrEqual(5);
    // Accord SINGULIER/PLURIEL selon le compte (« 1 candidat attend… » /
    // « N candidats attendent… ») — l'assertion ne doit pas figer l'accord,
    // le compte réel dépend de l'état de la base dev au moment du run.
    expect(overdue!.message).toMatch(/attend(ent)? votre validation depuis plus de/);
    expect(overdue!.target).toEqual({ tab: 'validations' });

    const interviews = ofKey(signals, 'interviews_awaiting_decision');
    expect(interviews).not.toBeNull();
    expect(interviews!.count).toBeGreaterThanOrEqual(1);
    expect(interviews!.oldestDays).toBeGreaterThanOrEqual(4);
    expect(interviews!.target).toEqual({ tab: 'candidatures', stage: 'entretien_fait' });
  });

  it('EXTINCTION signal 2 : la décision finale posée → le signal décrémente au re-fetch', async () => {
    const before = ofKey(await signalsNow(), 'interviews_awaiting_decision');
    expect(before).not.toBeNull();

    // Le DRH clique « Validation définitive » (même route que l'UI).
    const decided = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_validation_marked',
        campaignId: camp,
        actor: 'user',
        payload: { uid: interviewTaskId, candidate: 'Victor Fort', status: 'validated' },
      },
    });
    expect(decided.status).toBe(204);

    // Par construction (deriveCandidateStage), le candidat passe « retenu »
    // et SORT du signal — sans aucune logique de notification dédiée.
    const after = ofKey(await signalsNow(), 'interviews_awaiting_decision');
    const beforeCount = before!.count;
    if (beforeCount === 1) {
      expect(after).toBeNull(); // plus aucun cas → signal éteint, rien affiché
    } else {
      expect(after!.count).toBe(beforeCount - 1);
    }
  });

  it('EXTINCTION signal 1 : la validation tranchée et envoyée → le signal décrémente', async () => {
    const before = ofKey(await signalsNow(), 'pending_validations_overdue');
    expect(before).not.toBeNull();

    // Chaîne HITL réelle (décision → réservation → mail relu → sent).
    const patched = await callWithId(patchValidation, grayValidationId, {
      method: 'PATCH',
      body: { decision: 'reject', confirmed: true },
    });
    expect(patched.status).toBe(200);
    const reserved = await callWithId(reserveSend, grayValidationId, { method: 'POST' });
    expect(reserved.json.reserved).toBe(true);
    const composed = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: `art_treg_${grayTaskId}`,
        campaignId: camp,
        jobTitle: TEST_JOB_TITLE,
        mode: 'reject',
        candidate: grayCandidate,
        mail: { subject: '[TREG] Réponse', html: '<p>Réponse relue (test).</p>' },
        validationId: grayValidationId,
      },
    });
    expect(composed.json.status).toBe('sent');
    const sent = await callWithId(markSent, grayValidationId, {
      method: 'POST',
      body: { mailStatus: 'sent' },
    });
    expect(sent.status).toBe(200);

    const after = ofKey(await signalsNow(), 'pending_validations_overdue');
    const beforeCount = before!.count;
    if (beforeCount === 1) {
      expect(after).toBeNull();
    } else {
      expect(after!.count).toBe(beforeCount - 1);
    }
  });
});
