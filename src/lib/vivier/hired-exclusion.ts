/**
 * Un candidat RECRUTÉ n'est plus proposé par le vivier pendant une durée
 * réglable (`vivierConfig.hiredCooldownMonths`, défaut 12 mois —
 * feat/feedback-candidat, lot 5). Il vient d'être embauché : le solliciter
 * pour un autre poste serait déplacé, et c'est au client qu'il a été présenté.
 *
 * Source : le marqueur `candidate_hired_marked` (désignation HUMAINE à la
 * clôture), plié dernier-gagne — une désignation annulée (gomme) n'exclut
 * personne. La fenêtre court depuis la DATE DE DÉSIGNATION.
 *
 * ⚠️ Un « retenu non recruté » n'est PAS exclu : c'est un profil qualifié. Sa
 * mise en avant sur une campagne similaire est au backlog.
 */

import {
  emptyHiredState,
  foldHiredMark,
  HIRED_MARKER_ACTION,
  type HiredMarkEffect,
  type MarkerState,
} from '@/lib/candidatures/decision-markers';
import { listCandidateEmailsByUids } from '@/lib/db/repos/candidate-analyses';
import { listJournalEntriesByActions } from '@/lib/db/repos/journal';

type HiredEntry = { action: string; payload: Record<string, unknown>; createdAt: string };

/** Uids désignés recrutés, dont la désignation (toujours courante) date d'après `sinceIso`. PUR. */
export function hiredUidsSince(entries: readonly HiredEntry[], sinceIso: string): string[] {
  const states = new Map<string, MarkerState<HiredMarkEffect>>();
  for (const e of entries) {
    if (e.action !== HIRED_MARKER_ACTION) continue;
    const uid = e.payload.uid;
    if (typeof uid !== 'string') continue;
    states.set(uid, foldHiredMark(states.get(uid) ?? emptyHiredState(), e.payload, e.createdAt));
  }
  return [...states]
    .filter(([, s]) => s.effect === 'hired' && s.at !== null && s.at >= sinceIso)
    .map(([uid]) => uid);
}

/** Adresses à exclure de la présélection (toutes campagnes confondues). */
export async function listHiredEmailsSince(sinceIso: string): Promise<string[]> {
  const entries = await listJournalEntriesByActions([HIRED_MARKER_ACTION]);
  return listCandidateEmailsByUids(hiredUidsSince(entries, sinceIso));
}
