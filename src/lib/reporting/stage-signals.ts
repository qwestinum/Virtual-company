/**
 * Signaux d'étape (menu Candidatures) — chargement SERVEUR EXHAUSTIF.
 *
 * Le calcul de l'étape (`deriveCandidateStage`, pur) a besoin, pour chaque
 * candidat, de quelques signaux d'overlay. Tous proviennent de SOURCES
 * COMPLÈTES, jamais d'un scan de journal tronqué (cf. le cap 500 de
 * `loadJourneySignals`, réservé au Dashboard résiduel) :
 *
 *   - gris en attente  → `pending_validations` (status='pending'), table complète
 *   - RDV pris         → `interview_briefs` (status='scheduled'), par email
 *   - entretien/valid./recruté → journal, MAIS seulement 3 actions BAS VOLUME, paginées
 *                          en entier (`listJournalEntriesByActions`, sans cap 500)
 *
 * C'est ce qui garantit que le ruban de compteurs reflète TOUS les candidats du
 * périmètre, pas seulement les 500 dernières entrées de journal.
 */

import {
  emptyHiredState,
  emptyInterviewState,
  emptyValidationState,
  foldHiredMark,
  foldInterviewMark,
  foldValidationMark,
  HIRED_MARKER_ACTION,
  INTERVIEW_MARKER_ACTION,
  readValidationCause,
  VALIDATION_MARKER_ACTION,
  type HiredMarkEffect,
  type InterviewMarkEffect,
  type MarkerState,
  type ValidationMarkEffect,
} from '@/lib/candidatures/decision-markers';
import { NOT_SELECTED_CAUSE } from '@/lib/campagnes/closure-constants';
import { listScheduledInterviewUids } from '@/lib/db/repos/interview-briefs';
import {
  listJournalEntriesByActions,
  type JournalEntry,
} from '@/lib/db/repos/journal';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import {
  type CandidateStage,
  type CandidateStageCounts,
  deriveCandidateStage,
  tallyStages,
  emptyStageCounts,
} from '@/lib/reporting/candidate-stage';
import {
  countCandidateAnalyses,
  listAllCandidateAnalyses,
} from '@/lib/db/repos/candidate-analyses';
import {
  addToTrajectory,
  emptyTrajectoryCounts,
  type TrajectoryCounts,
} from '@/lib/reporting/campaign-trajectory';
import type { PendingValidation } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

const INTERVIEW_ACTION = INTERVIEW_MARKER_ACTION;
const VALIDATION_ACTION = VALIDATION_MARKER_ACTION;

/** Actions du journal dont dérivent les marqueurs d'étape. */
export const STAGE_MARKER_ACTIONS: readonly string[] = [
  INTERVIEW_ACTION,
  VALIDATION_ACTION,
  HIRED_MARKER_ACTION,
];

/**
 * Lectures déjà lancées par l'appelant (optionnel, additif). Mêmes replis que
 * les lectures internes : un rejet vaut une liste vide.
 *   · `journal` — lecture du journal sur le MÊME `campaignId` que le périmètre,
 *     couvrant au moins `STAGE_MARKER_ACTIONS` (les autres actions sont
 *     ignorées par le pliage) ;
 *   · `pending` — `listPendingValidations()`.
 */
export type StageSignalsPreload = {
  journal?: Promise<JournalEntry[]>;
  pending?: Promise<PendingValidation[]>;
};

