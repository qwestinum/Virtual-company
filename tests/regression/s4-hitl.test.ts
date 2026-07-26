/**
 * S4 — Parcours HITL : une candidature grise apparaît en file de validation,
 * l'humain tranche (accepter OU refuser), le mail (mocké) part par la même
 * mécanique que les chemins auto, l'état final est cohérent partout
 * (validation `sent`, analyse `decided_by='user'`, journal).
 *
 * La chaîne reproduit EXACTEMENT `decideGrayValidation` (client) :
 *   PATCH decision+confirmed → POST reserve-send → POST mail-composer
 *   (contenu édité + validationId) → [accept: POST scheduler] → POST send.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { POST as postScheduler } from '@/app/api/scheduler/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route';
import { GET as listValidations, POST as postValidation } from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { cvApplicationToMailCandidate, type MailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

import { call, callWithId, cvAnalyzerForm, testCampaignPayload, testScoringSheet, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, newTestCampaignId, readRow, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s4');

let savedInterviewConfig: Record<string, unknown> | null = null;

/** Analyse un CV moyen + le met en file (état de départ du parcours HITL). */
async function seedGrayValidation(slug: string): Promise<{
  taskId: string;
  validationId: string;
  candidate: MailCandidate;
}> {
  const taskId = `treg_s4_${slug}_${Date.now().toString(36)}`;
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile: 'moyen',
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
  const application = res.json.application as CVApplication;
  expect(application.scoringResult.decisionZone).toBe('gray');

  const candidate = cvApplicationToMailCandidate(application);
  const validationId = `val_treg_${taskId}`;
  const enqueue = await call(postValidation, {
    method: 'POST',
    body: {
      id: validationId,
      campaignId: camp,
      candidateName: application.candidate.fullName,
      candidateEmail: application.candidate.email,
      score: application.scoringResult.totalScore,
      decision: 'reject',
      payload: { uid: taskId, candidate, jobTitle: TEST_JOB_TITLE },
    },
  });
  expect(enqueue.status).toBe(200);
  return { taskId, validationId, candidate };
}

/** Chaîne d'envoi post-décision — identique au client (sendValidation). */
async function decideAndSend(args: {
  validationId: string;
  taskId: string;
  candidate: MailCandidate;
  decision: 'accept' | 'reject';
}): Promise<void> {
  const patched = await callWithId(patchValidation, args.validationId, {
    method: 'PATCH',
    body: { decision: args.decision, confirmed: true },
  });
  expect(patched.status).toBe(200);

  const reserved = await callWithId(reserveSend, args.validationId, { method: 'POST' });
  expect(reserved.status).toBe(200);
  expect(reserved.json.reserved).toBe(true);

  const composed = await call(composeMail, {
    method: 'POST',
    body: {
      artifactId: `art_treg_${args.taskId}`,
      campaignId: camp,
      jobTitle: TEST_JOB_TITLE,
      mode: args.decision === 'accept' ? 'invite' : 'reject',
      candidate: args.candidate,
      mail: {
        subject: `[TREG] ${args.decision === 'accept' ? 'Invitation' : 'Réponse'} — relue par le DRH`,
        html: '<p>Contenu édité et relu avant envoi (test de régression).</p>',
      },
      validationId: args.validationId,
    },
  });
  expect(composed.status).toBe(200);
  expect(composed.json.status).toBe('sent');

  if (args.decision === 'accept') {
    const scheduled = await call(postScheduler, {
      method: 'POST',
      body: {
        campaignId: camp,
        jobTitle: TEST_JOB_TITLE,
        candidate: args.candidate,
        uid: args.taskId,
      },
    });
    expect(scheduled.status).toBe(200);
  }

  const sent = await callWithId(markSent, args.validationId, {
    method: 'POST',
    body: {
      providerMessageId: String(composed.json.providerMessageId ?? ''),
      mailStatus: String(composed.json.status),
    },
  });
  expect(sent.status).toBe(200);
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();

  // Lien d'agenda requis pour un envoi d'invitation — on le pose via l'API
  // Settings (snapshot restauré en afterAll : app_settings est GLOBAL).
  const settings = await call(getSettings);
  savedInterviewConfig =
    (settings.json.settings as { interviewConfig?: Record<string, unknown> })
      ?.interviewConfig ?? null;
  if (savedInterviewConfig) {
    const put = await call(putSettings, {
      method: 'PUT',
      body: {
        interviewConfig: {
          ...savedInterviewConfig,
          agendaLink: 'https://agenda.test.local/treg',
        },
      },
    });
    expect(put.status).toBe(200);
  }

  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  if (savedInterviewConfig) {
    await call(putSettings, {
      method: 'PUT',
      body: { interviewConfig: savedInterviewConfig },
    });
  }
  await cleanAll();
});

