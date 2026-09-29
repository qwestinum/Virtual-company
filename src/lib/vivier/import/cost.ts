/**
 * Estimation du coût d'un import AVANT exécution — PUR.
 *
 * Ce qu'un dossier importé coûte, appel par appel (pipeline réel) :
 *   · identité (nom, adresse)      — 1 appel, le texte entier du CV en entrée
 *   · entités + titre + compétences — 1 appel, le texte entier en entrée
 *   · variantes de titre            — jusqu'à 3 appels courts (titre + 2 postes)
 *   · embeddings                    — titre, 2 postes, ~20 compétences (courts)
 * Le texte est CONNU au moment de l'estimation (extrait pendant le constat) :
 * seules les parts fixes (consignes, réponses) sont des hypothèses, d'où une
 * FOURCHETTE et non un chiffre. Le coût réel est mesuré pendant l'exécution.
 */

import { estimateCost } from '@/lib/ai/pricing';

/** ≈ 4 caractères par token (texte français, ordre de grandeur OpenAI). */
export const CHARS_PER_TOKEN = 4;

/** Hypothèses par dossier — parts fixes, indépendantes du CV. */
export const PER_CV_ASSUMPTIONS = {
  identityPromptOverhead: 1_500,
  identityCompletion: 300,
  entitiesPromptOverhead: 1_200,
  entitiesCompletion: 600,
  variantCalls: 3,
  variantPrompt: 400,
  variantCompletion: 150,
  embeddingTokens: 300,
} as const;

export const COST_RANGE = { low: 0.7, high: 1.6 } as const;

export type CostEstimateInput = {
  /** Longueur (caractères) du texte extrait de chaque dossier à importer. */
  textLengths: number[];
  chatModel: string;
  embeddingModel: string;
};

export type CostEstimate = {
  files: number;
  chatPromptTokens: number;
  chatCompletionTokens: number;
  embeddingTokens: number;
  /** Estimation centrale, en dollars. */
  usd: number;
  usdLow: number;
  usdHigh: number;
  /** Faux si un modèle est absent de la table de tarifs (estimation à 0 pour lui). */
  pricingKnown: boolean;
};

export function estimateImportCost(input: CostEstimateInput): CostEstimate {
  const a = PER_CV_ASSUMPTIONS;
  let chatPromptTokens = 0;
  let chatCompletionTokens = 0;
  let embeddingTokens = 0;
  for (const len of input.textLengths) {
    const cvTokens = Math.ceil(len / CHARS_PER_TOKEN);
    chatPromptTokens +=
      2 * cvTokens + a.identityPromptOverhead + a.entitiesPromptOverhead + a.variantCalls * a.variantPrompt;
    chatCompletionTokens +=
      a.identityCompletion + a.entitiesCompletion + a.variantCalls * a.variantCompletion;
    embeddingTokens += a.embeddingTokens;
  }
  const chat = estimateCost(input.chatModel, chatPromptTokens, chatCompletionTokens);
  const emb = estimateCost(input.embeddingModel, embeddingTokens, 0);
  const usd = chat + emb;
  const pricingKnown =
    input.textLengths.length === 0 ||
    (estimateCost(input.chatModel, 1_000_000, 0) > 0 &&
      estimateCost(input.embeddingModel, 1_000_000, 0) > 0);
  return {
    files: input.textLengths.length,
    chatPromptTokens,
    chatCompletionTokens,
    embeddingTokens,
    usd,
    usdLow: usd * COST_RANGE.low,
    usdHigh: usd * COST_RANGE.high,
    pricingKnown,
  };
}

export function formatUsd(v: number): string {
  return `${v.toFixed(v < 1 ? 3 : 2)} $`;
}
