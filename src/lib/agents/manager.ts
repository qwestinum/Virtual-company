/**
 * Orchestration du Manager RH (Session 3 + ajustements feedback).
 *
 * Point d'entrée serveur unique pour un tour de conversation Manager.
 * Coordonne :
 *   1. Classification d'intention (LLM, JSON strict).
 *   2. Application du seuil CLARIFICATION_THRESHOLD.
 *   3. Détection déterministe d'un switch de campagne (sub-phase 1.3).
 *   4. Pré-recherche storage (stub Session 3 — vide).
 *   5. Réponse conversationnelle (LLM, JSON strict) — ou court-circuit
 *      avec dialogue déterministe quand un switch est détecté.
 *
 * Frontière critique : ce module est le SEUL endroit où chat ↔ FDP se
 * coordonnent. Les stores (chat-store, fdp-store) ne se connaissent pas
 * entre eux ; c'est l'API `runManagerTurn` qui les met en cohérence en
 * retournant un payload unique exploité par la route /api/manager/chat.
 */

import { chatComplete } from '@/lib/ai/provider';
import {
  searchExistingJobDescriptions,
  type JobDescription,
} from '@/lib/storage/job-descriptions';
import type { FDPInProgress } from '@/types/field-collection';
import {
  IntentClassificationSchema,
  type Intent,
  type IntentClassification,
} from '@/types/intent';
import {
  ManagerResponseSchema,
  type ManagerResponse,
} from '@/types/manager-response';
import {
  SWITCH_CHIP_KEEP,
  SWITCH_CHIP_NEW,
  type PendingSwitch,
} from '@/types/switch-dialog';

// Re-export pour compat — l'import canonique côté client passe par
// '@/types/switch-dialog' (qui n'embarque pas le bundle serveur).
export {
  SWITCH_CHIP_KEEP,
  SWITCH_CHIP_NEW,
  type PendingSwitch,
} from '@/types/switch-dialog';

import {
  buildConversationalPrompt,
  buildIntentClassificationPrompt,
} from './manager-prompts';

export const MANAGER_AGENT_ID = 'agent.manager-rh';

/**
 * En dessous de ce seuil de confidence, la classification est marquée
 * comme nécessitant une clarification. Le prompt conversationnel est
 * alors instruit à proposer 2-3 chips canoniques (cf. manager-prompts).
 */
export const CLARIFICATION_THRESHOLD = 0.65;

/**
 * Confidence minimale pour déclencher le dialogue déterministe de
 * switch de campagne (sub-phase 1.3). En dessous, on retombe sur le
 * flux normal — laisse le Manager poser une question de clarification
 * au lieu de proposer un switch fragile.
 */
export const SWITCH_DIALOG_THRESHOLD = 0.7;

export type ConversationTurn = {
  role: 'user' | 'manager';
  content: string;
};

export type ManagerTurnInput = {
  history: ConversationTurn[];
  fdp: FDPInProgress | null;
};

export type ManagerTurnMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};

export type ManagerTurnOutput = {
  classification: IntentClassification;
  response: ManagerResponse;
  preSearchHits: JobDescription[];
  /**
   * En sortie : campaignId à ASSOCIER au tour courant (jamais le
   * proposed du switch — celui-ci vit dans pendingSwitch). Si un switch
   * est en attente, campaignId reste celui de la campagne courante,
   * c'est le client qui décidera de basculer ou non.
   */
  campaignId: string | null;
  pendingSwitch: PendingSwitch | null;
  metrics: ManagerTurnMetrics;
};

export class ManagerError extends Error {
  constructor(
    public readonly code:
      | 'invalid_intent_classification'
      | 'invalid_response_json'
      | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'ManagerError';
  }
}

/**
 * Backlog Session 5 : la suite NNN sur 3 chiffres random a un risque
 * de collision non négligeable dès qu'on dépasse une vingtaine de
 * campagnes/tasks la même année (anniversaire ~50 % autour de 35
 * éléments). Acceptable pour le MVP mono-utilisateur Session 3, à
 * remplacer par un compteur monotone Supabase (table sequence par
 * type+année) au moment du câblage storage hybride en Session 5.
 */
