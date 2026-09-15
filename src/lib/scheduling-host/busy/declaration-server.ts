/**
 * Serveur de l'écran « Agenda externe » : garde, état, enregistrement.
 * Partagé par les routes `/api/recruiters/[id]/busy-calendar` (et `/test`).
 *
 * Garde : soi-même ou administrateur — la règle de l'agenda. Un administrateur
 * peut poser ou retirer le lien d'un autre, jamais le relire (aucune route ne
 * le rend).
 */
import { NextResponse } from 'next/server';
import type { User } from '@supabase/supabase-js';

import {
  forbiddenResponse,
  getApiUser,
  isAdminApiUser,
  unauthorizedResponse,
} from '@/lib/auth/require-api-user';
import { normalizeCalendarUrl } from '@/lib/calendar/busy-ics/fetch';
import { getBusySnapshot } from '@/lib/db/repos/busy-snapshots';
import { loadRecruiterCalendarUrl } from '@/lib/db/repos/recruiters';
import { consumeQuota } from '@/lib/jobboard/rate-limit';
import type { Resource } from '@/lib/scheduling';
import type { BusyCalendarStatus } from '@/types/busy-calendar';

import { getRecruiterResource } from '../recruiter-resource';
import { isBusyCalendarActive } from './active';
import { evaluateStoredBusyState } from './evaluate';
import { isBusyCalendarEnabled } from './flag';
import { buildBusyCalendarStatus, providerLabelOf } from './status';

/** Lectures d'essai + enregistrements par recruteur : chacun est une requête sortante. */
export const BUSY_CALENDAR_QUOTA = { limit: 10, windowSeconds: 600 } as const;

/** Réglages de repli quand le recruteur n'a pas encore d'agenda ORQA. */
const FALLBACK_CONTEXT = { timezone: 'Europe/Paris', horizonDays: 30 } as const;

export type Guarded = { user: User } | { response: NextResponse };

/**
 * `{ user }` si l'appel est permis, sinon la réponse à rendre. Le déploiement
 * sans le connecteur n'a pas cette surface : 404, jamais 403 (qui la confirmerait).
 */
export async function guardBusyCalendar(targetId: string): Promise<Guarded> {
  if (!isBusyCalendarEnabled()) return { response: notFound() };
  const user = await getApiUser();
  if (!user) return { response: unauthorizedResponse() };
  if (user.id === targetId || (await isAdminApiUser(user))) return { user };
  return { response: forbiddenResponse() };
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 });
}

export async function consumeBusyCalendarQuota(recruiterId: string): Promise<NextResponse | null> {
  const verdict = await consumeQuota({ key: `busy-calendar:${recruiterId}`, ...BUSY_CALENDAR_QUOTA });
  if (verdict.allowed) return null;
  const minutes = Math.max(1, Math.ceil(verdict.retryAfterSeconds / 60));
  return NextResponse.json(
    { ok: false, message: `Trop d’essais rapprochés. Réessaie dans ${minutes} min.` },
    { status: 429, headers: { 'Retry-After': String(verdict.retryAfterSeconds) } },
  );
}

/** Fuseau et horizon du recruteur, ou des valeurs sûres s'il n'a pas encore d'agenda. */
export async function probeContextFor(recruiterId: string): Promise<{
  resource: Resource | null;
  timezone: string;
  horizonDays: number;
}> {
  const resource = await getRecruiterResource(recruiterId);
  return {
    resource,
    timezone: resource?.timezone ?? FALLBACK_CONTEXT.timezone,
    horizonDays: resource?.horizonDays ?? FALLBACK_CONTEXT.horizonDays,
  };
}

export async function loadBusyCalendarStatus(recruiterId: string, nowMs = Date.now()): Promise<BusyCalendarStatus> {
  const [available, source, snapshot, context] = await Promise.all([
    isBusyCalendarActive(),
    loadRecruiterCalendarUrl(recruiterId).catch(() => ({ kind: 'unreadable' as const })),
    getBusySnapshot(recruiterId).catch(() => null),
    probeContextFor(recruiterId),
  ]);
  const configured = source.kind !== 'none';
  // L'hôte seulement, pour dire « Outlook » : l'URL ne quitte pas cette fonction.
  const providerLabel =
    source.kind === 'url'
      ? (() => {
          const normalized = normalizeCalendarUrl(source.url);
          return normalized.ok ? providerLabelOf(normalized.provider) : null;
        })()
      : null;

  const evaluated =
    snapshot && (snapshot.readAt || snapshot.failingSince)
      ? context.resource
        ? (await evaluateStoredBusyState(snapshot, context.resource, nowMs)).state
        : snapshot.failingSince
          ? 'blocked'
          : 'healthy'
      : null;

  return buildBusyCalendarStatus({
    available,
    configured,
    providerLabel,
    snapshot,
    evaluatedState: evaluated,
    nowMs,
  });
}
