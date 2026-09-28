/**
 * Issue d'une clôture telle que Pilotage l'affiche — « Recrutement conclu »,
 * avec le nom du recruté s'il est (toujours) désigné (feat/feedback-candidat,
 * lot 5).
 *
 * Source : la DERNIÈRE entrée `campaign_closed` de chaque campagne, et la
 * désignation COURANTE (marqueur `candidate_hired_marked` plié) — une
 * désignation annulée ne nomme plus personne. Une campagne clôturée avant le
 * chantier n'a pas d'entrée : `null`, l'écran garde son libellé historique.
 */

import {
  emptyHiredState,
  foldHiredMark,
  HIRED_MARKER_ACTION,
} from '@/lib/candidatures/decision-markers';

import { CAMPAIGN_CLOSED_ACTION } from './closure-constants';

export type ClosureOutcomeView = { outcome: 'conclu' | 'non_conclu'; hiredName: string | null };

type Entry = { action: string; campaignId: string | null; payload: Record<string, unknown>; createdAt: string };

/** PUR. `analyses` : id → { uid, nom } des candidatures des campagnes lues. */
export function closureOutcomes(
  entries: readonly Entry[],
  analyses: ReadonlyMap<string, { uid: string; candidateName: string }>,
): Map<string, ClosureOutcomeView> {
  const latest = new Map<string, Entry>();
  const hired = new Map<string, ReturnType<typeof emptyHiredState>>();
  for (const e of entries) {
    if (e.action === CAMPAIGN_CLOSED_ACTION && e.campaignId) {
      const prev = latest.get(e.campaignId);
      if (!prev || prev.createdAt < e.createdAt) latest.set(e.campaignId, e);
    } else if (e.action === HIRED_MARKER_ACTION && typeof e.payload.uid === 'string') {
      const uid = e.payload.uid;
      hired.set(uid, foldHiredMark(hired.get(uid) ?? emptyHiredState(), e.payload, e.createdAt));
    }
  }
  const out = new Map<string, ClosureOutcomeView>();
  for (const [campaignId, e] of latest) {
    const outcome = e.payload.outcome === 'conclu' ? 'conclu' : 'non_conclu';
    const id = typeof e.payload.hiredAnalysisId === 'string' ? e.payload.hiredAnalysisId : null;
    const a = id ? analyses.get(id) : undefined;
    const current = a ? hired.get(a.uid)?.effect === 'hired' : false;
    out.set(campaignId, { outcome, hiredName: a && current ? a.candidateName : null });
  }
  return out;
}

/** Libellé de l'issue — Pilotage (liste et détail). */
export function closureOutcomeLabel(view: ClosureOutcomeView): string {
  if (view.outcome === 'non_conclu') return 'Clôturée sans recrutement';
  return view.hiredName ? `Recrutement conclu — ${view.hiredName}` : 'Recrutement conclu';
}
