/**
 * Marqueurs de décision candidat — VOCABULAIRE UNIQUE, écriture ET lecture.
 * PUR, CLIENT-SAFE, testable.
 *
 * L'architecture ne stocke pas d'étape : `deriveCandidateStage` la DÉRIVE de
 * marqueurs journalisés en AJOUT SEUL, sémantique dernier-gagne. Corriger une
 * décision, c'est donc POSER un nouveau marqueur — jamais supprimer ni
 * réécrire l'ancien.
 *
 * D'où la troisième valeur `cleared` : « j'ai cliqué sur la mauvaise ligne »
 * ne se répare pas par une bascule. Basculer « réalisé » → « absent » poserait
 * une DÉCISION (l'absence dérive vers `non_retenu`) là où l'on veut seulement
 * RETIRER le marquage. `cleared` est une GOMME : elle ne dérive vers aucune
 * étape, le dossier retombe sur ses colonnes. Ce n'est pas l'état parallèle
 * que le module d'entretien s'interdit — c'est l'absence d'état.
 *
 * ⚠️ CE FICHIER EST LE SEUL À LIRE `payload.status`. Les lecteurs ne parsent
 * jamais la valeur brute : ils appellent `foldInterviewMark` /
 * `foldValidationMark` (dernier-gagne + gomme en un seul endroit) ou
 * `describe*Mark` pour l'affichage. Un `switch` exhaustif sur l'union +
 * `assertNever` fait ÉCHOUER LA COMPILATION si une valeur est ajoutée sans
 * être traitée partout : la vigilance ne protège rien, le typage si.
 */

export const INTERVIEW_MARKER_ACTION = 'candidate_interview_marked';
export const VALIDATION_MARKER_ACTION = 'candidate_validation_marked';
/** Événement dédié de correction (frise + fil d'activité). */
export const DECISION_CORRECTED_ACTION = 'decision_corrected';

/** Valeurs ÉCRITES au journal. */
export type InterviewMarkValue = 'realized' | 'missed' | 'cleared';
export type ValidationMarkValue = 'validated' | 'rejected' | 'cleared';

/**
 * EFFET sur la dérivation d'étape. `null` = aucun effet : le marqueur a été
 * gommé, `deriveCandidateStage` retombe sur les signaux de rang inférieur.
 */
export type InterviewMarkEffect = 'realized' | 'missed' | null;
export type ValidationMarkEffect = 'validated' | 'rejected' | null;

function assertNever(value: never): never {
  throw new Error(`Valeur de marqueur non traitée : ${String(value)}`);
}

export function interviewMarkEffect(
  value: InterviewMarkValue,
): InterviewMarkEffect {
  switch (value) {
    case 'realized':
      return 'realized';
    case 'missed':
      return 'missed';
    case 'cleared':
      return null;
    default:
      return assertNever(value);
  }
}

export function validationMarkEffect(
  value: ValidationMarkValue,
): ValidationMarkEffect {
  switch (value) {
    case 'validated':
      return 'validated';
    case 'rejected':
      return 'rejected';
    case 'cleared':
      return null;
    default:
      return assertNever(value);
  }
}

// ─── Lecture défensive (le payload vient de la base, pas du code) ──────────

export function readInterviewMark(
  payload: Record<string, unknown> | null | undefined,
): InterviewMarkValue | null {
  const raw = payload?.status;
  return raw === 'realized' || raw === 'missed' || raw === 'cleared'
    ? raw
    : null;
}

export function readValidationMark(
  payload: Record<string, unknown> | null | undefined,
): ValidationMarkValue | null {
  const raw = payload?.status;
  return raw === 'validated' || raw === 'rejected' || raw === 'cleared'
    ? raw
    : null;
}

// ─── Dernier-gagne (UN seul endroit, tous lecteurs confondus) ──────────────

