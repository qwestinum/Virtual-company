/**
 * Proposition de compte rendu à partir d'une transcription — contrôles
 * DÉTERMINISTES et rendu. PUR, testé.
 * Spec : docs/specs/compte-rendu-entretien.md §5.3, §5.4.
 *
 * Seconde ceinture, après le schéma de sortie (qui n'a AUCUN champ où poser un
 * score ou un avis). Elle tourne pendant que la transcription est encore en
 * mémoire — c'est la seule fenêtre où l'on peut vérifier quoi que ce soit :
 *   1. chaque citation est RETROUVÉE mot pour mot dans la transcription ;
 *      introuvable ⇒ l'élément est retiré et compté (on ne restitue que ce
 *      qu'on peut montrer — « un non sans preuve n'est pas un verdict ») ;
 *   2. une formulation ÉVALUATIVE hors citation est SIGNALÉE au recruteur, pas
 *      supprimée : un lexique est imparfait, il signale, il ne juge pas ;
 *   3. le compte rendu ne devient pas une transcription déguisée : au-delà d'un
 *      plafond de texte cité, la proposition est REFUSÉE.
 */

import { z } from 'zod';

import type { NormalizedTranscript } from '@/lib/transcript/normalize';
import type {
  InterviewReportSections,
  ReportCriterionPrompt,
} from '@/types/interview-report';

/** Longueur maximale d'une citation (caractères). */
export const MAX_QUOTE_CHARS = 200;
/** Citation trop courte pour prouver quoi que ce soit (« oui »). */
export const MIN_QUOTE_CHARS = 12;
/** Part maximale de la transcription reprise en citations… */
export const MAX_QUOTED_SHARE = 0.15;
/** …avec un plancher, pour qu'un entretien bref reste restituable. */
export const MIN_QUOTE_BUDGET = 600;

const Item = z
  .object({
    /** Restitution neutre de ce qui a été dit. */
    text: z.string().min(1).max(400),
    /** Citation mot pour mot qui le prouve. */
    quote: z.string().max(MAX_QUOTE_CHARS + 40),
    speaker: z.string().max(80).nullable(),
    at: z.string().max(16).nullable(),
  })
  .strict();

const Items = z.array(Item).max(20);

/**
 * Ce que le modèle rend. `.strict()` partout : aucun champ en plus — c'est la
 * première ceinture, structurelle (il n'existe nulle part où poser un score).
 */
export const StructuringOutputSchema = z
  .object({
    topics: Items,
    criteria: z
      .array(
        z
          .object({
            criterionId: z.string().max(200),
            addressed: z.boolean(),
            items: z.array(Item).max(8),
          })
          .strict(),
      )
      .max(60),
    highlights: Items,
    reservations: Items,
    followUps: Items,
    /** Nombre de passages hors cadre professionnel écartés — jamais leur contenu. */
    omittedCount: z.number().int().min(0).max(999),
  })
  .strict();

export type StructuringOutput = z.infer<typeof StructuringOutputSchema>;
type OutputItem = z.infer<typeof Item>;

export type StructuringStats = {
  kept: number;
  /** Éléments retirés : citation absente, trop courte ou introuvable. */
  removedUnproven: number;
  /** Éléments gardés mais signalés « formulation à vérifier ». */
  flagged: number;
  omittedCount: number;
};

export type CheckedProposal =
  | { ok: true; sections: InterviewReportSections; stats: StructuringStats }
  | { ok: false; reason: 'too_much_quoted' };

/** Forme de comparaison : casse, apostrophes et guillemets typographiques, espaces. */
export function comparable(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’‘`´]/gu, "'")
    .replace(/[«»“”"]/gu, '')
    .replace(/…/gu, '...')
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(/^[\s.,;:!?'-]+|[\s.,;:!?'-]+$/gu, '');
}

const EVALUATIVE: RegExp[] = [
  /\b\d{1,3}\s?\/\s?(?:10|20|100)\b/u,
  /\b(?:je|nous)\s+(?:recommande|conseille|préconise)/iu,
  /\bprofil\s+(?:idéal|parfait|solide|faible)\b/iu,
  /\bà\s+retenir\b/iu,
  /\b(?:excellent|parfait|brillant|médiocre|insuffisant|décevant)e?s?\b/iu,
  /\bcandidat(?:e)?\s+(?:idéal|solide|fort|faible|sérieux)/iu,
  /\b(?:score|note\s+de|notation)\b/iu,
];

/** La citation sans ses guillemets d'origine (on remet les nôtres). */
function bareQuote(quote: string): string {
  return quote.trim().replace(/^[«"“\s]+|[»"”\s]+$/gu, '');
}

export function isEvaluative(text: string): boolean {
  return EVALUATIVE.some((re) => re.test(text));
}

export function checkAndRender(
  output: StructuringOutput,
  transcript: NormalizedTranscript,
  criteria: ReportCriterionPrompt[],
): CheckedProposal {
  const haystack = comparable(transcript.plainText);
  const stats: StructuringStats = { kept: 0, removedUnproven: 0, flagged: 0, omittedCount: output.omittedCount };
  let quoted = 0;

  const keep = (items: OutputItem[]): string[] => {
    const lines: string[] = [];
    for (const item of items) {
      const quote = comparable(item.quote);
      if (quote.length < MIN_QUOTE_CHARS || quote.length > MAX_QUOTE_CHARS || !haystack.includes(quote)) {
        stats.removedUnproven += 1;
        continue;
      }
      stats.kept += 1;
      quoted += quote.length;
      const flagged = isEvaluative(item.text);
      if (flagged) stats.flagged += 1;
      const who = [item.speaker, item.at].filter(Boolean).join(', ');
      lines.push(
        `- ${flagged ? '[formulation à vérifier] ' : ''}${item.text.trim()} — « ${bareQuote(item.quote)} »${who ? ` (${who})` : ''}`,
      );
    }
    return lines;
  };

  const byId = new Map(output.criteria.map((c) => [c.criterionId, c]));
  const sections: InterviewReportSections = {
    version: 1,
    topics: keep(output.topics).join('\n'),
    // Les critères de la CAMPAGNE, dans leur ordre ; un identifiant inventé par
    // le modèle ne crée pas de rubrique.
    criteria: criteria.map((c) => {
      const found = byId.get(c.criterionId);
      if (!found || !found.addressed) {
        return { ...c, text: 'Non abordé pendant l’entretien.' };
      }
      const lines = keep(found.items);
      return {
        ...c,
        text: lines.length > 0 ? lines.join('\n') : 'Abordé, sans citation vérifiable retenue.',
      };
    }),
    highlights: keep(output.highlights).join('\n'),
    reservations: keep(output.reservations).join('\n'),
    followUps: keep(output.followUps).join('\n'),
  };

  const budget = Math.max(MIN_QUOTE_BUDGET, Math.floor(haystack.length * MAX_QUOTED_SHARE));
  if (quoted > budget) return { ok: false, reason: 'too_much_quoted' };
  return { ok: true, sections, stats };
}
