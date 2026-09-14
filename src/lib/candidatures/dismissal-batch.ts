/**
 * Classement sans suite EN MASSE (clôture de campagne / GO final) — SERVEUR.
 *
 * Énumère les candidatures OUVERTES d'une campagne via le helper d'étape
 * CANONIQUE (`stageFor` — jamais une logique parallèle), puis applique le
 * protocole unitaire `dismissCandidature` avec une concurrence BORNÉE à
 * `DISMISSAL_CONCURRENCY` (chaque envoi reste sous claim : un mail, jamais
 * deux). Les gris en cours d'envoi (`sending`) sont SAUTÉS et signalés —
 * jamais classés sous incertitude.
 *
 * Au-delà de `DISMISSAL_SYNC_MAX` dossiers, la clôture répond tout de suite et
 * le lot COMPLET part sur le rail de drain (`runQueuedClosureDismissals`) :
 * même code, mêmes claims, même journal — seul le moment change.
 */

import { randomUUID } from 'node:crypto';

import { mapWithConcurrency } from '@/lib/async/concurrency';
import {
  createDismissalSharedContext,
  dismissCandidature,
} from '@/lib/candidatures/dismissal';
import {
  claimOutreach,
  confirmOutreachClaim,
  releaseOutreachClaim,
} from '@/lib/db/repos/imap-outreach-claims';
import {
  appendJournalEntry,
  listJournalEntriesByActions,
  listRecentJournalEntriesByActions,
} from '@/lib/db/repos/journal';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  emptyStageCounts,
  type CandidateStage,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type { DismissalReason } from '@/types/dismissal';
import type { HumanDecider } from '@/types/hitl';
import type { CandidateAnalysisSummary } from '@/types/reporting';

/** Étapes OUVERTES (classables sans suite). `retenu` est terminal (le
 * recruté) ; les terminaux négatifs et `sans_suite` le sont aussi. */
export const OPEN_STAGES: CandidateStage[] = [
  'a_valider',
  'invite',
  'rdv_pris',
  'entretien_fait',
];

export type OpenCandidature = {
  analysis: CandidateAnalysisSummary;
  stage: CandidateStage;
};

export type OpenCandidaturesRecap = {
  /** Compteurs par étape ouverte (les autres clés restent à 0). */
  counts: CandidateStageCounts;
  total: number;
  /** ≥1 candidat au stage `retenu` (GO posé) → motif « poste pourvu » proposé. */
  hasRetenu: boolean;
};

/** Candidatures ouvertes d'une campagne (analyse + étape dérivée). */
export async function listOpenCandidatures(
  campaignId: string,
): Promise<{ open: OpenCandidature[]; hasRetenu: boolean }> {
  const [analyses, signals] = await Promise.all([
    listAllCandidateAnalyses({ campaignId, dismissed: false }),
    loadStageSignals({ campaignId }),
  ]);
  const open: OpenCandidature[] = [];
  let hasRetenu = false;
  for (const analysis of analyses) {
    const stage = stageFor(analysis, signals);
    if (stage === 'retenu') hasRetenu = true;
    if (OPEN_STAGES.includes(stage)) open.push({ analysis, stage });
  }
  return { open, hasRetenu };
}

/** Récapitulatif pour le dialog de clôture (« X candidatures en cours : … »). */
export async function recapOpenCandidatures(
  campaignId: string,
): Promise<OpenCandidaturesRecap> {
  const { open, hasRetenu } = await listOpenCandidatures(campaignId);
  const counts = emptyStageCounts();
  for (const { stage } of open) counts[stage] += 1;
  return { counts, total: open.length, hasRetenu };
}

/** Dossiers traités en même temps (mails compris). */
export const DISMISSAL_CONCURRENCY = 5;
/** Au-delà, la clôture répond immédiatement et le lot part sur le rail. */
export const DISMISSAL_SYNC_MAX = 20;

export type BatchDismissalOptions = {
  reason: DismissalReason;
  sendMail: boolean;
  dismissedByUser: HumanDecider | null;
  actor: string;
};

