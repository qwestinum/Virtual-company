/**
 * Compte rendu d'entretien — contrat partagé client/serveur. PUR.
 * Spec : docs/specs/compte-rendu-entretien.md §3, §5, §14.
 *
 * UNE forme, que le compte rendu soit rédigé à la main ou proposé à partir
 * d'une transcription : le même éditeur l'ouvre, le recruteur le corrige, et
 * les lecteurs (frise, PDF d'audit) le lisent sans savoir d'où il vient —
 * sauf pour la mention, rendue à partir de `source` et des colonnes de
 * vérification, jamais stockée en texte.
 *
 * UN seul champ libre (§18) ; AUCUN champ de score ni d'avis global — un
 * compte rendu restitue.
 */

import { z } from 'zod';

export type InterviewReportSource = 'manual' | 'transcript';
export type InterviewReportStatus = 'draft' | 'verified';

/** Borne du compte rendu : un compte rendu n'est pas une transcription. */
export const MAX_REPORT_CHARS = 20_000;

/**
 * UN SEUL champ libre (arbitrage du 19/09/2026, spec §18) : le recruteur écrit
 * son compte rendu d'un tenant ; les repères (sujets, critères de la campagne,
 * points forts, réserves, à vérifier) sont proposés en texte d'aide, pas en
 * cases. Un compte rendu PROPOSÉ à partir d'une transcription arrive dans ce
 * même champ, organisé par intertitres, et se corrige comme un texte.
 */
const SectionsV2Schema = z.object({
  version: z.literal(2),
  body: z.string().max(MAX_REPORT_CHARS),
});

/**
 * Première forme (18-19/09/2026) : cinq rubriques. Jamais réécrite en base —
 * RELUE et convertie en texte unique, pour qu'aucun compte rendu déjà saisi ne
 * devienne illisible.
 */
const LegacySectionsV1Schema = z.object({
  version: z.literal(1),
  topics: z.string(),
  criteria: z.array(z.object({ criterionId: z.string(), label: z.string(), text: z.string() })),
  highlights: z.string(),
  reservations: z.string(),
  followUps: z.string(),
});

function legacyToBody(v1: z.infer<typeof LegacySectionsV1Schema>): { version: 2; body: string } {
  const blocks: string[] = [];
  const add = (title: string, text: string) => {
    if (text.trim() !== '') blocks.push(`${title}\n${text.trim()}`);
  };
  add('Sujets abordés', v1.topics);
  const criteria = v1.criteria.filter((c) => c.text.trim() !== '');
  if (criteria.length > 0) {
    blocks.push(
      ['Réponses aux critères de la campagne', ...criteria.map((c) => `• ${c.label}\n${c.text.trim()}`)].join('\n'),
    );
  }
  add('Points forts', v1.highlights);
  add('Réserves', v1.reservations);
  add('À vérifier lors d’un prochain échange', v1.followUps);
  return { version: 2, body: blocks.join('\n\n') };
}

export const InterviewReportSectionsSchema = z.preprocess((raw) => {
  const legacy = LegacySectionsV1Schema.safeParse(raw);
  return legacy.success ? legacyToBody(legacy.data) : raw;
}, SectionsV2Schema);

export type InterviewReportSections = z.infer<typeof SectionsV2Schema>;

export type InterviewReport = {
  id: string;
  analysisId: string;
  uid: string;
  campaignId: string | null;
  round: number;
  source: InterviewReportSource;
  status: InterviewReportStatus;
  sections: InterviewReportSections;
  generatedModel: string | null;
  omittedCount: number | null;
  createdByEmail: string | null;
  verifiedByEmail: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Critère de la fiche de scoring proposé comme repère (libellé seul). */
export type ReportCriterionPrompt = { criterionId: string; label: string };

/** Ce que sert `GET /api/candidatures/[id]/interview-report`. */
export type InterviewReportView = {
  report: InterviewReport | null;
  /** Critères de la fiche validée de la campagne, pour les repères. */
  criteria: ReportCriterionPrompt[];
  /**
   * L'entretien a-t-il eu lieu (marqué « réalisé ») ? Sinon il n'y a rien à
   * rendre compte : l'écran n'offre pas la rédaction.
   */
  writable: boolean;
  /** Import de transcription activé pour l'installation (réglage, §14.4). */
  transcriptImportEnabled: boolean;
};

/** Corps de `PUT /api/candidatures/[id]/interview-report`. */
export const InterviewReportSaveSchema = z.object({
  sections: InterviewReportSectionsSchema,
  /** `draft` : enregistrer sans valider. `verify` : valider (auteur + date). */
  action: z.enum(['draft', 'verify']),
});
export type InterviewReportSave = z.infer<typeof InterviewReportSaveSchema>;

/** Un compte rendu vide. */
export function emptySections(): InterviewReportSections {
  return { version: 2, body: '' };
}

/** Le compte rendu dit-il quelque chose ? (Un champ vide ne se valide pas.) */
export function hasReportContent(s: InterviewReportSections): boolean {
  return s.body.trim() !== '';
}

/**
 * Texte d'aide du champ : les repères du compte rendu, dont les critères de la
 * campagne (libellés seuls). Un repère, pas une case à remplir.
 */
export function reportPlaceholder(criteria: ReportCriterionPrompt[]): string {
  const lines = [
    'Sujets abordés : parcours, motivations, projet, conditions…',
    criteria.length > 0
      ? `Réponses aux critères : ${criteria.map((c) => c.label).join(' · ')}`
      : 'Réponses aux critères de la campagne…',
    'Points forts · Réserves · À vérifier lors d’un prochain échange…',
    'Ne consignez que ce qui a un lien direct avec le poste.',
  ];
  return lines.join('\n');
}

/**
 * Intertitres d'un compte rendu PROPOSÉ (ou relu de l'ancienne forme). Ils
 * DIFFÈRENT selon la source : un compte rendu proposé à partir d'une
 * transcription restitue, il ne juge pas — « points forts » y devient « ce que
 * le candidat a mis en avant » (§0.3).
 */
export function sectionLabels(source: InterviewReportSource): Record<
  'topics' | 'criteria' | 'highlights' | 'reservations' | 'followUps',
  string
> {
  return {
    topics: 'Sujets abordés',
    criteria: 'Réponses aux critères de la campagne',
    highlights: source === 'manual' ? 'Points forts' : 'Ce que le candidat a mis en avant',
    reservations:
      source === 'manual' ? 'Réserves' : 'Réserves exprimées pendant l’entretien',
    followUps: 'À vérifier lors d’un prochain échange',
  };
}
