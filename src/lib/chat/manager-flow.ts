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

import { fdpToCVCriteria } from '@/lib/agents/fdp-to-criteria';
import { useFdpStore } from '@/stores/fdp-store';
import { useTasksStore } from '@/stores/tasks-store';
import {
  buildCVBatchSummary,
  renderCVBatchMarkdown,
  suggestCVReportFileName,
} from '@/lib/agents/cv-report-render';
import { postCVAnalyzer, postJobWriter } from '@/lib/chat/api-client';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import {
  selectActiveCampaigns,
  useCampaignsStore,
} from '@/stores/campaigns-store';
import {
  useChatStore,
  type CampaignPickerEntry,
} from '@/stores/chat-store';
import { useIsolatedCriteriaStore } from '@/stores/isolated-criteria-store';
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
 * Wipe le chat pour démarrer une nouvelle campagne/tâche sur des
 * bases propres (cf. memory/feedback_chat_reset_on_switch.md).
 *
 * Effets :
 *   - archive la FDP courante dans campaigns-store si présente,
 *   - archive la pré-collecte isolée (criteria) en cours dans
 *     tasks-store si présente — les deux entités sont restaurables
 *     plus tard via le sélecteur de campagne (sub-phase 1.4.1),
 *   - reset chat-store, fdp-store et isolated-criteria-store,
 *   - PRÉSERVE campaigns-store, tasks-store et artifacts-store.
 *
 * Doit être appelé AVANT de poster les bulles d'ouverture du nouveau
 * contexte (route-picker isolated/new, switch dialog confirmé, etc.).
 */
export function wipeForFreshStart(): void {
  const currentFdp = useFdpStore.getState().fdp;
  if (currentFdp) {
    useCampaignsStore.getState().addCampaign({ fdp: currentFdp });
  }
  const currentCriteria = useIsolatedCriteriaStore.getState().criteria;
  if (currentCriteria) {
    useTasksStore.getState().addTask({ criteria: currentCriteria });
  }
  useChatStore.getState().reset();
  useFdpStore.getState().reset();
  useIsolatedCriteriaStore.getState().reset();
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
 * Routing CV (Session 4 — flux post-feedback DRH).
 *
 * Quand le DRH upload un ou plusieurs CV via le trombone, on ne lance
 * jamais l'analyse direct. On demande d'abord à quel contexte ces CV
 * appartiennent : nouvelle campagne, campagne en cours, ou tâche
 * isolée. Les fichiers (non-sérialisables) sont conservés dans une
 * map module-locale indexée par `pendingId` (référencé depuis le block
 * cv-route-picker du chat).
 *
 * Trois branches :
 *  - 'isolated'  → pré-collecte des 4 critères (jobTitle, seniority,
 *                  keySkills, experienceYears) avant analyse.
 *  - 'existing'  → ouvre un campaign-picker, dérive les critères de
 *                  la FDP de la campagne choisie, lance l'analyse.
 *  - 'new'       → demande un nom obligatoire, crée une CAMP-XXXX,
 *                  puis demande au DRH s'il veut faire le setup
 *                  complet (FDP) ou skipper vers la pré-collecte.
 */
export type PendingCVRouting = {
  pendingId: string;
  files: File[];
  selectedRoute: 'isolated' | 'existing' | 'new' | null;
  selectedCampaignId: string | null;
  /** TASK-XXXX ou CAMP-XXXX selon la route choisie, généré à la décision. */
  resolvedId: string | null;
};

const pendingRoutings = new Map<string, PendingCVRouting>();

export function getPendingRouting(
  pendingId: string,
): PendingCVRouting | undefined {
  return pendingRoutings.get(pendingId);
}

/**
 * Retrouve un pending par son `resolvedId` (TASK-XXXX ou CAMP-XXXX).
 * Utilisé par ManagerChat quand le DRH valide les critères isolés —
 * il a en main le taskId du store, pas le pendingId interne.
 */
export function findPendingByResolvedId(
  resolvedId: string,
): PendingCVRouting | undefined {
  for (const pending of pendingRoutings.values()) {
    if (pending.resolvedId === resolvedId) return pending;
  }
  return undefined;
}

export function clearAllPendingRoutings(): void {
  pendingRoutings.clear();
}

function snapshotActiveCampaigns(): CampaignPickerEntry[] {
  return selectActiveCampaigns(useCampaignsStore.getState()).map((c) => {
    const jobTitle = c.fdp.fields.job_title?.value;
    return {
      id: c.id,
      name: c.name,
      jobTitle:
        typeof jobTitle === 'string' && jobTitle.trim().length > 0
          ? jobTitle
          : c.name,
    };
  });
}

/**
 * Point d'entrée appelé quand un upload trombone arrive sans contexte
 * forcé (ni campagne validée + source manuelle, ni autre flux explicite).
 * Pose la question routante au DRH avec les 3 options.
 */
export function dispatchCVRouting(files: File[]): void {
  if (files.length === 0) return;
  const pendingId = nowTaskId('route');
  pendingRoutings.set(pendingId, {
    pendingId,
    files: [...files],
    selectedRoute: null,
    selectedCampaignId: null,
    resolvedId: null,
  });

  const chat = useChatStore.getState();
  chat.appendMessage({
    role: 'user',
    source: 'text',
    content:
      files.length === 1
        ? `J'ai joint un CV : ${files[0].name}.`
        : `J'ai joint ${files.length} CV : ${files.map((f) => f.name).join(', ')}.`,
  });

  const activeCampaigns = snapshotActiveCampaigns();
  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content:
      files.length === 1
        ? "Bien reçu. À quoi rattache-t-on ce CV ?"
        : `Bien reçu, ${files.length} CV au total. À quoi les rattache-t-on ?`,
    block: {
      kind: 'cv-route-picker',
      pendingId,
      fileCount: files.length,
      activeCampaigns,
      selected: null,
    },
  });
}

