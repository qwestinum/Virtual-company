import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/require-api-user', () => ({ getApiUser: vi.fn() }));
vi.mock('@/lib/db/repos/campaigns', () => ({ listCampaignSummaries: vi.fn() }));
vi.mock('@/lib/db/repos/recruiters', () => ({ listRecruiters: vi.fn() }));

import { getApiUser } from '@/lib/auth/require-api-user';
import { listCampaignSummaries } from '@/lib/db/repos/campaigns';
import { listRecruiters } from '@/lib/db/repos/recruiters';
import { loadReferentContext, prepareReferentContext } from '@/lib/referent/context';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiUser).mockResolvedValue({ id: 'session' } as never);
  vi.mocked(listRecruiters).mockResolvedValue([{ id: 'r1', displayName: 'Jane R.', isActive: true }] as never);
  vi.mocked(listCampaignSummaries).mockResolvedValue(new Map([['C1', { ownerUserId: 'r1' }]]) as never);
});

describe('session fournie par l’appelant', () => {
  it('sans option : la session est lue ici (comportement d’origine)', async () => {
    const ctx = await loadReferentContext(['C1']);
    expect(getApiUser).toHaveBeenCalledTimes(1);
    expect(ctx).toEqual({
      referentByCampaign: { C1: { id: 'r1', displayName: 'Jane R.', isActive: true } },
      currentUserId: 'session',
    });
  });

  it('avec `user` : aucune relecture, même résultat', async () => {
    const ctx = await prepareReferentContext({ user: { id: 'session' } as never })(['C1', null]);
    expect(getApiUser).not.toHaveBeenCalled();
    expect(ctx.currentUserId).toBe('session');
    expect(ctx.referentByCampaign.C1?.displayName).toBe('Jane R.');
  });

  it('`user: null` vaut « aucune session »', async () => {
    const ctx = await loadReferentContext(['C1'], { user: null });
    expect(getApiUser).not.toHaveBeenCalled();
    expect(ctx.currentUserId).toBeNull();
  });
});
