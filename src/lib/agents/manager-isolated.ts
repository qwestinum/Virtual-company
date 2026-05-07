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
import {
  ISOLATED_CRITERIA_KEYS,
  ISOLATED_CRITERIA_LABELS,
  type IsolatedCriteriaInProgress,
} from '@/types/isolated-criteria';
import {
  IsolatedManagerResponseSchema,
  type IsolatedManagerResponse,
} from '@/types/manager-response';

import type { ConversationTurn } from './manager';

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
      'Tu DOIS proposer une valeur pour le PREMIER critère vide ci-dessus, et l\'extraire dans fieldExtractions. PAS de message de clôture tant que isComplete=false.',
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
    "À chaque tour : ANALYSE le dernier message du DRH, identifie toutes les valeurs de critères qu'il fournit (explicites OU implicites), RENSEIGNE fieldExtractions, et pour le PROCHAIN champ vide PROPOSE une valeur par défaut argumentée (en lien avec ton expertise du marché RH français 2026 et du contexte déjà extrait).",
    '',
    "RÈGLE D'OR — DOUBLE ÉCRITURE : si une valeur apparaît dans `message`, elle DOIT apparaître dans `fieldExtractions`. Sinon la checklist du DRH ne reflète pas ta proposition.",
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
    '── EXEMPLE TYPIQUE ──',
    'Premier message DRH : « pour un poste d\'ingénieur »',
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

  return {
    response,
    metrics: {
      durationMs: completion.durationMs,
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
    },
  };
}
