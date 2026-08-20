/**
 * Ressources réservables : identité, réglages de créneau, règles hebdo,
 * exceptions datées, et l'assemblage des données que consomme le moteur.
 *
 * Une ressource est une PERSONNE (ou un poste) qui tient des rendez-vous. Le
 * module ne sait pas laquelle : il n'en connaît que la clé opaque de l'hôte.
 */
import { computeSlots, type SlotEngineInput } from './slots';
import { assertOk, fetchAllKeyset, table } from './store';
import { nowIso } from './runtime';
import {
  TABLES,
  toException,
  toResource,
  toWeeklyRule,
  type ExceptionRow,
  type ResourceRow,
  type RuleRow,
} from './rows';
import type {
  AvailabilityException,
  AvailabilityExceptionInput,
  BusyInterval,
  Resource,
  ResourceInput,
  ResourcePatch,
  Slot,
  WeeklyRule,
  WeeklyRuleInput,
} from './types';

const RESOURCE_COLUMNS =
  'id, external_ref, display_name, timezone, slot_duration_minutes, buffer_minutes, ' +
  'min_notice_minutes, horizon_days, meeting_location, notify_email, is_active, ' +
  'created_at, updated_at';

export async function createResource(input: ResourceInput): Promise<Resource> {
  const { data, error } = await table(TABLES.resources)
    .insert({
      external_ref: input.externalRef,
      display_name: input.displayName,
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.slotDurationMinutes !== undefined
        ? { slot_duration_minutes: input.slotDurationMinutes }
        : {}),
      ...(input.bufferMinutes !== undefined
        ? { buffer_minutes: input.bufferMinutes }
        : {}),
      ...(input.minNoticeMinutes !== undefined
        ? { min_notice_minutes: input.minNoticeMinutes }
        : {}),
      ...(input.horizonDays !== undefined ? { horizon_days: input.horizonDays } : {}),
      meeting_location: input.meetingLocation ?? null,
      notify_email: input.notifyEmail ?? null,
    })
    .select(RESOURCE_COLUMNS)
    .single<ResourceRow>();
  assertOk('createResource', error);
  return toResource(data as ResourceRow);
}

export async function getResource(externalRef: string): Promise<Resource | null> {
  const { data, error } = await table(TABLES.resources)
    .select(RESOURCE_COLUMNS)
    .eq('external_ref', externalRef)
    .maybeSingle<ResourceRow>();
  assertOk('getResource', error);
  return data ? toResource(data) : null;
}

export async function updateResource(
  externalRef: string,
  patch: ResourcePatch,
): Promise<Resource | null> {
  const row: Record<string, unknown> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.timezone !== undefined) row.timezone = patch.timezone;
  if (patch.slotDurationMinutes !== undefined)
    row.slot_duration_minutes = patch.slotDurationMinutes;
  if (patch.bufferMinutes !== undefined) row.buffer_minutes = patch.bufferMinutes;
  if (patch.minNoticeMinutes !== undefined)
    row.min_notice_minutes = patch.minNoticeMinutes;
  if (patch.horizonDays !== undefined) row.horizon_days = patch.horizonDays;
  if (patch.meetingLocation !== undefined) row.meeting_location = patch.meetingLocation;
  if (patch.notifyEmail !== undefined) row.notify_email = patch.notifyEmail;
  if (patch.isActive !== undefined) row.is_active = patch.isActive;
  if (Object.keys(row).length === 0) return getResource(externalRef);

  const { data, error } = await table(TABLES.resources)
    .update(row)
    .eq('external_ref', externalRef)
    .select(RESOURCE_COLUMNS)
    .maybeSingle<ResourceRow>();
  assertOk('updateResource', error);
  return data ? toResource(data) : null;
}

export async function listResources(options?: {
  activeOnly?: boolean;
}): Promise<Resource[]> {
  const rows = await fetchAllKeyset<ResourceRow>(
    'listResources',
    (after, limit) => {
      let query = table(TABLES.resources).select(RESOURCE_COLUMNS);
      if (options?.activeOnly) query = query.eq('is_active', true);
      if (after !== null) query = query.gt('external_ref', after);
      return query.order('external_ref', { ascending: true }).limit(limit);
    },
    (row) => row.external_ref,
  );
  return rows.map(toResource);
}

