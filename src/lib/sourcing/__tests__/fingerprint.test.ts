import { describe, expect, it } from 'vitest';

import {
  MissingSourcingPepperError,
  normalizeProfileUrl,
  profileFingerprint,
} from '@/lib/sourcing/fingerprint';

const PEPPER = 'sel-de-test';

describe('normalizeProfileUrl — toutes les formes d’un même profil convergent', () => {
  const same = [
    'https://www.linkedin.com/in/claire-martin-4a1b2c',
    'http://linkedin.com/in/claire-martin-4a1b2c/',
    'fr.linkedin.com/in/Claire-Martin-4a1b2c/?originalSubdomain=fr',
    'https://www.linkedin.com/in/claire-martin-4a1b2c/details/experience/',
    '  https://www.linkedin.com/in/claire-martin-4a1b2c#about  ',
  ];

  it('rend la même forme canonique', () => {
    for (const u of same) expect(normalizeProfileUrl(u)).toBe('linkedin.com/in/claire-martin-4a1b2c');
  });

  it('décode un slug accentué, sous ses deux écritures', () => {
    expect(normalizeProfileUrl('https://www.linkedin.com/in/h%C3%A9l%C3%A8ne-dubois')).toBe(
      'linkedin.com/in/hélène-dubois',
    );
    expect(normalizeProfileUrl('https://www.linkedin.com/in/hélène-dubois')).toBe(
      'linkedin.com/in/hélène-dubois',
    );
  });

  it('refuse ce qui n’est pas un profil', () => {
    for (const u of [
      '',
      'https://www.linkedin.com/company/banque-x',
      'https://www.linkedin.com/in/',
      'https://www.linkedin.com/posts/claire_activity-7331',
      'https://linkedin.com.exemple.fr/in/claire',
      'https://notlinkedin.com/in/claire',
      'pas une adresse',
    ]) {
      expect(normalizeProfileUrl(u), u).toBeNull();
    }
  });
});

describe('profileFingerprint', () => {
  it('64 caractères hexadécimaux, stable, identique pour toutes les formes', () => {
    const fps = new Set(
      [
        'https://www.linkedin.com/in/claire-martin-4a1b2c',
        'fr.linkedin.com/in/Claire-Martin-4a1b2c/?originalSubdomain=fr',
      ].map((u) => profileFingerprint(normalizeProfileUrl(u)!, PEPPER)),
    );
    expect(fps.size).toBe(1);
    expect([...fps][0]).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dépend du sel : sans lui, l’adresse publique suffirait à la recalculer', () => {
    const url = 'linkedin.com/in/claire-martin-4a1b2c';
    expect(profileFingerprint(url, 'a')).not.toBe(profileFingerprint(url, 'b'));
  });

  it('refuse de calculer sans sel', () => {
    expect(() => profileFingerprint('linkedin.com/in/x', undefined)).toThrow(MissingSourcingPepperError);
    expect(() => profileFingerprint('linkedin.com/in/x', '   ')).toThrow(MissingSourcingPepperError);
  });
});
