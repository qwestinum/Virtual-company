/**
 * Store de la fiche de scoring en cours d'édition (Phase 4.1).
 *
 * Symétrique de fdp-store : une seule fiche active à la fois, liée à
 * la campagne courante (campaignId). Le DRH peut ajuster les critères
 * (label, niveau, poids), en ajouter, en retirer, puis valider —
 * `isValidated: true` débloque le scoring CV pondéré.
 *
 * Frontière : ce store ne connaît pas le chat ni la FDP. La
 * proposition initiale arrive depuis un appel serveur dédié
 * (/api/manager/scoring — Phase 4.2) qui produit la liste de
 * critères à partir d'une FDP validée. Le store reçoit ensuite des
 * modifs locales du DRH via l'UI.
 */

import { create } from 'zustand';

import {
  buildCriterion,
  type ScoringCriterion,
  type ScoringLevel,
  type ScoringSheet,
  DEFAULT_WEIGHTS,
} from '@/types/scoring';

export type ScoringState = {
  sheet: ScoringSheet | null;

  /**
   * Pose une nouvelle fiche de scoring proposée (résultat de
   * l'appel /api/manager/scoring). Écrase la fiche éventuellement
   * en cours — la proposition est toujours une réinitialisation,
   * pas une fusion. `isValidated` repart à false.
   */
  proposeSheet: (
    campaignId: string,
    criteria: ScoringCriterion[],
  ) => ScoringSheet;
  /**
   * Restaure un snapshot existant (typiquement repris depuis un
   * éventuel scoring-store archivé via le sélecteur de campagne —
   * non implémenté en Phase 4.1, mais le helper est prêt).
   */
  restoreSheet: (snapshot: ScoringSheet) => void;
  addCriterion: (
    input: Omit<ScoringCriterion, 'id' | 'weight'> & {
      weight?: number;
    },
  ) => void;
  updateCriterion: (
    id: string,
    patch: Partial<Pick<ScoringCriterion, 'label' | 'level' | 'weight'>>,
  ) => void;
  removeCriterion: (id: string) => void;
  validate: () => void;
  reset: () => void;
};

function generateCriterionId(): string {
  if (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.randomUUID === 'function'
  ) {
    return `crit_${globalThis.crypto.randomUUID()}`;
  }
  return `crit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const useScoringStore = create<ScoringState>()((set) => ({
  sheet: null,

  proposeSheet: (campaignId, criteria) => {
    const fresh: ScoringSheet = {
      campaignId,
      criteria,
      isValidated: false,
    };
    set({ sheet: fresh });
    return fresh;
  },

  restoreSheet: (snapshot) => set({ sheet: snapshot }),

  addCriterion: (input) =>
    set((state) => {
      if (!state.sheet) return state;
      const criterion = buildCriterion({
        id: generateCriterionId(),
        label: input.label,
        level: input.level,
        weight: input.weight,
      });
      return {
        ...state,
        sheet: {
          ...state.sheet,
          criteria: [...state.sheet.criteria, criterion],
        },
      };
    }),

  updateCriterion: (id, patch) =>
    set((state) => {
      if (!state.sheet) return state;
      const idx = state.sheet.criteria.findIndex((c) => c.id === id);
      if (idx < 0) return state;
      const current = state.sheet.criteria[idx]!;
      // Si on change le niveau et qu'aucun poids explicite n'est
      // fourni dans le patch, on aligne le poids sur la valeur par
      // défaut du nouveau niveau (sinon le DRH aurait un poids
      // hérité incohérent — ex. niveau "souhaitable" avec poids 10).
      const nextLevel: ScoringLevel = patch.level ?? current.level;
      const nextWeight =
        patch.weight !== undefined
          ? patch.weight
          : patch.level !== undefined && patch.level !== current.level
            ? DEFAULT_WEIGHTS[nextLevel]
            : current.weight;
      const updated: ScoringCriterion = {
        ...current,
        label: patch.label ?? current.label,
        level: nextLevel,
        weight: nextWeight,
      };
      const criteria = [...state.sheet.criteria];
      criteria[idx] = updated;
      return { ...state, sheet: { ...state.sheet, criteria } };
    }),

  removeCriterion: (id) =>
    set((state) => {
      if (!state.sheet) return state;
      return {
        ...state,
        sheet: {
          ...state.sheet,
          criteria: state.sheet.criteria.filter((c) => c.id !== id),
        },
      };
    }),

  validate: () =>
    set((state) => {
      if (!state.sheet) return state;
      if (state.sheet.criteria.length === 0) return state;
      return {
        ...state,
        sheet: { ...state.sheet, isValidated: true },
      };
    }),

  reset: () => set({ sheet: null }),
}));

export const selectScoringSheet = (state: ScoringState): ScoringSheet | null =>
  state.sheet;
