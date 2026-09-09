/**
 * Report des missions et compétences vers les textes de l'offre APEC.
 *
 * Ce qui est vérifié ici tient en une phrase : on REPORTE, on ne RÉDIGE pas.
 * Aucune phrase n'est fabriquée, aucune liste n'est complétée pour atteindre
 * un seuil, et une FDP vide rend `null` plutôt qu'un titre orphelin.
 */
import { describe, expect, it } from 'vitest';

import { composeMissionsText, composeSkillsText } from '../fdp-text';

describe('composeMissionsText', () => {
  it('reporte les missions en liste, sans rien inventer', () => {
    const text = composeMissionsText([
      'Tenue de la comptabilité générale',
      'Clôtures mensuelles et annuelles',
    ]);
    expect(text).toBe(
      'Missions principales :\n- Tenue de la comptabilité générale\n- Clôtures mensuelles et annuelles',
    );
  });

  it('rend null sur une liste vide plutôt qu’un titre orphelin', () => {
    expect(composeMissionsText([])).toBeNull();
    expect(composeMissionsText(['  ', ''])).toBeNull();
  });

  it('lit défensivement ce que la FDP peut contenir', () => {
    // Le champ est saisi à la main : il a été une chaîne, il peut être absent.
    expect(composeMissionsText(undefined)).toBeNull();
    expect(composeMissionsText('Tenue comptable')).toBeNull();
    expect(composeMissionsText([42, 'Clôtures'])).toBe('Missions principales :\n- Clôtures');
  });

  it('ne rallonge JAMAIS pour atteindre le minimum de l’Apec', () => {
    // 200 caractères sont exigés côté Apec ; trois missions courtes n'y
    // suffisent pas, et c'est le compteur du formulaire qui le dit. Broder
    // pour passer le seuil fabriquerait du texte que personne n'a relu.
    const text = composeMissionsText(['Saisie', 'Rapprochements', 'Relances']);
    expect(text!.length).toBeLessThan(200);
    expect(text).not.toContain('dynamique');
  });
});

describe('composeSkillsText', () => {
  it('reporte les compétences clés', () => {
    expect(composeSkillsText(['Sage 100', 'Anglais courant'])).toBe(
      'Compétences recherchées :\n- Sage 100\n- Anglais courant',
    );
  });

  it('rend null quand la FDP n’en porte pas', () => {
    expect(composeSkillsText(null)).toBeNull();
  });
});
