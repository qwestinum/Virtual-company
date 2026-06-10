/**
 * Dérivation du PARCOURS candidat — modèle à 4 PHASES (cf. demande de
 * traçabilité). CLIENT-SAFE, PUR, testable.
 *
 * Source de vérité unique : le JOURNAL que le dashboard écrit déjà + la file
 * HITL (`pending_validations`). L'audit LIT et dérive — il ne pilote rien.
 *
 * Les 4 phases sont séquentielles ; les états d'une MÊME phase sont
 * mutuellement exclusifs (« non superposables ») → affichage en colonnes.
 *
 *   1. Présélection  : Retenu | Écarté                    (verdict screening)
 *   2. Validation RH : En attente | Retenu pour entretien | Écarté
 *   3. Entretien     : En attente | Réalisé | Non réalisé
 *   4. Décision fin. : En attente | Retenu déf. | Écarté déf.
 *
 * + `humanIntervention` : la décision humaine CONTREDIT le verdict IA du
 *   screening (le recruteur a « switché » l'issue).
 */

import type { HitlConfig } from '@/types/hitl';
import type { CandidateStatus } from '@/types/scoring';

export type ScreeningState = 'retenu' | 'ecarte';
export type ValidationState = 'na' | 'en_attente' | 'retenu_entretien' | 'ecarte';
export type InterviewState = 'na' | 'en_attente' | 'realise' | 'non_realise';
export type FinalState = 'na' | 'en_attente' | 'retenu' | 'ecarte';

export type CandidateJourney = {
  screening: ScreeningState;
  validation: ValidationState;
  interview: InterviewState;
  final: FinalState;
  /** La décision humaine a-t-elle contredit le verdict IA du screening ? */
  humanIntervention: boolean;
};

/** Tonalité d'affichage (couleur) d'un état. */
export type JourneyTone =
  | 'positive'
  | 'negative'
  | 'screening_out'
  | 'pending'
  | 'neutral';

export const JOURNEY_TONE_COLORS: Record<JourneyTone, string> = {
  positive: '#15803d', // green-700
  negative: '#b91c1c', // red-700 — écarté définitivement
  screening_out: '#f97316', // orange-500 — écarté AU SCREENING (≠ définitif)
  pending: '#b45309', // amber-700
  neutral: '#a8a29e', // stone-400
};

// ─── Libellés + tonalités par phase ───────────────────────────────────────

export const SCREENING_LABELS: Record<ScreeningState, string> = {
  retenu: 'Retenu',
  ecarte: 'Écarté',
};
export const VALIDATION_LABELS: Record<ValidationState, string> = {
  na: '—',
  en_attente: 'En attente de validation',
  retenu_entretien: 'Retenu pour entretien',
  ecarte: 'Écarté',
};
export const INTERVIEW_LABELS: Record<InterviewState, string> = {
  na: '—',
  en_attente: 'En attente',
  realise: 'Réalisé',
  non_realise: 'Non réalisé',
};
export const FINAL_LABELS: Record<FinalState, string> = {
  na: '—',
  en_attente: 'En attente',
  retenu: 'Retenu définitivement',
  ecarte: 'Écarté définitivement',
};

function toneOf(
  state: ScreeningState | ValidationState | InterviewState | FinalState,
): JourneyTone {
  switch (state) {
    case 'retenu':
    case 'retenu_entretien':
    case 'realise':
      return 'positive';
    case 'ecarte':
    case 'non_realise':
      return 'negative';
    case 'en_attente':
      return 'pending';
    default:
      return 'neutral';
  }
}

/**
 * Tonalité de la PRÉSÉLECTION : « écarté au screening » est distinct d'un
 * « écarté définitivement » (rouge-orangé vs rouge) — c'est un filtrage IA
 * précoce, pas la décision finale d'un humain.
 */
function screeningTone(state: ScreeningState): JourneyTone {
  return state === 'retenu' ? 'positive' : 'screening_out';
}

// ─── Entrée de dérivation ──────────────────────────────────────────────────