/**
 * État courant d'un marqueur. `at` est posé MÊME quand l'effet est `null`
 * (gomme) — c'est ce qui empêche un marqueur ANTÉRIEUR de reprendre la main.
 * Le piège est réel : un filtre `status === 'realized' || 'missed'` placé
 * AVANT la comparaison de dates fait gagner l'ancien marquage, et la
 * correction est silencieusement ignorée.
 */
export type MarkerState<E> = { effect: E; at: string | null };

export function emptyInterviewState(): MarkerState<InterviewMarkEffect> {
  return { effect: null, at: null };
}

export function emptyValidationState(): MarkerState<ValidationMarkEffect> {
  return { effect: null, at: null };
}

function fold<V, E>(
  state: MarkerState<E>,
  value: V | null,
  at: string,
  toEffect: (v: V) => E,
): MarkerState<E> {
  if (value === null) return state; // payload illisible → on n'invente rien
  if (state.at !== null && at <= state.at) return state; // plus ancien
  return { effect: toEffect(value), at };
}

/** Intègre une entrée `candidate_interview_marked` (ordre d'itération libre). */
export function foldInterviewMark(
  state: MarkerState<InterviewMarkEffect>,
  payload: Record<string, unknown> | null | undefined,
  at: string,
): MarkerState<InterviewMarkEffect> {
  return fold(state, readInterviewMark(payload), at, interviewMarkEffect);
}

/** Intègre une entrée `candidate_validation_marked` (ordre d'itération libre). */
export function foldValidationMark(
  state: MarkerState<ValidationMarkEffect>,
  payload: Record<string, unknown> | null | undefined,
  at: string,
): MarkerState<ValidationMarkEffect> {
  return fold(state, readValidationMark(payload), at, validationMarkEffect);
}

// ─── Écriture (le MÊME payload pour l'action normale et pour la correction) ─

export type JournalMarkerEntry = {
  action: string;
  campaignId: string | null;
  payload: Record<string, unknown>;
};

export function buildInterviewMarkerEntry(args: {
  uid: string;
  candidateName: string;
  campaignId: string | null;
  value: InterviewMarkValue;
  /** Posé par le flux de correction (trace, jamais un chemin d'écriture à part). */
  corrected?: boolean;
}): JournalMarkerEntry {
  return {
    action: INTERVIEW_MARKER_ACTION,
    campaignId: args.campaignId,
    payload: {
      uid: args.uid,
      candidate: args.candidateName,
      status: args.value,
      ...(args.corrected ? { corrected: true } : {}),
    },
  };
}

export function buildValidationMarkerEntry(args: {
  uid: string;
  candidateName: string;
  campaignId: string | null;
  value: ValidationMarkValue;
  corrected?: boolean;
}): JournalMarkerEntry {
  return {
    action: VALIDATION_MARKER_ACTION,
    campaignId: args.campaignId,
    payload: {
      uid: args.uid,
      candidate: args.candidateName,
      status: args.value,
      ...(args.corrected ? { corrected: true } : {}),
    },
  };
}

// ─── Présentation (fil d'activité, dialog, frise) ──────────────────────────

export type MarkDescription = {
  /** Libellé de l'ÉTAT posé (« Entretien réalisé »). */
  label: string;
  tone: 'positive' | 'negative' | 'neutral';
};

export function describeInterviewMark(
  value: InterviewMarkValue,
): MarkDescription {
  switch (value) {
    case 'realized':
      return { label: 'Entretien réalisé', tone: 'positive' };
    case 'missed':
      return { label: 'Entretien non réalisé', tone: 'negative' };
    case 'cleared':
      return { label: 'Marquage d’entretien annulé', tone: 'neutral' };
    default:
      return assertNever(value);
  }
}

export function describeValidationMark(
  value: ValidationMarkValue,
): MarkDescription {
  switch (value) {
    case 'validated':
      return { label: 'Retenu — GO définitif', tone: 'positive' };
    case 'rejected':
      return { label: 'Non retenu', tone: 'negative' };
    case 'cleared':
      return { label: 'Verdict final annulé', tone: 'neutral' };
    default:
      return assertNever(value);
  }
}
