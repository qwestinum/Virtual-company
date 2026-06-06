import { z } from 'zod';

import { CVSourceSchema } from './cv-source';
import { ScoreResultSchema } from './scoring';

/**
 * Seuil d'acceptation hardcodé pour la Session 4. La spec §6.3 prévoit
 * un slider direct UI en Session 5 ; tant que le réglage n'est pas
 * exposé, on tient sur 75 (cohérent avec les exemples du brief).
 */
export const DEFAULT_CV_THRESHOLD = 75;

// ───────────────────────────────────────────────────────────────────────────
// Modèle de la séparation extraction / scoring / narration (C1→C6).
//
// `JobApplicationData` = données candidat FACTUELLES ANNEXES uniquement.
// `CVApplication`      = candidature complète (annexe + ScoreResult + narration).
// (Legacy `CVAnalysisResult` / `CVAnalysisCriteria` supprimés — 6d/6e. La route
//  reçoit désormais la `ScoringSheet` directement.)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Données candidat factuelles ANNEXES attachées à une candidature.
 *
 * Périmètre strict (arbitrage DRH) :
 *   - coordonnées : nom complet, email, téléphone ;
 *   - métadonnées CV : langue détectée, nom de fichier, source/canal, date de
 *     réception ;
 *   - conformité / identifiant : droit de travailler, localisation ;
 *   - présence de photo.
 *
 * Ce schéma ne contient AUCUNE donnée factuelle servant au scoring (années
 * d'expérience, technologies, diplômes…) ni AUCUNE appréciation (note, points
 * forts, tags libres) : ces éléments vivent dans les décisions par critère du
 * `ScoreResult` (breakdown). `.strict()` matérialise ce cloisonnement — toute
 * clé inconnue (`experienceYears`, `score`, `strengths`…) est rejetée au
 * parsing, ce qui empêche un champ d'appréciation d'y entrer par accident.
 */
export const JobApplicationDataSchema = z
  .object({
    // Coordonnées
    fullName: z.string().min(1),
    email: z.string().email().nullable(),
    phone: z.string().nullable(),
    // Métadonnées CV
    detectedLanguage: z.string().nullable(),
    fileName: z.string().min(1),
    source: CVSourceSchema,
    receivedAt: z.string().min(1), // ISO 8601
    // Conformité / identifiant
    rightToWork: z.boolean().nullable(),
    location: z.string().nullable(),
    // Photo
    photoPresent: z.boolean(),
  })
  .strict();
export type JobApplicationData = z.infer<typeof JobApplicationDataSchema>;

/**
 * Narration RH d'une candidature — rédigée par le LLM (C5) À PARTIR du
 * `ScoreResult` déjà calculé, jamais l'inverse. Le LLM ne touche pas au score :
 * il explique le verdict en langage RH. Champs alignés sur l'ancien
 * `CVAnalysisResult` pour faciliter la migration UI (C6).
 */
export const CVNarrationSchema = z.object({
  /** Synthèse exécutive, 3 phrases max. */
  summary: z.string().min(1),
  /** Points forts factuels. */
  strengths: z.array(z.string().min(1)),
  /** Points d'attention factuels (peut être vide). */
  weaknesses: z.array(z.string().min(1)),
  /** 1-2 phrases expliquant le verdict au regard des critères. */
  justification: z.string().min(1),
});
export type CVNarration = z.infer<typeof CVNarrationSchema>;

/**
 * Candidature complète : donnée factuelle annexe + résultat de scoring
 * explicable + narration RH. Cible de remplacement de `CVAnalysisResult`
 * (legacy), branchée progressivement aux phases extraction (C4), narration
 * (C5) et UI (C6).
 */
export const CVApplicationSchema = z.object({
  candidate: JobApplicationDataSchema,
  scoringResult: ScoreResultSchema,
  narration: CVNarrationSchema,
});
export type CVApplication = z.infer<typeof CVApplicationSchema>;

/**
 * Récapitulatif d'un batch de CV analysés (bloc chat + rapport markdown).
 * `aboveThreshold` = nombre de candidats `accepted`. `perCV` porte désormais le
 * modèle complet `CVApplication` (C6/6b).
 */
export const CVBatchSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  aboveThreshold: z.number().int().nonnegative(),
  threshold: z.number().min(0).max(100),
  perCV: z.array(CVApplicationSchema),
});
export type CVBatchSummary = z.infer<typeof CVBatchSummarySchema>;
