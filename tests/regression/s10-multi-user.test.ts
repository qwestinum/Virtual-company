/**
 * S10 — Multi-utilisateur : résolution d'agenda par recruteur + gate admin.
 *
 * 1. RÉSOLUTION D'AGENDA : campagne avec référent → le lien Cal.com PERSONNEL
 *    du référent part dans le mail d'invitation — vérifié dans le PREVIEW
 *    HITL (le point de vérité : l'override envoie le HTML du preview tel
 *    quel) ET dans l'envoi direct ; campagne sans référent → FALLBACK global.
 * 2. GATE ADMIN : member → 403 sur les routes techniques, admin → 200 ;
 *    /api/metrics/global SCINDÉ (member : agents vidés + coût 0, métier
 *    intact) ; le métier reste accessible au member.
 *
 * Identité : `getAuthServerClient` est mocké pour simuler la session (admin /
 * member / anonyme) — le gate RÉEL (requireAdminApiUser → recruiters.role en
 * base) et la résolution RÉELLE (campaigns.owner_user_id → recruiters) sont
 * exercés sur les routes réelles.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

vi.mock('@/lib/auth/supabase-server', () => ({
  getAuthServerClient: async () =>
    authState.user === null
      ? null
      : {
          auth: {
            getUser: async () => ({ data: { user: authState.user } }),
          },
        },
}));

import { _resetRoleCacheForTests } from '@/lib/auth/require-api-user';
import { POST as composeMail } from '@/app/api/mail-composer/route';
import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getCounters } from '@/app/api/candidatures/counters/route';
import { GET as getCampaignMetrics } from '@/app/api/metrics/campaigns/[id]/route';
import { GET as getGlobalMetrics } from '@/app/api/metrics/global/route';
import { GET as getAvailableAccounts } from '@/app/api/recruiters/available-accounts/route';
import { GET as getRecruitersList } from '@/app/api/recruiters/route';
import { GET as getRecruiterOptions } from '@/app/api/recruiters/options/route';
import type { MailCandidate } from '@/types/mail-candidate';

import { call, callWithId, testCampaignPayload, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, db, newTestCampaignId } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const campOwned = newTestCampaignId('s10o');
const campGlobal = newTestCampaignId('s10g');

const ADMIN_ID = randomUUID();
const MEMBER_ID = randomUUID();
const PERSONAL_LINK = 'https://cal.com/jane-treg/entretien';
const GLOBAL_LINK = 'https://cal.com/global-treg/entretien';

const CANDIDATE: MailCandidate = {
  candidateName: 'Alice Treg',
  email: 'alice.s10@test.local',
  phone: null,
  score: 88,
  aboveThreshold: true,
  summary: 'Profil test.',
  strengths: ['Tests'],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

function actAs(user: 'admin' | 'member' | 'anonymous'): void {
  authState.user =
    user === 'admin'
      ? { id: ADMIN_ID, email: 'admin.s10@test.local' }
      : user === 'member'
        ? { id: MEMBER_ID, email: 'member.s10@test.local' }
        : null;
  _resetRoleCacheForTests();
}

let previousInterviewConfig: unknown;

async function cleanRecruiters(): Promise<void> {
  const { error } = await db()
    .from('recruiters')
    .delete()
    .like('email', '%@test.local');
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(`clean recruiters: ${error.message}`);
  }
}

beforeAll(async () => {
  await cleanAll();
  await cleanRecruiters();
  resetSentEmails();

  // Lien GLOBAL posé en settings (restauré en afterAll).
  const { data } = await db()
    .from('app_settings')
    .select('interview_config')
    .eq('id', 1)
    .maybeSingle();
  previousInterviewConfig = data?.interview_config ?? null;
  const nextConfig = {
    ...((previousInterviewConfig as Record<string, unknown>) ?? {}),
    agendaLink: GLOBAL_LINK,
  };
  const upd = await db()
    .from('app_settings')
    .update({ interview_config: nextConfig })
    .eq('id', 1);
  expect(upd.error).toBeNull();

  // Référentiel : un admin (référent, avec lien perso) + un member (sans).
  const ins = await db().from('recruiters').insert([
    {
      id: ADMIN_ID,
      display_name: 'Jane Admin',
      email: 'admin.s10@test.local',
      calcom_link: PERSONAL_LINK,
      role: 'admin',
    },
    {
      id: MEMBER_ID,
      display_name: 'Marc Member',
      email: 'member.s10@test.local',
      role: 'member',
    },
  ]);
  expect(ins.error).toBeNull();

  actAs('admin');
  const owned = await call(putCampaign, {
    method: 'PUT',
    body: { ...testCampaignPayload({ id: campOwned, status: 'active' }), ownerUserId: ADMIN_ID },
  });
  expect(owned.status).toBe(200);
  const global = await call(putCampaign, {
    method: 'PUT',
    body: testCampaignPayload({ id: campGlobal, status: 'active' }),
  });
  expect(global.status).toBe(200);
});

afterAll(async () => {
  await db()
    .from('app_settings')
    .update({ interview_config: previousInterviewConfig })
    .eq('id', 1);
  await cleanRecruiters();
  await cleanAll();
  actAs('anonymous');
});

describe('S10 — résolution d’agenda par recruteur', () => {
  it('PREVIEW HITL (point de vérité) : campagne avec référent → SON lien, pas le global', async () => {
    actAs('member'); // la résolution ne dépend pas du rôle de l'appelant
    const res = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId: campOwned,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: CANDIDATE,
        preview: true,
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('preview');
    const html = String(res.json.html);
    expect(html).toContain(PERSONAL_LINK);
    expect(html).not.toContain(GLOBAL_LINK);
  });

  it('campagne SANS référent → fallback global explicite', async () => {
    const res = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId: campGlobal,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: CANDIDATE,
        preview: true,
      },
    });
    expect(res.status).toBe(200);
    expect(String(res.json.html)).toContain(GLOBAL_LINK);
  });

  it('envoi RÉEL (chemin direct) : le mail parti porte le lien du référent', async () => {
    resetSentEmails();
    const res = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: `art_treg_s10_${Date.now().toString(36)}`,
        campaignId: campOwned,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: CANDIDATE,
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('sent');
    const mail = sentEmails.find((m) => m.to === CANDIDATE.email);
    expect(mail).toBeDefined();
    expect(mail!.html).toContain(PERSONAL_LINK);
    expect(mail!.html).not.toContain(GLOBAL_LINK);
    // replyTo par campagne : le RÉFÉRENT (pas la liste globale ni EMAIL_DRH).
    expect(mail!.replyTo).toBe('admin.s10@test.local');
  });
});

describe('S10 — gate admin', () => {
  it('route technique : anonyme → 401, member → 403, admin → 200', async () => {
    actAs('anonymous');
    expect((await callWithId(getCampaignMetrics, campOwned, { method: 'GET' })).status).toBe(401);
    actAs('member');
    expect((await callWithId(getCampaignMetrics, campOwned, { method: 'GET' })).status).toBe(403);
    actAs('admin');
    expect((await callWithId(getCampaignMetrics, campOwned, { method: 'GET' })).status).toBe(200);
  });

  it('gestion des recruteurs : member → 403, admin → 200 ; options accessibles au member', async () => {
    actAs('member');
    expect((await call(getRecruitersList)).status).toBe(403);
    const options = await call(getRecruiterOptions);
    expect(options.status).toBe(200);
    const opts = options.json.options as Array<{ id: string; hasCalcomLink: boolean }>;
    expect(opts.some((o) => o.id === ADMIN_ID && o.hasCalcomLink)).toBe(true);
    // Projection minimale : jamais d'email ni de rôle côté member.
    expect(JSON.stringify(options.json)).not.toContain('admin.s10@test.local');
    actAs('admin');
    expect((await call(getRecruitersList)).status).toBe(200);
  });

  it('comptes Auth disponibles (sélecteur d’ajout) : member → 403, admin → 200 sans les référencés', async () => {
    actAs('member');
    expect((await call(getAvailableAccounts)).status).toBe(403);
    actAs('admin');
    const res = await call(getAvailableAccounts);
    expect(res.status).toBe(200);
    const accounts = res.json.accounts as Array<{ id: string }>;
    // Les recruteurs déjà référencés (nos deux lignes de test) n'y figurent pas.
    expect(accounts.some((a) => a.id === ADMIN_ID || a.id === MEMBER_ID)).toBe(false);
  });

  it('/api/metrics/global SCINDÉ : member = métier intact mais agents vidés + coût 0', async () => {
    actAs('member');
    const asMember = await call(getGlobalMetrics);
    expect(asMember.status).toBe(200);
    expect((asMember.json.agents as unknown[]).length).toBe(0);
    expect((asMember.json.kpis as { costEstimate: number }).costEstimate).toBe(0);
    expect(asMember.json.zones).toBeDefined(); // le récit Bureau reste servi

    actAs('admin');
    const asAdmin = await call(getGlobalMetrics);
    expect(asAdmin.status).toBe(200);
    expect((asAdmin.json.agents as unknown[]).length).toBeGreaterThan(0);
  });

  it('le MÉTIER reste accessible au member (aucun cloisonnement de données)', async () => {
    actAs('member');
    const res = await call(getCounters, { query: `campaignId=${campOwned}` });
    expect(res.status).toBe(200);
  });
});
