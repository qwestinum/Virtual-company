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

import { isAdjustmentSignal } from '@/components/chat/adjustment-signal';
import {
  buildCampaignFollowupResponse,
  buildReportingResponse,
  type ReportingSnapshot,
} from '@/lib/agents/manager-reporting';
import { chatComplete } from '@/lib/ai/provider';
import {
  searchExistingJobDescriptions,
  type JobDescription,
} from '@/lib/storage/job-descriptions';
import {
  ContractTypeSchema,
  FIELD_KEYS,
  SenioritySchema,
  type FDPInProgress,
  type FieldKey,
} from '@/types/field-collection';
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
  /**
   * Chargeur paresseux des données de reporting (campagnes + journal).
   * Invoqué UNIQUEMENT pour les intentions `campaign_followup` /
   * `reporting_request` — aucune requête DB sur les tours de collecte.
   * Renvoie null si la persistance n'est pas configurée → réponse
   * dégradée. Injecté par la route (découple le Manager de Supabase).
   */
  loadReportingSnapshot?: () => Promise<ReportingSnapshot | null>;
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
 * Mots-clés qui dénotent SANS AMBIGUÏTÉ une intention de bascule
 * formulée par le DRH (« en fait je veux lancer une campagne »,
 * « ouvre-moi une nouvelle tâche », « passe sur autre chose »).
 *
 * Sert de fallback côté serveur quand le classifier renvoie
 * `isDistinctNewCampaign: true` mais `candidateNewJobTitle: null`
 * (cas où le DRH exprime l'intention sans nommer le poste cible).
 * Sans ce fallback, le garde-fou anti-hallucination (qui exige un
 * candidate concret) bloquerait à tort cette intention légitime.
 *
 * Volontairement restrictif : on ne match QUE des verbes/locutions
 * d'action métier suffisamment spécifiques pour que des messages
 * courts comme « ok » ou « senior » ne déclenchent jamais.
 */
// Les patterns évitent `\b` quand un mot commence par un caractère
// accentué (JS regex \b est ASCII-only par défaut). On utilise
// `(?:^|\W)` pour la frontière initiale dans ces cas.
const SWITCH_INTENT_KEYWORDS = [
  /\bcampagne(?!\s+(?:actuelle|en\s+cours|courante|pr[ée]c[ée]dente))/i,
  /\b(lance|lancer|ouvre|ouvrir|d[ée]marre|d[ée]marrer|initier|cr[ée]er|cr[ée]e)\s+(?:(?:une|un)\s+)?(?:nouvelle\s+)?(?:campagne|t[âa]che|sollicitation|recrutement)\b/i,
  /\bnouvelle\s+(?:campagne|t[âa]che|sollicitation|recrutement)\b/i,
  /(?:^|\W)(en\s+fait|finalement|plut[ôo]t|[àa]\s+la\s+place|au\s+lieu)(?:\W|$)/i,
  /\bautre\s+(?:poste|recrutement|campagne|t[âa]che|profil)\b/i,
  /\babandonn(?:er|e|ons)\b/i,
];

/**
 * Vrai si le message contient au moins un mot-clé explicite de
 * bascule. Utilisé comme fallback quand le classifier dit
 * `isDistinctNewCampaign: true` sans pouvoir nommer un poste cible.
 */
export function hasSwitchIntentKeyword(message: string): boolean {
  return SWITCH_INTENT_KEYWORDS.some((re) => re.test(message));
}

/**
 * Mots-clés qui dénotent une demande d'éclaircissement du DRH
 * (« explique-moi », « pourquoi », « précise »). Dans ce cas, le
 * Manager peut répondre en prose libre sans chips — c'est la seule
 * exception à la règle « chips toujours présents ».
 *
 * Volontairement restrictif : on ne match QUE des formulations
 * d'interrogation/explication. Les phrases longues n'activent pas
 * automatiquement le mode éclaircissement (le DRH peut décrire un
 * contexte sans demander d'explication).
 */
// Patterns avec frontière `(?:^|\W)` pour les mots à initiale
// accentuée (éclaire, éclaircissement) — `\b` ASCII échoue sur eux.
const CLARIFICATION_REQUEST_KEYWORDS = [
  /\bexplique(?:-moi|s|z)?\b/i,
  /\bpourquoi\b/i,
  /\bcomment\s+(?:ça\s+marche|ça\s+fonctionne|tu\s+(?:fais|gères?))\b/i,
  /\bqu['']est-ce\s+que\b/i,
  /\bc['']est\s+quoi\b/i,
  /\bje\s+(?:ne\s+)?comprends?\s+pas\b/i,
  /\bpr[ée]cise(?:-moi|s|z)?\b/i,
  /\bd[ée]taille(?:-moi|s|z)?\b/i,
  /(?:^|\W)[ée]claire(?:-moi|s|z)?(?:\W|$)/i,
  /(?:^|\W)[ée]claircis(?:sement)?\b/i,
  /\bclarifie(?:-moi|s|z)?\b/i,
];

export function hasClarificationRequestKeyword(message: string): boolean {
  return CLARIFICATION_REQUEST_KEYWORDS.some((re) => re.test(message));
}

/**
 * Libellés canoniques des chips fallback injectés par le garde-fou
 * `ensureChipsPresent` quand le LLM oublie d'en proposer en MODE
 * PROPOSITION. Conformes R2 (audio-mode.md) : courts, énonçables,
 * distincts à l'oreille.
 *
 * - `Continuer` : validation implicite. Le DRH accepte la proposition
 *   courante telle quelle et le Manager enchaîne sur le champ suivant.
 *   Comportement côté LLM au tour suivant : il interprète « Continuer »
 *   comme une acceptation implicite (cf. règle d'acceptation implicite
 *   dans le prompt isolated).
 * - `Ajuster` : signal d'ajustement vague — handleChipSelect côté
 *   client le détecte via isAdjustmentSignal et dismiss les chips
 *   pour laisser la main au textarea (pas de tour LLM).
 */
export const FALLBACK_CHIP_CONTINUE = 'Continuer';
export const FALLBACK_CHIP_ADJUST = 'Ajuster';

/**
 * Valeurs des enums FERMÉS (séniorité, type de contrat), normalisées en
 * minuscules. Sert à reconnaître un tour de proposition de champ
 * canonique (chips below_bubble) à ses VALEURS — ce qui exclut
 * nativement le récap final, le dialogue de switch et la pré-recherche
 * (leurs libellés ne sont jamais des valeurs d'enum).
 */
const CANONICAL_ENUM_VALUES: ReadonlySet<string> = new Set(
  [...SenioritySchema.options, ...ContractTypeSchema.options].map((v) =>
    v.toLowerCase(),
  ),
);

/**
 * `true` si ce set de chips propose un champ à options canoniques
 * (séniorité ou type de contrat) : tous les chips non-ajustement sont
 * des valeurs d'enum fermé. Robuste à la casse.
 */
function isCanonicalFieldChipSet(options: string[]): boolean {
  const presets = options.filter((o) => !isAdjustmentSignal(o));
  return (
    presets.length > 0 &&
    presets.every((o) => CANONICAL_ENUM_VALUES.has(o.trim().toLowerCase()))
  );
}

/**
 * Garde-fou DÉTERMINISTE : toute PROPOSITION DE CHAMP doit offrir un
 * chemin « Ajuster », même si le LLM l'oublie. Deux familles de tours :
 *   - champ libre → placement "inline" (salary_range, start_date,
 *     missions, skills) ;
 *   - champ à options canoniques → placement "below_bubble" dont les
 *     options sont des valeurs d'enum fermé (seniority, contract_type),
 *     reconnu par `isCanonicalFieldChipSet`.
 *
 * Sans ce filet, le DRH reste enfermé dans les presets (« Plus haut »,
 * « junior/confirmé/senior »…) sans pouvoir saisir SA propre valeur.
 * Règles :
 *   - ne touche QUE ces deux familles (les autres below_bubble — récap,
 *     switch, pré-recherche — gardent leur sémantique) ;
 *   - no-op si un signal d'ajustement est déjà présent (« Ajuster »,
 *     « Autre »… via isAdjustmentSignal) ;
 *   - sinon ajoute « Ajuster » en DERNIER, plafond 5 options respecté
 *     (on évince le dernier preset si besoin).
 */
export function ensureAdjustChip<
  T extends { chips?: { placement: string; options: string[] } },
>(response: T): T {
  const chips = response.chips;
  if (!chips) return response;
  const targetsFieldProposal =
    chips.placement === 'inline' ||
    (chips.placement === 'below_bubble' &&
      isCanonicalFieldChipSet(chips.options));
  if (!targetsFieldProposal) return response;
  if (chips.options.some((o) => isAdjustmentSignal(o))) return response;
  // Plafond schéma = 5 options. Si déjà plein, on évince le dernier
  // preset pour faire place au chip d'ajustement (qui prime).
  const kept = chips.options.slice(0, 4);
  return {
    ...response,
    chips: { ...chips, options: [...kept, FALLBACK_CHIP_ADJUST] },
  };
}

/**
 * Garde-fou anti-régression : si le LLM oublie d'inclure des chips
 * dans sa réponse (en MODE PROPOSITION normalement obligatoire), on
 * injecte une paire fallback `Continuer / Ajuster` placement
 * above_input. Exception : si le dernier message DRH est une demande
 * d'éclaircissement explicite, on laisse passer sans chips — le
 * Manager peut alors répondre en prose libre.
 *
 * Note R2 : libellés courts et distincts à l'écoute. Le DRH peut
 * cliquer (UI) ou dire « continuer »/« ajuster » (audio).
 */
export function ensureChipsPresent(
  response: ManagerResponse,
  lastUserMessage: string,
): ManagerResponse {
  if (response.chips) return response;
  if (hasClarificationRequestKeyword(lastUserMessage)) return response;
  return {
    ...response,
    chips: {
      placement: 'above_input',
      options: [FALLBACK_CHIP_CONTINUE, FALLBACK_CHIP_ADJUST],
    },
  };
}

/** Premier champ de l'ordre canonique de collecte encore non rempli. */
function firstIncompleteField(fdp: FDPInProgress): FieldKey | null {
  for (const key of FIELD_KEYS) {
    if (fdp.fields[key]?.status !== 'filled') return key;
  }
  return null;
}

/**
 * Le DERNIER champ extrait dans l'ordre canonique. En double-écriture (le LLM
 * extrait la réponse du DRH ET propose le prochain champ par défaut), le champ
 * PROPOSÉ — celui que vise « Ajuster » — est ajouté en dernier dans l'ordre de
 * collecte. C'est donc lui, pas le premier champ incomplet (qui est celui que
 * le DRH vient de remplir → décalage d'un cran).
 */
function lastCanonicalField(keys: FieldKey[]): FieldKey | null {
  let last: FieldKey | null = null;
  for (const key of FIELD_KEYS) {
    if (keys.includes(key)) last = key;
  }
  return last;
}

/**
 * Seuil au-delà duquel un tour est un RÉCAP (dump complet : RÉUTILISATION L1 ou
 * le DRH a tout donné d'un coup) et non une proposition incrémentale. Une
 * collecte champ par champ émet ≤ ~4 extractions ; un récap en émet 7-8.
 */
const RECAP_EXTRACTION_THRESHOLD = 7;

/**
 * Garde-fou DÉTERMINISTE : « Ajuster » a besoin d'un champ cible
 * (`proposalField`) pour ouvrir l'éditeur en place. Le LLM est censé le
 * renseigner en MODE PROPOSITION (cf. prompt), mais il l'oublie — typiquement
 * sur les champs longs (missions / compétences), souvent EN MÊME TEMPS que les
 * chips, ce qui fait retomber la réponse sur la paire fallback `above_input`
 * (« le bandeau blanc séparé »). Sans `proposalField`, le clic « Ajuster » ne
 * sait pas quoi éditer et déplie la checklist au lieu d'ouvrir l'éditeur — d'où
 * l'impression qu'« Ajuster ne fait rien ».
 *
 * On ANCRE donc `proposalField` quand il manque, sur une PROPOSITION DE CHAMP,
 * en visant le champ PROPOSÉ = le DERNIER champ extrait dans l'ordre canonique
 * (la double-écriture ajoute le prochain défaut en dernier). Repli sur le
 * premier champ à collecter si aucune extraction. NB : on NE prend PAS le
 * premier champ incomplet — ce serait celui que le DRH vient de remplir, soit un
 * décalage d'un cran par rapport au champ que la bulle propose.
 * On NE touche PAS :
 *   - une réponse déjà ancrée (`proposalField` présent) ;
 *   - un RÉCAP (multi-édition voulue) : FDP complète (récap final) ou dump
 *     complet (≥ 7 extractions : RÉUTILISATION L1 / DRH a tout donné) ;
 *   - une réponse sans chips (prose libre / demande d'éclaircissement) ;
 *   - une réponse hors collecte FDP (pas de FDP).
 *
 * Doctrine « le LLM propose, le code verrouille » : « Ajuster » ne dépend plus
 * de la mémoire du LLM.
 */
export function ensureProposalAnchor(
  response: ManagerResponse,
  fdp: FDPInProgress | null,
): ManagerResponse {
  if (response.proposalField) return response;
  if (!fdp || !response.chips) return response;
  const extracted = Object.keys(response.fieldExtractions ?? {}) as FieldKey[];
  // RÉCAP (multi-édition voulue → PAS d'ancrage) : RÉCAP FINAL (FDP complète) ou
  // dump complet (RÉUTILISATION L1 / DRH a tout donné). Le compte d'extractions
  // NE suffit PAS à lui seul à distinguer un récap d'une proposition, car la
  // double-écriture émet aussi ≥ 2 extractions — d'où le seuil élevé.
  if (fdp.isComplete || extracted.length >= RECAP_EXTRACTION_THRESHOLD) {
    return response;
  }
  // Proposition : on ancre sur le champ PROPOSÉ = le dernier champ extrait dans
  // l'ordre canonique (a′). Repli sur le premier champ à collecter si aucune
  // extraction (le LLM a posé une question sans proposer de valeur).
  const target = lastCanonicalField(extracted) ?? firstIncompleteField(fdp);
  if (!target) return response; // FDP complète → rien à proposer
  return { ...response, proposalField: target };
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

/**
 * Réponse DÉTERMINISTE au démarrage d'un recrutement quand AUCUN poste
 * n'est précisé (« je veux un recrutement »). Aucun appel LLM, aucune
 * pré-recherche → il est IMPOSSIBLE de produire la réponse absurde
 * « je n'ai pas trouvé de fiche de poste » : on demande simplement
 * l'intitulé. C'est le verrou côté serveur, plus fiable qu'une consigne
 * de prompt. Pas de chips : question ouverte (le DRH saisit le poste),
 * couverte par l'exception « demande d'éclaircissement ».
 */
export function buildAskRoleResponse(): ManagerResponse {
  return {
    message:
      "Avec plaisir, on lance un recrutement. Pour quel poste ? Donnez-moi l'intitulé et je prépare la fiche de poste avec vous.",
  };
}

/**
 * Réponse DÉTERMINISTE pour l'intention `other` (salutations, hors-sujet,
 * demande non RH). Sans ce garde, ces messages traversaient le prompt de
 * collecte FDP et le LLM pouvait répondre à côté (tenter de collecter des
 * champs sur un « bonjour »). On recadre brièvement vers la mission RH,
 * avec des chips d'amorçage. Pas de LLM → pas de dérive.
 */
export function buildOtherIntentResponse(): ManagerResponse {
  return {
    message:
      "Je suis votre Manager RH — je vous accompagne sur vos recrutements. Souhaitez-vous lancer un recrutement, ou faire un point sur une campagne en cours ?",
    chips: {
      placement: 'below_bubble',
      options: ['Lancer un recrutement', 'Faire un point sur une campagne'],
    },
  };
}

/**
 * Réponse DÉTERMINISTE pour l'intention `out_of_campaign_task`.
 *
 * Le mode « sollicitation hors campagne » (TASK-XXXX, livrables atomiques) est
 * hors périmètre produit de la v1 : tout le flux isolé en aval (collecte de
 * critères isolés, analyse CV sans fiche) est conservé dans le code mais rendu
 * inatteignable. Quand le classifier détecte cette intention, on redirige
 * poliment vers la création d'une campagne — une seule phrase, sans excuse ni
 * promesse de roadmap. Pas de LLM → pas de dérive (registre « le LLM propose,
 * le code verrouille »).
 */
export function buildOutOfCampaignUnavailableResponse(): ManagerResponse {
  return {
    message:
      "Le traitement de demandes ponctuelles hors campagne n'est pas disponible pour le moment ; lançons une campagne de recrutement pour cadrer votre besoin.",
    chips: {
      placement: 'below_bubble',
      options: ['Lancer un recrutement', 'Faire un point sur une campagne'],
    },
  };
}

/**
 * Réponse DÉTERMINISTE d'ORIENTATION pour la création de campagne.
 *
 * Refonte « Manager lecture seule » : le Manager n'initie ni ne conduit PLUS
 * aucun cadrage write (création/édition de campagne). Toute intention
 * `new_campaign` est redirigée vers l'UI déterministe, qui est le SEUL endroit
 * où l'on crée une campagne. Le Manager SAIT, ANALYSE, ORIENTE — il n'agit pas.
 * Le wording de navigation sera adossé à la cartographie produit (Phase 4) ;
 * en l'état il pointe vers l'entrée réelle de l'interface.
 */
export function buildCreationRedirectResponse(): ManagerResponse {
  return {
    message:
      "Je ne crée pas les campagnes moi-même — c'est vous qui gardez la main. Pour en lancer une : onglet « Campagnes » → « Nouvelle campagne ». Vous y cadrez la fiche de poste, le scoring et les flux, puis vous l'activez. Je reste là pour faire le point sur vos campagnes ou analyser un CV.",
    chips: {
      placement: 'below_bubble',
      options: ['Faire un point sur une campagne', 'Analyser un CV'],
    },
  };
}

/**
 * Filet anti-bulle-vide. Le schéma autorise un message d'espaces
 * (`min(1)`) ; un message blanc afficherait une bulle vide côté chat.
 * On le remplace par une relance neutre — universel, appliqué à TOUTE
 * réponse LLM.
 */
export function ensureNonEmptyMessage(response: ManagerResponse): ManagerResponse {
  if (response.message.trim().length > 0) return response;
  return {
    ...response,
    message:
      "Je n'ai pas saisi votre demande — pouvez-vous reformuler en une phrase ?",
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

  // VERROU DÉTERMINISTE — `out_of_campaign_task` désactivé en v1. On court-circuite
  // AVANT toute logique de switch / création de TASK / tour conversationnel :
  // redirection polie vers la création de campagne. Tout le flux isolé en aval
  // reste dans le code mais devient inatteignable (non-destructif).
  if (classification.intent === 'out_of_campaign_task') {
    return {
      classification,
      response: buildOutOfCampaignUnavailableResponse(),
      preSearchHits: [],
      campaignId: input.fdp?.campaignId ?? null,
      pendingSwitch: null,
      metrics: {
        durationMs: intentCompletion.durationMs,
        tokensUsed: intentCompletion.usage.totalTokens,
        costEstimate: intentCompletion.costEstimate,
      },
    };
  }

  // VERROU « Manager lecture seule » — l'intention `new_campaign` ne déclenche
  // PLUS aucun cadrage write (collecte FDP, création, scoring, flux, annonce).
  // On ORIENTE vers l'UI déterministe, seul endroit où une campagne se crée.
  // Tout le flux de collecte/proposition en aval (switch dialog, cold-start,
  // pré-recherche, tour conversationnel) devient inatteignable — CONSERVÉ pour
  // l'instant (nettoyage Phase 3), non-destructif. Le drapeau `: boolean`
  // (et non `true` littéral) est VOLONTAIRE : il empêche TypeScript de réduire
  // `intent` à `never` dans la suite, ce qui permet de garder le tail mort mais
  // compilable jusqu'à sa suppression en Phase 3.
  const MANAGER_READ_ONLY: boolean = true;
  if (MANAGER_READ_ONLY && classification.intent === 'new_campaign') {
    return {
      classification,
      response: buildCreationRedirectResponse(),
      preSearchHits: [],
      campaignId: null,
      pendingSwitch: null,
      metrics: {
        durationMs: intentCompletion.durationMs,
        tokensUsed: intentCompletion.usage.totalTokens,
        costEstimate: intentCompletion.costEstimate,
      },
    };
  }

  // Détection déterministe du switch de campagne. On court-circuite le
  // tour conversationnel LLM si :
  //   - une FDP existe avec au moins job_title rempli,
  //   - le DRH formule une nouvelle intention (new_campaign ou
  //     out_of_campaign_task) avec une confidence haute,
  //   - aucune clarification n'est en attente,
  //   - le classifier a marqué isDistinctNewCampaign=true,
  //   - ET un signal concret de bascule existe, sous une des deux
  //     formes admises :
  //       a) candidateNewJobTitle nommé et différent du courant
  //          (case-insensitive) — chemin nominal,
  //       b) candidate absent mais le message contient un mot-clé
  //          explicite de bascule (« en fait je veux lancer une
  //          campagne », « ouvre une nouvelle tâche ») — chemin
  //          fallback pour ne pas bloquer une intention claire
  //          formulée sans poste cible.
  //     Sans ces signaux, on bloque (garde-fou anti-hallucination :
  //     sur « ok » ou « senior », le LLM peut mettre le booléen à
  //     true à tort mais ni le candidate ni le keyword ne seraient là).
  const isCandidateMeaningful =
    typeof classification.candidateNewJobTitle === 'string' &&
    classification.candidateNewJobTitle.trim().length > 0 &&
    (currentJobTitleForClassifier === undefined ||
      classification.candidateNewJobTitle
        .trim()
        .toLowerCase() !==
        currentJobTitleForClassifier.trim().toLowerCase());

  const hasExplicitKeyword = hasSwitchIntentKeyword(lastUserMessage);

  // Deux chemins admis pour déclencher le switch (avec les pré-requis
  // communs : FDP non vide + intent campagne/tâche à confidence haute) :
  //   a) le LLM signale isDistinctNewCampaign=true ET un candidate
  //      concret existe (chemin nominal, le plus précis),
  //   b) le dernier message contient un MOT-CLÉ explicite de bascule
  //      (« lancer une nouvelle campagne », « en fait », « plutôt »…) ;
  //      ce signal est définitif et n'a pas besoin de l'approbation du
  //      LLM — il est volontairement spécifique pour ne pas matcher
  //      les réponses courantes de collecte.
  const shouldShowSwitchDialog =
    input.fdp !== null &&
    fdpHasJobTitle(input.fdp) &&
    !classification.needsClarification &&
    classification.confidence >= SWITCH_DIALOG_THRESHOLD &&
    classification.intent === 'new_campaign' &&
    (hasExplicitKeyword ||
      (classification.isDistinctNewCampaign === true &&
        isCandidateMeaningful));

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

  // VERROU DÉTERMINISTE — intention `other` (salutation, hors-sujet).
  // Manager lecture seule : plus de collecte FDP du tout, donc plus d'exception
  // « aparté en pleine collecte » (qui faisait tourner le tour conversationnel).
  // On recadre TOUJOURS vers la mission RH (point campagne / analyse CV).
  if (classification.intent === 'other') {
    return {
      classification,
      response: buildOtherIntentResponse(),
      preSearchHits: [],
      campaignId: null,
      pendingSwitch: null,
      metrics: {
        durationMs: intentCompletion.durationMs,
        tokensUsed: intentCompletion.usage.totalTokens,
        costEstimate: intentCompletion.costEstimate,
      },
    };
  }

  // SUIVI / REPORTING — réponses déterministes alimentées par les
  // données réelles (campagnes + journal), pas par le LLM. On charge le
  // snapshot paresseusement (aucune requête DB sur les tours de collecte).
  if (
    classification.intent === 'campaign_followup' ||
    classification.intent === 'reporting_request'
  ) {
    const snapshot = input.loadReportingSnapshot
      ? await input.loadReportingSnapshot().catch(() => null)
      : null;
    const response =
      classification.intent === 'reporting_request'
        ? buildReportingResponse(snapshot)
        : buildCampaignFollowupResponse(snapshot, lastUserMessage);
    return {
      classification,
      response,
      preSearchHits: [],
      campaignId: input.fdp?.campaignId ?? null,
      pendingSwitch: null,
      metrics: {
        durationMs: intentCompletion.durationMs,
        tokensUsed: intentCompletion.usage.totalTokens,
        costEstimate: intentCompletion.costEstimate,
      },
    };
  }

  // VERROU DÉTERMINISTE — démarrage de recrutement SANS poste précisé.
  // On ne lance NI la pré-recherche NI le tour conversationnel : on
  // demande d'abord l'intitulé, par une réponse fixe. Sans ce garde, le
  // LLM annonçait « je n'ai pas trouvé de fiche de poste » sur « je veux
  // un recrutement » — absurde puisqu'aucun poste n'est encore nommé.
  const isColdStartNoFdp =
    input.fdp === null || !fdpHasJobTitle(input.fdp);
  if (
    classification.intent === 'new_campaign' &&
    !classification.needsClarification &&
    isColdStartNoFdp &&
    !classification.specifiedRole
  ) {
    return {
      classification,
      response: buildAskRoleResponse(),
      preSearchHits: [],
      campaignId: input.fdp?.campaignId ?? null,
      pendingSwitch: null,
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
    const rawHits = await searchExistingJobDescriptions(lastUserMessage);
    // Dédup par intitulé normalisé : si la base contient 3 FDPs
    // « Comptable » archivées sur la même période, le Manager n'a aucun
    // intérêt à en lister 3 — il en mentionne UNE (la plus récente,
    // donc la première de la liste retournée triée par archived_at desc).
    // En round 1 on n'a pas d'UX L2 multi-fiches, donc la dédup
    // simplifie aussi le wording côté prompt.
    const seenTitles = new Set<string>();
    preSearchHits = [];
    for (const hit of rawHits) {
      const key = hit.title.trim().toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      preSearchHits.push(hit);
    }
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

  // Garde-fou Phase 2 : si le LLM a oublié ses chips alors qu'on est
  // en MODE PROPOSITION, on injecte une paire fallback. Exception :
  // demande explicite d'éclaircissement par le DRH (le Manager peut
  // alors répondre en prose libre).
  response = ensureChipsPresent(response, lastUserMessage);
  // Garde-fou déterministe : toute proposition de champ (valeur libre
  // "inline" OU champ canonique "below_bubble") DOIT toujours offrir
  // « Ajuster », même si le LLM l'oublie.
  response = ensureAdjustChip(response);
  // Garde-fou déterministe : « Ajuster » a besoin d'un champ cible. Si le LLM
  // a oublié `proposalField` (typiquement missions / compétences, qui retombent
  // alors sur le fallback above_input), on l'ancre sur le champ proposé / en
  // cours de collecte — sinon le clic « Ajuster » ne fait rien d'utile.
  response = ensureProposalAnchor(response, input.fdp);
  // Filet universel : jamais de bulle vide (message d'espaces).
  response = ensureNonEmptyMessage(response);

  const campaignId =
    !input.fdp &&
    !classification.needsClarification &&
    classification.intent === 'new_campaign'
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
