/**
 * « Aucun oui sans preuve » — contrôle des citations d'un verdict. PUR.
 *
 * Symétrique de `verdict-integrity` (« aucun non sans lecture ») : un verdict
 * POSITIF (`satisfait`, `partiel`) du modèle n'est recevable que si la
 * citation qui le fonde se RETROUVE dans le CV. Sinon il est rétrogradé en
 * `non_verifiable` — pour tout modèle, par le code, après la réponse.
 *
 * Constat qui l'a motivé (comparaison de modèles, 25/09/2026) : 17 % des
 * citations de gpt-4o et 19 % de celles de gpt-4o-mini ne se retrouvaient pas
 * dans le CV (un mot changé, deux lignes recollées). Un « satisfait » dont la
 * preuve n'existe pas telle quelle n'est pas une preuve.
 *
 * ⚠️ Ce que la garde NE fait PAS : juger la PERTINENCE d'une citation exacte.
 * Une vraie ligne du CV citée pour un critère qu'elle ne prouve pas (« conçu
 * des parcours clients » pour « sensibilité UX ») passe le contrôle — c'est le
 * défaut principal de gpt-4o-mini au même run, et il relève du prompt, pas
 * d'un contrôle de chaînes.
 *
 * ⚠️ Conséquence sur un RÉDHIBITOIRE : `non_verifiable` y vaut un échec dur ⇒
 * le dossier passe en refus PROPOSÉ (mis en file, rien n'est envoyé — aucun
 * refus ne part sans validation humaine).
 */
import type { LlmCriterionVerdict } from './score-candidat';

/**
 * Normalisation pour la recherche « mot pour mot » : forme de compatibilité
 * (ligatures « ﬁ », espaces insécables — ce qu'une extraction PDF laisse),
 * casse, espaces, apostrophes, guillemets, tirets. Rien d'autre : un mot
 * différent reste différent.
 */
export function normalizeForQuote(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    // Les guillemets disparaissent : « Trade Finance » (espaces français) et
    // "Trade Finance" disent la même chose.
    .replace(/[“”«»"]/g, ' ')
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * La citation se retrouve-t-elle dans le CV ? Une citation avec ellipse
 * (« … » ou « ... ») est jugée fragment par fragment, chacun devant s'y
 * trouver. Ponctuation de BORD ignorée (le modèle termine volontiers par un
 * point que la ligne du CV n'a pas, ou reprend une puce). Citation vide ⇒
 * `null` : rien à vérifier.
 */
export function quoteFoundInCv(quote: string, cvText: string): boolean | null {
  const q = quote.replace(/^["«\s]+|["»\s]+$/g, '');
  if (q.trim() === '') return null;
  const cv = normalizeForQuote(cvText);
  const fragments = q
    .split(/…|\.\.\./)
    .map((f) => normalizeForQuote(f).replace(/^[\s(\-•·*]+/, '').replace(/[\s.,;:!?)]+$/, ''))
    .filter((f) => f.length > 0);
  if (fragments.length === 0) return null;
  return fragments.every((f) => cv.includes(f));
}

export type EvidenceDowngradeReason = 'missing_quote' | 'quote_not_found';

const REASON_TEXT: Record<EvidenceDowngradeReason, string> = {
  missing_quote: 'aucune citation du CV fournie',
  quote_not_found: 'la citation fournie ne se retrouve pas dans le CV',
};

/**
 * Applique la garde aux verdicts RENDUS PAR LE MODÈLE (`decidedBy: 'llm'`).
 * Les verdicts déterministes (mot-clé trouvé) portent une citation construite
 * par le code à partir du CV : ils n'ont rien à prouver ici.
 */
export function enforceQuotedEvidence(verdicts: LlmCriterionVerdict[], cvText: string): LlmCriterionVerdict[] {
  return verdicts.map((v) => {
    if (v.decidedBy !== 'llm') return v;
    if (v.llmDecision !== 'satisfait' && v.llmDecision !== 'partiel') return v;
    const found = quoteFoundInCv(v.llmCVQuote, cvText);
    if (found === true) return v;
    const reason: EvidenceDowngradeReason = found === null ? 'missing_quote' : 'quote_not_found';
    return {
      ...v,
      llmDecision: 'non_verifiable',
      llmJustification: `Verdict « ${v.llmDecision} » non retenu : ${REASON_TEXT[reason]}. (${v.llmJustification})`,
      // Une chaîne qui n'est pas dans le CV n'est pas une citation du CV.
      llmCVQuote: '',
      evidenceDowngrade: { from: v.llmDecision, reason },
    };
  });
}
