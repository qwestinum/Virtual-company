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

import type { CVBatchSummary } from '@/types/cv-analysis';
import type { CVSource } from '@/types/cv-source';
import type { FieldKey } from '@/types/field-collection';
import type { ChipSet } from '@/types/manager-response';
import type { PublicationChannel } from '@/types/publication-channel';

/**
 * Snapshot léger d'une campagne active, embarqué dans le block
 * `campaign-picker` pour ne pas dépendre du store campagnes côté
 * rendu (le store peut évoluer entre l'envoi du message et son
 * rendu — on fige la liste affichée au moment du message).
 */
export type CampaignPickerEntry = {
  id: string;
  name: string;
  jobTitle: string;
};

export type ChatRole = 'user' | 'manager' | 'system';
export type ChatMessageSource = 'text' | 'voice';

/**
 * Pièce jointe rattachée à une bulle Manager (annonce, rapport CV…).
 * `artifactId` pointe vers `artifacts-store`. La bulle reste textuelle
 * — l'attachement est rendu juste en dessous comme un chip cliquable.
 */
export type ChatAttachment = {
  artifactId: string;
  label: string;
  fileName: string;
  mime: string;
};

/**
 * Bulles structurées rendues par des composants dédiés plutôt que par
 * le rendu texte standard. Chaque type a ses props payload spécifiques.
 */
export type ChatBlock =
  | { kind: 'source-picker'; selected: 'manuel' | null }
  | { kind: 'cv-progress'; processed: number; total: number }
  | { kind: 'cv-batch-summary'; summary: CVBatchSummary }
  | {
      kind: 'cv-route-picker';
      pendingId: string;
      fileCount: number;
      activeCampaigns: CampaignPickerEntry[];
      selected: 'new' | 'existing' | 'isolated' | 'brief' | null;
    }
  | {
      kind: 'campaign-picker';
      pendingId: string;
      campaigns: CampaignPickerEntry[];
      selectedCampaignId: string | null;
    }
  | {
      /**
       * Picker multi-select des réseaux de publication (Phase 3.1).
       * Posé par handleValidateFDP après validation FDP. Le DRH coche
       * les réseaux voulus puis confirme → N appels dispatchJobWriter.
       * `confirmed` passe à true au clic du bouton — le picker reste
       * affiché pour traçabilité mais les contrôles sont gelés.
       */
      kind: 'publication-channel-picker';
      campaignId: string;
      selectedChannels: PublicationChannel[];
      confirmed: boolean;
    }
  | {
      /**
       * Picker multi-toggle des flux de réception de CV (Phase 3.2).
       * Posé après le dispatch des annonces. Les sources des channels
       * choisis sont activées par défaut ; `manual` est toujours
       * activé. Persiste dans le chat — handleFilesSelected consulte
       * le dernier block de ce kind pour savoir si Manuel est actif.
       * Le futur agent Publisher lira aussi cette config pour
       * brancher les flux automatiques (API / MCP).
       *
       * Phase 3.2.2 — `confirmed` passe à true au clic du bouton
       * « Valider la configuration ». Le block reste affiché pour
       * traçabilité mais les toggles deviennent inactifs.
       */
      kind: 'cv-sources-picker';
      campaignId: string;
      activeSources: Record<CVSource, boolean>;
      confirmed: boolean;
      /**
       * Round 5 — true quand ce picker est posé par handleResumeAction
       * (« Modifier les flux » depuis le sélecteur). À la confirmation,
       * handleSourcesConfirm n'auto-déclenche PAS la proposition de
       * fiche de scoring : le DRH conduit le workflow via les chips
       * de reprise. Absent / false = flux initial → auto-chain OK.
       */
      fromResume?: boolean;
    }
  | {
      /**
       * Éditeur de fiche de scoring (Phase 4.3). Posé après la
       * validation des flux. La fiche elle-même vit dans
       * scoring-store ; ce block est un marker pour positionner
       * l'éditeur dans le fil. confirmed passe à true au clic sur
       * "Valider la fiche de scoring".
       */
      kind: 'scoring-sheet-editor';
      campaignId: string;
      confirmed: boolean;
    }
  | {
      /**
       * Sélecteur de boîte mail à associer à une campagne (Round 5 —
       * source 'email' opérationnelle). Posé par handleSourcesConfirm
       * quand le DRH a activé email dans les flux. `mailboxes` est
       * une snapshot des boîtes configurées au moment du message
       * (label + email) — on évite ainsi de re-fetcher au rendu.
       * `selectedMailboxId` passe à l'id choisi (read-only après).
       */
      kind: 'mailbox-picker';
      campaignId: string;
      mailboxes: ReadonlyArray<{ id: string; label: string; email: string }>;
      selectedMailboxId: string | null;
      /**
       * Round 5 — propagé depuis le cv-sources-picker parent. Si true,
       * handleMailboxPick n'auto-déclenche PAS le scoring après
       * association (le DRH est en mode resume et conduit le
       * workflow via les chips).
       */
      fromResume?: boolean;
    };

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
  attachment?: ChatAttachment;
  block?: ChatBlock;
  /**
   * Champs SOURCE (FDP) que cette bulle a proposés ce tour, copiés
   * depuis les `fieldExtractions` de la réponse Manager. C'est le LIEN
   * bulle → source de vérité : un clic « Ajuster » sur cette bulle édite
   * ces champs dans la FDP (via applyExtractions), jamais le texte de la
   * bulle. Voir memory feedback_single_source_of_truth.
   */
  proposedExtractions?: Partial<Record<FieldKey, unknown>>;
  /**
   * Champ FDP UNIQUE que cette bulle propose ce tour (déclaré par le LLM
   * via `proposalField`). C'est le seul champ que « Ajuster » édite. Si
   * absent (récap pré-recherche en bloc), « Ajuster » déplie la checklist.
   */
  proposalField?: FieldKey;
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
  /**
   * Met à jour un message existant (par id). Utilisé pour la bulle de
   * progression CV, dont l'id est connu et qu'on édite à chaque CV
   * traité ; permet aussi de remplacer un block à la fin d'un batch.
   */
  updateMessage: (
    id: string,
    patch: Partial<Omit<ChatMessage, 'id' | 'createdAt'>>,
  ) => void;
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
  "Bonjour, je suis votre Manager RH. Décrivez-moi votre demande — lancer un recrutement, faire le point sur une campagne — et je m'occupe du reste.";

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

  updateMessage: (id, patch) =>
    set((state) => {
      const idx = state.messages.findIndex((m) => m.id === id);
      if (idx < 0) return state;
      const messages = [...state.messages];
      messages[idx] = { ...messages[idx], ...patch } as ChatMessage;
      return { ...state, messages };
    }),

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
