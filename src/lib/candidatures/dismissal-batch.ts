/**
 * Classement sans suite EN MASSE (clôture de campagne / GO final) — SERVEUR.
 *
 * Énumère les candidatures OUVERTES d'une campagne via le helper d'étape
 * CANONIQUE (`stageFor` — jamais une logique parallèle), puis applique le
 * protocole unitaire `dismissCandidature` séquentiellement (doux pour les
 * quotas mail, chaque envoi sous claim). Les gris en cours d'envoi
 * (`sending`) sont SAUTÉS et signalés — jamais classés sous incertitude.
 */

import { dismissCandidature } from '@/lib/candidatures/dismissal';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  emptyStageCounts,
  type CandidateStage,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type { DismissalReason } from '@/types/dismissal';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

/** Étapes OUVERTES (classables sans suite). `retenu` est terminal (le
 * recruté) ; les terminaux négatifs et `sans_suite` le sont aussi. */
export const OPEN_STAGES: CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'entretien_fait',
];

export type OpenCandidature = {
  analysis: CandidateAnalysisSummary;
  stage: CandidateStage;
};

export type OpenCandidaturesRecap = {
  /** Compteurs par étape ouverte (les autres clés restent à 0). */
  counts: CandidateStageCounts;
  total: number;
  /** ≥1 candidat au stage `retenu` (GO posé) → motif « poste pourvu » proposé. */
  hasRetenu: boolean;
};

/** Candidatures ouvertes d'une campagne (analyse + étape dérivée). */
export async function listOpenCandidatures(
  campaignId: string,
): Promise<{ open: OpenCandidature[]; hasRetenu: boolean }> {
  const [analyses, signals] = await Promise.all([
    listAllCandidateAnalyses({ campaignId, dismissed: false }),
    loadStageSignals({ campaignId }),
  ]);
  const open: OpenCandidature[] = [];
  let hasRetenu = false;
  for (const analysis of analyses) {
    const stage = stageFor(analysis, signals);
    if (stage === 'retenu') hasRetenu = true;
    if (OPEN_STAGES.includes(stage)) open.push({ analysis, stage });
  }
  return { open, hasRetenu };
}

/** Récapitulatif pour le dialog de clôture (« X candidatures en cours : … »). */
export async function recapOpenCandidatures(
  campaignId: string,
): Promise<OpenCandidaturesRecap> {
  const { open, hasRetenu } = await listOpenCandidatures(campaignId);
  const counts = emptyStageCounts();
  for (const { stage } of open) counts[stage] += 1;
  return { counts, total: open.length, hasRetenu };
}

export type BatchDismissalSummary = {
  dismissed: number;
  /** Gris en cours d'envoi — sautés (re-tenter après résolution). */
  deferredSending: number;
  alreadyDismissed: number;
  mailsSent: number;
  /** Mails demandés mais non partis (hors non-applicables) — requêtables au
   * journal (`candidature_dismissal_mail_not_sent`). */
  mailsFailed: number;
};

/**
 * Classe TOUTES les candidatures ouvertes d'une campagne. Chaque unité est
 * idempotente (rejouer une clôture ne double ni classement ni mail).
 */
export async function dismissOpenCandidatures(
  campaignId: string,
  opts: {
    reason: DismissalReason;
    sendMail: boolean;
    dismissedByUser: HumanDecider | null;
    actor: string;
  },
): Promise<BatchDismissalSummary> {
  const { open } = await listOpenCandidatures(campaignId);
  const summary: BatchDismissalSummary = {
    dismissed: 0,
    deferredSending: 0,
    alreadyDismissed: 0,
    mailsSent: 0,
    mailsFailed: 0,
  };
  for (const { analysis } of open) {
    const result = await dismissCandidature(analysis, {
      reason: opts.reason,
      sendMail: opts.sendMail,
      // Confirmation humaine du flux (récap + bouton) → 'user' + identité.
      dismissedBy: 'user',
      dismissedByUser: opts.dismissedByUser,
      actor: opts.actor,
    });
    if (result.status === 'dismissed') {
      summary.dismissed += 1;
      if (result.mailStatus === 'sent' || result.mailStatus === 'duplicate') {
        summary.mailsSent += 1;
      } else if (
        opts.sendMail &&
        result.mailStatus !== 'not_requested' &&
        result.mailStatus !== 'not_applicable' &&
        result.mailStatus !== 'skipped_no_email'
      ) {
        summary.mailsFailed += 1;
      }
    } else if (result.status === 'deferred_sending') {
      summary.deferredSending += 1;
    } else if (result.status === 'already_dismissed') {
      summary.alreadyDismissed += 1;
    }
  }
  return summary;
}
