/**
 * Entretien du module — purge à la clôture et filet du rail, reprise des
 * admissions. Journal seulement quand quelque chose a été purgé.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', () => ({ getServerSupabase: () => ({}) }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/sourcing-admission', () => ({
  purgeCampaignProfiles: vi.fn(async () => ({ count: 0, byState: { reserve: 0, to_review: 0, contacted: 0 } })),
  findCampaignWithLeftoverProfiles: vi.fn(async () => null),
  listPendingAdmissions: vi.fn(async () => []),
  claimAdmissionAttempt: vi.fn(async () => true),
}));
vi.mock('@/lib/sourcing/server/admit', () => ({ admitSourcedCandidate: vi.fn(async () => ({ kind: 'admitted' })) }));

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { claimAdmissionAttempt, findCampaignWithLeftoverProfiles, listPendingAdmissions, purgeCampaignProfiles } from '@/lib/db/repos/sourcing-admission';
import { admitSourcedCandidate } from '@/lib/sourcing/server/admit';
import { purgeCampaignSourcing, runSourcingMaintenance } from '@/lib/sourcing/server/maintenance';

describe('purge', () => {
  it('rien à purger ⇒ aucun journal', async () => {
    await purgeCampaignSourcing('CAMP-1', 'closure');
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('purge effective ⇒ `sourcing_profiles_purged` avec le compte par état', async () => {
    vi.mocked(purgeCampaignProfiles).mockResolvedValueOnce({ count: 52, byState: { reserve: 40, to_review: 10, contacted: 2 } });
    await purgeCampaignSourcing('CAMP-1', 'closure');
    expect(vi.mocked(appendJournalEntry).mock.calls[0]![0]).toMatchObject({
      action: 'sourcing_profiles_purged',
      payload: { campaignId: 'CAMP-1', count: 52, byState: { reserve: 40, to_review: 10, contacted: 2 }, trigger: 'closure' },
    });
  });

  it('une purge qui échoue ne fait pas échouer la clôture', async () => {
    vi.mocked(purgeCampaignProfiles).mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    await expect(purgeCampaignSourcing('CAMP-1', 'closure')).resolves.toBeNull();
  });
});

describe('rail de drain', () => {
  it('filet : purge chaque campagne close qui porte encore des profils, puis s’arrête', async () => {
    vi.mocked(findCampaignWithLeftoverProfiles).mockResolvedValueOnce('CAMP-A').mockResolvedValueOnce('CAMP-B').mockResolvedValueOnce(null);
    const out = await runSourcingMaintenance();
    expect(out.campaignsPurged).toBe(2);
  });

  it('reprise : seules les admissions échues repartent, deux au plus', async () => {
    const now = new Date('2026-09-14T12:00:00Z');
    const a = (id: string, attempts: number, updatedAt: string) => ({ id, admissionAttempts: attempts, updatedAt }) as never;
    vi.mocked(listPendingAdmissions).mockResolvedValueOnce([
      a('fresh', 3, '2026-09-14T11:55:00Z'),
      a('due1', 1, '2026-09-14T11:00:00Z'),
      a('due2', 2, '2026-09-14T11:00:00Z'),
      a('due3', 4, '2026-09-14T10:00:00Z'),
    ]);
    const out = await runSourcingMaintenance(now);
    expect(vi.mocked(admitSourcedCandidate).mock.calls.map((c) => (c[0] as { id: string }).id)).toEqual(['due1', 'due2']);
    expect(out.admitted).toBe(2);
  });

  it('une tentative prise par un autre passage n’est pas relancée', async () => {
    vi.mocked(admitSourcedCandidate).mockClear();
    vi.mocked(listPendingAdmissions).mockResolvedValueOnce([{ id: 'taken', admissionAttempts: 2, updatedAt: '2026-09-14T10:00:00Z' } as never]);
    vi.mocked(claimAdmissionAttempt).mockResolvedValueOnce(false);
    const out = await runSourcingMaintenance(new Date('2026-09-14T12:00:00Z'));
    expect(admitSourcedCandidate).not.toHaveBeenCalled();
    expect(out.admitted + out.deferred + out.closed).toBe(0);
  });
});
