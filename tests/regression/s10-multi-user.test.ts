/**
 * S10 — Résolution d'agenda : LES DEUX RÉGIMES + gate admin.
 *
 * Depuis le lot 3, ce scénario porte la preuve de COEXISTENCE : la même
 * campagne, le même preview, le même envoi — mais un lien Cal.com quand le
 * flag est à `false`, un lien de réservation natif quand il est à `true`. Les
 * tests du régime historique (§1, §3) n'ont pas été retouchés : c'est
 * précisément ce qui prouve que le chemin legacy n'a pas bougé.
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
 * §4 (lot 3) : régime NATIF — garde d'activation du flag, lien nominatif dans
 * le preview HITL, idempotence du preview, réservation publique → briefing
 * livré, refus ⇒ lien révoqué.
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

// Le setup global fige `getApiUser` à `null` (suite historiquement mono-
// utilisateur). Ce scénario, LUI, teste des routes qui autorisent « soi-même
// ou administrateur » : on rebranche l'export sur la session simulée.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/require-api-user')
  >('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => authState.user };
});

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
import { PATCH as patchCampaign } from '@/app/api/campaigns/[id]/route';
import { PUT as putAvailability } from '@/app/api/recruiters/[id]/availability/route';
import { POST as sendValidation } from '@/app/api/validations/[id]/send/route';
import { POST as bookRoute } from '@/app/api/sched/links/[token]/book/route';
import { GET as campaignScheduling } from '@/app/api/campaigns/[id]/scheduling/route';
import { POST as dismissCandidature } from '@/app/api/candidatures/[id]/dismiss/route';
import { POST as reopenCandidature } from '@/app/api/candidatures/[id]/reopen/route';
import { POST as reissueLink } from '@/app/api/interviews/reissue/route';
import { loadInterviewPipeline } from '@/lib/interviews/pipeline';
import { computeBusinessSignals } from '@/lib/notifications/business-signals';
import { POST as postJournal } from '@/app/api/journal/route';
import {
  cancelBookingByAttendee,
  confirmBooking,
  listSlotsForLink,
  resolveBookingPage,
} from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import { drainSchedulingEvents } from '@/lib/scheduling-host/drain';
import { invalidateEmailAddressesCache } from '@/lib/email/addresses';
import type { MailCandidate } from '@/types/mail-candidate';

import { call, callWithId, testCampaignPayload, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, db, newTestCampaignId, readRow, readRows } from './helpers/db';
import { resetSentEmails, sentEmails } from './helpers/mocks';

const campOwned = newTestCampaignId('s10o');
const campGlobal = newTestCampaignId('s10g');
/** Campagne du régime NATIF (lot 3) — bascule pilotée dans §4. */
const campNative = newTestCampaignId('s10n');

/** Candidature du régime natif : uid brut + identifiant d'analyse distincts. */
const NATIVE_UID = `treg_s10n_${Date.now().toString(36)}`;
const NATIVE_ANALYSIS = `can_imap_box-s10_${NATIVE_UID}`;
let nativeToken = '';

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

const NATIVE_CANDIDATE: MailCandidate = {
  candidateName: 'Nadia Treg',
  email: 'nadia.s10n@test.local',
  phone: null,
  score: 91,
  aboveThreshold: true,
  summary: 'Profil natif.',
  strengths: ['Tests'],
  weaknesses: [],
  justification: 'Au-dessus du seuil.',
};

/**
 * Analyse persistée minimale mais COMPLÈTE : la projection vers le message
 * candidat lit `scoringResult` et `narration`, pas seulement le candidat. Une
 * fixture tronquée fait échouer la route en 500 sans rien dire du produit.
 */
