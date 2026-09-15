/**
 * Source d'indisponibilités du module de réservation : l'agenda publié du
 * recruteur (ICS). C'est l'ADAPTATEUR — le module ne sait rien d'une URL,
 * d'un fournisseur ni d'un format ; il reçoit des bornes.
 *
 * Chaîne d'une lecture : URL chiffrée de la fiche → déchiffrement → lecture
 * HTTP (règle d'acceptation, redirections contrôlées) → parseur en liste
 * blanche → intervalles. À chaque étage, un échec rend `unavailable` — jamais
 * `ok` avec une liste vide, jamais un message qui porterait l'URL.
 *
 * Lot A : pas encore d'instantané en base. Chaque lecture est donc FRAÎCHE,
 * quelle que soit la fraîcheur demandée, et un échec n'a pas de « dernière
 * copie » à proposer (`lastGood: null`). La tolérance arrive au lot B,
 * l'instantané et la relève périodique au lot C.
 *
 * Spec : docs/specs/agenda-externe.md §5.
 */
import { fetchBusyCalendar, type CalendarFetchResult } from '@/lib/calendar/busy-ics/fetch';
import { parseBusyIcs } from '@/lib/calendar/busy-ics/parse';
import type { RecruiterCalendarUrl } from '@/lib/db/repos/recruiters';
import type { BusyProvider, ExternalBusyAnswer, ExternalBusyRequest } from '@/lib/scheduling';

export type IcsBusyProviderDeps = {
  /** URL en clair de la ressource (clé externe = identifiant du recruteur). */
  loadCalendarUrl(resourceExternalRef: string): Promise<RecruiterCalendarUrl>;
  fetchCalendar?: (url: string) => Promise<CalendarFetchResult>;
  now?: () => Date;
};

export function createIcsBusyProvider(deps: IcsBusyProviderDeps): BusyProvider {
  const fetchCalendar = deps.fetchCalendar ?? ((url: string) => fetchBusyCalendar(url));
  const now = deps.now ?? (() => new Date());

  return {
    async read(request: ExternalBusyRequest): Promise<ExternalBusyAnswer> {
      const unavailable = (): ExternalBusyAnswer => ({
        kind: 'unavailable',
        lastGood: null,
        failingSince: now().toISOString(),
      });

      let source: RecruiterCalendarUrl;
      try {
        source = await deps.loadCalendarUrl(request.resource.externalRef);
      } catch {
        return unavailable();
      }
      if (source.kind === 'none') return { kind: 'not_configured' };
      if (source.kind === 'unreadable') return unavailable();

      let fetched: CalendarFetchResult;
      try {
        fetched = await fetchCalendar(source.url);
      } catch {
        return unavailable();
      }
      if (!fetched.ok) return unavailable();

      const parsed = parseBusyIcs(fetched.body, {
        from: request.from,
        to: request.to,
        fallbackZone: request.resource.timezone,
      });
      if (!parsed.ok) return unavailable();

      return { kind: 'ok', intervals: parsed.intervals, readAt: now().toISOString() };
    },
  };
}
