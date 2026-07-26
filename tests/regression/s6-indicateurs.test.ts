/**
 * S6 — Indicateurs : les trois surfaces (Bureau / menu Candidatures / rapport
 * de campagne) racontent le MÊME scénario chiffré.
 *
 * Jeu connu : N=4 candidatures sur une campagne neuve — 1 auto-accept (fort),
 * 1 auto-reject (faible), 2 grises (moyen, mises en file). Les compteurs du
 * Bureau étant GLOBAUX (toutes campagnes de la base dev), ils sont assertés en
 * DELTA (avant/après) ; le ruban et le rapport, scopés campagne, en ABSOLU.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { PATCH as patchCampaign } from '@/app/api/campaigns/[id]/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { GET as getGlobalMetrics } from '@/app/api/metrics/global/route';
import { GET as getCampaignReport } from '@/app/api/reporting/campaigns/[id]/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { cvApplicationToMailCandidate, type MailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';

import { call, callWithId, cvAnalyzerForm, testCampaignPayload, testScoringSheet, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, newTestCampaignId } from './helpers/db';
import { resetSentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s6');

type Zones = {
  autoReject: number;
  autoAccept: number;
  humanValidated: number;
  pending: number;
  total: number;
};
type StageCounts = Record<string, number>;

let zonesBefore: Zones;
const grays: Array<{ taskId: string; validationId: string; candidate: MailCandidate }> = [];

async function zonesNow(): Promise<Zones> {
  const res = await call(getGlobalMetrics);
  expect(res.status).toBe(200);
  return res.json.zones as Zones;
}

async function countersNow(): Promise<{ counts: StageCounts; total: number }> {
  const res = await call(getCounters, { query: `campaignId=${camp}` });
  expect(res.status).toBe(200);
  return res.json as { counts: StageCounts; total: number };
}

async function inject(profile: 'fort' | 'faible' | 'moyen', slug: string): Promise<void> {
  const taskId = `treg_s6_${slug}_${Date.now().toString(36)}`;
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
  const application = res.json.application as CVApplication;

  if (application.scoringResult.decisionZone === 'gray') {
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
    grays.push({ taskId, validationId, candidate });
  }
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  zonesBefore = await zonesNow();
  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(res.status).toBe(200);

  await inject('fort', 'accept');
  await inject('faible', 'reject');
  await inject('moyen', 'gris1');
  await inject('moyen', 'gris2');
  expect(grays).toHaveLength(2);
});
afterAll(async () => {
  await cleanAll();
});

describe('S6 — cohérence des indicateurs', () => {
  it('ruban menu Candidatures (scopé campagne) : total 4, répartition 1/1/2', async () => {
    const { counts, total } = await countersNow();
    expect(total).toBe(4);
    expect(counts.invite).toBe(1); // auto-accept = invité
    expect(counts.refus_auto).toBe(1);
    expect(counts.a_valider).toBe(2);
    expect(counts.retenu).toBe(0);
    expect(counts.non_retenu).toBe(0);
  });

  it('Bureau (zones globales) : deltas exactement +1/+1/+2, total +4', async () => {
    const zones = await zonesNow();
    expect(zones.autoAccept - zonesBefore.autoAccept).toBe(1);
    expect(zones.autoReject - zonesBefore.autoReject).toBe(1);
    expect(zones.pending - zonesBefore.pending).toBe(2);
    expect(zones.humanValidated - zonesBefore.humanValidated).toBe(0);
    expect(zones.total - zonesBefore.total).toBe(4);
  });

  it('après une décision HITL (accepter un gris) → gris −1, accepté +1, partout', async () => {
    const gray = grays[0]!;
    // Chaîne client réelle : décision → réservation → mail relu → sent.
    const patched = await callWithId(patchValidation, gray.validationId, {
      method: 'PATCH',
      body: { decision: 'accept', confirmed: true },
    });
    expect(patched.status).toBe(200);
    const reserved = await callWithId(reserveSend, gray.validationId, { method: 'POST' });
    expect(reserved.json.reserved).toBe(true);
    const composed = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: `art_treg_${gray.taskId}`,
        campaignId: camp,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: gray.candidate,
        mail: { subject: '[TREG] Invitation', html: '<p>Invitation relue (test).</p>' },
        validationId: gray.validationId,
      },
    });
    expect(composed.json.status).toBe('sent');
    const sent = await callWithId(markSent, gray.validationId, {
      method: 'POST',
      body: { mailStatus: 'sent' },
    });
    expect(sent.status).toBe(200);

    const { counts, total } = await countersNow();
    expect(total).toBe(4); // le total ne bouge JAMAIS avec une décision
    expect(counts.a_valider).toBe(1); // gris −1
    expect(counts.invite).toBe(2); // accepté +1

    const zones = await zonesNow();
    expect(zones.pending - zonesBefore.pending).toBe(1);
    expect(zones.humanValidated - zonesBefore.humanValidated).toBe(1);
    expect(zones.autoAccept - zonesBefore.autoAccept).toBe(1);
    expect(zones.autoReject - zonesBefore.autoReject).toBe(1);
    expect(zones.total - zonesBefore.total).toBe(4);
  });

  it('clôture → le rapport de campagne raconte les MÊMES chiffres (rien perdu, rien déformé)', async () => {
    // Chiffres AVANT clôture (ruban) — la clôture ne doit rien changer.
    const before = await countersNow();

    const closed = await callWithId(patchCampaign, camp, {
      method: 'PATCH',
      body: { status: 'closed' },
    });
    expect(closed.status).toBe(200);

    const report = await callWithId(getCampaignReport, camp, { method: 'GET' });
    expect(report.status).toBe(200);
    const volumes = (report.json.data as {
      summary: {
        volumes: {
          received: number;
          retained: number;
          rejected: number;
          enAttente: number;
          decidedBySystem: number;
          decidedByHuman: number;
        };
      };
    }).summary.volumes;

    // Rapport en absolu : 4 reçues, 2 retenues (1 auto + 1 gris accepté),
    // 1 écartée (auto), 1 encore en attente, 2 décidées système, 1 humaine.
    expect(volumes.received).toBe(4);
    expect(volumes.retained).toBe(2);
    expect(volumes.rejected).toBe(1);
    expect(volumes.enAttente).toBe(1);
    expect(volumes.decidedBySystem).toBe(2);
    expect(volumes.decidedByHuman).toBe(1);

    // BONUS (décision DO) : chiffres AVANT clôture == rapport APRÈS clôture —
    // la clôture ne perd ni ne déforme aucun comptage.
    expect(volumes.received).toBe(before.total);
    expect(volumes.enAttente).toBe(before.counts.a_valider);
    expect(volumes.rejected).toBe(before.counts.refus_auto! + before.counts.non_retenu!);
    expect(volumes.retained).toBe(
      before.counts.invite! +
        before.counts.rdv_pris! +
        before.counts.entretien_fait! +
        before.counts.retenu!,
    );
  });
});
