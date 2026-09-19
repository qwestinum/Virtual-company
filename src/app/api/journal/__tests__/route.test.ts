/**
 * `/api/journal` refuse le verdict final : il a SA route, qui exige le
 * commentaire. Sans ce refus, « pas de décision sans commentaire » ne serait
 * qu'une convention d'écran. Spec : docs/specs/compte-rendu-entretien.md §4.2.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const appendJournalEntry = vi.fn(async () => undefined);
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: () => appendJournalEntry() }));
vi.mock('@/lib/auth/require-api-user', () => ({ getApiUser: vi.fn(async () => null) }));

const { POST } = await import('@/app/api/journal/route');

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => vi.clearAllMocks());

describe('/api/journal — le verdict final n’y passe plus', () => {
  it.each(['validated', 'rejected', 'cleared'])('candidate_validation_marked (%s) ⇒ 409, rien écrit', async (status) => {
    const res = await post({
      action: 'candidate_validation_marked',
      campaignId: 'CAMP-2026-001',
      actor: 'user',
      payload: { uid: 'u1', candidate: 'Témoin', status },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('use_verdict_route');
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('le pointage d’entretien, lui, passe toujours', async () => {
    const res = await post({
      action: 'candidate_interview_marked',
      campaignId: 'CAMP-2026-001',
      actor: 'user',
      payload: { uid: 'u1', candidate: 'Témoin', status: 'realized' },
    });
    expect(res.status).toBe(204);
    expect(appendJournalEntry).toHaveBeenCalledTimes(1);
  });
});
