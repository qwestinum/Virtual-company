/**
 * S24 — Soumission sourcing ASYNCHRONE (diagnostic de latence du 14/09/2026),
 * par la route réelle et le rail réel, sur la base réelle.
 *
 * Avant : la route de soumission exécutait l'admission COMPLÈTE (analyse, CV
 * structuré, invitation) pendant que la personne attendait derrière son clic.
 * Désormais la route RÉSERVE et répond ; le rail de reprise admet au passage
 * suivant. Trois garanties tenues ici :
 *   1. la réponse dit « bien reçue » SANS avoir porté le travail d'admission ;
 *   2. la candidature est créée au TICK SUIVANT du rail, pas avant ;
 *   3. UN seul mail, même si le rail repasse.
 *
 * ⚠️ La garantie 1 se mesure PAR COMPARAISON avec le travail d'admission
 * mesuré au test suivant, pas contre une horloge fixe : la route fait deux ou
 * trois allers-retours vers une base DISTANTE, et un seuil en millisecondes y
 * mesure surtout le réseau. Observé le 23/09/2026 : 583 ms pendant qu'une
 * autre suite tapait la même base — aucun défaut, un seuil rouge quand même.
 * Le plafond absolu reste, large : une admission redevenue synchrone coûte des
 * SECONDES (analyse, CV structuré, PDF, mail), elle ne passera jamais dessous.
 *
 * Frontières simulées (setup) : modèle, embeddings, email. Flag du module forcé.
 * ⚠️ Application FERMÉE : le tick du scheduler d'un `next dev` jouerait le rail
 * à la place du test.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourcing/flag', () => ({ isSourcingEnabled: async () => true, isSourcingDeploymentEnabled: () => true }));

import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getSettings, PUT as putSettings } from '@/app/api/settings/route';
import { POST as submit } from '@/app/api/sourcing/approach/[token]/submit/route';
import { mintApproachToken } from '@/lib/sourcing/approach-token';
import { runSourcingMaintenance } from '@/lib/sourcing/server/maintenance';

import { call, testCampaignPayload } from './helpers/api';
import { cleanAll, db, newTestCampaignId } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const camp = newTestCampaignId('s24');
const RECRUITER = randomUUID();
const FP = (randomUUID() + randomUUID()).replace(/-/g, '').slice(0, 64);
const EMAIL = 'nina-s24@test.local';
let approachId = '';
let token = '';
let profileId = '';
let savedInterviewConfig: Record<string, unknown> | null = null;

function submission(): FormData {
  const form = new FormData();
  form.append(
    'submission',
    JSON.stringify({
      email: EMAIL, phone: '06 12 34 56 78', consent: true, fullName: 'Nina S24', location: 'Paris, France',
      about: 'PROFIL_FAIBLE_TREG — parcours AMOA.', skills: 'UML, SQL', languages: 'Anglais', certifications: null,
      workHistory: [{ title: 'Business Analyst', company: 'Banque TREG', from: '2023-05-01', to: null, description: 'Recette.' }],
      education: [{ degree: 'Master SI', institution: 'Université TREG', from: '2014', to: '2016' }],
    }),
  );
  return form;
}

async function cleanOwn(): Promise<void> {
  const { data: arts } = await db().from('artifacts_meta').select('storage_path').like('id', 'art_src_%').eq('campaign_id', camp);
  const paths = (arts ?? []).map((a) => a.storage_path as string | null).filter((p): p is string => Boolean(p));
  if (paths.length > 0) await db().storage.from('artifacts').remove(paths);
  await db().from('sourcing_exclusions').delete().eq('fingerprint', FP);
  await db().from('recruiters').delete().eq('id', RECRUITER);
  if (approachId) await db().from('imap_outreach_claims').delete().eq('mailbox_id', 'sourcing').eq('uid', approachId);
  await db().from('interview_briefs').delete().like('uid', 'can_src_%').eq('campaign_id', camp);
  await cleanAll();
}

beforeAll(async () => {
  await cleanOwn();
  resetSentEmails();
  const settings = await call(getSettings);
  savedInterviewConfig = (settings.json.settings as { interviewConfig?: Record<string, unknown> })?.interviewConfig ?? null;
  if (savedInterviewConfig) {
    const put = await call(putSettings, { method: 'PUT', body: { interviewConfig: { ...savedInterviewConfig, agendaLink: 'https://agenda.test.local/treg-s24' } } });
    expect(put.status).toBe(200);
  }
  const res = await call(putCampaign, { method: 'PUT', body: testCampaignPayload({ id: camp, status: 'active', thresholdLow: 50, thresholdHigh: 80 }) });
  expect(res.status).toBe(200);
  const r = await db().from('recruiters').insert({ id: RECRUITER, display_name: 'Jane S24', email: 'jane-s24@test.local' });
  if (r.error) throw new Error(r.error.message);

  const s = await db()
    .from('sourcing_searches')
    .insert({ campaign_id: camp, query: 'q', query_generated: 'q', query_method: 'llm', language: 'fr', requested: 100, returned: 1, new_after_dedup: 1 })
    .select('id')
    .single();
  if (s.error) throw new Error(s.error.message);
  const p = await db()
    .from('sourcing_profiles')
    .insert({
      campaign_id: camp, search_id: s.data.id, fingerprint: FP, exa_rank: 1, state: 'contacted',
      decided_at: new Date().toISOString(), decided_by_user_id: RECRUITER,
      exa_snapshot: {
        url: 'https://www.linkedin.com/in/nina-s24', name: 'Nina', firstName: 'Nina', location: 'Paris',
        headline: 'Business Analyst', current: { title: 'Business Analyst', company: 'Banque TREG', since: '2023-05-01' },
        workHistory: [], education: [], about: 'PROFIL_FAIBLE_TREG', skills: 'UML', languages: null,
        certifications: null, highlight: null, indexedAt: '2026-08-01T00:00:00Z', contacts: { emails: [EMAIL] }, availability: null,
      },
    })
    .select('id')
    .single();
  if (p.error) throw new Error(p.error.message);
  profileId = p.data.id as string;
  await db().from('sourcing_exclusions').insert({ fingerprint: FP, campaign_id: camp, reason: 'contacted' });

  const minted = mintApproachToken();
  const a = await db()
    .from('sourcing_approaches')
    .insert({ campaign_id: camp, profile_id: profileId, fingerprint: FP, recruiter_id: RECRUITER, channel: 'linkedin', message_format: 'inmail', message: 'Bonjour : [lien] — Jane', token_hash: minted.tokenHash, status: 'active' })
    .select('id')
    .single();
  if (a.error) throw new Error(a.error.message);
  approachId = a.data.id as string;
  token = minted.token;
});

afterAll(async () => {
  if (savedInterviewConfig) await call(putSettings, { method: 'PUT', body: { interviewConfig: savedInterviewConfig } });
  await cleanOwn();
});

const analysisId = () => `can_src_${approachId}`;
/** Durée de la réponse de soumission, comparée au travail d'admission (S24.2). */
let submitMs = 0;
const mailsToCandidate = () => sentEmails.filter((m) => [m.to].flat().includes(EMAIL));

