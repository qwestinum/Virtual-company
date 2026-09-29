import { describe, expect, it } from 'vitest';

import { COST_RANGE, estimateImportCost } from '../cost';

describe('estimation du coût avant exécution', () => {
  it('rien à importer : rien à payer', () => {
    const e = estimateImportCost({ textLengths: [], chatModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' });
    expect(e.usd).toBe(0);
    expect(e.pricingKnown).toBe(true);
  });

  it('croît avec la longueur des CV et rend une fourchette', () => {
    const short = estimateImportCost({ textLengths: [2_000], chatModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' });
    const long = estimateImportCost({ textLengths: [20_000], chatModel: 'gpt-4o-mini', embeddingModel: 'text-embedding-3-small' });
    expect(long.usd).toBeGreaterThan(short.usd);
    expect(short.usdLow).toBeCloseTo(short.usd * COST_RANGE.low);
    expect(short.usdHigh).toBeCloseTo(short.usd * COST_RANGE.high);
  });

  it('1 000 CV sur gpt-4o-mini : quelques dollars, pas des centaines', () => {
    const e = estimateImportCost({
      textLengths: Array.from({ length: 1_000 }, () => 5_000),
      chatModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
    });
    expect(e.usd).toBeGreaterThan(0.5);
    expect(e.usd).toBeLessThan(10);
  });

  it('un modèle sans tarif est SIGNALÉ, pas compté zéro en silence', () => {
    const e = estimateImportCost({ textLengths: [1_000], chatModel: 'modele-inconnu', embeddingModel: 'text-embedding-3-small' });
    expect(e.pricingKnown).toBe(false);
  });
});
