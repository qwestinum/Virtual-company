import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HITL_CONFIG,
  HitlConfigSchema,
  hitlSectionForDecision,
  PendingValidationSchema,
} from '@/types/hitl';

describe('hitl types', () => {
  it('mappe la décision vers la bonne section de config', () => {
    expect(hitlSectionForDecision('reject')).toBe('rejectionMail');
    expect(hitlSectionForDecision('accept')).toBe('acceptanceMail');
  });

  it('défaut ON sur les deux sections', () => {
    expect(DEFAULT_HITL_CONFIG).toEqual({
      rejectionMail: true,
      acceptanceMail: true,
    });
    expect(HitlConfigSchema.safeParse(DEFAULT_HITL_CONFIG).success).toBe(true);
  });

  it('valide une PendingValidation bien formée', () => {
    const v = PendingValidationSchema.safeParse({
      id: 'PV-1',
      campaignId: 'CAMP-1',
      candidateName: 'X',
      candidateEmail: null,
      score: 80,
      decision: 'reject',
      cvArtifactId: null,
      reportArtifactId: null,
      mailDraftArtifactId: null,
      confirmed: false,
      status: 'pending',
      payload: {},
      createdAt: '2026-06-08T00:00:00Z',
      updatedAt: '2026-06-08T00:00:00Z',
      decidedAt: null,
    });
    expect(v.success).toBe(true);
  });
});
