/**
 * Correction d'une décision candidat posée par erreur — cœur SERVEUR.
 *
 * TROIS invariants, dans cet ordre d'importance :
 *
 *   1. **Aucun envoi, jamais.** Quel que soit le nouvel état — même quand il
 *      correspondrait normalement à un envoi (invitation, refus). La
 *      correction remet le dossier dans l'état voulu ; c'est ensuite à
 *      l'humain de déclencher une action depuis les surfaces normales. Même
 *      principe que le re-scoring : une invitation partie deux semaines après
 *      coup fait plus de mal qu'un dossier resté faux un jour de plus. Ce
 *      module n'importe donc NI `sendEmail`, NI `sendValidation`, NI aucune
 *      émission de lien.
 *
 *   2. **Aucun chemin d'écriture parallèle.** Le nouvel état est posé par le
 *      writer CANONIQUE de sa famille : entrée de journal bâtie par
 *      `decision-markers` pour les marqueurs, `updateCandidateAnalysisDecision`
 *      pour les colonnes de screening, `reopenCandidature` pour le classement
 *      sans suite. Rien n'est supprimé ni réécrit — le journal reste en ajout
 *      seul, sémantique dernier-gagne.
 *
 *   3. **La cible est VALIDÉE contre les options du contexte.** Le serveur ne
 *      fait pas confiance au client sur ce qui est corrigible : une cible
 *      absente des options courantes est refusée. C'est ce qui empêche de
 *      « corriger » un dossier qui n'a rien de décidé, ou de sauter une étape.
 *
 * Seule exception au « on ne touche à rien d'autre » : un lien de réservation
 * encore ACTIF est révoqué quand la correction écarte la candidature — c'est
 * ce que fait déjà le refus normal, une révocation ne notifie personne, et un
 * candidat écarté qui garde un lien vivant peut réserver un entretien sur un
 * dossier fermé. Le dialog l'ANNONCE avant confirmation et la révocation est
 * tracée dans `decision_corrected`.
 */

import {
  CORRECTION_TARGET_STATE_LABELS,
  currentDecisionLabel,
} from '@/lib/candidatures/correction-options';
import { reopenCandidature } from '@/lib/candidatures/dismissal';
import {
  getCandidateAnalysis,
  updateCandidateAnalysisDecision,
} from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import { revokeCampaignBookingLink } from '@/lib/scheduling-host/campaign-booking';
import type {
  CorrectionTarget,
  DecisionCorrectionContext,
  DecisionCorrectionResult,
} from '@/types/decision-correction';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

import {
  buildInterviewMarkerEntry,
  buildValidationMarkerEntry,
  DECISION_CORRECTED_ACTION,
  type InterviewMarkValue,
  type ValidationMarkValue,
} from './decision-markers';

export type CorrectionFailure =
  | { status: 'not_correctable' }
  | { status: 'invalid_target' }
  | { status: 'reopen_failed' };

export type CorrectionOutcome = DecisionCorrectionResult | CorrectionFailure;

/**
 * Traduction cible → geste. `switch` EXHAUSTIF sur l'union fermée : une cible
 * ajoutée sans traitement ne compile pas.
 */
type Plan =
  | { family: 'interview'; value: InterviewMarkValue }
  | { family: 'verdict'; value: ValidationMarkValue }
  | { family: 'screening'; status: 'accepted' | 'rejected' }
  | { family: 'reopen' };

function planFor(target: CorrectionTarget): Plan {
  switch (target) {
    case 'interview_realized':
      return { family: 'interview', value: 'realized' };
    case 'interview_missed':
      return { family: 'interview', value: 'missed' };
    case 'interview_cleared':
      return { family: 'interview', value: 'cleared' };
    case 'verdict_validated':
      return { family: 'verdict', value: 'validated' };
    case 'verdict_rejected':
      return { family: 'verdict', value: 'rejected' };
    case 'verdict_cleared':
      return { family: 'verdict', value: 'cleared' };
    case 'screening_accepted':
      return { family: 'screening', status: 'accepted' };
    case 'screening_rejected':
      return { family: 'screening', status: 'rejected' };
    case 'dismissal_reopen':
      return { family: 'reopen' };
    default: {
      const never: never = target;
      throw new Error(`Cible de correction non traitée : ${String(never)}`);
    }
  }
}

