/**
 * Formatage de date/heure pour l'affichage (FR). Pur.
 *
 * Rendu dans le fuseau LOCAL du navigateur (composants client) — c'est l'heure
 * attendue par l'utilisateur qui regarde l'écran. `'—'` pour une entrée
 * absente ou non parsable (jamais « Invalid Date » à l'écran).
 */

/** Date + heure courte FR : « 23/06/2026 14:30 ». `'—'` si absent/invalide. */
export function formatDateTimeFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
