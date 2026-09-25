/**
 * Mode HYBRIDE de l'analyse des CV — PUR (25/09/2026).
 *
 * `CV_ANALYZER_LEDGER_MODEL` (ex. `gpt-4o-mini`) : le RELEVÉ DE FAITS part sur
 * ce modèle, les verdicts, l'extraction candidat et la narration restent sur
 * le modèle par défaut. Absente ⇒ rien ne change.
 *
 * Mesuré (docs/ops/comparaison-modeles-scoring.md §6quinquies) sur 195 CV
 * client : 0 basculement accepté ↔ refus, rédhibitoires identiques, écart de
 * score dans le bruit, −30 % de coût ; et, sur les CV de recette, les
 * citations non tenables tombent de ~17-25 % à ~4 % — le relevé de gpt-4o,
 * normalisé, était recopié dans les citations.
 *
 * Allume AUSSI la garde « aucun oui sans preuve » (`quote-evidence.ts`) : les
 * deux vont ensemble, jamais la garde seule (décision du 25/09/2026).
 *
 * ⚠️ Ne vaut que pour le fournisseur OpenAI : en mode Anthropic, un nom de
 * modèle OpenAI partirait chez Anthropic et échouerait. On l'ignore alors.
 * ⚠️ Changer ce réglage change des verdicts : se valider d'abord par
 * `npm run compare:models` (bras `ledger=`), qui sert de non-régression.
 */
type Env = Readonly<Record<string, string | undefined>>;

export function ledgerModelFromEnv(env: Env): string | undefined {
  const model = env.CV_ANALYZER_LEDGER_MODEL?.trim();
  if (!model) return undefined;
  const provider = (env.CV_ANALYZER_PROVIDER ?? 'openai').trim().toLowerCase();
  return provider === 'openai' ? model : undefined;
}
