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
 * 3. SYNTHÈSE PAR CAMPAGNE : webhook Cal.com RÉEL (HMAC signé) → brief livré
 *    au référent + adresses configurées (dédup casse), organizer/eventTypeId
 *    journalisés ; référent désactivé → repli agenda global.
 *
 * Identité : `getAuthServerClient` est mocké pour simuler la session (admin /
 * member / anonyme) — le gate RÉEL (requireAdminApiUser → recruiters.role en
 * base) et la résolution RÉELLE (campaigns.owner_user_id → recruiters) sont
 * exercés sur les routes réelles.
 */
import { createHmac, randomUUID } from 'node:crypto';

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
import { POST as calcomWebhook } from '@/app/api/webhooks/calcom/route';
import { invalidateEmailAddressesCache } from '@/lib/email/addresses';
import type { MailCandidate } from '@/types/mail-candidate';

import { call, callWithId, testCampaignPayload, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRows } from './helpers/db';
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
let previousSynthesisActive: unknown;
let previousSynthesisList: unknown;
let webhookSecretWasSet = true;

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
  // Adresses de synthèse CONFIGURÉES — avec un doublon du référent à casse
  // différente (test de dédup). INVARIANT du modèle : les adresses COCHÉES
  // sont filtrées contre la LISTE des adresses connues (resolveActiveSynthesis)
  // → poser les DEUX colonnes, sinon les cochées de test sont écartées et le
  // repli EMAIL_DRH s'applique. Restaurées en afterAll.
  const { data: settingsRow } = await db()
    .from('app_settings')
    .select('synthesis_emails, synthesis_emails_active')
    .eq('id', 1)
    .maybeSingle();
  previousSynthesisList = settingsRow?.synthesis_emails ?? null;
  previousSynthesisActive = settingsRow?.synthesis_emails_active ?? null;
  const testSynthesis = ['drh.s10@test.local', 'ADMIN.S10@test.local'];
  const updSynth = await db()
    .from('app_settings')
    .update({
      synthesis_emails: testSynthesis,
      synthesis_emails_active: testSynthesis,
    })
    .eq('id', 1);
  expect(updSynth.error).toBeNull();
  invalidateEmailAddressesCache();

  // Secret webhook : on signe avec la valeur de l'env (posée si absente).
  if (!process.env.CAL_COM_WEBHOOK_SECRET) {
    webhookSecretWasSet = false;
    process.env.CAL_COM_WEBHOOK_SECRET = 'treg-webhook-secret';
  }

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
    .update({
      interview_config: previousInterviewConfig,
      synthesis_emails: previousSynthesisList,
      synthesis_emails_active: previousSynthesisActive,
    })
    .eq('id', 1);
  invalidateEmailAddressesCache();
  if (!webhookSecretWasSet) delete process.env.CAL_COM_WEBHOOK_SECRET;
  // Idempotence webhook : lignes de test non couvertes par cleanAll.
  await db().from('calcom_webhook_events').delete().like('booking_uid', 'bk_treg_%');
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

describe('S10 — synthèse par campagne (webhook Cal.com réel)', () => {
  it('brief livré au RÉFÉRENT + adresses configurées, dédup — organizer journalisé', async () => {
    resetSentEmails();
    // Brief en attente pour la campagne du référent (cas nominal du webhook).
    const briefUid = `treg_s10w_${Date.now().toString(36)}`;
    const ins = await db().from('interview_briefs').insert({
      campaign_id: campOwned,
      candidate_email: CANDIDATE.email,
      candidate_name: CANDIDATE.candidateName,
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [{ theme: 'Parcours', question: 'Racontez-nous.' }],
      candidate_snapshot: CANDIDATE,
      uid: briefUid,
    });
    expect(ins.error).toBeNull();

    // BOOKING_CREATED signé HMAC (corps BRUT) — la vraie porte d'entrée.
    const bookingUid = `bk_treg_${Date.now().toString(36)}`;
    const rawBody = JSON.stringify({
      triggerEvent: 'BOOKING_CREATED',
      createdAt: new Date().toISOString(),
      payload: {
        uid: bookingUid,
        attendees: [{ email: CANDIDATE.email, name: CANDIDATE.candidateName }],
        startTime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        endTime: new Date(Date.now() + 3 * 86_400_000 + 1_800_000).toISOString(),
        organizer: { email: 'orga.s10@test.local', username: 'orga-treg' },
        eventTypeId: 4242,
      },
    });
    const signature = createHmac('sha256', process.env.CAL_COM_WEBHOOK_SECRET!)
      .update(rawBody, 'utf8')
      .digest('hex');
    const res = await calcomWebhook(
      new Request('http://regression.test/api/webhooks/calcom', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cal-signature-256': signature,
        },
        body: rawBody,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('delivered');

    // Destinataires : référent EN TÊTE + configurées, doublon à casse
    // différente (ADMIN.S10@…) DÉDUPLIQUÉ — jamais de double envoi.
    const brief = sentEmails.find(
      (m) => Array.isArray(m.to) && m.to.includes('admin.s10@test.local'),
    );
    expect(brief).toBeDefined();
    expect(brief!.to).toEqual(['admin.s10@test.local', 'drh.s10@test.local']);

    // Traçabilité multi-agendas : QUEL agenda a produit le RDV.
    const entries = await readRows<{
      action: string;
      payload: { bookingUid?: string; organizerEmail?: string; eventTypeId?: number };
    }>('journal', { action: 'interview_brief_delivered' });
    const entry = entries.find((e) => e.payload.bookingUid === bookingUid);
    expect(entry).toBeDefined();
    expect(entry!.payload.organizerEmail).toBe('orga.s10@test.local');
    expect(entry!.payload.eventTypeId).toBe(4242);
  });

  it('référent DÉSACTIVÉ → repli agenda GLOBAL (jamais l’agenda d’un parti)', async () => {
    const off = await db()
      .from('recruiters')
      .update({ is_active: false })
      .eq('id', ADMIN_ID);
    expect(off.error).toBeNull();
    try {
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
      const html = String(res.json.html);
      expect(html).toContain(GLOBAL_LINK);
      expect(html).not.toContain(PERSONAL_LINK);
    } finally {
      const on = await db()
        .from('recruiters')
        .update({ is_active: true })
        .eq('id', ADMIN_ID);
      expect(on.error).toBeNull();
    }
  });
});