describe('S24 — soumission asynchrone', () => {
  it('S24.1 la réponse dit « bien reçue » et rien n’est encore admis', async () => {
    resetSentEmails();
    const request = new Request(`http://regression.test/api/sourcing/approach/${token}/submit`, {
      method: 'POST',
      headers: { 'x-forwarded-for': `10.24.${Math.floor(Math.random() * 250)}.9` },
      body: submission(),
    });
    const started = performance.now();
    const res = await submit(request, { params: Promise.resolve({ token }) });
    submitMs = performance.now() - started;

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: 'received', firstName: 'Nina' });
    // Plafond ABSOLU, large : il n'attrape qu'une admission redevenue
    // synchrone. La preuve fine est la comparaison faite en S24.2.
    expect(submitMs, `réponse ${Math.round(submitMs)} ms`).toBeLessThan(3_000);

    // Réservation + saisie durablement en base ; aucune candidature, aucun mail.
    const { data: appr } = await db().from('sourcing_approaches').select('status, submission').eq('id', approachId).single();
    expect(appr!.status).toBe('admission_pending');
    expect(appr!.submission).not.toBeNull();
    expect((await db().from('candidate_analyses').select('id').eq('id', analysisId())).data).toEqual([]);
    expect(mailsToCandidate()).toHaveLength(0);
  });

  it('S24.2 au tick suivant du rail : la candidature est créée et UNE invitation part', async () => {
    const started = performance.now();
    const outcome = await runSourcingMaintenance();
    const admissionMs = performance.now() - started;
    expect(outcome.admitted).toBe(1);

    // LE point du lot : ce travail-là n'était PAS dans la réponse. Mesuré dans
    // le même run, sur le même réseau — donc insensible à la latence du jour.
    expect(
      submitMs,
      `réponse ${Math.round(submitMs)} ms · admission ${Math.round(admissionMs)} ms`,
    ).toBeLessThan(admissionMs);

    const { data: analysis } = await db()
      .from('candidate_analyses')
      .select('source, decision_zone, decided_by, candidate_email')
      .eq('id', analysisId())
      .single();
    expect(analysis).toMatchObject({ source: 'sourcing', decision_zone: 'auto_accept', decided_by: 'user', candidate_email: EMAIL });
    expect(mailsToCandidate()).toHaveLength(1);
    const { data: appr } = await db().from('sourcing_approaches').select('status, analysis_id').eq('id', approachId).single();
    expect(appr).toMatchObject({ status: 'submitted', analysis_id: analysisId() });
  });

  it('S24.3 le rail repasse : rien de plus — un seul mail, une seule candidature', async () => {
    const again = await runSourcingMaintenance();
    expect(again.admitted).toBe(0);
    expect(mailsToCandidate()).toHaveLength(1);
    const { data } = await db().from('candidate_analyses').select('id').eq('campaign_id', camp);
    expect(data).toHaveLength(1);
  });
});