/** La correction écarte-t-elle la candidature ? (seul cas où un lien meurt) */
function closesCandidature(plan: Plan): boolean {
  return (
    (plan.family === 'interview' && plan.value === 'missed') ||
    (plan.family === 'verdict' && plan.value === 'rejected') ||
    (plan.family === 'screening' && plan.status === 'rejected')
  );
}

export async function applyDecisionCorrection(args: {
  analysis: CandidateAnalysisSummary;
  /** Contexte fraîchement relu côté serveur (jamais celui du client). */
  context: DecisionCorrectionContext;
  target: CorrectionTarget;
  reason: string | null;
  actor: HumanDecider | null;
}): Promise<CorrectionOutcome> {
  const { analysis, context, target, reason, actor } = args;

  if (!context.current) return { status: 'not_correctable' };
  // Garde 3 : la cible doit figurer parmi les options RÉELLEMENT offertes
  // pour la décision courante, relues côté serveur.
  if (!context.options.some((o) => o.target === target)) {
    return { status: 'invalid_target' };
  }

  const plan = planFor(target);
  const previousLabel = currentDecisionLabel(context.current);
  const nextLabel = CORRECTION_TARGET_STATE_LABELS[target];

  switch (plan.family) {
    case 'interview':
      await appendJournalEntry({
        ...buildInterviewMarkerEntry({
          uid: analysis.uid,
          candidateName: analysis.candidateName,
          campaignId: analysis.campaignId,
          value: plan.value,
          corrected: true,
        }),
        actor: 'user',
      });
      break;
    case 'verdict':
      await appendJournalEntry({
        ...buildValidationMarkerEntry({
          uid: analysis.uid,
          candidateName: analysis.candidateName,
          campaignId: analysis.campaignId,
          value: plan.value,
          corrected: true,
        }),
        actor: 'user',
      });
      break;
    case 'screening':
      // Writer canonique — le MÊME que celui de la décision HITL normale.
      await updateCandidateAnalysisDecision({
        uid: analysis.uid,
        campaignId: analysis.campaignId,
        status: plan.status,
        decidedByUser: actor,
      });
      break;
    case 'reopen': {
      const result = await reopenCandidature(analysis, 'user');
      if (result === 'not_dismissed') return { status: 'reopen_failed' };
      break;
    }
  }

  // Lien de réservation : révoqué UNIQUEMENT quand la correction écarte la
  // candidature, et seulement s'il en restait un actif (annoncé au dialog).
  let linkRevoked = false;
  if (closesCandidature(plan) && context.sideEffects.some((e) => e.code === 'link_active')) {
    await revokeCampaignBookingLink(
      analysis.campaignId,
      analysis.id,
      'décision corrigée',
    )
      .then(() => {
        linkRevoked = true;
      })
      .catch((err) =>
        // Best-effort : un lien encore vivant ne doit pas faire échouer
        // l'enregistrement d'une correction déjà décidée. Le journal dira
        // alors `linkRevoked: false` — jamais un succès qu'on n'a pas obtenu.
        console.error('[decision-correction] révocation du lien KO', err),
      );
  }

  // Étape RE-DÉRIVÉE après écriture : on rend l'état réel, jamais celui qu'on
  // espérait poser.
  const nextStage = await resolveStageAfter(analysis);

  await appendJournalEntry({
    action: DECISION_CORRECTED_ACTION,
    campaignId: analysis.campaignId,
    actor: 'user',
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      candidate: analysis.candidateName,
      kind: context.current.kind,
      target,
      previousStage: context.stage,
      nextStage,
      previousLabel,
      nextLabel,
      reason,
      linkRevoked,
      // Identité de la SESSION serveur, jamais un champ du client.
      by: actor?.email ?? null,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  });

  return {
    status: 'corrected',
    previousStage: context.stage,
    nextStage,
    linkRevoked,
  };
}

async function resolveStageAfter(
  analysis: CandidateAnalysisSummary,
): Promise<DecisionCorrectionResult['nextStage']> {
  const fresh = (await getCandidateAnalysis(analysis.id).catch(() => null)) ?? analysis;
  const signals = await loadStageSignals(
    fresh.campaignId ? { campaignId: fresh.campaignId } : {},
  );
  return stageFor(fresh, signals);
}
