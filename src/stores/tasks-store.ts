/**
 * Store des tâches isolées actives/archivées (Session 4 — volatile).
 *
 * Symétrique de campaigns-store pour les sollicitations TASK-XXXX qui
 * passent par le flux isolated (4 critères au lieu de 8 champs FDP).
 *
 * Frontière : le store conserve un snapshot d'IsolatedCriteriaInProgress
 * — utile pour ré-afficher une tâche dans le sélecteur de campagne et
 * éventuellement la reprendre (restoreIsolatedCriteria). Les artefacts
 * produits restent dans artifacts-store (pas dupliqués ici).
 */

import { create } from 'zustand';

import type { CampaignStatus } from '@/types/campaign-status';
import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';

export type ArchivedTask = {
  id: string; // TASK-XXXX
  name: string; // intitulé extrait de criteria.job_title, ou taskId
  criteria: IsolatedCriteriaInProgress;
  /**
   * Phase 5.1 — état d'avancement. Pour les tâches isolées :
   *   - draft  : collecte des 4 critères en cours,
   *   - active : critères validés et batch CV déclenché ou prêt,
   *   - closed : clôturée explicitement.
   * 'in_progress' n'apparaît pas pour les tâches (pas d'étape
   * intermédiaire annonce/scoring entre la validation et l'action).
   */
  status: CampaignStatus;
  createdAt: string;
  updatedAt: string;
};

export type TasksState = {
  byId: Record<string, ArchivedTask>;
  order: string[];

  addTask: (input: {
    criteria: IsolatedCriteriaInProgress;
    name?: string;
    status?: CampaignStatus;
  }) => ArchivedTask;
  updateStatus: (id: string, status: CampaignStatus) => void;
  getById: (id: string) => ArchivedTask | undefined;
  list: () => ArchivedTask[];
  reset: () => void;
};

function titleFromCriteria(criteria: IsolatedCriteriaInProgress): string {
  const v = criteria.fields.job_title?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return 'Poste non précisé';
}

function deriveInitialTaskStatus(
  criteria: IsolatedCriteriaInProgress,
): CampaignStatus {
  return criteria.isValidated ? 'active' : 'draft';
}

export const useTasksStore = create<TasksState>()((set, get) => ({
  byId: {},
  order: [],

  addTask: (input) => {
    const name = input.name?.trim() || titleFromCriteria(input.criteria);
    const now = new Date().toISOString();
    const existing = get().byId[input.criteria.taskId];
    const status =
      input.status ??
      existing?.status ??
      deriveInitialTaskStatus(input.criteria);
    const task: ArchivedTask = {
      id: input.criteria.taskId,
      name,
      criteria: input.criteria,
      status,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    set((state) => {
      const exists = Boolean(state.byId[task.id]);
      const order = exists ? state.order : [...state.order, task.id];
      return {
        ...state,
        byId: { ...state.byId, [task.id]: task },
        order,
      };
    });
    return task;
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
      .filter((t): t is ArchivedTask => Boolean(t));
  },

  reset: () => set({ byId: {}, order: [] }),
}));
