'use client';

/**
 * Applique le régime de réservation choisi À LA CRÉATION d'une campagne.
 *
 * Pourquoi une étape séparée du reste de la création : le flag
 * `scheduling_native` et le lieu de campagne ne voyagent PAS dans le snapshot
 * (`CampaignSnapshot` l'interdit à la compilation, et le lieu vit sur la cible
 * de réservation, pas sur la ligne campagne). Le PATCH ciblé est le SEUL
 * chemin d'écriture des deux — la création le déclenche donc juste après avoir
 * obtenu la confirmation d'enregistrement.
 *
 * Conséquence tenue à l'écran : l'échec de ce PATCH n'annule PAS la campagne
 * (elle est enregistrée, et c'est vrai), mais il ne se tait pas non plus —
 * sinon le DRH croirait sa campagne en réservation native alors qu'elle
 * enverrait des liens Cal.com.
 */

import type { MeetingLocation } from '@/lib/scheduling';

export type SchedulingDraft = {
  native: boolean;
  /** Surcharge de lieu propre à la campagne (`null` = hériter du référent). */
  location: MeetingLocation | null;
};

export type SchedulingPatchBody = {
  schedulingNative: boolean;
  meetingLocationOverride?: MeetingLocation;
};

/**
 * Corps du PATCH à envoyer, ou `null` s'il n'y a rien à appliquer.
 *
 * `appliedNative` = ce que le serveur porte DÉJÀ (faux sur une campagne
 * neuve). Il fait la différence entre deux « non » qui ne se ressemblent pas :
 *   - régime Cal.com sur une campagne neuve ⇒ RIEN à écrire, c'est le défaut
 *     en base, et une écriture inutile ne peut qu'échouer inutilement ;
 *   - régime Cal.com après avoir déjà basculé en natif (le DRH est revenu sur
 *     l'écran d'édition puis a re-créé) ⇒ il FAUT défaire, sinon la campagne
 *     resterait en natif alors que l'écran annonce Cal.com.
 *
 * Le lieu, lui, n'existe que sous réservation native (le serveur répond 409
 * `not_native` sinon) : on ne le joint jamais à un régime historique.
 * Pur — testé.
 */
export function buildSchedulingPatch(
  draft: SchedulingDraft,
  appliedNative = false,
): SchedulingPatchBody | null {
  if (!draft.native) {
    return appliedNative ? { schedulingNative: false } : null;
  }
  return draft.location
    ? { schedulingNative: true, meetingLocationOverride: draft.location }
    : { schedulingNative: true };
}

export type SchedulingApplyOutcome =
  | { kind: 'nothing_to_do' }
  | { kind: 'applied'; native: boolean; locationSaved: boolean | null }
  | { kind: 'failed'; message: string };

export async function applyDraftScheduling(
  campaignId: string,
  draft: SchedulingDraft,
  appliedNative = false,
): Promise<SchedulingApplyOutcome> {
  const body = buildSchedulingPatch(draft, appliedNative);
  if (!body) return { kind: 'nothing_to_do' };
  try {
    const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      message?: string;
      meetingLocationSaved?: boolean | null;
    };
    // 503 = Supabase non configuré : démo volatile assumée, comme pour la
    // création elle-même. Rien à enregistrer nulle part — pas un échec.
    if (res.status === 503) return { kind: 'nothing_to_do' };
    if (!res.ok) {
      return {
        kind: 'failed',
        message:
          data.message ??
          (body.schedulingNative
            ? 'La réservation native n’a pas pu être activée sur cette campagne.'
            : 'Le retour au lien d’agenda configuré n’a pas pu être enregistré.'),
      };
    }
    // On ne se fie pas au seul code HTTP : le serveur DIT si le lieu a été
    // écrit. Un 200 sur un lieu non enregistré serait le pire des deux mondes.
    if (
      body.meetingLocationOverride !== undefined &&
      data.meetingLocationSaved !== true
    ) {
      return {
        kind: 'failed',
        message:
          'La réservation native est activée, mais le lieu de la campagne n’a pas pu être enregistré — reprenez-le dans le bloc « Réservation d’entretien ».',
      };
    }
    return {
      kind: 'applied',
      native: body.schedulingNative,
      locationSaved: data.meetingLocationSaved ?? null,
    };
  } catch {
    return {
      kind: 'failed',
      message:
        'Erreur réseau — la campagne est enregistrée, mais la réservation native n’a pas été appliquée.',
    };
  }
}
