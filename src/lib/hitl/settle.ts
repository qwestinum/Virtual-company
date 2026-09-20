/**
 * ÉCRIVAIN UNIQUE de la CLÔTURE d'une fiche de validation — le pendant de
 * `enqueueValidationRow`, qui n'en avait pas.
 *
 * C'est cette asymétrie qui a produit le défaut de production du 21/08 : la
 * création avait un écrivain unique, la clôture n'en avait aucun. Le
 * re-scoring faisait donc sortir un dossier de la zone d'attente **sans
 * fermer sa fiche** — laquelle continuait d'offrir un arbitrage, direction
 * `reject`, sur une analyse devenue `auto_accept`. Cf.
 * `docs/ops/plan-coherence-file-analyse-2026-09-20.md`.
 *
 * ⚠️ N'ENVOIE RIEN et ne DÉCIDE RIEN. Clore n'est pas refuser : la fiche passe
 * `void` — « fermée, jamais tranchée, jamais envoyée » — et le verdict de
 * screening, la zone et `decided_by` de l'analyse restent INTACTS. Le
 * classement sans suite garde son propre chemin (`dismissal.ts`), qui ferme
 * déjà sa fiche et porte ses propres claims.
 *
 * ⚠️ On ne clôt JAMAIS sous incertitude : un `sending` (envoi peut-être en
 * vol) interrompt tout, et un doute sur l'état du dossier — analyse
 * introuvable, zone absente — laisse la fiche telle quelle.
 */
import { getCandidateAnalysis, listCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import {
  listOpenValidationsForUid,
  voidPendingValidation,
} from '@/lib/db/repos/pending-validations';
import {
  checkValidationCoherence,
  type AnalysisFacts,
  type SettledReason,
} from '@/lib/hitl/queue-coherence';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export type SettleOutcome =
  | { kind: 'settled'; validationIds: string[]; reason: SettledReason }
  /** Aucune fiche ouverte : le cas NORMAL, pas un échec. */
  | { kind: 'nothing_open' }
  /** Le dossier attend bien une décision — on ne retire pas un arbitrage. */
  | { kind: 'still_awaiting' }
  /** Analyse introuvable ou zone absente : on ne conclut pas sur un doute. */
  | { kind: 'unknown' }
  /** Un envoi est peut-être en vol : on diffère, on ne ferme pas. */
  | { kind: 'send_in_flight' }
  | { kind: 'analysis_not_found' };

export type SettleOptions = {
  /** Identité de l'humain à l'origine du geste, `null` pour un chemin système. */
  actor: { userId: string; email: string | null } | null;
  /** Auteur écrit au journal quand aucun humain n'est nommé. */
  journalActor: string;
  /** Contexte libre joint au journal (ex. zones avant/après d'un re-scoring). */
  context?: Record<string, unknown>;
};

/**
 * Ferme toutes les fiches OUVERTES d'une analyse qui n'attend plus.
 *
 * Par l'`uid` et non par l'identifiant canonique : les fiches créées avant
 * l'identifiant déterministe portent un id aléatoire, et ce sont précisément
 * celles qu'on ne retrouverait pas autrement. Un dossier n'en a normalement
 * qu'une ; s'il en a plusieurs, elles décrivent le même fait et se ferment
 * ensemble.
 */
export async function settleValidationsForAnalysis(
  analysis: CandidateAnalysisSummary,
  opts: SettleOptions,
): Promise<SettleOutcome> {
  const facts: AnalysisFacts = {
    decisionZone: analysis.decisionZone,
    decidedBy: analysis.decidedBy,
    dismissedAt: analysis.dismissedAt,
  };
  const coherence = checkValidationCoherence(facts);
  if (coherence.kind === 'awaiting') return { kind: 'still_awaiting' };
  if (coherence.kind === 'unknown') return { kind: 'unknown' };

  const open = await listOpenValidationsForUid(analysis.uid);
  if (open.length === 0) return { kind: 'nothing_open' };
  // Un seul `sending` suffit à tout suspendre : fermer ses voisines pendant
  // qu'un mail part laisserait un état à moitié réglé, impossible à relire.
  if (open.some((v) => v.status === 'sending')) return { kind: 'send_in_flight' };

  const closed: string[] = [];
  for (const v of open) {
    const outcome = await voidPendingValidation(v.id);
    if (outcome !== 'voided') continue; // déjà close, ou engagée entre-temps
    closed.push(v.id);
    await appendJournalEntry({
      action: 'validation_settled',
      actor: opts.actor?.email ?? opts.journalActor,
      campaignId: v.campaignId,
      payload: {
        validationId: v.id,
        uid: analysis.uid,
        analysisId: analysis.id,
        candidate: analysis.candidateName,
        reason: coherence.reason,
        decisionZone: analysis.decisionZone,
        actorUserId: opts.actor?.userId ?? null,
        actorEmail: opts.actor?.email ?? null,
        ...(opts.context ?? {}),
      },
    }).catch(() => {});
  }
  if (closed.length === 0) return { kind: 'nothing_open' };
  return { kind: 'settled', validationIds: closed, reason: coherence.reason };
}

/** Même geste, depuis un identifiant d'analyse (scripts, routes). */
export async function settleValidationsForAnalysisId(
  analysisId: string,
  opts: SettleOptions,
): Promise<SettleOutcome> {
  const analysis = await getCandidateAnalysis(analysisId);
  if (analysis) return settleValidationsForAnalysis(analysis, opts);
  return { kind: 'analysis_not_found' };
}

/** Même geste, depuis l'`uid` d'un traitement (repli des fiches sans analyseId). */
export async function settleValidationsForUid(
  uid: string,
  opts: SettleOptions,
): Promise<SettleOutcome> {
  const [analysis] = await listCandidateAnalyses({ uidIn: [uid], limit: 1 });
  if (analysis) return settleValidationsForAnalysis(analysis, opts);
  return { kind: 'analysis_not_found' };
}
