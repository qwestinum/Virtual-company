/**
 * Engine DÉTERMINISTE du cycle de vie d'une campagne (Inc. 0).
 *
 * 100 % pur et testable : aucune dépendance au LLM, au store ou au DOM.
 * Toute la logique de « où on en est / quoi ensuite / quelles actions /
 * quelles transitions légales » vit ICI, et nulle part ailleurs. Les
 * handlers (chat, dashboard) appelleront ces fonctions ; ils ne
 * recalculeront jamais l'état à la main.
 *
 * Gestion d'erreur stricte : `applyTransition` ne lève pas et ne mute
 * jamais dans un état illégal — il renvoie un `LifecycleResult` discriminé
 * (`ok: true` avec le nouvel état, ou `ok: false` avec une `LifecycleError`
 * typée). Les entrées externes (storage, futur LLM) passent par
 * `parseLifecycle`, qui valide via Zod avant d'entrer dans la machine.
 */

import type { CampaignStatus } from '@/types/campaign-status';
import {
  CampaignLifecycleSchema,
  isRequiredPhase,
  OPTIONAL_PHASE_IDS,
  PHASE_DEPENDENCIES,
  PHASE_IDS,
  PHASE_ORDER,
  REQUIRED_PHASE_IDS,
  type CampaignLifecycle,
  type LifecycleResult,
  type LifecycleTransition,
  type Phase,
  type PhaseAction,
  type PhaseId,
  type PhaseStatus,
} from '@/types/campaign-lifecycle';

/** Statut « réglé » : la phase ne réclame plus d'action (faite ou reportée). */
function isSettled(status: PhaseStatus): boolean {
  return status === 'done' || status === 'postponed';
}

/** Construit une phase. */
function makePhase(id: PhaseId, status: PhaseStatus): Phase {
  return { id, status, required: isRequiredPhase(id) };
}

/**
 * Machine initiale d'une campagne fraîchement archivée : la FDP est
 * `done` (une campagne n'existe qu'après validation FDP), tout l'aval est
 * `pending`. `overrides` permet de partir d'un autre état (reprise, tests).
 */
export function buildLifecycle(
  overrides: Partial<Record<PhaseId, PhaseStatus>> = {},
): CampaignLifecycle {
  const phases = {} as Record<PhaseId, Phase>;
  for (const id of PHASE_IDS) {
    const fallback: PhaseStatus = id === 'fdp' ? 'done' : 'pending';
    phases[id] = makePhase(id, overrides[id] ?? fallback);
  }
  return { phases };
}

/**
 * Valide et normalise une machine venant d'une source externe (storage,
 * futur LLM). Renvoie `null` si l'invariant n'est pas respecté — l'appelant
 * retombe alors sur `buildLifecycle` plutôt que de propager un état corrompu.
 */
export function parseLifecycle(value: unknown): CampaignLifecycle | null {
  const parsed = CampaignLifecycleSchema.safeParse(value);
  if (!parsed.success) return null;
  // Re-projette dans l'ordre canonique pour garantir une forme stable.
  const phases = {} as Record<PhaseId, Phase>;
  for (const id of PHASE_IDS) {
    phases[id] = { ...parsed.data.phases[id]! };
  }
  return { phases };
}

/** Dépendances directes non encore `done` d'une phase. */
export function missingDependencies(
  lifecycle: CampaignLifecycle,
  phaseId: PhaseId,
): PhaseId[] {
  return PHASE_DEPENDENCIES[phaseId].filter(
    (dep) => lifecycle.phases[dep].status !== 'done',
  );
}

export function dependenciesMet(
  lifecycle: CampaignLifecycle,
  phaseId: PhaseId,
): boolean {
  return missingDependencies(lifecycle, phaseId).length === 0;
}

/** Dépendants TRANSITIFS d'une phase (phases dont elle est un prérequis). */
export function transitiveDependents(phaseId: PhaseId): PhaseId[] {
  const result: PhaseId[] = [];
  let changed = true;
  const acc = new Set<PhaseId>();
  while (changed) {
    changed = false;
    for (const id of PHASE_IDS) {
      if (acc.has(id)) continue;
      const deps = PHASE_DEPENDENCIES[id];
      if (deps.includes(phaseId) || deps.some((d) => acc.has(d))) {
        acc.add(id);
        result.push(id);
        changed = true;
      }
    }
  }
  return result;
}

/**
 * Phase COURANTE : première phase de l'ordre canonique non réglée
 * (pending/in_progress) ET dont les dépendances sont satisfaites. `null`
 * si tout est réglé (ou si l'avant est bloqué par une optionnelle reportée).
 */
export function currentPhase(lifecycle: CampaignLifecycle): PhaseId | null {
  for (const id of PHASE_ORDER) {
    const status = lifecycle.phases[id].status;
    if (isSettled(status)) continue;
    if (dependenciesMet(lifecycle, id)) return id;
  }
  return null;
}

