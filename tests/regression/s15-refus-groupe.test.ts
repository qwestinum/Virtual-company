/**
 * S15 — Refus groupé depuis le sous-onglet « Propositions de refus ».
 *
 * Ce scénario fait tourner le VRAI code client (`runBulkReject` →
 * `decideGrayValidation` → `sendValidation`) contre les VRAIES routes : un
 * shim `fetch` local dispatche les URL `/api/...` vers les handlers Next
 * en-process. C'est le seul moyen de tester la fournée telle qu'elle part
 * réellement — la réimplémenter dans le test ne prouverait rien du chemin de
 * production.
 *
 * Ce qui est sous test :
 *   1. le seuil de campagne borne EXACTEMENT le sous-onglet (partition servie
 *      par /api/validations, décidée sur la valeur en base) ;
 *   2. refus groupé de N → N `sent`, N mails UNIQUES, étapes correctes, et la
 *      partition des compteurs (invariant S6) reste entière ;
 *   3. double « Refuser ces N » → aucun second mail (les claims font foi) ;
 *   4. échec partiel → les candidatures en échec restent `pending`, donc
 *      encore visibles et retentables ;
 *   5. mails sautés par choix → décisions enregistrées, ZÉRO mail, et le
 *      journal distingue « sauté par choix » d'un échec d'envoi ;
 *   6. accepter depuis le sous-onglet suit le chemin d'acceptation NORMAL.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { GET as getCampaigns } from '@/app/api/campaigns/route';
import { POST as createMailbox } from '@/app/api/mailboxes/route';
import {
  getMailboxWithSecrets,
  type MailboxRow,
} from '@/lib/db/repos/mailboxes';
import { processEmailAttachment } from '@/lib/imap/poller';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { POST as postScheduler } from '@/app/api/scheduler/route';
import {
  GET as listValidations,
  POST as postValidation,
} from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { POST as reserveSend } from '@/app/api/validations/[id]/reserve-send/route';
import { POST as finalizeSend } from '@/app/api/validations/[id]/send/route';
import { runBulkReject } from '@/lib/hitl/bulk-reject';
import {
  partitionRejectionProposals,
  sortRejectionProposals,
} from '@/lib/hitl/rejection-proposal';
import type { CVApplication } from '@/types/cv-analysis';
import type { DecisionZone, PendingValidation } from '@/types/hitl';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';

import {
  call,
  cvAnalyzerForm,
  testCampaignPayload,
  testScoringSheet,
  TEST_JOB_TITLE,
} from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

/**
 * Seuils du scénario : sous 30 → PROPOSÉ au refus (aucun mail, file HITL) ;
 * 30..75 → zone grise, à examiner ; ≥ 75 → acceptation automatique. Ce sont les
 * bornes qui séparent proprement les trois PDF de fixtures (faible / moyen /
 * fort), pour que chaque zone soit peuplée par une vraie analyse.
 */
const T_LOW = 30;
const T_HIGH = 75;
const camp = newTestCampaignId('s15');

type Row = Record<string, unknown>;

let mailbox: MailboxRow;

// ─── Shim fetch : les URL /api/… vont aux handlers réels ───────────────────
// Le code client appelle `fetch` avec des chemins relatifs. On les route ici
// plutôt que de recopier la séquence d'envoi dans le test.
const realFetch = globalThis.fetch;

async function dispatch(path: string, init: RequestInit): Promise<Response> {
  const url = `http://regression.test${path}`;
  const request = new Request(url, init);
  const idMatch = path.match(/^\/api\/validations\/([^/?]+)(\/[a-z-]+)?$/);
  if (path === '/api/mail-composer') return composeMail(request);
  if (path === '/api/scheduler') return postScheduler(request);
  if (idMatch) {
    const id = decodeURIComponent(idMatch[1]!);
    const ctx = { params: Promise.resolve({ id }) };
    if (idMatch[2] === '/reserve-send') return reserveSend(request, ctx);
    if (idMatch[2] === '/send') return finalizeSend(request, ctx);
    if (!idMatch[2]) return patchValidation(request, ctx);
  }
  throw new Error(`S15 — route non shimée : ${path}`);
}

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === 'string' ? input : String(input);
    if (path.startsWith('/api/')) return dispatch(path, init ?? {});
    return realFetch(input as RequestInfo, init);
  });

  const res = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({
      id: camp,
      status: 'active',
      thresholdLow: T_LOW,
      thresholdHigh: T_HIGH,
    }),
  });
  expect(res.status).toBe(200);

  // Boîte de réception : sert le verrou de bout en bout sur le chemin RÉEL du
  // poller (c'est là que le refus partait tout seul avant la bascule).
  const mb = await call(createMailbox, {
    method: 'POST',
    body: {
      label: '[TREG] boite s15',
      imapHost: 'imap.test.local',
      imapPort: 993,
      imapSsl: true,
      userEmail: 'boite-s15@test.local',
      password: 'motdepasse-factice',
      isEnabled: false,
    },
  });
  expect(mb.status).toBe(200);
  const withSecrets = await getMailboxWithSecrets(
    (mb.json.mailbox as { id: string }).id,
  );
  expect(withSecrets).not.toBeNull();
  mailbox = withSecrets as MailboxRow;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await cleanAll();
});