function testApplication(email: string, score: number) {
  return {
    candidate: {
      fullName: 'Candidat Treg',
      email,
      phone: null,
      fileName: 'cv.pdf',
      source: 'email',
      receivedAt: new Date().toISOString(),
    },
    scoringResult: {
      totalScore: score,
      status: 'accepted',
      decisionZone: 'auto_accept',
      breakdown: [],
      criteriaVersion: 'treg-s10n',
      computedAt: new Date().toISOString(),
    },
    narration: {
      summary: 'Profil solide, expérience alignée.',
      strengths: ['Tests'],
      weaknesses: [],
      justification: 'Au-dessus du seuil haut.',
    },
  };
}

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
  // `ownerUserId: null` EXPLICITE : depuis le lot 3, une campagne créée sans
  // rien dire hérite de son créateur comme référent. Ce scénario-ci teste le
  // repli « aucun référent », il doit donc le demander.
  const global = await call(putCampaign, {
    method: 'PUT',
    body: { ...testCampaignPayload({ id: campGlobal, status: 'active' }), ownerUserId: null },
  });
  expect(global.status).toBe(200);
  // Campagne du régime natif — créée en régime HISTORIQUE : c'est le PATCH
  // de §4 qui la bascule, jamais le snapshot.
  const nativeCampaign = await call(putCampaign, {
    method: 'PUT',
    body: {
      ...testCampaignPayload({ id: campNative, status: 'active' }),
      ownerUserId: MEMBER_ID,
    },
  });
  expect(nativeCampaign.status).toBe(200);
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
  // Traces du régime natif : cible de campagne (les liens, réservations et
  // événements partent en cascade) + claims de livraison + validation de test.
  await db().from('interview_booking_events').delete().like('event_type', 'booking.%');
  await db().from('sched_targets').delete().eq('external_ref', campNative);
  // LES DEUX référents : le member reçoit des disponibilités au test de
  // re-pointage, et sa ressource survivait au nettoyage (quatre « Marc
  // Member » orphelins retrouvés sur dev le 17/08). L'identifiant est un UUID
  // régénéré à chaque run : personne ne les aurait rattachés à quoi que ce soit.
  await db()
    .from('sched_resources')
    .delete()
    .in('external_ref', [ADMIN_ID, MEMBER_ID]);
  await db().from('pending_validations').delete().like('id', 'val_treg_s10_%');
  await db().from('interview_briefs').delete().eq('uid', NATIVE_UID);
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

// ════════════════════════════════════════════════════════════════════════
// S10.4 — RÉGIME NATIF (lot 3). Même campagne, même écran, autre régime.
// ════════════════════════════════════════════════════════════════════════

