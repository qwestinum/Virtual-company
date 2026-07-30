import { describe, expect, it } from 'vitest';

import { sanitizeNextPath } from '@/lib/auth/next-path';

describe('sanitizeNextPath — anti open-redirect', () => {
  it('accepte un chemin interne', () => {
    expect(sanitizeNextPath('/rh/recrutement')).toBe('/rh/recrutement');
    expect(sanitizeNextPath('/admin/dashboard?x=1')).toBe('/admin/dashboard?x=1');
  });

  it('refuse tout ce qui sortirait de l’app → /app', () => {
    expect(sanitizeNextPath('https://evil.tld/phish')).toBe('/app');
    expect(sanitizeNextPath('//evil.tld/phish')).toBe('/app');
    expect(sanitizeNextPath('/\\evil.tld')).toBe('/app');
    expect(sanitizeNextPath('javascript:alert(1)')).toBe('/app');
    expect(sanitizeNextPath('evil.tld')).toBe('/app');
    expect(sanitizeNextPath('')).toBe('/app');
    expect(sanitizeNextPath(null)).toBe('/app');
    expect(sanitizeNextPath(undefined)).toBe('/app');
  });
});
