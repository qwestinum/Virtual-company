/**
 * S9 — « Classée sans suite » : fin de vie propre des candidatures non
 * traitées.
 *
 * Parcours complet sur routes réelles :
 *   1. clôture de campagne avec candidatures en cours → récapitulatif, TOUTES
 *      classées, closed_at ENFIN posé, validation HITL voidée, compteurs
 *      corrects (ruban : sans_suite, partition qui somme) ;
 *   2. signal métier n°1 (validations en retard) ÉTEINT par le classement —
 *      par construction (void), sans logique de notification dédiée ;
 *   3. mail d'information : exactement UN par candidat — un REJEU de la
 *      clôture ne renvoie rien (claims deux-phases) et ne reclasse rien ;
 *   4. réouverture (erreur humaine) : la candidature reprend son étape,
 *      la validation redevient pending ;
 *   5. classement INDIVIDUEL (raison sans_reponse) → journal tracé ;
 *   6. flux GO « poste pourvu » : récap hasRetenu, classement en masse SANS
 *      clôturer, le recruté jamais classé ;
 *   7. gris en cours d'envoi (`sending`) : classement DIFFÉRÉ (409) — jamais
 *      sous incertitude d'envoi.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as closeCampaign } from '@/app/api/campaigns/[id]/close/route';
import {
  GET as getOpenRecap,
  POST as dismissOpenBatch,
} from '@/app/api/campaigns/[id]/open-candidatures/route';
import { POST as dismissOne } from '@/app/api/candidatures/[id]/dismiss/route';
import { POST as postJournal } from '@/app/api/journal/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { POST as markSent } from '@/app/api/validations/[id]/send/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as reopenOne } from '@/app/api/candidatures/[id]/reopen/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { GET as getBusinessSignals } from '@/app/api/notifications/business/route';
import { POST as postValidation } from '@/app/api/validations/route';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CVApplication } from '@/types/cv-analysis';
import type { BusinessSignal } from '@/types/notifications';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
  TEST_JOB_TITLE,
} from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRow, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s9');
const DAY = 86_400_000;

let invitedTaskId = '';
let grayTaskId = '';
let grayValidationId = '';
let overdueBefore = 0;

type StageCounts = Record<string, number>;

async function countersNow(): Promise<{ counts: StageCounts; total: number }> {
  const res = await call(getCounters, { query: `campaignId=${camp}` });
  expect(res.status).toBe(200);
  return res.json as { counts: StageCounts; total: number };
}

async function overdueCount(): Promise<number> {
  const res = await call(getBusinessSignals);
  expect(res.status).toBe(200);
  const signals = res.json.signals as BusinessSignal[];
  return signals.find((s) => s.key === 'pending_validations_overdue')?.count ?? 0;
}

function dismissalMails(): typeof sentEmails {
  return sentEmails.filter((m) => m.subject.startsWith('Votre candidature'));
}

async function analyze(
  profile: 'fort' | 'faible' | 'moyen',
  taskId: string,
  campaignId: string = camp,
): Promise<CVApplication> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile,
      campaignId,
      sheet: testScoringSheet(campaignId),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
  return res.json.application as CVApplication;
}

/** Met un gris en file HITL (validation pending) — parcours réel. */
async function enqueueGray(
  campaignId: string,
  taskId: string,
  app: CVApplication,
): Promise<string> {
  const validationId = `val_treg_${taskId}`;
  const res = await call(postValidation, {
    method: 'POST',
    body: {
      id: validationId,
      campaignId,
      candidateName: app.candidate.fullName,
      candidateEmail: app.candidate.email,
      score: app.scoringResult.totalScore,
      decision: 'reject',
      payload: {
        uid: taskId,
        candidate: cvApplicationToMailCandidate(app),
        jobTitle: TEST_JOB_TITLE,
      },
    },
  });
  expect(res.status).toBe(200);
  return validationId;
}

/**
 * Analyse un CV faible, le met en file (comme le gate), puis le REFUSE par la
 * chaîne humaine réelle : réservation → mail relu → finalisation. Produit une
 * candidature TERMINALE (`non_retenu`).
 */