export type CandidateJourneyInput = {
  /** Verdict du screening (analyse CV). */
  screeningStatus: CandidateStatus;
  /** L'analyse est dans la file HITL, en attente d'une décision humaine. */
  isPendingValidation: boolean;
  /**
   * Statut dérivé côté dashboard (encode l'invitation / le refus) :
   * 'analyzed' | 'invited' | 'scheduled' | 'interview_done' | 'rejected'.
   */
  dashboardStatus:
    | 'analyzed'
    | 'invited'
    | 'scheduled'
    | 'interview_done'
    | 'rejected';
  interviewMarked: 'realized' | 'missed' | null;
  validationMarked: 'validated' | 'rejected' | null;
  /** Recommandation finale du dashboard (intègre l'override HITL). */
  recommendation: 'go' | 'no-go' | null;
  /**
   * Toggle HITL FIGÉ — validation du REFUS requise. ON → un refus de
   * screening est provisoire (« Écarté au screening ») jusqu'à confirmation ;
   * OFF → définitif d'emblée (pas d'attente humaine).
   */
  rejectionGated: boolean;
  /**
   * Toggle HITL FIGÉ — validation de l'ACCEPTATION requise. ON → un retenu
   * reste « Retenu au screening » (en attente) ; OFF → « Retenu pour
   * entretien » directement (auto).
   */
  acceptanceGated: boolean;
};

/** Dérive les 4 phases + le drapeau d'intervention humaine. */
export function deriveCandidateJourney(
  input: CandidateJourneyInput,
): CandidateJourney {
  const {
    screeningStatus,
    dashboardStatus,
    interviewMarked,
    validationMarked,
    recommendation,
    rejectionGated,
    acceptanceGated,
  } = input;
  const aiGo = screeningStatus === 'accepted';

  // Phase 1 — présélection (toujours déterminée).
  const screening: ScreeningState = aiGo ? 'retenu' : 'ecarte';

  const invited =
    interviewMarked !== null ||
    dashboardStatus === 'invited' ||
    dashboardStatus === 'scheduled' ||
    dashboardStatus === 'interview_done';

  // Un REFUS au screening est-il DÉFINITIF ? HITL refus OFF → définitif
  // d'emblée. HITL refus ON → définitif seulement une fois le refus envoyé
  // (dashboardStatus 'rejected') ; sinon provisoire (« Écarté au screening »).
  const screeningRejectDefinitive =
    !aiGo && (!rejectionGated || dashboardStatus === 'rejected');

  // Phase 2 — validation RH (uniquement si retenu au screening).
  let validation: ValidationState;
  if (!aiGo) {
    validation = 'na';
  } else if (invited) {
    validation = 'retenu_entretien';
  } else if (dashboardStatus === 'rejected') {
    // Refus envoyé après un screening positif (sans entretien).
    validation = 'ecarte';
  } else if (acceptanceGated) {
    // HITL acceptation ON, rien d'acté → en attente (« Retenu au screening »).
    validation = 'en_attente';
  } else {
    // HITL acceptation OFF → auto : retenu pour entretien directement.
    validation = 'retenu_entretien';
  }

  // Phase 3 — entretien (uniquement si retenu pour entretien).
  let interview: InterviewState;
  if (validation !== 'retenu_entretien') {
    interview = 'na';
  } else if (interviewMarked === 'realized') {
    interview = 'realise';
  } else if (interviewMarked === 'missed') {
    interview = 'non_realise';
  } else {
    interview = 'en_attente';
  }

  // Phase 4 — décision finale. « Écarté définitivement » = point de
  // convergence : décision finale humaine (rejet), entretien non réalisé,
  // refus envoyé après screening positif, OU refus de screening rendu
  // définitif (HITL refus OFF / refus confirmé).
  let final: FinalState;
  if (validationMarked === 'validated') {
    final = 'retenu';
  } else if (validationMarked === 'rejected') {
    final = 'ecarte';
  } else if (interview === 'non_realise') {
    final = 'ecarte';
  } else if (validation === 'ecarte') {
    final = 'ecarte';
  } else if (screeningRejectDefinitive) {
    final = 'ecarte';
  } else if (validation === 'retenu_entretien') {
    final = 'en_attente';
  } else {
    final = 'na';
  }

  // Intervention humaine = décision humaine contredisant le verdict IA :
  //   - override outreach (reco finale ≠ verdict screening) ;
  //   - décision finale contradictoire (validé écarté / refusé recommandé).
  const finalGo = recommendation === 'go';
  const humanIntervention =
    finalGo !== aiGo ||
    (validationMarked === 'validated' && !aiGo) ||
    (validationMarked === 'rejected' && aiGo);

  return { screening, validation, interview, final, humanIntervention };
}

// ─── Vue « colonnes » + état courant ───────────────────────────────────────

export type JourneyColumn = {
  key: 'screening' | 'validation' | 'interview' | 'final';
  title: string;
  label: string;
  tone: JourneyTone;
  /** L'étape a-t-elle été atteinte (false = grisée). */
  reached: boolean;
};

