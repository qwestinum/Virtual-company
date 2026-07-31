/**
 * S12 — Trajectoires des quadrants campagne + frise candidat (HITL).
 *
 * 1. Filtres de TRAJECTOIRE de /api/candidatures (navigation quadrants) :
 *    - `everInvited`     : tous ceux PASSÉS par l'invitation (status accepted),
 *      y compris devenus « Retenu » — pas seulement le stade courant `invite` ;
 *    - `everInterviewed` : entretien marqué RÉALISÉ, y compris un « Retenu »
 *      (le chip d'étape `entretien_fait`, lui, garde le stade courant → 0).
 * 2. Frise (audit candidat) : un gris REFUSÉ par un humain via le flux HITL
 *    réel (decision → reserve-send → mail-composer → send) affiche
 *    « Refus envoyé — tranché en zone de validation » (l'ancien extracteur
 *    ignorait le reject HITL : frise muette après l'analyse).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET as listCandidatures } from '@/app/api/candidatures/route';
import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as postJournal } from '@/app/api/journal/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { GET as getAudit } from '@/app/api/reporting/audit/candidates/[id]/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { cvApplicationToMailCandidate, type MailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
  TEST_JOB_TITLE,
} from './helpers/api';
import { cleanAll, newTestCampaignId } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s12');
const LOW = 30;
const HIGH = 75;

const uidFort = `treg_s12_fort_${Date.now().toString(36)}`;
const uidMoyen = `treg_s12_moyen_${Date.now().toString(36)}`;
const uidFaible = `treg_s12_faible_${Date.now().toString(36)}`;

let grayCandidate: MailCandidate;
let grayValidationId: string;

type ListRow = { uid: string; stage: string };

async function listWith(query: string): Promise<{ rows: ListRow[]; total: number }> {
  const res = await call(listCandidatures, { query: `campaignId=${camp}&${query}` });
  expect(res.status).toBe(200);
  return res.json as unknown as { rows: ListRow[]; total: number };
}

async function analyze(profile: 'fort' | 'faible' | 'moyen', taskId: string): Promise<CVApplication> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile,
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: LOW,
      thresholdHigh: HIGH,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
  return res.json.application as CVApplication;
}

/** Marqueur de parcours — le geste UI passe par POST /api/journal. */
async function mark(action: string, uid: string, status: string): Promise<void> {
  const res = await call(postJournal, {
    method: 'POST',
    body: {
      action,
      campaignId: camp,
      payload: { uid, candidate: 'Victor Fort', status },
    },
  });
  // La route journal répond 204 (pas de corps).
  expect(res.status).toBeLessThan(300);
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  const created = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({
      id: camp,
      status: 'active',
      thresholdLow: LOW,
      thresholdHigh: HIGH,
    }),
  });
  expect(created.status).toBe(200);

  // Trois trajectoires : fort → accepté (invité), moyen → gris en file,
  // faible → refus auto.
  const fort = await analyze('fort', uidFort);
  expect(fort.scoringResult.status).toBe('accepted');
  const moyen = await analyze('moyen', uidMoyen);
  expect(moyen.scoringResult.decisionZone).toBe('gray');
  await analyze('faible', uidFaible);

  grayCandidate = cvApplicationToMailCandidate(moyen);
  grayValidationId = `val_treg_${uidMoyen}`;
  const enqueued = await call(postValidation, {
    method: 'POST',
    body: {
      id: grayValidationId,
      campaignId: camp,
      candidateName: moyen.candidate.fullName,
      candidateEmail: moyen.candidate.email,
      score: moyen.scoringResult.totalScore,
      decision: 'reject',
      payload: { uid: uidMoyen, candidate: grayCandidate, jobTitle: TEST_JOB_TITLE },
    },
  });
  expect(enqueued.status).toBe(200);
});
afterAll(async () => {
  await cleanAll();
});

describe('S12 — trajectoires quadrants + frise', () => {
  it('everInvited : seuls les passés par l’invitation (accepté), pas le gris ni le refus auto', async () => {
    const all = await listWith('');
    expect(all.total).toBe(3);

    const invited = await listWith('everInvited=true');
    expect(invited.rows.map((r) => r.uid)).toEqual([uidFort]);
  });

  it('retenu APRÈS entretien : les trajectoires le gardent, les chips de stade courant non', async () => {
    // Le DRH marque l'entretien réalisé PUIS la validation définitive (GO).
    await mark('candidate_interview_marked', uidFort, 'realized');
    await mark('candidate_validation_marked', uidFort, 'validated');

    // Stade courant = retenu → le chip « Entretien fait » ne le montre plus…
    const stageInterview = await listWith('stage=entretien_fait');
    expect(stageInterview.total).toBe(0);
    const stageRetenu = await listWith('stage=retenu');
    expect(stageRetenu.rows.map((r) => r.uid)).toEqual([uidFort]);

    // … mais les TRAJECTOIRES le ramènent (nuance quadrants).
    const interviewed = await listWith('everInterviewed=true');
    expect(interviewed.rows.map((r) => r.uid)).toEqual([uidFort]);
    expect(interviewed.rows[0].stage).toBe('retenu');

    const invited = await listWith('everInvited=true');
    expect(invited.rows.map((r) => r.uid)).toEqual([uidFort]);

    // Les deux trajectoires se combinent (ET logique) sans double compte.
    const both = await listWith('everInvited=true&everInterviewed=true');
    expect(both.total).toBe(1);
  });

  it('frise : un gris refusé par un humain (flux HITL réel) affiche « Refus envoyé — tranché en zone de validation »', async () => {
    // Décision → réservation → mail relu → envoi (chaîne cliente identique).
    const patched = await callWithId(patchValidation, grayValidationId, {
      method: 'PATCH',
      body: { decision: 'reject', confirmed: true },
    });
    expect(patched.status).toBe(200);
    const reserved = await callWithId(reserveSend, grayValidationId, { method: 'POST' });
    expect(reserved.status).toBe(200);
    const composed = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: `art_treg_${uidMoyen}`,
        campaignId: camp,
        jobTitle: TEST_JOB_TITLE,
        mode: 'reject',
        candidate: grayCandidate,
        mail: {
          subject: '[TREG] Réponse — relue par le DRH',
          html: '<p>Réponse relue avant envoi (S12).</p>',
        },
        validationId: grayValidationId,
      },
    });
    expect(composed.status).toBe(200);
    expect(composed.json.status).toBe('sent');
    const sent = await callWithId(markSent, grayValidationId, {
      method: 'POST',
      body: {
        providerMessageId: String(composed.json.providerMessageId ?? ''),
        mailStatus: String(composed.json.status),
      },
    });
    expect(sent.status).toBe(200);
    expect(sentEmails.length).toBeGreaterThan(0);

    // La frise du candidat porte le refus HITL (l'ancien extracteur
    // l'ignorait : frise muette après « Analyse et scoring »).
    const audit = await callWithId(getAudit, uidMoyen);
    expect(audit.status).toBe(200);
    const timeline = audit.json.timeline as { key: string; label: string; detail: string | null }[];
    const rejected = timeline.find((e) => e.key === 'rejected_mail');
    expect(rejected).toBeDefined();
    expect(rejected?.label).toBe('Refus envoyé');
    expect(rejected?.detail).toMatch(/tranché en zone de validation/i);
  });
});
