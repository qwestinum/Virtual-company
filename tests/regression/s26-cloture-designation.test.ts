/**
 * S26 — CLÔTURE : issue du recrutement, désignation du recruté, retenus non
 * sélectionnés (feat/feedback-candidat, lot 4). Par les routes RÉELLES.
 *
 *   S26.1 — une désignation sans message pour chaque autre retenu est REFUSÉE
 *           côté serveur, et rien n'est posé (la campagne reste active) ;
 *   S26.2 — conclu avec désignation : un « Recruté », les autres « Non retenu »
 *           (cause `not_selected_at_closure`), un message au plus chacun ; le
 *           dossier ouvert est classé sans suite sur le gabarit « Sans suite » ;
 *           `campaign_closed` porte l'issue et le recruté, sans aucun nom ;
 *   S26.3 — rejouer la même clôture ne renvoie RIEN ;
 *   S26.4 — « Annuler la désignation » : retour « Retenu », aucun envoi ;
 *   S26.5 — conclu sans préciser, et non conclu : aucun retenu ne change,
 *           aucun message forcé.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as closeCampaign } from '@/app/api/campaigns/[id]/close/route';
import { POST as correctDecision } from '@/app/api/candidatures/[id]/correct-decision/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { POST as postJournal } from '@/app/api/journal/route';

import {
  call,
  callWithId,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
} from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRow, readRows } from './helpers/db';
import { computeBusinessSignals } from '@/lib/notifications/business-signals';
import { resetSentEmails, sentEmails } from './helpers/mocks';
import { analysisIdOf, postVerdict, REGRESSION_VERDICT_COMMENT } from './helpers/verdict';

type Counts = Record<string, number>;

async function counters(campaignId: string): Promise<Counts> {
  const res = await call(getCounters, { query: `campaignId=${campaignId}` });
  expect(res.status).toBe(200);
  return (res.json as { counts: Counts }).counts;
}

async function analyze(campaignId: string, taskId: string): Promise<void> {
  const res = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile: 'fort',
      campaignId,
      sheet: testScoringSheet(campaignId),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId,
    }),
  });
  expect(res.status).toBe(200);
}

/** Un RETENU : analysé, entretien pointé, verdict positif par la route réelle. */
async function retenu(campaignId: string, taskId: string): Promise<string> {
  await analyze(campaignId, taskId);
  const pointed = await call(postJournal, {
    method: 'POST',
    body: {
      action: 'candidate_interview_marked',
      campaignId,
      actor: 'user',
      payload: { uid: taskId, candidate: 'Candidat Treg', status: 'realized' },
    },
  });
  expect(pointed.status).toBe(204);
  expect((await postVerdict(taskId, 'validated')).status).toBe(200);
  return analysisIdOf(taskId);
}

/**
 * Les messages posés PAR LA CLÔTURE. La préparation en pose déjà un par
 * retenu (le verdict exige son choix de message : « Retenu », je préviens
 * moi-même) — ils ne sont pas de la clôture.
 */
async function closureFeedback(campaignId: string) {
  const rows = await readRows<{ analysis_id: string; kind: string; channel: string; mail_status: string | null }>(
    'candidate_feedback',
    { campaign_id: campaignId },
  );
  return rows.filter((r) => r.kind !== 'retenu');
}

async function campaign(slug: string): Promise<string> {
  const id = newTestCampaignId(slug);
  const res = await call(putCampaign, { method: 'PUT', body: testCampaignPayload({ id, status: 'active' }) });
  expect(res.status).toBe(200);
  return id;
}

const SEND = {
  mode: 'send',
  subject: 'Votre candidature',
  body: 'Bonjour,\n\nNous avons finalement confié le poste à une autre personne.\n\nBien cordialement',
} as const;
const SELF = { mode: 'self', channel: 'telephone' } as const;

const tag = Date.now().toString(36);
let camp = '';
let awa = '';
let jean = '';
let lea = '';
let openTask = '';

beforeAll(async () => {
  await cleanAll();
  camp = await campaign('s26');
  awa = await retenu(camp, `treg_s26_awa_${tag}`);
  jean = await retenu(camp, `treg_s26_jean_${tag}`);
  lea = await retenu(camp, `treg_s26_lea_${tag}`);
  openTask = `treg_s26_open_${tag}`;
  await analyze(camp, openTask); // reste « Invité » : un dossier OUVERT
  resetSentEmails();
});
afterAll(async () => {
  await cleanAll();
});

function closeBody(over: Record<string, unknown>) {
  return {
    outcome: 'conclu',
    hiredAnalysisIds: [jean],
    notSelected: [
      { analysisId: awa, feedback: SEND },
      { analysisId: lea, feedback: SELF },
    ],
    dismissOpen: true,
    reason: 'poste_pourvu',
    sendMail: true,
    ...over,
  };
}

