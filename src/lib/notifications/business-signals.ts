/**
 * Signaux MÉTIER (notifications in-app) — REGISTRE extensible.
 *
 * Un signal = une définition `{ key, compute }` où `compute()` retourne un
 * `BusinessSignal` prêt à afficher (message + CTA + cible) ou `null` si rien à
 * signaler. Ajouter un signal v2 (RDV non réservés, campagne sans candidature
 * récente…) = ajouter UNE entrée à `BUSINESS_SIGNALS` — ni la route ni les
 * composants ne changent.
 *
 * Règles :
 *   - comptages EXHAUSTIFS depuis les tables (jamais le journal tronqué) ;
 *   - requêtes légères (counts + le plus ancien) ;
 *   - le signal 2 est défini PAR `deriveCandidateStage` (via `stageFor`) : il
 *     s'éteint par construction dès que la décision est prise — aucune logique
 *     de stage parallèle.
 */
import {
  addDays,
  upcomingFrenchHolidays,
  type FrenchHoliday,
} from '@/lib/calendar/french-holidays';
import { chunk } from '@/lib/db/paginate';
import { listLiveJobPostings } from '@/lib/db/repos/job-postings';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { republishDaysLeft } from '@/lib/jobboards/adep/panel-state';
import { listBriefsByStatus } from '@/lib/db/repos/interview-briefs';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  countOverduePendingValidations,
  oldestPendingValidationCreatedAt,
} from '@/lib/db/repos/pending-validations';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { loadStageSignals, stageFor, type StageSignals } from '@/lib/reporting/stage-signals';
import { getResource, isMeetingLocationComplete, listExceptions, listWeeklyRules } from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import type { BusinessSignal } from '@/types/notifications';

// ─── Helpers PURS (testés) ─────────────────────────────────────────────────

/** Jours ENTIERS écoulés depuis `iso` (plancher, jamais négatif). */
export function daysSinceIso(iso: string, nowMs: number): number {
  const elapsed = nowMs - Date.parse(iso);
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

/** ISO du seuil « plus vieux que N jours ». */
export function cutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function buildPendingValidationsMessage(
  count: number,
  thresholdDays: number,
  oldestDays: number,
): string {
  const head =
    count === 1
      ? `1 candidat attend votre validation depuis plus de ${thresholdDays} jours`
      : `${count} candidats attendent votre validation depuis plus de ${thresholdDays} jours`;
  return `${head} — le plus ancien depuis ${oldestDays} jour${oldestDays > 1 ? 's' : ''}.`;
}

export function buildInterviewsAwaitingMessage(count: number): string {
  return count === 1
    ? '1 candidat a passé son entretien et attend votre décision.'
    : `${count} candidats ont passé leur entretien et attendent votre décision.`;
}

export function buildInterviewsPointingMessage(count: number): string {
  return count === 1
    ? '1 entretien passé attend votre pointage (réalisé ou absent).'
    : `${count} entretiens passés attendent votre pointage (réalisé ou absent).`;
}


/**
 * Jours fériés ENCORE PROPOSABLES pour une ressource réservable.
 *
 * Bornage sur l'HORIZON, pas sur une fenêtre arbitraire : un férié au-delà de
 * l'horizon n'est pas offert, donc il n'y a rien à corriger et le signaler
 * serait du bruit. Le signal s'allume exactement quand la date devient
 * réservable — soit trois à quatre semaines d'avance aux réglages courants —
 * et s'éteint par construction dès qu'une absence est posée, ou dès que la
 * date est passée.
 *
 * Pur : la règle se teste sans base ni horloge.
 */
export function selectUnblockedHolidays(input: {
  /** Jour local de la ressource, `YYYY-MM-DD`. */
  from: string;
  horizonDays: number;
  /** Jours réellement travaillés (ISO 1-7). Vide ⇒ ressource non réservable. */
  openWeekdays: number[];
  /** Absences déjà déclarées. */
  blockedDays: string[];
}): FrenchHoliday[] {
  // Aucune règle = aucun créneau proposé, donc aucun férié à bloquer.
  if (input.openWeekdays.length === 0) return [];
  const until = addDays(input.from, input.horizonDays);
  const blocked = new Set(input.blockedDays);
  return upcomingFrenchHolidays({
    from: input.from,
    openWeekdays: input.openWeekdays,
  }).filter((h) => h.day <= until && !blocked.has(h.day));
}

/** « 2026-11-11 » → « 11 novembre ». Midi UTC : aucune bascule de date. */
export function formatHolidayDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
}

