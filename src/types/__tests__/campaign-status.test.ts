import { describe, expect, it } from 'vitest';

import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_STATUS_LABELS,
  CampaignStatusSchema,
} from '@/types/campaign-status';

describe('campaign-status', () => {
  it('exposes the five canonical statuses', () => {
    expect(CAMPAIGN_STATUSES).toEqual([
      'draft',
      'in_progress',
      'active',
      'paused',
      'closed',
    ]);
  });

  it('every status has a label and a color', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(CAMPAIGN_STATUS_LABELS[status]).toBeTruthy();
      expect(CAMPAIGN_STATUS_COLORS[status]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('CampaignStatusSchema accepts canonical values and rejects unknown', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(CampaignStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(CampaignStatusSchema.safeParse('archived').success).toBe(false);
    expect(CampaignStatusSchema.safeParse('').success).toBe(false);
    expect(CampaignStatusSchema.safeParse(null).success).toBe(false);
  });
});
