import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ADEP_CONFIG,
  MISSING_ORGANISATION_NAME,
  ORGANISATION_NAME_LOCATION,
  missingAdepSettings,
} from '@/types/adep-settings';
import { validateAdepOffer } from '@/lib/jobboards/adep/validate';
import { ADEP_ERROR_CATALOGUE } from '@/lib/jobboards/adep/errors';
import {
  SAMPLE_OFFER,
  SAMPLE_TODAY,
} from '@/lib/jobboards/adep/__tests__/fixtures/sample-offer';

const READY = { ...DEFAULT_ADEP_CONFIG, nafCode: '7810Z', organizationDescription: 'x'.repeat(120) };

describe('le nom de l’organisation est un préalable APEC (« enseigne »)', () => {
  it('absent ⇒ listé en tête des manques, avec l’endroit où le remplir', () => {
    expect(missingAdepSettings(READY, '  ')).toEqual([MISSING_ORGANISATION_NAME]);
    expect(MISSING_ORGANISATION_NAME).toContain(ORGANISATION_NAME_LOCATION);
    expect(missingAdepSettings(READY, 'Qwestinum')).toEqual([]);
  });

  it('l’écran de publication dit le nom de l’organisation ET où le remplir', () => {
    const report = validateAdepOffer({ ...SAMPLE_OFFER, organizationName: '' }, SAMPLE_TODAY);
    const issue = report.errors.find((e) => e.field === 'organizationName');
    expect(issue?.message).toContain('Nom de l’organisation non renseigné');
    expect(issue?.message).toContain(ORGANISATION_NAME_LOCATION);
  });

  it('le refus 406 de l’Apec renvoie au même endroit', () => {
    expect(ADEP_ERROR_CATALOGUE['406']!.message).toContain(ORGANISATION_NAME_LOCATION);
  });
});