export function buildHolidaysUnblockedMessage(
  holidayCount: number,
  nearest: FrenchHoliday,
): string {
  const when = `${formatHolidayDay(nearest.day)} (${nearest.label})`;
  return holidayCount === 1
    ? `Votre agenda propose encore des créneaux le ${when}, qui est férié.`
    : `Votre agenda propose encore des créneaux sur ${holidayCount} jours fériés — le plus proche : ${when}.`;
}

/**
 * Briefings dont l'entretien est TERMINÉ depuis assez longtemps pour qu'un
 * pointage soit attendu. Pur : la règle de sélection est testable sans base.
 *
 * Un entretien sans date de fin est ignoré — on ne déclare pas « passé » ce
 * qu'on ne sait pas dater.
 */
export function selectUnpointedBriefs<
  T extends { uid: string | null; interviewEndAt: string | null },
>(briefs: T[], cutoffMs: number): T[] {
  return briefs.filter(
    (b) =>
      b.uid !== null &&
      b.interviewEndAt !== null &&
      Date.parse(b.interviewEndAt) < cutoffMs,
  );
}

/**
 * uids dont le marqueur entretien retenu est `realized` ET posé avant le
 * cutoff. Pur : la sélection est testable sans base.
 */
export function selectOverdueRealizedUids(
  interviewMarks: ReadonlyMap<string, 'realized' | 'missed'>,
  interviewMarkedAt: ReadonlyMap<string, string>,
  cutoffMs: number,
): string[] {
  const out: string[] = [];
  for (const [uid, mark] of interviewMarks) {
    if (mark !== 'realized') continue;
    const at = interviewMarkedAt.get(uid);
    if (at && Date.parse(at) < cutoffMs) out.push(uid);
  }
  return out;
}

// ─── Signal 1 — validations grises en attente depuis trop longtemps ────────

async function computePendingValidationsOverdue(
  nowMs: number,
): Promise<BusinessSignal | null> {
  const days = BUSINESS_NOTIFICATION_THRESHOLDS.pendingValidationAgeDays;
  // Les deux lectures partent ensemble ; la seconde n'est ATTENDUE que s'il y
  // a quelque chose à signaler (même résultat, même erreur remontée qu'avant).
  const oldestPromise = oldestPendingValidationCreatedAt();
  oldestPromise.catch(() => undefined);
  const count = await countOverduePendingValidations(cutoffIso(nowMs, days));
  if (count === 0) return null;
  const oldest = await oldestPromise;
  const oldestDays = oldest ? daysSinceIso(oldest, nowMs) : days;
  return {
    key: 'pending_validations_overdue',
    count,
    oldestDays,
    message: buildPendingValidationsMessage(count, days, oldestDays),
    ctaLabel: 'Ouvrir la validation suspendue',
    target: { tab: 'validations' },
  };
}

// ─── Signal 2 — entretiens réalisés sans décision finale ───────────────────

async function computeInterviewsAwaitingDecision(
  nowMs: number,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  const days = BUSINESS_NOTIFICATION_THRESHOLDS.interviewDecisionAgeDays;
  const signals = await shared.stageSignals();
  const candidateUids = selectOverdueRealizedUids(
    signals.interviewMarks,
    signals.interviewMarkedAt,
    nowMs - days * 86_400_000,
  );
  if (candidateUids.length === 0) return null;

  // Analyses chargées UNIQUEMENT pour ces uids (bas volume), stage dérivé par
  // le helper CANONIQUE — décision posée ⇒ stage retenu/non_retenu ⇒ sorti.
  const awaiting: { uid: string; markedAt: string }[] = [];
  const parts = await Promise.all(
    chunk(candidateUids, 300).map((part) => listAllCandidateAnalyses({ uidIn: part })),
  );
  for (const analyses of parts) {
    for (const analysis of analyses) {
      if (stageFor(analysis, signals) !== 'entretien_fait') continue;
      const markedAt = signals.interviewMarkedAt.get(analysis.uid);
      if (markedAt) awaiting.push({ uid: analysis.uid, markedAt });
    }
  }
  if (awaiting.length === 0) return null;

  const oldestMs = Math.min(...awaiting.map((a) => Date.parse(a.markedAt)));
  return {
    key: 'interviews_awaiting_decision',
    count: awaiting.length,
    oldestDays: daysSinceIso(new Date(oldestMs).toISOString(), nowMs),
    message: buildInterviewsAwaitingMessage(awaiting.length),
    ctaLabel: 'Voir les candidatures (Entretien fait)',
    target: { tab: 'candidatures', stage: 'entretien_fait' },
  };
}

