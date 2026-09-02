import { describe, expect, it } from 'vitest';

import {
  containsErasureMarker,
  erasureMarker,
  fileNameMarker,
  isErasureMarker,
} from '@/lib/gdpr/marker';

describe('marqueur nominatif', () => {
  it('porte la référence de l’instruction', () => {
    expect(erasureMarker('courriel DRH du 27/08/2026')).toBe(
      '[effacé — demande RGPD courriel DRH du 27/08/2026]',
    );
  });

  it('ne laisse jamais une référence vide sans mention', () => {
    expect(erasureMarker('   ')).toContain('référence non précisée');
  });
});

describe('marqueur de nom de fichier', () => {
  it('est ORDINAL, jamais nul, jamais une empreinte', () => {
    // `NULL` casserait l'index unique (deux NULL sont distincts) et rouvrirait
    // la porte à la résurrection du dossier ; une empreinte de nom de fichier
    // se retrouve par force brute.
    expect(fileNameMarker(1)).toBe('[effacé-rgpd-1]');
    expect(fileNameMarker(2)).toBe('[effacé-rgpd-2]');
  });

  it('est stable — un rejeu produit le même nom pour le même rang', () => {
    expect(fileNameMarker(3)).toBe(fileNameMarker(3));
  });
});

describe('reconnaissance', () => {
  it('reconnaît les deux formes, quelle que soit la demande qui les a posées', () => {
    expect(isErasureMarker('[effacé — demande RGPD autre demande]')).toBe(true);
    expect(isErasureMarker('[effacé-rgpd-7]')).toBe(true);
  });

  it('ne prend pas un texte ordinaire pour un marqueur', () => {
    expect(isErasureMarker('Jean Dupont')).toBe(false);
    expect(isErasureMarker('[effacé]')).toBe(false);
    expect(isErasureMarker(null)).toBe(false);
  });

  it('repère un marqueur ENCHÂSSÉ dans un texte réécrit', () => {
    expect(
      containsErasureMarker('Objet : Candidature — [effacé — demande RGPD x] (CAMP-1)'),
    ).toBe(true);
    expect(containsErasureMarker('Objet ordinaire')).toBe(false);
  });
});
