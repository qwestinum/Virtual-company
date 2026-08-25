/**
 * Quelle décision corrige-t-on, et par quoi ? PUR, CLIENT-SAFE, testable.
 *
 * La décision COURANTE d'un dossier est le signal le plus haut de l'échelle de
 * `deriveCandidateStage` — c'est celui-là qu'on corrige, pas un autre. Cette
 * priorité est donc reprise à l'identique ici : la faire diverger ferait
 * proposer de corriger un marquage d'entretien sur un dossier déjà tranché.
 *
 * Deux familles :
 *   - marqueurs journal (entretien, verdict final) → une nouvelle entrée ;
 *   - colonnes (décision de screening/HITL, classement sans suite) → le writer
 *     canonique existant. Elles n'ont PAS de marqueur, on ne les y force pas.
 */

import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { DismissalReason } from '@/types/dismissal';
import type {
  CorrectionOption,
  CorrectionTarget,
  CurrentDecision,
} from '@/types/decision-correction';

import type {
  InterviewMarkEffect,
  ValidationMarkEffect,
} from './decision-markers';

export type CurrentDecisionInput = {
  /** Étape dérivée (source de vérité de l'état courant). */
  stage: CandidateStage;
  interviewEffect: InterviewMarkEffect;
  validationEffect: ValidationMarkEffect;
  dismissalReason: DismissalReason | null;
};

/**
 * Décision corrigible du dossier, ou `null` s'il n'y en a aucune (rien n'a
 * encore été décidé : `a_valider`). L'action « Corriger la décision » ne
 * s'affiche que sur un retour non nul.
 */
export function resolveCurrentDecision(
  input: CurrentDecisionInput,
): CurrentDecision | null {
  // Priorité 0 — le classement sans suite domine tout (terminal orthogonal).
  if (input.stage === 'sans_suite') {
    return { kind: 'dismissal', reason: input.dismissalReason };
  }
  // 1-2 — verdict final, puis marquage d'entretien (mêmes rangs que la dérivation).
  if (input.validationEffect !== null) {
    return { kind: 'final_verdict', value: input.validationEffect };
  }
  if (input.interviewEffect !== null) {
    return { kind: 'interview', value: input.interviewEffect };
  }
  // 3 — décision de screening portée par les COLONNES. Un dossier encore en
  // file (`a_valider`) n'a rien de décidé : il n'y a rien à corriger.
  switch (input.stage) {
    case 'invite':
    case 'rdv_pris':
      return { kind: 'screening_decision', value: 'accepted', auto: false };
    case 'non_retenu':
      return { kind: 'screening_decision', value: 'rejected', auto: false };
    case 'refus_auto':
      // Ancien régime : le refus est parti tout seul. Requalifiable comme les
      // autres — c'est même le cas qui en a le plus besoin.
      return { kind: 'screening_decision', value: 'rejected', auto: true };
    case 'a_valider':
      return null;
    // Traités plus haut par leurs marqueurs ; sans marqueur lisible, il n'y a
    // pas de décision à corriger (on ne devine pas). `sans_suite` est déjà
    // sorti en tête.
    case 'retenu':
    case 'entretien_fait':
      return null;
    default:
      return null;
  }
}

const CLEARED_INTERVIEW: CorrectionOption = {
  target: 'interview_cleared',
  label: 'Annuler ce marquage',
  detail:
    'Le dossier revient à son étape antérieure (invité ou rendez-vous pris). Aucune décision n’est posée.',
};

const CLEARED_VERDICT: CorrectionOption = {
  target: 'verdict_cleared',
  label: 'Annuler ce verdict',
  detail:
    'Le dossier revient à « Entretien fait », en attente de décision. Aucune décision n’est posée.',
};

