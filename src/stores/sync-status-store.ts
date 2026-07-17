/**
 * État de synchronisation client ↔ serveur (anti-perte silencieuse).
 *
 * Les éditions de campagne/tâche sont en AUTOSAVE live et les artefacts sont
 * poussés en fire-and-forget : chaque push de fond pouvait échouer en silence
 * (réseau/4xx/5xx) → modification ou artefact perdus au reload sans que le DRH
 * le sache (audit C7). Ce store matérialise les entités dont le DERNIER push a
 * échoué, pour que la bannière « non enregistré » les signale et propose un
 * réessai. Le snapshot le plus récent par id est conservé (c'est lui qu'on
 * rejoue au retry).
 *
 * Volatil par nature : si l'onglet est rechargé alors qu'une écriture n'a pas
 * abouti, la modif est de toute façon perdue — d'où l'intérêt d'alerter AVANT.
 */

import { create } from 'zustand';

// Imports de TYPES uniquement (effacés à la compilation — pas de cycle
// runtime avec les modules de sync qui importent ce store).
import type { PushArtifactInput } from '@/lib/db/sync/artifacts-sync';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { ArchivedTask } from '@/stores/tasks-store';

export type SyncStatusState = {
  /** Campagnes dont le dernier push serveur a échoué (id → dernier snapshot). */
  failedCampaigns: Record<string, ActiveCampaign>;
  /** Marque (ou met à jour) une campagne comme non synchronisée. */
  markCampaignFailed: (snapshot: ActiveCampaign) => void;
  /** Lève le drapeau d'échec d'une campagne (push réussi). No-op si absente. */
  clearCampaignFailed: (id: string) => void;
  /** Liste des snapshots en échec (pour le retry). */
  failedList: () => ActiveCampaign[];

  /** Sollicitations (TASK-XXXX) dont le dernier push a échoué (audit C7). */
  failedTasks: Record<string, ArchivedTask>;
  markTaskFailed: (snapshot: ArchivedTask) => void;
  clearTaskFailed: (id: string) => void;
  failedTaskList: () => ArchivedTask[];

  /**
   * Artefacts dont le POST a échoué (audit C7) — on garde l'ENTRÉE COMPLÈTE
   * (artefact + contenu) : c'est elle qu'il faut rejouer, le Blob local seul
   * ne survit pas au reload.
   */
  failedArtifacts: Record<string, PushArtifactInput>;
  markArtifactFailed: (input: PushArtifactInput) => void;
  clearArtifactFailed: (id: string) => void;
  failedArtifactList: () => PushArtifactInput[];

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

  failedTasks: {},

  markTaskFailed: (snapshot) =>
    set((state) => ({
      ...state,
      failedTasks: { ...state.failedTasks, [snapshot.id]: snapshot },
    })),

  clearTaskFailed: (id) =>
    set((state) => {
      if (!state.failedTasks[id]) return state;
      const next = { ...state.failedTasks };
      delete next[id];
      return { ...state, failedTasks: next };
    }),

  failedTaskList: () => Object.values(get().failedTasks),

  failedArtifacts: {},

  markArtifactFailed: (input) =>
    set((state) => ({
      ...state,
      failedArtifacts: {
        ...state.failedArtifacts,
        [input.artifact.id]: input,
      },
    })),

  clearArtifactFailed: (id) =>
    set((state) => {
      if (!state.failedArtifacts[id]) return state;
      const next = { ...state.failedArtifacts };
      delete next[id];
      return { ...state, failedArtifacts: next };
    }),

  failedArtifactList: () => Object.values(get().failedArtifacts),

  reset: () =>
    set({ failedCampaigns: {}, failedTasks: {}, failedArtifacts: {} }),
}));

/** Sélecteur réactif : nombre de campagnes non synchronisées. */
export const selectFailedCount = (state: SyncStatusState): number =>
  Object.keys(state.failedCampaigns).length;

/** Sélecteur réactif : total d'entités non synchronisées (bannière). */
export const selectTotalFailedCount = (state: SyncStatusState): number =>
  Object.keys(state.failedCampaigns).length +
  Object.keys(state.failedTasks).length +
  Object.keys(state.failedArtifacts).length;