export function generateCampaignId(intent: Intent): string {
  const prefix = intent === 'out_of_campaign_task' ? 'TASK' : 'CAMP';
  const year = new Date().getFullYear();
  const seq = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
}

/**
 * Une FDP est « non vide » dès que job_title est rempli. C'est le
 * critère minimal pour considérer qu'on est dans une campagne en cours
 * (pas une coquille vide juste créée). Sert à déclencher le switch
 * dialog uniquement quand il y a vraiment du contexte à protéger.
 */
function fdpHasJobTitle(fdp: FDPInProgress): boolean {
  const jt = fdp.fields.job_title?.value;
  return typeof jt === 'string' && jt.trim().length > 0;
}

function getFdpJobTitle(fdp: FDPInProgress): string {
  const jt = fdp.fields.job_title?.value;
  if (typeof jt === 'string' && jt.trim().length > 0) return jt.trim();
  return fdp.campaignId;
}

/**
 * Construit la réponse Manager déterministe pour le dialogue de switch.
 * Pas de LLM, pas de risque d'hallucination — wording fixe, chips
 * fixes, conforme R1/R2 (audio-mode.md). Le placement below_bubble
 * rend les chips immédiatement visibles sous la bulle.
 *
 * Exporté pour être réutilisé par le flow isolated (manager-isolated.ts),
 * qui détecte aussi un switch quand le DRH bascule en plein milieu
 * d'une pré-collecte de critères.
 */
export function buildSwitchDialogResponse(
  pending: PendingSwitch,
): ManagerResponse {
  const noun = pending.currentCampaignId.startsWith('TASK-')
    ? 'sollicitation'
    : 'campagne';
  const statusPhrase =
    pending.currentStatus === 'validated'
      ? `La ${noun} en cours sur ${pending.currentJobTitle} est déjà validée.`
      : `La ${noun} en cours sur ${pending.currentJobTitle} est encore en draft.`;
  const message = `On dirait que vous démarrez sur un autre poste. ${statusPhrase} On en ouvre une nouvelle, ou vous voulez rester sur ${pending.currentJobTitle} ?`;
  return {
    message,
    chips: {
      placement: 'below_bubble',
      options: [SWITCH_CHIP_NEW, SWITCH_CHIP_KEEP],
    },
  };
}