/**
 * Actions légales proposables au DRH pour une phase, déduites de son statut,
 * de son caractère obligatoire et de ses dépendances. Déterministe : c'est
 * CETTE fonction qui garantit qu'aucun état n'est un cul-de-sac.
 */
export function availableActions(
  lifecycle: CampaignLifecycle,
  phaseId: PhaseId,
): PhaseAction[] {
  const { status, required } = lifecycle.phases[phaseId];
  const depsMet = dependenciesMet(lifecycle, phaseId);
  switch (status) {
    case 'pending':
      if (!depsMet) return []; // verrouillée tant que l'amont n'est pas fait
      return required ? ['configure'] : ['configure', 'postpone'];
    case 'in_progress':
      return required ? ['validate'] : ['validate', 'postpone'];
    case 'done':
      return ['adjust', 'reopen'];
    case 'postponed':
      // Optionnelle reportée : reprenable à tout moment.
      return ['configure', 'reopen'];
    default:
      return [];
  }
}

/**
 * Statut DÉRIVÉ de la campagne à partir de la machine (hors paused/closed,
 * qui sont des surcharges explicites gérées par l'appelant) :
 *   - fdp non `done`                → 'draft'
 *   - toutes obligatoires `done` ET optionnelles `done`/`postponed` → 'active'
 *   - sinon                         → 'in_progress'
 */
export function deriveActiveStatus(
  lifecycle: CampaignLifecycle,
): Extract<CampaignStatus, 'draft' | 'in_progress' | 'active'> {
  if (lifecycle.phases.fdp.status !== 'done') return 'draft';
  const requiredDone = REQUIRED_PHASE_IDS.every(
    (id) => lifecycle.phases[id].status === 'done',
  );
  const optionalSettled = OPTIONAL_PHASE_IDS.every((id) =>
    isSettled(lifecycle.phases[id].status),
  );
  return requiredDone && optionalSettled ? 'active' : 'in_progress';
}

/**
 * Étape de flux à présenter au DRH, dérivée DÉTERMINISTIQUEMENT de la
 * machine. C'est le seul juge de « quoi montrer / faire ensuite » — il
 * remplacera le chaînage impératif dispersé (Inc. 2c-2). `actions` reprend
 * les actions légales de la phase (Configurer/Valider/Reporter…).
 */
export type FlowStep =
  | { kind: 'collect-fdp'; phase: 'fdp'; actions: PhaseAction[] }
  | { kind: 'scoring'; phase: 'scoring'; actions: PhaseAction[] }
  | { kind: 'intake'; phase: 'intake'; actions: PhaseAction[] }
  | { kind: 'announcement'; phase: 'announcement'; actions: PhaseAction[] }
  | { kind: 'publication'; phase: 'publication'; actions: PhaseAction[] }
  | { kind: 'launched'; phase: null; actions: [] };

/**
 * Prochaine étape du flux pour une campagne, depuis sa machine. Pure et
 * totale. `launched` quand toutes les phases sont réglées (la campagne est
 * « lancée »). Le `kind` mappe 1-1 sur la phase courante (sauf `launched`).
 */
export function nextFlowStep(lifecycle: CampaignLifecycle): FlowStep {
  const phase = currentPhase(lifecycle);
  if (phase === null) return { kind: 'launched', phase: null, actions: [] };
  const actions = availableActions(lifecycle, phase);
  switch (phase) {
    case 'fdp':
      return { kind: 'collect-fdp', phase, actions };
    case 'scoring':
      return { kind: 'scoring', phase, actions };
    case 'intake':
      return { kind: 'intake', phase, actions };
    case 'announcement':
      return { kind: 'announcement', phase, actions };
    case 'publication':
      return { kind: 'publication', phase, actions };
  }
}

function cloneWith(
  lifecycle: CampaignLifecycle,
  patch: Partial<Record<PhaseId, PhaseStatus>>,
): CampaignLifecycle {
  const phases = {} as Record<PhaseId, Phase>;
  for (const id of PHASE_IDS) {
    const next = patch[id];
    phases[id] =
      next === undefined
        ? lifecycle.phases[id]
        : { ...lifecycle.phases[id], status: next };
  }
  return { phases };
}

/**
 * Applique une transition. SEUL mutateur autorisé de la machine. Valide la
 * légalité (statut de départ, dépendances, optionnalité) et renvoie un
 * résultat discriminé — jamais d'exception, jamais d'état illégal silencieux.
 *
 *   - start    : pending|postponed → in_progress (dépendances requises).
 *   - complete : pending|in_progress → done (dépendances requises).
 *   - postpone : pending|in_progress → postponed (phase OPTIONNELLE only).
 *   - reopen   : done|postponed → pending, AVEC cascade : tout dépendant
 *                transitif réglé redescend à pending (cohérence source→dérivés).
 */
