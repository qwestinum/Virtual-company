'use client';

import { RotateCcw } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isAdjustmentSignal } from '@/components/chat/adjustment-signal';
import { resolveEditableFieldKeys } from '@/components/chat/edit-target';

import {
  SWITCH_CHIP_KEEP,
  SWITCH_CHIP_NEW,
  type PendingSwitch,
} from '@/types/switch-dialog';

import { ActiveListeningChip } from '@/components/chat/ActiveListeningChip';
import {
  CampaignSelector,
  type CampaignEntry,
} from '@/components/chat/CampaignSelector';
import {
  PUBLICATION_CHANNEL_LABELS,
  type PublicationChannel,
} from '@/types/publication-channel';
import {
  buildDefaultSourcesConfig,
  CV_SOURCE_LABELS,
  type CVSource,
} from '@/types/cv-source';
import {
  type ScoringCriterion,
  type ScoringLevel,
} from '@/types/scoring';
import {
  CAMPAIGN_STATUS_LABELS,
  type CampaignStatus,
} from '@/types/campaign-status';
import {
  selectScoringSheet,
  useScoringStore,
} from '@/stores/scoring-store';
import { ChatBubble } from '@/components/chat/ChatBubble';
import { ChatChips } from '@/components/chat/ChatChips';
import { ChatInput } from '@/components/chat/ChatInput';
import type { EditableField } from '@/components/chat/MessageTextEditor';
import { FieldChecklist } from '@/components/chat/FieldChecklist';
import { TypingDots } from '@/components/chat/TypingDots';
import { IsolatedCriteriaChecklist } from '@/components/chat/IsolatedCriteriaChecklist';
import { ValidateFDPButton } from '@/components/chat/ValidateFDPButton';
import { ValidateIsolatedCriteriaButton } from '@/components/chat/ValidateIsolatedCriteriaButton';
import { getAvatarColor, getAvatarUrl } from '@/lib/agents/avatar-colors';
import { sanitizeFieldExtractions } from '@/lib/agents/extraction-guard';
import {
  postIsolatedManagerChat,
  postManagerChat,
  postManagerScoring,
  postTranscribe,
} from '@/lib/chat/api-client';
import {
  chooseExistingCampaign,
  chooseRouteBrief,
  chooseRouteExisting,
  chooseRouteIsolated,
  chooseRouteNewCampaign,
  dispatchCVRouting,
  dispatchJobWriter,
  dispatchPublisher,
  findPendingByResolvedId,
  PREFILL_CONFIRM_WEIGHTS_LABEL,
  PREFILL_REJECT_WEIGHTS_LABEL,
  wipeForFreshStart,
} from '@/lib/chat/manager-flow';
import { pushArtifact } from '@/lib/db/sync/artifacts-sync';
import { renderFdpMarkdown, suggestFdpFileName } from '@/lib/agents/fdp-render';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/stores/agents-store';
import { useArtifactsStore } from '@/stores/artifacts-store';
import { useCampaignsStore } from '@/stores/campaigns-store';
import { useTasksStore } from '@/stores/tasks-store';
import {
  selectMessages,
  useChatStore,
  type ChatMessage,
} from '@/stores/chat-store';
import { useFdpStore } from '@/stores/fdp-store';
import { useIsolatedCriteriaStore } from '@/stores/isolated-criteria-store';
import {
  buildEmptyFDP,
  FIELD_KEYS,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';
import {
  ISOLATED_CRITERIA_KEYS,
  type IsolatedCriteriaInProgress,
} from '@/types/isolated-criteria';
import { nextFlowStep } from '@/lib/campaign/lifecycle';

const MANAGER_ID = 'agent.manager-rh';

type ResumeAction = 'fdp' | 'scoring' | 'channels' | 'sources';

/**
 * Phase 7.4.1 / 7.5 — chips de réouverture/reprise pour les
 * campagnes dans un statut « bloquant » (operator-set, jamais
 * écrasé par recomputeStatus). Tant que le DRH n'a pas explicitement
 * remis la campagne en route, les chips de modification ne sont pas
 * proposées : elles agiraient sur la FDP / scoring / etc. sans
 * pouvoir débloquer le status, ce qui crée une incohérence visible.
 */
const REOPEN_CHIP_LABEL = 'Rouvrir la campagne'; // status === 'closed'
const RESUME_PAUSED_CHIP_LABEL = 'Reprendre la campagne'; // status === 'paused'

/**
 * Session 5 — chip de validation rapide quand le Manager vient de
 * dumper une FDP archivée (MODE RÉUTILISATION L1, cf. prompt
 * manager-prompts.ts). Le libellé est imposé par le prompt et est
 * intercepté côté client pour appeler `handleValidateFDP` sans
 * round-trip LLM.
 */
const REUSE_FDP_VALIDATE_LABEL = 'Valider telle quelle';
// Session — 3ᵉ choix sur une fiche archivée retrouvée : on n'utilise PAS
// l'archive, on reconstruit. Libellé imposé par le prompt, intercepté côté
// client. On garde l'intitulé (le poste est déjà exprimé) et on repart en
// MODE PROPOSITION sur les autres champs — ce qui évite de redemander le
// poste ET empêche la pré-recherche de reproposer la même fiche en boucle.
const REUSE_FDP_RESET_LABEL = 'Repartir à zéro';
// Récap final FDP complète (#3) : chip explicite de validation, intercepté
// côté client comme « Valider telle quelle » (appelle handleValidateFDP).
const FDP_VALIDATE_LABEL = 'Valider la fiche de poste';

const REDIGER_AD_LABEL = "Rédiger l'annonce";
const PUBLISH_AD_LABEL = "Publier l'annonce";
const POSTPONE_PHASE_LABEL = 'À remettre à plus tard';

/**
 * Phase 7.2 — verbe contextuel sur les chips de reprise. Chaque
 * artefact peut être à l'un des trois états :
 *   - 'untouched' : rien n'a été produit ⇒ "Initier ..."
 *   - 'started'   : entamé mais pas validé ⇒ "Continuer ..."
 *   - 'validated' : produit et validé ⇒ "Modifier ..."
 *
 * Les libellés sont calculés à chaque reprise pour refléter l'état
 * réel des stores. handleChipSelect intercepte via une map
 * label → ResumeAction stockée dans pendingResumeActionsRef plutôt
 * que par match string exact (les libellés sont dynamiques).
 */
type ResumeChipStage = 'untouched' | 'started' | 'validated';

const RESUME_VERB: Record<ResumeChipStage, string> = {
  untouched: 'Initier',
  started: 'Continuer',
  validated: 'Modifier',
};

const RESUME_NOUN: Record<ResumeAction, string> = {
  fdp: 'la FDP',
  scoring: 'la fiche de scoring',
  channels: 'les annonces',
  sources: 'les flux',
};

/**
 * Phase 7.4.2 — fallback de reconstruction de l'action depuis un
 * libellé de chip. Sert quand le ref `pendingResumeActionsRef` a été
 * perdu (re-render, hot-reload, autre handler qui l'a vidé) mais que
 * le libellé contient son suffixe canonique. Plus robuste que le
 * lookup exact dans la map.
 */
function resumeActionFromLabel(label: string): ResumeAction | null {
  const lower = label.toLowerCase();
  if (lower.endsWith(RESUME_NOUN.fdp.toLowerCase())) return 'fdp';
  if (lower.endsWith(RESUME_NOUN.scoring.toLowerCase())) return 'scoring';
  if (lower.endsWith(RESUME_NOUN.channels.toLowerCase())) return 'channels';
  if (lower.endsWith(RESUME_NOUN.sources.toLowerCase())) return 'sources';
  return null;
}

/**
 * Phase 7.4 — un état d'avancement par artefact, calculé depuis les
 * stores au moment de la reprise ou de la fin d'une étape. Sert à
 * (a) générer un récap textuel et (b) produire les chips contextuels.
 */
type ProgressSnapshot = {
  campaignId: string;
  status: CampaignStatus;
  stages: Record<ResumeAction, ResumeChipStage>;
  channelsPublished: PublicationChannel[];
};

function computeProgressSnapshot(
  campaignId: string,
): ProgressSnapshot | null {
  const fdpNow = useFdpStore.getState().fdp;
  const sheetNow = useScoringStore.getState().sheet;
  const arch = useCampaignsStore.getState().getById(campaignId);
  const fdpForStage = fdpNow?.campaignId === campaignId ? fdpNow : arch?.fdp ?? null;
  const sheetForStage =
    sheetNow?.campaignId === campaignId ? sheetNow : arch?.scoringSheet ?? null;
  if (!fdpForStage && !arch) return null;
  const fdpStage: ResumeChipStage = !fdpForStage
    ? 'untouched'
    : fdpForStage.isValidated
      ? 'validated'
      : Object.values(fdpForStage.fields).some(
            (f) => f?.status === 'filled',
          )
        ? 'started'
        : 'untouched';
  const scoringStage: ResumeChipStage = !sheetForStage
    ? 'untouched'
    : sheetForStage.isValidated
      ? 'validated'
      : 'started';
  const channelsPublished = arch?.publishedChannels ?? [];
  const channelsStage: ResumeChipStage =
    channelsPublished.length > 0 ? 'validated' : 'untouched';
  const sourcesStage: ResumeChipStage = arch?.sourcesConfirmed
    ? 'validated'
    : 'untouched';
  return {
    campaignId,
    status: arch?.status ?? 'draft',
    stages: {
      fdp: fdpStage,
      scoring: scoringStage,
      channels: channelsStage,
      sources: sourcesStage,
    },
    channelsPublished,
  };
}

/**
 * Phase 7.4 — récap textuel de l'avancement par artefact. Une ligne
 * par jalon avec un préfixe ✓ (validé) / · (entamé) / ○ (à initier),
 * suffisamment compact pour entrer dans une bulle Manager.
 */
function formatProgressRecap(snap: ProgressSnapshot): string {
  const prefix = (s: ResumeChipStage): string =>
    s === 'validated' ? '✓' : s === 'started' ? '·' : '○';
  const adsLine =
    snap.stages.channels === 'validated' &&
    snap.channelsPublished.length > 0
      ? `${prefix(snap.stages.channels)} Annonces publiées sur ${snap.channelsPublished
          .map((c) => PUBLICATION_CHANNEL_LABELS[c])
          .join(', ')}`
      : `${prefix(snap.stages.channels)} Annonces ${
          snap.stages.channels === 'validated' ? 'publiées' : 'à initier'
        }`;
  return [
    `${prefix(snap.stages.fdp)} FDP ${
      snap.stages.fdp === 'validated'
        ? 'validée'
        : snap.stages.fdp === 'started'
          ? 'en cours'
          : 'à initier'
    }`,
    adsLine,
    `${prefix(snap.stages.sources)} Flux de réception ${
      snap.stages.sources === 'validated' ? 'configurés' : 'à configurer'
    }`,
    `${prefix(snap.stages.scoring)} Fiche de scoring ${
      snap.stages.scoring === 'validated'
        ? 'validée'
        : snap.stages.scoring === 'started'
          ? 'en cours'
          : 'à initier'
    }`,
  ].join('\n');
}

/**
 * Phase 7.4 — produit le payload chips contextuels (label → action)
 * pour une campagne. `exclude` permet d'omettre l'action en cours
 * d'un block (ex. quand on poste le picker channels, on omet le chip
 * « ... les annonces »). Limite stricte à 4 chips (ChipSet accepte 5).
 */
function buildResumeChipPayload(
  snap: ProgressSnapshot,
  exclude?: ResumeAction,
): { options: string[]; labelMap: Record<string, ResumeAction> } {
  const actions: ResumeAction[] = ['fdp', 'scoring', 'channels', 'sources'];
  const labelMap: Record<string, ResumeAction> = {};
  const options: string[] = [];
  for (const action of actions) {
    if (action === exclude) continue;
    const label = `${RESUME_VERB[snap.stages[action]]} ${RESUME_NOUN[action]}`;
    labelMap[label] = action;
    options.push(label);
  }
  return { options, labelMap };
}

function countMissing(fdp: FDPInProgress): number {
  return FIELD_KEYS.filter((k) => fdp.fields[k]?.status !== 'filled').length;
}

function countMissingIsolated(criteria: IsolatedCriteriaInProgress): number {
  return ISOLATED_CRITERIA_KEYS.filter(
    (k) => criteria.fields[k]?.status !== 'filled',
  ).length;
}

/**
 * Construit la liste d'entries pour le sélecteur de campagne, en
 * unifiant deux familles d'entités :
 *   - les campagnes FDP (campaigns-store, kind 'fdp'),
 *   - les tâches isolées (tasks-store, kind 'isolated').
 *
 * Une (et une seule) entrée est marquée `isCurrent: true` selon
 * l'état actif côté ManagerChat : FDP courante si présente, sinon
 * criteria isolée courante. Les archivées suivent, plus récente
 * d'abord. L'id de la courante est exclu de la liste archivée pour
 * éviter le doublon (un même id peut transiter par addCampaign /
 * addTask lors d'un switch dialog confirmé).
 */
function buildCampaignEntries(args: {
  currentFdp: FDPInProgress | null;
  currentCriteria: IsolatedCriteriaInProgress | null;
  archivedCampaigns: ReadonlyArray<{
    id: string;
    name: string;
    fdp: FDPInProgress;
    status: CampaignStatus;
  }>;
  archivedTasks: ReadonlyArray<{
    id: string;
    name: string;
    criteria: IsolatedCriteriaInProgress;
    status: CampaignStatus;
  }>;
}): CampaignEntry[] {
  /**
   * Status de la campagne courante.
   *
   * Phase 8.1 — Source de vérité : l'archive du campaigns-store (qui
   * est synchronisée à chaque jalon via markPublishedChannel /
   * markSourcesConfirmed / addCampaign + recomputeStatus). On lit
   * directement archive.status si l'archive existe.
   *
   * Sans ça, deriveCurrentFdpStatus retournait 'active' dès que la
   * scoring était validée, alors que recomputeStatus exige aussi
   * publishedChannels > 0 ET sourcesConfirmed === true. Conséquence :
   * la même campagne apparaissait 'active' tant qu'elle était
   * courante, puis 'en cours' une fois archivée — incohérence visible.
   *
   * Fallback : pas d'archive encore (FDP créée mais pas validée donc
   * jamais passée par handleValidateFDP). On dérive depuis l'état
   * local de la FDP + scoring (la courante est forcément draft ou
   * in_progress dans ce cas — pas active sans archive).
   */
  const archivedForCurrent = args.currentFdp
    ? args.archivedCampaigns.find(
        (c) => c.id === args.currentFdp!.campaignId,
      ) ?? null
    : null;
  const deriveCurrentFdpStatus = (f: FDPInProgress): CampaignStatus => {
    if (archivedForCurrent) return archivedForCurrent.status;
    if (!f.isValidated) return 'draft';
    return 'in_progress';
  };
  // Phase 8.1 — symétrique : la tâche courante lit son statut depuis
  // l'archive du tasks-store (source de vérité) avec fallback dérivé
  // uniquement quand pas encore archivée.
  const archivedForCurrentTask = args.currentCriteria
    ? args.archivedTasks.find(
        (t) => t.id === args.currentCriteria!.taskId,
      ) ?? null
    : null;
  const deriveCurrentTaskStatus = (
    c: IsolatedCriteriaInProgress,
  ): CampaignStatus => {
    if (archivedForCurrentTask) return archivedForCurrentTask.status;
    return c.isValidated ? 'active' : 'draft';
  };
  const fdpTitle = (f: FDPInProgress): string => {
    const v = f.fields.job_title?.value;
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return 'Poste non précisé';
  };
  const criteriaTitle = (c: IsolatedCriteriaInProgress): string => {
    const v = c.fields.job_title?.value;
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
    return 'Poste non précisé';
  };

  const entries: CampaignEntry[] = [];
  let currentId: string | null = null;

  if (args.currentFdp) {
    currentId = args.currentFdp.campaignId;
    entries.push({
      kind: 'fdp',
      id: args.currentFdp.campaignId,
      title: fdpTitle(args.currentFdp),
      status: deriveCurrentFdpStatus(args.currentFdp),
      isCurrent: true,
      snapshot: null,
    });
  } else if (args.currentCriteria) {
    currentId = args.currentCriteria.taskId;
    entries.push({
      kind: 'isolated',
      id: args.currentCriteria.taskId,
      title: criteriaTitle(args.currentCriteria),
      status: deriveCurrentTaskStatus(args.currentCriteria),
      isCurrent: true,
      snapshot: null,
    });
  }

  // Archivés — campagnes puis tâches, plus récent en premier.
  for (let i = args.archivedCampaigns.length - 1; i >= 0; i--) {
    const c = args.archivedCampaigns[i];
    if (c.id === currentId) continue;
    entries.push({
      kind: 'fdp',
      id: c.id,
      title: c.name || fdpTitle(c.fdp),
      status: c.status,
      isCurrent: false,
      snapshot: c.fdp,
    });
  }
  for (let i = args.archivedTasks.length - 1; i >= 0; i--) {
    const t = args.archivedTasks[i];
    if (t.id === currentId) continue;
    entries.push({
      kind: 'isolated',
      id: t.id,
      title: t.name || criteriaTitle(t.criteria),
      status: t.status,
      isCurrent: false,
      snapshot: t.criteria,
    });
  }
  return entries;
}

/**
 * Récupère le contenu textuel du DERNIER message DRH dans le tableau.
 * Utilisé sur switch confirmé pour re-seeder le chat reset avec
 * l'intention qui a déclenché la bascule (« en fait je veux un
 * développeur python »), sinon le LLM tomberait sur un greeting nu.
 */
function findLastUserContent(
  messages: ReadonlyArray<{ role: string; content: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'user' && m.content.trim().length > 0) return m.content;
  }
  return null;
}

