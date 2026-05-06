import { describe, expect, it } from 'vitest';

import {
  FDP_VALIDATED_EVENT,
  formatValidateLabel,
} from '@/components/chat/ValidateFDPButton';

describe('ValidateFDPButton helpers', () => {
  it('exposes the FDP_VALIDATED_EVENT name as the bridge to future R2', () => {
    expect(FDP_VALIDATED_EVENT).toBe('fdp_validated');
  });

  it('label calls the document a "fiche de poste" for CAMP campaigns', () => {
    const label = formatValidateLabel('CAMP-2026-014');
    expect(label).toContain('fiche de poste');
    expect(label).toContain('CAMP-2026-014');
  });

  it('label uses the simpler "fiche" wording for TASK solicitations', () => {
    const label = formatValidateLabel('TASK-2026-001');
    expect(label).toContain('fiche');
    expect(label).not.toContain('fiche de poste');
    expect(label).toContain('TASK-2026-001');
  });
});
