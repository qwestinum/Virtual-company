import { describe, expect, it } from 'vitest';

import { bandWindowStart, parseBandWindow } from '@/lib/today/agents-band';

const JOUR = 86_400_000;
const MAINTENANT = Date.parse('2026-09-22T10:00:00.000Z');

describe('fenêtre de la bande d’équipe', () => {
  it('ne reconnaît que « mois » ; tout le reste vaut la semaine', () => {
    // Une valeur venue de l'URL n'est pas une fenêtre : elle ne choisit
    // jamais une durée qu'on n'a pas nommée.
    expect(parseBandWindow('mois')).toBe('mois');
    expect(parseBandWindow('semaine')).toBe('semaine');
    for (const brut of [null, '', 'MOIS', 'annee', '30', ' mois']) {
      expect(parseBandWindow(brut), String(brut)).toBe('semaine');
    }
  });

  it('la semaine remonte de 7 jours, le mois de 30', () => {
    expect(bandWindowStart(MAINTENANT, 'semaine')).toBe(
      new Date(MAINTENANT - 7 * JOUR).toISOString(),
    );
    expect(bandWindowStart(MAINTENANT, 'mois')).toBe(
      new Date(MAINTENANT - 30 * JOUR).toISOString(),
    );
  });

  it('sans fenêtre dite, c’est la semaine', () => {
    expect(bandWindowStart(MAINTENANT)).toBe(bandWindowStart(MAINTENANT, 'semaine'));
  });
});
