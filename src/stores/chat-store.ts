/**
 * Store du chat Manager (Session 3).
 *
 * Frontière : ce store ne connaît PAS la FDP. La coordination
 * chat ↔ FDP se fait exclusivement dans src/lib/agents/manager.ts (côté
 * serveur) ; aucun store ne référence l'autre. Si tu trouves un import
 * de fdp-store ici, c'est un bug — supprime-le.
 *
 * Champ d'application : messages bruts, états transitoires (sending,
 * transcribing, error), reset de conversation. Pas d'intention, pas de
 * campagne — ces objets vivent dans fdp-store ou sont retournés par
 * runManagerTurn et propagés par le code d'orchestration appelant.
 */

import { create } from 'zustand';

export type ChatRole = 'user' | 'manager' | 'system';
export type ChatMessageSource = 'text' | 'voice';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  source: ChatMessageSource;
  createdAt: string;
};

export type ChatState = {
  conversationId: string;
  messages: ChatMessage[];
  isSending: boolean;
  isTranscribing: boolean;
  error: string | null;

  appendMessage: (
    message: Omit<ChatMessage, 'id' | 'createdAt'>,
  ) => ChatMessage;
  setSending: (value: boolean) => void;
  setTranscribing: (value: boolean) => void;
  setError: (message: string | null) => void;
  reset: () => void;
};

const GREETING =
  "Bonjour, je suis votre Manager RH. Décrivez-moi votre demande — recrutement, fiche isolée, point sur une campagne — et je m'occupe du reste.";

function generateId(prefix: string): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `${prefix}_${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function buildInitialState(): Pick<
  ChatState,
  'conversationId' | 'messages' | 'isSending' | 'isTranscribing' | 'error'
> {
  return {
    conversationId: generateId('conv'),
    messages: [
      {
        id: generateId('msg'),
        role: 'manager',
        source: 'text',
        createdAt: new Date().toISOString(),
        content: GREETING,
      },
    ],
    isSending: false,
    isTranscribing: false,
    error: null,
  };
}

export const useChatStore = create<ChatState>()((set) => ({
  ...buildInitialState(),

  appendMessage: (message) => {
    const full: ChatMessage = {
      ...message,
      id: generateId('msg'),
      createdAt: new Date().toISOString(),
    };
    set((state) => ({ ...state, messages: [...state.messages, full] }));
    return full;
  },

  setSending: (value) => set((state) => ({ ...state, isSending: value })),
  setTranscribing: (value) =>
    set((state) => ({ ...state, isTranscribing: value })),
  setError: (message) => set((state) => ({ ...state, error: message })),

  reset: () => set(() => ({ ...buildInitialState() })),
}));

export const selectMessages = (state: ChatState): ChatMessage[] =>
  state.messages;