describe('S26 — clôture avec désignation', () => {
  it('S26.1 — un retenu sans message ⇒ 400, RIEN n’est posé', async () => {
    const res = await callWithId(closeCampaign, camp, {
      method: 'POST',
      body: closeBody({ notSelected: [{ analysisId: awa, feedback: SEND }] }),
    });
    expect(res.status).toBe(400);
    expect(res.json).toMatchObject({ error: 'feedback_required', analysisId: lea });
    expect((await readRow<{ status: string }>('campaigns', camp)).status).toBe('active');
    expect(await closureFeedback(camp)).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    expect((await counters(camp)).retenu).toBe(3);
  });

  it('S26.2 — un Recruté, deux Non retenu avec cause, un message chacun au plus', async () => {
    const res = await callWithId(closeCampaign, camp, { method: 'POST', body: closeBody({}) });
    expect(res.status).toBe(200);

    const c = await counters(camp);
    expect(c.recrute).toBe(1);
    expect(c.retenu).toBe(0);
    expect(c.non_retenu).toBe(2);
    expect(c.sans_suite).toBe(1);

    const verdicts = await readRows<{ action: string; payload: Record<string, unknown> }>('journal', {
      campaign_id: camp,
      action: 'candidate_validation_marked',
    });
    const causes = verdicts.filter((v) => v.payload.cause === 'not_selected_at_closure');
    expect(causes.map((v) => v.payload.status)).toEqual(['rejected', 'rejected']);

    const feedback = await closureFeedback(camp);
    const byAnalysis = new Map(feedback.map((f) => [f.analysis_id, f]));
    expect(byAnalysis.get(awa)).toMatchObject({ kind: 'non_retenu', channel: 'mail', mail_status: 'sent' });
    expect(byAnalysis.get(lea)).toMatchObject({ kind: 'non_retenu', channel: 'telephone', mail_status: null });
    expect(byAnalysis.has(jean)).toBe(false);
    const openFeedback = feedback.filter((f) => f.kind === 'sans_suite');
    expect(openFeedback).toHaveLength(1);
    expect(openFeedback[0]!.mail_status).toBe('sent');

    // Deux mails : le non-sélectionné qui a choisi l'envoi, et le dossier
    // ouvert classé sans suite. Ni Léa (téléphone), ni le recruté.
    expect(sentEmails).toHaveLength(2);
    for (const m of sentEmails) expect(m.html).not.toContain(REGRESSION_VERDICT_COMMENT);

    const closed = await readRows<{ payload: Record<string, unknown> }>('journal', {
      campaign_id: camp,
      action: 'campaign_closed',
    });
    expect(closed).toHaveLength(1);
    expect(closed[0]!.payload).toMatchObject({
      outcome: 'conclu',
      hiredAnalysisIds: [jean],
      notSelectedAnalysisIds: [awa, lea],
    });
    expect(JSON.stringify(closed[0]!.payload)).not.toContain('Candidat Treg');
  });

  it('S26.3 — rejouer la même clôture ne renvoie RIEN', async () => {
    const before = sentEmails.length;
    const res = await callWithId(closeCampaign, camp, { method: 'POST', body: closeBody({}) });
    // Jean est désormais « Recruté », plus « Retenu » : la désignation n'a
    // plus d'objet et le serveur le dit.
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('invalid_hire');
    expect(sentEmails.length).toBe(before);
  });

  it('S26.4 — « Annuler la désignation » : retour Retenu, aucun envoi', async () => {
    const before = sentEmails.length;
    const res = await callWithId(correctDecision, jean, {
      method: 'POST',
      body: { target: 'hire_cleared', reason: 'mauvaise ligne' },
    });
    expect(res.status).toBe(200);
    expect(res.json.nextStage).toBe('retenu');
    expect(sentEmails.length).toBe(before);
    expect((await counters(camp)).recrute).toBe(0);
  });
});

describe('S26.6 — clôture incomplète : le produit le DIT', () => {
  it('un non-sélectionné sans son verdict de clôture ⇒ signal « clôture incomplète »', async () => {
    const before = (await computeBusinessSignals()).find((x) => x.key === 'closure_incomplete');
    expect(before?.message ?? '').not.toContain(camp);

    // Simule une clôture interrompue entre deux écritures : le verdict de Léa
    // n'a jamais été posé, alors que `campaign_closed` l'annonce.
    const rows = await readRows<{ id: number; payload: Record<string, unknown> }>('journal', {
      campaign_id: camp,
      action: 'candidate_validation_marked',
    });
    const leaUid = (await readRow<{ uid: string }>('candidate_analyses', lea)).uid;
    const target = rows.find((r) => r.payload.uid === leaUid && r.payload.cause === 'not_selected_at_closure');
    expect(target).toBeDefined();
    const { error } = await db().from('journal').delete().eq('id', target!.id);
    expect(error).toBeNull();

    const signal = (await computeBusinessSignals()).find((x) => x.key === 'closure_incomplete');
    expect(signal).toBeDefined();
    // Seule clôture incomplète de la base : le signal la NOMME et y mène.
    // (Une autre, laissée ailleurs dans la base de dev, rendrait un pluriel.)
    if (signal!.count === 1) {
      expect(signal!.target).toEqual({ route: `/campagnes?campagne=${encodeURIComponent(camp)}` });
      expect(signal!.message).toContain(camp);
      expect(signal!.message).toContain('retenu non sélectionné');
    } else {
      expect(signal!.target).toEqual({ route: '/campagnes' });
    }
  });
});

