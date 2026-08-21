/**
 * Fail-closed des PAGES publiques du jobboard.
 *
 * La route de candidature a ses propres tests ; ici on vérifie l'autre moitié
 * de la promesse : sans le flag, la surface n'existe pas non plus à l'écran, et
 * la base n'est même pas interrogée.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('@/lib/db/repos/demo-job-posts', () => ({
  listVisibleJobPosts: vi.fn(),
  getVisibleJobPost: vi.fn(),
}));

import {
  getVisibleJobPost,
  listVisibleJobPosts,
} from '@/lib/db/repos/demo-job-posts';
import JobsListPage from '@/app/jobs/page';
import JobDetailPage from '@/app/jobs/[id]/page';

const list = vi.mocked(listVisibleJobPosts);
const one = vi.mocked(getVisibleJobPost);

describe('pages /jobs — fail-closed', () => {
  const prevFlag = process.env.DEMO_JOBBOARD_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([]);
    one.mockResolvedValue(null);
  });

  afterEach(() => {
    if (prevFlag === undefined) delete process.env.DEMO_JOBBOARD_ENABLED;
    else process.env.DEMO_JOBBOARD_ENABLED = prevFlag;
  });

  it('sans le flag : /jobs → 404, sans toucher la base', async () => {
    delete process.env.DEMO_JOBBOARD_ENABLED;
    await expect(JobsListPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(list).not.toHaveBeenCalled();
  });

  it('sans le flag : /jobs/[id] → 404, sans toucher la base', async () => {
    delete process.env.DEMO_JOBBOARD_ENABLED;
    await expect(
      JobDetailPage({ params: Promise.resolve({ id: 'CAMP-2026-511' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(one).not.toHaveBeenCalled();
  });

  it('avec le flag : une annonce DÉPUBLIÉE reste introuvable', async () => {
    process.env.DEMO_JOBBOARD_ENABLED = '1';
    await expect(
      JobDetailPage({ params: Promise.resolve({ id: 'CAMP-2026-511' }) }),
    ).rejects.toThrow('NEXT_NOT_FOUND');
    expect(one).toHaveBeenCalledWith('CAMP-2026-511');
  });

  it('avec le flag : la liste s’affiche même si la base est injoignable', async () => {
    process.env.DEMO_JOBBOARD_ENABLED = '1';
    list.mockRejectedValue(new Error('base injoignable'));
    await expect(JobsListPage()).resolves.toBeTruthy();
  });
});
