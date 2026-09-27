/**
 * Chargement de la page « Entretiens » — assemblage serveur.
 *
 * Une passe, quatre lectures, aucune requête par ligne :
 *   1. les briefings des deux statuts (pagination keyset, jamais tronquée) ;
 *   2. les analyses de ces candidatures (uid → identité + étape) ;
 *   3. les signaux d'étape (mêmes marqueurs que le ruban Candidatures) ;
 *   4. les liens natifs des campagnes concernées.
 *
 * La jointure `uid → analysisId` est indispensable : un briefing porte l'uid
 * d'analyse, alors que l'état d'un lien natif est indexé par l'identifiant
 * d'analyse. Une seule requête pour toute la page (`uidIn`), bas volume.
 */
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  listCampaignSummaries,
  type CampaignSummary,
} from '@/lib/db/repos/campaigns';
import { listBriefsByStatus } from '@/lib/db/repos/interview-briefs';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import type { ReferentInfo } from '@/lib/referent/filter';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import {
  getTargets,
  listBookings,
  listLinksForTarget,
  listOrphanTargets,
} from '@/lib/scheduling';
import { parseBookingContext } from '@/lib/scheduling-host/campaign-booking';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';
import type { InterviewBrief } from '@/types/interview-brief';

import { buildHistoryRows, type HistoryRow } from './history-rows';

import {
  organizerEmailsByBooking,
  resolveRowReferent,
  type RowReferent,
} from './referent-resolution';
import {
  buildAwaitingRows,
  buildScheduledRows,
  type AwaitingRow,
  type BriefFacts,
  type ScheduledRow,
} from './pipeline-rows';

export type OrphanRow = {
  campaignId: string;
  campaignName: string | null;
  activeLinks: number;
};

type Decorated<T> = T & { campaignName: string | null } & RowReferent;

export type InterviewPipeline = {
  awaiting: Decorated<AwaitingRow>[];
  /** Entretiens à venir et entretiens passés à pointer. */
  scheduled: Decorated<ScheduledRow>[];
  /** Entretiens pointés « réalisé » : il ne manque que la décision. */
  verdict: Decorated<ScheduledRow>[];
  /** Entretiens PASSÉS, tous verdicts confondus — qui a rencontré qui, quand. */
  history: Decorated<HistoryRow>[];
  orphans: OrphanRow[];
  /**
   * Compteurs des LISTES RENDUES, pas des tables.
   *
   * Le compte brut d'`interview_briefs` annonçait 5 là où l'écran montrait 3 :
   * il ignorait le filtre « candidature encore ouverte » et la déduplication.
   * Un compteur qui ne compte pas ce qu'on voit détruit la confiance dans les
   * deux. « Exhaustif » veut dire NON TRONQUÉ (lecture keyset), pas « brut ».
   */
  counts: {
    awaiting: number;
    scheduled: number;
    verdict: number;
    history: number;
    toPoint: number;
    /**
     * Briefings écartés faute de candidature retrouvable — anomalie de
     * données, affichée plutôt que tue.
     */
    unresolved: number;
  };
};

function toFacts(brief: InterviewBrief): BriefFacts {
  return {
    briefId: brief.id,
    uid: brief.uid,
    campaignId: brief.campaignId,
    candidateName: brief.candidateName,
    candidateEmail: brief.candidateEmail,
    jobTitle: brief.jobTitle,
    updatedAt: brief.updatedAt,
    createdAt: brief.createdAt,
    interviewStartAt: brief.interviewStartAt,
    interviewEndAt: brief.interviewEndAt,
    interviewLocation: brief.interviewLocation,
    bookingUid: brief.bookingUid,
  };
}

/**
 * Résumés des campagnes en jeu. Même résultat qu'une lecture unique de
 * `briefIds ∪ orphanRefs` : si la lecture anticipée des briefings a échoué, on
 * relit l'ensemble (comme avant), sinon on ne complète que l'inconnu.
 */
