/**
 * Vérifier un BROUILLON d'offre APEC — champ par champ, jamais en bloc.
 *
 * Le validateur (`validateAdepOffer`) ne sait lire qu'une offre COMPLÈTE. Tant
 * que l'un des quatre champs que la fiche ne fournit pas toujours (contrat,
 * statut, expérience, code INSEE) était vide, l'écran se contentait donc d'un
 * « certains champs ne sont pas encore renseignés » : le recruteur devait
 * deviner lesquels, et ne découvrait les autres erreurs qu'après les avoir
 * trouvés. Ici, chaque champ vide produit SA ligne, et le reste de l'offre est
 * validé dans le même passage (les quatre champs vides y sont bouchés par une
 * valeur neutre, et toute remarque qui en découle est écartée).
 *
 * Pur, testé. Aucune dépendance React.
 */
import type { AdepOffer } from '@/types/adep';

import {
  JOB_TYPES_WITH_DURATION,
  NIVEAU_EXPERIENCE_CODES,
  STATUT_POSTE_CODES,
  TYPE_CONTRAT_CODES,
} from './domains';
import { completeDraft, type AdepDraftOffer } from './mapping';
import { validateAdepOffer, type AdepIssue } from './validate';

/** Libellés des champs, tels que l'écran les affiche. */
export const APEC_FIELD_LABELS: Partial<Record<keyof AdepOffer, string>> = {
  positionTitle: 'Intitulé du poste',
  positionDescription: 'Descriptif du poste',
  profileDescription: 'Description du profil',
  organizationDescription: 'Description de l’entreprise',
  jobType: 'Type de contrat',
  durationMonths: 'Durée (mois)',
  statusJob: 'Statut du poste',
  experienceLevel: 'Expérience attendue',
  inseeCode: 'Commune (code INSEE)',
  travelZone: 'Zone de déplacement',
  salaryMin: 'Salaire minimum (€/an)',
  salaryMax: 'Salaire maximum (€/an)',
  displayedPay: 'Affichage du salaire',
  partTimeDuration: 'Modalité du temps partiel',
  numberToFill: 'Nombre de postes',
  positionType: 'Type d’offre',
};

/** Les champs que le brouillon peut laisser vides (cf. `completeDraft`). */
const NULLABLE_FIELDS = ['jobType', 'statusJob', 'experienceLevel', 'inseeCode'] as const;

/** Champs dont les règles dépendent du contrat : muets tant qu'il n'est pas choisi. */
const DEPENDS_ON_CONTRACT = new Set(['durationMonths', 'educationLevel']);

/**
 * Un champ est-il obligatoire pour l'Apec, compte tenu de ce qui est déjà
 * choisi ? Sert à l'astérisque — il doit donc suivre les MÊMES règles que le
 * validateur (durée selon le contrat, salaire hors stage, modalité si temps
 * partiel), sinon l'écran promettrait un champ facultatif que l'Apec refuse.
 */
export function isApecFieldRequired(field: keyof AdepOffer, draft: AdepDraftOffer): boolean {
  switch (field) {
    case 'durationMonths':
      return draft.jobType != null && JOB_TYPES_WITH_DURATION.has(draft.jobType);
    case 'salaryMin':
    case 'salaryMax':
      return draft.jobType !== '9';
    case 'partTimeDuration':
      return draft.partTime;
    case 'remoteWork':
      return false;
    default:
      return field in APEC_FIELD_LABELS;
  }
}

/** Vérifie un brouillon : une ligne par champ manquant, puis le reste de l'offre. */
export function checkAdepDraft(draft: AdepDraftOffer, today: string): AdepIssue[] {
  const missing = NULLABLE_FIELDS.filter((f) => draft[f] == null);
  const complete = completeDraft(
    {
      ...draft,
      // Valeurs NEUTRES, valides au regard du validateur : leurs remarques
      // éventuelles sont écartées plus bas, elles ne parlent pas de l'offre.
      jobType: draft.jobType ?? TYPE_CONTRAT_CODES[0],
      statusJob: draft.statusJob ?? STATUT_POSTE_CODES[0],
      experienceLevel: draft.experienceLevel ?? NIVEAU_EXPERIENCE_CODES[0],
      inseeCode: draft.inseeCode ?? '37261',
    },
    'preview',
  );
  const missingIssues: AdepIssue[] = missing.map((field) => ({
    level: 'error',
    field,
    message: `${APEC_FIELD_LABELS[field]} : champ obligatoire à renseigner.`,
    preventsCode: '023',
  }));
  if (!complete) return missingIssues;

  const report = validateAdepOffer(complete, today);
  const blind = new Set<string>(missing);
  const rest = [...report.errors, ...report.warnings].filter(
    (i) =>
      !blind.has(i.field) && !(draft.jobType == null && DEPENDS_ON_CONTRACT.has(i.field)),
  );
  return [...missingIssues, ...rest];
}

/** Section du panneau où vit un champ — pour l'ouvrir quand il est en faute. */
export function apecSectionOf(field: string): 'annonce' | 'exigences' | null {
  if (
    field === 'positionTitle' ||
    field === 'positionDescription' ||
    field === 'profileDescription' ||
    field === 'organizationDescription'
  ) {
    return 'annonce';
  }
  return field in APEC_FIELD_LABELS ? 'exigences' : null;
}

/** Premier message d'ERREUR par champ — ce que la ligne du champ affiche. */
export function errorsByField(issues: AdepIssue[] | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const i of issues ?? []) {
    if (i.level === 'error' && !out.has(i.field)) out.set(i.field, i.message);
  }
  return out;
}
