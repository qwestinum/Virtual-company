import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { pushManagerAcknowledgment } from '@/lib/chat/manager-acknowledgments';
import { useChatStore } from '@/stores/chat-store';

describe('manager acknowledgments', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    useChatStore.getState().reset();
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('pousse un message Manager mentionnant le nom de la campagne en pause', () => {
    pushManagerAcknowledgment({
      kind: 'campaign_paused',
      campaignId: 'CAMP-0001',
      campaignName: 'Senior Dev Backend',
    });
    const messages = useChatStore.getState().messages;
    const last = messages[messages.length - 1];
    expect(last.role).toBe('manager');
    expect(last.content).toContain('Senior Dev Backend');
    expect(last.content.toLowerCase()).toContain('pause');
  });

  it('campaign_created : message « enregistrée », jamais « activée »', () => {
    pushManagerAcknowledgment({
      kind: 'campaign_created',
      campaignId: 'CAMP-0007',
      campaignName: 'Data Engineer',
    });
    const messages = useChatStore.getState().messages;
    const last = messages[messages.length - 1];
    expect(last.role).toBe('manager');
    expect(last.content).toContain('Data Engineer');
    expect(last.content.toLowerCase()).toContain('brouillon');
    expect(last.content.toLowerCase()).not.toContain('lancée');
  });

  it('mentionne ancien et nouveau seuil sur threshold_changed', () => {
    pushManagerAcknowledgment({
      kind: 'threshold_changed',
      campaignId: 'CAMP-0002',
      campaignName: 'Comptable senior',
      previous: 70,
      next: 65,
    });
    const messages = useChatStore.getState().messages;
    const last = messages[messages.length - 1];
    expect(last.content).toContain('70');
    expect(last.content).toContain('65');
    expect(last.content).toContain('Comptable senior');
  });

  it('appelle /api/journal en best-effort pour tracer l audit', async () => {
    pushManagerAcknowledgment({
      kind: 'campaign_resumed',
      campaignId: 'CAMP-9',
      campaignName: 'Test',
    });
    // best-effort = on n'attend pas, mais on a bien lancé l'appel.
    // Laisser à l'event loop le temps de planifier le fetch.
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/journal',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('n est pas bloqué par un échec réseau du journal', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(
      new Error('network down'),
    ) as unknown as typeof fetch;
    expect(() =>
      pushManagerAcknowledgment({
        kind: 'campaign_closed',
        campaignId: 'CAMP-X',
        campaignName: 'X',
      }),
    ).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    // Le message a quand même été poussé.
    const messages = useChatStore.getState().messages;
    expect(messages[messages.length - 1].content).toContain('X');
  });
});
