/**
 * Orchestration client post-validation FDP (Session 4).
 *
 * Frontière : ce module pilote la séquence de dispatch des agents
 * exécutants (Job Writer puis CV Analyzer). Il agit côté client en
 * coordonnant trois stores (chat, fdp, agents, artifacts) sans toucher
 * au manager-store côté serveur. Les tours conversationnels du Manager
 * passent toujours par `runManagerTurn` via `/api/manager/chat`.
 *
 * Trois entrées publiques :
 *   - dispatchJobWriter(fdp)       — appelée à la validation FDP.
 *   - dispatchCVBatch(...)         — déclenchée par l'upload trombone
 *                                    en mode "Manuel" sous campagne.
 *   - dispatchIsolatedCVTask(...)  — upload hors campagne ; le Manager
 *                                    réclame une instruction libre.
 *
 * Erreurs : capturées et restituées comme messages Manager dans le
 * chat (mimétique humaine — pas de console rouge), avec un ton métier.
 */

import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
  suggestCVReportFileName,
} from '@/lib/agents/cv-report-render';
import { postCVAnalyzer, postJobWriter } from '@/lib/chat/api-client';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useChatStore } from '@/stores/chat-store';
import {
  DEFAULT_CV_THRESHOLD,
  type CVAnalysisCriteria,
  type CVAnalysisResult,
} from '@/types/cv-analysis';
import type { FDPInProgress } from '@/types/field-collection';

const JOB_WRITER_ID = 'agent.job-writer';
const CV_ANALYZER_ID = 'agent.cv-analyzer';

function nowTaskId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Étape 1 du moment 1 — la validation FDP enchaîne sur le Job Writer.
 * Marque l'agent occupé, appelle l'API, range l'annonce dans
 * artifacts-store, poste le bouton télécharger et le source-picker.
 */
export async function dispatchJobWriter(fdp: FDPInProgress): Promise<void> {
  const chat = useChatStore.getState();
  const agents = useAgentsStore.getState();
  const artifacts = useArtifactsStore.getState();
  const taskId = nowTaskId('job');

  const isTask = fdp.campaignId.startsWith('TASK-');
  const noun = isTask ? 'sollicitation' : 'campagne';

  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content: `Tout est en ordre — ${noun} ${fdp.campaignId} lancée. Je passe la main au Job Writer pour rédiger l'annonce, je reviens vers vous dès qu'elle est prête.`,
  });

  agents.setAgentStatus(JOB_WRITER_ID, 'active');
  agents.markAgentBusy(JOB_WRITER_ID, taskId);
  agents.pushEvent({
    agentId: JOB_WRITER_ID,
    type: 'task_started',
    payload: { taskId, fdpId: fdp.campaignId },
  });

  try {
    const result = await postJobWriter({ fdp, taskId });
    const artifact = artifacts.addArtifact({
      name: result.fileName,
      mime: 'text/markdown',
      content: result.markdown,
    });

    chat.appendMessage({
      role: 'manager',
      source: 'text',
      content: `Voici l'annonce — ${result.ad.title}. Vous pouvez la relire et la télécharger ; je reste preneur de vos retours avant publication.`,
      attachment: {
        artifactId: artifact.id,
        label: 'Annonce — Job Writer',
        fileName: result.fileName,
        mime: 'text/markdown',
      },
    });

    chat.appendMessage({
      role: 'manager',
      source: 'text',
      content:
        "Pour la suite, comment voulez-vous me transmettre les CV ? Choisissez une source ci-dessous.",
      block: { kind: 'source-picker', selected: null },
    });

    agents.pushEvent({
      agentId: JOB_WRITER_ID,
      type: 'task_completed',
      payload: { taskId, metrics: result.metrics },
    });
  } catch (err) {
    chat.appendMessage({
      role: 'manager',
      source: 'text',
      content: `Le Job Writer rencontre un souci pour rédiger l'annonce (${
        err instanceof Error ? err.message : 'erreur inconnue'
      }). Je relance dans un instant — vous pouvez aussi me redemander quand vous êtes prêt.`,
    });
    agents.pushEvent({
      agentId: JOB_WRITER_ID,
      type: 'task_failed',
      payload: { taskId, error: err instanceof Error ? err.message : String(err) },
    });
  } finally {
    agents.markAgentIdle(JOB_WRITER_ID);
    agents.setAgentStatus(JOB_WRITER_ID, 'idle');
  }
}

/**
 * Étape 2 — analyse séquentielle d'un lot de CV, en éditant une bulle
 * de progression et en finissant par un récap + rapport téléchargeable.
 */
