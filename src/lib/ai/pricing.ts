type ModelPricing = {
  promptUsdPerMTokens: number;
  completionUsdPerMTokens: number;
};

const PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { promptUsdPerMTokens: 2.5, completionUsdPerMTokens: 10 },
  'gpt-4o-mini': { promptUsdPerMTokens: 0.15, completionUsdPerMTokens: 0.6 },
  // Anthropic Sonnet 4.6 (chemin CV_ANALYZER_PROVIDER=anthropic).
  'claude-sonnet-4-6': { promptUsdPerMTokens: 3, completionUsdPerMTokens: 15 },
  'whisper-1': { promptUsdPerMTokens: 0, completionUsdPerMTokens: 0 },
  // Embeddings vivier (EMBEDDING_PROVIDER=openai). Tarif facturé sur les
  // tokens d'entrée uniquement (pas de complétion).
  'text-embedding-3-small': {
    promptUsdPerMTokens: 0.02,
    completionUsdPerMTokens: 0,
  },
  'text-embedding-3-large': {
    promptUsdPerMTokens: 0.13,
    completionUsdPerMTokens: 0,
  },
};

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const entry = PRICING[model];
  if (!entry) return 0;
  const prompt = (promptTokens / 1_000_000) * entry.promptUsdPerMTokens;
  const completion =
    (completionTokens / 1_000_000) * entry.completionUsdPerMTokens;
  return Number((prompt + completion).toFixed(6));
}

export function isKnownModel(model: string): boolean {
  return model in PRICING;
}
