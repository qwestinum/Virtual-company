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
 * Cinq rubriques, TOUTES facultatives : un gabarit souple, pas un formulaire.
 * AUCUN champ de score ni d'avis global — un compte rendu restitue.
 */

import { z } from 'zod';

export type InterviewReportSource = 'manual' | 'transcript';
export type InterviewReportStatus = 'draft' | 'verified';

/** Borne par rubrique : un compte rendu n'est pas une transcription. */
export const MAX_SECTION_CHARS = 6000;

const Text = z.string().max(MAX_SECTION_CHARS);

export const InterviewReportSectionsSchema = z.object({
  version: z.literal(1),
  /** Sujets abordés. */
  topics: Text,
  /** Réponses aux critères de la campagne — un bloc par critère, libellé figé. */
  criteria: z
    .array(
      z.object({
        criterionId: z.string().max(200),
        label: z.string().max(500),
        text: Text,
      }),
    )
    .max(60),
  /** Points forts (rédigé) / ce que le candidat a mis en avant (proposé). */
  highlights: Text,
  /** Réserves (rédigé) / réserves exprimées pendant l'entretien (proposé). */
  reservations: Text,
  /** À vérifier lors d'un prochain échange. */
  followUps: Text,
});

export type InterviewReportSections = z.infer<typeof InterviewReportSectionsSchema>;

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

/** Rubriques vides, avec les critères de la campagne en repères. */
export function emptySections(criteria: ReportCriterionPrompt[]): InterviewReportSections {
  return {
    version: 1,
    topics: '',
    criteria: criteria.map((c) => ({ criterionId: c.criterionId, label: c.label, text: '' })),
    highlights: '',
    reservations: '',
    followUps: '',
  };
}

/** Le compte rendu dit-il quelque chose ? (Un gabarit vide ne se valide pas.) */
export function hasReportContent(s: InterviewReportSections): boolean {
  return (
    [s.topics, s.highlights, s.reservations, s.followUps].some((t) => t.trim() !== '') ||
    s.criteria.some((c) => c.text.trim() !== '')
  );
}

/**
 * Libellés des rubriques. Ils DIFFÈRENT selon la source : un compte rendu
 * proposé à partir d'une transcription restitue, il ne juge pas — « points
 * forts » y devient « ce que le candidat a mis en avant » (§0.3).
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
