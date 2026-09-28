/**
 * S27 — « Inviter » un profil du vivier depuis la campagne
 * (fix/vivier-replanif-filtres, point 1 et 1 bis).
 *
 *   1. inviter ⇒ UNE candidature (source vivier, décision humaine, zone
 *      acceptée, origine vivier), étape « Invité », UN mail qui dit d'où vient
 *      la sollicitation, briefing en file — et AUCUNE fiche de validation ;
 *   2. re-cliquer ⇒ aucun second mail, aucune seconde analyse ;
 *   3. deux clics SIMULTANÉS ⇒ une candidature, un mail ;
 *   4. écarter ⇒ rien n'est envoyé, rien n'est créé.
 *
 * Seeding par le VRAI chemin (cf. S5) : le candidat est capitalisé au vivier
 * par sa candidature à une campagne source, puis proposé sur les autres.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as analyzeCv } from '@/app/api/cv-analyzer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { POST as runPreselection } from '@/app/api/campaigns/[id]/vivier-preselection/route';
import { POST as decidePreselection } from '@/app/api/campaigns/[id]/vivier-preselection/decisions/route';
import { POST as invite } from '@/app/api/campaigns/[id]/vivier-preselection/invite/route';
import { GET as counters } from '@/app/api/candidatures/counters/route';

import { call, callWithId, cvAnalyzerForm, testCampaignPayload, testScoringSheet, until } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRow } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const campSource = newTestCampaignId('s27src');
const camp = newTestCampaignId('s27');
const campRace = newTestCampaignId('s27race');
const campReject = newTestCampaignId('s27rej');
const EMAIL = 'fort@test.local';
let vivierId = '';

const mailsTo = (from: number) =>
  sentEmails.slice(from).filter((m) => JSON.stringify(m.to).includes(EMAIL));

beforeAll(async () => {
  await cleanAll();
  resetSentEmails();
  for (const id of [campSource, camp, campRace, campReject]) {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: testCampaignPayload({ id, status: 'active', sources: ['manual', 'email', 'vivier'] }),
    });
    expect(res.status).toBe(200);
  }
  const seed = await call(analyzeCv, {
    method: 'POST',
    form: cvAnalyzerForm({
      profile: 'fort',
      campaignId: campSource,
      sheet: testScoringSheet(campSource),
      thresholdLow: 30,
      thresholdHigh: 75,
      taskId: `treg_s27_seed_${Date.now().toString(36)}`,
    }),
  });
  expect(seed.status).toBe(200);
  const indexed = await until(async () => {
    const { data } = await db().from('vivier_candidates').select('id, indexing_status').eq('email', EMAIL).maybeSingle();
    return data && data.indexing_status === 'indexed' ? data : null;
  }, 'candidat vivier indexé');
  vivierId = indexed.id as string;
  for (const id of [camp, campRace, campReject]) {
    const res = await callWithId(runPreselection, id, { method: 'POST', body: {} });
    expect(res.status).toBe(200);
    const ids = (res.json.entries as Array<{ candidateId: string }>).map((e) => e.candidateId);
    expect(ids).toContain(vivierId);
  }
}, 300_000);

afterAll(async () => {
  await cleanAll();
});

const analysisIdFor = (campaignId: string) => `can_viv_${campaignId}_${vivierId}`;

describe('S27 — inviter depuis le vivier', () => {
  it('S27.1 — une candidature « Invité », un mail qui dit l’origine, un briefing, aucune fiche de validation', async () => {
    const before = sentEmails.length;
    const res = await callWithId(invite, camp, { method: 'POST', body: { candidateId: vivierId } });
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    expect(res.json).toMatchObject({ analysisId: analysisIdFor(camp), mail: 'sent', created: true });

    const row = await readRow<{
      source: string; decided_by: string; decision_zone: string; status: string; from_vivier: boolean;
      vivier_candidate_id: string; application: { vivierOrigin?: { vivierCandidateId: string } };
    }>('candidate_analyses', analysisIdFor(camp));
    expect(row).toMatchObject({
      source: 'vivier', decided_by: 'user', decision_zone: 'auto_accept', status: 'accepted',
      from_vivier: true, vivier_candidate_id: vivierId,
    });
    expect(row.application.vivierOrigin?.vivierCandidateId).toBe(vivierId);

    const mails = mailsTo(before);
    expect(mails).toHaveLength(1);
    expect(mails[0]!.html).toMatch(/Vous nous aviez adressé votre candidature le|Votre CV figure dans notre vivier/);
    // Une OPPORTUNITÉ, jamais une « candidature retenue » : il n'a pas postulé.
    expect(mails[0]!.subject).toMatch(/^Une opportunité/);
    expect(`${mails[0]!.subject} ${mails[0]!.html}`).not.toMatch(/retenu/i);

    const { data: briefs } = await db().from('interview_briefs').select('status').eq('uid', analysisIdFor(camp));
    expect(briefs?.map((b) => b.status)).toEqual(['awaiting_booking']);

    const { data: validations } = await db().from('pending_validations').select('id').eq('campaign_id', camp);
    expect(validations ?? []).toHaveLength(0);

    const { data: journal } = await db()
      .from('journal')
      .select('action')
      .eq('campaign_id', camp)
      .in('action', ['imap_cv_received', 'imap_cv_analyzed', 'candidate_created_from_vivier']);
    expect((journal ?? []).map((j) => j.action).sort()).toEqual(
      ['candidate_created_from_vivier', 'imap_cv_analyzed', 'imap_cv_received'],
    );

    const { data: pre } = await db()
      .from('vivier_preselections')
      .select('state')
      .eq('campaign_id', camp)
      .eq('candidate_id', vivierId);
    expect(pre?.[0]?.state).toBe('contacted');

    // Comptée « Invité » comme un CV arrivé par mail.
    const c = await call(counters, { query: `campaignId=${encodeURIComponent(camp)}` });
    expect(c.status).toBe(200);
    expect((c.json.counts as Record<string, number>).invite).toBe(1);
  });

  it('S27.2 — re-cliquer : aucun second mail, aucune seconde analyse', async () => {
    const before = sentEmails.length;
    const res = await callWithId(invite, camp, { method: 'POST', body: { candidateId: vivierId } });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ mail: 'duplicate', created: false });
    expect(mailsTo(before)).toHaveLength(0);
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', camp);
    expect(data ?? []).toHaveLength(1);
  });

  it('S27.3 — deux clics simultanés : une candidature, un mail', async () => {
    const before = sentEmails.length;
    const results = await Promise.all([
      callWithId(invite, campRace, { method: 'POST', body: { candidateId: vivierId } }),
      callWithId(invite, campRace, { method: 'POST', body: { candidateId: vivierId } }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // L'un invite ; l'autre voit l'invitation en cours (409) — ou, s'il arrive
    // après, retrouve la candidature et n'envoie rien (200 duplicate).
    expect(statuses[0]).toBe(200);
    expect(mailsTo(before)).toHaveLength(1);
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', campRace);
    expect(data ?? []).toHaveLength(1);
  });

  it('S27.4 — écarter : rien d’envoyé, rien de créé', async () => {
    const before = sentEmails.length;
    const res = await callWithId(decidePreselection, campReject, {
      method: 'POST',
      body: { candidateIds: [vivierId], decision: 'reject' },
    });
    expect(res.status).toBe(200);
    expect(mailsTo(before)).toHaveLength(0);
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', campReject);
    expect(data ?? []).toHaveLength(0);
    const refused = await callWithId(invite, campReject, { method: 'POST', body: { candidateId: vivierId } });
    expect(refused.status).toBe(409);
    expect(mailsTo(before)).toHaveLength(0);
  });
});