describe('S26.5 — conclu sans préciser, non conclu', () => {
  it('conclu sans préciser : les retenus restent Retenu, aucun message', async () => {
    const c2 = await campaign('s26b');
    await retenu(c2, `treg_s26b_a_${tag}`);
    await retenu(c2, `treg_s26b_b_${tag}`);
    resetSentEmails();
    const res = await callWithId(closeCampaign, c2, {
      method: 'POST',
      body: { outcome: 'conclu', hiredAnalysisIds: [], notSelected: [], dismissOpen: true, reason: 'poste_pourvu', sendMail: true },
    });
    expect(res.status).toBe(200);
    expect((await counters(c2)).retenu).toBe(2);
    expect(await closureFeedback(c2)).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
    const closed = await readRows<{ payload: Record<string, unknown> }>('journal', {
      campaign_id: c2,
      action: 'campaign_closed',
    });
    expect(closed[0]!.payload).toMatchObject({ outcome: 'conclu', hiredAnalysisIds: [] });
  });

  it('non conclu : une désignation est refusée, sans elle la clôture passe', async () => {
    const c3 = await campaign('s26c');
    const a = await retenu(c3, `treg_s26c_a_${tag}`);
    resetSentEmails();
    const refused = await callWithId(closeCampaign, c3, {
      method: 'POST',
      // L'ancien format (un seul recruté) reste compris — et refusé ici.
      body: { outcome: 'non_conclu', hiredAnalysisId: a, notSelected: [], dismissOpen: false },
    });
    expect(refused.status).toBe(400);
    expect(refused.json.error).toBe('hire_without_conclusion');

    const res = await callWithId(closeCampaign, c3, {
      method: 'POST',
      body: { outcome: 'non_conclu', hiredAnalysisIds: [], notSelected: [], dismissOpen: true, reason: 'campagne_cloturee', sendMail: true },
    });
    expect(res.status).toBe(200);
    expect((await counters(c3)).retenu).toBe(1);
    expect(sentEmails).toHaveLength(0);
  });
});

describe('S26.7 — plusieurs recrutements (28/09/2026)', () => {
  it('deux recrutés : deux marqueurs, le troisième retenu Non retenu, Pilotage les nomme', async () => {
    const c4 = await campaign('s26d');
    const a = await retenu(c4, `treg_s26d_a_${tag}`);
    const b = await retenu(c4, `treg_s26d_b_${tag}`);
    const c = await retenu(c4, `treg_s26d_c_${tag}`);
    resetSentEmails();
    const res = await callWithId(closeCampaign, c4, {
      method: 'POST',
      body: {
        outcome: 'conclu',
        hiredAnalysisIds: [a, b],
        notSelected: [{ analysisId: c, feedback: SELF }],
        dismissOpen: false,
      },
    });
    expect(res.status).toBe(200);
    const current = await counters(c4);
    expect(current.recrute).toBe(2);
    expect(current.non_retenu).toBe(1);
    const hires = await readRows<{ payload: Record<string, unknown> }>('journal', {
      campaign_id: c4,
      action: 'candidate_hired_marked',
    });
    expect(hires).toHaveLength(2);
    const closed = await readRows<{ payload: Record<string, unknown> }>('journal', {
      campaign_id: c4,
      action: 'campaign_closed',
    });
    expect(closed[0]!.payload).toMatchObject({ outcome: 'conclu', hiredAnalysisIds: [a, b], notSelectedAnalysisIds: [c] });
    expect(sentEmails).toHaveLength(0);
  });

  it('ancien format (un seul recruté) : toujours compris', async () => {
    const c5 = await campaign('s26e');
    const a = await retenu(c5, `treg_s26e_a_${tag}`);
    const res = await callWithId(closeCampaign, c5, {
      method: 'POST',
      body: { outcome: 'conclu', hiredAnalysisId: a, notSelected: [], dismissOpen: false },
    });
    expect(res.status).toBe(200);
    expect((await counters(c5)).recrute).toBe(1);
  });
});
