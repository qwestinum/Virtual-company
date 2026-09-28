/**
 * Clôture INCOMPLÈTE — règle PURE et testée (feat/feedback-candidat, lot 4).
 *
 * La route de clôture pose, dans l'ordre : la clôture, le marqueur du
 * recruté, le verdict de chaque non-sélectionné, puis `campaign_closed`. Tant
 * que ces écritures ne sont pas dans une transaction unique (backlog), une
 * panne entre deux d'entre elles laisse une campagne dont `campaign_closed`
 * ANNONCE un recruté ou des non-sélectionnés sans que leurs marqueurs
 * existent. Ce module le détecte.
 *
 * On cherche l'ABSENCE de marqueur, jamais son effet courant : « Annuler la
 * désignation » pose légitimement une gomme ; le marqueur d'origine existe,
 * la clôture n'est pas incomplète. Et le doute ne conclut jamais : une
 * candidature introuvable (purgée) n'est pas comptée.
 */

import {
  HIRED_MARKER_ACTION,
  VALIDATION_MARKER_ACTION,
} from '@/lib/candidatures/decision-markers';

import { NOT_SELECTED_CAUSE } from './closure-constants';

export type ClosureEntry = {
  campaignId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type MarkerEntry = {
  action: string;
  campaignId: string | null;
  payload: Record<string, unknown>;
};

export type IncompleteClosure = {
  campaignId: string;
  /** Le recruté annoncé n'a pas de marqueur de désignation. */
  missingHire: boolean;
  /** Identifiants d'analyse des non-sélectionnés sans leur verdict de clôture. */
  missingNotSelected: string[];
};

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * `closures` : entrées `campaign_closed` ; seule la PLUS RÉCENTE de chaque
 * campagne compte (une campagne rouverte puis reclôturée). `uidOf` : analyse →
 * uid (`null` = introuvable). `markers` : entrées de marqueurs des campagnes.
 */
export function findIncompleteClosures(
  closures: readonly ClosureEntry[],
  uidOf: (analysisId: string) => string | null,
  markers: readonly MarkerEntry[],
): IncompleteClosure[] {
  const latest = new Map<string, ClosureEntry>();
  for (const c of closures) {
    if (!c.campaignId) continue;
    const prev = latest.get(c.campaignId);
    if (!prev || prev.createdAt < c.createdAt) latest.set(c.campaignId, c);
  }

  const out: IncompleteClosure[] = [];
  for (const [campaignId, closure] of latest) {
    const own = markers.filter((m) => m.campaignId === campaignId);
    const hiredId = typeof closure.payload.hiredAnalysisId === 'string' ? closure.payload.hiredAnalysisId : null;

    let missingHire = false;
    if (hiredId) {
      const uid = uidOf(hiredId);
      missingHire =
        uid !== null && !own.some((m) => m.action === HIRED_MARKER_ACTION && m.payload.uid === uid);
    }

    const missingNotSelected = stringArray(closure.payload.notSelectedAnalysisIds).filter((id) => {
      const uid = uidOf(id);
      if (uid === null) return false;
      return !own.some(
        (m) =>
          m.action === VALIDATION_MARKER_ACTION &&
          m.payload.uid === uid &&
          m.payload.cause === NOT_SELECTED_CAUSE,
      );
    });

    if (missingHire || missingNotSelected.length > 0) {
      out.push({ campaignId, missingHire, missingNotSelected });
    }
  }
  return out;
}
