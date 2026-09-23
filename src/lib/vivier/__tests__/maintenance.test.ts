/**
 * Le rail de reprise de l'indexation du vivier.
 *
 * Ce qu'il doit tenir : un lot BORNÉ (une indexation = un appel au modèle + N
 * embeddings, et le cron partage ses 60 s), une RÉSERVATION qui évite qu'une
 * seconde invocation paie le même dossier, et un fail-soft intégral — une
 * relève de boîte ne doit jamais échouer à cause du vivier.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/repos/vivier', () => ({
  listVivierCandidatesToReindex: vi.fn(),
  claimVivierIndexing: vi.fn(),
}));
vi.mock('@/lib/db/supabase-server', () => ({ getServerSupabase: vi.fn(() => ({})) }));
vi.mock('@/lib/vivier/indexing', () => ({ indexVivierCandidate: vi.fn() }));

import {
  claimVivierIndexing,
  listVivierCandidatesToReindex,
} from '@/lib/db/repos/vivier';
import { getServerSupabase } from '@/lib/db/supabase-server';
import { indexVivierCandidate } from '@/lib/vivier/indexing';
import { runVivierIndexingMaintenance } from '@/lib/vivier/maintenance';

const list = vi.mocked(listVivierCandidatesToReindex);
const claim = vi.mocked(claimVivierIndexing);
const index = vi.mocked(indexVivierCandidate);
const supabase = vi.mocked(getServerSupabase);

const pending = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `cand-${i}`,
    updatedAt: `2026-09-23T10:0${i}:00.000Z`,
  }));

beforeEach(() => {
  vi.clearAllMocks();
  supabase.mockReturnValue({} as never);
  claim.mockResolvedValue(true);
  index.mockResolvedValue({ status: 'indexed', error: null });
});

describe('runVivierIndexingMaintenance', () => {
  it('traite AU PLUS deux dossiers par passage', async () => {
    list.mockResolvedValue(pending(6));
    const outcome = await runVivierIndexingMaintenance();
    expect(index).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ indexed: 2, failed: 0 });
  });

  it('ne reprend que les dossiers assez VIEUX — jamais celui qu’une passe tient', async () => {
    list.mockResolvedValue([]);
    await runVivierIndexingMaintenance(new Date('2026-09-23T12:00:00.000Z'));
    const [, before] = list.mock.calls[0]!;
    // TTL partagé des réservations : 5 minutes.
    expect(before).toBe('2026-09-23T11:55:00.000Z');
  });

  it('un claim PERDU ne consomme pas le lot : on passe au suivant', async () => {
    list.mockResolvedValue(pending(3));
    claim.mockResolvedValueOnce(false);
    await runVivierIndexingMaintenance();
    expect(index).toHaveBeenCalledTimes(2);
    expect(index).not.toHaveBeenCalledWith('cand-0');
  });

  it('compte les échecs sans les confondre avec les succès', async () => {
    list.mockResolvedValue(pending(2));
    index
      .mockResolvedValueOnce({ status: 'indexed', error: null })
      .mockResolvedValueOnce({ status: 'failed', error: 'pdf illisible' });
    expect(await runVivierIndexingMaintenance()).toEqual({ indexed: 1, failed: 1 });
  });

  it('FAIL-SOFT : une panne ne remonte jamais à l’appelant', async () => {
    list.mockRejectedValue(new Error('base injoignable'));
    expect(await runVivierIndexingMaintenance()).toEqual({ indexed: 0, failed: 0 });
  });

  it('sans Supabase (démo volatile), le rail ne lit rien', async () => {
    supabase.mockReturnValue(null as never);
    await runVivierIndexingMaintenance();
    expect(list).not.toHaveBeenCalled();
  });
});