export type StageSignals = {
  /** uids présents dans la file HITL en `pending` (gris à trancher). */
  pendingUids: Set<string>;
  /** uids d'analyse avec une réservation Cal.com (`scheduled`) — RATTACHÉ PAR UID. */
  scheduledUids: Set<string>;
  /** uid → dernier marqueur entretien (journal, dernier-gagne). */
  interviewMarks: Map<string, 'realized' | 'missed'>;
  /**
   * uid → date (ISO) du marqueur entretien RETENU (le même que interviewMarks,
   * même passe dernier-gagne). Sert au signal métier « entretien réalisé sans
   * décision depuis N jours » — pas de relecture parallèle du journal.
   */
  interviewMarkedAt: Map<string, string>;
  /** uid → dernier marqueur validation finale (journal, dernier-gagne). */
  validationMarks: Map<string, 'validated' | 'rejected'>;
  /** uids désignés recrutés (journal, dernier-gagne, gomme comprise). */
  hiredUids: Set<string>;
  /**
   * uids dont le verdict COURANT est « non retenu » POSÉ À LA CLÔTURE (retenu
   * non sélectionné) : même étape que tout « Non retenu », mais le parcours,
   * lui, est passé par « Retenu » (compteurs de campagne, 28/09/2026).
   */
  notSelectedUids: Set<string>;
};

/** Périmètre du ruban / des compteurs : campagne(s) + période (JAMAIS la recherche). */
export type StagePerimeter = {
  campaignId?: string;
  /** Ensemble de campagnes (ex. « actives »). Prioritaire sur campaignId. */
  campaignIds?: string[];
  from?: string;
  to?: string;
};

function payloadUid(payload: Record<string, unknown>): string | null {
  return typeof payload.uid === 'string' ? payload.uid : null;
}

/**
 * Charge les signaux d'overlay du périmètre. Best-effort : toute lecture qui
 * échoue retombe sur un set/map vide (l'étape dégrade vers les colonnes seules).
 */
export async function loadStageSignals(
  perimeter: StagePerimeter = {},
  preloaded: StageSignalsPreload = {},
): Promise<StageSignals> {
  const [pending, scheduledUids, markers] = await Promise.all([
    (preloaded.pending ?? listPendingValidations()).catch(() => []),
    listScheduledInterviewUids(perimeter.campaignId).catch(
      () => new Set<string>(),
    ),
    (
      preloaded.journal ??
      listJournalEntriesByActions([...STAGE_MARKER_ACTIONS], {
        campaignId: perimeter.campaignId,
      })
    ).catch(() => []),
  ]);

  const pendingUids = new Set<string>();
  for (const v of pending) {
    const uid = payloadUid(v.payload ?? {});
    if (uid) pendingUids.add(uid);
  }

  // Dernier-gagne délégué à `foldInterviewMark`/`foldValidationMark` : la
  // comparaison de dates y précède TOUJOURS l'interprétation de la valeur.
  // L'ancienne boucle filtrait `realized|missed` AVANT de retenir l'uid — un
  // marqueur gommé (`cleared`) était donc ignoré et le marquage ANTÉRIEUR
  // reprenait la main : la correction n'aurait rien changé à l'écran.
  const interviewStates = new Map<string, MarkerState<InterviewMarkEffect>>();
  const validationStates = new Map<string, MarkerState<ValidationMarkEffect>>();
  const hiredStates = new Map<string, MarkerState<HiredMarkEffect>>();
  // Cause portée par le marqueur de verdict GAGNANT (même dernier-gagne).
  const validationCause = new Map<string, string | null>();
  for (const entry of markers) {
    const uid = payloadUid(entry.payload);
    if (!uid) continue;
    if (entry.action === INTERVIEW_ACTION) {
      interviewStates.set(
        uid,
        foldInterviewMark(
          interviewStates.get(uid) ?? emptyInterviewState(),
          entry.payload,
          entry.createdAt,
        ),
      );
    } else if (entry.action === VALIDATION_ACTION) {
      const next = foldValidationMark(
        validationStates.get(uid) ?? emptyValidationState(),
        entry.payload,
        entry.createdAt,
      );
      if (next !== validationStates.get(uid) && next.at === entry.createdAt) {
        validationCause.set(uid, readValidationCause(entry.payload));
      }
      validationStates.set(uid, next);
    } else if (entry.action === HIRED_MARKER_ACTION) {
      hiredStates.set(
        uid,
        foldHiredMark(hiredStates.get(uid) ?? emptyHiredState(), entry.payload, entry.createdAt),
      );
    }
  }

  // Un marqueur gommé n'entre PAS dans les maps : l'uid en est absent, et
  // `stageFor` retombe sur les colonnes — exactement comme s'il n'avait
  // jamais été marqué.
  const interviewMarks = new Map<string, 'realized' | 'missed'>();
  const interviewMarkedAt = new Map<string, string>();
  for (const [uid, state] of interviewStates) {
    if (state.effect === null || state.at === null) continue;
    interviewMarks.set(uid, state.effect);
    interviewMarkedAt.set(uid, state.at);
  }
  const validationMarks = new Map<string, 'validated' | 'rejected'>();
  for (const [uid, state] of validationStates) {
    if (state.effect !== null) validationMarks.set(uid, state.effect);
  }

  const hiredUids = new Set<string>();
  for (const [uid, state] of hiredStates) {
    if (state.effect === 'hired') hiredUids.add(uid);
  }
  const notSelectedUids = new Set<string>();
  for (const [uid, mark] of validationMarks) {
    if (mark === 'rejected' && validationCause.get(uid) === NOT_SELECTED_CAUSE) notSelectedUids.add(uid);
  }

  return {
    pendingUids,
    scheduledUids,
    interviewMarks,
    interviewMarkedAt,
    validationMarks,
    hiredUids,
    notSelectedUids,
  };
}