export async function dispatchCVBatch(args: {
  files: File[];
  criteria: CVAnalysisCriteria;
  threshold?: number;
  campaignId: string | null;
}): Promise<void> {
  const { files, criteria } = args;
  if (files.length === 0) return;

  const threshold = args.threshold ?? DEFAULT_CV_THRESHOLD;
  const chat = useChatStore.getState();
  const agents = useAgentsStore.getState();
  const artifacts = useArtifactsStore.getState();

  agents.setAgentStatus(CV_ANALYZER_ID, 'active');
  const batchTaskId = nowTaskId('cvb');
  agents.markAgentBusy(CV_ANALYZER_ID, batchTaskId);
  agents.pushEvent({
    agentId: CV_ANALYZER_ID,
    type: 'task_started',
    payload: { taskId: batchTaskId, total: files.length },
  });

  const intro = chat.appendMessage({
    role: 'manager',
    source: 'text',
    content:
      files.length === 1
        ? "Je transmets le CV au CV Analyzer."
        : `Je transmets les ${files.length} CV au CV Analyzer.`,
  });
  void intro;

  const progress = chat.appendMessage({
    role: 'manager',
    source: 'text',
    content: `Analyse en cours : 0/${files.length} CV traités…`,
    block: { kind: 'cv-progress', processed: 0, total: files.length },
  });

  const results: CVAnalysisResult[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const itemTaskId = `${batchTaskId}_${i + 1}`;
    try {
      const res = await postCVAnalyzer({
        file,
        criteria,
        threshold,
        taskId: itemTaskId,
        campaignId: args.campaignId ?? undefined,
      });
      results.push(res.result);
    } catch (err) {
      // Un CV en erreur n'arrête pas le lot — on poste une note
      // discrète et on continue.
      chat.appendMessage({
        role: 'manager',
        source: 'text',
        content: `Le CV ${file.name} n'a pas pu être analysé (${
          err instanceof Error ? err.message : 'erreur inconnue'
        }). Je poursuis avec les autres.`,
      });
      agents.pushEvent({
        agentId: CV_ANALYZER_ID,
        type: 'task_failed',
        payload: {
          taskId: itemTaskId,
          fileName: file.name,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }

    const processed = i + 1;
    useChatStore.getState().updateMessage(progress.id, {
      content: `Analyse en cours : ${processed}/${files.length} CV traités…`,
      block: {
        kind: 'cv-progress',
        processed,
        total: files.length,
      },
    });
  }

  const summary = buildCVBatchSummary(results, threshold);
  const reportName = suggestCVReportFileName(args.campaignId);
  const reportArtifact = artifacts.addArtifact({
    name: reportName,
    mime: 'text/markdown',
    content: renderCVBatchMarkdown(summary, args.campaignId),
  });

  // On remplace la bulle de progression par le récap structuré.
  useChatStore.getState().updateMessage(progress.id, {
    content:
      summary.total === 0
        ? "Aucun CV n'a pu être analysé. Réessayez quand vous êtes prêt."
        : `Analyse terminée — ${summary.total} CV traités, ${summary.aboveThreshold} au-dessus du seuil (${threshold}%).`,
    block: { kind: 'cv-batch-summary', summary },
    attachment: {
      artifactId: reportArtifact.id,
      label: 'Rapport complet — CV Analyzer',
      fileName: reportName,
      mime: 'text/markdown',
    },
  });

  agents.pushEvent({
    agentId: CV_ANALYZER_ID,
    type: 'task_completed',
    payload: {
      taskId: batchTaskId,
      total: summary.total,
      aboveThreshold: summary.aboveThreshold,
    },
  });
  agents.markAgentIdle(CV_ANALYZER_ID);
  agents.setAgentStatus(CV_ANALYZER_ID, 'idle');
}

/**
 * Tâche isolée (hors campagne) — l'utilisateur a uploadé sans FDP
 * validée. Le Manager garde les fichiers en mémoire et demande au DRH
 * son instruction libre. Quand l'instruction arrive (via un tour
 * conversationnel suivant), `dispatchCVBatch` est appelée avec
 * criteria.freeText.
 */
export type PendingIsolatedCVTask = {
  taskId: string;
  files: File[];
};

let pendingIsolatedTask: PendingIsolatedCVTask | null = null;

export function getPendingIsolatedTask(): PendingIsolatedCVTask | null {
  return pendingIsolatedTask;
}

export function clearPendingIsolatedTask(): void {
  pendingIsolatedTask = null;
}

export function dispatchIsolatedCVTask(files: File[]): void {
  if (files.length === 0) return;
  const taskId = `TASK-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 999) + 1,
  ).padStart(3, '0')}`;

  pendingIsolatedTask = { taskId, files };

  const chat = useChatStore.getState();
  const fileLabel =
    files.length === 1
      ? `le CV ${files[0].name}`
      : `${files.length} CV (${files.map((f) => f.name).join(', ')})`;

  chat.appendMessage({
    role: 'user',
    source: 'text',
    content:
      files.length === 1
        ? `J'ai joint un CV : ${files[0].name}.`
        : `J'ai joint ${files.length} CV : ${files.map((f) => f.name).join(', ')}.`,
  });

  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content: `J'ai bien reçu ${fileLabel}. Pour cette sollicitation ${taskId}, sur quels critères dois-je analyser ces CV ? (intitulé visé, compétences clés, expérience minimale…)`,
  });
}

/**
 * Appelée par le ManagerChat quand une réponse libre arrive après
 * `dispatchIsolatedCVTask`. Lance le batch avec l'instruction libre
 * comme `criteria.freeText`. Retourne true si une tâche en attente
 * a bien été consommée.
 */
export async function consumePendingIsolatedTask(
  freeTextInstruction: string,
): Promise<boolean> {
  const pending = pendingIsolatedTask;
  if (!pending) return false;
  pendingIsolatedTask = null;

  await dispatchCVBatch({
    files: pending.files,
    criteria: { freeText: freeTextInstruction },
    threshold: DEFAULT_CV_THRESHOLD,
    campaignId: pending.taskId,
  });
  return true;
}