export async function runManagerTurn(
  input: ManagerTurnInput,
): Promise<ManagerTurnOutput> {
  const lastUserMessage =
    [...input.history].reverse().find((t) => t.role === 'user')?.content ?? '';

  // Si une FDP en cours a un job_title, on le passe au classifier pour
  // qu'il puisse décider isDistinctNewCampaign — la condition stricte
  // de déclenchement du switch dialog (sub-phase 1.3.1). Sans ça, le
  // classifier voit toute la conversation comme "new_campaign" dès
  // qu'on parle de recrutement, et déclenche un switch sur chaque
  // réponse à une question.
  const currentJobTitleForClassifier =
    input.fdp && fdpHasJobTitle(input.fdp)
      ? getFdpJobTitle(input.fdp)
      : undefined;

  const intentSystem = buildIntentClassificationPrompt(
    currentJobTitleForClassifier,
  );
  const conversation = input.history.map((t) => ({
    role: t.role === 'manager' ? ('assistant' as const) : ('user' as const),
    content: t.content,
  }));

  const intentCompletion = await chatComplete({
    jsonMode: true,
    temperature: 0.1,
    messages: [{ role: 'system', content: intentSystem }, ...conversation],
  });

  let classification: IntentClassification;
  try {
    classification = IntentClassificationSchema.parse(
      JSON.parse(intentCompletion.content),
    );
  } catch (err) {
    throw new ManagerError(
      'invalid_intent_classification',
      err instanceof Error ? err.message : 'Unparseable intent JSON.',
    );
  }

  if (classification.confidence < CLARIFICATION_THRESHOLD) {
    classification = { ...classification, needsClarification: true };
  }

  // Détection déterministe du switch de campagne. On court-circuite le
  // tour conversationnel LLM si :
  //   - une FDP existe avec au moins job_title rempli (signal d'une
  //     campagne en cours, pas une coquille vide qu'on viendrait de
  //     créer au tour précédent),
  //   - le DRH formule une nouvelle intention (new_campaign ou
  //     out_of_campaign_task) avec une confidence haute,
  //   - aucune clarification n'est en attente,
  //   - le classifier a marqué isDistinctNewCampaign=true,
  //   - ET le classifier a pu nommer un candidateNewJobTitle concret
  //     dans le dernier message, distinct du courant (case-insensitive).
  //     Garde-fou contre les hallucinations LLM : sur des messages
  //     courts (« ok », « senior »), aucun poste ne peut être nommé,
  //     donc pas de switch même si le booléen était à true par erreur.
  const isCandidateMeaningful =
    typeof classification.candidateNewJobTitle === 'string' &&
    classification.candidateNewJobTitle.trim().length > 0 &&
    (currentJobTitleForClassifier === undefined ||
      classification.candidateNewJobTitle
        .trim()
        .toLowerCase() !==
        currentJobTitleForClassifier.trim().toLowerCase());

  const shouldShowSwitchDialog =
    input.fdp !== null &&
    fdpHasJobTitle(input.fdp) &&
    !classification.needsClarification &&
    classification.confidence >= SWITCH_DIALOG_THRESHOLD &&
    (classification.intent === 'new_campaign' ||
      classification.intent === 'out_of_campaign_task') &&
    classification.isDistinctNewCampaign === true &&
    isCandidateMeaningful;

  if (shouldShowSwitchDialog && input.fdp) {
    const pendingSwitch: PendingSwitch = {
      proposedCampaignId: generateCampaignId(classification.intent),
      currentCampaignId: input.fdp.campaignId,
      currentJobTitle: getFdpJobTitle(input.fdp),
      currentStatus: input.fdp.isValidated ? 'validated' : 'draft',
    };
    return {
      classification,
      response: buildSwitchDialogResponse(pendingSwitch),
      preSearchHits: [],
      campaignId: input.fdp.campaignId,
      pendingSwitch,
      metrics: {
        durationMs: intentCompletion.durationMs,
        tokensUsed: intentCompletion.usage.totalTokens,
        costEstimate: intentCompletion.costEstimate,
      },
    };
  }

  let preSearchHits: JobDescription[] = [];
  if (
    classification.intent === 'new_campaign' &&
    !classification.needsClarification &&
    lastUserMessage.length > 0
  ) {
    preSearchHits = await searchExistingJobDescriptions(lastUserMessage);
  }

  const conversationalSystem = buildConversationalPrompt({
    intent: classification.intent,
    confidence: classification.confidence,
    needsClarification: classification.needsClarification,
    fdp: input.fdp,
    preSearchHits,
  });

  // Le tour conversationnel passe sur gpt-4o (vs gpt-4o-mini pour la
  // classification) car il doit suivre un prompt à instructions denses
  // (mode proposition, double écriture fieldExtractions/message, chips
  // selon nature du champ). gpt-4o-mini omettait des extractions
  // critiques en démo. Coût ≈ 5-15× supérieur — acceptable pour le MVP
  // démo, à reconsidérer en Session 5+ si volume.
  const responseCompletion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: conversationalSystem },
      ...conversation,
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(responseCompletion.content);
  } catch (err) {
    throw new ManagerError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable response JSON.',
    );
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.chips === null) delete r.chips;
    if (r.fieldExtractions === null) delete r.fieldExtractions;
  }
  let response: ManagerResponse;
  try {
    response = ManagerResponseSchema.parse(raw);
  } catch (err) {
    throw new ManagerError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Manager response shape invalid.',
    );
  }

  const campaignId =
    !input.fdp &&
    !classification.needsClarification &&
    (classification.intent === 'new_campaign' ||
      classification.intent === 'out_of_campaign_task')
      ? generateCampaignId(classification.intent)
      : (input.fdp?.campaignId ?? null);

  return {
    classification,
    response,
    preSearchHits,
    campaignId,
    pendingSwitch: null,
    metrics: {
      durationMs:
        intentCompletion.durationMs + responseCompletion.durationMs,
      tokensUsed:
        intentCompletion.usage.totalTokens +
        responseCompletion.usage.totalTokens,
      costEstimate:
        intentCompletion.costEstimate + responseCompletion.costEstimate,
    },
  };
}
