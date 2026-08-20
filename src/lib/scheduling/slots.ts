/**
 * Moteur de créneaux — FONCTION PURE, aucune base, aucune horloge implicite.
 *
 * Règles hebdomadaires (heure LOCALE de la ressource)
 *   − exceptions datées
 *   − réservations confirmées (élargies du buffer)
 *   − préavis minimum
 *   − horizon
 *   = créneaux offerts, en UTC.
 *
 * Pourquoi l'heure locale : « lundi 9h-12h » doit rester 9h-12h été comme
 * hiver. Stocker des instants UTC ferait dériver la grille d'une heure à
 * chaque changement d'heure. On expanse donc jour LOCAL par jour LOCAL et on
 * convertit chaque heure murale en instant via Luxon — JAMAIS d'arithmétique
 * d'offset à la main.
 *
 * Deux pièges de changement d'heure, traités explicitement :
 *   - heure locale INEXISTANTE (passage à l'heure d'été : 02:30 n'existe pas)
 *     → Luxon décale silencieusement à 03:30. On DÉTECTE et on ÉCARTE : mieux
 *     vaut un créneau en moins qu'un rendez-vous à une heure jamais proposée.
 *   - heure locale AMBIGUË (retour à l'heure d'hiver : 02:30 arrive deux fois)
 *     → Luxon retient la PREMIÈRE occurrence. Déterministe, et documenté.
 */
import { DateTime } from 'luxon';

import type {
  AvailabilityException,
  BusyInterval,
  Slot,
  WeeklyRuleInput,
} from './types';

export type SlotEngineInput = {
  /** Fuseau IANA de la ressource. */
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
  rules: WeeklyRuleInput[];
  exceptions: AvailabilityException[];
  /** Réservations confirmées à éviter (UTC ISO). */
  busy: BusyInterval[];
  /** Fenêtre demandée (UTC ISO). */
  from: string;
  to: string;
  /** Instant de référence (UTC ISO) — injecté, jamais `new Date()` ici. */
  now: string;
};

/** Plage de minutes locales depuis minuit : [start, end). */
type MinuteRange = { start: number; end: number };

const MS_PER_MINUTE = 60_000;

export function computeSlots(input: SlotEngineInput): Slot[] {
  const zone = input.timezone;
  if (!DateTime.now().setZone(zone).isValid) {
    throw new Error(`invalid_timezone: ${zone}`);
  }
  if (input.slotDurationMinutes <= 0) return [];

  const now = DateTime.fromISO(input.now, { zone: 'utc' });
  const from = DateTime.fromISO(input.from, { zone: 'utc' });
  const to = DateTime.fromISO(input.to, { zone: 'utc' });
  if (!now.isValid || !from.isValid || !to.isValid) {
    throw new Error('invalid_window: from/to/now doivent être des ISO valides');
  }

  // Bornes effectives : le préavis repousse le début, l'horizon coupe la fin.
  const earliest = maxDateTime(from, now.plus({ minutes: input.minNoticeMinutes }));
  const latest = minDateTime(to, now.plus({ days: input.horizonDays }));
  if (earliest > latest) return [];

  const rulesByWeekday = groupRulesByWeekday(input.rules);
  const exceptionsByDay = groupExceptionsByDay(input.exceptions);
  const busy = normalizeBusy(input.busy);

  const step = input.slotDurationMinutes + input.bufferMinutes;
  const bufferMs = input.bufferMinutes * MS_PER_MINUTE;
  const earliestMs = earliest.toMillis();
  const latestMs = latest.toMillis();

  const slots: Slot[] = [];
  const seen = new Set<string>();

  // Itération sur les jours LOCAUX (bornes incluses) : `plus({ days: 1 })` fait
  // de l'arithmétique calendaire — il reste à minuit local même le jour d'un
  // changement d'heure (ce qu'un `+24h` en millisecondes raterait).
  const lastDay = latest.setZone(zone).startOf('day');
  let day = earliest.setZone(zone).startOf('day');
  let guard = 0;
  const maxDays = Math.max(1, Math.ceil(latest.diff(earliest, 'days').days) + 3);

  while (day <= lastDay && guard++ <= maxDays) {
    const isoDay = day.toISODate();
    const dayExceptions = isoDay ? (exceptionsByDay.get(isoDay) ?? []) : [];
    const ranges = availableRangesForDay(
      rulesByWeekday.get(day.weekday) ?? [],
      dayExceptions,
    );

    for (const range of ranges) {
      for (
        let minute = range.start;
        minute + input.slotDurationMinutes <= range.end;
        minute += step
      ) {
        const start = wallClockToInstant(day, minute, zone);
        if (!start) continue; // heure locale inexistante (passage à l'heure d'été)

        const startMs = start.toMillis();
        if (startMs < earliestMs || startMs > latestMs) continue;

        const endMs = startMs + input.slotDurationMinutes * MS_PER_MINUTE;
        if (overlapsBusy(startMs, endMs, busy, bufferMs)) continue;

        const startAt = new Date(startMs).toISOString();
        if (seen.has(startAt)) continue; // règles qui se recouvrent
        seen.add(startAt);
        slots.push({ startAt, endAt: new Date(endMs).toISOString() });
      }
    }
    day = day.plus({ days: 1 });
  }

  slots.sort((a, b) => a.startAt.localeCompare(b.startAt));
  return slots;
}