/**
 * Phase 6.1 — Convertit les 4 critères isolated en FDPInProgress
 * synthétique, payload accepté par /api/manager/scoring (qui
 * attend FDPInProgressSchema). Les champs non-mappables restent
 * 'empty' ; le prompt scoring tolère les FDP partielles.
 */
function buildFDPFromIsolatedCriteria(
  criteria: IsolatedCriteriaInProgress,
): FDPInProgress {
  const fdp = buildEmptyFDP(criteria.taskId);
  const jobTitle = criteria.fields.job_title?.value;
  if (typeof jobTitle === 'string' && jobTitle.trim().length > 0) {
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      status: 'filled',
      value: jobTitle.trim(),
    };
  }
  const seniority = criteria.fields.seniority?.value;
  if (typeof seniority === 'string' && seniority.trim().length > 0) {
    fdp.fields.seniority = {
      ...fdp.fields.seniority!,
      status: 'filled',
      value: seniority.trim(),
    };
  }
  const keySkills = criteria.fields.key_skills?.value;
  if (Array.isArray(keySkills) && keySkills.length > 0) {
    fdp.fields.key_skills = {
      ...fdp.fields.key_skills!,
      status: 'filled',
      value: keySkills.filter(
        (s): s is string => typeof s === 'string' && s.trim().length > 0,
      ),
    };
  }
  // experience_years n'a pas de champ FDP direct — on l'évoque dans
  // les missions pour que le prompt scoring puisse en faire un critère.
  const exp = criteria.fields.experience_years?.value;
  if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0) {
    fdp.fields.main_missions = {
      ...fdp.fields.main_missions!,
      status: 'filled',
      value: [`Expérience minimale attendue : ${exp} ans`],
    };
  }
  return fdp;
}


/**
 * Champs FDP qui constituent matériellement le contenu d'une annonce.
 * Si l'un d'eux change réellement alors qu'une annonce existe déjà, le
 * changement est jugé « structurel » → le Manager propose de la refaire
 * (le DRH tranche). `start_date` n'apparaît pas dans l'annonce : un
 * ajustement de date seul n'en déclenche pas la régénération.
 */
const STRUCTURAL_AD_FIELDS = new Set<FieldKey>([
  'job_title',
  'seniority',
  'contract_type',
  'location',
  'salary_range',
  'main_missions',
  'key_skills',
]);

const AD_ARRAY_FIELDS = new Set<FieldKey>(['main_missions', 'key_skills']);

// Libellés des chips de la proposition de régénération d'annonce —
// interceptés côté client (cf. handleChipSelect).
const REGEN_AD_YES = "Refaire l'annonce";
const REGEN_AD_NO = 'Laisser tel quel';

/** Valeur d'un champ FDP → texte d'édition (liste = un item par ligne). */
function formatFieldValueForEdit(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v : String(v))).join('\n');
  }
  if (typeof value === 'string') return value;
  return String(value);
}

