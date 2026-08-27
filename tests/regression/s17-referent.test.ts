/**
 * S17 — Recruteur référent : mention et filtre, sur les trois surfaces.
 *
 * Ce que ce scénario protège, dans l'ordre d'importance :
 *
 *   1. LE FILTRE NE RESTREINT AUCUN ACCÈS. C'est une commodité de lecture.
 *      Une validation que le filtre masque reste tranchable et envoyable — le
 *      test le PROUVE en la tranchant réellement, par les vraies routes.
 *   2. SUR UN RDV DÉJÀ PRIS, ON NOMME CELUI QUI LE TIENT. La ressource est
 *      figée à la confirmation et ne suit jamais un re-pointage : afficher le
 *      référent actuel enverrait quelqu'un au mauvais entretien. Vérifié dans
 *      les DEUX régimes — natif (réservation réelle du module) et Cal.com
 *      (organisateur capté au journal).
 *   3. LES ALERTES ÉCHAPPENT AU FILTRE. Compteur « à pointer » et cibles
 *      orphelines se calculent sur l'ensemble : un filtre de confort ne masque
 *      jamais un dossier en souffrance.
 *   4. UN RÉFÉRENT DÉSACTIVÉ N'EST PAS UN TROU. La couche données le rend tel
 *      quel (`isActive: false`) — c'est l'affichage qui en fait « référent non
 *      défini » — et ses dossiers restent joignables par l'entrée de filtre
 *      correspondante.
 *
 * Tout est exercé sur les VRAIES routes et le VRAI pipeline ; seuls la session
 * (identité du lecteur) et les frontières globales (LLM, mails) sont simulés.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const authState: { user: { id: string; email: string } | null } = { user: null };

vi.mock('@/lib/auth/supabase-server', () => ({
  getAuthServerClient: async () =>
    authState.user === null
      ? null
      : { auth: { getUser: async () => ({ data: { user: authState.user } }) } },
}));

// Le setup global fige `getApiUser` à `null` (suite historiquement mono-
// utilisateur). Ici l'identité du LECTEUR est le sujet même du test.
vi.mock('@/lib/auth/require-api-user', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/auth/require-api-user')
  >('@/lib/auth/require-api-user');
  return { ...actual, getApiUser: async () => authState.user };
});

import { PUT as putCampaign } from '@/app/api/campaigns/route';
import { GET as getInterviews } from '@/app/api/interviews/route';
import {
  GET as listValidations,
  POST as postValidation,
} from '@/app/api/validations/route';
import { PATCH as patchValidation } from '@/app/api/validations/[id]/route';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { loadInterviewPipeline } from '@/lib/interviews/pipeline';
import {
  buildReferentOptions,
  buildReferentOptionsBy,
  filterByReferent,
  filterByReferentBy,
  myCampaignsCount,
  myReferentCountBy,
  shortRecruiterName,
  type ReferentByCampaign,
} from '@/lib/referent/filter';
import {
  confirmBooking,
  createBookingLink,
  createResource,
  createTarget,
  listSlotsForLink,
  setWeeklyRules,
} from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import type { PendingValidation } from '@/types/hitl';

import { call, callWithId, testCampaignPayload, TEST_JOB_TITLE } from './helpers/api';
import { cleanAll, db, newTestCampaignId } from './helpers/db';
import { resetSentEmails } from './helpers/mocks';

/** Celui qui TIENT les rendez-vous. */
const TITULAIRE = {
  id: randomUUID(),
  displayName: 'Sami Belkacem',
  email: 'titulaire.s17@test.local',
};
/** Le référent ACTUEL des campagnes — arrivé après coup. */
const REFERENT = {
  id: randomUUID(),
  displayName: 'Jane Rossi',
  email: 'referent.s17@test.local',
};
/** Référent DÉSACTIVÉ (recruteur sorti de l'espace). */
const PARTI = {
  id: randomUUID(),
  displayName: 'Yann Bernard',
  email: 'parti.s17@test.local',
};

const campRef = newTestCampaignId('s17ref');
const campParti = newTestCampaignId('s17parti');
const campSans = newTestCampaignId('s17sans');
const campNative = newTestCampaignId('s17nat');

const CAMPS = [campRef, campParti, campSans, campNative];

function actAs(who: typeof TITULAIRE | typeof REFERENT | null): void {
  authState.user = who ? { id: who.id, email: who.email } : null;
}

async function cleanRecruiters(): Promise<void> {
  const { error } = await db()
    .from('recruiters')
    .delete()
    .like('email', '%.s17@test.local');
  if (error && !/does not exist|schema cache/i.test(error.message)) {
    throw new Error(`clean recruiters: ${error.message}`);
  }
}