// ─── Signal 3 — entretiens passés sans pointage ────────────────────────────

/**
 * Un entretien terminé qui n'a été ni pointé « réalisé » ni pointé « absent »
 * laisse la candidature figée : ni décision, ni relance. Le système le
 * SIGNALE, il ne le transitionne jamais tout seul — un no-show est un fait
 * que seul un humain constate.
 *
 * Extinction PAR CONSTRUCTION, comme les signaux 1 et 2 : la sélection retient
 * les seules étapes encore ouvertes (`invite` / `rdv_pris`). Pointer, classer
 * sans suite ou trancher fait sortir la ligne sans logique dédiée.
 */
async function computeInterviewsAwaitingPointing(
  nowMs: number,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  const hours = BUSINESS_NOTIFICATION_THRESHOLDS.interviewPointingAgeHours;
  // Les signaux d'étape sont PARTAGÉS avec le signal 2 et partent en même
  // temps que les briefings ; ils ne sont attendus que s'il y a des candidats.
  const signalsPromise = shared.stageSignals();
  signalsPromise.catch(() => undefined);
  const briefs = await listBriefsByStatus('scheduled').catch(() => []);
  const candidates = selectUnpointedBriefs(briefs, nowMs - hours * 3_600_000);
  if (candidates.length === 0) return null;

  const signals = await signalsPromise;
  const uids = candidates.map((b) => b.uid as string);
  const open: { uid: string; endAt: string }[] = [];
  const parts = await Promise.all(
    chunk(uids, 300).map((part) => listAllCandidateAnalyses({ uidIn: part })),
  );
  for (const analyses of parts) {
    const byUid = new Map(analyses.map((a) => [a.uid, a]));
    for (const brief of candidates) {
      const analysis = byUid.get(brief.uid as string);
      if (!analysis) continue;
      const stage = stageFor(analysis, signals);
      // `entretien_fait` relève du signal 2 (décision attendue) : on ne
      // réclame pas deux fois la même chose pour un seul dossier.
      if (stage !== 'invite' && stage !== 'rdv_pris') continue;
      open.push({ uid: analysis.uid, endAt: brief.interviewEndAt as string });
    }
  }
  if (open.length === 0) return null;

  const oldestMs = Math.min(...open.map((o) => Date.parse(o.endAt)));
  return {
    key: 'interviews_awaiting_pointing',
    count: open.length,
    oldestDays: daysSinceIso(new Date(oldestMs).toISOString(), nowMs),
    message: buildInterviewsPointingMessage(open.length),
    ctaLabel: 'Pointer les entretiens passés',
    target: { tab: 'entretiens', section: 'a_pointer' },
  };
}


/**
 * Signal 4 — des jours fériés restent PROPOSABLES.
 *
 * Le moteur de créneaux ne connaît pas le calendrier civil (cf.
 * `src/lib/calendar/french-holidays.ts`) : un 11 novembre est offert comme
 * n'importe quel mercredi. Le bouton « Ajouter les jours fériés » des
 * disponibilités règle le cas d'un geste, encore faut-il que quelqu'un y
 * pense — c'est précisément ce qu'un signal est là pour éviter.
 *
 * Le jour courant est pris dans le fuseau de CHAQUE ressource : à minuit
 * passé à Paris, l'UTC est encore la veille, et un férié du lendemain
 * paraîtrait à tort hors horizon.
 *
 * Ressource injoignable ⇒ elle est ignorée, pas le signal entier : un agenda
 * en panne ne doit pas masquer ce que les autres ont à corriger.
 */
