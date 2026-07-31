/**
 * Mocks de FRONTIÈRE de la suite de régression (branchés par setup.ts via
 * vi.mock) : LLM, embeddings, email. Tout le reste est réel.
 *
 * Principes :
 *   - chaque fixture retournée est VALIDÉE contre le schéma zod demandé par
 *     l'appelant (schema.parse) → une dérive de schéma casse le test FORT,
 *     jamais en silence ;
 *   - un appel LLM non reconnu par la table de routage LÈVE (« appel non
 *     routé ») — on n'invente jamais une réponse générique ;
 *   - les embeddings sont DÉTERMINISTES (hash du texte → vecteur 1536
 *     normalisé) : même texte ⇒ même vecteur ⇒ cosinus 1 en présélection ;
 *   - `sendEmail` enregistre et n'envoie JAMAIS (recorder inspectable).
 */
import type { z } from 'zod';

import {
  INTERVIEW_GUIDE_FIXTURE,
  LEDGER_FIXTURE,
  LETTER_EXTRACTION_FIXTURE,
  LETTER_MARKER,
  NARRATION_FIXTURE,
  TITLE_VARIANTS_FIXTURE,
  candidateExtractionFixture,
  profileFromText,
  verdictsFixture,
  vivierEntitiesFixture,
} from '../fixtures/llm-fixtures';

type ChatMessage = { role: string; content: string };

// ─── Enregistreur d'emails (assertions « mail parti / aucun mail ») ────────

export type RecordedEmail = {
  to: string | string[];
  subject: string;
  html: string;
  replyTo: string | null;
};

export const sentEmails: RecordedEmail[] = [];

export function resetSentEmails(): void {
  sentEmails.length = 0;
}

export function buildEmailClientMock(
  actual: typeof import('@/lib/email/client'),
): typeof import('@/lib/email/client') {
  return {
    ...actual,
    sendEmail: async (input) => {
      sentEmails.push({ to: input.to, subject: input.subject, html: input.html, replyTo: input.replyTo ?? null });
      return { ok: true, messageId: `mock_msg_${sentEmails.length}` };
    },
  };
}

// ─── Embeddings déterministes ──────────────────────────────────────────────

/** PRNG mulberry32 — vecteur reproductible dérivé du texte normalisé. */
function deterministicVector(text: string): number[] {
  const norm = text.trim().toLowerCase();
  let seed = 2166136261;
  for (let i = 0; i < norm.length; i++) {
    seed ^= norm.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  const rand = () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const v = Array.from({ length: 1536 }, () => rand() * 2 - 1);
  const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / len);
}

export function buildEmbeddingsMock(
  actual: typeof import('@/lib/ai/embeddings'),
): typeof import('@/lib/ai/embeddings') {
  return {
    ...actual,
    // Même couple provider|model que l'indexation réelle du projet : le garde
    // d'espace d'embeddings de la présélection doit rester cohérent.
    embedText: async (text: string) => ({
      vector: deterministicVector(text),
      provider: 'openai',
      model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
      costEstimate: 0,
      durationMs: 1,
    }),
  } as typeof actual;
}

// ─── Provider LLM à table de routage ───────────────────────────────────────

function rawFor(data: unknown) {
  return {
    content: JSON.stringify(data),
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
    costEstimate: 0,
    durationMs: 1,
    model: 'mock-regression',
  };
}

/**
 * Routage par sous-chaîne STABLE du prompt système (relevé du code réel) ;
 * le profil (fort/faible/moyen) est déduit du marqueur PROFIL_*_TREG contenu
 * dans le prompt utilisateur (texte du CV fixture).
 */
function routeChatCompleteJson(messages: ChatMessage[]): unknown {
  const system = messages[0]?.content ?? '';
  const user = messages
    .slice(1)
    .map((m) => m.content)
    .join('\n');
  const profile = profileFromText(user) ?? 'moyen';

  if (system.includes("l'extracteur de données factuelles du CV Analyzer RH")) {
    // Document marqué NON-CV (lettre) → isCv:false, identité anonymisée —
    // le pipeline court-circuite (ni verdicts ni narration ne seront appelés).
    if (user.includes(LETTER_MARKER)) return LETTER_EXTRACTION_FIXTURE;
    return candidateExtractionFixture(profile);
  }
  if (system.includes("l'extracteur de FAITS du CV Analyzer RH")) {
    return LEDGER_FIXTURE;
  }
  if (system.includes("l'évaluateur par critère du CV Analyzer RH")) {
    return verdictsFixture(profile);
  }
  if (system.includes('Tu es le rédacteur RH du CV Analyzer')) {
    return NARRATION_FIXTURE;
  }
  if (system.includes("l'indexeur d'entités du vivier de candidatures")) {
    return vivierEntitiesFixture(profile);
  }
  if (system.includes('INTITULÉS DE POSTE équivalents')) {
    return TITLE_VARIANTS_FIXTURE;
  }
  throw new Error(
    `LLM mock (régression) : appel chatCompleteJson NON ROUTÉ — système: « ${system.slice(0, 120)}… »`,
  );
}

export function buildProviderMock(
  actual: typeof import('@/lib/ai/provider'),
): typeof import('@/lib/ai/provider') {
  const chatCompleteJson = (async (
    messages: ChatMessage[],
    schema: z.ZodTypeAny,
  ) => {
    const data = schema.parse(routeChatCompleteJson(messages));
    return { data, raw: rawFor(data) };
  }) as typeof actual.chatCompleteJson;

  // Seul appelant de chatComplete : la trame d'entretien du mail-composer.
  const chatComplete = (async () =>
    rawFor(INTERVIEW_GUIDE_FIXTURE)) as typeof actual.chatComplete;

  return { ...actual, chatCompleteJson, chatComplete };
}