describe('S10.4 — réservation native', () => {
  /** Extrait le jeton d'un lien `/r/<token>` présent dans un HTML. */
  function tokenIn(html: string): string | null {
    return /\/r\/([A-Za-z0-9_-]{20,})/.exec(html)?.[1] ?? null;
  }

  async function previewFor(campaignId: string, analysisId: string) {
    return call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: NATIVE_CANDIDATE,
        uid: NATIVE_UID,
        analysisId,
        preview: true,
      },
    });
  }

  it('GARDE : le flag refuse de s’activer sans référent aux disponibilités configurées', async () => {
    actAs('admin');
    // Le member est référent, mais n'a AUCUNE disponibilité déclarée.
    const withoutAvail = await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: { ownerUserId: MEMBER_ID, schedulingNative: true },
    });
    expect(withoutAvail.status).toBe(409);
    expect(withoutAvail.json.error).toBe('owner_not_bookable');

    // La campagne n'a PAS basculé : le régime historique reste en place.
    const row = await readRow<{ scheduling_native: boolean | null }>(
      'campaigns',
      campNative,
    );
    expect(row.scheduling_native ?? false).toBe(false);
  });

  it('accepte la bascule dès que le référent a des disponibilités', async () => {
    actAs('admin');
    const avail = await callWithId(putAvailability, ADMIN_ID, {
      method: 'PUT',
      body: {
        timezone: 'Europe/Paris',
        slotDurationMinutes: 30,
        bufferMinutes: 0,
        minNoticeMinutes: 0,
        horizonDays: 30,
        meetingLocation: {
          type: 'phone',
          payload: { instructions: 'Nous vous appelons.' },
        },
        // Toute la semaine ouverte : le test ne doit pas dépendre du jour où
        // il tourne.
        rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      },
    });
    expect(avail.status).toBe(200);

    const on = await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: { ownerUserId: ADMIN_ID, schedulingNative: true },
    });
    expect(on.status).toBe(200);
    expect((on.json.campaign as { schedulingNative: boolean }).schedulingNative).toBe(
      true,
    );
  });

  it('LIEU SEUL : un corps qui ne porte que le lieu enregistre, et le dit', async () => {
    // Défaut constaté à l'usage : le lieu était retiré du patch de ligne, le
    // patch devenait vide, `patchCampaign` rendait `null` — lu comme
    // « campagne absente » — et la route répondait 404 sans rien écrire.
    // « Le lieu de la campagne n'a pas pu être enregistré », à chaque fois.
    const res = await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: {
        meetingLocationOverride: {
          type: 'in_person',
          payload: { address: '12 rue du Test, Paris' },
        },
      },
    });
    expect(res.status).toBe(200);
    // Le serveur AFFIRME l'écriture : un 200 muet laisserait l'écran annoncer
    // un enregistrement qui n'a pas eu lieu.
    expect(res.json.meetingLocationSaved).toBe(true);

    const [target] = await readRows<{
      meeting_location_override: { type: string; payload: { address: string } } | null;
    }>('sched_targets', { external_ref: campNative });
    expect(target?.meeting_location_override).toEqual({
      type: 'in_person',
      payload: { address: '12 rue du Test, Paris' },
    });

    // Et on sait le retirer (retour au lieu du référent).
    const cleared = await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: { meetingLocationOverride: null },
    });
    expect(cleared.status).toBe(200);
    const [after] = await readRows<{ meeting_location_override: unknown }>(
      'sched_targets',
      { external_ref: campNative },
    );
    expect(after?.meeting_location_override).toBeNull();
  });

  it('PREVIEW HITL : lien natif nominatif, et RE-preview = MÊME jeton', async () => {
    const first = await previewFor(campNative, NATIVE_ANALYSIS);
    expect(first.status).toBe(200);
    const html1 = String(first.json.html);
    // Ni le lien du référent, ni le lien global : le régime a basculé.
    expect(html1).not.toContain(PERSONAL_LINK);
    expect(html1).not.toContain(GLOBAL_LINK);
    const token = tokenIn(html1);
    expect(token).toBeTruthy();

    // Idempotence : c'est ce qui garantit que le DRH relit le VRAI lien.
    const second = await previewFor(campNative, NATIVE_ANALYSIS);
    expect(tokenIn(String(second.json.html))).toBe(token);

    nativeToken = token!;
  });

  it('le contexte du lien porte l’identité de la candidature (uid + analyse)', async () => {
    const [link] = await readRows<{ context: Record<string, unknown> }>(
      'sched_booking_links',
      { token: nativeToken },
    );
    expect(link?.context).toMatchObject({
      uid: NATIVE_UID,
      analysisId: NATIVE_ANALYSIS,
      campaignId: campNative,
    });
  });

  it('le sélecteur de référent SIGNALE qui n’a pas de disponibilités', async () => {
    // Ce que lit le dialog d'impact avant un changement de référent : sans
    // cette annotation, on désigne un référent sans créneaux et on ne
    // l'apprend qu'après coup, par le panneau des cibles orphelines.
    const res = await call(getRecruiterOptions);
    expect(res.status).toBe(200);
    const opts = res.json.options as {
      id: string;
      hasAvailability: boolean | null;
    }[];
    expect(opts.find((o) => o.id === ADMIN_ID)?.hasAvailability).toBe(true);
    expect(opts.find((o) => o.id === MEMBER_ID)?.hasAvailability).toBe(false);
  });

  it('RÉSERVATION publique → drain → briefing livré aux adresses de synthèse', async () => {
    // Un briefing attend, rattaché à CETTE candidature par son uid.
    const ins = await db().from('interview_briefs').insert({
      campaign_id: campNative,
      candidate_email: NATIVE_CANDIDATE.email,
      candidate_name: NATIVE_CANDIDATE.candidateName,
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [{ theme: 'Parcours', question: 'Racontez-nous.' }],
      candidate_snapshot: NATIVE_CANDIDATE,
      uid: NATIVE_UID,
    });
    expect(ins.error).toBeNull();

    await ensureSchedulingConfigured();
    const from = new Date(Date.now() + 60_000).toISOString();
    const to = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const slots = await listSlotsForLink(nativeToken, { from, to });
    expect(slots.length).toBeGreaterThan(0);

    resetSentEmails();
    const booked = await bookRoute(
      new Request(`https://treg.test/api/sched/links/${nativeToken}/book`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.2.0.7' },
        body: JSON.stringify({
          startAt: slots[0]!.startAt,
          attendee: {
            name: NATIVE_CANDIDATE.candidateName,
            email: NATIVE_CANDIDATE.email,
            timezone: 'Europe/Paris',
          },
        }),
      }),
      { params: Promise.resolve({ token: nativeToken }) },
    );
    expect(booked.status).toBe(200);

    // Le candidat n'attend PAS la livraison du briefing : c'est le drain qui
    // la fait (le consommateur n'est pas branché sur les surfaces publiques).
    const drained = await drainSchedulingEvents();
    expect(drained.dispatched).toBeGreaterThan(0);

    const brief = sentEmails.find(
      (m) => Array.isArray(m.to) && m.to.includes('admin.s10@test.local'),
    );
    expect(brief).toBeDefined();

    const [briefRow] = await readRows<{ status: string; booking_uid: string | null }>(
      'interview_briefs',
      { uid: NATIVE_UID },
    );
    expect(briefRow?.status).toBe('scheduled');
    expect(briefRow?.booking_uid).toBeTruthy();
  });

  it('REJEU d’événement : le drain ne délivre pas un second briefing', async () => {
    resetSentEmails();
    // On remet en file les événements de CE rendez-vous : le claim par
    // `event.id` doit les absorber.
    const [booking] = await readRows<{ id: string }>('sched_bookings', {
      link_token: nativeToken,
    });
    expect(booking).toBeDefined();
    const upd = await db()
      .from('sched_events')
      .update({ dispatched_at: null })
      .eq('booking_id', booking!.id);
    expect(upd.error).toBeNull();

    await drainSchedulingEvents();
    expect(sentEmails).toEqual([]);
  });

  it('le lien est CONSOMMÉ : la page ne propose plus rien', async () => {
    await ensureSchedulingConfigured();
    const state = await resolveBookingPage(nativeToken);
    expect(state.status).toBe('gone');
  });

  it('REFUS tranché ⇒ le lien de la candidature est révoqué', async () => {
    const analysisId = `${NATIVE_ANALYSIS}-refuse`;
    const preview = await previewFor(campNative, analysisId);
    const token = tokenIn(String(preview.json.html));
    expect(token).toBeTruthy();

    const validationId = `val_treg_s10_${Date.now().toString(36)}`;
    const insVal = await db().from('pending_validations').insert({
      id: validationId,
      campaign_id: campNative,
      candidate_name: NATIVE_CANDIDATE.candidateName,
      candidate_email: NATIVE_CANDIDATE.email,
      score: NATIVE_CANDIDATE.score,
      decision: 'reject',
      status: 'pending',
      confirmed: false,
      payload: { uid: NATIVE_UID, analysisId, candidate: NATIVE_CANDIDATE },
    });
    expect(insVal.error).toBeNull();

    const sent = await callWithId(sendValidation, validationId, {
      method: 'POST',
      body: { mailStatus: 'sent' },
    });
    expect(sent.status).toBe(200);

    await ensureSchedulingConfigured();
    const state = await resolveBookingPage(token!);
    expect(state.status).toBe('gone');
    if (state.status === 'gone') expect(state.reason).toBe('revoked');
  });
});