/**
 * Le créneau demandé fait-il partie de l'offre ? Revalidation de la séquence
 * de confirmation : on recalcule la journée locale concernée et on exige une
 * correspondance EXACTE — jamais « à peu près le bon horaire ».
 */
export function findOfferedSlot(
  input: Omit<SlotEngineInput, 'from' | 'to'>,
  startAtIso: string,
): Slot | null {
  const start = DateTime.fromISO(startAtIso, { zone: 'utc' });
  if (!start.isValid) return null;

  const localDay = start.setZone(input.timezone);
  const slots = computeSlots({
    ...input,
    from: localDay.startOf('day').toUTC().toISO() ?? startAtIso,
    to: localDay.endOf('day').toUTC().toISO() ?? startAtIso,
  });
  const target = start.toMillis();
  return slots.find((slot) => Date.parse(slot.startAt) === target) ?? null;
}

// ─── Helpers purs ───────────────────────────────────────────────────────

/**
 * Heure murale → instant. `null` si l'heure locale N'EXISTE PAS ce jour-là :
 * Luxon la décale en silence (02:30 → 03:30 au passage à l'heure d'été), on
 * compare donc ce qu'on a demandé à ce qu'on a obtenu.
 */
function wallClockToInstant(
  day: DateTime,
  minute: number,
  zone: string,
): DateTime | null {
  const candidate = DateTime.fromObject(
    {
      year: day.year,
      month: day.month,
      day: day.day,
      hour: Math.floor(minute / 60),
      minute: minute % 60,
    },
    { zone },
  );
  if (!candidate.isValid) return null;
  if (candidate.hour * 60 + candidate.minute !== minute) return null;
  if (candidate.day !== day.day) return null;
  return candidate;
}

function groupRulesByWeekday(rules: WeeklyRuleInput[]): Map<number, MinuteRange[]> {
  const map = new Map<number, MinuteRange[]>();
  for (const rule of rules) {
    if (rule.startMinute >= rule.endMinute) continue;
    const list = map.get(rule.weekday) ?? [];
    list.push({ start: rule.startMinute, end: rule.endMinute });
    map.set(rule.weekday, list);
  }
  return map;
}

function groupExceptionsByDay(
  exceptions: AvailabilityException[],
): Map<string, AvailabilityException[]> {
  const map = new Map<string, AvailabilityException[]>();
  for (const exception of exceptions) {
    const list = map.get(exception.day) ?? [];
    list.push(exception);
    map.set(exception.day, list);
  }
  return map;
}

/** Règles du jour moins les exceptions. Journée entière ⇒ plus rien. */
function availableRangesForDay(
  rules: MinuteRange[],
  exceptions: AvailabilityException[],
): MinuteRange[] {
  if (rules.length === 0) return [];
  const fullDay = exceptions.some(
    (e) => e.startMinute === null || e.endMinute === null,
  );
  if (fullDay) return [];

  const cuts = exceptions
    .filter((e) => e.startMinute !== null && e.endMinute !== null)
    .map((e) => ({ start: e.startMinute as number, end: e.endMinute as number }));

  return cuts.reduce<MinuteRange[]>(
    (ranges, cut) => ranges.flatMap((range) => subtractRange(range, cut)),
    rules,
  );
}

/** [start,end) moins [cut.start,cut.end) — 0, 1 ou 2 morceaux. */
function subtractRange(range: MinuteRange, cut: MinuteRange): MinuteRange[] {
  if (cut.end <= range.start || cut.start >= range.end) return [range];
  const pieces: MinuteRange[] = [];
  if (cut.start > range.start) pieces.push({ start: range.start, end: cut.start });
  if (cut.end < range.end) pieces.push({ start: cut.end, end: range.end });
  return pieces;
}

function normalizeBusy(busy: BusyInterval[]): { start: number; end: number }[] {
  return busy
    .map((b) => ({ start: Date.parse(b.startAt), end: Date.parse(b.endAt) }))
    .filter((b) => Number.isFinite(b.start) && Number.isFinite(b.end));
}

/**
 * Le buffer entoure les rendez-vous PRIS : un créneau collé à un RDV existant
 * (avant ou après) est écarté. C'est la mitigation du risque « salle visio
 * partagée entre deux invités consécutifs ».
 */
function overlapsBusy(
  startMs: number,
  endMs: number,
  busy: { start: number; end: number }[],
  bufferMs: number,
): boolean {
  return busy.some((b) => startMs < b.end + bufferMs && b.start < endMs + bufferMs);
}

function maxDateTime(a: DateTime, b: DateTime): DateTime {
  return a > b ? a : b;
}

function minDateTime(a: DateTime, b: DateTime): DateTime {
  return a < b ? a : b;
}
