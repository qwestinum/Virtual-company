/**
 * Lignes de base ↔ objets du module. Un seul endroit connaît les noms de
 * colonnes : le reste du module ne manipule que des types métier du module.
 */
import { parseMeetingLocation } from './meeting-location';
import type {
  AvailabilityException,
  Booking,
  BookingLink,
  BookingLinkStatus,
  BookingStatus,
  CancelledBy,
  LinkDisplay,
  Resource,
  Target,
  WeeklyRule,
} from './types';

/**
 * Horodatage base → ISO-8601 UTC CANONIQUE (`…T14:00:00.000Z`).
 *
 * Postgres rend `2026-08-17T14:00:00+00:00`, le moteur de créneaux produit
 * `2026-08-17T14:00:00.000Z` : même instant, chaînes différentes. Sans
 * normalisation ici, un appelant qui rapproche un créneau proposé d'une
 * réservation par simple égalité de chaînes ne trouverait rien — et le
 * chercherait longtemps. Le contrat annonce de l'ISO UTC : on le rend
 * réellement uniforme, à la frontière, une fois pour toutes.
 */
export function isoUtc(value: string): string {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
}

function isoUtcOrNull(value: string | null): string | null {
  return value === null ? null : isoUtc(value);
}

export const TABLES = {
  resources: 'sched_resources',
  rules: 'sched_availability_rules',
  exceptions: 'sched_availability_exceptions',
  targets: 'sched_targets',
  links: 'sched_booking_links',
  bookings: 'sched_bookings',
  events: 'sched_events',
} as const;

export type ResourceRow = {
  id: string;
  external_ref: string;
  display_name: string;
  timezone: string;
  slot_duration_minutes: number;
  buffer_minutes: number;
  min_notice_minutes: number;
  horizon_days: number;
  meeting_location: unknown;
  notify_email: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type RuleRow = {
  id: string;
  resource_id: string;
  weekday: number;
  start_minute: number;
  end_minute: number;
};

export type ExceptionRow = {
  id: string;
  resource_id: string;
  day: string;
  start_minute: number | null;
  end_minute: number | null;
  label: string | null;
};

export type TargetRow = {
  id: string;
  external_ref: string;
  resource_id: string | null;
  meeting_location_override: unknown;
  version: number;
  created_at: string;
  updated_at: string;
};

export type LinkRow = {
  token: string;
  target_id: string;
  idempotency_key: string;
  status: string;
  expires_at: string | null;
  context: unknown;
  display: unknown;
  revoked_reason: string | null;
  created_at: string;
};

export type BookingRow = {
  id: string;
  link_token: string | null;
  target_id: string;
  resource_id: string;
  start_at: string;
  end_at: string;
  status: string;
  cancelled_by: string | null;
  cancelled_reason: string | null;
  cancelled_at: string | null;
  rescheduled_from: string | null;
  attendee_name: string;
  attendee_email: string;
  attendee_phone: string | null;
  attendee_timezone: string;
  context: unknown;
  meeting_location: unknown;
  manage_token: string;
  created_at: string;
};

export type EventRow = {
  id: string;
  type: string;
  booking_id: string;
  payload: unknown;
  created_at: string;
  dispatched_at: string | null;
  attempts: number;
  last_error: string | null;
};

export function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    externalRef: row.external_ref,
    displayName: row.display_name,
    timezone: row.timezone,
    slotDurationMinutes: row.slot_duration_minutes,
    bufferMinutes: row.buffer_minutes,
    minNoticeMinutes: row.min_notice_minutes,
    horizonDays: row.horizon_days,
    meetingLocation: parseMeetingLocation(row.meeting_location),
    notifyEmail: row.notify_email,
    isActive: row.is_active,
    createdAt: isoUtc(row.created_at),
    updatedAt: isoUtc(row.updated_at),
  };
}

export function toWeeklyRule(row: RuleRow): WeeklyRule {
  return {
    id: row.id,
    weekday: row.weekday,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
  };
}

export function toException(row: ExceptionRow): AvailabilityException {
  return {
    id: row.id,
    day: row.day,
    startMinute: row.start_minute,
    endMinute: row.end_minute,
    label: row.label,
  };
}

export function toTarget(row: TargetRow, resourceExternalRef: string | null): Target {
  return {
    id: row.id,
    externalRef: row.external_ref,
    resourceId: row.resource_id,
    resourceExternalRef,
    meetingLocationOverride: parseMeetingLocation(row.meeting_location_override),
    version: row.version,
    createdAt: isoUtc(row.created_at),
    updatedAt: isoUtc(row.updated_at),
  };
}

export function toLink(row: LinkRow, targetExternalRef: string): BookingLink {
  return {
    token: row.token,
    targetId: row.target_id,
    targetExternalRef,
    idempotencyKey: row.idempotency_key,
    status: row.status as BookingLinkStatus,
    expiresAt: isoUtcOrNull(row.expires_at),
    context: row.context ?? null,
    display: toDisplay(row.display),
    revokedReason: row.revoked_reason,
    createdAt: isoUtc(row.created_at),
  };
}

export function toBooking(
  row: BookingRow,
  refs: { targetExternalRef: string; resourceExternalRef: string },
): Booking {
  return {
    id: row.id,
    linkToken: row.link_token,
    targetId: row.target_id,
    targetExternalRef: refs.targetExternalRef,
    resourceId: row.resource_id,
    resourceExternalRef: refs.resourceExternalRef,
    startAt: isoUtc(row.start_at),
    endAt: isoUtc(row.end_at),
    status: row.status as BookingStatus,
    cancelledBy: (row.cancelled_by as CancelledBy | null) ?? null,
    cancelledReason: row.cancelled_reason,
    cancelledAt: isoUtcOrNull(row.cancelled_at),
    rescheduledFrom: row.rescheduled_from,
    attendee: {
      name: row.attendee_name,
      email: row.attendee_email,
      phone: row.attendee_phone,
      timezone: row.attendee_timezone,
    },
    context: row.context ?? null,
    meetingLocation: parseMeetingLocation(row.meeting_location),
    manageToken: row.manage_token,
    createdAt: isoUtc(row.created_at),
  };
}

/** `display` vient de l'hôte : on ne garde que les champs connus, en texte. */
export function toDisplay(value: unknown): LinkDisplay {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const pick = (key: string): string | null =>
    typeof raw[key] === 'string' && (raw[key] as string).trim()
      ? (raw[key] as string)
      : null;
  return {
    title: pick('title'),
    organisation: pick('organisation'),
    attendeeName: pick('attendeeName'),
    attendeeEmail: pick('attendeeEmail'),
    note: pick('note'),
    privacyNotice: pick('privacyNotice'),
  };
}
