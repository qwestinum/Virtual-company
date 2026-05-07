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

import type { FDPInProgress } from '@/types/field-collection';

export type ActiveCampaign = {
  id: string; // CAMP-XXXX
  name: string; // intitulé du poste, ou nom donné explicitement
  fdp: FDPInProgress; // snapshot de la FDP validée
  createdAt: string;
};

export type CampaignsState = {
  byId: Record<string, ActiveCampaign>;
  order: string[];

  addCampaign: (input: { fdp: FDPInProgress; name?: string }) => ActiveCampaign;
  getById: (id: string) => ActiveCampaign | undefined;
  list: () => ActiveCampaign[];
  reset: () => void;
};

function jobTitleFromFDP(fdp: FDPInProgress): string {
  const v = fdp.fields.job_title?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return 'Poste non précisé';
}

export const useCampaignsStore = create<CampaignsState>()((set, get) => ({
  byId: {},
  order: [],

  addCampaign: (input) => {
    const name = input.name?.trim() || jobTitleFromFDP(input.fdp);
    const campaign: ActiveCampaign = {
      id: input.fdp.campaignId,
      name,
      fdp: input.fdp,
      createdAt: new Date().toISOString(),
    };
    set((state) => {
      // si une campagne avec le même id existe déjà, on remplace (cas
      // d'une re-validation après édition manuelle du DRH).
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