/**
 * Appelé quand le DRH clique « Tâche isolée » dans le route-picker.
 * Démarre la pré-collecte des 4 critères (le batch ne se lance qu'à la
 * validation explicite via le bouton vert).
 */
export function chooseRouteIsolated(pendingId: string): void {
  const pending = pendingRoutings.get(pendingId);
  if (!pending) return;
  const taskId = `TASK-${new Date().getFullYear()}-${String(
    Math.floor(Math.random() * 999) + 1,
  ).padStart(3, '0')}`;
  pending.selectedRoute = 'isolated';
  pending.resolvedId = taskId;
  pendingRoutings.set(pendingId, pending);

  // Wipe avant les bulles d'ouverture : on bascule sur une nouvelle
  // tâche, l'historique de la conversation précédente n'a plus de
  // sens et pollue le contexte LLM (cf. feedback_chat_reset_on_switch).
  // pendingRoutings est une map module-locale → survit au reset.
  const fileCount = pending.files.length;
  wipeForFreshStart();

  useIsolatedCriteriaStore.getState().startCollection(taskId);

  const chat = useChatStore.getState();
  chat.appendMessage({
    role: 'user',
    source: 'text',
    content:
      fileCount === 1
        ? 'Nouvelle tâche isolée — un CV à analyser.'
        : `Nouvelle tâche isolée — ${fileCount} CV à analyser.`,
  });
  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content: `Sollicitation ${taskId} ouverte. Pour analyser correctement ces CV, j'ai besoin de quatre critères. Commençons par l'intitulé du poste visé — qu'est-ce qu'on cherche ?`,
  });
}

/**
 * Appelé quand le DRH clique « Campagne en cours » dans le route-picker.
 * On affiche un second block : la liste des campagnes actives.
 */
export function chooseRouteExisting(pendingId: string): void {
  const pending = pendingRoutings.get(pendingId);
  if (!pending) return;
  const campaigns = snapshotActiveCampaigns();
  if (campaigns.length === 0) {
    // garde-fou — le picker UI désactive ce chip s'il n'y a aucune
    // campagne, mais on re-vérifie côté flow par sécurité.
    useChatStore.getState().appendMessage({
      role: 'manager',
      source: 'text',
      content:
        "Je n'ai pas de campagne active à laquelle rattacher ces CV pour l'instant. On peut partir sur une nouvelle campagne ou sur une analyse isolée.",
    });
    return;
  }
  pending.selectedRoute = 'existing';
  pendingRoutings.set(pendingId, pending);
  markRoutePickerSelected(pendingId, 'existing');

  const chat = useChatStore.getState();
  chat.appendMessage({
    role: 'user',
    source: 'text',
    content: 'Campagne en cours.',
  });
  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content:
      "Très bien — sur quelle campagne veux-tu rattacher ces CV ?",
    block: {
      kind: 'campaign-picker',
      pendingId,
      campaigns,
      selectedCampaignId: null,
    },
  });
}

