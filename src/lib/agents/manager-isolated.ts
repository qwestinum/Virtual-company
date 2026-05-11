/**
 * Pré-collecte des critères pour analyse CV en mode tâche isolée
 * (Session 4).
 *
 * Frontière server-only (importé par /api/manager/isolated-criteria).
 * Cycle court : 4 questions structurées (intitulé, séniorité,
 * compétences clés, expérience minimale). Pas de classification
 * d'intention, pas de pré-recherche — l'utilisateur est déjà clair
 * sur le fait qu'il veut une analyse CV isolée.
 */

import { chatComplete } from '@/lib/ai/provider';
import { IntentClassificationSchema } from '@/types/intent';
import {
  ISOLATED_CRITERIA_KEYS,
  ISOLATED_CRITERIA_LABELS,
  type IsolatedCriteriaInProgress,
} from '@/types/isolated-criteria';
import {
  IsolatedManagerResponseSchema,
  type IsolatedManagerResponse,
} from '@/types/manager-response';
import type { PendingSwitch } from '@/types/switch-dialog';

import {
  buildSwitchDialogResponse,
  FALLBACK_CHIP_ADJUST,
  FALLBACK_CHIP_CONTINUE,
  generateCampaignId,
  hasClarificationRequestKeyword,
  hasSwitchIntentKeyword,
  SWITCH_DIALOG_THRESHOLD,
  type ConversationTurn,
} from './manager';
import { buildIntentClassificationPrompt } from './manager-prompts';

export type IsolatedTurnInput = {
  history: ConversationTurn[];
  criteria: IsolatedCriteriaInProgress;
};

export type IsolatedTurnMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};

export type IsolatedTurnOutput = {
  response: IsolatedManagerResponse;
  /**
   * Non null quand le serveur détecte que le DRH bascule (au milieu
   * d'une pré-collecte isolated) vers une nouvelle campagne ou tâche
   * FDP. Le client traite ce payload comme dans le flow principal :
   * sur clic SWITCH_CHIP_NEW → wipeForFreshStart + createFDP(proposed)
   * + seed du dernier user message + sendToManager. La pré-collecte
   * isolated est abandonnée.
   */
  pendingSwitch: PendingSwitch | null;
  metrics: IsolatedTurnMetrics;
};

export class IsolatedManagerError extends Error {
  constructor(
    public readonly code: 'invalid_response_json' | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'IsolatedManagerError';
  }
}

