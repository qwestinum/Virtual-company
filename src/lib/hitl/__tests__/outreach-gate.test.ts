import { describe, expect, it, vi } from 'vitest';

import {
  gateCandidateOutreach,
  type OutreachGatePorts,
  type SendResult,
} from '@/lib/hitl/outreach-gate';

const SENT: SendResult = { kind: 'sent' };

function ports(over: Partial<OutreachGatePorts> = {}): {
  ports: OutreachGatePorts;
  send: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async () => SENT);
  const enqueue = vi.fn(async () => true);
  return { send, enqueue, ports: { send, enqueue, ...over } };
}

describe('gateCandidateOutreach — HITL 3 zones', () => {
  it('auto_accept → envoie (jamais de file)', async () => {
    const { ports: p, send, enqueue } = ports();
    const out = await gateCandidateOutreach('auto_accept', p);
    expect(out).toEqual({ kind: 'sent' });
    expect(send).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('auto_reject → envoie (jamais de file)', async () => {
    const { ports: p, send, enqueue } = ports();
    const out = await gateCandidateOutreach('auto_reject', p);
    expect(out).toEqual({ kind: 'sent' });
    expect(send).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('gray + file persistée → queued (n’envoie JAMAIS)', async () => {
    const { ports: p, send, enqueue } = ports();
    const out = await gateCandidateOutreach('gray', p);
    expect(out).toEqual({ kind: 'queued' });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('gray + file NON persistée → deferred, n’envoie RIEN (anti-perte, chat inclus)', async () => {
    const { ports: p, send } = ports({ enqueue: async () => false });
    const out = await gateCandidateOutreach('gray', p);
    expect(out).toEqual({ kind: 'deferred', reason: 'enqueue_unpersisted' });
    expect(send).not.toHaveBeenCalled();
  });

  it('propage le SendResult non-sent du port (ex. skipped) sur une zone auto', async () => {
    const { ports: p } = ports({
      send: async () => ({ kind: 'skipped', reason: 'no_email' }),
    });
    const out = await gateCandidateOutreach('auto_reject', p);
    expect(out).toEqual({ kind: 'skipped', reason: 'no_email' });
  });

  it('propage `duplicate` (idempotence cross-instance) tel quel sur une zone auto', async () => {
    // Une passe cron CONCURRENTE a déjà réservé l'envoi (imap_outreach_claims) :
    // le port renvoie `duplicate`, le gate NE le transforme pas — l'appelant
    // doit pouvoir sauter les effets post-envoi (brief) là-dessus.
    const { ports: p } = ports({ send: async () => ({ kind: 'duplicate' }) });
    const out = await gateCandidateOutreach('auto_accept', p);
    expect(out).toEqual({ kind: 'duplicate' });
  });
});