async function computeAvailabilityHolidaysUnblocked(
  nowMs: number,
  ctx: SignalContext,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  // Réglage PERSONNEL : hors session, il n'y a personne à qui le dire.
  if (!ctx.recruiterId) return null;

  // Les ports du module sont injectés à l'exécution : sans cet appel,
  // `getResource` LÈVE. Un `.catch(() => null)` ici rendrait « rien à
  // signaler » sur une panne de configuration — le signal ne se serait jamais
  // allumé, nulle part, sans que rien ne le dise (défaut attrapé en recette).
  // On laisse donc remonter : le registre journalise et omet le signal.
  const resource = await shared.resource(ctx.recruiterId);
  // Pas de ressource, ou agenda désactivé : rien n'est proposé, rien à régler.
  if (!resource || !resource.isActive) return null;

  const [rules, exceptions] = await Promise.all([
    shared.weeklyRules(resource.externalRef),
    listExceptions(resource.externalRef),
  ]);
  const unblocked = selectUnblockedHolidays({
    from: localDay(nowMs, resource.timezone),
    horizonDays: resource.horizonDays,
    openWeekdays: [...new Set(rules.map((r) => r.weekday))],
    blockedDays: exceptions.map((e) => e.day),
  });
  if (unblocked.length === 0) return null;

  return {
    key: 'availability_holidays_unblocked',
    count: unblocked.length,
    // Ce signal n'a pas d'ancienneté : il APPROCHE, il ne vieillit pas.
    oldestDays: 0,
    message: buildHolidaysUnblockedMessage(
      unblocked.length,
      unblocked[0] as FrenchHoliday,
    ),
    ctaLabel: 'Ouvrir Agendas & disponibilités',
    target: { route: '/settings' },
  };
}

/**
 * SIGNAL 5 — agenda sans lieu d'entretien.
 *
 * Un agenda ouvert mais sans lieu ne fait pas échouer une réservation : il
 * fait pire. L'invitation est BLOQUÉE au moment de l'envoi (`canEmitBookingLink`)
 * — donc découverte en pleine campagne, sur un candidat retenu, par quelqu'un
 * qui ne sait pas encore que la cause est dans ses propres réglages. Le signal
 * existe pour que ce blocage soit connu AVANT d'avoir un candidat à inviter.
 *
 * Trois précisions qui comptent :
 *   - réglage PERSONNEL, donc lu dans le contexte (réclamer à Paul de remplir
 *     l'agenda de Marie ne mène à rien) ;
 *   - on n'alerte QUE si des plages sont ouvertes : sans règle hebdomadaire,
 *     l'agenda est en cours de configuration et le signal 4 comme celui-ci
 *     harcèleraient quelqu'un qui n'a pas fini de saisir ;
 *   - la surcharge de campagne ne rattrape rien ici : elle est PAR campagne,
 *     et l'agenda sert toutes les autres.
 */
async function computeAvailabilityMeetingLocationMissing(
  _nowMs: number,
  ctx: SignalContext,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  if (!ctx.recruiterId) return null;

  // Même raison qu'au signal 4 : sans les ports, `getResource` LÈVE, et un
  // `.catch(() => null)` éteindrait le signal partout sans que rien ne le dise.
  const resource = await shared.resource(ctx.recruiterId);
  if (!resource || !resource.isActive) return null;
  if (isMeetingLocationComplete(resource.meetingLocation)) return null;

  const rules = await shared.weeklyRules(resource.externalRef);
  if (rules.length === 0) return null; // agenda encore en construction

  return {
    key: 'availability_meeting_location_missing',
    count: 1,
    // Ce signal ne vieillit pas : il est vrai ou il ne l'est pas.
    oldestDays: 0,
    message:
      'Ton agenda n’indique aucun lieu d’entretien : aucune invitation ne peut partir pour les campagnes dont tu es référent.',
    ctaLabel: 'Renseigner le lieu de l’entretien',
    target: { route: '/settings' },
  };
}

/**
 * Signaux 5 et 6 — les offres APEC encore vivantes.
 *
 * Une seule lecture pour les deux : `listLiveJobPostings` s'appuie sur l'index
 * partiel `job_postings_live_idx` (publiées ou suspendues). Balayer la table
 * pour jeter ensuite serait exactement le défaut du fil d'activité du 21/08.
 *
 * Les deux signaux sont COMMUNS — une offre en ligne concerne le cabinet, pas
 * un recruteur. Ils n'ont donc pas de `SignalContext`.
 */
