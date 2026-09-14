import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/candidate-analyses', () => ({ getLatestApplicationsByEmails: vi.fn() }));
vi.mock('@/lib/db/repos/campaigns', () => ({ listCampaignJobTitles: vi.fn() }));

import { getLatestApplicationsByEmails } from '@/lib/db/repos/candidate-analyses';
import { listCampaignJobTitles } from '@/lib/db/repos/campaigns';
import { jobTitleOf, resolveLastAppliedJobs } from '@/lib/vivier/last-applied-job';

describe('jobTitleOf', () => {
  it('intitulé FDP rogné, repli sur le nom si absent, vide ou non textuel', () => {
    expect(jobTitleOf({ name: 'Camp', jobTitleValue: '  Business Analyst ' })).toBe('Business Analyst');
    expect(jobTitleOf({ name: 'Camp', jobTitleValue: '   ' })).toBe('Camp');
    expect(jobTitleOf({ name: 'Camp', jobTitleValue: null })).toBe('Camp');
    expect(jobTitleOf({ name: 'Camp', jobTitleValue: 42 })).toBe('Camp');
  });
});

describe('resolveLastAppliedJobs', () => {
  it('une seule lecture groupée des campagnes distinctes ; campagne introuvable ⇒ email absent', async () => {
    vi.mocked(getLatestApplicationsByEmails).mockResolvedValue(
      new Map([
        ['a@x.fr', { campaignId: 'C1', receivedAt: '2026-09-01' }],
        ['b@x.fr', { campaignId: 'C1', receivedAt: '2026-09-02' }],
        ['c@x.fr', { campaignId: 'C2', receivedAt: '2026-09-03' }],
        ['d@x.fr', { campaignId: null, receivedAt: '2026-09-04' }],
      ]) as never,
    );
    vi.mocked(listCampaignJobTitles).mockResolvedValue(new Map([['C1', { name: 'Camp 1', jobTitleValue: 'BA' }]]));
    const out = await resolveLastAppliedJobs(['a@x.fr', 'b@x.fr', 'c@x.fr', 'd@x.fr']);
    expect(vi.mocked(listCampaignJobTitles)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listCampaignJobTitles).mock.calls[0]![0]).toEqual(['C1', 'C2']);
    expect(Object.fromEntries(out)).toEqual({
      'a@x.fr': { jobTitle: 'BA', at: '2026-09-01' },
      'b@x.fr': { jobTitle: 'BA', at: '2026-09-02' },
    });
  });
});
