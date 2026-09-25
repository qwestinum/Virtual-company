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

/**
 * La clé de tarif d'un nom de modèle. Les fournisseurs RENVOIENT un nom daté
 * (`gpt-4o-2024-08-06`, `gpt-4o-mini-2024-07-18`, `claude-sonnet-4-6-20250929`)
 * alors que la table est tenue par famille : sans cette normalisation, tout
 * appel OpenAI était estimé à 0 $ — et la carte des coûts de l'administration
 * avec lui (constat du 25/09/2026). Le nom exact reste prioritaire : une entrée
 * datée ajoutée un jour à la table l'emporte sur sa famille.
 */
export function pricingKey(model: string): string | null {
  const name = model.trim();
  if (name in PRICING) return name;
  const family = name.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '');
  return family in PRICING ? family : null;
}

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const key = pricingKey(model);
  const entry = key ? PRICING[key] : undefined;
  if (!entry) return 0;
  const prompt = (promptTokens / 1_000_000) * entry.promptUsdPerMTokens;
  const completion =
    (completionTokens / 1_000_000) * entry.completionUsdPerMTokens;
  return Number((prompt + completion).toFixed(6));
}

export function isKnownModel(model: string): boolean {
  return pricingKey(model) !== null;
}