async function loadCampaigns(
  briefIds: string[],
  briefCampaigns: Map<string, CampaignSummary> | null,
  orphanRefs: string[],
): Promise<Map<string, CampaignSummary>> {
  if (!briefCampaigns) {
    return listCampaignSummaries([...briefIds, ...orphanRefs]).catch(
      () => new Map<string, CampaignSummary>(),
    );
  }
  const missing = orphanRefs.filter((ref) => !briefCampaigns.has(ref));
  if (missing.length === 0) return briefCampaigns;
  const extra = await listCampaignSummaries(missing).catch(
    () => new Map<string, CampaignSummary>(),
  );
  return new Map([...briefCampaigns, ...extra]);
}

export async function loadInterviewPipeline(
  filter: { campaignId?: string | null } = {},
  nowMs = Date.now(),
): Promise<InterviewPipeline> {
  const campaignId = filter.campaignId ?? null;

  const [awaitingBriefs, scheduledBriefs, cancelledBriefs] = await Promise.all([
    listBriefsByStatus('awaiting_booking', { campaignId }),
    listBriefsByStatus('scheduled', { campaignId }),
    // Pour l'HISTORIQUE seulement : un classement sans suite annule le
    // briefing mais garde ses faits de réservation — un candidat rencontré
    // puis classé doit rester à l'historique. Sans créneau, rien à montrer.
    listBriefsByStatus('cancelled', { campaignId })
      .then((briefs) => briefs.filter((b) => b.bookingUid !== null))
      .catch(() => [] as InterviewBrief[]),
  ]);
  const inPlay = [...awaitingBriefs, ...scheduledBriefs, ...cancelledBriefs];

  const uids = [
    ...new Set(
      inPlay
        .map((b) => b.uid)
        .filter((u): u is string => u !== null),
    ),
  ];

  const briefCampaignIds = inPlay
    .map((b) => b.campaignId)
    .filter((c): c is string => c !== null);

  const [analyses, signals, recruiters, orphanTargets, briefCampaigns, briefTargets] = await Promise.all([
    uids.length > 0
      ? listAllCandidateAnalyses({ uidIn: uids }).catch(() => [])
      : Promise.resolve([]),
    loadStageSignals(campaignId ? { campaignId } : {}).catch(() => null),
    listRecruiters().catch(() => []),
    (async () => {
      await ensureSchedulingConfigured();
      return listOrphanTargets();
    })().catch(() => []),
    // Les campagnes des briefings ne dépendent pas des cibles orphelines : on
    // les lit dès maintenant, et seules les références orphelines encore
    // inconnues coûtent une lecture de plus.
    listCampaignSummaries(briefCampaignIds).catch(() => null),
    // Cibles de réservation des campagnes des briefings, lues DÈS MAINTENANT :
    // une campagne sans cible n'en rend simplement pas. Évite une étape de plus
    // pour les campagnes natives (leurs liens et rendez-vous partent sur ces
    // cibles déjà lues).
    (async () => {
      await ensureSchedulingConfigured();
      return getTargets(briefCampaignIds);
    })().catch(() => null),
  ]);

  // Campagnes RÉELLEMENT en jeu : celles des briefings, plus celles que le
  // bandeau des cibles orphelines doit nommer. Projection minimale chunkée —
  // `listCampaigns()` n'a pas de `.range()` et retombait sous le plafond
  // PostgREST de 1000, silencieusement.
  const campaigns = await loadCampaigns(
    briefCampaignIds,
    briefCampaigns,
    orphanTargets.map((o) => o.target.externalRef),
  );

  const analysisByUid = new Map(analyses.map((a) => [a.uid, a]));
  const stageOf = (uid: string): string | null => {
    const analysis = analysisByUid.get(uid);
    if (!analysis || !signals) return null;
    return stageFor(analysis, signals);
  };
  const analysisIdOf = (uid: string): string | null =>
    analysisByUid.get(uid)?.id ?? null;

  // Liens natifs + TITULAIRES des rendez-vous, campagne par campagne —
  // uniquement celles qui tournent en réservation native.
  const linkStatusByAnalysis = new Map<string, AwaitingRow['linkStatus']>();
  // bookingUid → identifiant du recruteur qui TIENT le rendez-vous. La
  // ressource est FIGÉE à la confirmation : c'est la source autoritaire, elle
  // ne suit pas un re-pointage de la cible.
  const holderIdByBooking = new Map<string, string>();
  const nativeCampaigns = [...campaigns.values()].filter(
    (c) => c.schedulingNative && (!campaignId || c.id === campaignId),
  );
  if (nativeCampaigns.length > 0) {
    await ensureSchedulingConfigured();
    // Les cibles de TOUTES les campagnes natives en une lecture, puis liens et
    // rendez-vous de chacune lancés ensemble sur la cible déjà lue (plus de
    // relecture par clé). Une campagne sans cible n'a ni lien ni rendez-vous —
    // ce que rendaient déjà les deux lectures en échec. Les résultats sont
    // APPLIQUÉS dans l'ordre des campagnes, comme la boucle d'origine.
    // Cibles déjà connues : celles des briefings (lues à l'étape précédente)
    // et celles des cibles orphelines ; seules les campagnes natives encore
    // inconnues coûtent une lecture.
    const known = new Map([
      ...(briefTargets ?? new Map()),
      ...orphanTargets.map((o) => [o.target.externalRef, o.target] as const),
    ]);
    const missingNative = nativeCampaigns.map((c) => c.id).filter((id) => !known.has(id));
    const targets =
      briefTargets === null
        ? await getTargets(nativeCampaigns.map((c) => c.id)).catch(() => null)
        : missingNative.length === 0
          ? known
          : await getTargets(missingNative)
              .then((extra) => new Map([...known, ...extra]))
              .catch(() => null);
    const perCampaign = await Promise.all(
      nativeCampaigns.map((campaign) => {
        // Lecture groupée en échec : repli sur la lecture par clé d'origine.
        if (!targets) {
          return Promise.all([
            listLinksForTarget(campaign.id).catch(() => []),
            listBookings({ targetExternalRef: campaign.id }).catch(() => []),
          ]);
        }
        const target = targets.get(campaign.id);
        if (!target) return Promise.resolve([[], []] as const);
        return Promise.all([
          listLinksForTarget(target).catch(() => []),
          // TOUS statuts : un rendez-vous passé d'un dossier classé sans suite
          // a pu être décommandé, et l'historique doit encore nommer qui le
          // tenait. Indexé par identifiant : aucune ligne ouverte n'en change.
          listBookings({ target }).catch(() => []),
        ]);
      }),
    );
    for (const [links, bookings] of perCampaign) {
      for (const link of links) {
        const key =
          parseBookingContext(link.context)?.analysisId ?? link.idempotencyKey;
        // La génération la plus récente fait foi : un lien réémis remplace le
        // précédent, et c'est SON état que la page doit montrer.
        const known = linkStatusByAnalysis.get(key);
        if (!known || link.status === 'active') {
          linkStatusByAnalysis.set(key, link.status);
        }
      }
      for (const booking of bookings) {
        holderIdByBooking.set(booking.id, booking.resourceExternalRef);
      }
    }
  }

  const recruiterById = new Map(recruiters.map((r) => [r.id, r]));
  const recruiterByEmail = new Map(
    recruiters.map((r) => [r.email.trim().toLowerCase(), r]),
  );
  const toInfo = (r: { id: string; displayName: string; isActive: boolean }) => ({
    id: r.id,
    displayName: r.displayName,
    isActive: r.isActive,
  });

  // Régime Cal.com : AUCUNE colonne ne porte le titulaire d'un rendez-vous.
  // Le seul endroit où l'information existe est le payload du webhook, capté à
  // la réservation. Lecture EXHAUSTIVE mais bornée par les candidatures
  // arrivées en phase entretien (même classe de volume que les marqueurs
  // d'étape déjà chargés), et seulement s'il reste des rendez-vous que le
  // chemin natif n'explique pas — une installation 100 % native ne paie rien.
  const unexplained = [...scheduledBriefs, ...cancelledBriefs].some(
    (b) => b.bookingUid !== null && !holderIdByBooking.has(b.bookingUid),
  );
  const organizerByBooking = unexplained
    ? organizerEmailsByBooking(
        await listJournalEntriesByActions([
          'interview_brief_delivered',
          'interview_brief_regenerated',
        ]).catch(() => []),
      )
    : new Map<string, string>();

  const holderOf = (bookingUid: string | null): ReferentInfo | null => {
    if (!bookingUid) return null;
    const nativeId = holderIdByBooking.get(bookingUid);
    if (nativeId) {
      const recruiter = recruiterById.get(nativeId);
      return recruiter ? toInfo(recruiter) : null;
    }
    const email = organizerByBooking.get(bookingUid);
    const recruiter = email ? recruiterByEmail.get(email) : undefined;
    return recruiter ? toInfo(recruiter) : null;
  };

  const campaignNames = new Map(
    [...campaigns.values()].map((c) => [c.id, c.name]),
  );
  const referentOfCampaign = (id: string | null): ReferentInfo | null => {
    const ownerId = id ? (campaigns.get(id)?.ownerUserId ?? null) : null;
    const recruiter = ownerId ? recruiterById.get(ownerId) : undefined;
    return recruiter ? toInfo(recruiter) : null;
  };

  const decorate = <T extends { campaignId: string | null; bookingUid?: string | null }>(
    row: T,
  ): Decorated<T> => ({
    ...row,
    campaignName: row.campaignId ? (campaignNames.get(row.campaignId) ?? null) : null,
    ...resolveRowReferent(
      referentOfCampaign(row.campaignId),
      holderOf(row.bookingUid ?? null),
    ),
  });

  const awaitingBuilt = buildAwaitingRows(awaitingBriefs.map(toFacts), {
    nowMs,
    thresholdDays: BUSINESS_NOTIFICATION_THRESHOLDS.invitationAgeDays,
    stageOf,
    analysisIdOf,
    linkStatusOf: (analysisId) => linkStatusByAnalysis.get(analysisId) ?? null,
  });

  const scheduledBuilt = buildScheduledRows(scheduledBriefs.map(toFacts), {
    nowMs,
    pointingAgeHours: BUSINESS_NOTIFICATION_THRESHOLDS.interviewPointingAgeHours,
    stageOf,
    analysisIdOf,
  });

  const awaiting = awaitingBuilt.rows.map(decorate);
  // L'attente de verdict a son propre onglet : ce n'est plus un entretien à
  // organiser, c'est une décision à prendre.
  const scheduled = scheduledBuilt.rows
    .filter((r) => r.section !== 'verdict_attendu')
    .map(decorate);
  const verdict = scheduledBuilt.rows
    .filter((r) => r.section === 'verdict_attendu')
    .map(decorate);

  const history = buildHistoryRows(
    [...scheduledBriefs, ...cancelledBriefs].map(toFacts),
    {
      nowMs,
      stageOf,
      interviewMarkOf: (uid) => signals?.interviewMarks.get(uid) ?? null,
      analysisIdOf,
    },
  ).map(decorate);

  const orphans = orphanTargets
    .filter((o) => !campaignId || o.target.externalRef === campaignId)
    .map((o) => ({
      campaignId: o.target.externalRef,
      campaignName: campaignNames.get(o.target.externalRef) ?? null,
      activeLinks: o.activeLinks,
    }));

  return {
    awaiting,
    scheduled,
    verdict,
    history,
    orphans,
    counts: {
      awaiting: awaiting.length,
      scheduled: scheduled.length,
      verdict: verdict.length,
      history: history.length,
      toPoint: scheduled.filter((r) => r.section === 'a_pointer').length,
      unresolved: awaitingBuilt.unresolved + scheduledBuilt.unresolved,
    },
  };
}
