/**
 * Squelette d'analyse conservé après effacement RGPD — PUR.
 * Procédure : docs/ops/purge-rgpd-candidat.md §6.1.
 *
 * Pourquoi on VIDE au lieu de SUPPRIMER : supprimer la ligne d'analyse ferait
 * bouger les chiffres de bilans DÉJÀ TRANSMIS au client (« 58 candidatures
 * reçues » deviendrait 57). Réécrire l'histoire d'un rapport signé n'est pas un
 * effet de bord acceptable. On garde donc une ligne STATISTIQUE — date,
 * campagne, score, zone — et on détruit tout ce qui décrit la personne.
 *
 * ⚠️ RÈGLE STRUCTURELLE, à ne pas défaire : la disposition de chaque champ est
 * déclarée dans un `Record<keyof T, Disposition>`. Ajouter un champ au modèle
 * d'analyse sans dire ce qu'on en fait EMPÊCHE LA COMPILATION. C'est une LISTE
 * BLANCHE : une liste noire laisserait passer en silence tout champ ajouté
 * après coup — et un champ nominatif qui survit à une purge est exactement le
 * défaut que ce fichier existe pour rendre impossible.
 *
 * Les tables `DISPOSITION_*` ne sont pas consommées à l'exécution : elles sont
 * la DÉCLARATION vérifiée par le compilateur, et le test d'exhaustivité vérifie
 * qu'elles décrivent bien ce que le code fait.
 */

import type {
  CVApplication,
  CVNarration,
  JobApplicationData,
} from '@/types/cv-analysis';
import type {
  CriterionDecision,
  CriterionFailure,
  ScoreResult,
} from '@/types/scoring';

/**
 * `keep`   : la valeur passe telle quelle (aucune donnée personnelle).
 * `marker` : remplacée par le marqueur (le schéma exige une chaîne non vide).
 * `erase`  : ramenée à `null`, `''`, `[]` ou `undefined` selon le type.
 */
type Disposition = 'keep' | 'marker' | 'erase';

// ─── Déclarations vérifiées à la compilation ──────────────────────────────

export const DISPOSITION_APPLICATION: Record<keyof CVApplication, Disposition> = {
  candidate: 'keep', // conteneur : détaillé ci-dessous
  scoringResult: 'keep',
  narration: 'erase', // rédigée SUR la personne, de bout en bout
};

export const DISPOSITION_CANDIDATE: Record<keyof JobApplicationData, Disposition> = {
  fullName: 'marker',
  email: 'erase',
  phone: 'erase',
  // Langue du CV : dans un vivier restreint, elle rétrécit le champ des
  // personnes possibles. Elle n'entre dans aucun compteur. Elle part.
  detectedLanguage: 'erase',
  // Le nom de fichier porte le nom de la personne neuf fois sur dix.
  fileName: 'marker',
  // Canal d'arrivée : alimente les statistiques de canal du bilan. Conservé.
  source: 'keep',
  receivedAt: 'keep', // borne de période des bilans
  rightToWork: 'erase', // attribut de la personne
  location: 'erase', // attribut de la personne
  // Booléen sur le DOCUMENT, dans aucun compteur : on ne le garde pas non plus.
  photoPresent: 'erase',
};

export const DISPOSITION_SCORE: Record<keyof ScoreResult, Disposition> = {
  totalScore: 'keep',
  status: 'keep',
  decisionZone: 'keep',
  breakdown: 'keep', // conteneur : chaque décision est réduite ci-dessous
  hardFailures: 'keep', // n'énonce que des critères de la fiche
  criteriaVersion: 'keep',
  computedAt: 'keep',
};

