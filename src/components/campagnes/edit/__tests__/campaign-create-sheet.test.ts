import { describe, expect, it } from 'vitest';

import {
  deriveCampaignName,
  nextOpenSection,
} from '@/components/campagnes/edit/CampaignCreateSheet';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';

/** FDP avec un job_title donné (vide = champ effacé). */
function fdpWithTitle(title: string): FDPInProgress {
  const fdp = buildEmptyFDP('CAMP-1');
  fdp.fields.job_title = {
    ...fdp.fields.job_title!,
    value: title,
    status: title ? 'filled' : 'empty',
  };
  return fdp;
}

describe('nextOpenSection — flux « Enregistrer → section suivante »', () => {
  it('ouvre la section juste après celle enregistrée', () => {
    expect(nextOpenSection(['fdp'], 'fdp')).toBe('scoring');
    expect(nextOpenSection(['fdp', 'scoring'], 'scoring')).toBe('channels');
  });

  it('saute les sections déjà enregistrées', () => {
    // scoring déjà enregistré : après fdp on passe directement à channels.
    expect(nextOpenSection(['fdp', 'scoring'], 'fdp')).toBe('channels');
    // tout l'aval déjà enregistré sauf threshold.
    expect(nextOpenSection(['fdp', 'scoring', 'channels', 'flux'], 'fdp')).toBe(
      'threshold',
    );
  });

  it('renvoie null après la dernière section (on replie tout)', () => {
    expect(nextOpenSection(['threshold'], 'threshold')).toBeNull();
    // enregistrer l'avant-dernière ouvre la dernière (threshold pas encore fait).
    expect(
      nextOpenSection(['fdp', 'scoring', 'channels', 'flux'], 'flux'),
    ).toBe('threshold');
  });

  it('null quand toutes les sections suivantes sont déjà enregistrées', () => {
    expect(
      nextOpenSection(['scoring', 'channels', 'flux', 'threshold', 'fdp'], 'fdp'),
    ).toBeNull();
  });
});

describe('deriveCampaignName — le nom suit le job_title édité', () => {
  it("l'intitulé ÉDITÉ en étape 2 prime sur celui de l'étape 1", () => {
    // Le bug : l'étape 1 était prioritaire et écrasait la modification.
    expect(deriveCampaignName(fdpWithTitle('Comptable senior'), 'Comptable')).toBe(
      'Comptable senior',
    );
  });

  it("repli sur l'intitulé d'étape 1 si le champ FDP est vidé", () => {
    expect(deriveCampaignName(fdpWithTitle(''), 'Comptable')).toBe('Comptable');
  });

  it('défaut quand tout est vide', () => {
    expect(deriveCampaignName(fdpWithTitle(''), '   ')).toBe('Nouvelle campagne');
  });

  it('trim de la valeur éditée', () => {
    expect(deriveCampaignName(fdpWithTitle('  Data Engineer  '), 'X')).toBe(
      'Data Engineer',
    );
  });
});
