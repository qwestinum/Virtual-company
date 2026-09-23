/**
 * L'assistant de création en six étapes — sa LOGIQUE, pure et testée.
 *
 * Trois règles, et elles tiennent tout l'écran :
 *   ① l'ordre des étapes est un tableau, pas une convention éparpillée ;
 *   ② une étape ne laisse passer que si elle est VALIDE, et quand elle bloque
 *      elle NOMME ce qui manque — un bouton grisé muet est la même impasse
 *      qu'un bouton qui ne mène nulle part ;
 *   ③ on ne saute jamais par-dessus une étape non valide (le rail le sait).
 *
 * ⚠️ Rien ici ne parle d'un « seuil », d'une « zone » ni d'une « file » : ce
 * module rend des phrases qui s'affichent telles quelles.
 */

export const ASSISTANT_STEPS = [
  'poste',
  'criteres',
  'reception',
  'suivi',
  'reservation',
  'recapitulatif',
] as const;

export type AssistantStep = (typeof ASSISTANT_STEPS)[number];

/** Libellé du rail — court, il doit tenir sur une ligne à six. */
export const STEP_RAIL_LABELS: Record<AssistantStep, string> = {
  poste: 'Le poste',
  criteres: 'Ce qui compte',
  reception: 'La réception',
  suivi: 'Le suivi',
  reservation: 'La réservation',
  recapitulatif: 'Récapitulatif',
};

/** Titre et sous-titre de l'écran — des phrases, du point de vue du recruteur. */
export const STEP_HEADINGS: Record<AssistantStep, { titre: string; sousTitre: string }> = {
  poste: {
    titre: 'De quel poste s’agit-il ?',
    sousTitre:
      'Le nom de la campagne suivra l’intitulé — vous n’avez pas à le saisir deux fois.',
  },
  criteres: {
    titre: 'Qu’est-ce qui compte pour ce poste ?',
    sousTitre: 'ORQA note chaque candidature sur ces points. Vous gardez la main sur les poids.',
  },
  reception: {
    titre: 'Par où les candidatures vont-elles arriver ?',
    sousTitre:
      'Les candidatures arrivent par ces chemins. La diffusion de l’offre, elle, se règle après le lancement.',
  },
  // ⚠️ L'étape porte DEUX sujets, chacun avec son propre titre dans le corps.
  // Le titre d'écran ne doit donc pas répéter le premier : il annonce les deux.
  suivi: {
    titre: 'Le suivi de ce recrutement',
    sousTitre: 'Deux réglages : qui s’en occupe, et ce qu’ORQA peut décider seul.',
  },
  reservation: {
    titre: 'Comment le candidat choisit-il son créneau ?',
    sousTitre: 'Chaque invitation porte un lien personnel, valable une fois.',
  },
  recapitulatif: {
    titre: 'Tout y est. On lance ?',
    sousTitre: 'Tant que vous n’avez pas lancé, la campagne ne reçoit rien.',
  },
};

/**
 * Ce que l'écran sait de son brouillon — juste assez pour trancher, jamais les
 * objets métier : ce module reste pur et ne dépend d'aucun type de campagne.
 */
export type AssistantFacts = {
  /** Intitulé du poste, déjà trimé par l'appelant. */
  jobTitle: string;
  /**
   * Libellés des champs de la fiche de poste encore vides.
   *
   * ⚠️ L'étape « Le poste » exige la fiche COMPLÈTE, et ce n'est pas une
   * sévérité gratuite : sans elle la campagne ne peut pas s'activer. Ne
   * réclamer que l'intitulé laisserait arriver au récapitulatif avec un bouton
   * « Activer » qui échoue — un mur à la fin, quand tout le reste est saisi.
   * Mieux vaut le dire à l'étape qui porte ces champs.
   */
  missingFdpLabels: string[];
  criteriaCount: number;
  /** Pondérations proposées par l'IA et pas encore confirmées ni écartées. */
  untreatedSuggestions: number;
  /** Façons de recevoir des candidatures retenues (flux). */
  sourceCount: number;
  /** Le flux email est-il retenu ? */
  emailSource: boolean;
  mailboxCount: number;
  thresholdLow: number;
  thresholdHigh: number;
  schedulingNative: boolean;
  /**
   * Le référent a-t-il des disponibilités ? `null` = on n'a pas pu savoir
   * (module injoignable) — on ne bloque JAMAIS sur une ignorance.
   */
  ownerHasAvailability: boolean | null;
  /** Un lieu renseigné est-il complet ? (aucun lieu ⇒ `true`.) */
  meetingLocationComplete: boolean;
};

export type StepVerdict = { ok: true } | { ok: false; reason: string };