export const DISPOSITION_CRITERION: Record<keyof CriterionDecision, Disposition> = {
  criterionId: 'keep',
  criterionLabel: 'keep', // libellé de la FICHE, pas du candidat
  criticityLevel: 'keep',
  weight: 'keep',
  behavior: 'keep',
  llmDecision: 'keep', // le verdict : satisfait / partiel / non
  llmJustification: 'marker', // décrit le parcours de la personne
  llmCVQuote: 'erase', // CITATION LITTÉRALE du CV
  contribution: 'keep',
  verificationMethodUsed: 'keep',
  // Mots-clés de la fiche RETROUVÉS dans le CV : fragment de profil, et
  // redondant avec `llmDecision` pour tout usage statistique.
  matchedKeywords: 'erase',
  decidedBy: 'keep', // chemin emprunté (mot-clé vs modèle)
};

export const DISPOSITION_HARD_FAILURE: Record<keyof CriterionFailure, Disposition> = {
  criterionId: 'keep',
  criterionLabel: 'keep',
  criticityLevel: 'keep',
  reason: 'keep',
};

export const DISPOSITION_NARRATION: Record<keyof CVNarration, Disposition> = {
  summary: 'marker',
  strengths: 'erase',
  weaknesses: 'erase',
  justification: 'marker',
};

// ─── Application ───────────────────────────────────────────────────────────

/**
 * Réduit une candidature à sa forme statistique anonyme. Le résultat reste
 * VALIDE au regard de `CVApplicationSchema` (les champs `min(1)` reçoivent le
 * marqueur, pas une chaîne vide) : une ligne purgée se relit sans erreur de
 * parsing, sinon l'audit planterait au lieu d'afficher un dossier neutralisé.
 */
export function stripApplication(
  application: CVApplication,
  marker: string,
): CVApplication {
  const { candidate, scoringResult } = application;
  return {
    candidate: {
      fullName: marker,
      email: null,
      phone: null,
      detectedLanguage: null,
      fileName: marker,
      source: candidate.source,
      receivedAt: candidate.receivedAt,
      rightToWork: null,
      location: null,
      photoPresent: false,
    },
    scoringResult: {
      totalScore: scoringResult.totalScore,
      status: scoringResult.status,
      ...(scoringResult.decisionZone !== undefined
        ? { decisionZone: scoringResult.decisionZone }
        : {}),
      breakdown: scoringResult.breakdown.map(stripCriterion(marker)),
      hardFailures: scoringResult.hardFailures.map((h) => ({
        criterionId: h.criterionId,
        criterionLabel: h.criterionLabel,
        criticityLevel: h.criticityLevel,
        reason: h.reason,
      })),
      criteriaVersion: scoringResult.criteriaVersion,
      computedAt: scoringResult.computedAt,
    },
    narration: {
      summary: marker,
      strengths: [],
      weaknesses: [],
      justification: marker,
    },
  };
}

function stripCriterion(marker: string) {
  return (b: CriterionDecision): CriterionDecision => ({
    criterionId: b.criterionId,
    criterionLabel: b.criterionLabel,
    criticityLevel: b.criticityLevel,
    weight: b.weight,
    behavior: b.behavior,
    llmDecision: b.llmDecision,
    llmJustification: marker,
    llmCVQuote: '',
    contribution: b.contribution,
    ...(b.verificationMethodUsed !== undefined
      ? { verificationMethodUsed: b.verificationMethodUsed }
      : {}),
    ...(b.decidedBy !== undefined ? { decidedBy: b.decidedBy } : {}),
    // `matchedKeywords` volontairement ABSENT : `undefined` ≠ `[]` dans ce
    // modèle (`[]` signifie « cherché, rien trouvé »). On n'invente pas un fait.
  });
}

/**
 * Une candidature est-elle DÉJÀ réduite ? Sert à l'idempotence du rejeu et au
 * contrôle final. On teste les porteurs les plus lourds, pas tous les champs :
 * une réduction partielle est impossible (`stripApplication` est atomique).
 */
export function isApplicationStripped(application: CVApplication): boolean {
  const { candidate, narration } = application;
  return (
    candidate.email === null &&
    candidate.phone === null &&
    narration.strengths.length === 0 &&
    application.scoringResult.breakdown.every((b) => b.llmCVQuote === '')
  );
}