export type BatchDismissalSummary = {
  dismissed: number;
  /** Gris en cours d'envoi — sautés (re-tenter après résolution). */
  deferredSending: number;
  alreadyDismissed: number;
  mailsSent: number;
  /** Mails demandés mais non partis (hors non-applicables) — requêtables au
   * journal (`candidature_dismissal_mail_not_sent`). */
  mailsFailed: number;
};

/**
 * Classe TOUTES les candidatures ouvertes d'une campagne. Chaque unité est
 * idempotente (rejouer une clôture ne double ni classement ni mail).
 */
export async function dismissOpenCandidatures(
  campaignId: string,
  opts: BatchDismissalOptions,
  preloaded?: { open: OpenCandidature[] },
): Promise<BatchDismissalSummary> {
  const { open } = preloaded ?? (await listOpenCandidatures(campaignId));
  const summary: BatchDismissalSummary = {
    dismissed: 0,
    deferredSending: 0,
    alreadyDismissed: 0,
    mailsSent: 0,
    mailsFailed: 0,
  };
  // Campagne, cible et faits du mail : lus une fois pour tout le lot.
  const shared = createDismissalSharedContext(campaignId);
  const results = await mapWithConcurrency(open, DISMISSAL_CONCURRENCY, ({ analysis }) =>
    dismissCandidature(
      analysis,
      {
        reason: opts.reason,
        sendMail: opts.sendMail,
        // Confirmation humaine du flux (récap + bouton) → 'user' + identité.
        dismissedBy: 'user',
        dismissedByUser: opts.dismissedByUser,
        actor: opts.actor,
      },
      shared,
    ),
  );
  for (const result of results) {
    if (result.status === 'dismissed') {
      summary.dismissed += 1;
      if (result.mailStatus === 'sent' || result.mailStatus === 'duplicate') {
        summary.mailsSent += 1;
      } else if (
        opts.sendMail &&
        result.mailStatus !== 'not_requested' &&
        result.mailStatus !== 'not_applicable' &&
        result.mailStatus !== 'skipped_no_email'
      ) {
        summary.mailsFailed += 1;
      }
    } else if (result.status === 'deferred_sending') {
      summary.deferredSending += 1;
    } else if (result.status === 'already_dismissed') {
      summary.alreadyDismissed += 1;
    }
  }
  return summary;
}

// ─── Clôture : synchrone ou sur le rail ────────────────────────────────────

const QUEUED_ACTION = 'campaign_closure_dismissals_queued';
const DONE_ACTION = 'campaign_closure_dismissals';
/** Pseudo-boîte des claims de lot — même table, même mécanique deux-phases. */
const BATCH_CLAIM_MAILBOX = 'campaign_closure_batch';

export type ClosureDismissalOutcome =
  | { kind: 'done'; summary: BatchDismissalSummary }
  | { kind: 'queued'; queueId: string; total: number };

/**
 * Point d'entrée de la clôture. Jusqu'à `DISMISSAL_SYNC_MAX` dossiers : le lot
 * est traité dans la requête et journalisé (`campaign_closure_dismissals`).
 * Au-delà : une entrée de journal met le lot EN FILE et la requête rend la
 * main ; le rail l'exécute au prochain passage.
 */
export async function closeWithDismissals(
  campaignId: string,
  opts: BatchDismissalOptions,
): Promise<ClosureDismissalOutcome> {
  const { open } = await listOpenCandidatures(campaignId);
  if (open.length > DISMISSAL_SYNC_MAX) {
    const queueId = randomUUID();
    await appendJournalEntry({
      action: QUEUED_ACTION,
      actor: opts.actor,
      campaignId,
      payload: { queueId, total: open.length, ...opts },
    });
    return { kind: 'queued', queueId, total: open.length };
  }
  const summary = await dismissOpenCandidatures(campaignId, opts, { open });
  await appendJournalEntry({
    action: DONE_ACTION,
    actor: opts.actor,
    campaignId,
    payload: { reason: opts.reason, ...summary },
  });
  return { kind: 'done', summary };
}

