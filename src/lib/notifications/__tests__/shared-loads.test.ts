/**
 * Lectures partagées entre signaux métier (diagnostic de latence, 14/09/2026).
 *
 * Les signaux 2 et 3 lisaient chacun les signaux d'étape, 4 et 5 chacun la
 * ressource et ses règles, 6 et 7 chacun les offres en ligne. La mémoïsation
 * ne doit rien changer d'autre : une seule lecture PAR calcul, jamais d'un
 * calcul à l'autre (sinon un badge ne s'éteindrait plus après une action), et
 * une lecture en échec fait échouer chaque signal qui la demande.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/reporting/stage-signals', () => ({
  loadStageSignals: vi.fn(),
  stageFor: vi.fn(),
}));
vi.mock('@/lib/scheduling', () => ({
  getResource: vi.fn(),
  isMeetingLocationComplete: vi.fn(),
  listExceptions: vi.fn(),
  listWeeklyRules: vi.fn(),
}));
vi.mock('@/lib/scheduling-host/configure', () => ({
  ensureSchedulingConfigured: vi.fn(),
}));
vi.mock('@/lib/db/repos/job-postings', () => ({ listLiveJobPostings: vi.fn() }));

import { listLiveJobPostings } from '@/lib/db/repos/job-postings';
import { createSharedLoads } from '@/lib/notifications/business-signals';
import { loadStageSignals } from '@/lib/reporting/stage-signals';
import { getResource, listWeeklyRules } from '@/lib/scheduling';
import { ensureSchedulingConfigured } from '@/lib/scheduling-host/configure';

describe('createSharedLoads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadStageSignals).mockResolvedValue({} as never);
    vi.mocked(getResource).mockResolvedValue(null);
    vi.mocked(listWeeklyRules).mockResolvedValue([]);
    vi.mocked(listLiveJobPostings).mockResolvedValue([]);
    vi.mocked(ensureSchedulingConfigured).mockResolvedValue(undefined as never);
  });

  it('une lecture par calcul, quel que soit le nombre de signaux qui la demandent', async () => {
    const shared = createSharedLoads();
    await Promise.all([
      shared.stageSignals(),
      shared.stageSignals(),
      shared.resource('u1'),
      shared.resource('u1'),
      shared.weeklyRules('u1'),
      shared.weeklyRules('u1'),
      shared.liveJobPostings(),
      shared.liveJobPostings(),
    ]);
    expect(loadStageSignals).toHaveBeenCalledTimes(1);
    expect(getResource).toHaveBeenCalledTimes(1);
    expect(ensureSchedulingConfigured).toHaveBeenCalledTimes(1);
    expect(listWeeklyRules).toHaveBeenCalledTimes(1);
    expect(listLiveJobPostings).toHaveBeenCalledTimes(1);
  });

  it('jamais de mémoire d’un calcul à l’autre', async () => {
    await createSharedLoads().stageSignals();
    await createSharedLoads().stageSignals();
    expect(loadStageSignals).toHaveBeenCalledTimes(2);
  });

  it('clés distinctes ⇒ lectures distinctes', async () => {
    const shared = createSharedLoads();
    await Promise.all([shared.resource('u1'), shared.resource('u2')]);
    expect(getResource).toHaveBeenCalledTimes(2);
  });

  it('une lecture en échec fait échouer CHAQUE demandeur', async () => {
    vi.mocked(loadStageSignals).mockRejectedValue(new Error('hoquet DB'));
    const shared = createSharedLoads();
    const results = await Promise.allSettled([shared.stageSignals(), shared.stageSignals()]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });

  it('la ressource n’est jamais lue avant la configuration des ports', async () => {
    const order: string[] = [];
    vi.mocked(ensureSchedulingConfigured).mockImplementation(async () => {
      order.push('configure');
    });
    vi.mocked(getResource).mockImplementation(async () => {
      order.push('getResource');
      return null;
    });
    await createSharedLoads().resource('u1');
    expect(order).toEqual(['configure', 'getResource']);
  });
});