async function refuseByHuman(taskId: string): Promise<void> {
  const app = await analyze('faible', taskId);
  const validationId = `val_treg_${taskId}`;
  const enqueue = await call(postValidation, {
    method: 'POST',
    body: {
      id: validationId,
      campaignId: camp,
      candidateName: app.candidate.fullName,
      candidateEmail: app.candidate.email,
      score: app.scoringResult.totalScore,
      decision: 'reject',
      payload: {
        uid: taskId,
        candidate: cvApplicationToMailCandidate(app),
        jobTitle: TEST_JOB_TITLE,
      },
    },
  });
  expect(enqueue.status).toBe(200);
  const reserved = await callWithId(reserveSend, validationId, { method: 'POST' });
  expect(reserved.json.reserved).toBe(true);
  const composed = await call(composeMail, {
    method: 'POST',
    body: {
      artifactId: `art_treg_${taskId}`,
      campaignId: camp,
      jobTitle: TEST_JOB_TITLE,
      mode: 'reject',
      candidate: cvApplicationToMailCandidate(app),
      // Objet volontairement distinct de « Votre candidature… » : les
      // assertions sur les mails de CLASSEMENT filtrent sur ce préfixe.
      mail: { subject: '[TREG] Refus relu', html: '<p>Refus relu (test).</p>' },
      validationId,
    },
  });
  expect(composed.json.status).toBe('sent');
  const sent = await callWithId(markSent, validationId, {
    method: 'POST',
    body: { mailStatus: 'sent' },
  });
  expect(sent.status).toBe(200);
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: camp, status: 'active' }),
  });
  expect(res.status).toBe(200);

  // Invité (fort, auto-accept) — candidature OUVERTE.
  invitedTaskId = `treg_s9_inv_${Date.now().toString(36)}`;
  await analyze('fort', invitedTaskId);
  // Refusé PAR UN HUMAIN (faible) — TERMINAL : ne doit JAMAIS être classé.
  // Depuis la conformité RGPD, la zone basse n'est plus terminale d'elle-même :
  // elle attend en file. Le terminal, c'est le refus TRANCHÉ. On le produit
  // donc par la chaîne réelle, sinon ce scénario testerait un cas qui n'existe
  // plus en production.
  await refuseByHuman(`treg_s9_rej_${Date.now().toString(36)}`);
  // Gris en file (moyen) — OUVERT, antidaté 5 jours (allume le signal 1).
  grayTaskId = `treg_s9_gray_${Date.now().toString(36)}`;
  const grayApp = await analyze('moyen', grayTaskId);
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
      payload: {
        uid: grayTaskId,
        candidate: cvApplicationToMailCandidate(grayApp),
        jobTitle: TEST_JOB_TITLE,
      },
    },
  });
  expect(enqueue.status).toBe(200);
  const { error } = await db()
    .from('pending_validations')
    .update({ created_at: new Date(Date.now() - 5 * DAY).toISOString() })
    .eq('id', grayValidationId);
  expect(error).toBeNull();
  overdueBefore = await overdueCount();
  expect(overdueBefore).toBeGreaterThanOrEqual(1);
});
afterAll(async () => {
  await cleanAll();
});

