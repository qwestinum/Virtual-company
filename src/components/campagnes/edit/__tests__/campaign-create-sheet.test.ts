import { describe, expect, it } from 'vitest';

import { nextOpenSection } from '@/components/campagnes/edit/CampaignCreateSheet';

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