// ════════════════════════════════════════════════════════════════════════
// S10.5 — Cycle de vie d'un rendez-vous natif : annulation candidat,
// re-pointage de référent, classement sans suite, réouverture.
// ════════════════════════════════════════════════════════════════════════

describe('S10.5 — cycle de vie du rendez-vous natif', () => {
  /** Réserve un créneau pour une candidature donnée et rend le rendez-vous. */
  async function bookFor(analysisId: string, uid: string, email: string) {
    const preview = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId: campNative,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: { ...NATIVE_CANDIDATE, email },
        uid,
        analysisId,
        preview: true,
      },
    });
    const token = /\/r\/([A-Za-z0-9_-]{20,})/.exec(String(preview.json.html))?.[1];
    expect(token).toBeTruthy();

    await ensureSchedulingConfigured();
    const slots = await listSlotsForLink(token!, {
      from: new Date(Date.now() + 60_000).toISOString(),
      to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    expect(slots.length).toBeGreaterThan(0);

    const confirmed = await confirmBooking({
      token: token!,
      startAt: slots[Math.floor(Math.random() * Math.min(slots.length, 20))]!.startAt,
      attendee: { name: 'Candidat Treg', email, timezone: 'Europe/Paris' },
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error('réservation impossible');
    return { token: token!, booking: confirmed.booking };
  }

  it('ANNULATION CANDIDAT : le briefing repart « en attente », avec un signal', async () => {
    const uid = `${NATIVE_UID}-cancel`;
    const analysisId = `${NATIVE_ANALYSIS}-cancel`;
    const email = 'cancel.s10n@test.local';

    await db().from('interview_briefs').insert({
      campaign_id: campNative,
      candidate_email: email,
      candidate_name: 'Candidat Treg',
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [],
      candidate_snapshot: { ...NATIVE_CANDIDATE, email },
      uid,
    });

    const { booking } = await bookFor(analysisId, uid, email);
    await drainSchedulingEvents();
    const [scheduled] = await readRows<{ status: string }>('interview_briefs', { uid });
    expect(scheduled?.status).toBe('scheduled');

    // Le candidat annule depuis sa page de gestion.
    expect(await cancelBookingByAttendee(booking.manageToken, {})).toBe('cancelled');
    await drainSchedulingEvents();

    const [reopened] = await readRows<{ status: string; booking_uid: string | null }>(
      'interview_briefs',
      { uid },
    );
    expect(reopened?.status).toBe('awaiting_booking');
    // `booking_uid` EFFACÉ : sinon une réouverture ultérieure le relirait
    // comme la preuve d'un rendez-vous encore valide.
    expect(reopened?.booking_uid).toBeNull();

    // Signal métier : c'est ce que l'onglet Entretiens rend actionnable. Aucune
    // réémission automatique de lien en V1 — un humain décide.
    const entries = await readRows<{ payload: Record<string, unknown> }>('journal', {
      action: 'interview_booking_cancelled',
    });
    const entry = entries.find((e) => e.payload.uid === uid);
    expect(entry).toBeDefined();
    expect(entry!.payload.cancelledBy).toBe('attendee');
    expect(entry!.payload.needsAction).toBe(true);
  });

  it('RE-POINTAGE : les liens actifs basculent, les rendez-vous pris ne bougent pas', async () => {
    const uid = `${NATIVE_UID}-repoint`;
    const { booking } = await bookFor(`${NATIVE_ANALYSIS}-repoint`, uid, 'repoint.s10n@test.local');

    // Un second lien reste ACTIF (candidat invité, pas encore réservé).
    const pending = await call(composeMail, {
      method: 'POST',
      body: {
        artifactId: 'preview',
        campaignId: campNative,
        jobTitle: TEST_JOB_TITLE,
        mode: 'invite',
        candidate: NATIVE_CANDIDATE,
        uid: `${uid}-b`,
        analysisId: `${NATIVE_ANALYSIS}-repoint-b`,
        preview: true,
      },
    });
    expect(pending.status).toBe(200);

    // L'impact est ANNONCÉ avant l'écriture — c'est ce que lit le dialog.
    actAs('admin');
    const impact = await callWithId(campaignScheduling, campNative, { method: 'GET' });
    expect(impact.status).toBe(200);
    expect(impact.json.native).toBe(true);
    expect(impact.json.activeLinks as number).toBeGreaterThan(0);
    expect(
      (impact.json.bookings as { count: number }[]).reduce((s, b) => s + b.count, 0),
    ).toBeGreaterThan(0);

    // Le member devient référent — il a besoin de disponibilités pour ça.
    const avail = await callWithId(putAvailability, MEMBER_ID, {
      method: 'PUT',
      body: {
        timezone: 'Europe/Paris',
        slotDurationMinutes: 30,
        minNoticeMinutes: 0,
        rules: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
          weekday,
          startMinute: 0,
          endMinute: 1440,
        })),
      },
    });
    expect(avail.status).toBe(200);

    const repointed = await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: { ownerUserId: MEMBER_ID },
    });
    expect(repointed.status).toBe(200);

    // La CIBLE pointe le nouveau référent : les liens déjà envoyés ouvrent
    // désormais l'agenda du member, sans réémission.
    const [target] = await readRows<{ resource_id: string }>('sched_targets', {
      external_ref: campNative,
    });
    const [memberResource] = await readRows<{ id: string }>('sched_resources', {
      external_ref: MEMBER_ID,
    });
    expect(target?.resource_id).toBe(memberResource?.id);

    // Le rendez-vous DÉJÀ PRIS, lui, reste chez l'ancien référent.
    const [adminResource] = await readRows<{ id: string }>('sched_resources', {
      external_ref: ADMIN_ID,
    });
    const [bookingRow] = await readRows<{ resource_id: string }>('sched_bookings', {
      id: booking.id,
    });
    expect(bookingRow?.resource_id).toBe(adminResource?.id);

    // On rend la campagne à l'admin pour les tests suivants.
    await callWithId(patchCampaign, campNative, {
      method: 'PATCH',
      body: { ownerUserId: ADMIN_ID },
    });
  });

  it('REPLANIFIER : UN SEUL mail au candidat — excuses + nouveau lien', async () => {
    const uid = `${NATIVE_UID}-replan`;
    const analysisId = `can_treg_replan_${Date.now().toString(36)}`;
    const email = 'replan.s10n@test.local';

    const insAnalysis = await db().from('candidate_analyses').insert({
      id: analysisId,
      uid,
      campaign_id: campNative,
      candidate_name: 'Candidat Treg',
      candidate_email: email,
      file_name: 'cv.pdf',
      source: 'email',
      received_at: new Date().toISOString(),
      total_score: 90,
      status: 'accepted',
      criteria_version: 'treg-s10n',
      computed_at: new Date().toISOString(),
      decision_zone: 'auto_accept',
      decided_by: 'auto',
      application: testApplication(email, 90),
    });
    expect(insAnalysis.error).toBeNull();

    const { booking } = await bookFor(analysisId, uid, email);
    await drainSchedulingEvents();

    resetSentEmails();
    actAs('admin');
    const res = await call(reissueLink, {
      method: 'POST',
      body: { analysisId, kind: 'reschedule' },
    });
    expect(res.status).toBe(200);
    expect(res.json.status).toBe('sent');

    // UN SEUL message au candidat. Avant, il en recevait deux : « votre
    // rendez-vous est annulé », puis « votre candidature est retenue » — la
    // seconde lui réannonçant une nouvelle qu'il avait déjà reçue.
    const toCandidate = sentEmails.filter(
      (m) => m.to === email || (Array.isArray(m.to) && m.to.includes(email)),
    );
    expect(toCandidate).toHaveLength(1);

    const mail = toCandidate[0]!;
    expect(String(mail.subject)).toMatch(/nouveau créneau/i);
    // Ni annonce de sélection, ni mot « annulé » sec : des excuses.
    expect(String(mail.subject)).not.toMatch(/retenue/i);
    expect(String(mail.html)).toMatch(/désolés/i);
    // Et un lien VALIDE, d'une génération neuve (l'ancien est consommé).
    const token = /\/r\/([A-Za-z0-9_-]{20,})/.exec(String(mail.html))?.[1];
    expect(token).toBeTruthy();
    await ensureSchedulingConfigured();
    expect((await resolveBookingPage(token!)).status).toBe('open');

    // Le rendez-vous précédent est bien décommandé.
    const [previous] = await readRows<{ status: string; cancelled_by: string | null }>(
      'sched_bookings',
      { id: booking.id },
    );
    expect(previous?.status).toBe('cancelled');
    expect(previous?.cancelled_by).toBe('organizer');

    // Le briefing est de nouveau EN ATTENTE de réservation.
    await drainSchedulingEvents();
    const [brief] = await readRows<{ status: string }>('interview_briefs', { uid });
    expect(brief?.status).toBe('awaiting_booking');

    // ── La VUE : une seule ligne, et du bon côté ────────────────────────
    // Défaut constaté à l'usage : l'annulation de replanification restait
    // affichée, et replanifier de nouveau en ajoutait une deuxième. La page
    // étant désormais adossée aux BRIEFINGS (un par candidature), le créneau
    // tombé n'est plus une ligne : la candidature repasse « en attente ».
    const pipeline = await loadInterviewPipeline({ campaignId: campNative });
    const waiting = pipeline.awaiting.filter((r) => r.analysisId === analysisId);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]!.linkStatus).toBe('active');
    expect(pipeline.scheduled.some((r) => r.analysisId === analysisId)).toBe(false);

    // ── Deuxième tour : le candidat re-réserve, on replanifie encore ─────
    await ensureSchedulingConfigured();
    const secondToken = /\/r\/([A-Za-z0-9_-]{20,})/.exec(String(mail.html))?.[1];
    const slots = await listSlotsForLink(secondToken!, {
      from: new Date(Date.now() + 60_000).toISOString(),
      to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    const rebooked = await confirmBooking({
      token: secondToken!,
      startAt: slots[Math.min(5, slots.length - 1)]!.startAt,
      attendee: { name: 'Candidat Treg', email, timezone: 'Europe/Paris' },
    });
    expect(rebooked.ok).toBe(true);
    await drainSchedulingEvents();

    const again = await call(reissueLink, {
      method: 'POST',
      body: { analysisId, kind: 'reschedule' },
    });
    expect(again.status).toBe(200);

    const pipeline2 = await loadInterviewPipeline({ campaignId: campNative });
    // TOUJOURS une seule ligne — deux créneaux tombés, pas deux lignes.
    expect(
      pipeline2.awaiting.filter((r) => r.analysisId === analysisId),
    ).toHaveLength(1);
    expect(pipeline2.scheduled.some((r) => r.analysisId === analysisId)).toBe(false);
  });

  it('SANS SUITE : lien révoqué, rendez-vous décommandé SANS second message au candidat', async () => {
    const uid = `${NATIVE_UID}-dismiss`;
    const analysisId = `can_treg_dismiss_${Date.now().toString(36)}`;
    const email = 'dismiss.s10n@test.local';

    const insAnalysis = await db().from('candidate_analyses').insert({
      id: analysisId,
      uid,
      campaign_id: campNative,
      candidate_name: 'Candidat Treg',
      candidate_email: email,
      file_name: 'cv.pdf',
      source: 'email',
      received_at: new Date().toISOString(),
      total_score: 88,
      status: 'accepted',
      criteria_version: 'treg-s10n',
      computed_at: new Date().toISOString(),
      decision_zone: 'auto_accept',
      decided_by: 'auto',
      application: testApplication(email, 88),
    });
    expect(insAnalysis.error).toBeNull();

    await db().from('interview_briefs').insert({
      campaign_id: campNative,
      candidate_email: email,
      candidate_name: 'Candidat Treg',
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [],
      candidate_snapshot: { ...NATIVE_CANDIDATE, email },
      uid,
    });

    const { token, booking } = await bookFor(analysisId, uid, email);
    await drainSchedulingEvents();

    resetSentEmails();
    actAs('admin');
    const dismissed = await callWithId(dismissCandidature, analysisId, {
      method: 'POST',
      body: { reason: 'candidat_retire', sendMail: true },
    });
    expect(dismissed.status).toBe(200);

    // 1. le lien meurt vraiment ;
    await ensureSchedulingConfigured();
    const state = await resolveBookingPage(token);
    expect(state.status).toBe('gone');

    // 2. le rendez-vous est décommandé ;
    const [cancelled] = await readRows<{ status: string; cancelled_by: string | null }>(
      'sched_bookings',
      { id: booking.id },
    );
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelled_by).toBe('organizer');

    // 3. UNE SEULE VOIX : le candidat reçoit le mail du classement, pas
    //    l'avis d'annulation du module.
    const toCandidate = sentEmails.filter(
      (m) => m.to === email || (Array.isArray(m.to) && m.to.includes(email)),
    );
    expect(toCandidate).toHaveLength(1);
    expect(String(toCandidate[0]!.subject)).not.toMatch(/annul/i);

    // 4. RÉOUVERTURE : le rendez-vous ayant été décommandé, le briefing
    //    repart « en attente de réservation » — jamais « rendez-vous pris ».
    const reopened = await callWithId(reopenCandidature, analysisId, { method: 'POST' });
    expect(reopened.status).toBe(200);
    const [brief] = await readRows<{ status: string }>('interview_briefs', { uid });
    expect(brief?.status).toBe('awaiting_booking');
  });
});

