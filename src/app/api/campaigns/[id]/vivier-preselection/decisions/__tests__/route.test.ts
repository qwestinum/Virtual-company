import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repo = { markRejected: vi.fn() };
const invitation = { sendVivierInvitation: vi.fn() };
const journal = { appendJournalEntry: vi.fn() };

vi.mock('@/lib/db/repos/vivier-preselection', () => repo);
vi.mock('@/lib/vivier/invitation-send', () => invitation);
vi.mock('@/lib/db/repos/journal', () => journal);

function req(body: unknown): Request {
  return new Request('http://localhost/api/campaigns/CAMP-1/vivier-preselection/decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = { params: Promise.resolve({ id: 'CAMP-1' }) };

beforeEach(() => {
  repo.markRejected.mockReset();
  invitation.sendVivierInvitation.mockReset();
  journal.appendJournalEntry.mockClear();
});
afterEach(() => vi.restoreAllMocks());

describe('POST decisions vivier', () => {
  it('accepter (unitaire) ⇒ envoi invitation (permission) + journal vivier_contact_accepted', async () => {
    invitation.sendVivierInvitation.mockResolvedValueOnce({
      contacted: true,
      status: 'sent',
    });
    const { POST } = await import('@/app/api/campaigns/[id]/vivier-preselection/decisions/route');

    const res = await POST(req({ candidateIds: ['c1'], decision: 'accept' }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ updated: ['c1'] });

    // L'envoi (action à permission) est déclenché par l'acceptation explicite.
    expect(invitation.sendVivierInvitation).toHaveBeenCalledWith('CAMP-1', 'c1', 'user');
    expect(repo.markRejected).not.toHaveBeenCalled();
    const entry = journal.appendJournalEntry.mock.calls[0][0];
    expect(entry.action).toBe('vivier_contact_accepted');
    expect(entry.payload).toEqual({ candidateIds: ['c1'], decision: 'accept' });
  });

  it('accepter : seuls les candidats effectivement contactés sont retenus', async () => {
    invitation.sendVivierInvitation
      .mockResolvedValueOnce({ contacted: true, status: 'sent' })
      .mockResolvedValueOnce({ contacted: false, status: 'send_failed' });
    const { POST } = await import('@/app/api/campaigns/[id]/vivier-preselection/decisions/route');

    const res = await POST(req({ candidateIds: ['c1', 'c2'], decision: 'accept' }), ctx);
    expect(await res.json()).toEqual({ updated: ['c1'] });
  });

  it('rejeter (en masse) ⇒ markRejected + journal vivier_contact_rejected', async () => {
    repo.markRejected.mockResolvedValueOnce(['c1', 'c2', 'c3']);
    const { POST } = await import('@/app/api/campaigns/[id]/vivier-preselection/decisions/route');

    const res = await POST(
      req({ candidateIds: ['c1', 'c2', 'c3'], decision: 'reject' }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(repo.markRejected).toHaveBeenCalledWith('CAMP-1', ['c1', 'c2', 'c3'], 'user');
    expect(invitation.sendVivierInvitation).not.toHaveBeenCalled();
    expect(journal.appendJournalEntry.mock.calls[0][0].action).toBe(
      'vivier_contact_rejected',
    );
  });

  it('corps invalide ⇒ 400, aucune mutation', async () => {
    const { POST } = await import('@/app/api/campaigns/[id]/vivier-preselection/decisions/route');
    const res = await POST(req({ candidateIds: [], decision: 'accept' }), ctx);
    expect(res.status).toBe(400);
    expect(invitation.sendVivierInvitation).not.toHaveBeenCalled();
    expect(journal.appendJournalEntry).not.toHaveBeenCalled();
  });
});