describe('S9 — classement sans suite', () => {
  it('récapitulatif : 2 candidatures en cours (invité + à valider), refus HUMAIN exclu', async () => {
    const res = await callWithId(getOpenRecap, camp, { method: 'GET' });
    expect(res.status).toBe(200);
    const recap = res.json as { counts: StageCounts; total: number; hasRetenu: boolean };
    expect(recap.total).toBe(2);
    expect(recap.counts.invite).toBe(1);
    expect(recap.counts.a_valider).toBe(1);
    expect(recap.hasRetenu).toBe(false);
  });

  it('clôture avec classement : closed_at posé, tout classé, compteurs et partition corrects', async () => {
    const res = await callWithId(closeCampaign, camp, {
      method: 'POST',
      body: { dismissOpen: true, reason: 'campagne_cloturee', sendMail: true },
    });
    expect(res.status).toBe(200);
    const summary = res.json.summary as {
      dismissed: number;
      deferredSending: number;
      mailsSent: number;
      mailsFailed: number;
    };
    expect(summary.dismissed).toBe(2);
    expect(summary.deferredSending).toBe(0);
    expect(summary.mailsSent).toBe(2);
    expect(summary.mailsFailed).toBe(0);

    // closed_at ENFIN posé (le PUT snapshot ne le faisait jamais).
    const row = await readRow<{ status: string; closed_at: string | null }>('campaigns', camp);
    expect(row.status).toBe('closed');
    expect(row.closed_at).not.toBeNull();

    // Validation HITL fermée par void — plus jamais « en attente ».
    const validation = await readRow<{ status: string }>('pending_validations', grayValidationId);
    expect(validation.status).toBe('void');

    // Ruban : la partition somme, le refus TRANCHÉ n'a PAS été touché.
    const { counts, total } = await countersNow();
    expect(total).toBe(3);
    expect(counts.sans_suite).toBe(2);
    expect(counts.non_retenu).toBe(1);
    expect(counts.refus_auto).toBe(0);
    expect(counts.a_valider).toBe(0);
    expect(counts.invite).toBe(0);

    // Les classées portent raison + acteur + horodatage (audit).
    const dismissed = await readRows<{
      dismissal_reason: string;
      dismissed_by: string;
      dismissed_at: string;
    }>('candidate_analyses', { campaign_id: camp, dismissal_reason: 'campagne_cloturee' });
    expect(dismissed).toHaveLength(2);
    for (const d of dismissed) {
      expect(d.dismissed_by).toBe('user');
      expect(d.dismissed_at).not.toBeNull();
    }
  });

  it('signal métier n°1 ÉTEINT par construction (void ⇒ hors du comptage pending)', async () => {
    expect(await overdueCount()).toBe(overdueBefore - 1);
  });

  it('mail d’information : UN par candidat, ton sans-refus, mention vivier', async () => {
    const mails = dismissalMails();
    expect(mails).toHaveLength(2);
    const recipients = mails.map((m) => m.to).sort();
    expect(recipients).toEqual(['fort@test.local', 'moyen@test.local']);
    for (const m of mails) {
      expect(m.html).toContain('clos');
      expect(m.html).toContain('vivier');
      expect(m.html.toLowerCase()).not.toContain('refus');
    }
  });

  it('REJEU de la clôture : rien n’est reclassé, AUCUN second mail (claims)', async () => {
    const res = await callWithId(closeCampaign, camp, {
      method: 'POST',
      body: { dismissOpen: true, reason: 'campagne_cloturee', sendMail: true },
    });
    expect(res.status).toBe(200);
    const summary = res.json.summary as { dismissed: number; mailsSent: number };
    // Les classées ont quitté les étapes ouvertes : plus rien à classer.
    expect(summary.dismissed).toBe(0);
    expect(dismissalMails()).toHaveLength(2); // exactly-once
  });

  it('réouverture (erreur) : étape restaurée, validation redevenue pending', async () => {
    const res = await callWithId(reopenOne, grayTaskId, { method: 'POST' });
    expect(res.status).toBe(200);

    const validation = await readRow<{ status: string }>('pending_validations', grayValidationId);
    expect(validation.status).toBe('pending');

    const { counts } = await countersNow();
    expect(counts.a_valider).toBe(1);
    expect(counts.sans_suite).toBe(1);
  });

  it('classement INDIVIDUEL (sans_reponse, sans mail) : reclassé + journal tracé', async () => {
    const res = await callWithId(dismissOne, grayTaskId, {
      method: 'POST',
      body: { reason: 'sans_reponse', sendMail: false },
    });
    expect(res.status).toBe(200);
    expect((res.json as { status: string }).status).toBe('dismissed');

    const { counts } = await countersNow();
    expect(counts.sans_suite).toBe(2);
    expect(counts.a_valider).toBe(0);
    // Aucun mail demandé ⇒ aucun mail parti.
    expect(dismissalMails()).toHaveLength(2);

    const entries = await readRows<{ action: string; payload: { reason?: string } }>(
      'journal',
      { campaign_id: camp, action: 'candidature_dismissed' },
    );
    // 2 à la clôture + 1 individuel (la réouverture est tracée à part).
    expect(entries.length).toBe(3);
    expect(entries.some((e) => e.payload.reason === 'sans_reponse')).toBe(true);
  });

  it('raison campagne_cloturee REFUSÉE sur la route individuelle (réservée aux flux campagne)', async () => {
    const res = await callWithId(dismissOne, invitedTaskId, {
      method: 'POST',
      body: { reason: 'campagne_cloturee', sendMail: false },
    });
    expect(res.status).toBe(400);
  });
});

