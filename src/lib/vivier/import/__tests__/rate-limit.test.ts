import { describe, expect, it } from 'vitest';

import { backoffMs, isQuotaExhausted, isRateLimit, withRateLimitRetry } from '../rate-limit';

const NO_CREDIT =
  '429 You have no credits remaining. Add credits to continue using the API (credit_balance_exhausted)';

describe('limite de débit ≠ compte sans crédit', () => {
  it('un compte sans crédit n’est PAS une limite de débit, même en 429', () => {
    expect(isQuotaExhausted(NO_CREDIT)).toBe(true);
    expect(isRateLimit(NO_CREDIT)).toBe(false);
    expect(isQuotaExhausted('insufficient_quota')).toBe(true);
  });

  it('une vraie limite de débit reste réessayée, avec l’indice du fournisseur', () => {
    const msg = '429 Rate limit reached. Please try again in 2.5s';
    expect(isRateLimit(msg)).toBe(true);
    expect(isQuotaExhausted(msg)).toBe(false);
    expect(backoffMs(msg, 1)).toBe(3_250);
  });

  it('sans crédit : aucun réessai, l’erreur remonte tout de suite', async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(6, async () => {
        calls++;
        throw new Error(NO_CREDIT);
      }, undefined, async () => {}),
    ).rejects.toThrow('no credits');
    expect(calls).toBe(1);
  });
});