/**
 * Appelé quand le DRH clique sur une campagne dans le campaign-picker.
 * Dérive les critères depuis la FDP, lance dispatchCVBatch.
 */
export async function chooseExistingCampaign(
  pendingId: string,
  campaignId: string,
): Promise<void> {
  const pending = pendingRoutings.get(pendingId);
  if (!pending) return;
  const campaign = useCampaignsStore.getState().getById(campaignId);
  if (!campaign) return;

  pending.selectedCampaignId = campaignId;
  pending.resolvedId = campaignId;
  pendingRoutings.set(pendingId, pending);
  markCampaignPickerSelected(pendingId, campaignId);

  useChatStore.getState().appendMessage({
    role: 'user',
    source: 'text',
    content: `Rattacher à ${campaign.id} — ${campaign.name}.`,
  });
  useChatStore.getState().appendMessage({
    role: 'manager',
    source: 'text',
    content: `Compris, je rattache ces CV à ${campaign.id} — ${campaign.name}. Je transmets au CV Analyzer avec les critères de la campagne.`,
  });

  const files = pending.files;
  pendingRoutings.delete(pendingId);
  await dispatchCVBatch({
    files,
    criteria: fdpToCVCriteria(campaign.fdp),
    threshold: DEFAULT_CV_THRESHOLD,
    campaignId: campaign.id,
  });
}

/**
 * Appelé quand le DRH clique « Nouvelle campagne » dans le route-picker.
 * Le flow attend ensuite un nom (saisi en texte libre) puis demande s'il
 * veut faire le setup complet ou skipper vers une pré-collecte courte.
 */
export type PendingNewCampaign = {
  pendingId: string;
  step: 'await_name' | 'await_setup_choice';
  name?: string;
  campaignId?: string;
};

const pendingNewCampaigns = new Map<string, PendingNewCampaign>();

export function getPendingNewCampaign(
  pendingId: string,
): PendingNewCampaign | undefined {
  return pendingNewCampaigns.get(pendingId);
}

export function chooseRouteNewCampaign(pendingId: string): void {
  const pending = pendingRoutings.get(pendingId);
  if (!pending) return;
  pending.selectedRoute = 'new';
  pendingRoutings.set(pendingId, pending);

  pendingNewCampaigns.set(pendingId, {
    pendingId,
    step: 'await_name',
  });

  // Wipe avant les bulles d'ouverture (cf. chooseRouteIsolated).
  // pendingRoutings et pendingNewCampaigns sont module-locales et
  // survivent au reset, donc consumeNewCampaignName retrouvera le
  // pending au prochain message DRH.
  const fileCount = pending.files.length;
  wipeForFreshStart();

  const chat = useChatStore.getState();
  chat.appendMessage({
    role: 'user',
    source: 'text',
    content:
      fileCount === 1
        ? 'Nouvelle campagne — un CV à rattacher.'
        : `Nouvelle campagne — ${fileCount} CV à rattacher.`,
  });
  chat.appendMessage({
    role: 'manager',
    source: 'text',
    content:
      "Très bien. Quel nom veux-tu donner à cette nouvelle campagne ? (ex. « Recrutement Data Engineer Q3 »)",
  });
}

/**
 * Helper interne : marque le route-picker comme sélectionné dans la
 * dernière bulle correspondante (pour griser visuellement les autres
 * options après le clic).
 */
function markRoutePickerSelected(
  pendingId: string,
  selected: 'new' | 'existing' | 'isolated',
): void {
  const messages = useChatStore.getState().messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.block?.kind === 'cv-route-picker' &&
      m.block.pendingId === pendingId
    ) {
      useChatStore.getState().updateMessage(m.id, {
        block: { ...m.block, selected },
      });
      return;
    }
  }
}

function markCampaignPickerSelected(
  pendingId: string,
  campaignId: string,
): void {
  const messages = useChatStore.getState().messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.block?.kind === 'campaign-picker' &&
      m.block.pendingId === pendingId
    ) {
      useChatStore.getState().updateMessage(m.id, {
        block: { ...m.block, selectedCampaignId: campaignId },
      });
      return;
    }
  }
}