const OK: StepVerdict = { ok: true };
const ko = (reason: string): StepVerdict => ({ ok: false, reason });

/**
 * « Il manque : Séniorité, Localisation et 2 autres. » On NOMME, mais on ne
 * déroule pas une liste de huit : au-delà de trois, l'écran lui-même montre
 * lesquels — la phrase n'a qu'à dire combien il en reste.
 */
function manquants(labels: string[]): string {
  const tete = labels.slice(0, 3).join(', ');
  const reste = labels.length - 3;
  return reste > 0
    ? `Il manque : ${tete} et ${reste} autre${reste > 1 ? 's' : ''}.`
    : `Il manque : ${tete}.`;
}

export function validateStep(step: AssistantStep, f: AssistantFacts): StepVerdict {
  switch (step) {
    case 'poste':
      if (f.jobTitle.trim().length === 0) return ko('Il manque l’intitulé du poste.');
      if (f.missingFdpLabels.length > 0) return ko(manquants(f.missingFdpLabels));
      return OK;
    case 'criteres':
      if (f.criteriaCount === 0) return ko('Ajoutez au moins un point de notation.');
      if (f.untreatedSuggestions > 0) {
        const n = f.untreatedSuggestions;
        return ko(
          `${n} pondération${n > 1 ? 's' : ''} proposée${n > 1 ? 's' : ''} par l’IA reste${n > 1 ? 'nt' : ''} à confirmer ou à écarter.`,
        );
      }
      return OK;
    case 'reception':
      if (f.sourceCount === 0) {
        return ko('Choisissez au moins une façon de recevoir les candidatures.');
      }
      if (f.emailSource && f.mailboxCount === 0) {
        return ko('Le flux email demande une boîte mail : choisissez-en une, ou retirez ce flux.');
      }
      return OK;
    case 'suivi':
      return f.thresholdLow <= f.thresholdHigh
        ? OK
        : ko(
            `La note basse (${f.thresholdLow}) dépasse la note haute (${f.thresholdHigh}).`,
          );
    case 'reservation':
      // ⚠️ UN AGENDA VIDE N'EMPÊCHE PAS DE CRÉER. Il a bloqué cette étape le
      // temps d'une livraison, et c'était disproportionné : la réservation
      // native étant désormais le régime par DÉFAUT, toute campagne dont le
      // référent n'a pas encore configuré son agenda butait ici — et la seule
      // sortie offerte était de basculer sur Cal.com, le régime qu'on quitte.
      // Le vrai garde-fou est en aval, à l'invitation (`native_link_unavailable`,
      // qui refuse d'envoyer un lien mort) ; ici l'écran AVERTIT, il n'interdit
      // pas. Un agenda se remplit après, une campagne se crée maintenant.
      if (!f.meetingLocationComplete) {
        return ko('Le lieu de l’entretien est commencé mais incomplet.');
      }
      return OK;
    case 'recapitulatif':
      // Le récapitulatif ne « passe » pas : il ACTIVE, et l'activation a sa
      // propre garde côté store (phases obligatoires, pondérations traitées).
      return OK;
  }
}

export function stepIndex(step: AssistantStep): number {
  return ASSISTANT_STEPS.indexOf(step);
}

export function nextStep(step: AssistantStep): AssistantStep | null {
  return ASSISTANT_STEPS[stepIndex(step) + 1] ?? null;
}

export function prevStep(step: AssistantStep): AssistantStep | null {
  const i = stepIndex(step);
  return i > 0 ? ASSISTANT_STEPS[i - 1]! : null;
}

/**
 * Peut-on aller à `target` ? Oui si toutes les étapes qui la PRÉCÈDENT sont
 * valides. Revenir en arrière est donc toujours permis ; sauter par-dessus un
 * trou, jamais.
 */
export function canReach(target: AssistantStep, f: AssistantFacts): boolean {
  return ASSISTANT_STEPS.slice(0, stepIndex(target)).every(
    (s) => validateStep(s, f).ok,
  );
}

/**
 * Où reprendre un brouillon rouvert : la PREMIÈRE étape non valide. Une
 * campagne dont tout est réglé reprend au récapitulatif — c'est le geste qui
 * reste à faire.
 */
export function resumeStep(f: AssistantFacts): AssistantStep {
  return (
    ASSISTANT_STEPS.find((s) => !validateStep(s, f).ok) ?? 'recapitulatif'
  );
}

/** Étape nommée par l'adresse. Une valeur inconnue ne casse rien : `null`. */
export function parseStep(raw: string | null | undefined): AssistantStep | null {
  return ASSISTANT_STEPS.includes(raw as AssistantStep)
    ? (raw as AssistantStep)
    : null;
}