/** Les 4 colonnes prêtes à l'affichage (détail + PDF). */
export function journeyColumns(j: CandidateJourney): JourneyColumn[] {
  return [
    {
      key: 'screening',
      title: 'Présélection',
      label: SCREENING_LABELS[j.screening],
      // Refus provisoire → orange ; refus devenu définitif → rouge.
      tone:
        j.screening === 'retenu'
          ? 'positive'
          : j.final === 'ecarte'
            ? 'negative'
            : 'screening_out',
      reached: true,
    },
    {
      key: 'validation',
      title: 'Validation RH',
      label: VALIDATION_LABELS[j.validation],
      tone: toneOf(j.validation),
      reached: j.validation !== 'na',
    },
    {
      key: 'interview',
      title: 'Entretien',
      label: INTERVIEW_LABELS[j.interview],
      tone: toneOf(j.interview),
      reached: j.interview !== 'na',
    },
    {
      key: 'final',
      title: 'Décision finale',
      label: FINAL_LABELS[j.final],
      tone: toneOf(j.final),
      reached: j.final !== 'na',
    },
  ];
}

/**
 * État le PLUS AVANCÉ atteint — pour la pastille compacte de la liste.
 * Précédence : décision finale > entretien > validation > présélection.
 */
export function journeyCurrentState(j: CandidateJourney): {
  label: string;
  tone: JourneyTone;
} {
  if (j.final === 'retenu' || j.final === 'ecarte') {
    return { label: FINAL_LABELS[j.final], tone: toneOf(j.final) };
  }
  if (j.interview === 'realise' || j.interview === 'non_realise') {
    return { label: `Entretien ${INTERVIEW_LABELS[j.interview].toLowerCase()}`, tone: toneOf(j.interview) };
  }
  if (j.validation !== 'na') {
    // Retenu par le système, en attente de validation humaine.
    const label =
      j.validation === 'en_attente'
        ? 'Retenu au screening'
        : VALIDATION_LABELS[j.validation];
    return { label, tone: toneOf(j.validation) };
  }
  return {
    label: j.screening === 'retenu' ? 'Retenu (présélection)' : 'Écarté au screening',
    tone: screeningTone(j.screening),
  };
}

/** Clés d'état courant filtrables dans la sélection (regroupe les phases). */
export const JOURNEY_FILTER_STATES = [
  'en_attente_validation',
  'retenu_entretien',
  'entretien_realise',
  'retenu_definitif',
  'ecarte',
] as const;
export type JourneyFilterState = (typeof JOURNEY_FILTER_STATES)[number];

export const JOURNEY_FILTER_LABELS: Record<JourneyFilterState, string> = {
  en_attente_validation: 'Retenu au screening',
  retenu_entretien: 'Retenu pour entretien',
  entretien_realise: 'Entretien réalisé',
  retenu_definitif: 'Retenu définitivement',
  ecarte: 'Écarté',
};

/** Mappe un parcours sur une clé de filtre (état courant simplifié). */
export function journeyFilterKey(j: CandidateJourney): JourneyFilterState {
  if (j.final === 'retenu') return 'retenu_definitif';
  if (j.final === 'ecarte' || j.validation === 'ecarte' || j.screening === 'ecarte') {
    return 'ecarte';
  }
  if (j.interview === 'realise') return 'entretien_realise';
  if (j.validation === 'retenu_entretien') return 'retenu_entretien';
  return 'en_attente_validation';
}

// ─── Helper endpoint (fallback sans marqueurs) ─────────────────────────────

/**
 * Dérive le parcours à partir du verdict screening + de l'état HITL FIGÉ
 * (snapshot à l'analyse) + des marqueurs journal éventuels. Sans marqueurs,
 * retombe sur le verdict screening modulé par les toggles HITL.
 */
export function deriveJourneyFor(
  screeningStatus: CandidateStatus,
  hitlConfig: HitlConfig,
  markers?: {
    dashboardStatus: CandidateJourneyInput['dashboardStatus'];
    interviewMarked: 'realized' | 'missed' | null;
    validationMarked: 'validated' | 'rejected' | null;
    recommendation: 'go' | 'no-go' | null;
  },
  isPendingValidation = false,
): CandidateJourney {
  return deriveCandidateJourney({
    screeningStatus,
    isPendingValidation,
    dashboardStatus: markers?.dashboardStatus ?? 'analyzed',
    interviewMarked: markers?.interviewMarked ?? null,
    validationMarked: markers?.validationMarked ?? null,
    recommendation:
      markers?.recommendation ??
      (screeningStatus === 'accepted' ? 'go' : null),
    rejectionGated: hitlConfig.rejectionMail,
    acceptanceGated: hitlConfig.acceptanceMail,
  });
}
