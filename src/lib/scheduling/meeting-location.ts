/**
 * Lieu de rencontre — PUR, et surtout : RÉSOLVEUR UNIQUE.
 *
 * Tout ce qui a besoin de savoir « où a lieu ce rendez-vous » passe par
 * `resolveMeetingLocation`. C'est délibéré : c'est LA couture prévue pour la
 * V2 (génération d'un lien visio unique par RDV via API Meet/Graph). Le jour
 * où elle arrive, un seul point du module change — rien d'autre.
 *
 * Le lieu reste OPAQUE : aucun traitement par fournisseur, aucune inspection
 * d'URL, aucune supposition sur la forme d'un lien Meet, Teams ou Zoom.
 */
import type { MeetingLocation } from './types';

const TYPES = ['video', 'in_person', 'phone'] as const;

/**
 * Résolution : la surcharge de la cible l'emporte sur le défaut de la
 * ressource. Le résultat est ensuite FIGÉ sur la réservation (un changement
 * ultérieur de lieu ne déplace jamais un rendez-vous déjà pris).
 */
export function resolveMeetingLocation(params: {
  resourceDefault: MeetingLocation | null;
  targetOverride: MeetingLocation | null;
}): MeetingLocation | null {
  return params.targetOverride ?? params.resourceDefault ?? null;
}

/** Garde de forme sur une valeur venue de la base ou d'un appelant non typé. */
export function parseMeetingLocation(value: unknown): MeetingLocation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { type?: unknown; payload?: unknown };
  if (typeof candidate.type !== 'string') return null;
  if (!TYPES.includes(candidate.type as (typeof TYPES)[number])) return null;
  const payload = candidate.payload;
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  if (candidate.type === 'video') {
    return typeof record.url === 'string' && record.url.trim()
      ? { type: 'video', payload: { url: record.url.trim() } }
      : null;
  }
  if (candidate.type === 'in_person') {
    return typeof record.address === 'string' && record.address.trim()
      ? { type: 'in_person', payload: { address: record.address.trim() } }
      : null;
  }
  return typeof record.instructions === 'string' && record.instructions.trim()
    ? { type: 'phone', payload: { instructions: record.instructions.trim() } }
    : null;
}

/**
 * Rendu texte d'une ligne « lieu ». Neutre et sans mise en forme : les
 * gabarits (mail, .ics) décident de la présentation, le module fournit le fait.
 */
export function describeMeetingLocation(
  location: MeetingLocation | null,
): string | null {
  if (!location) return null;
  if (location.type === 'video') return location.payload.url;
  if (location.type === 'in_person') return location.payload.address;
  return location.payload.instructions;
}
