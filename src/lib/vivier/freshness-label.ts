/**
 * Libellé de fraîcheur relatif d'un dossier vivier (« il y a 4 mois »).
 * Partagé par les vues présélection (V2) et validation (V3). Client/serveur.
 */
const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;

export function freshnessLabel(updatedAt: string): string {
  const d = Date.parse(updatedAt);
  if (Number.isNaN(d)) return '—';
  const months = Math.floor((Date.now() - d) / MS_PER_MONTH);
  if (months <= 0) return 'ce mois-ci';
  if (months === 1) return 'il y a 1 mois';
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return years === 1 ? 'il y a 1 an' : `il y a ${years} ans`;
}