/** Le module de réservation ne connaît pas `cleanAll` : on nettoie nos traces. */
async function cleanScheduling(): Promise<void> {
  const supabase = db();
  const { data: targets } = await supabase
    .from('sched_targets')
    .select('id')
    .in('external_ref', CAMPS);
  const targetIds = (targets ?? []).map((row) => row.id as string);
  if (targetIds.length > 0) {
    const { data: bookings } = await supabase
      .from('sched_bookings')
      .select('id')
      .in('target_id', targetIds);
    const bookingIds = (bookings ?? []).map((row) => row.id as string);
    if (bookingIds.length > 0) {
      await supabase.from('sched_events').delete().in('booking_id', bookingIds);
      await supabase.from('sched_bookings').delete().in('id', bookingIds);
    }
    await supabase.from('sched_booking_links').delete().in('target_id', targetIds);
    await supabase.from('sched_targets').delete().in('id', targetIds);
  }
  const { data: resources } = await supabase
    .from('sched_resources')
    .select('id')
    .in('external_ref', [TITULAIRE.id, REFERENT.id]);
  const resourceIds = (resources ?? []).map((row) => row.id as string);
  if (resourceIds.length > 0) {
    await supabase.from('sched_availability_rules').delete().in('resource_id', resourceIds);
    await supabase
      .from('sched_availability_exceptions')
      .delete()
      .in('resource_id', resourceIds);
    await supabase.from('sched_resources').delete().in('id', resourceIds);
  }
}

async function enqueueValidation(
  id: string,
  campaignId: string,
  score: number,
): Promise<void> {
  const res = await call(postValidation, {
    method: 'POST',
    body: {
      id,
      campaignId,
      candidateName: `Candidat ${id}`,
      candidateEmail: `${id}@test.local`,
      score,
      decision: 'reject',
      payload: { uid: `uid_${id}`, jobTitle: TEST_JOB_TITLE },
    },
  });
  expect(res.status).toBe(200);
}

/** Analyse minimale : sans elle, le pipeline écarte le briefing (candidature introuvable). */
async function insertOpenAnalysis(
  analysisId: string,
  uid: string,
  campaignId: string,
): Promise<void> {
  const email = `${uid}@test.local`;
  const res = await db().from('candidate_analyses').insert({
    id: analysisId,
    uid,
    campaign_id: campaignId,
    candidate_name: 'Candidat Treg S17',
    candidate_email: email,
    file_name: 'cv.pdf',
    source: 'email',
    received_at: new Date().toISOString(),
    total_score: 90,
    status: 'accepted',
    criteria_version: 'treg-s17',
    computed_at: new Date().toISOString(),
    decision_zone: 'auto_accept',
    decided_by: 'auto',
    application: {},
  });
  expect(res.error).toBeNull();
}

beforeAll(async () => {
  await cleanAll();
  await cleanRecruiters();
  await cleanScheduling();
  resetSentEmails();

  const ins = await db()
    .from('recruiters')
    .insert([
      // `is_active` posé EXPLICITEMENT : la colonne est NOT NULL et le défaut
      // n'est pas garanti d'un environnement à l'autre.
      { id: TITULAIRE.id, display_name: TITULAIRE.displayName, email: TITULAIRE.email, role: 'member', is_active: true },
      { id: REFERENT.id, display_name: REFERENT.displayName, email: REFERENT.email, role: 'admin', is_active: true },
      { id: PARTI.id, display_name: PARTI.displayName, email: PARTI.email, role: 'member', is_active: false },
    ]);
  expect(ins.error).toBeNull();

  actAs(REFERENT);
  for (const [id, owner] of [
    [campRef, REFERENT.id],
    [campParti, PARTI.id],
    [campSans, null],
    [campNative, REFERENT.id],
  ] as const) {
    const res = await call(putCampaign, {
      method: 'PUT',
      body: { ...testCampaignPayload({ id, status: 'active' }), ownerUserId: owner },
    });
    expect(res.status).toBe(200);
  }

  await enqueueValidation('val_s17_ref', campRef, 45);
  await enqueueValidation('val_s17_parti', campParti, 46);
  await enqueueValidation('val_s17_sans', campSans, 47);
});

afterAll(async () => {
  await cleanScheduling();
  await cleanAll();
  await cleanRecruiters();
  actAs(null);
});

