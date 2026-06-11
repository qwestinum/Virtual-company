/**
 * Exécution serveur de la proposition de fiche de scoring (Phase 4.2).
 *
 * Frontière server-only : importe provider.ts, ne doit pas être tiré
 * dans le bundle client. La route /api/manager/scoring appelle
 * directement `runScoringProposal`.
 *
 * Le LLM produit `{ criteria: [{ label, level }] }`. On dérive le
 * poids côté serveur via `buildCriterion` qui applique DEFAULT_WEIGHTS
 * (cf. types/scoring.ts) — le LLM ne sort jamais de poids pour éviter
 * les hallucinations numériques.
 */

import { z } from 'zod';

import { chatComplete } from '@/lib/ai/provider';
import {
  FDPInProgressSchema,
  type FDPInProgress,
} from '@/types/field-collection';
import {
  buildCriterion,
  ScoringLevelSchema,
  VerificationMethodSchema,
  type ScoringCriterion,
} from '@/types/scoring';

import {
  buildScoringSystemPrompt,
  buildScoringUserPrompt,
} from '../scoring-prompts';

export class ScoringProposalError extends Error {
  constructor(
    public readonly code:
      | 'invalid_fdp_payload'
      | 'invalid_response_json'
      | 'invalid_response_shape',
    message: string,
  ) {
    super(message);
    this.name = 'ScoringProposalError';
  }
}

/**
 * Schéma du JSON produit par le LLM (sans poids — dérivés serveur).
 * Min 5, max 20 — légèrement plus permissif que le prompt (8-15) pour
 * encaisser une légère dérive du modèle sans rejeter la réponse.
 */
const LLMScoringResponseSchema = z.object({
  criteria: z
    .array(
      z.object({
        label: z.string().min(1).max(120),
        level: ScoringLevelSchema,
        // Phase 3c — méthode + mots-clés. TOLÉRANT : si le LLM les omet,
        // fallback `llm_with_quote` / `[]` (rétro-compat, cf. scoring-hybrid.md
        // §3c). `.catch` encaisse une valeur d'énum invalide sans rejeter la
        // proposition entière.
        verificationMethod: VerificationMethodSchema.optional().catch(undefined),
        keywords: z.array(z.string()).optional().catch(undefined),
      }),
    )
    .min(5)
    .max(20),
});

export type ScoringProposalMetrics = {
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
};

export type ScoringProposalOutput = {
  criteria: ScoringCriterion[];
  metrics: ScoringProposalMetrics;
};

export async function runScoringProposal(
  fdp: FDPInProgress,
): Promise<ScoringProposalOutput> {
  // Re-parse la FDP pour ne pas faire confiance à un payload brut.
  // La route a déjà parsé via FDPInProgressSchema ; ce check est une
  // ceinture-bretelles si le module est appelé depuis ailleurs.
  try {
    FDPInProgressSchema.parse(fdp);
  } catch (err) {
    throw new ScoringProposalError(
      'invalid_fdp_payload',
      err instanceof Error ? err.message : 'Invalid FDP payload.',
    );
  }

  const completion = await chatComplete({
    model: 'gpt-4o',
    jsonMode: true,
    temperature: 0.4,
    messages: [
      { role: 'system', content: buildScoringSystemPrompt() },
      { role: 'user', content: buildScoringUserPrompt(fdp) },
    ],
  });

  let raw: unknown;
  try {
    raw = JSON.parse(completion.content);
  } catch (err) {
    throw new ScoringProposalError(
      'invalid_response_json',
      err instanceof Error ? err.message : 'Unparseable scoring JSON.',
    );
  }

  let parsed: z.infer<typeof LLMScoringResponseSchema>;
  try {
    parsed = LLMScoringResponseSchema.parse(raw);
  } catch (err) {
    throw new ScoringProposalError(
      'invalid_response_shape',
      err instanceof Error ? err.message : 'Scoring response shape invalid.',
    );
  }

  // Dérive l'id et le poids depuis le niveau. Les ids sont déterministes
  // par index pour aider à debugger les tests vitest et l'audit (le
  // store regénère un id via crypto.randomUUID quand il accepte une
  // proposition côté client — cf. proposeSheet/addCriterion).
  const criteria: ScoringCriterion[] = parsed.criteria.map((item, idx) =>
    buildCriterion({
      id: `proposed_${idx + 1}`,
      label: item.label,
      level: item.level,
      // Coalescing géré par buildCriterion : undefined → champs non
      // matérialisés (méthode lue comme llm_with_quote, mots-clés comme []).
      verificationMethod: item.verificationMethod,
      keywords: item.keywords,
    }),
  );

  return {
    criteria,
    metrics: {
      durationMs: completion.durationMs,
      tokensUsed: completion.usage.totalTokens,
      costEstimate: completion.costEstimate,
    },
  };
}