/** Texte d'édition → valeur de champ (liste re-splittée pour les arrays). */
function parseFieldValue(fieldKey: FieldKey, raw: string): unknown {
  const trimmed = raw.trim();
  if (!AD_ARRAY_FIELDS.has(fieldKey)) return trimmed;
  return trimmed
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Comparaison « valeur de champ » stable (ordre/format insensibles). */
function fieldValuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function ManagerChat() {
  const messages = useChatStore(selectMessages);
  const isSending = useChatStore((s) => s.isSending);
  const isTranscribing = useChatStore((s) => s.isTranscribing);
  const error = useChatStore((s) => s.error);
  const appendMessage = useChatStore((s) => s.appendMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setSending = useChatStore((s) => s.setSending);
  const setTranscribing = useChatStore((s) => s.setTranscribing);
  const setError = useChatStore((s) => s.setError);
  const dismissLastManagerChips = useChatStore(
    (s) => s.dismissLastManagerChips,
  );
  const resetChat = useChatStore((s) => s.reset);

  // Édition en place d'un CHAMP SOURCE (clic « Ajuster ») : la bulle et
  // le champ FDP visés. null = aucune édition en cours.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(
    null,
  );
  const [isAgentBusy, setAgentBusy] = useState(false);
  // Token incrémental : déplie la checklist FDP (clic « Ajuster » sur une
  // bulle sans lien source — vieux message).
  const [expandChecklistToken, setExpandChecklistToken] = useState(0);
  // Contexte de la proposition de régénération d'annonce en attente
  // (campagne dont la source a changé de façon structurelle).
  const pendingRegenRef = useRef<{ campaignId: string } | null>(null);
  const [openFirstMissingToken, setOpenFirstMissingToken] = useState(0);
  const [
    openFirstMissingIsolatedToken,
    setOpenFirstMissingIsolatedToken,
  ] = useState(0);

  const fdp = useFdpStore((s) => s.fdp);
  const createFDP = useFdpStore((s) => s.createFDP);
  const restoreFDP = useFdpStore((s) => s.restoreFDP);
  const applyExtractions = useFdpStore((s) => s.applyExtractions);
  const validateFDP = useFdpStore((s) => s.validateFDP);
  const resetFdp = useFdpStore((s) => s.reset);
  const resetArtifacts = useArtifactsStore((s) => s.reset);
  const addCampaign = useCampaignsStore((s) => s.addCampaign);
  const resetCampaigns = useCampaignsStore((s) => s.reset);
  // On sélectionne `byId` et `order` séparément (références stables
  // côté Zustand) puis on dérive la liste localement via useMemo.
  // Sans ça, retourner `s.order.map(...)` depuis le sélecteur produit
  // un nouveau tableau à chaque render → re-rendus infinis.
  const campaignsById = useCampaignsStore((s) => s.byId);
  const campaignsOrder = useCampaignsStore((s) => s.order);
  const archivedCampaigns = useMemo(
    () =>
      campaignsOrder
        .map((id) => campaignsById[id])
        .filter((c): c is NonNullable<typeof c> => Boolean(c)),
    [campaignsById, campaignsOrder],
  );
  const isolatedCriteria = useIsolatedCriteriaStore((s) => s.criteria);
  const applyIsolatedExtractions = useIsolatedCriteriaStore(
    (s) => s.applyExtractions,
  );
  const validateIsolated = useIsolatedCriteriaStore((s) => s.validate);
  const resetIsolated = useIsolatedCriteriaStore((s) => s.reset);
  const restoreCollection = useIsolatedCriteriaStore(
    (s) => s.restoreCollection,
  );

  const tasksById = useTasksStore((s) => s.byId);
  const tasksOrder = useTasksStore((s) => s.order);
  const archivedTasks = useMemo(
    () =>
      tasksOrder
        .map((id) => tasksById[id])
        .filter((t): t is NonNullable<typeof t> => Boolean(t)),
    [tasksById, tasksOrder],
  );
  const resetAgents = useAgentsStore((s) => s.resetToRegistry);

  const scoringSheet = useScoringStore(selectScoringSheet);
  const proposeScoringSheet = useScoringStore((s) => s.proposeSheet);
  const addScoringCriterion = useScoringStore((s) => s.addCriterion);
  const updateScoringCriterion = useScoringStore((s) => s.updateCriterion);
  const removeScoringCriterion = useScoringStore((s) => s.removeCriterion);
  const validateScoringSheet = useScoringStore((s) => s.validate);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  /**
   * Switch déterministe (sub-phase 1.3) : payload renvoyé par le serveur
   * quand le DRH ouvre un nouveau poste alors qu'une campagne en cours
   * (draft ou validée) existe. handleChipSelect le consomme pour soit
   * archiver + créer une nouvelle FDP, soit conserver l'actuelle.
   */
  const pendingSwitchRef = useRef<PendingSwitch | null>(null);

  /**
   * Pending channel pick (Phase 3) : posé par handleValidateFDP, le ref
   * mémorise la FDP qui attend que le DRH choisisse un réseau de
   * publication via les chips canoniques. Consommé par
   * handleChipSelect → handlePublicationChannelPick → dispatchJobWriter.
   */
  const pendingChannelPickRef = useRef<{ fdp: FDPInProgress } | null>(null);

  const pendingPublishRef = useRef<{ campaignId: string; channels: PublicationChannel[] } | null>(null);

  /**
   * Phase 7.4 — pose les chips contextuels d'options de reprise sur la
   * dernière bulle Manager du chat. Utilisé à la fin de chaque étape
   * (validation FDP, dispatch annonces, confirm flux, validation
   * scoring) pour permettre au DRH de basculer sur un autre artefact
   * sans repasser par le sélecteur. `exclude` retire l'action portée
   * par le block courant de la liste (sinon doublon visuel).
   */
  function attachResumeChipsToLastBubble(
    campaignId: string,
    exclude?: ResumeAction,
  ) {
    const snap = computeProgressSnapshot(campaignId);
    if (!snap) return;
    const { options, labelMap } = buildResumeChipPayload(snap, exclude);
    if (options.length === 0) return;
    const messages = useChatStore.getState().messages;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === 'manager') {
        pendingResumeActionsRef.current = labelMap;
        updateMessage(m.id, {
          chips: { placement: 'below_bubble', options },
        });
        return;
      }
    }
  }

  /**
   * Phase 7.2 — map des libellés des chips de reprise actifs vers
   * leur ResumeAction. Posé par handleSelectCampaign au moment où
   * on calcule les libellés contextuels (Initier/Continuer/Modifier).
   * Consommé par handleChipSelect en priorité sur tous les autres
   * intercepteurs (sinon "Modifier ..." est absorbé par isAdjustmentSignal).
   */
  const pendingResumeActionsRef = useRef<Record<string, ResumeAction> | null>(
    null,
  );

  /**
   * Phase 7.4.1 — entry de la campagne closed en attente d'une
   * réouverture via le chip "Rouvrir la campagne". On stocke l'entry
   * complète pour pouvoir appeler handleCampaignStatusChange au clic.
   */
  const pendingReopenRef = useRef<CampaignEntry | null>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    // `editingMessageId` est dans les deps : l'ouverture de l'éditeur en
    // place (clic « Ajuster ») n'ajoute PAS de message, donc sans ce
    // déclencheur l'éditeur s'ouvrait sous la zone visible pour les bulles
    // longues (missions / compétences = listes multi-lignes) — le DRH avait
    // l'impression qu'« Ajuster » ne faisait rien. On scrolle pour le révéler.
  }, [messages.length, isSending, isTranscribing, editingMessageId]);

  function handleReset() {
    resetChat();
    resetFdp();
    resetArtifacts();
    resetCampaigns();
    resetIsolated();
    resetAgents();
  }

  /**
   * Applique UN ajustement de champ à la FDP (la source). Retourne si la
   * valeur a réellement changé ET si ce champ est structurel pour
   * l'annonce — l'appelant décide ensuite de proposer une régénération.
   */
  function applyFieldToSource(
    fieldKey: FieldKey,
    raw: string,
  ): { changed: boolean; structural: boolean } {
    const current = useFdpStore.getState().fdp;
    if (!current) return { changed: false, structural: false };
    const oldValue = current.fields[fieldKey]?.value;
    const newValue = parseFieldValue(fieldKey, raw);
    applyExtractions({ [fieldKey]: newValue } as Partial<
      Record<FieldKey, unknown>
    >);
    return {
      changed: !fieldValuesEqual(oldValue, newValue),
      structural: STRUCTURAL_AD_FIELDS.has(fieldKey),
    };
  }

  /**
   * Après application d'un (ou plusieurs) ajustement(s) : si un champ
   * structurel a réellement changé ET qu'une annonce existe déjà pour la
   * campagne, le Manager propose de la refaire (chips). Le DRH tranche.
   */
  function maybeProposeAdRegeneration(structuralChanged: boolean) {
    if (!structuralChanged) return;
    const current = useFdpStore.getState().fdp;
    if (!current) return;
    const campaignId = current.campaignId;
    const hasJobAd = Object.values(
      useArtifactsStore.getState().byId,
    ).some((a) => a.kind === 'job_ad' && a.campaignId === campaignId);
    if (!hasJobAd) return;
    pendingRegenRef.current = { campaignId };
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `J'ai mis à jour la fiche. Ce changement modifie l'annonce déjà publiée — voulez-vous que je la refasse à partir de la fiche à jour, ou qu'on la laisse telle quelle ?`,
      chips: { placement: 'below_bubble', options: [REGEN_AD_YES, REGEN_AD_NO] },
    });
  }

  /**
   * Cœur « source de vérité » : un ajustement de champ unique (pencil de
   * la checklist) → applique à la source + propage aux dérivés.
   */
  function handleFieldAdjust(fieldKey: FieldKey, raw: string) {
    const { changed, structural } = applyFieldToSource(fieldKey, raw);
    maybeProposeAdRegeneration(changed && structural);
  }

  /**
   * Valider l'édition EN PLACE d'une bulle (clic « Ajuster ») : applique
   * chaque champ proposé à la source, propose UNE régénération si
   * pertinent, retire les chips de la bulle et sort de l'édition.
   */
  function handleProposalEditSubmit(
    messageId: string,
    edits: { fieldKey: FieldKey; raw: string }[],
  ) {
    // Applique l'ajustement à la SOURCE (FDP).
    for (const { fieldKey, raw } of edits) {
      applyFieldToSource(fieldKey, raw);
    }
    setEditingMessageId(null);

    // Bulle DRH récapitulant l'ajustement (trace + projection audio).
    const fdpNow = useFdpStore.getState().fdp;
    const summary = edits
      .map(({ fieldKey }) => {
        const f = fdpNow?.fields[fieldKey];
        return `${f?.label ?? fieldKey} : ${formatFieldValueForEdit(f?.value)}`;
      })
      .join(' · ');
    appendMessage({ role: 'user', source: 'text', content: `Je retiens — ${summary}` });

    // RÉCAP FINAL : si l'ajustement a été fait DEPUIS la bulle de récap (ses
    // chips portent le libellé de validation de la fiche), cette retouche EST
    // la dernière décision du DRH. On FINALISE la fiche directement — on NE
    // re-émet PAS le récap pour une nouvelle validation/ajustement. Doctrine
    // métier : ajuster sur le récap = valider et continuer (« fiche validée »),
    // pas reboucler.
    const editedMessage = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    const isRecapEdit = Boolean(
      editedMessage?.chips?.options.some(
        (o) => o === FDP_VALIDATE_LABEL || o === REUSE_FDP_VALIDATE_LABEL,
      ),
    );
    if (isRecapEdit && fdpNow?.isComplete && !fdpNow.isValidated) {
      void handleValidateFDP();
      return;
    }

    // Mi-collecte : on relance le Manager pour qu'il enchaîne sur le champ
    // suivant. ⚠️ Le LIBELLÉ compte : le prompt Manager (« INTERPRÉTATION DES
    // SIGNAUX D'AJUSTEMENT ») lit TOUT message DRH commençant par un signal
    // vague (« Ajuster », « Modifier »…) comme une demande d'édition libre du
    // champ COURANT → il repose la même question SANS proposer de valeur. Un
    // message « J'ajuste — … » déclenchait ce faux positif. On énonce donc la
    // VALEUR RETENUE : le prompt la traite comme une acceptation et enchaîne
    // sur le champ suivant (cf. règle « dès que le DRH donne une valeur »).
    void sendToManager(useChatStore.getState().messages);
  }

  /** Annuler : on sort de l'édition, les chips masqués réapparaissent. */
  function handleProposalEditCancel() {
    setEditingMessageId(null);
  }

  /**
   * Le champ éditable d'une bulle (clic « Ajuster ») : l'UNIQUE champ que la
   * bulle a proposé (`proposalField`, déclaré par le LLM), pré-rempli depuis
   * la valeur ACTUELLE de la source (FDP). Vide si la bulle n'a pas de
   * proposalField (récap pré-recherche en bloc → on déplie la checklist).
   */
  function editableFieldsForMessage(message: ChatMessage): EditableField[] {
    const fdpNow = useFdpStore.getState().fdp;
    if (!fdpNow) return [];
    // Résolution déterministe du / des champ(s) cible(s) — cf. resolveEditableFieldKeys.
    // Inclut le filet « champ en cours de collecte » quand la bulle n'a pas
    // d'ancrage explicite (proposalField oublié + rien d'extrait).
    return resolveEditableFieldKeys(message, fdpNow).map((k) => ({
      fieldKey: k,
      label: fdpNow.fields[k]?.label ?? k,
      initialValue: formatFieldValueForEdit(fdpNow.fields[k]?.value),
    }));
  }

  /**
   * Régénération de l'annonce après accord du DRH : le Job Writer la
   * refait depuis la FDP à jour, sur les canaux déjà publiés.
   */
  async function handleRegenerateAd(campaignId: string) {
    const fdpNow = useFdpStore.getState().fdp;
    const camp = useCampaignsStore.getState().getById(campaignId);
    const channels = camp?.publishedChannels ?? [];
    if (!fdpNow || fdpNow.campaignId !== campaignId || channels.length === 0) {
      appendMessage({
        role: 'manager',
        source: 'text',
        content:
          "Je n'ai pas retrouvé d'annonce publiée à refaire pour cette campagne — rien à régénérer.",
      });
      return;
    }
    appendMessage({
      role: 'user',
      source: 'text',
      content: REGEN_AD_YES,
    });
    setAgentBusy(true);
    try {
      for (const channel of channels) {
        await dispatchJobWriter(fdpNow, channel);
      }
    } finally {
      setAgentBusy(false);
    }
  }

  /**
   * Campaign lifecycle flow controller: reads the campaign's lifecycle state
   * and posts the next step (scoring → intake → announcement → launched).
   */
  function advanceFlow(campaignId: string) {
    const camp = useCampaignsStore.getState().getById(campaignId);
    if (!camp) return;
    const step = nextFlowStep(camp.lifecycle);
    switch (step.kind) {
      case 'scoring':
        void proposeScoringForCampaign(campaignId);
        break;
      case 'intake':
        postFluxStep(campaignId);
        break;
      case 'announcement':
        postAnnouncementChoice(campaignId);
        break;
      case 'publication':
        postPublicationChoice(campaignId);
        break;
      case 'launched':
        postLaunched(campaignId);
        break;
      case 'collect-fdp':
        // Reopened FDP handled by resume flow; no-op here
        break;
    }
  }

  /**
   * Posts the scoring proposal step for a campaign.
   * Already exists - reused as-is.
   */
  // proposeScoringForCampaign is already defined below

  /**
   * Posts the flux (CV sources) picker step. Channel-independent default:
   * manual ON, all others OFF.
   */
  function postFluxStep(campaignId: string) {
    // Use buildDefaultSourcesConfig with empty array for channel-independent default
    const defaultSources = buildDefaultSourcesConfig([]);

    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Maintenant, configure les flux de réception CV pour ${campaignId}. J'ai activé l'upload manuel par défaut — tu peux ajuster ci-dessous.`,
      block: {
        kind: 'cv-sources-picker',
        campaignId,
        activeSources: defaultSources,
        confirmed: false,
      },
    });
    attachResumeChipsToLastBubble(campaignId, 'sources');
  }

  /**
   * Posts the announcement choice step.
   */
  function postAnnouncementChoice(_campaignId: string) {
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Veux-tu que je rédige l'annonce maintenant, ou on remet ça à plus tard ?`,
      chips: {
        placement: 'below_bubble',
        options: [REDIGER_AD_LABEL, POSTPONE_PHASE_LABEL],
      },
    });
  }

  /**
   * Posts the publication choice step.
   */
  function postPublicationChoice(_campaignId: string) {
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `L'annonce est prête. On la publie maintenant, ou à remettre à plus tard ?`,
      chips: {
        placement: 'below_bubble',
        options: [PUBLISH_AD_LABEL, POSTPONE_PHASE_LABEL],
      },
    });
  }

  /**
   * Posts the announcement (publication channels) picker step. This is the
   * LAST step in the flow - after scoring and flux.
   */
  function postAnnouncementStep(campaignId: string, fdp: FDPInProgress) {
    pendingChannelPickRef.current = { fdp };
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Dernière étape : sur quels réseaux veux-tu diffuser l'annonce pour ${campaignId} ? Tu peux en sélectionner plusieurs — je produirai une annonce adaptée à chacun.`,
      block: {
        kind: 'publication-channel-picker',
        campaignId,
        selectedChannels: [],
        confirmed: false,
      },
    });
    attachResumeChipsToLastBubble(campaignId, 'channels');
  }

  /**
   * Posts the final "launched" message when all phases are complete.
   */
  function postLaunched(campaignId: string) {
    const camp = useCampaignsStore.getState().getById(campaignId);
    if (camp?.status === 'active') {
      // Wording adapté à l'état RÉEL des phases optionnelles : une annonce/
      // publication reportée ne doit pas être annoncée comme « publiée ».
      const adDone = camp.lifecycle.phases.announcement.status === 'done';
      const pubDone = camp.lifecycle.phases.publication.status === 'done';
      const adLine = pubDone
        ? 'annonce publiée'
        : adDone
          ? 'annonce rédigée (publication à faire plus tard)'
          : 'annonce et publication à faire plus tard';
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `🎯 Campagne ${campaignId} lancée. Jalons obligatoires alignés (FDP validée, scoring validé, flux configurés) — ${adLine}. La campagne reçoit les CV via les flux ; tu peux reprendre l'annonce/publication à tout moment via les chips ci-dessous.`,
      });
    } else {
      appendMessage({
        role: 'manager',
        source: 'text',
        content:
          'Il reste des étapes à franchir avant de lancer. Utilise les chips ci-dessous pour finaliser.',
      });
    }
    attachResumeChipsToLastBubble(campaignId);
  }

  async function handleValidateFDP() {
    const current = useFdpStore.getState().fdp;
    if (!current || !current.isComplete || current.isValidated) return;
    validateFDP();
    const validated = useFdpStore.getState().fdp;
    if (!validated) return;
    // Phase 7.2.1 — Détection d'une revalidation après modification
    // d'une campagne déjà avancée. On regarde l'archive AVANT de
    // re-poser une entrée (sinon addCampaign écraserait l'état
    // qu'on veut tester).
    const priorArchive = useCampaignsStore
      .getState()
      .getById(validated.campaignId);
    const isRevalidation = Boolean(
      priorArchive &&
        (priorArchive.publishedChannels.length > 0 ||
          priorArchive.sourcesConfirmed ||
          priorArchive.scoringSheet?.isValidated),
    );

    addCampaign({ fdp: validated });
    useCampaignsStore.getState().recomputeStatus(validated.campaignId);

    // Round 3 — production de la FDP en markdown + upload Supabase
    // Storage. Le fichier apparaît dans le bucket public, lisible
    // depuis l'URL renvoyée. Idempotent côté Storage (upsert) — une
    // revalidation après ajustement écrase la FDP précédente.
    const isTaskOwner = validated.campaignId.startsWith('TASK-');
    const fdpMarkdown = renderFdpMarkdown(validated);
    const fdpFileName = suggestFdpFileName(validated.campaignId);
    const fdpArtifact = useArtifactsStore.getState().addArtifact({
      name: fdpFileName,
      mime: 'text/markdown',
      content: fdpMarkdown,
      kind: 'fdp',
      ...(isTaskOwner
        ? { taskId: validated.campaignId }
        : { campaignId: validated.campaignId }),
    });
    void pushArtifact({
      artifact: fdpArtifact,
      content: fdpMarkdown,
    });

    // Round 3 — label de l'AttachmentChip. On préfère l'intitulé du
    // poste s'il est renseigné, sinon on retombe sur le campaignId.
    const jobTitleVal = validated.fields.job_title?.value;
    const fdpLabel =
      typeof jobTitleVal === 'string' && jobTitleVal.trim().length > 0
        ? `Fiche de poste — ${jobTitleVal.trim()}`
        : `Fiche de poste — ${validated.campaignId}`;
    const fdpAttachment = {
      artifactId: fdpArtifact.id,
      label: fdpLabel,
      fileName: fdpFileName,
      mime: 'text/markdown',
    };

    if (isRevalidation) {
      // Revalidation : la chaîne en aval (channels, flux, scoring)
      // reste valide. On confirme juste la mise à jour ; le DRH
      // continuera depuis le sélecteur s'il veut toucher autre chose.
      const finalStatus =
        useCampaignsStore.getState().getById(validated.campaignId)?.status ??
        'in_progress';
      const tail =
        finalStatus === 'active'
          ? 'La campagne reste active, les CV continuent à être scorés sur la base existante.'
          : 'Tu peux revenir au sélecteur pour ajuster un autre élément si besoin.';
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Fiche de poste mise à jour pour ${validated.campaignId}. ${tail}`,
        attachment: fdpAttachment,
      });
      // Phase 7.4 — chips pour modifier les autres jalons sans
      // repasser par le sélecteur.
      attachResumeChipsToLastBubble(validated.campaignId);
      return;
    }

    // Première validation : post short confirmation with FDP attachment, then advance flow.
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Fiche validée pour ${validated.campaignId}.`,
      attachment: fdpAttachment,
    });
    advanceFlow(validated.campaignId);
  }

  /**
   * Phase 6.1 — Après validation des 4 critères isolated, on NE
   * dispatch PLUS direct le batch CV. À la place :
   *   1. on construit une FDP synthétique depuis les criteria,
   *   2. on demande au serveur une proposition de fiche de scoring,
   *   3. on pose le scoring-sheet-editor pour que le DRH ajuste,
   *   4. la validation de la fiche déclenche le batch (cf.
   *      handleScoringValidate).
   * Fallback : si la proposition serveur échoue, on lance le batch
   * direct sans scoringSheet (mode legacy) pour ne pas bloquer le DRH.
   */
  async function handleValidateIsolated() {
    const current = useIsolatedCriteriaStore.getState().criteria;
    if (!current || !current.isComplete || current.isValidated) return;
    validateIsolated();
    const pending = findPendingByResolvedId(current.taskId);
    if (!pending) return;

    const fdpLike = buildFDPFromIsolatedCriteria(current);
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Critères validés pour ${current.taskId}. Je prépare la fiche de scoring pondérée — elle servira à scorer chaque CV reçu.`,
    });
    setAgentBusy(true);
    try {
      const result = await postManagerScoring({ fdp: fdpLike });
      proposeScoringSheet(current.taskId, result.criteria);
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Voici ma proposition (${result.criteria.length} critères). Ajuste si besoin puis valide pour lancer l'analyse.`,
        block: {
          kind: 'scoring-sheet-editor',
          campaignId: current.taskId,
          confirmed: false,
        },
      });
    } catch (err) {
      // Fallback : on ne bloque pas le DRH, on lance l'analyse sans
      // scoring pondéré (comportement legacy < Phase 6.1).
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Je n'ai pas pu préparer la fiche de scoring (${
          err instanceof Error ? err.message : 'erreur inconnue'
        }).`,
      });
      // Analyse CV en mode tâche isolée retirée (6e) — modalité désactivée en v1
      // (le scoring exige une fiche validée ; câblage à reconstruire, cf. backlog).
    } finally {
      setAgentBusy(false);
    }
  }

  async function handleFilesSelected(files: File[]) {
    if (files.length === 0 || isAgentBusy) return;
    // Phase 6.3 — on ne court-circuite PLUS le route-picker, même
    // quand la campagne courante est validée et que le flux manual
    // est actif. Le DRH doit toujours pouvoir trancher entre tâche
    // isolée et rattachement à une campagne existante (peut être
    // une autre campagne que la courante).
    dispatchCVRouting(files);
  }

  function handleRoutePick(
    pendingId: string,
    route: 'new' | 'existing' | 'isolated' | 'brief',
  ) {
    if (isAgentBusy || isSending || isTranscribing) return;
    // Manager LECTURE SEULE : seule l'analyse de CV contre une campagne
    // EXISTANTE est autorisée. Les routes mutantes (nouvelle campagne, tâche
    // isolée, brief) ne sont plus proposées par le picker et sont ignorées ici
    // par sécurité (les fonctions sous-jacentes seront retirées en Phase 3).
    if (route === 'existing') {
      chooseRouteExisting(pendingId);
    }
  }

  async function handleCampaignPick(pendingId: string, campaignId: string) {
    if (isAgentBusy || isSending || isTranscribing) return;
    setAgentBusy(true);
    try {
      await chooseExistingCampaign(pendingId, campaignId);
    } finally {
      setAgentBusy(false);
    }
  }


  async function sendToManager(history: ChatMessage[]) {
    setSending(true);
    setError(null);
    try {
      // Capture l'état AVANT le tour pour détecter un « fresh start
      // post-flow » : le DRH vient de finir une tâche/campagne dans la
      // même session (chat non trivial, pas de FDP courante) et formule
      // une intention de campagne/tâche neuve. Le serveur ne déclenche
      // pas de switch dialog dans ce cas (input.fdp est null donc la
      // condition côté serveur ne s'active pas) — on wipe côté client
      // après réception pour conserver le comportement « chat propre »
      // promis au DRH (cf. memory/feedback_chat_reset_on_switch.md).
      const messagesBefore = useChatStore.getState().messages;
      const hadFdpBefore = useFdpStore.getState().fdp !== null;
      const triggerUserMessage = findLastUserContent(messagesBefore);
      // Greeting + dernier user message = 2 messages minimum au démarrage
      // d'une session. Au-delà, on est dans un contexte « post-flow »
      // (tâche/campagne précédente dans l'historique).
      const hasPriorFlowHistory = messagesBefore.length > 2;

      const turns = history
        .filter((m) => m.role === 'user' || m.role === 'manager')
        .map((m) => ({
          role: m.role as 'user' | 'manager',
          content: m.content,
        }));
      const result = await postManagerChat({
        messages: turns,
        fdp: useFdpStore.getState().fdp,
      });

      // GARDE déterministe sur la sortie LLM (Inc. 2b) : on n'applique
      // jamais `fieldExtractions` tel quel — on l'assainit contre la liste
      // fermée des 8 champs et les types attendus. `null` si rien de valide.
      const extractions = sanitizeFieldExtractions(result.response.fieldExtractions);
      const hasExtractions = Object.keys(extractions).length > 0;

      // Si le serveur a renvoyé un dialogue de switch, on stocke le
      // payload pour que handleChipSelect puisse l'exploiter au clic.
      // Le payload reste valide tant qu'un nouveau tour Manager n'est
      // pas posté (auquel cas il sera écrasé ou réinitialisé).
      pendingSwitchRef.current = result.pendingSwitch;

      // Fresh start post-flow : le serveur a créé un campaignId, on
      // n'avait pas de FDP, et le chat avait déjà un historique. On
      // wipe pour démarrer la nouvelle campagne sur un chat propre,
      // puis on repose le user message et la réponse Manager.
      const isPostFlowFreshStart =
        !result.pendingSwitch &&
        result.campaignId !== null &&
        !hadFdpBefore &&
        hasPriorFlowHistory &&
        triggerUserMessage !== null;

      if (isPostFlowFreshStart && triggerUserMessage && result.campaignId) {
        wipeForFreshStart();
        createFDP(result.campaignId);
        appendMessage({
          role: 'user',
          source: 'text',
          content: triggerUserMessage,
        });
        if (hasExtractions) {
          applyExtractions(extractions);
        }
        appendMessage({
          role: 'manager',
          source: 'text',
          content: result.response.message,
          chips: result.response.chips,
          proposedExtractions: hasExtractions ? extractions : undefined,
          proposalField: result.response.proposalField,
        });
        return;
      }

      // Chemin nominal : pas de wipe, on applique simplement le
      // campaignId/extractions/message au chat existant.
      if (result.campaignId && !useFdpStore.getState().fdp) {
        createFDP(result.campaignId);
      }
      if (hasExtractions) {
        applyExtractions(extractions);
      }

      appendMessage({
        role: 'manager',
        source: 'text',
        content: result.response.message,
        chips: result.response.chips,
        proposedExtractions: hasExtractions ? extractions : undefined,
        proposalField: result.response.proposalField,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Manager.');
    } finally {
      setSending(false);
    }
  }

  async function sendToManagerIsolated(
    history: ChatMessage[],
    criteria: IsolatedCriteriaInProgress,
  ) {
    setSending(true);
    setError(null);
    try {
      const turns = history
        .filter((m) => m.role === 'user' || m.role === 'manager')
        .map((m) => ({
          role: m.role as 'user' | 'manager',
          content: m.content,
        }));
      const result = await postIsolatedManagerChat({
        messages: turns,
        criteria,
      });
      if (result.response.fieldExtractions) {
        applyIsolatedExtractions(result.response.fieldExtractions);
      }

      // Switch détecté en plein milieu de la pré-collecte isolated :
      // on stocke le payload comme dans sendToManager. Le clic du chip
      // SWITCH_CHIP_NEW déclenchera wipeForFreshStart() qui reset aussi
      // isolated-criteria-store → le flow bascule vers le flow FDP.
      pendingSwitchRef.current = result.pendingSwitch;

      appendMessage({
        role: 'manager',
        source: 'text',
        content: result.response.message,
        chips: result.response.chips,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur Manager.');
    } finally {
      setSending(false);
    }
  }

  async function handleSendText(
    text: string,
    source: 'text' | 'voice' = 'text',
  ) {
    // On commence TOUJOURS par afficher la bulle DRH avant de router
    // vers les sous-flows : sinon, des handlers qui posent une réponse
    // Manager immédiate inversent visuellement l'ordre des bulles et
    // cassent la position des chips (qui ne s'affichent que sur la
    // DERNIÈRE bulle Manager).
    appendMessage({ role: 'user', source, content: text });

    // Cas B : pré-collecte critères isolés via endpoint dédié.
    const isoActive = useIsolatedCriteriaStore.getState().criteria;
    if (isoActive && !isoActive.isValidated) {
      void sendToManagerIsolated(
        useChatStore.getState().messages,
        useIsolatedCriteriaStore.getState().criteria!,
      );
      return;
    }

    // Cas C : conversation normale Manager (collecte FDP, etc.).
    void sendToManager(useChatStore.getState().messages);
  }

  function handleChipSelect(option: string) {
    if (isSending || isTranscribing) return;
    // Pré-remplissage par document — traitement EXPLICITE des pondérations
    // suggérées dans le dialogue (chantier 4 : énoncer ≠ acquérir). Confirmer
    // → suggere:false ; écarter → retrait. Tant que des suggestions restent,
    // le lancement est bloqué (verrou commun du store). Acte léger, un clic.
    if (
      option === PREFILL_CONFIRM_WEIGHTS_LABEL ||
      option === PREFILL_REJECT_WEIGHTS_LABEL
    ) {
      const confirm = option === PREFILL_CONFIRM_WEIGHTS_LABEL;
      dismissLastManagerChips();
      appendMessage({ role: 'user', source: 'text', content: option });
      if (confirm) {
        useScoringStore.getState().confirmAllSuggestions();
      } else {
        useScoringStore.getState().rejectAllSuggestions();
      }
      appendMessage({
        role: 'manager',
        source: 'text',
        content: confirm
          ? "C'est noté — ces pondérations sont validées. On peut compléter la fiche puis la valider quand vous voulez."
          : "Entendu, j'écarte ces pondérations proposées. On repart de la grille de base — on l'ajustera ensemble.",
      });
      return;
    }
    // Phase 7.4.1 / 7.5 — chips "Rouvrir" (closed) ou "Reprendre"
    // (paused) posés sur la bulle de reprise. Le clic rouvre la
    // campagne puis re-pose la bulle Manager avec les chips de
    // modification, pour que le DRH puisse enchaîner sans repasser
    // par le sélecteur.
    const reopenEntry = pendingReopenRef.current;
    if (
      reopenEntry &&
      (option === REOPEN_CHIP_LABEL || option === RESUME_PAUSED_CHIP_LABEL)
    ) {
      pendingReopenRef.current = null;
      handleReopenAndContinue(reopenEntry, option);
      return;
    }
    // Phase 6.2 / 7.2 / 7.4.2 — interception PRIORITAIRE des chips
    // d'options de reprise. Doit passer AVANT isAdjustmentSignal :
    // les libellés commencent par "Modifier"/"Initier"/"Continuer"
    // et certains matchent le keyword d'ajustement vague.
    //
    // Deux chemins de résolution :
    //   1. lookup dans le ref `pendingResumeActionsRef` (chemin
    //      nominal posé par handleSelectCampaign / fin d'étape),
    //   2. fallback `resumeActionFromLabel` qui matche le suffixe
    //      canonique du libellé. Robuste à la perte du ref (re-render,
    //      autre handler qui l'aurait vidé).
    const resumeMap = pendingResumeActionsRef.current;
    if (resumeMap && Object.prototype.hasOwnProperty.call(resumeMap, option)) {
      const action = resumeMap[option]!;
      pendingResumeActionsRef.current = null;
      void handleResumeAction(action, option);
      return;
    }
    const fallbackAction = resumeActionFromLabel(option);
    if (fallbackAction) {
      pendingResumeActionsRef.current = null;
      void handleResumeAction(fallbackAction, option);
      return;
    }
    // Proposition de régénération d'annonce (chips posés par
    // handleFieldAdjust) — le DRH tranche. PRIORITAIRE sur le reste.
    if (pendingRegenRef.current && (option === REGEN_AD_YES || option === REGEN_AD_NO)) {
      const { campaignId } = pendingRegenRef.current;
      pendingRegenRef.current = null;
      dismissLastManagerChips();
      if (option === REGEN_AD_YES) {
        void handleRegenerateAd(campaignId);
      } else {
        appendMessage({
          role: 'manager',
          source: 'text',
          content: "Entendu, je laisse l'annonce en l'état.",
        });
      }
      return;
    }
    // Interception des chips d'annonce/publication et postpone
    if (option === REDIGER_AD_LABEL || option === PUBLISH_AD_LABEL || option === POSTPONE_PHASE_LABEL) {
      const cid = useFdpStore.getState().fdp?.campaignId;
      if (!cid) return;

      if (option === REDIGER_AD_LABEL) {
        appendMessage({
          role: 'user',
          source: 'text',
          content: option,
        });
        const camp = useCampaignsStore.getState().getById(cid);
        if (camp) {
          postAnnouncementStep(cid, camp.fdp);
        }
        return;
      }

      if (option === PUBLISH_AD_LABEL) {
        appendMessage({
          role: 'user',
          source: 'text',
          content: option,
        });
        const pending = pendingPublishRef.current;
        if (pending) {
          void (async () => {
            setAgentBusy(true);
            try {
              for (const channel of pending.channels) {
                const channelLabel = PUBLICATION_CHANNEL_LABELS[channel];
                await dispatchPublisher({ campaignId: pending.campaignId, channel, channelLabel });
              }
              useCampaignsStore.getState().completePhase(pending.campaignId, 'publication');
              advanceFlow(pending.campaignId);
            } finally {
              setAgentBusy(false);
            }
          })();
        }
        return;
      }

      if (option === POSTPONE_PHASE_LABEL) {
        appendMessage({
          role: 'user',
          source: 'text',
          content: option,
        });
        const lifecycle = useCampaignsStore.getState().getById(cid)?.lifecycle;
        if (lifecycle) {
          const step = nextFlowStep(lifecycle);
          if (step.phase === 'announcement') {
            // Both announcement and publication need to be postponed
            useCampaignsStore.getState().postponePhase(cid, 'announcement');
            useCampaignsStore.getState().postponePhase(cid, 'publication');
          } else if (step.phase === 'publication') {
            useCampaignsStore.getState().postponePhase(cid, 'publication');
          }
          appendMessage({
            role: 'manager',
            source: 'text',
            content: "Entendu, on remet ça à plus tard.",
          });
          advanceFlow(cid);
        }
        return;
      }
    }
    if (isAdjustmentSignal(option)) {
      // « Ajuster » édite la SOURCE, EN PLACE sous la bulle, mais UNIQUEMENT
      // le champ que la bulle a proposé ce tour (`proposalField`, déclaré
      // par le LLM) — pas tous les champs extraits. On NE détruit PAS les
      // chips : ils sont masqués pendant l'édition (cf. rendu) pour
      // qu'« Annuler » les restaure.
      const lastManager = [...useChatStore.getState().messages]
        .reverse()
        .find((m) => m.role === 'manager');
      // On décide via editableFieldsForMessage — MÊME source que ce que
      // l'éditeur affichera : impossible que « ouvrable » et « champs à
      // éditer » divergent (le bug précédent). Inclut le filet « champ en
      // cours de collecte » quand la bulle n'a pas d'ancrage explicite.
      const editable = lastManager ? editableFieldsForMessage(lastManager) : [];
      if (editable.length > 0) {
        setEditingMessageId(lastManager!.id);
      } else {
        // FDP complète sans ancrage, ou bulle non-proposition → checklist.
        setExpandChecklistToken((t) => t + 1);
      }
      return;
    }
    // Interception du dialogue de switch déterministe (sub-phase 1.3).
    // Les libellés sont les constantes exportées par manager.ts pour
    // garder le couplage explicite. Hors d'un dialogue de switch
    // (pendingSwitchRef null), on laisse passer les libellés en bulle
    // utilisateur normale — l'utilisateur peut très bien dire « Oui,
    // nouvelle campagne » dans un autre contexte.
    const pendingSwitch = pendingSwitchRef.current;
    if (pendingSwitch && (option === SWITCH_CHIP_NEW || option === SWITCH_CHIP_KEEP)) {
      pendingSwitchRef.current = null;
      void handleSwitchDialogChoice(pendingSwitch, option);
      return;
    }
    // Session 5 — chip « Valider telle quelle » : le Manager vient de
    // rendre la fiche archivée et a extrait les 8 champs d'un coup
    // (MODE RÉUTILISATION L1). Le DRH valide en un geste — on appelle
    // directement handleValidateFDP() sans passer par le LLM, et on
    // pose une bulle user pour préserver la cohérence du fil.
    if (option === REUSE_FDP_VALIDATE_LABEL || option === FDP_VALIDATE_LABEL) {
      const current = useFdpStore.getState().fdp;
      if (current && current.isComplete && !current.isValidated) {
        appendMessage({
          role: 'user',
          source: 'text',
          content: option,
        });
        void handleValidateFDP();
        return;
      }
      // FDP incomplète ou déjà validée : on laisse passer en LLM
      // normal (le Manager s'expliquera).
    }
    // 3ᵉ choix sur une fiche archivée : « Repartir à zéro ». On abandonne
    // l'archive et on reconstruit la fiche depuis le début. On PRÉSERVE
    // l'intitulé du poste (déjà exprimé par le DRH, c'est ce qui a déclenché
    // la recherche) et on remet tous les autres champs à vide, puis on relance
    // un tour Manager : la FDP n'étant plus « toute vide » (job_title rempli),
    // le serveur sort du MODE RÉUTILISATION L1 et passe en MODE PROPOSITION
    // sans reproposer l'archive (cf. isFirstCampaignTurn / manager-prompts).
    if (option === REUSE_FDP_RESET_LABEL) {
      const current = useFdpStore.getState().fdp;
      if (current) {
        appendMessage({ role: 'user', source: 'text', content: option });
        const jobTitle = current.fields.job_title?.value;
        createFDP(current.campaignId);
        if (typeof jobTitle === 'string' && jobTitle.trim().length > 0) {
          applyExtractions({ job_title: jobTitle });
        }
        void sendToManager(useChatStore.getState().messages);
        return;
      }
    }
    void handleSendText(option, 'text');
  }

  /**
   * Consomme le clic sur un chip du dialogue de switch déterministe.
   *
   *   - SWITCH_CHIP_NEW  : on archive la FDP courante dans
   *                        campaigns-store (qu'elle soit draft ou
   *                        validée — campaigns-store accepte les deux),
   *                        puis on WIPE intégralement le chat, la FDP
   *                        et les critères isolés pour repartir d'un
   *                        fil propre. Le dernier message DRH avant
   *                        le chip est réinjecté comme seed pour
   *                        conserver son intention. Le tour Manager
   *                        suivant démarre la collecte sur la nouvelle
   *                        campagne sans pollution de contexte.
   *                        Cf. memory/feedback_chat_reset_on_switch.md.
   *   - SWITCH_CHIP_KEEP : on dismiss simplement le dialogue. La FDP
   *                        courante reste active. On relance UN tour
   *                        Manager pour qu'il revienne sur la collecte
   *                        en cours et reformule sa dernière question.
   */
  async function handleSwitchDialogChoice(
    pending: PendingSwitch,
    option: typeof SWITCH_CHIP_NEW | typeof SWITCH_CHIP_KEEP,
  ): Promise<void> {
    if (option === SWITCH_CHIP_KEEP) {
      // Branche simple : on poste le chip comme bulle user et on
      // relance un tour pour reprendre la collecte courante.
      appendMessage({ role: 'user', source: 'text', content: option });
      void sendToManager(useChatStore.getState().messages);
      return;
    }

    // SWITCH_CHIP_NEW — wipe complet du chat avec seed du dernier
    // message user (l'intention qui a déclenché la bascule). Le
    // helper wipeForFreshStart archive la FDP courante et reset
    // chat/fdp/isolated ; on crée ensuite la nouvelle FDP et on
    // réinjecte le seed pour que le Manager ait l'intention en
    // contexte sans le bruit de l'historique précédent.
    const seedUserMessage = findLastUserContent(
      useChatStore.getState().messages,
    );

    wipeForFreshStart();
    createFDP(pending.proposedCampaignId);

    if (seedUserMessage) {
      appendMessage({
        role: 'user',
        source: 'text',
        content: seedUserMessage,
      });
    }

    void sendToManager(useChatStore.getState().messages);
  }

  /**
   * Phase 3.1 — toggle d'un channel dans le picker multi-select.
   * Met à jour le tableau `selectedChannels` du block via updateMessage.
   * Le picker est gelé une fois `confirmed: true`, donc inopérant.
   */
  function handleChannelToggle(messageId: string, channel: PublicationChannel) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const target = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    if (
      !target ||
      target.block?.kind !== 'publication-channel-picker' ||
      target.block.confirmed
    ) {
      return;
    }
    const currentSelection = target.block.selectedChannels;
    const nextSelection = currentSelection.includes(channel)
      ? currentSelection.filter((c) => c !== channel)
      : [...currentSelection, channel];
    updateMessage(messageId, {
      block: { ...target.block, selectedChannels: nextSelection },
    });
  }

  /**
   * Phase 3.1 — confirmation du picker multi-select. Gèle le block,
   * poste une bulle user récapitulative, puis dispatch SÉQUENTIELLEMENT
   * un Job Writer par channel choisi. La séquence évite de saturer
   * les rate limits et de mélanger les bulles dans le chat.
   *
   * Phase 3.2 — à la fin du loop, on pose le cv-sources-picker avec
   * les channels choisis activés par défaut (+ manual toujours actif).
   */
  async function handleChannelsConfirm(messageId: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const target = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    if (
      !target ||
      target.block?.kind !== 'publication-channel-picker' ||
      target.block.confirmed
    ) {
      return;
    }
    const channels = target.block.selectedChannels;
    if (channels.length === 0) return;
    const pending = pendingChannelPickRef.current;
    if (!pending) return;
    pendingChannelPickRef.current = null;
    // Gèle le picker pour qu'il reste lisible mais inactif.
    updateMessage(messageId, {
      block: { ...target.block, confirmed: true },
    });
    const labels = channels
      .map((c) => PUBLICATION_CHANNEL_LABELS[c])
      .join(', ');
    appendMessage({
      role: 'user',
      source: 'text',
      content:
        channels.length === 1
          ? `Lancer l'annonce ${labels}.`
          : `Lancer les annonces : ${labels}.`,
    });
    setAgentBusy(true);
    try {
      for (const channel of channels) {
        await dispatchJobWriter(pending.fdp, channel);
      }
    } finally {
      setAgentBusy(false);
    }
    // 2c-3 — une annonce a été RÉDIGÉE : on marque seulement la phase
    // 'announcement' comme terminée. La publication devient une phase séparée.
    useCampaignsStore.getState().completePhase(pending.fdp.campaignId, 'announcement');
    // Store channels for the publication step
    pendingPublishRef.current = { campaignId: pending.fdp.campaignId, channels };
    advanceFlow(pending.fdp.campaignId);
  }

  /**
   * Phase 3.2 — toggle d'une source dans le cv-sources-picker.
   * Met à jour le block via updateMessage. Pas de tour LLM. Inactif
   * une fois `confirmed: true` (gardé par le composant + ici).
   */
  function handleSourceToggle(messageId: string, source: CVSource) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const target = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    if (
      !target ||
      target.block?.kind !== 'cv-sources-picker' ||
      target.block.confirmed
    ) {
      return;
    }
    const next = {
      ...target.block.activeSources,
      [source]: !target.block.activeSources[source],
    };
    updateMessage(messageId, {
      block: { ...target.block, activeSources: next },
    });
  }

  /**
   * Phase 3.2.2 — validation de la configuration des flux. Gèle le
   * block (confirmed: true) et poste une bulle Manager récap avec la
   * liste des flux activés. Pas de tour LLM. Le futur Publisher
   * consommera la config validée pour brancher les flux automatiques.
   */
  async function handleSourcesConfirm(messageId: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const target = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    if (
      !target ||
      target.block?.kind !== 'cv-sources-picker' ||
      target.block.confirmed
    ) {
      return;
    }
    const active = (Object.entries(target.block.activeSources) as [
      CVSource,
      boolean,
    ][])
      .filter(([, on]) => on)
      .map(([s]) => s);
    if (active.length === 0) return;
    const campaignId = target.block.campaignId;
    // Round 5 — propage le flag resume du picker vers la suite du
    // workflow (mailbox-picker + décision de poser le scoring).
    const fromResume = target.block.fromResume === true;
    updateMessage(messageId, {
      block: { ...target.block, confirmed: true },
    });
    // Pose RÉELLEMENT les sources choisies (≥1, garanti ci-dessus) : c'est
    // `campaign.sources` qui détermine l'intake. markSourcesConfirmed reste pour
    // le flag legacy (lu par computeProgressSnapshot), mais ne pilote plus la
    // porte d'activation. setSources re-synchronise lifecycle + statut.
    useCampaignsStore.getState().setSources(campaignId, active);
    useCampaignsStore.getState().markSourcesConfirmed(campaignId);
    useCampaignsStore.getState().recomputeStatus(campaignId);
    const activeLabels = active.map((s) => CV_SOURCE_LABELS[s]).join(', ');
    appendMessage({
      role: 'manager',
      source: 'text',
      content:
        active.length === 1
          ? `Configuration validée pour ${campaignId} — flux actif : ${activeLabels}.`
          : `Configuration validée pour ${campaignId} — ${active.length} flux actifs : ${activeLabels}.`,
    });

    // Round 5 — si le DRH a activé `email`, on enchaîne avec le
    // picker de boîte mail. Trois cas :
    //   - au moins 1 boîte configurée → picker visible, on ATTEND la
    //     sélection (handleMailboxPick déclenchera proposeScoringForCampaign)
    //   - 0 boîte configurée → CTA settings + on continue le workflow
    //     (le DRH pourra associer plus tard depuis settings sans
    //     bloquer la suite)
    //   - email non activé → on continue direct
    let deferScoringForMailboxPick = false;
    if (active.includes('email')) {
      let mailboxes: Array<{ id: string; label: string; user_email: string }> = [];
      try {
        const res = await fetch('/api/mailboxes');
        if (res.ok) {
          const data = await res.json();
          mailboxes = data.mailboxes ?? [];
        }
      } catch (err) {
        console.error('[mailbox-picker] fetch failed', err);
      }
      // Wording adapté : en flux initial, le scoring vient ensuite donc
      // on l'annonce. En resume, on s'arrête au mailbox (le DRH décide
      // de la suite via les chips).
      const noMailboxTrailer =
        "Pour activer la réception email, il faut configurer une boîte IMAP — je te laisse l'ajouter depuis la page de configuration." +
        (fromResume ? '' : ' On continue en attendant.');
      appendMessage({
        role: 'manager',
        source: 'text',
        content:
          mailboxes.length > 0
            ? `Tu as ${mailboxes.length === 1 ? 'une boîte' : `${mailboxes.length} boîtes`} configurée${mailboxes.length === 1 ? '' : 's'}. Sur laquelle tu veux que je branche ${campaignId} ?`
            : noMailboxTrailer,
        block: {
          kind: 'mailbox-picker',
          campaignId,
          mailboxes: mailboxes.map((mb) => ({
            id: mb.id,
            label: mb.label,
            email: mb.user_email,
          })),
          selectedMailboxId: null,
          // Round 5 — propage le flag : handleMailboxPick l'utilisera
          // pour décider d'auto-chaîner ou non vers le scoring.
          fromResume,
        },
      });
      if (mailboxes.length > 0) {
        deferScoringForMailboxPick = true;
      }
    }

    // Auto-chain vers le scoring uniquement en flux INITIAL. En resume,
    // le DRH a déjà ses chips de modification et conduit le workflow.
    if (!deferScoringForMailboxPick && !fromResume) {
      advanceFlow(campaignId);
    }
    // En resume, on attache les chips de reprise à la dernière bulle
    // pour que le DRH puisse naviguer vers la suite (sauf si on a
    // posé le mailbox-picker — dans ce cas, c'est handleMailboxPick
    // qui les attachera après la sélection).
    if (fromResume && !deferScoringForMailboxPick) {
      attachResumeChipsToLastBubble(campaignId, 'sources');
    }
  }

  /**
   * Phase 4.3 / Round 5 — déclenche la proposition de fiche de scoring
   * pour la campagne. Extrait de handleSourcesConfirm pour pouvoir
   * être appelé soit immédiatement (pas d'email dans les flux), soit
   * différé (après handleMailboxPick).
   */
  async function proposeScoringForCampaign(campaignId: string): Promise<void> {
    const fdpForScoring = useFdpStore.getState().fdp;
    if (!fdpForScoring || !fdpForScoring.isValidated) return;

    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Je prépare maintenant la fiche de scoring pour ${campaignId} — elle servira au CV Analyzer pour évaluer chaque candidature.`,
    });

    setAgentBusy(true);
    try {
      const result = await postManagerScoring({ fdp: fdpForScoring });
      proposeScoringSheet(campaignId, result.criteria);
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Voici ma proposition (${result.criteria.length} critères répartis sur les niveaux de criticité). Ajuste le libellé, le niveau ou le poids puis valide.`,
        block: {
          kind: 'scoring-sheet-editor',
          campaignId,
          confirmed: false,
        },
      });
      attachResumeChipsToLastBubble(campaignId, 'scoring');
    } catch (err) {
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Je n'ai pas pu préparer la fiche de scoring (${
          err instanceof Error ? err.message : 'erreur inconnue'
        }). Tu peux me redemander dès que tu veux.`,
      });
      attachResumeChipsToLastBubble(campaignId);
    } finally {
      setAgentBusy(false);
    }
  }

  /** Phase 4.3 — ajoute un critère à la fiche de scoring en cours. */
  function handleScoringAdd(input: { label: string; level: ScoringLevel }) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (!scoringSheet || scoringSheet.isValidated) return;
    addScoringCriterion(input);
  }

  /** Phase 4.3 — édite un critère existant (label, niveau, poids). */
  function handleScoringUpdate(
    id: string,
    patch: Partial<Pick<ScoringCriterion, 'label' | 'level' | 'weight'>>,
  ) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (!scoringSheet || scoringSheet.isValidated) return;
    updateScoringCriterion(id, patch);
  }

  /** Phase 4.3 — supprime un critère. */
  function handleScoringRemove(id: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (!scoringSheet || scoringSheet.isValidated) return;
    removeScoringCriterion(id);
  }

  /**
   * Round 5 — association d'une boîte mail à la campagne. Posté
   * par handleSourcesConfirm quand `email` a été activé. La clic
   * envoie l'association à l'API + verrouille le block + bulle de
   * confirmation Manager.
   */
  async function handleMailboxPick(campaignId: string, mailboxId: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const target = useChatStore
      .getState()
      .messages.findLast(
        (m) =>
          m.block?.kind === 'mailbox-picker' &&
          m.block.campaignId === campaignId &&
          m.block.selectedMailboxId === null,
      );
    if (!target || target.block?.kind !== 'mailbox-picker') return;
    const picked = target.block.mailboxes.find((m) => m.id === mailboxId);
    if (!picked) return;
    const fromResume = target.block.fromResume === true;

    // Lock optimiste du block — UI instantané, on rattrape l'erreur
    // serveur en posant une bulle d'erreur si l'API échoue.
    updateMessage(target.id, {
      block: { ...target.block, selectedMailboxId: mailboxId },
    });

    try {
      const res = await fetch(`/api/mailboxes/${mailboxId}/associate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message || `HTTP ${res.status}`);
      }
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Parfait — j'écoute désormais la boîte « ${picked.label} » (${picked.email}) pour ${campaignId}. Les CVs reçus avec l'ID de campagne dans l'objet seront analysés automatiquement.`,
      });
      // 2c-2 — le mailbox-picker faisait partie de la phase Flux ; une
      // fois la boîte associée, on AVANCE la machine (en flux initial).
      // Nouvel ordre : le scoring est déjà fait → l'étape suivante est
      // l'annonce. (On ne gate plus sur la présence d'une fiche de
      // scoring, ce qui bloquait le flux dans le nouvel ordre.)
      if (!fromResume) {
        advanceFlow(campaignId);
      } else {
        // En resume, on rouvre une bulle avec les chips de reprise
        // pour que le DRH puisse choisir l'étape suivante (scoring,
        // FDP, channels…). Sinon l'écran est vide après pick.
        attachResumeChipsToLastBubble(campaignId);
      }
    } catch (err) {
      // Rollback du verrou pour permettre une nouvelle tentative.
      updateMessage(target.id, {
        block: { ...target.block, selectedMailboxId: null },
      });
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `L'association n'a pas pu être enregistrée (${
          err instanceof Error ? err.message : 'erreur inconnue'
        }). Tu peux réessayer ou passer par la page de configuration.`,
      });
    }
  }

  /**
   * Phase 4.3 — validation de la fiche de scoring. Gèle le block
   * éditeur, valide la sheet dans le store, et poste une bulle Manager
   * récap. Le CV Analyzer pondéré (Phase 4.4) consommera la sheet
   * validée sur tous les uploads ultérieurs de la campagne.
   */
  async function handleScoringValidate(messageId: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (!scoringSheet || scoringSheet.isValidated) return;
    const target = useChatStore
      .getState()
      .messages.find((m) => m.id === messageId);
    if (
      !target ||
      target.block?.kind !== 'scoring-sheet-editor' ||
      target.block.confirmed
    ) {
      return;
    }
    const campaignId = target.block.campaignId;
    const criteriaCount = scoringSheet.criteria.length;
    validateScoringSheet();
    updateMessage(messageId, {
      block: { ...target.block, confirmed: true },
    });

    // Phase 6.1 — si on est en mode isolated (criteria active avec
    // taskId === campaignId), la validation de la fiche de scoring
    // déclenche l'analyse des CV en attente (les files sont stockés
    // dans le pending routing résolu par taskId).
    const isolatedNow = useIsolatedCriteriaStore.getState().criteria;
    const isIsolatedFlow =
      isolatedNow !== null &&
      isolatedNow.taskId === campaignId &&
      isolatedNow.isValidated;

    if (isIsolatedFlow) {
      const pending = findPendingByResolvedId(campaignId);
      if (pending) {
        useTasksStore.getState().updateStatus(campaignId, 'active');
        appendMessage({
          role: 'manager',
          source: 'text',
          content: `Fiche de scoring validée pour ${campaignId} — ${criteriaCount} critère${criteriaCount > 1 ? 's' : ''}.`,
        });
        // Analyse CV en mode tâche isolée retirée (6e) — modalité désactivée en v1.
        return;
      }
    }

    // Phase 7.1 — Mode campagne FDP : on sync la sheet validée dans
    // l'archive puis on recompute le status (ne sera 'active' que si
    // FDP validée + annonce publiée + flux confirmés sont aussi en
    // place). Plus de bascule autoritaire à 'active' qui ignorait
    // l'avancement des autres jalons.
    const sheetSnapshot = useScoringStore.getState().sheet;
    if (sheetSnapshot) {
      const archive = useCampaignsStore.getState().getById(campaignId);
      if (archive) {
        useCampaignsStore.getState().addCampaign({
          fdp: archive.fdp,
          scoringSheet: sheetSnapshot,
        });
      }
    }
    useCampaignsStore.getState().recomputeStatus(campaignId);

    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Fiche de scoring validée pour ${campaignId} — ${criteriaCount} critère${criteriaCount > 1 ? 's' : ''}.`,
    });

    advanceFlow(campaignId);
  }

  /**
   * Bascule sur une entrée archivée (campagne FDP ou tâche isolée).
   * On wipe pour démarrer un fil propre (la courante est archivée à
   * son tour via wipeForFreshStart), puis on restaure le snapshot
   * selon son kind et on poste une bulle Manager d'ouverture
   * déterministe (pas de tour LLM — le wording est fixe).
   *
   * Note Session 4 : les artefacts de l'entité restaurée (annonces,
   * rapports CV) ne sont pas re-affichés dans le chat. Ils restent
   * dans artifacts-store, à exposer plus tard.
   */
  function handleSelectCampaign(entry: CampaignEntry) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (!entry.snapshot) return;
    // Manager LECTURE SEULE — sélectionner une campagne = en faire le POINT,
    // jamais la charger pour édition. Plus de wipe/restore (qui amorçaient le
    // cadrage write) ni de chips d'action mutante (reprendre / modifier /
    // rouvrir). Toute modification passe par l'UI déterministe (onglet
    // « Campagnes »). Le récap d'avancement reste une LECTURE.
    pendingResumeActionsRef.current = null;
    pendingReopenRef.current = null;
    const noun = entry.kind === 'fdp' ? 'campagne' : 'sollicitation';
    let recap = '';
    if (entry.kind === 'fdp') {
      const snap = computeProgressSnapshot(entry.id);
      if (snap) recap = `\n\nÉtat actuel :\n${formatProgressRecap(snap)}`;
    }
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Point sur la ${noun} ${entry.id} — ${entry.title} (${CAMPAIGN_STATUS_LABELS[entry.status].toLowerCase()}).${recap}\n\nPour la modifier (fiche, scoring, flux, statut), ouvrez-la dans l'onglet « Campagnes ». Je peux analyser un CV pour cette campagne si vous en déposez un.`,
      chips: {
        placement: 'below_bubble',
        options: ['Analyser un CV', 'Faire un point sur une autre campagne'],
      },
    });
  }

  /**
   * Manager lecture seule — la création passe EXCLUSIVEMENT par l'UI. Le bouton
   * « nouvelle campagne » du sélecteur n'amorce plus de cadrage dans le chat :
   * il oriente vers l'onglet Campagnes (aucune mutation, aucun wipe).
   */
  function handleNewCampaign() {
    if (isSending || isTranscribing || isAgentBusy) return;
    appendMessage({
      role: 'manager',
      source: 'text',
      content:
        "La création d'une campagne se fait dans l'onglet « Campagnes » → « Nouvelle campagne » : vous y cadrez la fiche de poste, le scoring et les flux, puis vous l'activez. Je reste disponible pour faire le point sur une campagne ou analyser un CV.",
      chips: {
        placement: 'below_bubble',
        options: ['Faire un point sur une campagne', 'Analyser un CV'],
      },
    });
  }

  /**
   * Phase 6.2 — actions de reprise après bascule sur une campagne
   * archivée. Selon l'action :
   *   - 'fdp'      : dévalide la FDP courante pour que la checklist
   *                  redevienne éditable. Le DRH ajuste puis revalide.
   *   - 'scoring'  : dévalide la fiche de scoring et repose son
   *                  éditeur dans le chat.
   *   - 'channels' : repose le picker des réseaux de publication.
   *   - 'sources'  : repose le picker des flux de réception CV avec
   *                  une config par défaut (manual seul actif).
   */
  async function handleResumeAction(
    action: ResumeAction,
    /**
     * Libellé exact du chip cliqué — utilisé pour la bulle user de
     * traçabilité. Optionnel : si absent (cas où handleResumeAction
     * est appelé hors chip), on retombe sur "Modifier <noun>".
     */
    clickedLabel?: string,
  ) {
    if (isSending || isTranscribing || isAgentBusy) return;
    const currentFdp = useFdpStore.getState().fdp;
    if (!currentFdp) return;
    const campaignId = currentFdp.campaignId;

    if (action === 'fdp') {
      useFdpStore.getState().invalidateFDP();
      // Phase 7.1 — sync l'archive sur la FDP dévalidée puis
      // recompute. recomputeStatus retournera 'draft' tant que la
      // FDP n'est pas re-validée.
      const archive = useCampaignsStore.getState().getById(campaignId);
      const currentFdpNow = useFdpStore.getState().fdp;
      if (archive && currentFdpNow) {
        useCampaignsStore
          .getState()
          .addCampaign({ fdp: currentFdpNow });
      }
      useCampaignsStore.getState().recomputeStatus(campaignId);
      appendMessage({
        role: 'user',
        source: 'text',
        content: clickedLabel ?? `Modifier ${RESUME_NOUN.fdp}`,
      });
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Très bien, j'ai rouvert la fiche de poste de ${campaignId}. Ajuste les champs dans la checklist en haut, puis re-valide quand tu es prêt.`,
      });
      return;
    }

    if (action === 'scoring') {
      const sheet = useScoringStore.getState().sheet;
      // Si la fiche n'existe pas pour cette campagne, on en demande
      // une nouvelle au serveur (parcours symétrique à handleSourcesConfirm).
      if (!sheet || sheet.campaignId !== campaignId) {
        appendMessage({
          role: 'user',
          source: 'text',
          content: clickedLabel ?? `Modifier ${RESUME_NOUN.scoring}`,
        });
        appendMessage({
          role: 'manager',
          source: 'text',
          content: `Je prépare une nouvelle fiche de scoring pour ${campaignId}.`,
        });
        setAgentBusy(true);
        try {
          const result = await postManagerScoring({ fdp: currentFdp });
          proposeScoringSheet(campaignId, result.criteria);
          appendMessage({
            role: 'manager',
            source: 'text',
            content: `Voici une proposition (${result.criteria.length} critères). Ajuste si besoin puis valide.`,
            block: {
              kind: 'scoring-sheet-editor',
              campaignId,
              confirmed: false,
            },
          });
        } catch (err) {
          appendMessage({
            role: 'manager',
            source: 'text',
            content: `Je n'ai pas pu préparer la fiche (${
              err instanceof Error ? err.message : 'erreur inconnue'
            }). Tu peux me redemander.`,
          });
        } finally {
          setAgentBusy(false);
        }
        return;
      }
      // Sinon on dévalide la fiche existante et on repose l'éditeur.
      useScoringStore.getState().invalidate();
      // Sync l'archive avec la sheet dévalidée + recompute (qui
      // retourne 'in_progress' tant qu'elle n'est pas re-validée).
      const archive = useCampaignsStore.getState().getById(campaignId);
      const invalidated = useScoringStore.getState().sheet;
      if (archive && invalidated) {
        useCampaignsStore.getState().addCampaign({
          fdp: archive.fdp,
          scoringSheet: invalidated,
        });
      }
      useCampaignsStore.getState().recomputeStatus(campaignId);
      appendMessage({
        role: 'user',
        source: 'text',
        content: clickedLabel ?? `Modifier ${RESUME_NOUN.scoring}`,
      });
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `J'ai rouvert la fiche de scoring de ${campaignId} (${sheet.criteria.length} critères). Ajuste puis valide.`,
        block: {
          kind: 'scoring-sheet-editor',
          campaignId,
          confirmed: false,
        },
      });
      return;
    }

    if (action === 'channels') {
      pendingChannelPickRef.current = { fdp: currentFdp };
      appendMessage({
        role: 'user',
        source: 'text',
        content: clickedLabel ?? `Modifier ${RESUME_NOUN.channels}`,
      });
      appendMessage({
        role: 'manager',
        source: 'text',
        content: `Sur quels réseaux veux-tu (re-)publier l'annonce pour ${campaignId} ?`,
        block: {
          kind: 'publication-channel-picker',
          campaignId,
          selectedChannels: [],
          confirmed: false,
        },
      });
      return;
    }

    // 'sources'
    appendMessage({
      role: 'user',
      source: 'text',
      content: clickedLabel ?? `Modifier ${RESUME_NOUN.sources}`,
    });
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `Reconfigure les flux de réception de CV pour ${campaignId}.`,
      block: {
        kind: 'cv-sources-picker',
        campaignId,
        activeSources: buildDefaultSourcesConfig([]),
        confirmed: false,
        // Round 5 — flag resume : à la validation, on n'auto-chaîne
        // PAS vers la fiche de scoring. Le DRH garde le contrôle
        // via les chips de reprise.
        fromResume: true,
      },
    });
  }

  /**
   * Phase 7.5 — clic d'un chip de réouverture (closed → "Rouvrir" ou
   * paused → "Reprendre") posé dans une bulle de reprise. On rouvre
   * la campagne en `in_progress` (recompute la repassera à `active`
   * si tous les jalons sont déjà alignés), puis on repose la bulle
   * Manager avec récap + chips de modification — exactement comme
   * lors d'une reprise normale d'une campagne non-bloquée.
   */
  function handleReopenAndContinue(entry: CampaignEntry, clickedLabel: string) {
    if (isSending || isTranscribing || isAgentBusy) return;
    appendMessage({ role: 'user', source: 'text', content: clickedLabel });
    if (entry.kind === 'fdp') {
      useCampaignsStore.getState().updateStatus(entry.id, 'in_progress');
      useCampaignsStore.getState().recomputeStatus(entry.id);
    } else {
      useTasksStore.getState().updateStatus(entry.id, 'in_progress');
    }
    const resolvedStatus =
      (entry.kind === 'fdp'
        ? useCampaignsStore.getState().getById(entry.id)?.status
        : useTasksStore.getState().getById(entry.id)?.status) ??
      'in_progress';
    const noun = entry.kind === 'fdp' ? 'campagne' : 'sollicitation';
    const verbMsg =
      clickedLabel === REOPEN_CHIP_LABEL
        ? `J'ai rouvert la ${noun} ${entry.id}.`
        : `J'ai repris la ${noun} ${entry.id}.`;
    // Récap + chips de modif pour permettre la continuation immédiate.
    let chips:
      | { placement: 'below_bubble'; options: string[] }
      | undefined;
    let recap = '';
    if (entry.kind === 'fdp') {
      const snap = computeProgressSnapshot(entry.id);
      if (snap) {
        recap = `\n\nÉtat actuel :\n${formatProgressRecap(snap)}`;
        const { options, labelMap } = buildResumeChipPayload(snap);
        pendingResumeActionsRef.current = labelMap;
        chips = { placement: 'below_bubble', options };
      }
    }
    appendMessage({
      role: 'manager',
      source: 'text',
      content: `${verbMsg} Nouveau statut : ${CAMPAIGN_STATUS_LABELS[resolvedStatus].toLowerCase()}.${recap}`,
      chips,
    });
  }

  /**
   * Phase 5.3 — clôture ou réouverture de la campagne courante depuis
   * le sélecteur. La transition est portée par le caller (sélecteur)
   * pour rester explicite : closed → in_progress sur réouverture,
   * tout → closed sur clôture.
   *
   * Effets :
   *   - met à jour le status dans campaigns-store / tasks-store,
   *   - synchronise l'archive (si la courante est dans le store).
   *     C'est le cas standard car le wipe pose toujours une entrée
   *     pour la courante, mais pas si on n'a pas encore basculé.
   *     Dans ce cas on ajoute l'archive maintenant pour rendre
   *     l'action persistante.
   *   - poste une bulle Manager récap.
   */
  function handleCampaignStatusChange(
    entry: CampaignEntry,
    next: CampaignStatus,
  ) {
    if (isSending || isTranscribing || isAgentBusy) return;
    if (entry.kind === 'fdp') {
      // Si la courante est dans fdp-store et pas encore dans campaigns,
      // on l'y pose avant de muter son status (sinon updateStatus est
      // un no-op sur une entrée inexistante).
      const inStore = useCampaignsStore.getState().getById(entry.id);
      if (!inStore && entry.isCurrent) {
        const currentFdp = useFdpStore.getState().fdp;
        const currentScoring = useScoringStore.getState().sheet;
        if (currentFdp && currentFdp.campaignId === entry.id) {
          useCampaignsStore.getState().addCampaign({
            fdp: currentFdp,
            scoringSheet:
              currentScoring && currentScoring.campaignId === entry.id
                ? currentScoring
                : null,
            status: next,
          });
        }
      } else {
        useCampaignsStore.getState().updateStatus(entry.id, next);
      }
    } else {
      const inStore = useTasksStore.getState().getById(entry.id);
      if (!inStore && entry.isCurrent) {
        const currentCriteria =
          useIsolatedCriteriaStore.getState().criteria;
        if (currentCriteria && currentCriteria.taskId === entry.id) {
          useTasksStore.getState().addTask({
            criteria: currentCriteria,
            status: next,
          });
        }
      } else {
        useTasksStore.getState().updateStatus(entry.id, next);
      }
    }
    const noun = entry.kind === 'fdp' ? 'campagne' : 'sollicitation';
    const messages: Record<CampaignStatus, string> = {
      closed: `J'ai marqué la ${noun} ${entry.id} comme terminée. Tu peux la rouvrir à tout moment via le chip ci-dessous.`,
      paused: `J'ai suspendu la ${noun} ${entry.id}. Tu peux la reprendre à tout moment via le chip ci-dessous.`,
      in_progress:
        entry.status === 'paused'
          ? `J'ai repris la ${noun} ${entry.id}. Tu peux poursuivre où on s'est arrêté.`
          : `J'ai rouvert la ${noun} ${entry.id}. Tu peux reprendre où on s'est arrêté.`,
      active: `J'ai remis la ${noun} ${entry.id} en active.`,
      draft: `J'ai remis la ${noun} ${entry.id} en brouillon.`,
    };
    // Phase 7.5.1 — quand on bascule vers paused/closed, on attache
    // le chip de réouverture directement à la bulle de confirmation
    // pour que le DRH n'ait pas à rouvrir le menu kebab. Symétrique au
    // chip posé par handleSelectCampaign à la reprise depuis le
    // dropdown — même handler de clic (handleReopenAndContinue).
    let chips:
      | { placement: 'below_bubble'; options: string[] }
      | undefined;
    if (entry.kind === 'fdp' && (next === 'paused' || next === 'closed')) {
      pendingResumeActionsRef.current = null;
      pendingReopenRef.current = entry;
      chips = {
        placement: 'below_bubble',
        options: [
          next === 'paused'
            ? RESUME_PAUSED_CHIP_LABEL
            : REOPEN_CHIP_LABEL,
        ],
      };
    } else if (
      entry.kind === 'fdp' &&
      (next === 'in_progress' || next === 'active')
    ) {
      // Réouverture depuis le menu : on repose les chips de
      // modification pour offrir la continuation immédiate.
      const snap = computeProgressSnapshot(entry.id);
      if (snap) {
        const { options, labelMap } = buildResumeChipPayload(snap);
        pendingResumeActionsRef.current = labelMap;
        chips = { placement: 'below_bubble', options };
      }
    }
    appendMessage({
      role: 'manager',
      source: 'text',
      content: messages[next],
      chips,
    });
  }

  async function handleTranscribe(audio: File): Promise<string> {
    setTranscribing(true);
    setError(null);
    try {
      return await postTranscribe(audio);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Erreur transcription.';
      setError(message);
      throw err;
    } finally {
      setTranscribing(false);
    }
  }

  return (
    <div className="h-full w-full flex flex-col">
      <ChatHeader onReset={handleReset} />
      {fdp ||
      isolatedCriteria ||
      archivedCampaigns.length > 0 ||
      archivedTasks.length > 0 ? (
        (() => {
          const campaignEntries = buildCampaignEntries({
            currentFdp: fdp,
            currentCriteria: !fdp ? isolatedCriteria : null,
            archivedCampaigns,
            archivedTasks,
          });
          // Round 4 — bandeau « campagne active en attente de flux CV »
          // posé sous le sélecteur quand le statut courant est `active`.
          // Couleur orange (mode alerte douce), pulse synchronisée avec
          // le point du sélecteur.
          const currentEntry =
            campaignEntries.find((e) => e.isCurrent) ?? null;
          const showActiveChip =
            currentEntry !== null && currentEntry.status === 'active';
          return (
            <>
              <CampaignSelector
                campaigns={campaignEntries}
                onSelectCampaign={handleSelectCampaign}
                onNewCampaign={handleNewCampaign}
                onChangeStatus={handleCampaignStatusChange}
                disabled={isSending || isTranscribing || isAgentBusy}
              />
              {showActiveChip && currentEntry ? (
                <ActiveListeningChip
                  campaignId={currentEntry.id}
                  jobTitle={currentEntry.title}
                />
              ) : null}
            </>
          );
        })()
      ) : null}

      {fdp ? (
        <FieldChecklist
          fdp={fdp}
          defaultCollapsed={fdp.campaignId.startsWith('TASK-')}
          editingDisabled={
            fdp.isValidated || isSending || isTranscribing || isAgentBusy
          }
          openFirstMissingToken={openFirstMissingToken}
          expandToken={expandChecklistToken}
          onFieldEdit={handleFieldAdjust}
        />
      ) : null}

      {isolatedCriteria && !fdp ? (
        <IsolatedCriteriaChecklist
          criteria={isolatedCriteria}
          editingDisabled={
            isolatedCriteria.isValidated ||
            isSending ||
            isTranscribing ||
            isAgentBusy
          }
          openFirstMissingToken={openFirstMissingIsolatedToken}
        />
      ) : null}

      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-5 space-y-4"
      >
        {messages.map((message, index) => {
          const isLast = index === messages.length - 1;
          const showBelow =
            isLast &&
            message.role === 'manager' &&
            message.chips?.placement === 'below_bubble' &&
            message.id !== editingMessageId &&
            !isSending &&
            !isTranscribing;
          return (
            <div key={message.id}>
              <ChatBubble
                message={message}
                // Règle B (chat forward-only) : les chips inline ne sont
                // cliquables que sur la DERNIÈRE bulle Manager — une fois
                // l'étape passée, ils se figent (comme below_bubble/above_input).
                showInlineChips={isLast}
                onChipSelect={handleChipSelect}
                chipsDisabled={isSending || isTranscribing}
                onRoutePick={handleRoutePick}
                onCampaignPick={handleCampaignPick}
                onChannelToggle={handleChannelToggle}
                onChannelsConfirm={handleChannelsConfirm}
                onSourceToggle={handleSourceToggle}
                onSourcesConfirm={handleSourcesConfirm}
                scoringSheet={scoringSheet}
                onScoringAdd={handleScoringAdd}
                onScoringUpdate={handleScoringUpdate}
                onScoringRemove={handleScoringRemove}
                onScoringValidate={handleScoringValidate}
                onMailboxPick={handleMailboxPick}
                blocksDisabled={isSending || isTranscribing || isAgentBusy}
                isEditing={message.id === editingMessageId}
                editFields={
                  message.id === editingMessageId
                    ? editableFieldsForMessage(message)
                    : undefined
                }
                onEditSubmit={(edits) =>
                  handleProposalEditSubmit(message.id, edits)
                }
                onEditCancel={handleProposalEditCancel}
              />
              {showBelow && message.chips ? (
                <ChatChips
                  chips={message.chips}
                  onSelect={handleChipSelect}
                  disabled={isSending || isTranscribing}
                />
              ) : null}
            </div>
          );
        })}
        {isSending ? <TypingPreview /> : null}
        {error ? (
          <p className="font-body text-[11.5px] text-red-600 px-1">{error}</p>
        ) : null}
      </div>

      {(() => {
        const last = messages[messages.length - 1];
        if (
          !last ||
          last.role !== 'manager' ||
          last.chips?.placement !== 'above_input' ||
          last.id === editingMessageId ||
          isSending ||
          isTranscribing
        )
          return null;
        return (
          <ChatChips
            chips={last.chips}
            onSelect={handleChipSelect}
            disabled={isSending || isTranscribing}
          />
        );
      })()}

      {fdp ? (
        <ValidateFDPButton
          campaignId={fdp.campaignId}
          isComplete={fdp.isComplete}
          isValidated={fdp.isValidated}
          disabled={isSending || isTranscribing || isAgentBusy}
          onValidate={handleValidateFDP}
          missingCount={countMissing(fdp)}
          onRequestComplete={() =>
            setOpenFirstMissingToken((t) => t + 1)
          }
        />
      ) : null}

      {isolatedCriteria && !fdp ? (
        <ValidateIsolatedCriteriaButton
          taskId={isolatedCriteria.taskId}
          isComplete={isolatedCriteria.isComplete}
          isValidated={isolatedCriteria.isValidated}
          disabled={isSending || isTranscribing || isAgentBusy}
          onValidate={handleValidateIsolated}
          missingCount={countMissingIsolated(isolatedCriteria)}
          onRequestComplete={() =>
            setOpenFirstMissingIsolatedToken((t) => t + 1)
          }
        />
      ) : null}

      <ChatInput
        disabled={isSending || isTranscribing}
        onSendText={handleSendText}
        onTranscribe={handleTranscribe}
        onFilesSelected={handleFilesSelected}
      />
    </div>
  );
}