async function loadQueue(): Promise<{
  validations: PendingValidation[];
  referents: ReferentByCampaign;
  currentUserId: string | null;
}> {
  const res = await call(listValidations, { method: 'GET' });
  expect(res.status).toBe(200);
  const all = res.json.validations as PendingValidation[];
  return {
    // La base dev peut porter d'autres validations : on se borne aux nôtres.
    validations: all.filter((v) => CAMPS.includes(v.campaignId)),
    referents: (res.json.referentByCampaign ?? {}) as ReferentByCampaign,
    currentUserId: (res.json.currentUserId ?? null) as string | null,
  };
}

describe('S17 §1 — /api/validations sert le référent de chaque campagne', () => {
  it('référent actif, référent DÉSACTIVÉ et campagne sans référent sont distingués', async () => {
    actAs(REFERENT);
    const { referents } = await loadQueue();

    expect(referents[campRef]).toEqual({
      id: REFERENT.id,
      displayName: REFERENT.displayName,
      isActive: true,
    });
    // ⚠️ Le désactivé est rendu TEL QUEL : l'écraser en `null` rendrait
    // « désactivé » et « jamais désigné » indistinguables, et un référent
    // perdu ne se diagnostiquerait plus.
    expect(referents[campParti]).toEqual({
      id: PARTI.id,
      displayName: PARTI.displayName,
      isActive: false,
    });
    expect(referents[campSans]).toBeNull();
  });

  it('rend l’identité du lecteur, et elle SUIT la session', async () => {
    actAs(REFERENT);
    expect((await loadQueue()).currentUserId).toBe(REFERENT.id);
    actAs(TITULAIRE);
    expect((await loadQueue()).currentUserId).toBe(TITULAIRE.id);
  });

  it('la projection de campagnes ne rend que les ids demandés', async () => {
    const summaries = await listCampaignSummaries([campRef, campSans, 'CAMP-TREG-inexistante']);
    expect(summaries.get(campRef)?.ownerUserId).toBe(REFERENT.id);
    expect(summaries.get(campSans)?.ownerUserId).toBeNull();
    // Une campagne inconnue est ABSENTE de la Map — jamais une erreur.
    expect(summaries.has('CAMP-TREG-inexistante')).toBe(false);
  });
});

describe('S17 §2 — le filtre, sur les données réellement servies', () => {
  it('filtre par référent, compteurs cohérents, « Tous » restaure', async () => {
    actAs(REFERENT);
    const { validations, referents } = await loadQueue();
    expect(validations).toHaveLength(3);

    const options = buildReferentOptions(validations, referents);
    expect(options.map((o) => [o.label, o.count])).toEqual([
      ['Tous', 3],
      [shortRecruiterName(REFERENT.displayName), 1],
      // Le désactivé et la campagne sans référent tombent ensemble.
      ['Référent non défini', 2],
    ]);

    const mine = filterByReferent(validations, referents, {
      kind: 'recruiter',
      id: REFERENT.id,
    });
    expect(mine.map((v) => v.id)).toEqual(['val_s17_ref']);

    const orphelines = filterByReferent(validations, referents, { kind: 'none' });
    expect(orphelines.map((v) => v.id).sort()).toEqual([
      'val_s17_parti',
      'val_s17_sans',
    ]);

    expect(filterByReferent(validations, referents, { kind: 'all' })).toHaveLength(3);
  });

  it('« Mes campagnes » compte ce que le LECTEUR pilote, et lui seul', async () => {
    actAs(REFERENT);
    const { validations, referents, currentUserId } = await loadQueue();
    expect(myCampaignsCount(validations, referents, currentUserId)).toBe(1);
    // Un recruteur qui ne pilote rien : le raccourci s'efface plutôt que de
    // promettre une liste vide.
    expect(myCampaignsCount(validations, referents, TITULAIRE.id)).toBe(0);
    // Un DÉSACTIVÉ n'est plus référent actif de rien, même de sa campagne.
    expect(myCampaignsCount(validations, referents, PARTI.id)).toBe(0);
  });
});

