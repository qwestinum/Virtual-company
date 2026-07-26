/**
 * Signaux MÉTIER (notifications in-app) — REGISTRE extensible.
 *
 * Un signal = une définition `{ key, compute }` où `compute()` retourne un
 * `BusinessSignal` prêt à afficher (message + CTA + cible) ou `null` si rien à
 * signaler. Ajouter un signal v2 (RDV non réservés, campagne sans candidature
 * récente…) = ajouter UNE entrée à `BUSINESS_SIGNALS` — ni la route ni les
 * composants ne changent.
 *
 * Règles :
 *   - comptages EXHAUSTIFS depuis les tables (jamais le journal tronqué) ;
 *   - requêtes légères (counts + le plus ancien) ;
 *   - le signal 2 est défini PAR `deriveCandidateStage` (via `stageFor`) : il
 *     s'éteint par construction dès que la décision est prise — aucune logique
 *     de stage parallèle.
 */
import { chunk } from '@/lib/db/paginate';
import { listAllCandidateAnalyses } from '@/lib/db/repos/candidate-analyses';
import {
  countOverduePendingValidations,
  oldestPendingValidationCreatedAt,
} from '@/lib/db/repos/pending-validations';
import { BUSINESS_NOTIFICATION_THRESHOLDS } from '@/lib/notifications/config';
import { loadStageSignals, stageFor, type StageSignals } from '@/lib/reporting/stage-signals';
import type { BusinessSignal } from '@/types/notifications';

// ─── Helpers PURS (testés) ─────────────────────────────────────────────────

/** Jours ENTIERS écoulés depuis `iso` (plancher, jamais négatif). */
export function daysSinceIso(iso: string, nowMs: number): number {
  const elapsed = nowMs - Date.parse(iso);
  return Math.max(0, Math.floor(elapsed / 86_400_000));
}

/** ISO du seuil « plus vieux que N jours ». */
export function cutoffIso(nowMs: number, days: number): string {
  return new Date(nowMs - days * 86_400_000).toISOString();
}

export function buildPendingValidationsMessage(
  count: number,
  thresholdDays: number,
  oldestDays: number,
): string {
  const head =
    count === 1
      ? `1 candidat attend votre validation depuis plus de ${thresholdDays} jours`
      : `${count} candidats attendent votre validation depuis plus de ${thresholdDays} jours`;
  return `${head} — le plus ancien depuis ${oldestDays} jour${oldestDays > 1 ? 's' : ''}.`;
}

export function buildInterviewsAwaitingMessage(count: number): string {
  return count === 1
    ? '1 candidat a passé son entretien et attend votre décision.'
    : `${count} candidats ont passé leur entretien et attendent votre décision.`;
}

/**
 * uids dont le marqueur entretien retenu est `realized` ET posé avant le
 * cutoff. Pur : la sélection est testable sans base.
 */
export function selectOverdueRealizedUids(
  interviewMarks: ReadonlyMap<string, 'realized' | 'missed'>,
  interviewMarkedAt: ReadonlyMap<string, string>,
  cutoffMs: number,
): string[] {
  const out: string[] = [];
  for (const [uid, mark] of interviewMarks) {
    if (mark !== 'realized') continue;
    const at = interviewMarkedAt.get(uid);
    if (at && Date.parse(at) < cutoffMs) out.push(uid);
  }
  return out;
}

// ─── Signal 1 — validations grises en attente depuis trop longtemps ────────

async function computePendingValidationsOverdue(
  nowMs: number,
): Promise<BusinessSignal | null> {
  const days = BUSINESS_NOTIFICATION_THRESHOLDS.pendingValidationAgeDays;
  const count = await countOverduePendingValidations(cutoffIso(nowMs, days));
  if (count === 0) return null;
  const oldest = await oldestPendingValidationCreatedAt();
  const oldestDays = oldest ? daysSinceIso(oldest, nowMs) : days;
  return {
    key: 'pending_validations_overdue',
    count,
    oldestDays,
    message: buildPendingValidationsMessage(count, days, oldestDays),
    ctaLabel: 'Ouvrir la validation suspendue',
    target: { tab: 'validations' },
  };
}

// ─── Signal 2 — entretiens réalisés sans décision finale ───────────────────

async function computeInterviewsAwaitingDecision(
  nowMs: number,
  preloaded?: StageSignals,
): Promise<BusinessSignal | null> {
  const days = BUSINESS_NOTIFICATION_THRESHOLDS.interviewDecisionAgeDays;
  const signals = preloaded ?? (await loadStageSignals());
  const candidateUids = selectOverdueRealizedUids(
    signals.interviewMarks,
    signals.interviewMarkedAt,
    nowMs - days * 86_400_000,
  );
  if (candidateUids.length === 0) return null;

  // Analyses chargées UNIQUEMENT pour ces uids (bas volume), stage dérivé par
  // le helper CANONIQUE — décision posée ⇒ stage retenu/non_retenu ⇒ sorti.
  const awaiting: { uid: string; markedAt: string }[] = [];
  for (const part of chunk(candidateUids, 300)) {
    const analyses = await listAllCandidateAnalyses({ uidIn: part });
    for (const analysis of analyses) {
      if (stageFor(analysis, signals) !== 'entretien_fait') continue;
      const markedAt = signals.interviewMarkedAt.get(analysis.uid);
      if (markedAt) awaiting.push({ uid: analysis.uid, markedAt });
    }
  }
  if (awaiting.length === 0) return null;

  const oldestMs = Math.min(...awaiting.map((a) => Date.parse(a.markedAt)));
  return {
    key: 'interviews_awaiting_decision',
    count: awaiting.length,
    oldestDays: daysSinceIso(new Date(oldestMs).toISOString(), nowMs),
    message: buildInterviewsAwaitingMessage(awaiting.length),
    ctaLabel: 'Voir les candidatures (Entretien fait)',
    target: { tab: 'candidatures', stage: 'entretien_fait' },
  };
}

// ─── Registre ──────────────────────────────────────────────────────────────

export type BusinessSignalDefinition = {
  key: BusinessSignal['key'];
  compute: (nowMs: number) => Promise<BusinessSignal | null>;
};

export const BUSINESS_SIGNALS: BusinessSignalDefinition[] = [
  { key: 'pending_validations_overdue', compute: computePendingValidationsOverdue },
  {
    key: 'interviews_awaiting_decision',
    compute: (nowMs) => computeInterviewsAwaitingDecision(nowMs),
  },
];

/**
 * Calcule tous les signaux actifs. Un signal qui ÉCHOUE est loggé et omis —
 * une panne d'un signal ne prive pas l'utilisateur des autres.
 */
export async function computeBusinessSignals(
  nowMs = Date.now(),
): Promise<BusinessSignal[]> {
  const results = await Promise.allSettled(
    BUSINESS_SIGNALS.map((def) => def.compute(nowMs)),
  );
  const signals: BusinessSignal[] = [];
  results.forEach((res, i) => {
    if (res.status === 'fulfilled') {
      if (res.value) signals.push(res.value);
    } else {
      console.error(
        `[notifications] signal ${BUSINESS_SIGNALS[i]!.key} en échec`,
        res.reason,
      );
    }
  });
  return signals;
}
