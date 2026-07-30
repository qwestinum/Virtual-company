import { describe, expect, it } from 'vitest';

import { mergeSynthesisRecipients } from '@/lib/campaign/synthesis-recipients';

describe('mergeSynthesisRecipients — référent + configurées, dédup', () => {
  it('référent en tête, puis les configurées', () => {
    expect(
      mergeSynthesisRecipients('jane@corp.fr', ['drh@corp.fr', 'dir@corp.fr']),
    ).toEqual(['jane@corp.fr', 'drh@corp.fr', 'dir@corp.fr']);
  });

  it('ÉVITE le double envoi si le référent est déjà configuré (casse ignorée)', () => {
    expect(
      mergeSynthesisRecipients('Jane@Corp.fr', ['drh@corp.fr', 'jane@corp.fr']),
    ).toEqual(['Jane@Corp.fr', 'drh@corp.fr']);
  });

  it('sans référent → configurées seules (comportement historique)', () => {
    expect(mergeSynthesisRecipients(null, ['drh@corp.fr'])).toEqual(['drh@corp.fr']);
  });

  it('doublons internes des configurées aussi dédupliqués ; vides ignorés', () => {
    expect(
      mergeSynthesisRecipients(null, ['drh@corp.fr', ' DRH@corp.fr ', '', 'dir@corp.fr']),
    ).toEqual(['drh@corp.fr', 'dir@corp.fr']);
  });

  it('ni référent ni configurée → vide (no_recipient chez l’appelant)', () => {
    expect(mergeSynthesisRecipients(null, [])).toEqual([]);
  });
});
