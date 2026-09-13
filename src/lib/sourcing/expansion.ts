/**
 * Lignes dépliées de la liste de profils — PUR.
 *
 * Replié par défaut : le recruteur balaye d'abord. Il choisit ensuite s'il
 * déplie une ligne à la fois (ouvrir la suivante referme la précédente) ou
 * plusieurs.
 */

export type ExpansionState = { single: boolean; open: ReadonlySet<string> };

export const INITIAL_EXPANSION: ExpansionState = { single: false, open: new Set() };

export function toggleRow(state: ExpansionState, id: string): ExpansionState {
  if (state.open.has(id)) {
    const next = new Set(state.open);
    next.delete(id);
    return { ...state, open: next };
  }
  return { ...state, open: state.single ? new Set([id]) : new Set([...state.open, id]) };
}

/** Passer en « une à la fois » ne garde ouverte que la dernière ligne ouverte, s'il y en a. */
export function setSingle(state: ExpansionState, single: boolean): ExpansionState {
  if (!single) return { ...state, single };
  const last = [...state.open].at(-1);
  return { single, open: last ? new Set([last]) : new Set() };
}
