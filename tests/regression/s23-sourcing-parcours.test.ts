/**
 * S23 — Module Sourcing, le PARCOURS de la personne approchée, par les routes
 * réelles et la base réelle. Spec : docs/specs/sourcing.md §9-12, §18.
 *
 * S21 et S22 prouvent que les ÉCRITURES passent les contraintes ; S23 prouve
 * que le PRODUIT fait ce qu'il dit, du lien reçu jusqu'aux chiffres de la
 * campagne :
 *   1. le lien reçu : chaque état a sa page (formulaire prérempli, suspendu,
 *      offre fermée sans aucune donnée, lien inconnu ou retiré), la première
 *      ouverture n'est comptée qu'une fois ;
 *   2. la soumission : débit consommé avant tout, case obligatoire, puis UNE
 *      candidature ordinaire — CV fabriqué (enrichi), analyse réelle, zone
 *      forcée même sur un profil faible, décision du recruteur, invitation
 *      envoyée par le chemin commun, briefing en file, profil soldé ;
 *   3. la candidature COMPTE : CV reçu, shortlisté, invité dans la métrique de
 *      campagne ; son CV est trouvé par la fiche candidature (défauts de
 *      recette du 14/09) ; un second envoi du même lien ne crée rien ;
 *   4. l'opposition : globale, profils supprimés partout, lien désormais mort,
 *      journal sans donnée personnelle ;
 *   5. le débit est FAIL-CLOSED en base : le 6ᵉ envoi d'une même adresse est refusé ;
 *   6. la clôture par la route réelle purge les profils et garde les exclusions.
 *
 * Frontières simulées (setup) : modèle, embeddings, email. Flag du module forcé
 * (les variables d'environnement du déploiement ne sont pas l'objet du test).
 * ⚠️ Application FERMÉE : le tick du scheduler d'un `next dev` rejouerait le
 * rail de reprise sur ces données.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourcing/flag', () => ({ isSourcingEnabled: async () => true, isSourcingDeploymentEnabled: () => true }));

import { POST as closeCampaign } from '@/app/api/campaigns/[id]/close/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getAudit } from '@/app/api/reporting/audit/candidates/[id]/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route';
import { POST as oppose } from '@/app/api/sourcing/approach/[token]/oppose/route';
import { POST as submit } from '@/app/api/sourcing/approach/[token]/submit/route';
import { journalToCampaignMetric } from '@/lib/dashboard/derive-metrics';
import { fetchCandidateTotalRows } from '@/lib/db/repos/metrics';
import { markApproachOpened } from '@/lib/db/repos/sourcing-admission';
import { mintApproachToken } from '@/lib/sourcing/approach-token';
import { resolveLandingContext } from '@/lib/sourcing/server/landing-context';

import { call, callWithId, testCampaignPayload, until } from './helpers/api';
import { cleanAll, db, newTestCampaignId } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s23');
const campPaused = newTestCampaignId('s23p');
const campClosed = newTestCampaignId('s23c');
const campOther = newTestCampaignId('s23o');
const RECRUITER = randomUUID();
const hex = () => (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
const FP = { claire: hex(), opposed: hex(), paused: hex(), closed: hex(), reserve: hex() };
const EMAIL = 'claire-s23@test.local';
const ip = () => `10.23.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

type Seeded = { id: string; token: string };
const approaches: Record<string, Seeded> = {};
const profiles: Record<string, string> = {};
let savedInterviewConfig: Record<string, unknown> | null = null;

const snapshot = (name: string) => ({
  url: `https://www.linkedin.com/in/${name.toLowerCase()}-s23`,
  name,
  firstName: name,
  location: 'Paris, Île-de-France, France',
  headline: 'Business Analyst',
  current: { title: 'Business Analyst', company: 'Banque TREG', since: '2023-05-01' },
  workHistory: [
    { title: 'Business Analyst', company: 'Banque TREG', location: 'Paris', from: '2023-05-01', to: null, description: 'Recette des parcours mobiles.' },
  ],
  education: [{ degree: 'Master SI', institution: 'Université TREG', from: '2014', to: '2016' }],
  // Marqueur de profil des fixtures : l'analyse RÉELLE rendra des verdicts « faibles ».
  about: 'PROFIL_FAIBLE_TREG — parcours AMOA.',
  skills: 'UML, SQL',
  languages: 'Anglais',
  certifications: null,
  highlight: null,
  indexedAt: '2026-08-01T00:00:00Z',
  contacts: { emails: [EMAIL] },
  availability: null,
});

async function seedSearch(campaignId: string): Promise<string> {
  const s = await db()
    .from('sourcing_searches')
    .insert({ campaign_id: campaignId, query: 'q', query_generated: 'q', query_method: 'llm', language: 'fr', requested: 100, returned: 5, new_after_dedup: 5 })
    .select('id')
    .single();
  if (s.error) throw new Error(s.error.message);
  return s.data.id as string;
}

async function seedProfile(campaignId: string, searchId: string, fp: string, name: string, state: 'reserve' | 'to_review' | 'contacted'): Promise<string> {
  const p = await db()
    .from('sourcing_profiles')
    .insert({
      campaign_id: campaignId, search_id: searchId, fingerprint: fp, exa_rank: Object.keys(profiles).length + 1, state, exa_snapshot: snapshot(name),
      ...(state === 'contacted' ? { decided_at: new Date().toISOString(), decided_by_user_id: RECRUITER } : {}),
    })
    .select('id')
    .single();
  if (p.error) throw new Error(p.error.message);
  return p.data.id as string;
}

async function seedApproach(campaignId: string, fp: string, profileId: string | null, status: 'active' | 'revoked' = 'active'): Promise<Seeded> {
  const { token, tokenHash } = mintApproachToken();
  const a = await db()
    .from('sourcing_approaches')
    .insert({ campaign_id: campaignId, profile_id: profileId, fingerprint: fp, recruiter_id: RECRUITER, channel: 'linkedin', message_format: 'inmail', message: 'Bonjour, votre parcours nous intéresse : [lien] — Jane', token_hash: tokenHash, status })
    .select('id')
    .single();
  if (a.error) throw new Error(a.error.message);
  return { id: a.data.id as string, token };
}

function post(route: 'submit' | 'oppose', token: string, fromIp: string, body?: FormData): Request {
  return new Request(`http://regression.test/api/sourcing/approach/${token}/${route}`, {
    method: 'POST',
    headers: { 'x-forwarded-for': fromIp },
    ...(body ? { body } : {}),
  });
}

function submission(over: Record<string, unknown> = {}): FormData {
  const form = new FormData();
  form.append(
    'submission',
    JSON.stringify({
      email: EMAIL, phone: '06 12 34 56 78', consent: true, fullName: 'Claire S23', location: 'Paris, France',
      about: 'PROFIL_FAIBLE_TREG — parcours AMOA.', skills: 'UML, SQL', languages: 'Anglais', certifications: null,
      workHistory: [{ title: 'Business Analyst', company: 'Banque TREG', from: '2023-05-01', to: null, description: 'Recette des parcours mobiles.' }],
      education: [{ degree: 'Master SI', institution: 'Université TREG', from: '2014', to: '2016' }],
      ...over,
    }),
  );
  return form;
}

const tokenParams = (token: string) => ({ params: Promise.resolve({ token }) });

async function cleanOwn(): Promise<void> {
  const ids = Object.values(approaches).map((a) => a.id);
  const { data: arts } = await db().from('artifacts_meta').select('storage_path').like('id', 'art_src_%').in('campaign_id', [camp]);
  const paths = (arts ?? []).map((a) => a.storage_path as string | null).filter((p): p is string => Boolean(p));
  if (paths.length > 0) await db().storage.from('artifacts').remove(paths);
  await db().from('sourcing_exclusions').delete().in('fingerprint', Object.values(FP));
  await db().from('recruiters').delete().eq('id', RECRUITER);
  if (ids.length > 0) await db().from('imap_outreach_claims').delete().eq('mailbox_id', 'sourcing').in('uid', ids);
  await db().from('interview_briefs').delete().like('uid', 'can_src_%').in('campaign_id', [camp]);
  await cleanAll();
}

beforeAll(async () => {
  await cleanOwn();
  resetSentEmails();

  // Une invitation exige un lien de réservation : lien d'agenda global (restauré en afterAll).
  const settings = await call(getSettings);
  savedInterviewConfig = (settings.json.settings as { interviewConfig?: Record<string, unknown> })?.interviewConfig ?? null;
  if (savedInterviewConfig) {
    const put = await call(putSettings, { method: 'PUT', body: { interviewConfig: { ...savedInterviewConfig, agendaLink: 'https://agenda.test.local/treg-s23' } } });
    expect(put.status).toBe(200);
  }

  for (const [id, status] of [[camp, 'active'], [campPaused, 'paused'], [campClosed, 'closed'], [campOther, 'active']] as const) {
    const res = await call(putCampaign, { method: 'PUT', body: testCampaignPayload({ id, status, thresholdLow: 50, thresholdHigh: 80 }) });
    expect(res.status).toBe(200);
  }
  const r = await db().from('recruiters').insert({ id: RECRUITER, display_name: 'Jane S23', email: 'jane-s23@test.local' });
  if (r.error) throw new Error(r.error.message);

  const s = await seedSearch(camp);
  const sOther = await seedSearch(campOther);
  const sPaused = await seedSearch(campPaused);
  const sClosed = await seedSearch(campClosed);

  profiles.claire = await seedProfile(camp, s, FP.claire, 'Claire', 'contacted');
  approaches.claire = await seedApproach(camp, FP.claire, profiles.claire);
  await db().from('sourcing_exclusions').insert({ fingerprint: FP.claire, campaign_id: camp, reason: 'contacted' });

  profiles.opposed = await seedProfile(camp, s, FP.opposed, 'Odile', 'contacted');
  profiles.opposedElsewhere = await seedProfile(campOther, sOther, FP.opposed, 'Odile', 'to_review');
  approaches.opposed = await seedApproach(camp, FP.opposed, profiles.opposed);

  profiles.reserve = await seedProfile(camp, s, FP.reserve, 'Reserve', 'reserve');
  await db().from('sourcing_exclusions').insert({ fingerprint: FP.reserve, campaign_id: camp, reason: 'declined' });

  profiles.paused = await seedProfile(campPaused, sPaused, FP.paused, 'Paula', 'contacted');
  approaches.paused = await seedApproach(campPaused, FP.paused, profiles.paused);
  approaches.closed = await seedApproach(campClosed, FP.closed, await seedProfile(campClosed, sClosed, FP.closed, 'Cloe', 'contacted'));
  approaches.revoked = await seedApproach(camp, FP.claire, null, 'revoked');
});

afterAll(async () => {
  if (savedInterviewConfig) await call(putSettings, { method: 'PUT', body: { interviewConfig: savedInterviewConfig } });
  await cleanOwn();
});

describe('S23.1 — le lien reçu', () => {
  it('formulaire prérempli depuis le profil : message sans le lien, poste, recruteur, CV enrichi à confirmer', async () => {
    const ctx = await resolveLandingContext(approaches.claire!.token);
    expect(ctx.state).toEqual({ kind: 'form', prefilled: true });
    expect(ctx.view.recruiterName).toBe('Jane S23');
    expect(ctx.view.recruiterMessage).toBe('Bonjour, votre parcours nous intéresse. — Jane');
    expect(ctx.view.job?.title).toBeTruthy();
    expect(ctx.view.initial).toMatchObject({ email: EMAIL, location: 'Paris, Île-de-France, France', skills: 'UML, SQL' });
    expect(ctx.view.initial.workHistory[0]).toMatchObject({ description: 'Recette des parcours mobiles.' });
  });

  it('recrutement suspendu : le lien reste valable ; offre fermée : aucune donnée ; inconnu ou retiré : invitation indisponible', async () => {
    expect((await resolveLandingContext(approaches.paused!.token)).state.kind).toBe('paused');
    const closed = await resolveLandingContext(approaches.closed!.token);
    expect(closed.state.kind).toBe('closed');
    expect(closed.view).toMatchObject({ job: null, recruiterName: null, recruiterMessage: null });
    expect(closed.view.initial.email).toBe('');
    expect((await resolveLandingContext(approaches.revoked!.token)).state.kind).toBe('unavailable');
    expect((await resolveLandingContext(mintApproachToken().token)).state.kind).toBe('unavailable');
    expect((await resolveLandingContext('pas-un-jeton')).state.kind).toBe('unavailable');
  });

  it('la première ouverture est comptée, pas les suivantes', async () => {
    expect(await markApproachOpened(approaches.paused!.id)).toBe(true);
    expect(await markApproachOpened(approaches.paused!.id)).toBe(false);
  });
});

describe('S23.2 — la soumission', () => {
  it('case non cochée : refusée, le lien reste ouvert', async () => {
    const res = await submit(post('submit', approaches.claire!.token, ip(), submission({ consent: false })), tokenParams(approaches.claire!.token));
    expect(res.status).toBe(400);
    const { data } = await db().from('sourcing_approaches').select('status, submission').eq('id', approaches.claire!.id).single();
    expect(data).toMatchObject({ status: 'active', submission: null });
  });

  it('envoi : une candidature ordinaire, décidée par le recruteur, invitée — même sur un profil faible', async () => {
    resetSentEmails();
    const res = await submit(post('submit', approaches.claire!.token, ip(), submission()), tokenParams(approaches.claire!.token));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'sent', firstName: 'Claire', recruiterName: 'Jane S23' });

    const analysisId = `can_src_${approaches.claire!.id}`;
    const { data: analysis } = await db()
      .from('candidate_analyses')
      .select('source, status, decision_zone, decided_by, decided_by_user_id, candidate_email, total_score, application')
      .eq('id', analysisId)
      .single();
    expect(analysis).toMatchObject({ source: 'sourcing', status: 'accepted', decision_zone: 'auto_accept', decided_by: 'user', decided_by_user_id: RECRUITER, candidate_email: EMAIL });
    // Profil faible (knock-out des fixtures) : le score reste celui de l'analyse, la zone est forcée.
    expect(analysis!.total_score as number).toBeLessThan(50);

    // CV fabriqué : l'artefact existe et son fichier est dans le stockage.
    const { data: art } = await db().from('artifacts_meta').select('id, storage_path, mime').eq('id', `art_src_cv_${approaches.claire!.id}`).single();
    expect(art).toMatchObject({ mime: 'application/pdf' });
    const file = await db().storage.from('artifacts').download(art!.storage_path as string);
    expect(file.error).toBeNull();

    // Invitation par le chemin commun, à l'adresse confirmée sur la page ; briefing en file.
    expect(sentEmails.filter((m) => [m.to].flat().includes(EMAIL))).toHaveLength(1);
    const { data: brief } = await db().from('interview_briefs').select('status').eq('uid', analysisId);
    expect(brief).toHaveLength(1);

    // Profil soldé, exclusion portée à « manifesté », saisie effacée.
    expect((await db().from('sourcing_profiles').select('id').eq('id', profiles.claire!)).data).toEqual([]);
    const { data: ex } = await db().from('sourcing_exclusions').select('reason').eq('fingerprint', FP.claire).eq('campaign_id', camp);
    expect(ex).toEqual([{ reason: 'manifested' }]);
    const { data: appr } = await db().from('sourcing_approaches').select('status, submission, analysis_id').eq('id', approaches.claire!.id).single();
    expect(appr).toMatchObject({ status: 'submitted', submission: null, analysis_id: analysisId });
  });
});

describe('S23.3 — la candidature compte', () => {
  it('CV reçu, shortlisté, invité : la métrique de la campagne la voit', async () => {
    const result = await fetchCandidateTotalRows(camp);
    const metric = journalToCampaignMetric(result!.rows, camp);
    expect(metric).toMatchObject({ candidates: 1, shortlisted: 1, invited: 1 });
    const { data: manifested } = await db().from('journal').select('id').eq('action', 'sourcing_candidate_manifested').eq('payload->>approachId', approaches.claire!.id);
    expect(manifested).toHaveLength(1);
  });

  it('la fiche candidature trouve son CV', async () => {
    const res = await callWithId(getAudit, `can_src_${approaches.claire!.id}`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).toContain(`art_src_cv_${approaches.claire!.id}`);
  });

  it('un second envoi du même lien : « bien reçue », rien de plus', async () => {
    resetSentEmails();
    const res = await submit(post('submit', approaches.claire!.token, ip(), submission()), tokenParams(approaches.claire!.token));
    expect(((await res.json()) as { outcome: string }).outcome).toBe('received');
    expect(sentEmails).toHaveLength(0);
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', camp);
    expect(data).toHaveLength(1);
    expect((await resolveLandingContext(approaches.claire!.token)).state.kind).toBe('received');
  });
});

describe('S23.4 — l’opposition', () => {
  it('globale : profils supprimés sur toutes les campagnes, lien mort, journal sans donnée personnelle', async () => {
    const res = await oppose(post('oppose', approaches.opposed!.token, ip()), tokenParams(approaches.opposed!.token));
    expect(await res.json()).toEqual({ outcome: 'opposed' });
    expect((await db().from('sourcing_profiles').select('id').eq('fingerprint', FP.opposed)).data).toEqual([]);
    const { data: ex } = await db().from('sourcing_exclusions').select('campaign_id').eq('fingerprint', FP.opposed).eq('reason', 'opposed');
    expect(ex).toEqual([{ campaign_id: null }]);
    expect((await resolveLandingContext(approaches.opposed!.token)).state.kind).toBe('unavailable');
    const { data: journal } = await db().from('journal').select('payload').eq('action', 'sourcing_opposition_recorded').eq('campaign_id', camp);
    expect(journal).toHaveLength(1);
    expect(JSON.stringify(journal)).not.toMatch(/@|Odile|linkedin/i);
  });
});

describe('S23.5 — le débit est fail-closed', () => {
  it('le 6ᵉ envoi d’une même adresse en 10 minutes est refusé, avant toute lecture', async () => {
    const from = ip();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await submit(post('submit', approaches.paused!.token, from, submission({ consent: false })), tokenParams(approaches.paused!.token));
      statuses.push(res.status);
    }
    // Suspendu : les 5 premiers rendent l'état (200), le 6ᵉ est coupé par le débit.
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('S23.6 — la clôture', () => {
  it('la route de clôture purge les profils de la campagne et garde les exclusions', async () => {
    const res = await callWithId(closeCampaign, camp, { method: 'POST', body: { dismissOpen: false } });
    expect(res.status).toBe(200);
    await until(async () => {
      const { data } = await db().from('sourcing_profiles').select('id').eq('campaign_id', camp);
      return (data ?? []).length === 0;
    }, 'profils purgés à la clôture');
    const purged = await until(async () => {
      const { data } = await db().from('journal').select('payload').eq('action', 'sourcing_profiles_purged').eq('campaign_id', camp);
      return (data ?? [])[0] ?? null;
    }, 'journal de purge');
    expect(purged.payload).toMatchObject({ count: 1, byState: { reserve: 1, to_review: 0, contacted: 0 }, trigger: 'closure' });
    const { data: kept } = await db().from('sourcing_exclusions').select('reason').eq('fingerprint', FP.reserve);
    expect(kept).toEqual([{ reason: 'declined' }]);
  });
});
