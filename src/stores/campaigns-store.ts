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
   * Phase 5.1 — état d'avancement de la campagne. Dérivé initialement
   * de fdp.isValidated (validée → 'in_progress', sinon 'draft'), puis
   * mis à jour par updateStatus quand des jalons en aval sont franchis
   * (validation fiche de scoring → 'active', clôture → 'closed').
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
  }) => ActiveCampaign;
  /**
   * Met à jour le statut d'une campagne archivée. Si l'id est
   * inconnu, no-op (les helpers appelants doivent vérifier avant).
   * Met aussi à jour updatedAt pour traçabilité.
   */
  updateStatus: (id: string, status: CampaignStatus) => void;
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
    const campaign: ActiveCampaign = {
      id: input.fdp.campaignId,
      name,
      fdp: input.fdp,
      scoringSheet,
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
