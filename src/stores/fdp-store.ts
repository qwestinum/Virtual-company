/**
 * Store de la FDP en cours de cadrage (Session 3).
 *
 * Frontière : ce store ne connaît PAS le chat. Il modélise un objet
 * métier (la FDP, mappée 1-1 sur le contrat FDPInProgress) avec son
 * cycle de vie propre. La coordination chat ↔ FDP se fait dans
 * src/lib/agents/manager.ts ; aucun store ne référence l'autre. Si tu
 * trouves un import de chat-store ici, c'est un bug — supprime-le.
 *
 * Cycle de vie :
 *   createFDP(campaignId)        — instancie une FDP vide (8 champs).
 *   applyExtractions({...})      — applique les extractions LLM
 *                                  (idempotent, recompute isComplete).
 *   markFieldInProgress(key)     — hint UI pour la prochaine question.
 *   validateFDP()                — bascule isValidated, uniquement si
 *                                  la FDP est isComplete (gardes-fous).
 *   reset()                      — efface la FDP.
 */

import { create } from 'zustand';

import {
  buildEmptyFDP,
  computeIsComplete,
  FIELD_KEYS,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';

export type FdpState = {
  fdp: FDPInProgress | null;

  createFDP: (campaignId: string) => FDPInProgress;
  /**
   * Restaure un snapshot de FDP existant (typiquement repris depuis
   * campaigns-store via le sélecteur de campagne sub-phase 1.4).
   * Distinct de createFDP : on n'efface PAS les valeurs des champs,
   * on les reprend telles quelles. isComplete et isValidated suivent
   * le snapshot d'origine.
   */
  restoreFDP: (snapshot: FDPInProgress) => void;
  applyExtractions: (
    extractions: Partial<Record<FieldKey, unknown>>,
  ) => void;
  markFieldInProgress: (key: FieldKey) => void;
  validateFDP: () => void;
  reset: () => void;
};

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export const useFdpStore = create<FdpState>()((set) => ({
  fdp: null,

  createFDP: (campaignId) => {
    const fresh = buildEmptyFDP(campaignId);
    set({ fdp: fresh });
    return fresh;
  },

  restoreFDP: (snapshot) => set({ fdp: snapshot }),

  applyExtractions: (extractions) =>
    set((state) => {
      if (!state.fdp) return state;
      const fields = { ...state.fdp.fields };
      let touched = false;
      for (const key of FIELD_KEYS) {
        const value = extractions[key];
        if (value === undefined) continue;
        const previous = fields[key];
        if (!previous) continue;
        if (!isMeaningful(value)) continue;
        fields[key] = { ...previous, value, status: 'filled' };
        touched = true;
      }
      if (!touched) return state;
      const isComplete = computeIsComplete(fields);
      return {
        ...state,
        fdp: { ...state.fdp, fields, isComplete },
      };
    }),

  markFieldInProgress: (key) =>
    set((state) => {
      if (!state.fdp) return state;
      const previous = state.fdp.fields[key];
      if (!previous || previous.status === 'filled') return state;
      const fields = {
        ...state.fdp.fields,
        [key]: { ...previous, status: 'in_progress' as const },
      };
      return { ...state, fdp: { ...state.fdp, fields } };
    }),

  validateFDP: () =>
    set((state) => {
      if (!state.fdp || !state.fdp.isComplete) return state;
      return { ...state, fdp: { ...state.fdp, isValidated: true } };
    }),

  reset: () => set({ fdp: null }),
}));

export const selectFdp = (state: FdpState): FDPInProgress | null => state.fdp;
export const selectIsFdpComplete = (state: FdpState): boolean =>
  state.fdp?.isComplete ?? false;
export const selectIsFdpValidated = (state: FdpState): boolean =>
  state.fdp?.isValidated ?? false;