describe('S9 — flux GO (poste pourvu) et gris en cours d’envoi', () => {
  it('GO : récap hasRetenu, classement en masse SANS clôturer la campagne', async () => {
    const campGo = newTestCampaignId('s9go');
    const created = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: campGo, status: 'active' }),
    });
    expect(created.status).toBe(200);

    // 1 recruté (GO posé) + 2 candidatures OUVERTES (invité + gris en file).
    const goTask = `treg_s9go_a_${Date.now().toString(36)}`;
    await analyze('fort', goTask, campGo);
    const marked = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_validation_marked',
        campaignId: campGo,
        actor: 'user',
        payload: { uid: goTask, candidate: 'Recruté Treg', status: 'validated' },
      },
    });
    expect(marked.status).toBe(204);
    await analyze('fort', `treg_s9go_b_${Date.now().toString(36)}`, campGo);
    const grayTask = `treg_s9go_c_${Date.now().toString(36)}`;
    await enqueueGray(campGo, grayTask, await analyze('moyen', grayTask, campGo));

    // Récap : le GO rend hasRetenu=true (pré-coche « poste pourvu » du dialog).
    const recap = await callWithId(getOpenRecap, campGo, { method: 'GET' });
    expect(recap.status).toBe(200);
    expect(recap.json.total).toBe(2);
    expect(recap.json.hasRetenu).toBe(true);

    // Classement en masse « poste pourvu » — flux GO : la campagne N'EST PAS clôturée.
    const batch = await callWithId(dismissOpenBatch, campGo, {
      method: 'POST',
      body: { reason: 'poste_pourvu', sendMail: false },
    });
    expect(batch.status).toBe(200);
    expect((batch.json.summary as { dismissed: number }).dismissed).toBe(2);

    const row = await readRow<{ status: string }>('campaigns', campGo);
    expect(row.status).toBe('active'); // le GO ne clôture pas

    const res = await call(getCounters, { query: `campaignId=${campGo}` });
    const { counts, total } = res.json as { counts: StageCounts; total: number };
    expect(total).toBe(3);
    expect(counts.retenu).toBe(1); // le recruté n'est JAMAIS classé
    expect(counts.sans_suite).toBe(2);

    const dismissed = await readRows<{ dismissal_reason: string }>(
      'candidate_analyses',
      { campaign_id: campGo, dismissal_reason: 'poste_pourvu' },
    );
    expect(dismissed).toHaveLength(2);
  });

  it('gris en cours d’ENVOI (sending) : classement DIFFÉRÉ — jamais sous incertitude', async () => {
    const campDef = newTestCampaignId('s9def');
    const created = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id: campDef, status: 'active' }),
    });
    expect(created.status).toBe(200);

    const grayTask = `treg_s9def_${Date.now().toString(36)}`;
    const validationId = await enqueueGray(
      campDef,
      grayTask,
      await analyze('moyen', grayTask, campDef),
    );

    // Réservation d'envoi réelle (pending → sending) — un mail part peut-être.
    const reserved = await callWithId(reserveSend, validationId, { method: 'POST' });
    expect(reserved.json.reserved).toBe(true);

    // Le classement individuel REFUSE (409) tant que l'envoi n'est pas résolu.
    const res = await callWithId(dismissOne, grayTask, {
      method: 'POST',
      body: { reason: 'sans_reponse', sendMail: false },
    });
    expect(res.status).toBe(409);
    expect(res.json.error).toBe('send_in_flight');

    // Rien n'a bougé : analyse non classée, validation toujours `sending`.
    const analysis = await readRow<{ dismissed_at: string | null }>(
      'candidate_analyses',
      grayTask,
    );
    expect(analysis.dismissed_at).toBeNull();
    const validation = await readRow<{ status: string }>(
      'pending_validations',
      validationId,
    );
    expect(validation.status).toBe('sending');
  });
});