export function applyTransition(
  lifecycle: CampaignLifecycle,
  transition: LifecycleTransition,
): LifecycleResult {
  const { kind, phaseId } = transition;
  if (!PHASE_IDS.includes(phaseId)) {
    return { ok: false, error: { code: 'unknown_phase', phaseId } };
  }
  const from = lifecycle.phases[phaseId].status;

  const illegal: LifecycleResult = {
    ok: false,
    error: { code: 'illegal_transition', phaseId, from, kind },
  };

  switch (kind) {
    case 'start': {
      if (from !== 'pending' && from !== 'postponed') return illegal;
      const missing = missingDependencies(lifecycle, phaseId);
      if (missing.length > 0) {
        return { ok: false, error: { code: 'dependency_not_met', phaseId, missing } };
      }
      return { ok: true, lifecycle: cloneWith(lifecycle, { [phaseId]: 'in_progress' }) };
    }
    case 'complete': {
      if (from !== 'pending' && from !== 'in_progress') return illegal;
      const missing = missingDependencies(lifecycle, phaseId);
      if (missing.length > 0) {
        return { ok: false, error: { code: 'dependency_not_met', phaseId, missing } };
      }
      return { ok: true, lifecycle: cloneWith(lifecycle, { [phaseId]: 'done' }) };
    }
    case 'postpone': {
      if (isRequiredPhase(phaseId)) {
        return { ok: false, error: { code: 'cannot_postpone_required', phaseId } };
      }
      if (from !== 'pending' && from !== 'in_progress') return illegal;
      return { ok: true, lifecycle: cloneWith(lifecycle, { [phaseId]: 'postponed' }) };
    }
    case 'reopen': {
      if (from !== 'done' && from !== 'postponed') return illegal;
      const patch: Partial<Record<PhaseId, PhaseStatus>> = { [phaseId]: 'pending' };
      for (const dep of transitiveDependents(phaseId)) {
        if (isSettled(lifecycle.phases[dep].status)) patch[dep] = 'pending';
      }
      return { ok: true, lifecycle: cloneWith(lifecycle, patch) };
    }
    default:
      return illegal;
  }
}

/**
 * BRIDGE Inc. 0 — dérive une machine depuis l'état legacy d'une campagne
 * (les booléens actuels), SANS rien changer au comportement. Sert aux
 * incréments suivants et aux tests pour relier l'ancien monde au nouveau.
 *
 * NB : tant que rédaction et publication sont fusionnées côté legacy
 * (`publishedChannels`), les deux phases en sont dérivées identiquement ;
 * la séparation réelle arrive en Inc. 2.
 */
export function lifecycleFromLegacy(input: {
  fdpValidated: boolean;
  scoringValidated: boolean;
  scoringStarted?: boolean;
  sourcesConfirmed: boolean;
  hasPublishedChannel: boolean;
}): CampaignLifecycle {
  return reconcileLifecycle(null, input);
}

/**
 * Réconcilie une machine STOCKÉE avec les artefacts legacy (booléens).
 * Une phase « faite » (artefact présent) passe `done` ; sinon on PRÉSERVE
 * un état explicite antérieur (`postponed` → reste reporté, `in_progress`
 * → reste en cours), faute de quoi `pending`. C'est ce qui permettra,
 * dès l'introduction du report (« à remettre à plus tard »), de NE PAS
 * écraser un `postponed` à chaque recompute.
 *
 * Tant qu'aucune phase n'est `postponed` (avant Inc. 2 report), le
 * résultat est une projection pure des booléens = comportement actuel.
 */
export function reconcileLifecycle(
  prev: CampaignLifecycle | null,
  input: {
    fdpValidated: boolean;
    scoringValidated: boolean;
    scoringStarted?: boolean;
    sourcesConfirmed: boolean;
    hasPublishedChannel: boolean;
  },
): CampaignLifecycle {
  // Phases réconciliées depuis les booléens d'artefacts.
  const done: Partial<Record<PhaseId, boolean>> = {
    fdp: input.fdpValidated,
    scoring: input.scoringValidated,
    intake: input.sourcesConfirmed,
  };
  const overrides = {} as Record<PhaseId, PhaseStatus>;
  for (const id of PHASE_IDS) {
    // Inc. 2c-3 — annonce et publication sont PILOTÉES PAR TRANSITIONS
    // (rédiger / publier / à remettre à plus tard), pas par les booléens :
    // on préserve TOUJOURS leur état explicite. Pont legacy (campagne
    // rechargée du storage sans machine) seulement à défaut de `prev` :
    // `publishedChannels > 0` ⇒ les deux `done`, sinon `pending`.
    if (id === 'announcement' || id === 'publication') {
      overrides[id] =
        prev?.phases[id].status ??
        (input.hasPublishedChannel ? 'done' : 'pending');
      continue;
    }
    if (done[id]) {
      overrides[id] = 'done';
      continue;
    }
    const prevStatus = prev?.phases[id].status;
    if (prevStatus === 'postponed' || prevStatus === 'in_progress') {
      overrides[id] = prevStatus;
      continue;
    }
    if (id === 'scoring' && input.scoringStarted) {
      overrides[id] = 'in_progress';
      continue;
    }
    overrides[id] = 'pending';
  }
  return buildLifecycle(overrides);
}
