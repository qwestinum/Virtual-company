/**
 * S6 — Indicateurs : les trois surfaces (Bureau / menu Candidatures / rapport
 * de campagne) racontent le MÊME scénario chiffré.
 *
 * Jeu connu : N=4 candidatures sur une campagne neuve — 1 auto-accept (fort),
 * 1 PROPOSÉE au refus (faible) et 2 grises (moyen), toutes trois mises en file.
 * Depuis la conformité RGPD, la zone basse n'envoie plus : elle attend un
 * humain, exactement comme un gris — d'où 3 candidatures « à valider » et
 * AUCUN refus automatique dans ce scénario. Les compteurs du Bureau étant
 * GLOBAUX (toutes campagnes de la base dev), ils sont assertés en DELTA
 * (avant/après) ; le ruban et le rapport, scopés campagne, en ABSOLU.
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
import {
  cleanAll,
  db,
  newTestCampaignId,
  TEST_CAMPAIGN_PREFIX,
} from './helpers/db';
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
let foreignBefore = 0;
const grays: Array<{ taskId: string; validationId: string; candidate: MailCandidate }> = [];

async function zonesNow(): Promise<Zones> {
  const res = await call(getGlobalMetrics);
  expect(res.status).toBe(200);
  return res.json.zones as Zones;
}

/**
 * Nombre de validations OUVERTES hors campagnes de test.
 *
 * Les deltas de zones portent sur des compteurs GLOBAUX : ils supposent que
 * rien d'autre n'écrit pendant le scénario. Sur l'environnement de dev, cette
 * hypothèse tombe dès qu'un serveur `next dev` tourne (relève IMAP toutes les
 * 30 s) ou qu'un navigateur est ouvert sur l'application — un seul clic
 * « valider un gris » déplace le compteur et décale tous les deltas de 1.
 *
 * On mesure donc ce qui est HORS du scénario, avant et après : si ça a bougé,
 * l'échec dit la vraie cause au lieu d'un « expected 1 to be 2 » indéchiffrable.
 */
async function foreignOpenValidations(): Promise<number> {
  const { count } = await db()
    .from('pending_validations')
    .select('*', { count: 'exact', head: true })
    .in('status', ['pending', 'sending'])
    .not('campaign_id', 'like', `${TEST_CAMPAIGN_PREFIX}%`);
  return count ?? 0;
}

/** Échoue AVEC la cause quand des données hors scénario ont bougé. */
async function assertNoForeignDrift(): Promise<void> {
  const now = await foreignOpenValidations();
  if (now === foreignBefore) return;
  throw new Error(
    `Des validations HORS scénario ont changé pendant le test ` +
      `(${foreignBefore} → ${now}). Les compteurs du Bureau sont GLOBAUX : ` +
      `ferme l'application (serveur \`next dev\` et onglets ouverts sur la ` +
      `base de dev) avant de lancer la suite, sinon un clic ou une relève ` +
      `IMAP décale les deltas.`,
  );
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

  // Mise en file pour TOUTE zone qui attend un humain (gris ET proposé au
  // refus) — c'est ce que fait `gateCandidateOutreach` en production.
  const zone = application.scoringResult.decisionZone;
  if (zone === 'gray' || zone === 'proposed_reject') {
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
    // `grays` sert au test de décision HITL : on n'y met que les VRAIS gris.
    if (zone === 'gray') grays.push({ taskId, validationId, candidate });
  }
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  zonesBefore = await zonesNow();
  foreignBefore = await foreignOpenValidations();
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
  it('ruban menu Candidatures (scopé campagne) : total 4, répartition 1/3', async () => {
    const { counts, total } = await countersNow();
    expect(total).toBe(4);
    expect(counts.invite).toBe(1); // auto-accept = invité
    // Plus AUCUN refus automatique : le faible attend un humain comme les gris.
    expect(counts.refus_auto).toBe(0);
    expect(counts.a_valider).toBe(3);
    expect(counts.retenu).toBe(0);
    expect(counts.non_retenu).toBe(0);
  });

  it('Bureau (zones globales) : deltas +1 accepté / +3 en attente, total +4', async () => {
    await assertNoForeignDrift();
    const zones = await zonesNow();
    expect(zones.autoAccept - zonesBefore.autoAccept).toBe(1);
    // Aucun refus automatique produit — le Bureau et le ruban disent pareil.
    expect(zones.autoReject - zonesBefore.autoReject).toBe(0);
    expect(zones.pending - zonesBefore.pending).toBe(3);
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
    expect(counts.a_valider).toBe(2); // en attente −1
    expect(counts.invite).toBe(2); // accepté +1

    await assertNoForeignDrift();
    const zones = await zonesNow();
    expect(zones.pending - zonesBefore.pending).toBe(2);
    expect(zones.humanValidated - zonesBefore.humanValidated).toBe(1);
    expect(zones.autoAccept - zonesBefore.autoAccept).toBe(1);
    expect(zones.autoReject - zonesBefore.autoReject).toBe(0);
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
          classeeSansSuite: number;
          decidedBySystem: number;
          decidedByHuman: number;
        };
      };
    }).summary.volumes;

    // Rapport en absolu : 4 reçues, 2 retenues (1 auto + 1 gris accepté),
    // 0 écartée (plus aucun refus automatique), 2 encore en attente (1 gris +
    // 1 proposée au refus), 1 décidée système (la seule acceptation auto),
    // 1 humaine.
    expect(volumes.received).toBe(4);
    expect(volumes.retained).toBe(2);
    expect(volumes.rejected).toBe(0);
    expect(volumes.enAttente).toBe(2);
    expect(volumes.decidedBySystem).toBe(1);
    expect(volumes.decidedByHuman).toBe(1);

    // Aucun classement sans suite dans ce scénario (clôture SANS classer).
    expect(volumes.classeeSansSuite).toBe(0);

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
    expect(volumes.classeeSansSuite).toBe(before.counts.sans_suite);

    // INVARIANT DE PARTITION (étendu « sans suite ») : la ventilation somme
    // au total brut — c'est LE test qui attrape tout statut qui fuirait.
    expect(
      volumes.retained + volumes.rejected + volumes.enAttente + volumes.classeeSansSuite,
    ).toBe(volumes.received);
  });
});
