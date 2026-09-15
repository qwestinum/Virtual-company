/**
 * Fournisseurs d'agenda publié — qui a le droit d'être lu, et vers où l'on
 * accepte d'être redirigé. PUR.
 *
 * Deux listes par fournisseur, et elles ne se confondent pas :
 *   - `hosts`           : les hôtes d'une URL que le recruteur peut coller
 *                          (correspondance EXACTE) ;
 *   - `redirectDomains` : les domaines du fournisseur vers lesquels une
 *                          redirection est SUIVIE (le domaine ou un
 *                          sous-domaine). Un `Location:` qui sort de là n'est
 *                          pas suivi : c'est un cas à part, pas une panne.
 *
 * `accepted: false` : le fournisseur est reconnu mais pas encore mesuré. Le
 * comportement d'une URL dépubliée se MESURE service par service, jamais ne
 * se suppose (règle du 15/09/2026) — tant que ce n'est pas fait, on ne lit pas.
 */

export type CalendarProviderId = 'microsoft' | 'google';

type ProviderDefinition = {
  hosts: readonly string[];
  redirectDomains: readonly string[];
  accepted: boolean;
};

export const CALENDAR_PROVIDERS: Record<CalendarProviderId, ProviderDefinition> = {
  microsoft: {
    hosts: ['outlook.live.com', 'outlook.office365.com', 'outlook.office.com'],
    redirectDomains: ['live.com', 'office365.com', 'office.com', 'outlook.com', 'microsoft.com'],
    accepted: true,
  },
  google: {
    hosts: ['calendar.google.com'],
    redirectDomains: ['google.com'],
    // Bloqué jusqu'à la mesure d'une adresse secrète révoquée et du type servi.
    accepted: false,
  },
};

/**
 * Hôtes dont le comportement À LA DÉPUBLICATION est MESURÉ et prouve qu'une
 * URL dépubliée ne rend jamais un calendrier vide valide. Pour eux, un agenda
 * vide est un agenda vide. Pour tous les autres, une chute brutale à zéro est
 * traitée comme suspecte (révocation silencieuse possible).
 *
 * On n'ajoute un hôte ici que sur PREUVE consignée (docs/specs/agenda-externe.md
 * §14 ter) — jamais par analogie : `outlook.office365.com` n'est pas
 * `outlook.live.com`.
 */
export const UNPUBLISH_MEASURED_HOSTS: readonly string[] = [
  // 15/09/2026 — dépubliée : 302 → /owa/auth/errorFE.aspx?httpCode=404 (même hôte), HTML.
  'outlook.live.com',
];

export function isUnpublishMeasured(hostname: string): boolean {
  return UNPUBLISH_MEASURED_HOSTS.includes(hostname.toLowerCase());
}

/** Fournisseur d'un hôte d'URL collée, ou `null` s'il n'est pas reconnu. */
export function providerForHost(hostname: string): CalendarProviderId | null {
  const host = hostname.toLowerCase();
  for (const id of Object.keys(CALENDAR_PROVIDERS) as CalendarProviderId[]) {
    if (CALENDAR_PROVIDERS[id].hosts.includes(host)) return id;
  }
  return null;
}

/** L'hôte appartient-il aux domaines de CE fournisseur (domaine ou sous-domaine) ? */
export function isProviderDomain(provider: CalendarProviderId, hostname: string): boolean {
  const host = hostname.toLowerCase();
  return CALENDAR_PROVIDERS[provider].redirectDomains.some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
}
