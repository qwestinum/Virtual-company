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

import type { ChipSet } from '@/types/manager-response';

export type ChatRole = 'user' | 'manager' | 'system';
export type ChatMessageSource = 'text' | 'voice';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  source: ChatMessageSource;
  createdAt: string;
  /**
   * Chips proposés par le Manager avec ce tour. Attachés au message
   * pour permettre au rendu de les afficher selon `chips.placement`
   * (inline dans la bulle, below_bubble juste après, above_input
   * au-dessus de l'input). Effacés visuellement dès qu'un message
   * suivant arrive (cf. brief Session 3 §3 — « Les chips disparaissent
   * dès qu'un message est envoyé »).
   */
  chips?: ChipSet;
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
  /**
   * Retire le champ `chips` de la dernière bulle Manager. Utilisé
   * quand le DRH clique un chip d'ajustement vague — on rend la main
   * au textarea sans déclencher un tour LLM.
   */
  dismissLastManagerChips: () => void;
  reset: () => void;
};

const GREETING =
  "Bonjour, je suis votre Manager RH. Décrivez-moi votre demande — recrutement, fiche isolée, point sur une campagne — et je m'occupe du reste.";

/**
 * Identifiant et timestamp déterministes du message d'accueil. Sans
 * cette stabilité, l'évaluation du store côté SSR puis côté client
 * produirait des valeurs différentes et casserait l'hydratation React.
 * Le timestamp epoch est interprété comme "pas d'heure à afficher" par
 * le rendu (cf. ChatMessageBubble.formatTime).
 */
export const GREETING_MESSAGE_ID = 'msg_greeting_seed';
export const GREETING_MESSAGE_CREATED_AT = '1970-01-01T00:00:00.000Z';

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
        id: GREETING_MESSAGE_ID,
        role: 'manager',
        source: 'text',
        createdAt: GREETING_MESSAGE_CREATED_AT,
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

  dismissLastManagerChips: () =>
    set((state) => {
      const messages = [...state.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role === 'manager' && message.chips) {
          const { chips: _chips, ...rest } = message;
          messages[i] = rest;
          return { ...state, messages };
        }
      }
      return state;
    }),

  reset: () => set(() => ({ ...buildInitialState() })),
}));

export const selectMessages = (state: ChatState): ChatMessage[] =>
  state.messages;
