/**
 * S22 — Module Sourcing, page d'atterrissage et manifestation, sur la base
 * réelle. Spec : docs/specs/sourcing.md §9-12.
 *
 * Ce que les tests unitaires (base simulée) ne peuvent pas prouver : que les
 * transitions du lot 4 passent les CONTRAINTES du lot 1.
 *   1. réservation : un seul gagnant ; relâche ⇒ lien de nouveau actif, saisie effacée ;
 *   2. manifestation : analyse insérée avec décision humaine du recruteur et
 *      origine `sourcing`, approche `submitted` avec SON identifiant d'analyse,
 *      saisie effacée, profil supprimé, exclusion passée à `manifested` ;
 *   3. panne d'analyse : approche en attente, tentative comptée, cause écrite ;
 *   4. opposition : exclusion globale, profils supprimés sur toutes les
 *      campagnes, liens ouverts révoqués ET vidés, candidature créée intacte ;
 *   5. clôture : profils purgés et comptés, exclusions gardées ; le filet
 *      retrouve une campagne close qui porte encore des profils.
 * Modèle, envoi, stockage et PDF simulés.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AnalysisUnavailableError } from '@/lib/ai/errors';

const hoisted = vi.hoisted(() => ({ campaignId: '' }));

vi.mock('@/lib/agents/server/cv-application-analyze', () => ({ analyzeCVApplication: vi.fn() }));
vi.mock('@/lib/agents/server/interview-mail', () => ({ canInviteForCampaign: vi.fn(async () => true) }));
vi.mock('@/lib/imap/outreach', () => ({ dispatchCandidateOutreach: vi.fn(async () => {}) }));
vi.mock('@/lib/sourcing/server/structured-cv-pdf', () => ({ renderStructuredCvPdf: vi.fn(async () => Buffer.from('%PDF-1.4')) }));
vi.mock('@/lib/storage/blob', () => ({
  downloadArtifact: vi.fn(async () => null),
  uploadArtifactBinary: vi.fn(async () => ({ bucket: 'artifacts', path: `campagnes/${hoisted.campaignId}/sourcing-cv.pdf`, publicUrl: null })),
}));
vi.mock('@/lib/vivier/ingest-application', () => ({ feedVivierFromApplication: vi.fn(async () => true) }));
vi.mock('@/lib/vivier/match-application', () => ({ matchVivierApplication: vi.fn(async () => true) }));
vi.mock('@/lib/db/repos/campaigns', () => ({
  getCampaign: vi.fn(async (id: string) => ({
    id, status: 'active', thresholdLow: 50, thresholdHigh: 80,
    fdp: { fields: { job_title: { value: 'Business Analyst' } } },
    scoringSheet: { isValidated: true, criteria: [] },
  })),
}));

import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import {
  claimAdmissionAttempt,
  findCampaignWithLeftoverProfiles,
  getLandingApproach,
  purgeCampaignProfiles,
  recordOpposition,
  releaseSubmission,
  reserveSubmission,
  type StoredSubmission,
} from '@/lib/db/repos/sourcing-admission';
import type { JournalEntry } from '@/lib/db/repos/journal';
import { mintApproachToken } from '@/lib/sourcing/approach-token';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';

import { cleanAll, db, newTestCampaignId } from './helpers/db';

const camp = newTestCampaignId('s22');
const campClosed = newTestCampaignId('s22c');
hoisted.campaignId = camp;
const RECRUITER = randomUUID();
const hex = () => (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
const FP = { manifest: hex(), failing: hex(), opposed: hex(), closed: hex() };
const profiles: Record<string, string> = {};
const approaches: Record<string, string> = {};

const submission: StoredSubmission = {
  email: 'claire-s22@test.local', phone: '06 12 34 56 78', consent: true, fullName: 'Claire S22',
  workHistory: [{ title: 'Business Analyst', company: 'Banque X', from: '2024-05', to: null }], education: [], about: 'AMOA', cv: null,
};
const analyzed = {
  candidate: { fullName: 'Claire S22', email: 'claire-s22@test.local', phone: null, fileName: 'cv.pdf', source: 'sourcing', receivedAt: new Date().toISOString(), address: null },
  scoringResult: { totalScore: 41, status: 'rejected', decisionZone: 'proposed_reject', breakdown: [], hardFailures: [], criteriaVersion: 'v1', computedAt: new Date().toISOString() },
  narration: { summary: 'Profil AMOA.', strengths: [], weaknesses: [], justification: 'Sous le seuil.' },
};

async function cleanOwn(): Promise<void> {
  await db().from('sourcing_exclusions').delete().in('fingerprint', Object.values(FP));
  await db().from('recruiters').delete().eq('id', RECRUITER);
  await db().from('imap_outreach_claims').delete().eq('mailbox_id', 'sourcing').in('uid', Object.values(approaches));
  await cleanAll();
}

async function seedProfile(campaignId: string, searchId: string, key: keyof typeof FP, state = 'contacted'): Promise<string> {
  const p = await db()
    .from('sourcing_profiles')
    .insert({ campaign_id: campaignId, search_id: searchId, fingerprint: FP[key], exa_rank: Object.keys(profiles).length + 1, state, exa_snapshot: { name: key },
      ...(state === 'contacted' ? { decided_at: new Date().toISOString(), decided_by_user_id: RECRUITER } : {}) })
    .select('id')
    .single();
  if (p.error) throw new Error(p.error.message);
  return p.data.id as string;
}

async function seedApproach(campaignId: string, key: keyof typeof FP, profileId: string | null): Promise<string> {
  const a = await db()
    .from('sourcing_approaches')
    .insert({ campaign_id: campaignId, profile_id: profileId, fingerprint: FP[key], recruiter_id: RECRUITER, channel: 'linkedin', message_format: 'inmail', message: 'Bonjour : [lien]', token_hash: mintApproachToken().tokenHash })
    .select('id')
    .single();
  if (a.error) throw new Error(a.error.message);
  return a.data.id as string;
}

async function search(campaignId: string): Promise<string> {
  const s = await db()
    .from('sourcing_searches')
    .insert({ campaign_id: campaignId, query: 'q', query_generated: 'q', query_method: 'llm', language: 'fr', requested: 100, returned: 4, new_after_dedup: 4 })
    .select('id')
    .single();
  if (s.error) throw new Error(s.error.message);
  return s.data.id as string;
}

beforeAll(async () => {
  await cleanOwn();
  for (const [id, status] of [[camp, 'active'], [campClosed, 'closed']] as const) {
    const c = await db().from('campaigns').insert({ id, name: `[TREG] ${id}`, status, fdp: {} });
    if (c.error) throw new Error(c.error.message);
  }
  const r = await db().from('recruiters').insert({ id: RECRUITER, display_name: 'Jane S22', email: 'jane-s22@test.local' });
  if (r.error) throw new Error(r.error.message);
  const s = await search(camp);
  const sc = await search(campClosed);
  for (const key of ['manifest', 'failing', 'opposed'] as const) {
    profiles[key] = await seedProfile(camp, s, key);
    approaches[key] = await seedApproach(camp, key, profiles[key]!);
    await db().from('sourcing_exclusions').insert({ fingerprint: FP[key], campaign_id: camp, reason: 'contacted' });
  }
  // La même personne (empreinte « opposed ») trouvée aussi sur une autre campagne.
  profiles.opposedElsewhere = await seedProfile(campClosed, sc, 'opposed', 'to_review');
  profiles.closedReserve = await seedProfile(campClosed, sc, 'closed', 'reserve');
});

afterAll(cleanOwn);

describe('S22.1 — réservation', () => {
  it('un seul gagnant ; la relâche rend le lien actif et efface la saisie', async () => {
    const id = approaches.failing!;
    expect(await reserveSubmission(id, submission)).toBe(true);
    expect(await reserveSubmission(id, submission)).toBe(false);
    await releaseSubmission(id);
    const a = (await getLandingApproach(id))!;
    expect(a).toMatchObject({ status: 'active', submittedAt: null, submission: null });
  });
});

describe('S22.2 — manifestation', () => {
  it('candidature ordinaire, décision du recruteur, profil soldé', async () => {
    vi.mocked(analyzeCVApplication).mockResolvedValueOnce({ application: analyzed, isCv: true } as never);
    const id = approaches.manifest!;
    expect(await reserveSubmission(id, submission)).toBe(true);
    const out = await admitSourcedCandidate((await getLandingApproach(id))!);
    expect(out).toMatchObject({ kind: 'admitted', analysisId: `can_src_${id}`, recruiterName: 'Jane S22' });

    const { data: analysis } = await db()
      .from('candidate_analyses')
      .select('id, uid, source, status, decision_zone, decided_by, decided_by_user_id, decided_by_user_email, candidate_email, total_score')
      .eq('id', `can_src_${id}`)
      .single();
    expect(analysis).toMatchObject({
      uid: `can_src_${id}`, source: 'sourcing', status: 'accepted', decision_zone: 'auto_accept', decided_by: 'user',
      decided_by_user_id: RECRUITER, decided_by_user_email: 'jane-s22@test.local', candidate_email: 'claire-s22@test.local', total_score: 41,
    });
    const a = (await getLandingApproach(id))!;
    expect(a).toMatchObject({ status: 'submitted', submission: null });
    const { data: raw } = await db().from('sourcing_approaches').select('analysis_id').eq('id', id).single();
    expect(raw!.analysis_id).toBe(`can_src_${id}`);
    const { data: prof } = await db().from('sourcing_profiles').select('id').eq('id', profiles.manifest!);
    expect(prof).toEqual([]);
    const { data: ex } = await db().from('sourcing_exclusions').select('reason').eq('fingerprint', FP.manifest).eq('campaign_id', camp);
    expect(ex).toEqual([{ reason: 'manifested' }]);
  });

  it('la candidature compte dans la campagne : CV reçu, shortlisté, au Bureau', async () => {
    const id = approaches.manifest!;
    const { data: rows } = await db().from('journal').select('action, campaign_id, payload, created_at').eq('campaign_id', camp).in('action', ['imap_cv_received', 'imap_cv_analyzed']);
    const mine = (rows ?? []).filter((r) => (r.payload as { uid?: string }).uid === `can_src_${id}`);
    expect(mine.map((r) => r.action).sort()).toEqual(['imap_cv_analyzed', 'imap_cv_received']);
    const { journalToCampaignMetric } = await import('@/lib/dashboard/derive-metrics');
    const metric = journalToCampaignMetric(
      mine.map((r, i): JournalEntry => ({ id: i, actor: 'sourcing', action: r.action as string, campaignId: r.campaign_id as string, payload: r.payload as Record<string, unknown>, createdAt: r.created_at as string })),
      camp,
    );
    expect(metric).toMatchObject({ candidates: 1, shortlisted: 1, avgScore: 41 });
  });
});

describe('S22.3 — panne d’analyse', () => {
  it('approche en attente, tentative comptée, aucune candidature', async () => {
    vi.mocked(analyzeCVApplication).mockRejectedValueOnce(new AnalysisUnavailableError('verdicts KO'));
    const id = approaches.failing!;
    expect(await reserveSubmission(id, submission)).toBe(true);
    expect((await admitSourcedCandidate((await getLandingApproach(id))!)).kind).toBe('deferred');
    const { data } = await db().from('sourcing_approaches').select('status, admission_attempts, admission_last_error, submission').eq('id', id).single();
    expect(data).toMatchObject({ status: 'admission_pending', admission_attempts: 1 });
    expect(data!.admission_last_error).toMatch(/AnalysisUnavailableError/);
    expect(data!.submission).not.toBeNull();
    const { data: none } = await db().from('candidate_analyses').select('id').eq('id', `can_src_${id}`);
    expect(none).toEqual([]);
  });

  it('reprise : deux passages concurrents sur la même lecture, un seul prend la tentative', async () => {
    const read = (await getLandingApproach(approaches.failing!))!;
    const [a, b] = await Promise.all([claimAdmissionAttempt(read), claimAdmissionAttempt(read)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await claimAdmissionAttempt((await getLandingApproach(approaches.failing!))!)).toBe(true);
  });
});

describe('S22.4 — opposition', () => {
  it('exclusion globale, profils supprimés partout, lien révoqué et vidé ; la candidature créée reste', async () => {
    const result = await recordOpposition(FP.opposed);
    expect(result.profilesDeleted).toBe(2);
    const { data: ex } = await db().from('sourcing_exclusions').select('reason, campaign_id').eq('fingerprint', FP.opposed).eq('reason', 'opposed');
    expect(ex).toEqual([{ reason: 'opposed', campaign_id: null }]);
    const { data: prof } = await db().from('sourcing_profiles').select('id').eq('fingerprint', FP.opposed);
    expect(prof).toEqual([]);
    const { data: a } = await db().from('sourcing_approaches').select('status, message, profile_id, purged_at').eq('id', approaches.opposed!).single();
    expect(a).toMatchObject({ status: 'revoked', message: null, profile_id: null });
    expect(a!.purged_at).not.toBeNull();

    // Une opposition sur l'empreinte d'une personne déjà manifestée ne touche pas à sa candidature.
    await recordOpposition(FP.manifest);
    const { data: submitted } = await db().from('sourcing_approaches').select('status, analysis_id').eq('id', approaches.manifest!).single();
    expect(submitted).toMatchObject({ status: 'submitted', analysis_id: `can_src_${approaches.manifest}` });
  });
});

describe('S22.5 — clôture', () => {
  it('le filet retrouve la campagne close ; la purge compte par état et garde les exclusions', async () => {
    await db().from('sourcing_exclusions').insert({ fingerprint: FP.closed, campaign_id: campClosed, reason: 'declined' });
    const leftover = await findCampaignWithLeftoverProfiles();
    expect(leftover).not.toBeNull();
    const purged = await purgeCampaignProfiles(campClosed);
    expect(purged).toEqual({ count: 1, byState: { reserve: 1, to_review: 0, contacted: 0 } });
    const { data: rest } = await db().from('sourcing_profiles').select('id').eq('campaign_id', campClosed);
    expect(rest).toEqual([]);
    const { data: ex } = await db().from('sourcing_exclusions').select('reason').eq('fingerprint', FP.closed);
    expect(ex).toEqual([{ reason: 'declined' }]);
  });
});
