/**
 * Store des campagnes actives (Session 4 — volatile).
 *
 * Une « campagne active » = une FDP validée, encore ouverte (non
 * clôturée). Conservée en mémoire seulement, pour permettre le routing
 * d'un upload CV vers une campagne existante. La persistance arrive
 * en Session 5/7 avec le storage hybride Supabase + Drive.
 *
 * Frontière : les campagnes sont alimentées par `validateFDP()` côté
 * ManagerChat (pas d'auto-watch sur fdp-store pour rester explicite).
 */

import { create } from 'zustand';

import type { CampaignStatus } from '@/types/campaign-status';
import type { FDPInProgress } from '@/types/field-collection';
import type { PublicationChannel } from '@/types/publication-channel';
import type { ScoringSheet } from '@/types/scoring';

export type ActiveCampaign = {
  id: string; // CAMP-XXXX
  name: string; // intitulé du poste, ou nom donné explicitement
  fdp: FDPInProgress; // snapshot de la FDP au moment de l'archivage
  /**
   * Phase 5.2 — snapshot de la fiche de scoring associée à cette
   * campagne, si elle a été produite. Restaurée au switch pour
   * permettre au DRH de reprendre où il s'est arrêté.
   */
  scoringSheet: ScoringSheet | null;
  /**
   * Phase 7.1 — tracking des artefacts produits pour cette campagne.
   * Sert à recomputeStatus qui dérive 'active' uniquement quand TOUT
   * est aligné (FDP validée + au moins une annonce + flux confirmés
   * + scoring validé). Avant Phase 7, le status pouvait passer à
   * 'active' juste sur validation scoring même si la FDP ou les flux
   * n'étaient pas en place.
   */
  publishedChannels: PublicationChannel[];
  sourcesConfirmed: boolean;
  /**
   * Phase 5.1 — état d'avancement de la campagne. Dérivé par
   * recomputeStatus quand un jalon change, ou écrasé explicitement
   * par updateStatus (closed, paused).
   */
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
};

export type CampaignsState = {
  byId: Record<string, ActiveCampaign>;
  order: string[];

  addCampaign: (input: {
    fdp: FDPInProgress;
    name?: string;
    status?: CampaignStatus;
    scoringSheet?: ScoringSheet | null;
    publishedChannels?: PublicationChannel[];
    sourcesConfirmed?: boolean;
  }) => ActiveCampaign;
  /**
   * Écrase explicitement le statut d'une campagne (paused / closed
   * principalement). Pour les transitions dérivées (draft → in_progress
   * → active), utiliser recomputeStatus.
   */
  updateStatus: (id: string, status: CampaignStatus) => void;
  /**
   * Phase 7.1 — marque qu'une annonce a été produite pour ce channel.
   * Idempotent (pas de doublon). Recalcule le statut après.
   */
  markPublishedChannel: (id: string, channel: PublicationChannel) => void;
  /**
   * Phase 7.1 — marque que le cv-sources-picker a été confirmé.
   * Recalcule le statut après.
   */
  markSourcesConfirmed: (id: string) => void;
  /**
   * Phase 7.1 — recalcule le status DÉRIVÉ d'une campagne à partir de
   * ses artefacts. Règle :
   *   - FDP non validée → 'draft'
   *   - FDP validée mais (annonce manquante OR flux non confirmés OR
   *     scoring non validé) → 'in_progress'
   *   - Tout aligné → 'active'
   * Ne touche PAS aux statuts explicites 'paused' et 'closed' — un
   * recompute ne sort jamais quelqu'un de la pause ou de la clôture.
   */
  recomputeStatus: (id: string) => void;
  getById: (id: string) => ActiveCampaign | undefined;
  list: () => ActiveCampaign[];
  reset: () => void;
};

function jobTitleFromFDP(fdp: FDPInProgress): string {
  const v = fdp.fields.job_title?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return 'Poste non précisé';
}

/**
 * Dérive le status initial d'une campagne au moment de l'archivage.
 * La FDP validée mène à 'in_progress' (cadrage fait, reste annonce
 * + scoring) ; sinon 'draft'.
 */
function deriveInitialStatus(fdp: FDPInProgress): CampaignStatus {
  return fdp.isValidated ? 'in_progress' : 'draft';
}

export const useCampaignsStore = create<CampaignsState>()((set, get) => ({
  byId: {},
  order: [],

  addCampaign: (input) => {
    const name = input.name?.trim() || jobTitleFromFDP(input.fdp);
    const now = new Date().toISOString();
    // Si une entrée existe déjà avec cet id, on préserve son status
    // courant (ne le redescend pas à 'in_progress' alors qu'elle est
    // peut-être déjà 'active' / 'closed').
    const existing = get().byId[input.fdp.campaignId];
    const status =
      input.status ?? existing?.status ?? deriveInitialStatus(input.fdp);
    // Le snapshot de scoring du caller prime ; sinon on garde l'existant
    // (on évite de l'effacer accidentellement quand un addCampaign
    // ultérieur ne porte que la FDP).
    const scoringSheet =
      input.scoringSheet !== undefined
        ? input.scoringSheet
        : (existing?.scoringSheet ?? null);
    const publishedChannels =
      input.publishedChannels ?? existing?.publishedChannels ?? [];
    const sourcesConfirmed =
      input.sourcesConfirmed ?? existing?.sourcesConfirmed ?? false;
    const campaign: ActiveCampaign = {
      id: input.fdp.campaignId,
      name,
      fdp: input.fdp,
      scoringSheet,
      publishedChannels,
      sourcesConfirmed,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    set((state) => {
      const exists = Boolean(state.byId[campaign.id]);
      const order = exists ? state.order : [...state.order, campaign.id];
      return {
        ...state,
        byId: { ...state.byId, [campaign.id]: campaign },
        order,
      };
    });
    return campaign;
  },

  updateStatus: (id, status) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            status,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  markPublishedChannel: (id, channel) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      if (current.publishedChannels.includes(channel)) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            publishedChannels: [...current.publishedChannels, channel],
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  markSourcesConfirmed: (id) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      if (current.sourcesConfirmed) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            sourcesConfirmed: true,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  recomputeStatus: (id) =>
    set((state) => {
      const current = state.byId[id];
      if (!current) return state;
      // Les statuts explicites paused / closed ne sont jamais
      // écrasés par un recompute — seul l'utilisateur les change.
      if (current.status === 'paused' || current.status === 'closed') {
        return state;
      }
      let nextStatus: CampaignStatus;
      if (!current.fdp.isValidated) {
        nextStatus = 'draft';
      } else if (
        current.publishedChannels.length > 0 &&
        current.sourcesConfirmed &&
        current.scoringSheet?.isValidated === true
      ) {
        nextStatus = 'active';
      } else {
        nextStatus = 'in_progress';
      }
      if (nextStatus === current.status) return state;
      return {
        ...state,
        byId: {
          ...state.byId,
          [id]: {
            ...current,
            status: nextStatus,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    }),

  getById: (id) => get().byId[id],

  list: () => {
    const { order, byId } = get();
    return order
      .map((id) => byId[id])
      .filter((c): c is ActiveCampaign => Boolean(c));
  },

  reset: () => set({ byId: {}, order: [] }),
}));

export const selectActiveCampaigns = (
  state: CampaignsState,
): ActiveCampaign[] =>
  state.order
    .map((id) => state.byId[id])
    .filter((c): c is ActiveCampaign => Boolean(c));
