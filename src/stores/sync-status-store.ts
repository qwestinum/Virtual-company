/**
 * État de synchronisation client ↔ serveur (anti-perte silencieuse).
 *
 * Les éditions de campagne sont en AUTOSAVE live : chaque mutation du store
 * déclenche un push de fond debouncé (campaigns-sync). Ce push pouvait échouer
 * en silence (réseau/4xx/5xx) → modification perdue au reload sans que le DRH
 * le sache. Ce store matérialise les campagnes dont le DERNIER push a échoué,
 * pour qu'une bannière les signale et propose un réessai. Le snapshot le plus
 * récent par id est conservé (c'est lui qu'on rejoue au retry).
 *
 * Volatil par nature : si l'onglet est rechargé alors qu'une écriture n'a pas
 * abouti, la modif est de toute façon perdue — d'où l'intérêt d'alerter AVANT.
 */

import { create } from 'zustand';

import type { ActiveCampaign } from '@/stores/campaigns-store';

export type SyncStatusState = {
  /** Campagnes dont le dernier push serveur a échoué (id → dernier snapshot). */
  failedCampaigns: Record<string, ActiveCampaign>;
  /** Marque (ou met à jour) une campagne comme non synchronisée. */
  markCampaignFailed: (snapshot: ActiveCampaign) => void;
  /** Lève le drapeau d'échec d'une campagne (push réussi). No-op si absente. */
  clearCampaignFailed: (id: string) => void;
  /** Liste des snapshots en échec (pour le retry). */
  failedList: () => ActiveCampaign[];
  reset: () => void;
};

export const useSyncStatusStore = create<SyncStatusState>()((set, get) => ({
  failedCampaigns: {},

  markCampaignFailed: (snapshot) =>
    set((state) => ({
      ...state,
      failedCampaigns: { ...state.failedCampaigns, [snapshot.id]: snapshot },
    })),

  clearCampaignFailed: (id) =>
    set((state) => {
      if (!state.failedCampaigns[id]) return state;
      const next = { ...state.failedCampaigns };
      delete next[id];
      return { ...state, failedCampaigns: next };
    }),

  failedList: () => Object.values(get().failedCampaigns),

  reset: () => set({ failedCampaigns: {} }),
}));

/** Sélecteur réactif : nombre de campagnes non synchronisées. */
export const selectFailedCount = (state: SyncStatusState): number =>
  Object.keys(state.failedCampaigns).length;