async function computeApecRepublicationWindow(
  nowMs: number,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  const postings = await shared.liveJobPostings();
  const warning = BUSINESS_NOTIFICATION_THRESHOLDS.apecRepublishWarningDays;
  const now = new Date(nowMs);

  // ⚠️ La fenêtre court depuis la PUBLICATION, pas depuis la suspension : une
  // offre publiée le 1er et suspendue le 28 n'a plus que deux jours.
  const closing = postings.filter((p) => {
    if (p.remoteStatus !== 'SUSPENDUE') return false;
    const left = republishDaysLeft(p.publishedAt, now);
    return left !== null && left > 0 && left <= warning;
  });
  if (closing.length === 0) return null;

  const soonest = Math.min(
    ...closing.map((p) => republishDaysLeft(p.publishedAt, now) ?? warning),
  );
  return {
    key: 'apec_republication_window_closing',
    count: closing.length,
    oldestDays: warning - soonest,
    message:
      closing.length === 1
        ? `1 offre APEC suspendue ne pourra plus être republiée dans ${soonest} jour${soonest > 1 ? 's' : ''} — il faudra en créer une nouvelle.`
        : `${closing.length} offres APEC suspendues ne pourront plus être republiées d’ici ${soonest} jour${soonest > 1 ? 's' : ''}.`,
    ctaLabel: 'Voir les campagnes',
    target: { route: '/rh/recrutement' },
  };
}

/**
 * Une offre encore PUBLIÉE sur une campagne clôturée.
 *
 * C'est la vraie faute que ce connecteur peut produire : des candidats
 * postulent à un poste pourvu et reçoivent, au mieux, un classement sans
 * suite. Le signal s'éteint dès la dépublication.
 */
async function computeApecLiveOnClosedCampaign(
  nowMs: number,
  shared: SharedLoads = createSharedLoads(),
): Promise<BusinessSignal | null> {
  const postings = (await shared.liveJobPostings()).filter(
    (p) => p.remoteStatus === 'PUBLIEE',
  );
  if (postings.length === 0) return null;

  const summaries = await listCampaignSummaries(postings.map((p) => p.campaignId));
  const orphans = postings.filter(
    (p) => summaries.get(p.campaignId)?.status === 'closed',
  );
  if (orphans.length === 0) return null;

  const oldest = orphans.reduce(
    (max, p) => Math.max(max, p.publishedAt ? daysSinceIso(p.publishedAt, nowMs) : 0),
    0,
  );
  return {
    key: 'apec_offer_live_on_closed_campaign',
    count: orphans.length,
    oldestDays: oldest,
    message:
      orphans.length === 1
        ? 'Une offre est toujours en ligne sur l’APEC alors que sa campagne est clôturée — des candidats peuvent encore postuler.'
        : `${orphans.length} offres sont toujours en ligne sur l’APEC alors que leur campagne est clôturée.`,
    ctaLabel: 'Voir les campagnes',
    target: { route: '/rh/recrutement' },
  };
}

/** Jour civil `YYYY-MM-DD` tel que le vit la ressource, pas tel que l'UTC. */
function localDay(nowMs: number, timeZone: string): string {
  // `en-CA` rend précisément `YYYY-MM-DD`, et `timeZone` fait le décalage.
  return new Date(nowMs).toLocaleDateString('en-CA', { timeZone });
}

// ─── Registre ──────────────────────────────────────────────────────────────

/**
 * Contexte d'appel d'un signal.
 *
 * L'espace métier est COMMUN (campagnes, candidatures, compteurs) : les
 * signaux qui portent sur un dossier en attente restent donc les mêmes pour
 * tout le monde, et ne lisent pas ce contexte. Seul un signal qui porte sur
 * un réglage PERSONNEL — l'agenda de quelqu'un — a besoin de savoir à qui il
 * parle : réclamer à Paul de corriger la grille de Marie ne mène à rien.
 */
export type SignalContext = {
  /** Identifiant du recruteur connecté, `null` hors session. */
  recruiterId: string | null;
};