describe('S4 — parcours HITL', () => {
  it('candidature grise → visible dans la liste de validation', async () => {
    const { validationId } = await seedGrayValidation('liste');
    const list = await call(listValidations);
    expect(list.status).toBe(200);
    const ids = (list.json.validations as Array<{ id: string }>).map((v) => v.id);
    expect(ids).toContain(validationId);
  });

  it('décision ACCEPTER → validation sent, analyse acceptée par un humain, mail mocké parti', async () => {
    const seeded = await seedGrayValidation('accept');
    const before = sentEmails.length;

    await decideAndSend({ ...seeded, decision: 'accept' });

    // Validation terminale + décision immuable.
    const validation = await readRow<{ status: string; decision: string; decided_by: string | null }>(
      'pending_validations',
      seeded.validationId,
    );
    expect(validation.status).toBe('sent');
    expect(validation.decision).toBe('accept');
    expect(validation.decided_by).toBe('user');

    // La décision humaine est propagée à l'analyse (source des indicateurs).
    const analysis = await readRow<{ status: string; decided_by: string; decision_zone: string }>(
      'candidate_analyses',
      seeded.taskId,
    );
    expect(analysis.status).toBe('accepted');
    expect(analysis.decided_by).toBe('user');
    expect(analysis.decision_zone).toBe('gray'); // immuable : ça A ÉTÉ gris

    // Mail (mocké) réellement généré, vers le bon destinataire.
    expect(sentEmails.length).toBeGreaterThan(before);
    const toCandidate = sentEmails
      .slice(before)
      .some((m) => JSON.stringify(m.to).includes('moyen@test.local'));
    expect(toCandidate).toBe(true);

    // Journal honnête : l'envoi HITL est tracé (rattaché par uid d'analyse)
    // avec le statut mail réel.
    const journal = await readRows<{ payload: { uid?: string | null; mailStatus?: string } }>(
      'journal',
      { campaign_id: camp, action: 'hitl_validation_sent' },
    );
    const entry = journal.find((j) => j.payload.uid === seeded.taskId);
    expect(entry?.payload.mailStatus).toBe('sent');
  });

  it('décision REFUSER → statut cohérent, candidature marquée refusée par un humain', async () => {
    const seeded = await seedGrayValidation('reject');

    await decideAndSend({ ...seeded, decision: 'reject' });

    const validation = await readRow<{ status: string; decision: string }>(
      'pending_validations',
      seeded.validationId,
    );
    expect(validation.status).toBe('sent');
    expect(validation.decision).toBe('reject');

    const analysis = await readRow<{ status: string; decided_by: string; decision_zone: string }>(
      'candidate_analyses',
      seeded.taskId,
    );
    expect(analysis.status).toBe('rejected');
    expect(analysis.decided_by).toBe('user');
    expect(analysis.decision_zone).toBe('gray');
  });

  it('décision verrouillée dès la réservation (jamais « invitation + refus »)', async () => {
    const seeded = await seedGrayValidation('locked');

    const patched = await callWithId(patchValidation, seeded.validationId, {
      method: 'PATCH',
      body: { decision: 'accept', confirmed: true },
    });
    expect(patched.status).toBe(200);
    const reserved = await callWithId(reserveSend, seeded.validationId, { method: 'POST' });
    expect(reserved.json.reserved).toBe(true);

    // Toute re-décision après réservation est REFUSÉE.
    const relocked = await callWithId(patchValidation, seeded.validationId, {
      method: 'PATCH',
      body: { decision: 'reject', confirmed: true },
    });
    expect(relocked.status).toBe(409);
    expect(relocked.json.error).toBe('decision_locked');
  });
});