// ════════════════════════════════════════════════════════════════════════
// S10.6 — Page Entretiens : pilotage du cycle, LES DEUX RÉGIMES.
// ════════════════════════════════════════════════════════════════════════

describe('S10.6 — pilotage du cycle d’entretien', () => {
  const uidLegacy = `${NATIVE_UID}-legacy`;
  const uidPast = `${NATIVE_UID}-past`;
  const analysisLegacy = `can_treg_legacy_${Date.now().toString(36)}`;
  const analysisPast = `can_treg_past_${Date.now().toString(36)}`;

  async function seedAnalysis(id: string, uid: string, campaignId: string, email: string) {
    const res = await db().from('candidate_analyses').insert({
      id,
      uid,
      campaign_id: campaignId,
      candidate_name: 'Candidat Treg',
      candidate_email: email,
      file_name: 'cv.pdf',
      source: 'email',
      received_at: new Date().toISOString(),
      total_score: 87,
      status: 'accepted',
      criteria_version: 'treg-s10n',
      computed_at: new Date().toISOString(),
      decision_zone: 'auto_accept',
      decided_by: 'auto',
      application: testApplication(email, 87),
    });
    expect(res.error).toBeNull();
  }

  beforeAll(async () => {
    // Un briefing LEGACY (campagne Cal.com) en attente de réservation…
    await seedAnalysis(analysisLegacy, uidLegacy, campOwned, 'legacy.s10p@test.local');
    await db().from('interview_briefs').insert({
      campaign_id: campOwned,
      candidate_email: 'legacy.s10p@test.local',
      candidate_name: 'Candidat Treg',
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [],
      candidate_snapshot: NATIVE_CANDIDATE,
      uid: uidLegacy,
    });

    // …et un entretien PASSÉ, jamais pointé (uid Cal.com, régime legacy).
    await seedAnalysis(analysisPast, uidPast, campOwned, 'past.s10p@test.local');
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const end = new Date(Date.now() - 3 * 86_400_000 + 3_600_000).toISOString();
    await db().from('interview_briefs').insert({
      campaign_id: campOwned,
      candidate_email: 'past.s10p@test.local',
      candidate_name: 'Candidat Treg',
      job_title: TEST_JOB_TITLE,
      status: 'scheduled',
      questions: [],
      candidate_snapshot: NATIVE_CANDIDATE,
      uid: uidPast,
      booking_uid: `bk_treg_legacy_${Date.now().toString(36)}`,
      interview_start_at: start,
      interview_end_at: end,
      booked_at: start,
    });
  });

  it('les briefings LEGACY Cal.com apparaissent dans les DEUX onglets', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campOwned });
    // Aucun filtre par régime : la table est unique, c'est ce qui fait que la
    // page sert la coexistence sans branchement.
    expect(pipeline.awaiting.some((r) => r.uid === uidLegacy)).toBe(true);
    expect(pipeline.scheduled.some((r) => r.uid === uidPast)).toBe(true);
    // Pas d'objet lien en Cal.com : la colonne est vide, ce n'est pas une anomalie.
    const legacy = pipeline.awaiting.find((r) => r.uid === uidLegacy);
    expect(legacy?.linkStatus).toBeNull();
    expect(legacy?.analysisId).toBe(analysisLegacy);
  });

  it('un entretien passé sans pointage est EN TÊTE, et le signal 3 s’allume', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campOwned });
    const row = pipeline.scheduled.find((r) => r.uid === uidPast);
    expect(row?.section).toBe('a_pointer');
    expect(pipeline.counts.toPoint).toBeGreaterThan(0);

    const signals = await computeBusinessSignals();
    const signal = signals.find((s) => s.key === 'interviews_awaiting_pointing');
    expect(signal).toBeDefined();
    expect(signal!.count).toBeGreaterThan(0);
    expect(signal!.target).toEqual({ tab: 'entretiens', section: 'a_pointer' });
  });

  it('« Entretien réalisé » → stage entretien_fait PARTOUT, signal 3 éteint', async () => {
    const before = (await computeBusinessSignals()).find(
      (s) => s.key === 'interviews_awaiting_pointing',
    );
    expect(before).toBeDefined();

    // Exactement ce que pose l'écran (helper client → /api/journal).
    const posted = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_interview_marked',
        campaignId: campOwned,
        actor: 'user',
        payload: { uid: uidPast, candidate: 'Candidat Treg', status: 'realized' },
      },
    });
    expect(posted.status < 400).toBe(true);

    // Le ruban Candidatures dérive du MÊME marqueur — rien à recâbler.
    const counters = await call(getCounters, { query: `campaignId=${campOwned}` });
    expect((counters.json.counts as Record<string, number>).entretien_fait).toBeGreaterThan(0);

    // La ligne quitte l'onglet des entretiens pour celui des verdicts : on ne
    // réclame pas deux fois la même chose pour un seul dossier.
    const pipeline = await loadInterviewPipeline({ campaignId: campOwned });
    expect(pipeline.scheduled.some((r) => r.uid === uidPast)).toBe(false);
    expect(pipeline.verdict.some((r) => r.uid === uidPast)).toBe(true);
    // Le compteur compte ce qui est AFFICHÉ, pas la table.
    expect(pipeline.counts.scheduled).toBe(pipeline.scheduled.length);
    expect(pipeline.counts.verdict).toBe(pipeline.verdict.length);

    // Extinction PAR CONSTRUCTION : le signal 3 perd cette ligne.
    const after = (await computeBusinessSignals()).find(
      (s) => s.key === 'interviews_awaiting_pointing',
    );
    expect((after?.count ?? 0)).toBe(before!.count - 1);
  });

  it('NO-SHOW branche « classer non retenu » → la ligne disparaît du pilotage', async () => {
    const posted = await call(postJournal, {
      method: 'POST',
      body: {
        action: 'candidate_interview_marked',
        campaignId: campOwned,
        actor: 'user',
        payload: { uid: uidLegacy, candidate: 'Candidat Treg', status: 'missed' },
      },
    });
    expect(posted.status < 400).toBe(true);

    // `missed` dérive vers non_retenu : la candidature n'est plus ouverte, donc
    // la page cesse de proposer de la relancer.
    const pipeline = await loadInterviewPipeline({ campaignId: campOwned });
    expect(pipeline.awaiting.some((r) => r.uid === uidLegacy)).toBe(false);

    const counters = await call(getCounters, { query: `campaignId=${campOwned}` });
    expect((counters.json.counts as Record<string, number>).non_retenu).toBeGreaterThan(0);
  });

  it('NO-SHOW branche « re-proposer » → AUCUN marqueur posé', async () => {
    // La seconde branche du dialog ne décide rien : elle réémet. La trace
    // d'audit du cycle absent → réinvité est le journal de réémission.
    const marks = await readRows<{ payload: { uid?: string } }>('journal', {
      action: 'candidate_interview_marked',
    });
    const before = marks.filter((m) => m.payload.uid === uidPast).length;

    const res = await call(reissueLink, {
      method: 'POST',
      body: { analysisId: analysisPast, kind: 'reinvite' },
    });
    // Régime Cal.com autorisé : le message repart avec le lien d'agenda.
    expect(res.status).toBe(200);

    const after = await readRows<{ payload: { uid?: string } }>('journal', {
      action: 'candidate_interview_marked',
    });
    expect(after.filter((m) => m.payload.uid === uidPast).length).toBe(before);

    const reissued = await readRows<{ payload: { analysisId?: string; regime?: string } }>(
      'journal',
      { action: 'interview_link_reissued' },
    );
    expect(reissued.some((r) => r.payload.analysisId === analysisPast)).toBe(true);
  });
});
