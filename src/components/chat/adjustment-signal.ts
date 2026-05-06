/**
 * Détection des chips d'ajustement vague — pour les distinguer des chips
 * à valeur explicite (« Plus haut (60-75K) », « junior », « Septembre
 * 2026 »). Un signal d'ajustement ne doit pas déclencher un tour LLM :
 * il doit juste rendre la main au DRH dans le textarea.
 *
 * Match insensible à la casse, aux accents, à la ponctuation
 * éventuelle, et qui couvre les formulations courantes du Manager.
 */

const ADJUSTMENT_KEYWORDS = [
  'ajuster',
  'modifier',
  'preciser',
  'reformuler',
  'changer',
  'autre',
  'autres',
  'pas vraiment',
  'plutot pas',
  'non',
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

export function isAdjustmentSignal(option: string): boolean {
  const norm = normalize(option);
  if (norm.length === 0) return false;
  return ADJUSTMENT_KEYWORDS.some((kw) => norm === kw || norm.startsWith(`${kw} `));
}
