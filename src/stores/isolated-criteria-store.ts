/**
 * Store des critères isolés pour analyse CV (Session 4 — volatile).
 *
 * Frontière : équivalent mini de fdp-store. Une seule collecte active à
 * la fois ; reset() entre deux tâches isolées. La validation explicite
 * (isValidated) est requise avant de lancer dispatchCVBatch — c'est le
 * filet contre les analyses prématurées sur instruction trop vague.
 *
 * Coordination : alimenté par les tours du Manager via
 * `applyExtractions`, et par le DRH via l'édition manuelle dans
 * IsolatedCriteriaChecklist.
 */

import { create } from 'zustand';

import {
  buildEmptyIsolatedCriteria,
  computeIsolatedCriteriaComplete,
  ISOLATED_CRITERIA_KEYS,
  type IsolatedCriteriaInProgress,
  type IsolatedCriteriaKey,
} from '@/types/isolated-criteria';

export type IsolatedCriteriaState = {
  criteria: IsolatedCriteriaInProgress | null;

  startCollection: (taskId: string) => IsolatedCriteriaInProgress;
  applyExtractions: (
    extractions: Partial<Record<IsolatedCriteriaKey, unknown>>,
  ) => void;
  validate: () => void;
  reset: () => void;
};

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export const useIsolatedCriteriaStore = create<IsolatedCriteriaState>()(
  (set) => ({
    criteria: null,

    startCollection: (taskId) => {
      const fresh = buildEmptyIsolatedCriteria(taskId);
      set({ criteria: fresh });
      return fresh;
    },

    applyExtractions: (extractions) =>
      set((state) => {
        if (!state.criteria) return state;
        const fields = { ...state.criteria.fields };
        let touched = false;
        for (const key of ISOLATED_CRITERIA_KEYS) {
          const value = extractions[key];
          if (value === undefined) continue;
          const previous = fields[key];
          if (!previous) continue;
          if (!isMeaningful(value)) continue;
          fields[key] = { ...previous, value, status: 'filled' };
          touched = true;
        }
        if (!touched) return state;
        const isComplete = computeIsolatedCriteriaComplete(fields);
        return {
          ...state,
          criteria: { ...state.criteria, fields, isComplete },
        };
      }),

    validate: () =>
      set((state) => {
        if (!state.criteria || !state.criteria.isComplete) return state;
        return {
          ...state,
          criteria: { ...state.criteria, isValidated: true },
        };
      }),

    reset: () => set({ criteria: null }),
  }),
);

export const selectIsolatedCriteria = (
  state: IsolatedCriteriaState,
): IsolatedCriteriaInProgress | null => state.criteria;