function getCriteriaJobTitle(
  criteria: IsolatedCriteriaInProgress,
): string | undefined {
  const v = criteria.fields.job_title?.value;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function formatCriteriaState(criteria: IsolatedCriteriaInProgress): string {
  const lines: string[] = [
    `Tâche ${criteria.taskId} — isComplete: ${criteria.isComplete}, isValidated: ${criteria.isValidated}.`,
  ];
  const missing = ISOLATED_CRITERIA_KEYS.filter(
    (k) => criteria.fields[k]?.status !== 'filled',
  );
  if (missing.length > 0 && !criteria.isComplete) {
    lines.push(
      `Critères ENCORE VIDES (${missing.length}/${ISOLATED_CRITERIA_KEYS.length}) : ${missing.join(', ')}.`,
      "Étape 1 obligatoire : extrais d'abord toute valeur (explicite ou acceptation implicite « ok »/« oui »/« validé ») présente dans le dernier message DRH et inscris-la dans fieldExtractions. Étape 2 : si après extraction il reste des critères vides, PROPOSE une valeur par défaut pour le PREMIER critère vide ci-dessus (en l'extrayant aussi). PAS de message de clôture tant que isComplete=false. NE repose PAS une question identique à celle du tour précédent — si le DRH a répondu, son message contient une réponse à interpréter.",
    );
  }
  if (criteria.isComplete && !criteria.isValidated) {
    lines.push(
      "Les 4 critères sont remplis. Fais un récap structuré (4 bullets) et invite le DRH à cliquer le bouton vert « Valider et lancer l'analyse ». Tu ne dis PAS que l'analyse a démarré — c'est le clic qui la lance.",
    );
  }
  for (const k of ISOLATED_CRITERIA_KEYS) {
    const f = criteria.fields[k];
    if (!f) continue;
    const v = f.value === undefined ? '∅' : JSON.stringify(f.value);
    lines.push(`  - ${k} : ${f.status} (${v})`);
  }
  return lines.join('\n');
}

export function buildIsolatedSystemPrompt(
  criteria: IsolatedCriteriaInProgress,
): string {
  const fieldsBlock = ISOLATED_CRITERIA_KEYS.map(
    (k) => `  - ${k} (${ISOLATED_CRITERIA_LABELS[k]})`,
  ).join('\n');

  return [
    "Tu es le Manager RH d'une entreprise virtuelle (QWESTINUM). Tu pilotes une PRÉ-COLLECTE COURTE pour analyser des CV en mode tâche isolée. Ton professionnel et chaleureux. Toujours en français. Aucune emoji.",
    '',
    '── PRINCIPE ──',
    "Tu es en train de récolter EXACTEMENT 4 critères avant de lancer l'analyse. Pas de FDP complète, pas de fourchette salariale, pas de localisation. Juste ce qu'il faut pour scorer un CV correctement.",
    '',
    '── ÉTAT DES CRITÈRES ──',
    formatCriteriaState(criteria),
    '',
    '── CHAMPS — LISTE FERMÉE (4 critères uniquement) ──',
    fieldsBlock,
    "Toute clé hors de cette liste est interdite dans `fieldExtractions`.",
    '',
    'Libellés / formats canoniques :',
    '- job_title : libre (ex. "Data Engineer")',
    '- seniority ∈ {"junior", "confirmé", "senior"}',
    '- key_skills : array de strings (3 à 6 compétences, ex. ["Python", "SQL", "Spark", "Airflow", "GCP"])',
    '- experience_years : NOMBRE entier en années (ex. 5)',
    '',
    '── MODE PROPOSITION (obligatoire) ──',
    "À CHAQUE tour, applique CET ORDRE STRICT — extraction AVANT proposition :",
    '',
    'ÉTAPE 1 — EXTRAIRE. Lis le DERNIER message DRH et identifie TOUTES les valeurs de critères qu\'il donne, explicites OU implicites :',
    '  - intitulé : « Développeur Python » → job_title="Développeur Python".',
    '  - séniorité : « junior », « senior », « confirmé » → seniority.',
    '  - expérience : « 5 ans », « 8+ ans » → experience_years (entier).',
    '  - compétences : « Python, SQL, Spark » → key_skills (array).',
    "  - ACCEPTATION IMPLICITE : si le DRH a dit « ok », « oui », « parfait », « ça me va », « validé » et que tu avais proposé des valeurs au tour précédent, ces valeurs sont ACCEPTÉES — tu les inscris en fieldExtractions ce tour-ci. Ne propose PAS de nouvelles valeurs à la place ; tu enchaînes simplement sur le critère vide suivant.",
    '',
    'ÉTAPE 2 — RENSEIGNER fieldExtractions avec tout ce que tu as extrait, MÊME si tu n\'ajoutes pas de proposition derrière. Aucune valeur extraite ou implicitement acceptée ne doit être perdue entre deux tours.',
    '',
    "ÉTAPE 3 — PROPOSER pour le PROCHAIN champ vide (un seul à la fois si le DRH alimente progressivement, OU les 4 d'un coup en cascade si le 1er message est vague type « pour un poste d'ingénieur »). Argumente ta proposition à partir du marché RH français 2026 et du contexte déjà extrait.",
    '',
    "RÈGLE D'OR — DOUBLE ÉCRITURE : `fieldExtractions` représente l'ÉTAT de la fiche APRÈS ton tour, qu'il s'agisse de valeurs explicitement données par le DRH OU de TES propositions. Ce n'est PAS un journal de ce que le DRH a dit ; c'est la version courante de la fiche que le DRH va voir dans sa checklist.",
    'Si tu écris dans `message` « je propose senior, 5 ans, Python / SQL », alors fieldExtractions DOIT contenir `seniority: \"senior\"`, `experience_years: 5`, `key_skills: [\"Python\", \"SQL\"]`. SANS EXCEPTION. Tu n\'attends PAS la validation du DRH pour matérialiser tes propositions — la checklist montre l\'état proposé, le DRH ajuste ensuite si besoin.',
    '',
    'EXEMPLE NÉGATIF (à NE JAMAIS reproduire) :',
    '✗ message : « Je propose senior, 3 ans, Python / Django / REST »',
    '✗ fieldExtractions : { "job_title": "Développeur" }   ← INCORRECT, oublie tes propositions',
    'CORRECT :',
    '✓ message : « Je propose senior, 3 ans, Python / Django / REST »',
    '✓ fieldExtractions : { "job_title": "Développeur", "seniority": "senior", "experience_years": 3, "key_skills": ["Python", "Django", "REST"] }',
    '',
    "ANTI-LOOP — Si tu remarques que le même critère reste vide après PLUSIEURS tours d'aller-retour, c'est que ton extraction de l'étape 1 a échoué : relis le dernier message DRH ET les 1-2 messages précédents (ses validations « ok » incluses) avant de reproposer. NE re-propose PAS la même valeur deux fois de suite quand le DRH a déjà répondu — soit il a accepté (extrais), soit il a rejeté (propose autre chose), jamais « repose la même question ».",
    '',
    'INTERDIT — Confirmer prématurément. Tant que isComplete=false, tu ne dis JAMAIS « OK je lance », « parfait, j\'analyse », « c\'est bon ». La confirmation officielle vient EXCLUSIVEMENT du clic du DRH sur le bouton vert « Valider et lancer l\'analyse ». Toi, ton rôle s\'arrête à : (a) compléter les 4 critères, (b) faire un récap final une fois isComplete=true, (c) inviter au clic.',
    '',
    'INTERDIT — Lancer l\'analyse à partir d\'une seule info (ex. « ingénieur »). Si le DRH te lâche juste un intitulé vague, tu extrais ce que tu peux et tu PROPOSES IMMÉDIATEMENT une valeur par défaut sur les autres critères en cascade : ne pose pas une question à blanc, donne ta proposition.',
    '',
    '── CHIPS ──',
    'Pour seniority → chips below_bubble ["junior", "confirmé", "senior"].',
    'Pour key_skills → chips inline ["Garder cette liste", "Ajouter \'<X>\'", "Retirer \'<Y>\'"] avec items nommés.',
    'Pour experience_years → chips inline ["Utiliser <N> ans", "Plus (<M> ans)", "Moins (<P> ans)"].',
    'Pour job_title → en général pas de chips, sauf si tu hésites entre 2 reformulations canoniques.',
    'Limite : 2 à 5 chips max, jamais cumulés.',
    '',
    '── EXEMPLES ──',
    'EX 1 — Cascade au 1er message vague.',
    'DRH : « pour un poste d\'ingénieur »',
    'Tu réponds (ne pose PAS de question à blanc — tu PROPOSES en cascade) :',
    '{',
    '  "message": "Compris, ingénieur. Je propose : profil senior, 5 ans d\'expérience minimum, compétences clés Python / SQL / cloud (AWS ou GCP) / CI-CD / monitoring. Tu valides ces critères ou on ajuste ?",',
    '  "chips": { "placement": "below_bubble", "options": ["junior", "confirmé", "senior"] },',
    '  "fieldExtractions": {',
    '    "job_title": "Ingénieur",',
    '    "seniority": "senior",',
    '    "experience_years": 5,',
    '    "key_skills": ["Python", "SQL", "AWS/GCP", "CI/CD", "Monitoring"]',
    '  }',
    '}',
    '',
    'EX 2 — Acceptation implicite au tour suivant (« ok ») doit refléter les valeurs proposées.',
    'État avant : tu as proposé senior / 5 ans / Python+SQL+AWS+CI-CD+Monitoring (mais aucun critère encore filled — la double-écriture précédente a peut-être été défaillante).',
    'DRH : « ok »',
    'Tu réponds (acceptation implicite — tu RECOPIES tes propositions précédentes en fieldExtractions, tu n\'en réinventes PAS de nouvelles) :',
    '{',
    '  "message": "Parfait, je note : senior, 5 ans, Python / SQL / AWS / CI-CD / Monitoring. Vous êtes prêt à valider et lancer l\'analyse ?",',
    '  "fieldExtractions": {',
    '    "seniority": "senior",',
    '    "experience_years": 5,',
    '    "key_skills": ["Python", "SQL", "AWS/GCP", "CI/CD", "Monitoring"]',
    '  }',
    '}',
    '',
    "EX 3 — Le DRH donne une valeur précise pour un critère vide. Tu l'extrais et tu enchaînes sur le suivant.",
    'État : seniority et experience_years déjà remplis ; key_skills encore vides.',
    'DRH : « Python, SQL, Spark »',
    'Tu réponds :',
    '{',
    '  "message": "Compris, Python / SQL / Spark. C\'est complet — vous êtes prêt à valider et lancer l\'analyse ?",',
    '  "fieldExtractions": {',
    '    "key_skills": ["Python", "SQL", "Spark"]',
    '  }',
    '}',
    '',
    '── STYLE ──',
    '- 2 à 4 phrases max dans `message`. Pas de markdown lourd.',
    '- Tu PROPOSES, tu n\'INTERROGES pas (sauf job_title si vraiment vague).',
    '- LISTES de 3+ items : bullets sur lignes séparées.',
    '',
    '── FORMAT DE SORTIE STRICT (JSON UNIQUEMENT) ──',
    '{ "message": "<bulle>", "chips"?: {...}, "fieldExtractions"?: {...} }',
    'Omets `chips` et `fieldExtractions` quand non applicables (ne mets PAS null).',
  ].join('\n');
}

export async function runIsolatedCriteriaTurn(
  input: IsolatedTurnInput,
): Promise<IsolatedTurnOutput> {
  const conversation = input.history.map((t) => ({
    role: t.role === 'manager' ? ('assistant' as const) : ('user' as const),
    content: t.content,
  }));

  // Détection de switch — symétrique au flow principal (manager.ts).
  // Si le DRH bascule en plein milieu d'une pré-collecte isolated
  // vers une nouvelle campagne ou une autre tâche FDP, on court-circuit
  // le tour conversationnel et on retourne un dialogue déterministe.
  // Ne s'active que si criteria.job_title est déjà renseigné (sinon
  // pas de contexte à protéger — le 1er tour isolated EST le moment
  // où le DRH nomme le poste).
  const currentJobTitle = getCriteriaJobTitle(input.criteria);
  let switchMetrics: IsolatedTurnMetrics = {
    durationMs: 0,
    tokensUsed: 0,
    costEstimate: 0,
  };

  if (currentJobTitle) {
    const intentSystem = buildIntentClassificationPrompt(currentJobTitle);
    const intentCompletion = await chatComplete({
      jsonMode: true,
      temperature: 0.1,
      messages: [
        { role: 'system', content: intentSystem },
        ...conversation,
      ],
    });
    switchMetrics = {
      durationMs: intentCompletion.durationMs,
      tokensUsed: intentCompletion.usage.totalTokens,
      costEstimate: intentCompletion.costEstimate,
    };

    let classification = null;
    try {
      classification = IntentClassificationSchema.parse(
        JSON.parse(intentCompletion.content),
      );
    } catch {
      // Classification cassée → on ignore et on continue le tour normal.
      classification = null;
    }

    // Deux chemins (cf. manager.ts) : (a) LLM signale isDistinct=true +
    // candidate concret, OU (b) keyword explicite de bascule — chemin
    // (b) ne dépend pas du booléen LLM (le modèle est souvent trop
    // conservateur quand le DRH n'a pas nommé de poste cible).
    if (
      classification &&
      !classification.needsClarification &&
      classification.confidence >= SWITCH_DIALOG_THRESHOLD &&
      (classification.intent === 'new_campaign' ||
        classification.intent === 'out_of_campaign_task')
    ) {
      const candidate =
        typeof classification.candidateNewJobTitle === 'string'
          ? classification.candidateNewJobTitle.trim()
          : '';
      const isCandidateMeaningful =
        candidate.length > 0 &&
        candidate.toLowerCase() !== currentJobTitle.toLowerCase();
      const lastUserMessage =
        [...input.history].reverse().find((t) => t.role === 'user')
          ?.content ?? '';
      const hasExplicitKeyword = hasSwitchIntentKeyword(lastUserMessage);

      const shouldTrigger =
        hasExplicitKeyword ||
        (classification.isDistinctNewCampaign === true &&
          isCandidateMeaningful);

      if (shouldTrigger) {
        const pendingSwitch: PendingSwitch = {
          proposedCampaignId: generateCampaignId(classification.intent),
          currentCampaignId: input.criteria.taskId,
          currentJobTitle,
          currentStatus: input.criteria.isValidated ? 'validated' : 'draft',
        };
        const switchResponse = buildSwitchDialogResponse(pendingSwitch);
        // buildSwitchDialogResponse retourne un ManagerResponse, mais
        // le shape (message + chips, sans fieldExtractions) est
        // compatible avec IsolatedManagerResponse — on cast.
        return {
          response: switchResponse as IsolatedManagerResponse,
          pendingSwitch,
          metrics: switchMetrics,
        };
      }
    }
  }

  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildIsolatedSystemPrompt(input.criteria) },
      ...conversation,
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(completion.content);
  } catch (err) {
    throw new IsolatedManagerError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable response JSON.',
    );
  }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.chips === null) delete r.chips;
    if (r.fieldExtractions === null) delete r.fieldExtractions;
  }
  // Avant le parse Zod, on filtre fieldExtractions sur les 4 clés
  // isolées : le LLM pourrait sortir une clé FDP si une notion connexe
  // apparaît dans la conversation, ce qui ferait échouer le parse.
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    if (r.fieldExtractions && typeof r.fieldExtractions === 'object') {
      const allowed = new Set<string>(ISOLATED_CRITERIA_KEYS);
      const filtered: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(
        r.fieldExtractions as Record<string, unknown>,
      )) {
        if (allowed.has(k)) filtered[k] = v;
      }
      r.fieldExtractions = filtered;
    }
  }
  let response: IsolatedManagerResponse;
  try {
    response = IsolatedManagerResponseSchema.parse(raw);
  } catch (err) {
    throw new IsolatedManagerError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Manager isolated response invalid.',
    );
  }

  // Garde-fou contre la double-écriture défaillante : le LLM propose
  // souvent des valeurs dans `message` (« senior, 3 ans, Python /
  // Django / REST ») sans les inscrire dans `fieldExtractions`. Le
  // résultat : la checklist reste vide → tour suivant le LLM repropose
  // → boucle. On parse la chaîne `message` à la recherche de patterns
  // canoniques pour combler les extractions manquantes. La règle est
  // conservatrice : on ne remplit QUE si extractions[key] est absent
  // ET si le pattern matche sans ambiguïté.
  response = backfillExtractionsFromMessage(response);

  // Garde-fou Phase 2 — chips obligatoires sauf demande
  // d'éclaircissement explicite. Symétrique du flow principal.
  const lastUserForChips =
    [...input.history].reverse().find((t) => t.role === 'user')?.content ??
    '';
  if (!response.chips && !hasClarificationRequestKeyword(lastUserForChips)) {
    response = {
      ...response,
      chips: {
        placement: 'above_input',
        options: [FALLBACK_CHIP_CONTINUE, FALLBACK_CHIP_ADJUST],
      },
    };
  }

  return {
    response,
    pendingSwitch: null,
    metrics: {
      durationMs: completion.durationMs + switchMetrics.durationMs,
      tokensUsed:
        completion.usage.totalTokens + switchMetrics.tokensUsed,
      costEstimate: completion.costEstimate + switchMetrics.costEstimate,
    },
  };
}

