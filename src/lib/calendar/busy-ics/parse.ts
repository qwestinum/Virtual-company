/**
 * Flux iCalendar → intervalles OCCUPÉS, en UTC. PUR : ni réseau, ni base,
 * ni horloge.
 *
 * LISTE BLANCHE. Seules les propriétés qui disent QUAND sont lues :
 * DTSTART, DTEND, DURATION, RRULE, RDATE, EXDATE, RECURRENCE-ID, STATUS,
 * TRANSP, X-MICROSOFT-CDO-BUSYSTATUS, et les définitions VTIMEZONE. Aucun
 * titre (SUMMARY, quel qu'il soit), aucun participant, aucun lieu, aucune
 * description n'est lu — seule la PRÉSENCE de DESCRIPTION / LOCATION /
 * ATTENDEE est constatée, pour pouvoir dire au recruteur que son lien publie
 * le détail de ses rendez-vous. Rien d'autre que des bornes ne sort d'ici :
 * le texte du flux est lâché au retour de la fonction.
 *
 * Toute erreur de lecture rend un ÉCHEC, jamais une liste partielle : un
 * agenda lu à moitié est un agenda qui ment.
 *
 * Spec : docs/specs/agenda-externe.md §2.
 */
import ICAL from 'ical.js';
import { DateTime } from 'luxon';

import type { BusyInterval } from '@/lib/scheduling';

export type BusyParseOptions = {
  /** Fenêtre utile, UTC ISO. Tout ce qui en sort est découpé ou écarté. */
  from: string;
  to: string;
  /** Fuseau de la ressource : journées entières, heures flottantes, TZID inconnu. */
  fallbackZone: string;
};

export type BusyParseFailure = 'parse_error' | 'recurrence_overflow';

export type BusyParseResult =
  | {
      ok: true;
      /** Triés, fusionnés, découpés à la fenêtre. */
      intervals: BusyInterval[];
      /** Occurrences bloquantes rencontrées dans la fenêtre (avant fusion). */
      occurrenceCount: number;
      /** Événements dont le fuseau déclaré était inconnu (heure prise dans le fuseau de repli). */
      tzAssumed: number;
      /** Le flux publie le détail des rendez-vous (présence constatée, valeurs jamais lues). */
      carriesDetails: boolean;
    }
  | { ok: false; code: BusyParseFailure };

/** Occurrences retenues dans la fenêtre, par événement. */
export const MAX_OCCURRENCES_IN_WINDOW = 2_000;
/**
 * Itérations d'une récurrence, depuis son origine. Une réunion quotidienne
 * posée il y a dix ans en consomme ~3 650 avant d'atteindre la fenêtre : la
 * borne protège d'une règle pathologique, pas d'un agenda ancien.
 */
export const MAX_RECURRENCE_ITERATIONS = 100_000;

const DAY_MS = 86_400_000;

type Zones = Map<string, ICAL.Timezone>;
type Wall = { year: number; month: number; day: number; hour: number; minute: number; second: number };
type Counters = { tzAssumed: number };

class RecurrenceOverflow extends Error {}

export function parseBusyIcs(text: string, options: BusyParseOptions): BusyParseResult {
  const fromMs = Date.parse(options.from);
  const toMs = Date.parse(options.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return { ok: false, code: 'parse_error' };
  }

  let calendar: ICAL.Component;
  try {
    calendar = new ICAL.Component(ICAL.parse(text));
  } catch {
    return { ok: false, code: 'parse_error' };
  }
  if (calendar.name !== 'vcalendar') return { ok: false, code: 'parse_error' };

  try {
    const zones = readZones(calendar);
    const events = calendar.getAllSubcomponents('vevent');
    const counters: Counters = { tzAssumed: 0 };
    const ctx = { zones, counters, fallbackZone: options.fallbackZone, fromMs, toMs };

    const carriesDetails = events.some(
      (event) =>
        event.hasProperty('description') ||
        event.hasProperty('location') ||
        event.hasProperty('attendee'),
    );

    // Occurrences surchargées (RECURRENCE-ID) : l'horaire d'origine disparaît,
    // la surcharge est traitée comme un événement à part entière.
    const overridden = new Map<string, Set<number>>();
    for (const event of events) {
      const recurrenceId = event.getFirstProperty('recurrence-id');
      if (!recurrenceId) continue;
      const uid = String(event.getFirstPropertyValue('uid') ?? '');
      const originMs = propertyStartMs(recurrenceId, ctx);
      if (originMs === null) continue;
      const set = overridden.get(uid) ?? new Set<number>();
      set.add(originMs);
      overridden.set(uid, set);
    }

    const raw: { start: number; end: number }[] = [];
    let occurrenceCount = 0;
    for (const event of events) {
      if (!isBlocking(event)) continue;
      const uid = String(event.getFirstPropertyValue('uid') ?? '');
      const skip = event.hasProperty('recurrence-id') ? undefined : overridden.get(uid);
      const occurrences = expandEvent(event, ctx, skip);
      occurrenceCount += occurrences.length;
      raw.push(...occurrences);
    }

    return {
      ok: true,
      intervals: mergeAndClip(raw, fromMs, toMs),
      occurrenceCount,
      tzAssumed: counters.tzAssumed,
      carriesDetails,
    };
  } catch (err) {
    return { ok: false, code: err instanceof RecurrenceOverflow ? 'recurrence_overflow' : 'parse_error' };
  }
}

