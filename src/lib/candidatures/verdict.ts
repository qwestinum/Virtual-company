/**
 * Verdict final MOTIVÉ — cœur SERVEUR. Spec : docs/specs/compte-rendu-entretien.md
 * §4.2 et §14.
 *
 * C'est le SEUL chemin qui pose un verdict final (GO définitif / non retenu)
 * après un entretien. `/api/journal` refuse l'action
 * `candidate_validation_marked` : le verdict et le commentaire qui le motive
 * s'écrivent ENSEMBLE, par un seul chemin, sur tous les écrans.
 *
 * Le commentaire est FACULTATIF (arbitrage du 19/09/2026 — l'obligation
 * pouvait susciter des objections). Vide ⇒ aucune ligne de commentaire, et un
 * marqueur sans `commentId` : les lecteurs disent « aucun commentaire », ils
 * n'inventent rien.
 *
 * Invariants, dans l'ordre où ils sont vérifiés :
 *   1. (retiré le 19/09 — le commentaire n'est plus exigé)
 *   2. **Seulement en attente de verdict.** L'étape est RELUE ici
 *      (`stageFor`), jamais crue du client : un verdict déjà posé ailleurs, un
 *      entretien dé-pointé rendent 409 et l'écran recharge. C'est aussi ce qui
 *      laisse l'historique en paix : la règle porte sur l'ACTE de décider, un
 *      dossier déjà décidé n'est jamais re-bloqué (« Corriger la décision »
 *      garde son propre chemin).
 *   3. **Aucun envoi.** Un verdict final ne notifie personne aujourd'hui ; ce
 *      module n'importe aucun émetteur.
 *   4. **Writer canonique.** Le marqueur est bâti par `decision-markers`, avec
 *      l'IDENTIFIANT du commentaire — jamais son texte, qui ne va pas au
 *      journal (pseudonymisé à la purge, pas supprimé).
 *
 * Ordre d'écriture : le commentaire, PUIS le marqueur. Si le marqueur échoue,
 * le commentaire reste orphelin : aucun marqueur ne le désigne, et il n'est
 * montré que comme « dernier commentaire écrit » d'un dossier TOUJOURS en
 * attente de verdict — ce qui est vrai. Une transaction contournerait le
 * writer du journal ; on préfère un orphelin inoffensif.
 */

import {
  buildValidationMarkerEntry,
  emptyValidationDecisionState,
  foldValidationDecision,
  VALIDATION_MARKER_ACTION,
  type ValidationDecisionState,
} from '@/lib/candidatures/decision-markers';
import {
  resolveFinalDecisionView,
  type FinalDecisionView,
} from '@/lib/candidatures/final-decision';
import {
  appendJournalEntry,
  listJournalEntriesByActions,
  type JournalEntry,
} from '@/lib/db/repos/journal';
import {
  insertVerdictComment,
  listVerdictCommentsByAnalyses,
} from '@/lib/db/repos/verdict-comments';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type { CandidateStage } from '@/lib/reporting/candidate-stage';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';
import type { FinalVerdict } from '@/types/verdict-comment';

/** Étape où un verdict final se pose. */
export const VERDICT_STAGE: CandidateStage = 'entretien_fait';

export type VerdictOutcome =
  | {
      status: 'decided';
      verdict: FinalVerdict;
      /** `null` : verdict posé sans commentaire (facultatif). */
      commentId: string | null;
      nextStage: CandidateStage;
    }
  | { status: 'not_awaiting_verdict'; stage: CandidateStage };

export async function postFinalVerdict(args: {
  analysis: CandidateAnalysisSummary;
  verdict: FinalVerdict;
  /** Facultatif : absent ou vide ⇒ verdict sans commentaire. */
  comment?: string | null;
  actor: HumanDecider | null;
}): Promise<VerdictOutcome> {
  const { analysis, verdict, actor } = args;
  const body = (args.comment ?? '').trim();

  // 2. L'étape, relue.
  const perimeter = analysis.campaignId ? { campaignId: analysis.campaignId } : {};
  const stage = stageFor(analysis, await loadStageSignals(perimeter));
  if (stage !== VERDICT_STAGE) return { status: 'not_awaiting_verdict', stage };

  // 3. Le commentaire s'il y en a un, puis le marqueur qui le désigne.
  const comment =
    body === ''
      ? null
      : await insertVerdictComment({
          analysisId: analysis.id,
          uid: analysis.uid,
          campaignId: analysis.campaignId,
          verdict,
          body,
          authorUserId: actor?.userId ?? null,
          authorEmail: actor?.email ?? null,
        });
  const marker = buildValidationMarkerEntry({
    uid: analysis.uid,
    candidateName: analysis.candidateName,
    campaignId: analysis.campaignId,
    value: verdict,
    ...(comment ? { commentId: comment.id } : {}),
  });
  await appendJournalEntry({
    ...marker,
    actor: 'user',
    // Identité de la SESSION serveur, jamais un champ du client — la même
    // capture que `/api/journal` faisait pour ce marqueur.
    payload: {
      ...marker.payload,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  });

  const nextStage = stageFor(analysis, await loadStageSignals(perimeter));
  return { status: 'decided', verdict, commentId: comment?.id ?? null, nextStage };
}

// ─── Lecture ───────────────────────────────────────────────────────────────

/** Plie les marqueurs de verdict d'UNE candidature (ordre d'itération libre). */
export function foldDecisionFor(uid: string, entries: JournalEntry[]): ValidationDecisionState {
  let state = emptyValidationDecisionState();
  for (const e of entries) {
    if (e.action !== VALIDATION_MARKER_ACTION) continue;
    if (e.payload.uid !== uid) continue;
    state = foldValidationDecision(state, e.payload, e.createdAt);
  }
  return state;
}

/** Plie en UNE passe les marqueurs de verdict de toutes les candidatures. */
export function foldDecisionsByUid(entries: JournalEntry[]): Map<string, ValidationDecisionState> {
  const out = new Map<string, ValidationDecisionState>();
  for (const e of entries) {
    if (e.action !== VALIDATION_MARKER_ACTION) continue;
    const uid = e.payload.uid;
    if (typeof uid !== 'string') continue;
    out.set(uid, foldValidationDecision(out.get(uid) ?? emptyValidationDecisionState(), e.payload, e.createdAt));
  }
  return out;
}

/**
 * Verdict courant et commentaire d'une candidature, pour le PDF d'audit et le
 * dialog de correction. `null` : aucun verdict final courant.
 */
export async function loadFinalDecision(
  analysis: Pick<CandidateAnalysisSummary, 'id' | 'uid' | 'campaignId'>,
  preloaded: { journal?: Promise<JournalEntry[]> } = {},
): Promise<FinalDecisionView | null> {
  const [entries, comments] = await Promise.all([
    preloaded.journal ??
      listJournalEntriesByActions([VALIDATION_MARKER_ACTION], {
        campaignId: analysis.campaignId ?? undefined,
      }),
    listVerdictCommentsByAnalyses([analysis.id]),
  ]);
  return resolveFinalDecisionView(foldDecisionFor(analysis.uid, entries), comments);
}