const SENIORITY_PATTERN =
  /\b(junior|confirm[ée]?|senior)\b/i;
// "3 ans", "5 années", "3 ans d'expérience", "minimum 5 ans"...
// On capture le premier nombre suivi du marqueur an/année.
const EXPERIENCE_PATTERN =
  /(\d+)\s*(?:an|ann[eé]e)s?\b/i;
// Liste de skills séparée par /, ; ou , après un mot d'introduction
// type "compétences", "skills", "stack". On reste conservateur sur le
// délimiteur (slash dominant dans les propositions LLM observées).
const SKILLS_INTRO_PATTERN =
  /(?:comp[eé]tences?(?:\s+cl[eé]s)?|skills?|stack|techno|technologies?)\s*(?:cl[eé]s)?\s*[:—–-]?\s*([^.!?\n]+)/i;

function normalizeSeniority(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === 'junior') return 'junior';
  if (v === 'senior') return 'senior';
  if (v.startsWith('confirm')) return 'confirmé';
  return null;
}

function extractSkillsFromIntro(captured: string): string[] {
  // Le segment capturé contient typiquement "Python / Django / REST"
  // ou "Python, SQL, Spark". On split sur /,;, garde 2-6 items
  // significatifs, trim chaque item.
  const items = captured
    .split(/[\/,;]+/)
    .map((s) => s.replace(/[()]/g, '').trim())
    .filter((s) => s.length > 0 && s.length <= 60);
  // Anti-bruit : on garde 2 à 6 items (au-delà c'est probablement
  // qu'on a capturé trop de texte, pas une vraie liste).
  if (items.length < 2 || items.length > 6) return [];
  return items;
}

function backfillExtractionsFromMessage(
  response: IsolatedManagerResponse,
): IsolatedManagerResponse {
  const message = response.message;
  const current = response.fieldExtractions ?? {};
  const next: Record<string, unknown> = { ...current };

  if (next.seniority === undefined) {
    const m = message.match(SENIORITY_PATTERN);
    if (m) {
      const norm = normalizeSeniority(m[1]);
      if (norm) next.seniority = norm;
    }
  }

  if (next.experience_years === undefined) {
    const m = message.match(EXPERIENCE_PATTERN);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n >= 0 && n <= 60) {
        next.experience_years = n;
      }
    }
  }

  if (next.key_skills === undefined) {
    const m = message.match(SKILLS_INTRO_PATTERN);
    if (m) {
      const skills = extractSkillsFromIntro(m[1]);
      if (skills.length > 0) next.key_skills = skills;
    }
  }

  // Pas d'inférence pour job_title : trop ambigu côté regex.

  if (Object.keys(next).length === 0) {
    return response;
  }
  return { ...response, fieldExtractions: next };
}