// ─── Statut ─────────────────────────────────────────────────────────────

/**
 * « Disponible » et « travail ailleurs » ne bloquent pas ; « provisoire »
 * bloque (un créneau en moins vaut mieux qu'un double rendez-vous). Le statut
 * Outlook, quand il est là, prime sur TRANSP : c'est lui que l'utilisateur a
 * choisi.
 */
function isBlocking(event: ICAL.Component): boolean {
  const status = upper(event.getFirstPropertyValue('status'));
  if (status === 'CANCELLED') return false;
  const busy = upper(event.getFirstPropertyValue('x-microsoft-cdo-busystatus'));
  if (busy === 'FREE' || busy === 'WORKINGELSEWHERE') return false;
  if (busy === 'BUSY' || busy === 'OOF' || busy === 'TENTATIVE') return true;
  return upper(event.getFirstPropertyValue('transp')) !== 'TRANSPARENT';
}

function upper(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

// ─── Expansion ──────────────────────────────────────────────────────────

type Ctx = {
  zones: Zones;
  counters: Counters;
  fallbackZone: string;
  fromMs: number;
  toMs: number;
};

function expandEvent(
  event: ICAL.Component,
  ctx: Ctx,
  skipOrigins: Set<number> | undefined,
): { start: number; end: number }[] {
  const startProp = event.getFirstProperty('dtstart');
  if (!startProp) return [];
  const dtstart = startProp.getFirstValue();
  if (!(dtstart instanceof ICAL.Time)) return [];
  const tzid = tzidOf(startProp);

  const firstStart = timeToMs(dtstart, tzid, ctx, true);
  if (firstStart === null) return [];
  const span = spanOf(event, dtstart, firstStart, ctx);
  if (span === null) return [];
  const endOf = (occurrence: ICAL.Time, start: number): number | null =>
    span.kind === 'ms' ? start + span.ms : addLocalDays(occurrence, span.days, ctx.fallbackZone);

  const recurring = event.hasProperty('rrule') || event.hasProperty('rdate');
  if (!recurring) {
    const end = endOf(dtstart, firstStart);
    return end !== null && end > firstStart && overlaps(firstStart, end, ctx)
      ? [{ start: firstStart, end }]
      : [];
  }

  const out: { start: number; end: number }[] = [];
  const expansion = new ICAL.RecurExpansion({ component: event, dtstart });
  let iterations = 0;
  for (let next = expansion.next(); next; next = expansion.next()) {
    if (++iterations > MAX_RECURRENCE_ITERATIONS) throw new RecurrenceOverflow();
    // Le compteur de fuseau inconnu ne compte qu'une fois par événement.
    const start = timeToMs(next, tzid, ctx, false);
    if (start === null) continue;
    if (start >= ctx.toMs) break;
    if (skipOrigins?.has(start)) continue;
    const end = endOf(next, start);
    if (end === null || end <= start || !overlaps(start, end, ctx)) continue;
    out.push({ start, end });
    if (out.length > MAX_OCCURRENCES_IN_WINDOW) throw new RecurrenceOverflow();
  }
  return out;
}

type Span = { kind: 'ms'; ms: number } | { kind: 'days'; days: number };

/**
 * Étendue d'une occurrence. Une journée entière se compte en JOURS CIVILS du
 * fuseau de repli (un jour de changement d'heure dure 23 ou 25 h — une durée
 * fixe décalerait les occurrences suivantes d'une heure). Date-heure sans
 * fin ⇒ durée nulle (RFC 5545), donc ignorée ; journée sans fin ⇒ un jour.
 */
function spanOf(event: ICAL.Component, dtstart: ICAL.Time, startMs: number, ctx: Ctx): Span | null {
  const endProp = event.getFirstProperty('dtend');
  const end = endProp?.getFirstValue();
  if (dtstart.isDate) {
    if (end instanceof ICAL.Time) {
      const days = Math.round(
        (Date.UTC(end.year, end.month - 1, end.day) -
          Date.UTC(dtstart.year, dtstart.month - 1, dtstart.day)) /
          DAY_MS,
      );
      return { kind: 'days', days };
    }
    const duration = event.getFirstPropertyValue('duration');
    if (duration instanceof ICAL.Duration) {
      return { kind: 'days', days: Math.max(1, Math.round(duration.toSeconds() / 86_400)) };
    }
    return { kind: 'days', days: 1 };
  }
  if (endProp) {
    if (!(end instanceof ICAL.Time)) return null;
    const endMs = timeToMs(end, tzidOf(endProp), ctx, false);
    return endMs === null ? null : { kind: 'ms', ms: endMs - startMs };
  }
  const duration = event.getFirstPropertyValue('duration');
  if (duration instanceof ICAL.Duration) return { kind: 'ms', ms: duration.toSeconds() * 1000 };
  return { kind: 'ms', ms: 0 };
}

/** Minuit local du jour `occurrence + days`, dans le fuseau de repli. */
function addLocalDays(occurrence: ICAL.Time, days: number, zone: string): number | null {
  const dt = DateTime.fromObject(
    { year: occurrence.year, month: occurrence.month, day: occurrence.day },
    { zone },
  ).plus({ days });
  return dt.isValid ? dt.toMillis() : null;
}

function propertyStartMs(property: ICAL.Property, ctx: Ctx): number | null {
  const value = property.getFirstValue();
  return value instanceof ICAL.Time ? timeToMs(value, tzidOf(property), ctx, false) : null;
}

// ─── Fuseaux ────────────────────────────────────────────────────────────

function readZones(calendar: ICAL.Component): Zones {
  const zones: Zones = new Map();
  for (const component of calendar.getAllSubcomponents('vtimezone')) {
    const tzid = component.getFirstPropertyValue('tzid');
    if (typeof tzid !== 'string') continue;
    try {
      zones.set(tzid, new ICAL.Timezone(component));
    } catch {
      // Définition illisible : le TZID retombera sur Luxon ou le fuseau de repli.
    }
  }
  return zones;
}

function tzidOf(property: ICAL.Property): string | null {
  const tzid = property.getParameter('tzid');
  return typeof tzid === 'string' && tzid.trim() ? tzid.trim() : null;
}

/**
 * Heure iCalendar → instant UTC. Ordre de résolution :
 *   1. `Z` (UTC) — tel quel ;
 *   2. VTIMEZONE embarqué — les TZID Windows d'Outlook (« Romance Standard Time ») ;
 *   3. TZID IANA connu de Luxon — Google omet parfois le bloc ;
 *   4. TZID inconnu — fuseau de repli, et on le COMPTE ;
 *   5. heure flottante ou journée entière — fuseau de repli (RFC 5545).
 */
function timeToMs(time: ICAL.Time, tzid: string | null, ctx: Ctx, count: boolean): number | null {
  const wall: Wall = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
    second: time.isDate ? 0 : time.second,
  };
  if (time.isDate) return wallToMs(wall, ctx.fallbackZone);
  if (time.zone === ICAL.Timezone.utcTimezone) {
    return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  }
  if (tzid) {
    const embedded = ctx.zones.get(tzid);
    if (embedded) {
      const local = time.clone();
      local.zone = embedded;
      return local.toUnixTime() * 1000;
    }
    const iana = wallToMs(wall, tzid);
    if (iana !== null) return iana;
    if (count) ctx.counters.tzAssumed += 1;
  }
  return wallToMs(wall, ctx.fallbackZone);
}

function wallToMs(wall: Wall, zone: string): number | null {
  const dt = DateTime.fromObject(wall, { zone });
  return dt.isValid ? dt.toMillis() : null;
}

// ─── Intervalles ────────────────────────────────────────────────────────

function overlaps(start: number, end: number, ctx: Ctx): boolean {
  return start < ctx.toMs && end > ctx.fromMs;
}

function mergeAndClip(raw: { start: number; end: number }[], fromMs: number, toMs: number): BusyInterval[] {
  const clipped = raw
    .map((r) => ({ start: Math.max(r.start, fromMs), end: Math.min(r.end, toMs) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);

  const merged: { start: number; end: number }[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (last && interval.start <= last.end) {
      last.end = Math.max(last.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  return merged.map((r) => ({
    startAt: new Date(r.start).toISOString(),
    endAt: new Date(r.end).toISOString(),
  }));
}