/** Dérive l'étape courante d'un candidat à partir des signaux chargés. */
export function stageFor(
  c: CandidateAnalysisSummary,
  signals: StageSignals,
): CandidateStage {
  return deriveCandidateStage({
    status: c.status,
    decisionZone: c.decisionZone,
    decidedBy: c.decidedBy,
    isPendingValidation: signals.pendingUids.has(c.uid),
    // « RDV pris » rattaché par UID (≠ email) : une réservation pour CETTE
    // candidature, pas pour un autre traitement du même email.
    hasScheduledInterview: signals.scheduledUids.has(c.uid),
    interviewMarked: signals.interviewMarks.get(c.uid) ?? null,
    validationMarked: signals.validationMarks.get(c.uid) ?? null,
    hiredMarked: signals.hiredUids.has(c.uid),
    // Classement sans suite — colonne dénormalisée, pas un signal chargé :
    // domine tout dans la dérivation (terminal).
    isDismissed: c.dismissedAt !== null,
  });
}

/**
 * Compteurs EXHAUSTIFS du ruban. Charge TOUT le périmètre (campagne + période,
 * paginé en interne) + les signaux complets, dérive l'étape de CHAQUE candidat
 * via le helper partagé, puis agrège. Jamais de recherche texte ici : le ruban
 * reflète le périmètre, pas la liste filtrée à la frappe.
 */
export async function computeStageCounts(
  perimeter: StagePerimeter = {},
): Promise<{ counts: CandidateStageCounts; total: number }> {
  const [all, signals] = await Promise.all([
    listAllCandidateAnalyses({
      campaignId: perimeter.campaignId,
      campaignIds: perimeter.campaignIds,
      from: perimeter.from,
      to: perimeter.to,
    }),
    loadStageSignals(perimeter),
  ]);
  const counts = tallyStages(all.map((c) => stageFor(c, signals)));
  return { counts, total: all.length };
}

/**
 * Les mêmes compteurs, mais GROUPÉS PAR CAMPAGNE — une seule lecture.
 *
 * ⚠️ `computeStageCounts({ campaignIds })` AGRÈGE : elle rend un seul jeu de
 * compteurs pour tout le périmètre. La liste des campagnes, elle, a besoin du
 * détail de chacune — et appeler la version simple quinze fois ferait quinze
 * lectures pour un écran qui en demande une.
 *
 * Même source, même exhaustivité, même dérivation d'étape : les compteurs
 * d'une carte et ceux du ruban ne peuvent pas diverger, puisqu'ils sortent du
 * même calcul.
 *
 * Rend aussi l'ancienneté du plus ancien dossier EN ATTENTE : elle se lit dans
 * les données déjà chargées, donc elle ne coûte rien de plus — et sans elle
 * « ce qui attend » devrait être rechargé au dépliage, ce qui ferait sauter la
 * mise en page.
 */