/**
 * Ressources qui peuvent RÉELLEMENT offrir des créneaux : actives ET munies
 * d'au moins une règle hebdomadaire.
 *
 * Deux requêtes, quel que soit le nombre de ressources — c'est ce qui permet à
 * l'hôte de l'appeler sur un écran de liste. La version « une ressource à la
 * fois » (`listWeeklyRules` par ressource) coûterait un aller-retour par
 * ligne affichée.
 *
 * Une ressource active sans aucune règle n'est PAS une erreur : c'est un
 * agenda pas encore rempli. Mais elle n'offre rien, et une interface qui la
 * présente comme disponible ment à celui qui la choisit.
 */
export async function listBookableResources(): Promise<string[]> {
  const resources = await listResources({ activeOnly: true });
  if (resources.length === 0) return [];

  const rules = await fetchAllKeyset<RuleRow>(
    'listBookableResources.rules',
    (after, limit) => {
      let query = table(TABLES.rules).select(
        'id, resource_id, weekday, start_minute, end_minute',
      );
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  const withRules = new Set(rules.map((rule) => rule.resource_id));
  return resources
    .filter((resource) => withRules.has(resource.id))
    .map((resource) => resource.externalRef);
}

// ─── Règles hebdomadaires ───────────────────────────────────────────────

/**
 * Remplace INTÉGRALEMENT la grille hebdomadaire (l'écran de réglage envoie
 * l'état complet). Suppression puis insertion : une grille n'est jamais
 * fusionnée à moitié.
 */
export async function setWeeklyRules(
  externalRef: string,
  rules: WeeklyRuleInput[],
): Promise<WeeklyRule[]> {
  const resource = await requireResourceId('setWeeklyRules', externalRef);

  const { error: deleteError } = await table(TABLES.rules)
    .delete()
    .eq('resource_id', resource);
  assertOk('setWeeklyRules.delete', deleteError);

  if (rules.length === 0) return [];

  const { data, error } = await table(TABLES.rules)
    .insert(
      rules.map((rule) => ({
        resource_id: resource,
        weekday: rule.weekday,
        start_minute: rule.startMinute,
        end_minute: rule.endMinute,
      })),
    )
    .select('id, resource_id, weekday, start_minute, end_minute');
  assertOk('setWeeklyRules.insert', error);
  return ((data ?? []) as RuleRow[]).map(toWeeklyRule);
}

export async function listWeeklyRules(externalRef: string): Promise<WeeklyRule[]> {
  const resource = await requireResourceId('listWeeklyRules', externalRef);
  const rows = await fetchAllKeyset<RuleRow>(
    'listWeeklyRules',
    (after, limit) => {
      let query = table(TABLES.rules)
        .select('id, resource_id, weekday, start_minute, end_minute')
        .eq('resource_id', resource);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  // Le moteur se moque de l'ordre ; l'affichage, non — on trie ici.
  return rows
    .map(toWeeklyRule)
    .sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

// ─── Exceptions datées ──────────────────────────────────────────────────

export async function addException(
  externalRef: string,
  input: AvailabilityExceptionInput,
): Promise<AvailabilityException> {
  const resource = await requireResourceId('addException', externalRef);
  const { data, error } = await table(TABLES.exceptions)
    .insert({
      resource_id: resource,
      day: input.day,
      start_minute: input.startMinute ?? null,
      end_minute: input.endMinute ?? null,
      label: input.label ?? null,
    })
    .select('id, resource_id, day, start_minute, end_minute, label')
    .single<ExceptionRow>();
  assertOk('addException', error);
  return toException(data as ExceptionRow);
}

export async function removeException(exceptionId: string): Promise<void> {
  const { error } = await table(TABLES.exceptions).delete().eq('id', exceptionId);
  assertOk('removeException', error);
}

export async function listExceptions(
  externalRef: string,
  window?: { from?: string; to?: string },
): Promise<AvailabilityException[]> {
  const resource = await requireResourceId('listExceptions', externalRef);
  const rows = await fetchAllKeyset<ExceptionRow>(
    'listExceptions',
    (after, limit) => {
      let query = table(TABLES.exceptions)
        .select('id, resource_id, day, start_minute, end_minute, label')
        .eq('resource_id', resource);
      if (window?.from) query = query.gte('day', window.from);
      if (window?.to) query = query.lte('day', window.to);
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  return rows.map(toException).sort((a, b) => a.day.localeCompare(b.day));
}

// ─── Créneaux ───────────────────────────────────────────────────────────

/**
 * Assemble tout ce dont le moteur a besoin pour une ressource et une fenêtre.
 * Point de passage unique : la page publique, l'aperçu de réglage et la
 * revalidation de confirmation voient EXACTEMENT la même disponibilité.
 */
export async function loadEngineInput(
  resource: Resource,
  window: { from: string; to: string },
): Promise<SlotEngineInput> {
  const [rules, exceptions, busy] = await Promise.all([
    listWeeklyRules(resource.externalRef),
    listExceptions(resource.externalRef, {
      // Marge d'un jour de part et d'autre : la fenêtre est en UTC, les
      // exceptions en dates LOCALES — les bords peuvent déborder.
      from: shiftIsoDate(window.from, -1),
      to: shiftIsoDate(window.to, 1),
    }),
    listBusyIntervals(resource.id, window),
  ]);

  return {
    timezone: resource.timezone,
    slotDurationMinutes: resource.slotDurationMinutes,
    bufferMinutes: resource.bufferMinutes,
    minNoticeMinutes: resource.minNoticeMinutes,
    horizonDays: resource.horizonDays,
    rules,
    exceptions,
    busy,
    from: window.from,
    to: window.to,
    now: nowIso(),
  };
}

/** Réservations CONFIRMÉES d'une ressource, élargies pour couvrir les bords. */
export async function listBusyIntervals(
  resourceId: string,
  window: { from: string; to: string },
): Promise<BusyInterval[]> {
  const rows = await fetchAllKeyset<{ id: string; start_at: string; end_at: string }>(
    'listBusyIntervals',
    (after, limit) => {
      let query = table(TABLES.bookings)
        .select('id, start_at, end_at')
        .eq('resource_id', resourceId)
        .eq('status', 'confirmed')
        .gte('start_at', shiftIsoDay(window.from, -1))
        .lte('start_at', shiftIsoDay(window.to, 1));
      if (after !== null) query = query.gt('id', after);
      return query.order('id', { ascending: true }).limit(limit);
    },
    (row) => row.id,
  );
  return rows.map((row) => ({ startAt: row.start_at, endAt: row.end_at }));
}

export async function previewSlots(
  externalRef: string,
  window: { from: string; to: string },
): Promise<Slot[]> {
  const resource = await getResource(externalRef);
  if (!resource || !resource.isActive) return [];
  return computeSlots(await loadEngineInput(resource, window));
}

// ─── Internes ───────────────────────────────────────────────────────────

async function requireResourceId(
  operation: string,
  externalRef: string,
): Promise<string> {
  const { data, error } = await table(TABLES.resources)
    .select('id')
    .eq('external_ref', externalRef)
    .maybeSingle<{ id: string }>();
  assertOk(operation, error);
  if (!data) throw new Error(`${operation}: ressource inconnue (${externalRef})`);
  return data.id;
}

/** Décale un instant ISO de N jours — sert uniquement à élargir des bornes. */
function shiftIsoDay(iso: string, days: number): string {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return iso;
  return new Date(base + days * 86_400_000).toISOString();
}

/** Idem, mais rendu en date nue `YYYY-MM-DD` (colonne `day` = date). */
function shiftIsoDate(iso: string, days: number): string {
  return shiftIsoDay(iso, days).slice(0, 10);
}