describe('S17 §3 — le filtre ne restreint AUCUN accès', () => {
  it('une validation masquée par le filtre reste tranchable par les vraies routes', async () => {
    actAs(REFERENT);
    const { validations, referents } = await loadQueue();

    // Filtre actif sur le lecteur : la validation de la campagne au référent
    // désactivé N'EST PAS affichée.
    const visible = filterByReferent(validations, referents, {
      kind: 'recruiter',
      id: REFERENT.id,
    });
    expect(visible.map((v) => v.id)).not.toContain('val_s17_parti');

    // … et pourtant elle se tranche, sans le moindre traitement de faveur.
    const patched = await callWithId(patchValidation, 'val_s17_parti', {
      method: 'PATCH',
      body: { decision: 'accept' },
    });
    expect(patched.status).toBe(200);

    const after = await loadQueue();
    expect(after.validations.find((v) => v.id === 'val_s17_parti')?.decision).toBe(
      'accept',
    );
    // Remise en l'état pour ne pas polluer les scénarios suivants.
    await callWithId(patchValidation, 'val_s17_parti', {
      method: 'PATCH',
      body: { decision: 'reject' },
    });
  });
});

describe('S17 §4 — Entretiens : qui TIENT le rendez-vous', () => {
  const uidAttente = 'uid_s17_attente';
  const uidCalcom = 'uid_s17_calcom';
  const uidNatif = 'uid_s17_natif';
  const CALCOM_BOOKING = 'cal-s17-booking';

  beforeAll(async () => {
    await ensureSchedulingConfigured();

    // — Ligne EN ATTENTE de réservation (campagne pilotée par REFERENT).
    await insertOpenAnalysis('can_s17_attente', uidAttente, campRef);
    const attente = await db().from('interview_briefs').insert({
      campaign_id: campRef,
      candidate_email: `${uidAttente}@test.local`,
      candidate_name: 'Candidat Attente',
      job_title: TEST_JOB_TITLE,
      status: 'awaiting_booking',
      questions: [],
      candidate_snapshot: {},
      uid: uidAttente,
    });
    expect(attente.error).toBeNull();

    // — RDV Cal.com : réservé chez TITULAIRE, sur une campagne désormais
    //   pilotée par REFERENT. L'organisateur n'existe QUE dans le journal.
    await insertOpenAnalysis('can_s17_calcom', uidCalcom, campRef);
    const calcom = await db().from('interview_briefs').insert({
      campaign_id: campRef,
      candidate_email: `${uidCalcom}@test.local`,
      candidate_name: 'Candidat Calcom',
      job_title: TEST_JOB_TITLE,
      status: 'scheduled',
      questions: [],
      candidate_snapshot: {},
      uid: uidCalcom,
      booking_uid: CALCOM_BOOKING,
      interview_start_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      interview_end_at: new Date(Date.now() + 3 * 86_400_000 + 1_800_000).toISOString(),
    });
    expect(calcom.error).toBeNull();
    const journal = await db().from('journal').insert({
      campaign_id: campRef,
      actor: 'calcom_webhook',
      action: 'interview_brief_delivered',
      payload: {
        bookingUid: CALCOM_BOOKING,
        organizerEmail: TITULAIRE.email.toUpperCase(),
        status: 'delivered',
      },
    });
    expect(journal.error).toBeNull();

    // — RDV NATIF : ressource = TITULAIRE, cible = campagne de REFERENT.
    await createResource({
      externalRef: TITULAIRE.id,
      timezone: 'Europe/Paris',
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      minNoticeMinutes: 0,
      horizonDays: 30,
      notifyEmail: TITULAIRE.email,
      displayName: TITULAIRE.displayName,
    });
    await setWeeklyRules(
      TITULAIRE.id,
      // Toute la semaine : le test ne doit pas dépendre du jour où il tourne.
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        weekday,
        startMinute: 0,
        endMinute: 1440,
      })),
    );
    await createTarget({
      externalRef: campNative,
      resourceExternalRef: TITULAIRE.id,
    });
    const link = await createBookingLink({
      targetExternalRef: campNative,
      idempotencyKey: 'can_s17_natif',
      context: { uid: uidNatif, analysisId: 'can_s17_natif', campaignId: campNative },
    });
    const slots = await listSlotsForLink(link.token, {
      from: new Date(Date.now() + 60_000).toISOString(),
      to: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    });
    expect(slots.length).toBeGreaterThan(0);
    const confirmed = await confirmBooking({
      token: link.token,
      startAt: slots[0]!.startAt,
      attendee: {
        name: 'Candidat Natif',
        email: `${uidNatif}@test.local`,
        timezone: 'Europe/Paris',
      },
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) throw new Error('réservation native impossible');

    // La campagne passe en régime natif (écriture directe : le PATCH ciblé est
    // testé par S10, ici on veut seulement le régime).
    const flag = await db()
      .from('campaigns')
      .update({ scheduling_native: true })
      .eq('id', campNative);
    expect(flag.error).toBeNull();

    await insertOpenAnalysis('can_s17_natif', uidNatif, campNative);
    const natif = await db().from('interview_briefs').insert({
      campaign_id: campNative,
      candidate_email: `${uidNatif}@test.local`,
      candidate_name: 'Candidat Natif',
      job_title: TEST_JOB_TITLE,
      status: 'scheduled',
      questions: [],
      candidate_snapshot: {},
      uid: uidNatif,
      booking_uid: confirmed.booking.id,
      interview_start_at: confirmed.booking.startAt,
      interview_end_at: confirmed.booking.endAt,
    });
    expect(natif.error).toBeNull();
  });

  it('en attente de réservation → le référent de la CAMPAGNE, sans divergence', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campRef });
    const row = pipeline.awaiting.find((r) => r.uid === uidAttente);
    expect(row).toBeDefined();
    expect(row?.referent?.id).toBe(REFERENT.id);
    expect(row?.supersededBy).toBeNull();
  });

  it('RDV Cal.com → l’ORGANISATEUR capté au journal, et le référent actuel signalé', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campRef });
    const row = pipeline.scheduled.find((r) => r.uid === uidCalcom);
    expect(row).toBeDefined();
    // Celui qui TIENT le rendez-vous, pas celui qui pilote la campagne.
    expect(row?.referent?.id).toBe(TITULAIRE.id);
    // … et le changement est DIT, jamais tranché en silence.
    expect(row?.supersededBy?.id).toBe(REFERENT.id);
  });

  it('RDV NATIF → la ressource FIGÉE à la confirmation fait foi', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campNative });
    const row = pipeline.scheduled.find((r) => r.uid === uidNatif);
    expect(row).toBeDefined();
    expect(row?.referent?.id).toBe(TITULAIRE.id);
    expect(row?.supersededBy?.id).toBe(REFERENT.id);
  });

  it('le filtre suit ce qui est AFFICHÉ, pas la propriété de la campagne', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campRef });
    // Le type des lignes rendues, `uid` compris : on filtre EXACTEMENT ce que
    // la page affiche, pas une projection reconstruite pour le test.
    const rows = [...pipeline.awaiting, ...pipeline.scheduled];
    const referentOf = (row: (typeof rows)[number]) => row.referent;

    // Filtrer sur le titulaire ramène le RDV qu'il tient…
    const chezTitulaire = filterByReferentBy(rows, referentOf, {
      kind: 'recruiter',
      id: TITULAIRE.id,
    });
    expect(chezTitulaire).toHaveLength(1);
    expect(chezTitulaire[0]).toBe(pipeline.scheduled.find((r) => r.uid === uidCalcom));

    // … et filtrer sur le référent de la campagne ne le ramène PAS.
    const chezReferent = filterByReferentBy(rows, referentOf, {
      kind: 'recruiter',
      id: REFERENT.id,
    });
    expect(chezReferent.map((r) => r.uid)).toEqual([uidAttente]);

    const options = buildReferentOptionsBy(rows, referentOf);
    expect(options.find((o) => o.selection.kind === 'all')?.count).toBe(rows.length);
    expect(myReferentCountBy(rows, referentOf, TITULAIRE.id)).toBe(1);
  });

  it('la route /api/interviews rend l’identité du lecteur', async () => {
    actAs(TITULAIRE);
    const res = await call(getInterviews, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.json.currentUserId).toBe(TITULAIRE.id);
    actAs(REFERENT);
  });
});

describe('S17 §5 — les alertes échappent au filtre', () => {
  it('les compteurs et le bandeau orphelines restent calculés sur l’ENSEMBLE', async () => {
    const pipeline = await loadInterviewPipeline({ campaignId: campRef });
    const rows = [...pipeline.awaiting, ...pipeline.scheduled];
    const referentOf = (row: (typeof rows)[number]) => row.referent;

    // Vue filtrée sur le titulaire : une seule ligne visible…
    const filtre = { kind: 'recruiter' as const, id: TITULAIRE.id };
    expect(filterByReferentBy(rows, referentOf, filtre)).toHaveLength(1);

    // … mais les COMPTEURS servis restent ceux du périmètre entier. C'est ce
    // que l'écran affiche en « n sur N », et ce sur quoi les badges d'alerte
    // sont branchés : le pipeline ne connaît pas le filtre, et c'est voulu —
    // un filtre de confort ne doit jamais masquer un dossier en souffrance.
    expect(pipeline.counts.awaiting).toBe(pipeline.awaiting.length);
    expect(pipeline.counts.scheduled).toBe(pipeline.scheduled.length);
    expect(pipeline.counts.awaiting).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(pipeline.orphans)).toBe(true);
  });
});
