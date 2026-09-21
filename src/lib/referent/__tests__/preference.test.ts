import { describe, expect, it } from 'vitest';

import {
  ALL_REFERENTS,
  campaignIdsForSelection,
  type ReferentByCampaign,
} from '../filter';
import { analyserSelection, serialiserSelection } from '../preference';

const actif = (id: string) => ({ id, displayName: `R ${id}`, isActive: true });

describe('sérialisation de la préférence', () => {
  it('fait l’aller-retour sur les trois formes', () => {
    for (const s of [
      ALL_REFERENTS,
      { kind: 'none' as const },
      { kind: 'recruiter' as const, id: 'u-1' },
    ]) {
      expect(analyserSelection(serialiserSelection(s))).toEqual(s);
    }
  });

  it('⚠️ tout ce qui n’est pas reconnu vaut « Tous » — jamais un filtre qui masque', () => {
    for (const brut of [null, '', 'n’importe quoi', 'recruiter:', '{"kind":"none"}']) {
      expect(analyserSelection(brut)).toEqual(ALL_REFERENTS);
    }
  });

  it('un identifiant qui contient « : » survit', () => {
    expect(analyserSelection('recruiter:a:b')).toEqual({
      kind: 'recruiter',
      id: 'a:b',
    });
  });
});

describe('périmètre de campagnes d’une sélection', () => {
  const referents: ReferentByCampaign = {
    'CAMP-1': actif('u-1'),
    'CAMP-2': actif('u-2'),
    'CAMP-3': null,
    // Désactivé ⇒ compte comme « référent non défini », pas comme u-9.
    'CAMP-4': { id: 'u-9', displayName: 'Sortie', isActive: false },
  };

  it('« Tous » ne restreint rien', () => {
    expect(campaignIdsForSelection(referents, ALL_REFERENTS)).toBeNull();
  });

  it('un recruteur ne rend que les siennes', () => {
    expect(campaignIdsForSelection(referents, { kind: 'recruiter', id: 'u-1' })).toEqual([
      'CAMP-1',
    ]);
  });

  it('« non défini » prend l’absence ET le référent désactivé', () => {
    expect(
      campaignIdsForSelection(referents, { kind: 'none' })?.sort(),
    ).toEqual(['CAMP-3', 'CAMP-4']);
  });

  it('un recruteur sans campagne rend une liste VIDE, jamais « Tous »', () => {
    // ⚠️ Le piège : rendre `null` ferait passer la sélection pour « Tous » et
    // afficherait TOUTES les candidatures à quelqu'un qui a demandé les
    // siennes. Une liste vide est la bonne réponse.
    expect(campaignIdsForSelection(referents, { kind: 'recruiter', id: 'u-inconnu' })).toEqual(
      [],
    );
  });
});