/**
 * Lance le batch CV pour une tâche isolée une fois la pré-collecte
 * validée par le DRH (clic sur le bouton vert IsolatedCriteria).
 */
export async function dispatchIsolatedCVBatch(args: {
  pendingId: string;
  criteria: CVAnalysisCriteria;
}): Promise<void> {
  const pending = pendingRoutings.get(args.pendingId);
  if (!pending || !pending.resolvedId) return;
  const files = pending.files;
  const taskId = pending.resolvedId;
  pendingRoutings.delete(args.pendingId);
  useIsolatedCriteriaStore.getState().reset();

  await dispatchCVBatch({
    files,
    criteria: args.criteria,
    threshold: DEFAULT_CV_THRESHOLD,
    campaignId: taskId,
  });
}

/**
 * Phase « new campaign » — appelée par ManagerChat quand le DRH a
 * répondu en texte libre alors qu'on attend un nom. Crée la
 * CAMP-XXXX, l'enregistre comme « pré-active » (pas encore validée
 * formellement) et demande s'il veut le setup complet.
 */
export function consumeNewCampaignName(name: string): boolean {
  for (const [pendingId, pending] of pendingNewCampaigns) {
    if (pending.step !== 'await_name') continue;
    const trimmed = name.trim();
    if (!trimmed) return false;
    const campaignId = `CAMP-${new Date().getFullYear()}-${String(
      Math.floor(Math.random() * 999) + 1,
    ).padStart(3, '0')}`;
    pending.name = trimmed;
    pending.campaignId = campaignId;
    pending.step = 'await_setup_choice';
    pendingNewCampaigns.set(pendingId, pending);

    const route = pendingRoutings.get(pendingId);
    if (route) {
      route.resolvedId = campaignId;
      pendingRoutings.set(pendingId, route);
    }

    const chat = useChatStore.getState();
    chat.appendMessage({
      role: 'manager',
      source: 'text',
      content: `Parfait, campagne ${campaignId} — « ${trimmed} » créée. Veux-tu qu'on cadre tout de suite la fiche de poste complète (intitulé, séniorité, contrat, fourchette, missions, compétences…), ou on lance d'abord juste une analyse rapide des CV avec quelques critères courts ?`,
      chips: {
        placement: 'below_bubble',
        options: ['Cadrer la fiche complète', "Juste l'analyse CV pour l'instant"],
      },
    });
    return true;
  }
  return false;
}

/**
 * Branche du « new campaign » : le DRH choisit l'analyse rapide.
 * On démarre la pré-collecte critères isolés, mais sous l'identifiant
 * CAMP-XXXX (l'analyse va remplir la campagne au fil de l'eau ;
 * le setup complet pourra venir plus tard).
 */
export function newCampaignSkipSetup(): boolean {
  for (const [pendingId, pending] of pendingNewCampaigns) {
    if (pending.step !== 'await_setup_choice') continue;
    if (!pending.campaignId) continue;
    const campaignId = pending.campaignId;
    pendingNewCampaigns.delete(pendingId);

    useIsolatedCriteriaStore.getState().startCollection(campaignId);

    const chat = useChatStore.getState();
    chat.appendMessage({
      role: 'user',
      source: 'text',
      content: "Juste l'analyse CV pour l'instant.",
    });
    chat.appendMessage({
      role: 'manager',
      source: 'text',
      content: `Compris, on garde ${campaignId} en mode léger. Donne-moi l'intitulé exact du poste pour que je calibre l'analyse.`,
    });
    return true;
  }
  return false;
}

/**
 * Branche du « new campaign » : le DRH choisit le setup complet.
 * Bascule vers la collecte FDP normale : on initialise une FDP vide
 * sous CAMP-XXXX dans fdp-store, et le tour Manager suivant prendra
 * la main via `runManagerTurn`.
 */
export function newCampaignFullSetup(): {
  campaignId: string;
  pendingFiles: File[];
} | null {
  for (const [pendingId, pending] of pendingNewCampaigns) {
    if (pending.step !== 'await_setup_choice') continue;
    if (!pending.campaignId) continue;
    const campaignId = pending.campaignId;
    const route = pendingRoutings.get(pendingId);
    const pendingFiles = route?.files ?? [];
    pendingNewCampaigns.delete(pendingId);
    pendingRoutings.delete(pendingId);
    return { campaignId, pendingFiles };
  }
  return null;
}