function ChatHeader({ onReset }: { onReset: () => void }) {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <header
      className="relative flex items-center justify-between gap-3 px-4 py-3.5 border-b border-stone-200 text-white"
      style={{
        background: `linear-gradient(135deg, ${color} 0%, ${color}dd 100%)`,
      }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="relative h-11 w-11 shrink-0 rounded-full overflow-hidden ring-2 ring-white/80 shadow-md"
          style={{ backgroundColor: color }}
        >
          {url ? (
            <Image
              src={url}
              alt="Manager RH"
              fill
              sizes="44px"
              className="object-cover"
            />
          ) : null}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-white"
            aria-hidden
          />
        </div>
        <div className="min-w-0">
          <p className="font-display text-[10px] uppercase tracking-[0.22em] text-white/70 font-medium">
            Conversation
          </p>
          <h2 className="font-display text-[15px] font-semibold leading-tight">
            Manager RH
          </h2>
          <p className="font-body text-[10.5px] text-white/80 mt-0.5 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
            En ligne · prêt à cadrer une demande
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <HeaderIconButton
          ariaLabel="Réinitialiser la conversation"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
        </HeaderIconButton>
      </div>
    </header>
  );
}

function HeaderIconButton({
  ariaLabel,
  onClick,
  children,
}: {
  ariaLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'h-8 w-8 grid place-items-center rounded-lg text-white/85',
        'hover:bg-white/15 hover:text-white transition-colors',
      )}
    >
      {children}
    </button>
  );
}

function TypingPreview() {
  const url = getAvatarUrl(MANAGER_ID);
  const color = getAvatarColor(MANAGER_ID);
  return (
    <div className="chat-msg-rise flex items-end gap-2.5">
      <div
        className="relative h-8 w-8 shrink-0 rounded-full overflow-hidden ring-2 ring-white shadow-sm"
        style={{ backgroundColor: color }}
      >
        {url ? (
          <Image
            src={url}
            alt="Manager RH"
            fill
            sizes="32px"
            className="object-cover"
          />
        ) : null}
      </div>
      <div className="flex flex-col items-start max-w-[78%]">
        <span
          className="font-display text-[11px] font-semibold mb-1 px-1"
          style={{ color }}
        >
          Manager RH
        </span>
        <div
          className="bg-white border border-stone-200 border-l-[3px] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm"
          style={{ borderLeftColor: color }}
        >
          <TypingDots color={color} />
        </div>
      </div>
    </div>
  );
}