/**
 * Lectures communes à plusieurs signaux, mémorisées le temps d'UN calcul :
 * les signaux 2 et 3 lisent les mêmes signaux d'étape, 4 et 5 la même
 * ressource et les mêmes règles, 6 et 7 les mêmes offres. Une lecture en échec
 * fait échouer chaque signal qui la demande, exactement comme s'il l'avait
 * faite lui-même.
 */
export type SharedLoads = {
  stageSignals: () => Promise<StageSignals>;
  resource: (recruiterId: string) => ReturnType<typeof getResource>;
  weeklyRules: (externalRef: string) => ReturnType<typeof listWeeklyRules>;
  liveJobPostings: () => ReturnType<typeof listLiveJobPostings>;
};

export function createSharedLoads(): SharedLoads {
  const memo = new Map<string, Promise<unknown>>();
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let promise = memo.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = load();
      memo.set(key, promise);
    }
    return promise;
  };
  return {
    stageSignals: () => once('stageSignals', () => loadStageSignals()),
    // Les ports du module sont injectés à l'exécution : sans cet appel,
    // `getResource` LÈVE (cf. signaux 4 et 5).
    resource: (recruiterId) =>
      once(`resource:${recruiterId}`, async () => {
        await ensureSchedulingConfigured();
        return getResource(recruiterId);
      }),
    weeklyRules: (externalRef) =>
      once(`rules:${externalRef}`, () => listWeeklyRules(externalRef)),
    liveJobPostings: () => once('liveJobPostings', () => listLiveJobPostings()),
  };
}

export type BusinessSignalDefinition = {
  key: BusinessSignal['key'];
  /**
   * `true` si le signal lit le `SignalContext` (réglage PERSONNEL). Les autres
   * ne l'attendent pas : ils démarrent sans attendre la vérification de session.
   */
  personal?: boolean;
  compute: (
    nowMs: number,
    ctx: SignalContext,
    shared?: SharedLoads,
  ) => Promise<BusinessSignal | null>;
};

export const BUSINESS_SIGNALS: BusinessSignalDefinition[] = [
  {
    key: 'pending_validations_overdue',
    compute: (nowMs) => computePendingValidationsOverdue(nowMs),
  },
  {
    key: 'interviews_awaiting_decision',
    compute: (nowMs, _ctx, shared) => computeInterviewsAwaitingDecision(nowMs, shared),
  },
  {
    key: 'interviews_awaiting_pointing',
    compute: (nowMs, _ctx, shared) => computeInterviewsAwaitingPointing(nowMs, shared),
  },
  {
    key: 'availability_holidays_unblocked',
    personal: true,
    compute: computeAvailabilityHolidaysUnblocked,
  },
  {
    key: 'availability_meeting_location_missing',
    personal: true,
    compute: computeAvailabilityMeetingLocationMissing,
  },
  {
    key: 'apec_republication_window_closing',
    compute: (nowMs, _ctx, shared) => computeApecRepublicationWindow(nowMs, shared),
  },
  {
    key: 'apec_offer_live_on_closed_campaign',
    compute: (nowMs, _ctx, shared) => computeApecLiveOnClosedCampaign(nowMs, shared),
  },
];

/**
 * Calcule tous les signaux actifs. Un signal qui ÉCHOUE est loggé et omis —
 * une panne d'un signal ne prive pas l'utilisateur des autres.
 */
export async function computeBusinessSignals(
  nowMs = Date.now(),
  ctx: SignalContext | Promise<SignalContext> = { recruiterId: null },
): Promise<BusinessSignal[]> {
  const shared = createSharedLoads();
  const ctxPromise = Promise.resolve(ctx);
  const results = await Promise.allSettled(
    BUSINESS_SIGNALS.map(async (def) =>
      def.personal
        ? def.compute(nowMs, await ctxPromise, shared)
        : def.compute(nowMs, { recruiterId: null }, shared),
    ),
  );
  const signals: BusinessSignal[] = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      if (res.value) signals.push(res.value);
    } else {
      console.error(
        `[notifications] signal ${BUSINESS_SIGNALS[i]!.key} en échec`,
        res.reason,
      );
    }
  });
  return signals;
}