type QueuedBatch = { queueId: string; campaignId: string; opts: BatchDismissalOptions };

/** Lecture DÉFENSIVE d'une entrée de file (elle vient de la base). */
export function parseQueuedBatch(entry: {
  campaignId: string | null;
  payload: Record<string, unknown>;
}): QueuedBatch | null {
  const p = entry.payload;
  if (!entry.campaignId || typeof p.queueId !== 'string') return null;
  if (typeof p.reason !== 'string' || typeof p.sendMail !== 'boolean') return null;
  const user = p.dismissedByUser as { userId?: unknown; email?: unknown } | null | undefined;
  return {
    queueId: p.queueId,
    campaignId: entry.campaignId,
    opts: {
      reason: p.reason as DismissalReason,
      sendMail: p.sendMail,
      dismissedByUser:
        user && typeof user.userId === 'string'
          ? { userId: user.userId, email: typeof user.email === 'string' ? user.email : null }
          : null,
      actor: typeof p.actor === 'string' ? p.actor : 'user',
    },
  };
}

/** Files encore à exécuter : mises en file, sans entrée de fin portant leur id. */
export function pendingQueuedBatches(
  queued: readonly { campaignId: string | null; payload: Record<string, unknown> }[],
  done: readonly { payload: Record<string, unknown> }[],
): QueuedBatch[] {
  const finished = new Set(
    done.map((d) => d.payload.queueId).filter((id): id is string => typeof id === 'string'),
  );
  return queued
    .map(parseQueuedBatch)
    .filter((b): b is QueuedBatch => b !== null && !finished.has(b.queueId));
}

/**
 * RAIL : exécute les clôtures mises en file. Un lot est RÉSERVÉ par un claim
 * deux-phases avant de tourner — deux passages concurrents n'en exécutent
 * qu'un ; un passage tué laisse un claim non confirmé, repris après son délai.
 * Rejouer un lot est sans risque : chaque dossier est idempotent et chaque
 * mail est sous son propre claim. FAIL-SOFT : rien ici ne fait échouer le rail.
 */
export async function runQueuedClosureDismissals(maxBatches = 1): Promise<number> {
  let ran = 0;
  try {
    const queued = await listRecentJournalEntriesByActions([QUEUED_ACTION], 50);
    if (queued.length === 0) return 0;
    // Entrées de fin lues PAR CAMPAGNE en file (exhaustives, bas volume) :
    // une fenêtre globale finirait par ne plus voir la fin d'un vieux lot et
    // le rejouerait pour rien.
    const campaignIds = [
      ...new Set(queued.map((q) => q.campaignId).filter((id): id is string => id !== null)),
    ];
    const done = (
      await Promise.all(
        campaignIds.map((campaignId) => listJournalEntriesByActions([DONE_ACTION], { campaignId })),
      )
    ).flat();
    // Les plus anciennes d'abord : une clôture n'attend pas derrière une autre.
    const pending = pendingQueuedBatches([...queued].reverse(), done);
    for (const batch of pending) {
      if (ran >= maxBatches) break;
      const claimKey = { mailboxId: BATCH_CLAIM_MAILBOX, uid: batch.queueId, mode: 'dismiss' } as const;
      const verdict = await claimOutreach(claimKey);
      if (verdict !== 'won') continue;
      try {
        const summary = await dismissOpenCandidatures(batch.campaignId, batch.opts);
        await appendJournalEntry({
          action: DONE_ACTION,
          actor: batch.opts.actor,
          campaignId: batch.campaignId,
          payload: { reason: batch.opts.reason, ...summary, queueId: batch.queueId },
        });
        await confirmOutreachClaim(claimKey);
        ran += 1;
      } catch (err) {
        console.error('[closure-rail] lot en échec, repris au prochain passage', batch.queueId, err);
        await releaseOutreachClaim(claimKey);
      }
    }
  } catch (err) {
    console.error('[closure-rail] lecture de la file échouée', err);
  }
  return ran;
}
