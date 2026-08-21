/**
 * « Un non sans preuve n'est pas un verdict. » Pur, testé.
 *
 * INVARIANT, né de l'incident du 21/08/2026 (CAMP-2026-288) : une décision
 * NÉGATIVE sur un critère ne peut être rendue que par un chemin qui a LU le CV.
 *
 * Ce jour-là, quatre critères ont été refusés à un candidat sans qu'aucun
 * modèle n'ait ouvert son CV : un pré-filtre par mots-clés ne trouvait pas la
 * chaîne « Consultant MOA » dans un document qui disait « Consultant SI &
 * AMOA », ni « secteur financier » dans un parcours « Trade Finance — Société
 * Générale ». Score rendu : 0/100. Le pré-filtre, conçu comme un accélérateur,
 * s'était mis à JUGER.
 *
 * La règle qui en découle, et qui est le cœur de ce module :
 *
 *   - trouver un mot-clé est une PREUVE LITTÉRALE : elle suffit à conclure
 *     « satisfait » sans appeler le modèle, et l'économie d'appel est légitime ;
 *   - ne pas trouver un mot-clé n'est la preuve de RIEN. L'absence d'un mot
 *     n'est pas l'absence d'une compétence. Le critère est alors DÉFÉRÉ au
 *     modèle, qui lit le CV et tranche.
 *
 * `non_verifiable` reste le marqueur honnête de « non évalué » : il n'affirme
 * rien contre le candidat, et n'a donc rien à prouver.
 */

import type { LlmDecision, VerdictPath } from '@/types/scoring';

/** Une décision qui AFFIRME quelque chose contre le candidat. */
export function isDecisiveNegative(decision: LlmDecision): boolean {
  return decision === 'non';
}

export type VerdictLike = {
  criterionId: string;
  llmDecision: LlmDecision;
  decidedBy?: VerdictPath;
};

/**
 * Les verdicts qui violent l'invariant : une décision négative rendue par un
 * chemin qui n'a pas lu le CV.
 *
 * `decidedBy` absent est traité comme conforme : les analyses ANTÉRIEURES à
 * l'ajout du champ ne portent pas cette information, et les relire à l'aune
 * d'une règle qu'elles ne pouvaient pas connaître ne dirait rien d'utile. Le
 * repérage du parc existant se fait sur la trace de l'époque
 * (`llmJustification` + `matchedKeywords` vides), pas ici.
 */
export function findUnprovenNegatives<T extends VerdictLike>(verdicts: T[]): T[] {
  return verdicts.filter(
    (v) =>
      isDecisiveNegative(v.llmDecision) &&
      v.decidedBy !== undefined &&
      v.decidedBy !== 'llm',
  );
}

/** Levée quand l'invariant est rompu — défaut de programmation, pas d'entrée. */
export class UnprovenNegativeVerdictError extends Error {
  constructor(public readonly criterionIds: string[]) {
    super(
      `Verdict négatif rendu sans lecture du CV pour : ${criterionIds.join(', ')}. ` +
        'Un chemin déterministe ne peut produire qu’un « satisfait » ; ' +
        'toute absence doit être déférée au modèle.',
    );
    this.name = 'UnprovenNegativeVerdictError';
  }
}

/**
 * Garde d'exécution, à poser sur TOUT lot de verdicts produits hors LLM.
 *
 * Lève plutôt que de corriger en silence : si un chemin déterministe se remet
 * un jour à conclure « non », c'est un défaut de conception qui doit être vu,
 * pas rattrapé discrètement à l'exécution.
 */
export function assertNoUnprovenNegative(verdicts: VerdictLike[]): void {
  const violations = findUnprovenNegatives(verdicts);
  if (violations.length > 0) {
    throw new UnprovenNegativeVerdictError(violations.map((v) => v.criterionId));
  }
}
