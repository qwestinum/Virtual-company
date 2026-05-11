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

import type { IsolatedCriteriaInProgress } from '@/types/isolated-criteria';

export type ArchivedTask = {
  id: string; // TASK-XXXX
  name: string; // intitulé extrait de criteria.job_title, ou taskId
  criteria: IsolatedCriteriaInProgress;
  createdAt: string;
};

export type TasksState = {
  byId: Record<string, ArchivedTask>;
  order: string[];

  addTask: (input: {
    criteria: IsolatedCriteriaInProgress;
    name?: string;
  }) => ArchivedTask;
  getById: (id: string) => ArchivedTask | undefined;
  list: () => ArchivedTask[];
  reset: () => void;
};

function titleFromCriteria(criteria: IsolatedCriteriaInProgress): string {
  const v = criteria.fields.job_title?.value;
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return 'Poste non précisé';
}

export const useTasksStore = create<TasksState>()((set, get) => ({
  byId: {},
  order: [],

  addTask: (input) => {
    const name = input.name?.trim() || titleFromCriteria(input.criteria);
    const task: ArchivedTask = {
      id: input.criteria.taskId,
      name,
      criteria: input.criteria,
      createdAt: new Date().toISOString(),
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

  getById: (id) => get().byId[id],

  list: () => {
    const { order, byId } = get();
    return order
      .map((id) => byId[id])
      .filter((t): t is ArchivedTask => Boolean(t));
  },

  reset: () => set({ byId: {}, order: [] }),
}));
