import { describe, expect, it, vi } from 'vitest';

import {
  gateCandidateOutreach,
  type OutreachGatePorts,
  type SendResult,
} from '@/lib/hitl/outreach-gate';
import type { HitlConfig } from '@/types/hitl';

const SENT: SendResult = { kind: 'sent' };

function ports(over: Partial<OutreachGatePorts> = {}): {
  ports: OutreachGatePorts;
  send: ReturnType<typeof vi.fn>;
  enqueue: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async () => SENT);
  const enqueue = vi.fn(async () => true);
  return {
    send,
    enqueue,
    ports: {
      loadHitlConfig: async () => ({ rejectionMail: false, acceptanceMail: false }),
      send,
      enqueue,
      ...over,
    },
  };
}

const GATED: HitlConfig = { rejectionMail: true, acceptanceMail: true };
const OPEN: HitlConfig = { rejectionMail: false, acceptanceMail: false };

describe('gateCandidateOutreach', () => {
  it('non gaté → envoie (et ne met pas en file)', async () => {
    const { ports: p, send, enqueue } = ports({ loadHitlConfig: async () => OPEN });
    const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
    expect(out).toEqual({ kind: 'sent' });
    expect(send).toHaveBeenCalledOnce();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('gaté + file persistée → queued (n’envoie jamais)', async () => {
    const { ports: p, send, enqueue } = ports({ loadHitlConfig: async () => GATED });
    const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
    expect(out).toEqual({ kind: 'queued' });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('le refus respecte rejectionMail, pas acceptanceMail', async () => {
    // reject gaté seulement par rejectionMail.
    const { ports: p, send, enqueue } = ports({
      loadHitlConfig: async () => ({ rejectionMail: false, acceptanceMail: true }),
    });
    const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
    expect(out).toEqual({ kind: 'sent' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });

  it('l’acceptation respecte acceptanceMail', async () => {
    const { ports: p, send, enqueue } = ports({
      loadHitlConfig: async () => ({ rejectionMail: false, acceptanceMail: true }),
    });
    const out = await gateCandidateOutreach('accept', p, { onUnconfirmed: 'defer' });
    expect(out).toEqual({ kind: 'queued' });
    expect(enqueue).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  describe('état HITL non confirmable', () => {
    it('config null + defer → deferred, n’envoie RIEN', async () => {
      const { ports: p, send, enqueue } = ports({ loadHitlConfig: async () => null });
      const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
      expect(out).toEqual({ kind: 'deferred', reason: 'hitl_unconfirmed' });
      expect(send).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('loadHitlConfig throw + defer → deferred (jamais d’envoi)', async () => {
      const { ports: p, send } = ports({
        loadHitlConfig: async () => {
          throw new Error('supabase down');
        },
      });
      const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
      expect(out).toEqual({ kind: 'deferred', reason: 'hitl_unconfirmed' });
      expect(send).not.toHaveBeenCalled();
    });

    it('config null + send (comportement chat) → envoie', async () => {
      const { ports: p, send } = ports({ loadHitlConfig: async () => null });
      const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'send' });
      expect(out).toEqual({ kind: 'sent' });
      expect(send).toHaveBeenCalledOnce();
    });
  });

  describe('file non persistée (gaté mais enqueue échoue)', () => {
    it('defer → deferred (enqueue_unpersisted), n’envoie pas', async () => {
      const { ports: p, send } = ports({
        loadHitlConfig: async () => GATED,
        enqueue: async () => false,
      });
      const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
      expect(out).toEqual({ kind: 'deferred', reason: 'enqueue_unpersisted' });
      expect(send).not.toHaveBeenCalled();
    });

    it('send → retombe sur l’envoi', async () => {
      const send = vi.fn(async (): Promise<SendResult> => SENT);
      const out = await gateCandidateOutreach(
        'reject',
        {
          loadHitlConfig: async () => GATED,
          enqueue: async () => false,
          send,
        },
        { onUnconfirmed: 'send' },
      );
      expect(out).toEqual({ kind: 'sent' });
      expect(send).toHaveBeenCalledOnce();
    });
  });

  it('propage le SendResult non-sent du port (ex. skipped)', async () => {
    const { ports: p } = ports({
      loadHitlConfig: async () => OPEN,
      send: async () => ({ kind: 'skipped', reason: 'no_email' }),
    });
    const out = await gateCandidateOutreach('reject', p, { onUnconfirmed: 'defer' });
    expect(out).toEqual({ kind: 'skipped', reason: 'no_email' });
  });
});
