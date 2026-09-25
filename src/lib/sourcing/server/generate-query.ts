/**
 * Génération de la requête — (b) LLM, repli (a) déterministe.
 * Spec : docs/specs/sourcing.md §3.3 (décision), §17.3 (indicateur de bascule).
 *
 * UN appel LLM par génération, jamais par profil. Le repli n'est pas un échec
 * silencieux : `fallbackReason` est rendu à l'écran, et `method` est stocké
 * avec la recherche — c'est ce qui permet de mesurer, en production, si (b)
 * est réellement moins corrigé que (a).
 */
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

import { chatCompleteJson } from '@/lib/ai/provider';
import { deterministicQuery } from '@/lib/sourcing/query-deterministic';
import {
  buildSystemPrompt,
  FEW_SHOTS,
  ficheToPromptText,
  GeneratedQuerySchema,
  validateGeneratedQuery,
} from '@/lib/sourcing/query-prompt';
import type { GeneratedQuery, QueryFicheInput, SourcingLanguage } from '@/types/sourcing';

export async function generateSourcingQuery(
  fiche: QueryFicheInput,
  language: SourcingLanguage,
): Promise<GeneratedQuery> {
  const fallback = (reason: string): GeneratedQuery => {
    const a = deterministicQuery(fiche);
    return {
      ...a,
      method: 'deterministic',
      // Le repli ne sait pas traduire : il le DIT plutôt que d'envoyer du
      // français en croyant chercher en anglais.
      language: 'fr',
      llmCostUsd: 0,
      fallbackReason:
        language === 'en' ? `${reason} — requête de repli rédigée en français` : reason,
    };
  };

  if (fiche.criteria.length === 0) return fallback('la fiche de scoring ne porte aucun critère');

  const messages: ChatCompletionMessageParam[] = [{ role: 'system', content: buildSystemPrompt(language) }];
  for (const shot of FEW_SHOTS) {
    messages.push({ role: 'user', content: shot.fiche });
    messages.push({ role: 'assistant', content: JSON.stringify(shot.out) });
  }
  messages.push({ role: 'user', content: ficheToPromptText(fiche) });

  try {
    // Modèle par défaut du fournisseur (`OPENAI_CHAT_MODEL`, gpt-4o en dev) :
    // celui que l'étude a mesuré (§3.3). À vérifier sur chaque environnement.
    const r = await chatCompleteJson(messages, GeneratedQuerySchema, {
      temperature: 0,
      maxTokens: 800,
    });
    const verdict = validateGeneratedQuery(r.data, fiche);
    if (!verdict.ok) return fallback(`requête générée écartée : ${verdict.reason}`);
    return {
      query: r.data.query.trim(),
      encoded: r.data.encoded,
      notEncoded: r.data.notEncoded,
      method: 'llm',
      language,
      // Le nom daté renvoyé par le fournisseur est normalisé par `estimateCost`.
      llmCostUsd: r.raw.costEstimate,
      fallbackReason: null,
    };
  } catch {
    return fallback('génération indisponible');
  }
}
