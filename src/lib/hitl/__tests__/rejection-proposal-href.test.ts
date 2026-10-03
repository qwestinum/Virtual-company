import { describe, expect, it } from 'vitest';

import { parseValidationSubTab, validationReviewHref } from '../rejection-proposal';

describe('le lien vers la revue ouvre l’onglet qu’il annonce (03/10/2026)', () => {
  it('« propositions de refus » ⇒ l’onglet des propositions', () => {
    const href = validationReviewHref('proposals');
    expect(href).toBe('/candidatures/validation?onglet=propositions');
    expect(parseValidationSubTab(new URL(href, 'http://x').searchParams.get('onglet'))).toBe(
      'proposals',
    );
  });

  it('aller-retour pour les deux onglets ; sans onglet ⇒ l’adresse nue', () => {
    expect(parseValidationSubTab('a_examiner')).toBe('examine');
    expect(validationReviewHref()).toBe('/candidatures/validation');
  });

  it('valeur inconnue ou absente ⇒ rien de demandé (la règle d’arrivée s’applique)', () => {
    expect(parseValidationSubTab('proposals')).toBeNull(); // l'identifiant interne n'est pas un mot d'adresse
    expect(parseValidationSubTab('')).toBeNull();
    expect(parseValidationSubTab(undefined)).toBeNull();
  });
});
