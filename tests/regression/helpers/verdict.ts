/**
 * Verdict final par la route RÉELLE — la seule qui le pose
 * (docs/specs/compte-rendu-entretien.md §4.2, §16).
 * `/api/journal` refuse désormais `candidate_validation_marked` : les séries
 * qui posaient ce marqueur « à la main » passent par ici.
 */
import { POST as postVerdictRoute } from '@/app/api/candidatures/[id]/verdict/route';

import { callWithId, type ApiResult } from './api';
import { readRows } from './db';

/** Un motif neutre, sans nom — le commentaire est facultatif (§16). */
export const REGRESSION_VERDICT_COMMENT =
  'Entretien concluant sur la recette et le pilotage, attentes du poste confirmées, réserve sur la disponibilité à préciser.';

/** Identifiant d'analyse d'un `uid` (une seule analyse attendue). */
export async function analysisIdOf(uid: string): Promise<string> {
  const rows = await readRows<{ id: string }>('candidate_analyses', { uid });
  if (rows.length !== 1) throw new Error(`analysisIdOf(${uid}) : ${rows.length} analyses`);
  return rows[0]!.id;
}

export async function postVerdict(
  uid: string,
  status: 'validated' | 'rejected',
  comment: string = REGRESSION_VERDICT_COMMENT,
): Promise<ApiResult> {
  return callWithId(postVerdictRoute, await analysisIdOf(uid), {
    method: 'POST',
    body: { status, comment },
  });
}