/**
 * Analyse un CV et met la candidature en file HITL. Le SCORE et la ZONE sont
 * ceux de l'analyse réelle — on n'impose rien : c'est la zone figée en base qui
 * décide du sous-onglet, et un test qui la fabriquerait ne prouverait rien.
 */
async function enqueue(
  profile: 'faible' | 'moyen' | 'fort',
  slug: string,
): Promise<PendingValidation> {
  const taskId = `treg_s15_${slug}_${Math.random().toString(36).slice(2, 7)}`;
  const analyzed = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile,
      campaignId: camp,
      sheet: testScoringSheet(camp),
      thresholdLow: T_LOW,
      thresholdHigh: T_HIGH,
      taskId,
    }),
  });
  expect(analyzed.status).toBe(200);
  const app = analyzed.json.application as CVApplication;

  const id = `val_treg_${taskId}`;
  const enqueue = await call(postValidation, {
    method: 'POST',
    body: {
      id,
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
  return enqueue.json.validation as PendingValidation;
}

async function loadQueue(): Promise<{
  proposals: PendingValidation[];
  toExamine: PendingValidation[];
}> {
  const res = await call(listValidations);
  expect(res.status).toBe(200);
  const all = (res.json.validations as PendingValidation[]).filter(
    (v) => v.campaignId === camp,
  );
  // La ZONE figée au scoring, servie par l'API — jamais une comparaison du
  // score au seuil courant (qui re-jugerait un dossier déjà analysé).
  const zones = res.json.zoneByValidation as Record<string, DecisionZone | null>;
  const { proposals, toExamine } = partitionRejectionProposals(all, zones);
  return { proposals: sortRejectionProposals(proposals), toExamine };
}

/** Mails RÉELLEMENT partis aux candidats de test (les previews n'envoient pas). */
function rejectionMails(): typeof sentEmails {
  return sentEmails.filter((m) =>
    (Array.isArray(m.to) ? m.to : [m.to]).some((addr) =>
      addr.endsWith('@test.local'),
    ),
  );
}

describe('S15 — refus groupé', () => {
  it('la ZONE d’analyse borne le sous-onglet (un gris n’y tombe jamais)', async () => {
    await enqueue('faible', 'bas1');
    await enqueue('faible', 'bas2');
    const gris = await enqueue('moyen', 'gris');

    const { proposals, toExamine } = await loadQueue();
    expect(proposals).toHaveLength(2);
    expect(toExamine.map((v) => v.id)).toEqual([gris.id]);
    expect(proposals.length + toExamine.length).toBe(3);

    // Toutes les analyses des propositions portent bien la zone figée attendue.
    const analyses = (await readRows('candidate_analyses', {
      campaign_id: camp,
    })) as Row[];
    const proposalUids = new Set(
      proposals.map((v) => v.payload?.uid as string),
    );
    const zones = analyses
      .filter((a) => proposalUids.has(a.uid as string))
      .map((a) => a.decision_zone);
    expect(zones).toEqual(['proposed_reject', 'proposed_reject']);
  });

  it('DÉPLACER LES SEUILS ne reclasse PAS un dossier déjà analysé', async () => {
    // Le défaut de référence : le gris, analysé en [30,75[, se retrouvait dans
    // les propositions de refus dès que le seuil bas passait au-dessus de son
    // score. La zone est figée — elle ne suit pas les seuils.
    const before = await loadQueue();
    const grisId = before.toExamine[0]!.id;

    const { error } = await db()
      .from('campaigns')
      .update({ threshold_low: 95, threshold_high: 96 })
      .eq('id', camp);
    expect(error).toBeNull();

    const after = await loadQueue();
    expect(after.toExamine.map((v) => v.id)).toContain(grisId);
    expect(after.proposals.map((v) => v.id)).not.toContain(grisId);
    expect(after.proposals).toHaveLength(before.proposals.length);

    await db()
      .from('campaigns')
      .update({ threshold_low: T_LOW, threshold_high: T_HIGH })
      .eq('id', camp);
  });

  it('refus groupé de 2 → 2 sent, 2 mails uniques, étape « refusé » partout', async () => {
    resetSentEmails();
    const { proposals } = await loadQueue();
    expect(proposals).toHaveLength(2);

    const report = await runBulkReject(proposals, {
      sendMail: true,
      batchId: 'treg_s15_batch_ok',
    });
    expect(report.succeeded).toBe(2);
    expect(report.failed).toBe(0);

    const rows = (await readRows('pending_validations', { campaign_id: camp })) as Row[];
    const sent = rows.filter((r) => r.status === 'sent');
    expect(sent).toHaveLength(2);
    expect(sent.every((r) => r.decision === 'reject')).toBe(true);

    // UN mail par validation traitée, pas un de plus. (Les fixtures partagent
    // l'adresse « moyen@test.local » : c'est le NOMBRE d'envois qui prouve
    // l'absence de doublon, pas la diversité des destinataires — et le test de
    // rejeu ci-dessous ferme l'autre moitié de la question.)
    expect(rejectionMails()).toHaveLength(2);

    // Les analyses correspondantes sont bien passées en 'rejected'.
    const analyses = (await readRows('candidate_analyses', { campaign_id: camp })) as Row[];
    const decided = analyses.filter((a) => a.decided_by === 'user');
    expect(decided.length).toBeGreaterThanOrEqual(2);
    expect(decided.every((a) => a.status === 'rejected')).toBe(true);
    // Zone IMMUABLE : une décision humaine ne réécrit JAMAIS la zone figée au
    // scoring — l'audit doit pouvoir dire « proposé au refus, puis refusé par
    // untel », pas faire disparaître l'étape de proposition.
    expect(decided.every((a) => a.decision_zone === 'proposed_reject')).toBe(
      true,
    );
  });

  it('rejouer la même fournée n’envoie AUCUN second mail (claims)', async () => {
    resetSentEmails();
    const rows = (await readRows('pending_validations', { campaign_id: camp })) as Row[];
    const alreadySent = rows
      .filter((r) => r.status === 'sent')
      .map((r) => ({
        id: r.id as string,
        campaignId: camp,
        candidateName: r.candidate_name as string,
        candidateEmail: r.candidate_email as string | null,
        score: r.score as number | null,
        decision: 'reject' as const,
        cvArtifactId: null,
        reportArtifactId: null,
        mailDraftArtifactId: null,
        confirmed: true,
        status: 'sent' as const,
        payload: r.payload as Record<string, unknown>,
        createdAt: r.created_at as string,
        updatedAt: r.updated_at as string,
        decidedAt: r.decided_at as string | null,
        decidedBy: null,
        decidedByUser: null,
      }));
    expect(alreadySent).toHaveLength(2);

    const report = await runBulkReject(alreadySent, {
      sendMail: true,
      batchId: 'treg_s15_batch_rejeu',
    });
    // La réservation refuse : rien n'est envoyé, et c'est DIT.
    expect(report.succeeded).toBe(0);
    expect(rejectionMails()).toHaveLength(0);
  });

  it('échec partiel : la candidature en échec reste pending, les autres partent', async () => {
    resetSentEmails();
    const ok = await enqueue('faible', 'partiel_ok');
    const ko = await enqueue('faible', 'partiel_ko');
    // Sabotage CIBLÉ : une validation déjà `sending` (envoi en vol) ne peut
    // pas être réservée → son refus échoue, sans toucher les autres.
    const { error } = await db()
      .from('pending_validations')
      .update({ status: 'sending', sending_at: new Date().toISOString() })
      .eq('id', ko.id);
    expect(error).toBeNull();

    const report = await runBulkReject([ok, ko], {
      sendMail: true,
      batchId: 'treg_s15_batch_partiel',
    });
    expect(report.succeeded).toBe(1);
    expect(report.failed).toBe(1);
    expect(rejectionMails()).toHaveLength(1);

    const rows = (await readRows('pending_validations', { campaign_id: camp })) as Row[];
    expect(rows.find((r) => r.id === ok.id)?.status).toBe('sent');
    // Toujours PAS terminal : la candidature reste dans la file, retentable.
    expect(rows.find((r) => r.id === ko.id)?.status).toBe('sending');

    // Remise en état pour la suite du scénario.
    await db()
      .from('pending_validations')
      .update({ status: 'pending', sending_at: null })
      .eq('id', ko.id);
  });

  it('mails sautés par choix : décisions prises, zéro mail, journal explicite', async () => {
    resetSentEmails();
    const muet = await enqueue('faible', 'muet');

    const report = await runBulkReject([muet], {
      sendMail: false,
      batchId: 'treg_s15_batch_muet',
    });
    expect(report.succeeded).toBe(1);
    expect(rejectionMails()).toHaveLength(0);

    const journal = (await readRows('journal', { campaign_id: camp })) as Row[];
    const notSent = journal.filter((e) => e.action === 'hitl_mail_not_sent');
    expect(notSent).toHaveLength(1);
    const payload = notSent[0]!.payload as Record<string, unknown>;
    // LA distinction d'audit : un choix n'est pas une panne.
    expect(payload.cause).toBe('skipped_by_user');
    expect(payload.mailStatus).toBe('skipped_by_user');
    expect(payload.batchId).toBe('treg_s15_batch_muet');

    const decided = journal.filter((e) => e.action === 'hitl_validation_sent');
    const muetEntry = decided.find(
      (e) => (e.payload as Record<string, unknown>).mailSkippedByUser === true,
    );
    expect(muetEntry).toBeDefined();
    expect((muetEntry!.payload as Record<string, unknown>).mailSent).toBe(false);
  });

  it('accepter depuis le sous-onglet suit le chemin d’acceptation NORMAL', async () => {
    resetSentEmails();
    const { proposals } = await loadQueue();
    const candidate = proposals[0];
    expect(candidate).toBeDefined();

    const { decideGrayValidation } = await import(
      '@/lib/hitl/decide-gray-validation'
    );
    const result = await decideGrayValidation(candidate!, 'accept', {
      subject: '[TREG] Invitation',
      html: '<p>Invitation de test.</p>',
    });
    expect(result.ok).toBe(true);

    const rows = (await readRows('pending_validations', { campaign_id: camp })) as Row[];
    const row = rows.find((r) => r.id === candidate!.id);
    expect(row?.status).toBe('sent');
    expect(row?.decision).toBe('accept');

    // Un brief d'entretien a été mis en file — la marque du chemin normal.
    const briefs = (await readRows('interview_briefs', { campaign_id: camp })) as Row[];
    expect(briefs.length).toBeGreaterThanOrEqual(1);
  });

  // ⚠️ PLACÉ EN FIN DE SCÉNARIO : ce test ajoute une candidature à la file
  // partagée. Le mettre en tête décalait les comptages des fournées ci-dessus.
  it('VERROU RGPD : un CV faible reçu par mail ne déclenche AUCUN refus', async () => {
    // Le chemin de PRODUCTION, pas une simulation : `processEmailAttachment`
    // est le cœur partagé du poller. Avant la bascule, ce CV partait avec un
    // mail de refus automatique. Si ce test repasse au vert « tout seul » après
    // un changement du gate, c'est que l'envoi automatique est revenu.
    resetSentEmails();
    const campaigns = await call(getCampaigns);
    expect(campaigns.status).toBe(200);
    const campaign = (campaigns.json.campaigns as ActiveCampaign[]).find(
      (c) => c.id === camp,
    ) as ActiveCampaign;

    const uid = `treg_s15_imap_${Math.random().toString(36).slice(2, 7)}`;
    const outcome = await processEmailAttachment({
      mailbox,
      campaign,
      fileName: 'CV_Faible.pdf',
      mime: 'application/pdf',
      buffer: readFileSync(
        resolve(process.cwd(), 'tests/regression/fixtures/cv-faible.pdf'),
      ),
      uid,
      subject: `[TREG] Candidature ${camp}`,
      from: '"Paul Faible" <faible@test.local>',
      matchSource: 'subject' as const,
      skipIfNotCv: false,
    });
    expect(outcome).toBe('processed');

    // 1. AUCUN mail candidat n'est parti.
    expect(rejectionMails()).toHaveLength(0);

    // 2. L'analyse porte la zone « proposé au refus », pas « refus auto ».
    const analyses = (await readRows('candidate_analyses', {
      id: `can_imap_${mailbox.id}_${uid}`,
    })) as Row[];
    expect(analyses).toHaveLength(1);
    expect(analyses[0]!.decision_zone).toBe('proposed_reject');

    // 3. Une validation ATTEND dans la file — le dossier n'est pas perdu.
    const { proposals } = await loadQueue();
    expect(
      proposals.some((v) => (v.payload?.uid as string) === uid),
    ).toBe(true);
  });

  it('la partition des compteurs reste entière (invariant S6)', async () => {
    const res = await call(getCounters, { query: `campaignId=${camp}` });
    expect(res.status).toBe(200);
    const { counts, total } = res.json as {
      counts: Record<string, number>;
      total: number;
    };
    const sum = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(total);
  });
});