/**
 * Étape où un entretien PASSÉ attend encore d'être pointé : le dossier est
 * toujours « Invité » ou « RDV pris ». Pointé (réalisé, absent), tranché ou
 * classé, il en sort — le briefing, lui, reste « programmé » à vie, ce qui
 * n'est donc jamais une preuve. Règle PARTAGÉE par l'alerte d'Aujourd'hui et
 * la carte de campagne (bug du 28/09/2026 : la carte comptait les briefings).
 */
export function awaitsPointing(stage: CandidateStage): boolean {
  return stage === 'invite' || stage === 'rdv_pris';
}

type PastBrief = { uid: string | null; campaignId: string | null };

export type CampaignCounts = {
  /** Étapes COURANTES (partition, puces de Candidatures). */
  counts: CandidateStageCounts;
  total: number;
  oldestWaitingDays: number | null;
  /** PARCOURS : combien sont passées par chaque étape (carte de campagne). */
  trajectory: TrajectoryCounts;
  /** Entretiens passés encore à pointer (briefings fournis par l'appelant). */
  unpointed: number;
};

export async function computeStageCountsByCampaign(
  campaignIds: readonly string[],
  nowMs: number = Date.now(),
  /**
   * Briefings dont l'entretien est passé (déjà filtrés par l'appelant). Une
   * promesse est acceptée : leur lecture part EN MÊME TEMPS que les analyses.
   */
  pastBriefs:
    | readonly PastBrief[]
    | Promise<readonly PastBrief[]> = [],
): Promise<Map<string, CampaignCounts>> {
  const out = new Map<string, CampaignCounts>();
  const ids = [...new Set(campaignIds)];
  if (ids.length === 0) return out;

  const [all, signals, briefs] = await Promise.all([
    listAllCandidateAnalyses({ campaignIds: ids }),
    loadStageSignals({ campaignIds: ids }),
    Promise.resolve(pastBriefs),
  ]);

  // Une campagne sans aucune candidature doit rendre des ZÉROS, pas une
  // absence : la carte affiche « 0 Reçues », elle ne masque pas son bloc.
  for (const id of ids) {
    out.set(id, {
      counts: emptyStageCounts(),
      total: 0,
      oldestWaitingDays: null,
      trajectory: emptyTrajectoryCounts(),
      unpointed: 0,
    });
  }

  const stageByKey = new Map<string, CandidateStage>();
  for (const analysis of all) {
    const entry = analysis.campaignId ? out.get(analysis.campaignId) : undefined;
    if (!entry) continue;
    const stage = stageFor(analysis, signals);
    stageByKey.set(`${analysis.campaignId}|${analysis.uid}`, stage);
    entry.counts[stage] += 1;
    entry.total += 1;
    addToTrajectory(entry.trajectory, analysis, signals);
    if (stage === 'a_valider') {
      const jours = Math.max(
        0,
        Math.floor((nowMs - Date.parse(analysis.createdAt)) / 86_400_000),
      );
      entry.oldestWaitingDays =
        entry.oldestWaitingDays === null
          ? jours
          : Math.max(entry.oldestWaitingDays, jours);
    }
  }

  // Un dossier compte UNE fois, même s'il porte plusieurs briefings passés.
  const seen = new Set<string>();
  for (const brief of briefs) {
    if (!brief.uid || !brief.campaignId) continue;
    const key = `${brief.campaignId}|${brief.uid}`;
    const stage = stageByKey.get(key);
    const entry = out.get(brief.campaignId);
    if (!entry || !stage || seen.has(key) || !awaitsPointing(stage)) continue;
    seen.add(key);
    entry.unpointed += 1;
  }
  return out;
}

/** Total exact du périmètre (sans dériver les étapes) — secours / cohérence. */
export async function perimeterTotal(
  perimeter: StagePerimeter = {},
): Promise<number> {
  return countCandidateAnalyses({
    campaignId: perimeter.campaignId,
    campaignIds: perimeter.campaignIds,
    from: perimeter.from,
    to: perimeter.to,
  });
}
