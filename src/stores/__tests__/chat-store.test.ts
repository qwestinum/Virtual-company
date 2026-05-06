import { beforeEach, describe, expect, it } from 'vitest';

import {
  GREETING_MESSAGE_CREATED_AT,
  GREETING_MESSAGE_ID,
  useChatStore,
} from '@/stores/chat-store';

describe('chat-store (Session 3)', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('starts with a single greeting from the manager', () => {
    const { messages, conversationId } = useChatStore.getState();
    expect(conversationId).toMatch(/^conv_/);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe('manager');
    expect(messages[0]?.source).toBe('text');
    expect(messages[0]?.content.length).toBeGreaterThan(0);
  });

  it('greeting message has deterministic id and createdAt (SSR safety)', () => {
    const { messages } = useChatStore.getState();
    expect(messages[0]?.id).toBe(GREETING_MESSAGE_ID);
    expect(messages[0]?.createdAt).toBe(GREETING_MESSAGE_CREATED_AT);
    // Re-rebuilding the store must keep the greeting deterministic, otherwise
    // server-rendered HTML and client hydration produce different DOM and
    // React throws a hydration mismatch.
    useChatStore.getState().reset();
    const after = useChatStore.getState();
    expect(after.messages[0]?.id).toBe(GREETING_MESSAGE_ID);
    expect(after.messages[0]?.createdAt).toBe(GREETING_MESSAGE_CREATED_AT);
  });

  it('appendMessage assigns id and createdAt and appends in order', () => {
    const { appendMessage } = useChatStore.getState();
    const msg = appendMessage({
      role: 'user',
      source: 'text',
      content: 'Bonjour',
    });
    expect(msg.id).toMatch(/^msg_/);
    expect(typeof msg.createdAt).toBe('string');
    const all = useChatStore.getState().messages;
    expect(all).toHaveLength(2);
    expect(all[1]).toEqual(msg);
  });

  it('ChatMessage no longer carries dispatched or intent fields', () => {
    const { appendMessage } = useChatStore.getState();
    const msg = appendMessage({
      role: 'manager',
      source: 'text',
      content: 'Test',
    });
    expect((msg as Record<string, unknown>).dispatched).toBeUndefined();
    expect((msg as Record<string, unknown>).intent).toBeUndefined();
  });

  it('toggles isSending and isTranscribing', () => {
    const { setSending, setTranscribing } = useChatStore.getState();
    setSending(true);
    setTranscribing(true);
    let s = useChatStore.getState();
    expect(s.isSending).toBe(true);
    expect(s.isTranscribing).toBe(true);
    setSending(false);
    setTranscribing(false);
    s = useChatStore.getState();
    expect(s.isSending).toBe(false);
    expect(s.isTranscribing).toBe(false);
  });

  it('setError stores and clears the error', () => {
    const { setError } = useChatStore.getState();
    setError('boom');
    expect(useChatStore.getState().error).toBe('boom');
    setError(null);
    expect(useChatStore.getState().error).toBeNull();
  });

  it('reset rebuilds initial state with a new conversationId', () => {
    const original = useChatStore.getState().conversationId;
    useChatStore.getState().appendMessage({
      role: 'user',
      source: 'text',
      content: 'X',
    });
    expect(useChatStore.getState().messages).toHaveLength(2);
    useChatStore.getState().reset();
    const fresh = useChatStore.getState();
    expect(fresh.messages).toHaveLength(1);
    expect(fresh.conversationId).not.toBe(original);
  });

  it('does not expose campaign or lastIntent (boundary)', () => {
    const state = useChatStore.getState() as Record<string, unknown>;
    expect(state.campaign).toBeUndefined();
    expect(state.lastIntent).toBeUndefined();
    expect(state.setCampaign).toBeUndefined();
    expect(state.setLastIntent).toBeUndefined();
  });

  it('dismissLastManagerChips clears chips on the last manager bubble only', () => {
    const { appendMessage, dismissLastManagerChips } =
      useChatStore.getState();
    appendMessage({
      role: 'manager',
      source: 'text',
      content: 'Q1',
      chips: { placement: 'below_bubble', options: ['junior', 'senior'] },
    });
    appendMessage({ role: 'user', source: 'text', content: 'something' });
    appendMessage({
      role: 'manager',
      source: 'text',
      content: 'Q2',
      chips: { placement: 'inline', options: ['Utiliser', 'Plus haut'] },
    });

    dismissLastManagerChips();
    const msgs = useChatStore.getState().messages;
    expect(msgs.at(-1)?.chips).toBeUndefined();
    // L'ancienne bulle Manager (avant la user) garde ses chips.
    const earlierManager = msgs.find(
      (m) => m.role === 'manager' && m.content === 'Q1',
    );
    expect(earlierManager?.chips?.options).toEqual(['junior', 'senior']);
  });

  it('dismissLastManagerChips is a no-op when no manager bubble has chips', () => {
    const { appendMessage, dismissLastManagerChips } =
      useChatStore.getState();
    const before = useChatStore.getState().messages.length;
    appendMessage({ role: 'user', source: 'text', content: 'hi' });
    dismissLastManagerChips();
    expect(useChatStore.getState().messages).toHaveLength(before + 1);
  });
});