/** Options VALIDES pour cette décision — jamais un choix sans destination. */
export function correctionOptionsFor(
  current: CurrentDecision,
): CorrectionOption[] {
  switch (current.kind) {
    case 'interview':
      return current.value === 'realized'
        ? [
            {
              target: 'interview_missed',
              label: 'Entretien non réalisé',
              detail:
                'Le candidat ne s’est pas présenté. Le dossier passe en « Non retenu ».',
            },
            CLEARED_INTERVIEW,
          ]
        : [
            {
              target: 'interview_realized',
              label: 'Entretien réalisé',
              detail:
                'L’entretien a bien eu lieu. Le dossier passe en attente de verdict.',
            },
            CLEARED_INTERVIEW,
          ];
    case 'final_verdict':
      return current.value === 'validated'
        ? [
            {
              target: 'verdict_rejected',
              label: 'Non retenu',
              detail: 'Le dossier est clôturé sur un verdict négatif.',
            },
            CLEARED_VERDICT,
          ]
        : [
            {
              target: 'verdict_validated',
              label: 'Retenu — GO définitif',
              detail: 'Le dossier passe en « Retenu ».',
            },
            CLEARED_VERDICT,
          ];
    case 'screening_decision':
      return current.value === 'accepted'
        ? [
            {
              target: 'screening_rejected',
              label: 'Requalifier en non retenu',
              detail:
                'La candidature est écartée. Aucun mail de refus ne part.',
            },
          ]
        : [
            {
              target: 'screening_accepted',
              label: 'Requalifier en accepté',
              detail:
                'Le dossier repasse en « Invité ». Aucune invitation ne part — à déclencher depuis Entretiens.',
            },
          ];
    case 'dismissal':
      return [
        {
          target: 'dismissal_reopen',
          label: 'Rouvrir la candidature',
          detail:
            'Le classement est levé, le dossier reprend son étape antérieure.',
        },
      ];
    default:
      return [];
  }
}

/** Ce que la correction NE fait pas — dit avant de confirmer, pas après. */
export function correctionNoticesFor(current: CurrentDecision): string[] {
  const common =
    'Aucun message ne partira, quel que soit le nouvel état choisi.';
  switch (current.kind) {
    case 'screening_decision':
      return [
        common,
        'Pour recontacter le candidat, utilisez « Renvoyer une invitation » depuis l’onglet Entretiens.',
        'La remise en attente de validation n’est pas proposée : recréer une file de validation n’est pas une correction.',
      ];
    case 'interview':
    case 'final_verdict':
      return [common];
    case 'dismissal':
      return [
        common,
        'Un mail d’information déjà envoyé au candidat ne peut pas être annulé.',
      ];
    default:
      return [common];
  }
}

/**
 * État RÉSULTANT de chaque cible — ce qu'on écrit dans le journal
 * (`previousLabel → nextLabel`) et ce que lit le fil d'activité. Distinct du
 * `label` de l'option, qui est un ordre (« Annuler ce marquage ») là où
 * celui-ci est un état.
 */
export const CORRECTION_TARGET_STATE_LABELS: Record<CorrectionTarget, string> = {
  interview_realized: 'Entretien réalisé',
  interview_missed: 'Entretien non réalisé',
  interview_cleared: 'Marquage d’entretien retiré',
  verdict_validated: 'Retenu',
  verdict_rejected: 'Non retenu',
  verdict_cleared: 'Verdict final retiré',
  screening_accepted: 'Accepté — invité',
  screening_rejected: 'Non retenu',
  dismissal_reopen: 'Candidature rouverte',
};

/** Libellé de l'état courant tel qu'annoncé en tête du dialog. */
export function currentDecisionLabel(current: CurrentDecision): string {
  switch (current.kind) {
    case 'interview':
      return current.value === 'realized'
        ? 'Entretien réalisé'
        : 'Entretien non réalisé';
    case 'final_verdict':
      return current.value === 'validated'
        ? 'Retenu — GO définitif'
        : 'Non retenu';
    case 'screening_decision':
      if (current.value === 'accepted') return 'Candidature acceptée';
      return current.auto
        ? 'Refus automatique (ancien régime)'
        : 'Candidature refusée';
    case 'dismissal':
      return 'Classée sans suite';
    default:
      return 'Décision';
  }
}
