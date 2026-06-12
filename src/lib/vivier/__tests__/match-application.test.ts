import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vivierRepo = { getVivierCandidateByEmail: vi.fn() };
const preselRepo = { recordApplied: vi.fn() };
const journal = { appendJournalEntry: vi.fn() };

vi.mock('@/lib/db/repos/vivier', () => vivierRepo);
vi.mock('@/lib/db/repos/vivier-preselection', () => preselRepo);
vi.mock('@/lib/db/repos/journal', () => journal);
vi.mock('@/lib/vivier/candidates', () => ({
  normalizeEmail: (s: string) => s.trim().toLowerCase(),
}));

beforeEach(() => {
  vivierRepo.getVivierCandidateByEmail.mockReset();
  preselRepo.recordApplied.mockReset();
  journal.appendJournalEntry.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('matchVivierApplication — rapprochement exact par email', () => {
  it('email correspondant à un contacté ⇒ applied_at posé + journal', async () => {
    vivierRepo.getVivierCandidateByEmail.mockResolvedValueOnce({ id: 'cand-1' });
    preselRepo.recordApplied.mockResolvedValueOnce(true);
    const { matchVivierApplication } = await import('@/lib/vivier/match-application');

    const matched = await matchVivierApplication('CAMP-1', 'Jane@Doe.com');
    expect(matched).toBe(true);
    // Email normalisé pour la résolution.
    expect(vivierRepo.getVivierCandidateByEmail).toHaveBeenCalledWith('jane@doe.com');
    expect(preselRepo.recordApplied).toHaveBeenCalledWith('CAMP-1', 'cand-1');
    expect(journal.appendJournalEntry.mock.calls[0][0].action).toBe(
      'vivier_application_matched',
    );
  });

  it('aucun candidat vivier pour cet email ⇒ aucune annotation', async () => {
    vivierRepo.getVivierCandidateByEmail.mockResolvedValueOnce(null);
    const { matchVivierApplication } = await import('@/lib/vivier/match-application');

    const matched = await matchVivierApplication('CAMP-1', 'inconnu@x.com');
    expect(matched).toBe(false);
    expect(preselRepo.recordApplied).not.toHaveBeenCalled();
    expect(journal.appendJournalEntry).not.toHaveBeenCalled();
  });

  it('candidat trouvé mais pas contacté pour cette campagne ⇒ pas de rapprochement', async () => {
    vivierRepo.getVivierCandidateByEmail.mockResolvedValueOnce({ id: 'cand-1' });
    preselRepo.recordApplied.mockResolvedValueOnce(false); // pas de proposition contacted
    const { matchVivierApplication } = await import('@/lib/vivier/match-application');

    const matched = await matchVivierApplication('CAMP-1', 'jane@doe.com');
    expect(matched).toBe(false);
    expect(journal.appendJournalEntry).not.toHaveBeenCalled();
  });

  it('hors campagne (tâche) ou sans email ⇒ no-op (pas de lookup, pas de fuzzy)', async () => {
    const { matchVivierApplication } = await import('@/lib/vivier/match-application');
    expect(await matchVivierApplication(null, 'jane@doe.com')).toBe(false);
    expect(await matchVivierApplication('CAMP-1', null)).toBe(false);
    expect(vivierRepo.getVivierCandidateByEmail).not.toHaveBeenCalled();
  });
});
