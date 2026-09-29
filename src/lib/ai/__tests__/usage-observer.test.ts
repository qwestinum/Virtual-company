import { describe, expect, it } from 'vitest';

import { emitAIUsage, onAIUsage, type AIUsageEvent } from '../usage-observer';

const EVENT: AIUsageEvent = { kind: 'chat', model: 'gpt-4o-mini', promptTokens: 10, completionTokens: 5, costEstimate: 0.001 };

describe('point d’écoute de la consommation', () => {
  it('sans écouteur, émettre ne fait rien', () => {
    expect(() => emitAIUsage(EVENT)).not.toThrow();
  });

  it('additionne, puis se désabonne', () => {
    let total = 0;
    const stop = onAIUsage((e) => {
      total += e.costEstimate;
    });
    emitAIUsage(EVENT);
    emitAIUsage({ ...EVENT, kind: 'embedding', costEstimate: 0.002 });
    stop();
    emitAIUsage(EVENT);
    expect(total).toBeCloseTo(0.003);
  });

  it('un écouteur qui lève n’emporte pas l’appel au modèle', () => {
    const stop = onAIUsage(() => {
      throw new Error('boum');
    });
    expect(() => emitAIUsage(EVENT)).not.toThrow();
    stop();
  });
});
