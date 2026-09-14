/**
 * L'identité d'appel se résout UNE fois par invocation — jamais d'une requête
 * à l'autre, et un échec n'est jamais retenu.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/job-postings', () => ({
  listJobPostings: vi.fn(),
  getCurrentJobPosting: vi.fn(),
  reserveJobPosting: vi.fn(),
  patchJobPosting: vi.fn(),
}));
vi.mock('@/lib/db/repos/recruiters', () => ({ getAdepNumeroDossier: vi.fn() }));

import {
  listJobPostings,
  patchJobPosting,
  reserveJobPosting,
  type JobPosting,
} from '@/lib/db/repos/job-postings';

import { MockAdepTransport } from '../mock-transport';
import { memoizeCredentials, publishToAdep } from '../service';
import { SAMPLE_CREDENTIALS, SAMPLE_OFFER } from './fixtures/sample-offer';

describe('memoizeCredentials', () => {
  it('résout une seule fois pour des appels successifs', async () => {
    const resolve = vi.fn(async () => SAMPLE_CREDENTIALS);
    const memo = memoizeCredentials(resolve);
    expect(await memo()).toBe(SAMPLE_CREDENTIALS);
    expect(await memo()).toBe(SAMPLE_CREDENTIALS);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('partage une résolution en vol', async () => {
    const resolve = vi.fn(async () => SAMPLE_CREDENTIALS);
    const memo = memoizeCredentials(resolve);
    await Promise.all([memo(), memo(), memo()]);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('ne retient pas un échec : l’appel suivant ré-essaie', async () => {
    const resolve = vi
      .fn<() => Promise<typeof SAMPLE_CREDENTIALS>>()
      .mockRejectedValueOnce(new Error('hoquet'))
      .mockResolvedValueOnce(SAMPLE_CREDENTIALS);
    const memo = memoizeCredentials(resolve);
    await expect(memo()).rejects.toThrow('hoquet');
    expect(await memo()).toBe(SAMPLE_CREDENTIALS);
    expect(resolve).toHaveBeenCalledTimes(2);
  });

  it('deux mémos distincts ne partagent rien', async () => {
    const resolve = vi.fn(async () => SAMPLE_CREDENTIALS);
    await memoizeCredentials(resolve)();
    await memoizeCredentials(resolve)();
    expect(resolve).toHaveBeenCalledTimes(2);
  });
});

describe('publishToAdep — identité résolue une fois', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listJobPostings).mockResolvedValue([]);
    vi.mocked(reserveJobPosting).mockResolvedValue({
      kind: 'reserved',
      posting: { id: 'JOBP-1' } as JobPosting,
    });
    vi.mocked(patchJobPosting).mockImplementation(
      async (_id, p) => ({ id: 'JOBP-1', ...p }) as JobPosting,
    );
  });

  it('même quand l’envoi douteux déclenche la lecture de réconciliation', async () => {
    const { clientPositionId: _r, trackingId: _t, ...offer } = SAMPLE_OFFER;
    const credentials = vi.fn(async () => SAMPLE_CREDENTIALS);
    const transport = new MockAdepTransport({
      failures: { openPosition: [{ kind: 'timeout' }] },
    });
    const result = await publishToAdep({
      campaignId: 'CAMP-2026-288',
      ownerUserId: 'u-1',
      offer,
      deps: { transport, credentials, trackingId: () => 'trk' },
    });
    // flux caviardé + envoi + réconciliation = trois demandes, une résolution.
    // Le délai force la lecture « l'offre existe-t-elle ? » après l'envoi.
    expect(result.outcome.kind).not.toBe('published');
    expect(credentials).toHaveBeenCalledTimes(1);
  });
});
