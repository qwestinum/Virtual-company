/**
 * Types du module de réservation — VOCABULAIRE PROPRE AU MODULE.
 *
 * Ce fichier est la frontière sémantique : on n'y trouve aucun concept du
 * domaine de l'hôte. Une « ressource » est une personne réservable, une
 * « cible » un alias re-pointable, un « lien » un jeton nominatif, un
 * « invité » celui qui réserve. Ce que l'hôte met derrière ces mots ne
 * regarde pas le module.
 *
 * Spec : docs/specs/scheduling-module.md
 */

// ─── Lieu de rencontre ──────────────────────────────────────────────────
/**
 * Couple { type, payload } OPAQUE : le module stocke, résout et injecte, il
 * n'appelle JAMAIS d'API de fournisseur (pas de Meet/Teams/Zoom ici). La
 * génération de liens uniques par RDV est une évolution V2 branchée sur le
 * résolveur unique (`resolveMeetingLocation`), pas sur ces types.
 */
export type MeetingLocation =
  | { type: 'video'; payload: { url: string } }
  | { type: 'in_person'; payload: { address: string } }
  | { type: 'phone'; payload: { instructions: string } };

export type MeetingLocationType = MeetingLocation['type'];

// ─── Ressources ─────────────────────────────────────────────────────────
export type Resource = {
  id: string;
  /** Clé opaque de l'hôte — stockée telle quelle, jamais parsée. */
  externalRef: string;
  displayName: string;
  /** Fuseau IANA : LA référence des règles hebdomadaires. */
  timezone: string;
  slotDurationMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
  meetingLocation: MeetingLocation | null;
  notifyEmail: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ResourceInput = {
  externalRef: string;
  displayName: string;
  timezone?: string;
  slotDurationMinutes?: number;
  bufferMinutes?: number;
  minNoticeMinutes?: number;
  horizonDays?: number;
  meetingLocation?: MeetingLocation | null;
  notifyEmail?: string | null;
};

export type ResourcePatch = Partial<Omit<ResourceInput, 'externalRef'>> & {
  isActive?: boolean;
};

/** Règle hebdomadaire. `weekday` ISO-8601 : 1 = lundi … 7 = dimanche. */
export type WeeklyRule = {
  id: string;
  weekday: number;
  /** Minutes locales depuis minuit, dans le fuseau de la ressource. */
  startMinute: number;
  endMinute: number;
};

export type WeeklyRuleInput = Omit<WeeklyRule, 'id'>;

/** Blocage daté. `startMinute`/`endMinute` null ⇒ journée entière. */
export type AvailabilityException = {
  id: string;
  /** Date LOCALE de la ressource, format `YYYY-MM-DD`. */
  day: string;
  startMinute: number | null;
  endMinute: number | null;
  label: string | null;
};

/**
 * Créer une exception ne demande que la date : `{ day }` bloque la journée
 * entière (le cas le plus courant, un congé). Les minutes ne servent qu'à un
 * blocage partiel, et vont alors par paire.
 */
export type AvailabilityExceptionInput = {
  day: string;
  startMinute?: number | null;
  endMinute?: number | null;
  label?: string | null;
};

/** Créneau proposable — toujours en UTC ISO. */
export type Slot = { startAt: string; endAt: string };

/** Intervalle occupé (réservation confirmée), UTC ISO. */
export type BusyInterval = { startAt: string; endAt: string };

// ─── Indisponibilités externes ──────────────────────────────────────────
/**
 * Le module ne sait pas D'OÙ viennent ces intervalles, ni comment on les lit :
 * il pose une question — « quand cette ressource est-elle prise ailleurs, sur
 * cette fenêtre ? » — et reçoit des bornes. Aucun titre, aucune notion de
 * fournisseur ne franchit ce port.
 *
 * `freshness` dit ce que l'appelant exige :
 *   - `snapshot` : l'offre de créneaux — une lecture récente suffit ;
 *   - `live`     : la confirmation — la vérité au moment du clic.
 */
export type ExternalBusyRequest = {
  resource: Pick<Resource, 'id' | 'externalRef' | 'timezone' | 'horizonDays'>;
  /** Fenêtre UTC ISO. */
  from: string;
  to: string;
  freshness: 'snapshot' | 'live';
};

export type ExternalBusyAnswer =
  /** Aucune source déclarée pour cette ressource : comportement historique. */
  | { kind: 'not_configured' }
  | { kind: 'ok'; intervals: BusyInterval[]; readAt: string }
  | {
      /** La source existe mais n'a pas pu être lue. Jamais une disponibilité. */
      kind: 'unavailable';
      /**
       * Dernière lecture RÉUSSIE, avec la fenêtre qu'elle couvrait : une copie
       * ne vaut que pour ce qu'elle a vu, jamais au-delà.
       */
      lastGood: { intervals: BusyInterval[]; readAt: string; from: string; to: string } | null;
      failingSince: string;
    };

export type BusyProvider = {
  read(request: ExternalBusyRequest): Promise<ExternalBusyAnswer>;
};

/**
 * Ce que la réservation a VÉRIFIÉ au moment d'être prise :
 *   - `live`     : source externe relue à la confirmation ;
 *   - `snapshot` : dernière lecture connue (source momentanément illisible) ;
 *   - `none`     : aucune source externe pour cette ressource.
 * `null` : réservation antérieure à la vérification.
 */
export type AvailabilityCheck = 'live' | 'snapshot' | 'none';

/**
 * Créneaux offerts ET si l'offre est suspendue. `unavailable: true` ⇒ la
 * source externe n'a pas pu être vérifiée au-delà de la tolérance : la liste
 * est vide, et la page doit dire « momentanément indisponible », jamais
 * « aucun créneau » (qui ferait croire à un agenda plein).
 */
export type SlotOffer = { slots: Slot[]; unavailable: boolean };

// ─── Cibles ─────────────────────────────────────────────────────────────
export type Target = {
  id: string;
  externalRef: string;
  /** null ⇒ cible ORPHELINE : page publique dégradée, jamais une erreur. */
  resourceId: string | null;
  resourceExternalRef: string | null;
  meetingLocationOverride: MeetingLocation | null;
  /** Incrémentée à chaque re-pointage — contrôle optimiste à la confirmation. */
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type TargetImpact = {
  /** Liens encore actifs : ils basculeront sur la nouvelle ressource. */
  activeLinks: number;
  /** RDV confirmés à venir : ils NE bougent PAS (ressource figée). */
  confirmedUpcomingBookings: { resourceExternalRef: string; count: number }[];
};

// ─── Liens ──────────────────────────────────────────────────────────────
export type BookingLinkStatus = 'active' | 'used' | 'revoked' | 'expired';

/**
 * Ce que la page publique a le DROIT d'afficher. Fourni par l'hôte et
 * distinct du `context` : le contexte ne fuit jamais vers le navigateur.
 */
export type LinkDisplay = {
  title?: string | null;
  organisation?: string | null;
  attendeeName?: string | null;
  attendeeEmail?: string | null;
  note?: string | null;
  /**
   * Mention de traitement des données propre à cet envoi. Prend le pas sur le
   * libellé de l'installation : l'hôte peut y placer sa mention complète sans
   * que le module ait à la connaître.
   */
  privacyNotice?: string | null;
};

export type BookingLink = {
  token: string;
  targetId: string;
  targetExternalRef: string;
  idempotencyKey: string;
  status: BookingLinkStatus;
  expiresAt: string | null;
  /** Charge utile de l'hôte, restituée TELLE QUELLE dans les événements. */
  context: unknown;
  display: LinkDisplay;
  revokedReason: string | null;
  createdAt: string;
};

export type CreateLinkInput = {
  targetExternalRef: string;
  /** Clé d'idempotence : même clé ⇒ même token (jamais un 2e lien). */
  idempotencyKey: string;
  context?: unknown;
  display?: LinkDisplay;
  expiresAt?: string | null;
};

export type CreateLinkResult = {
  token: string;
  url: string;
  /** true ⇒ le lien existait déjà (rejeu idempotent), rien n'a été créé. */
  reused: boolean;
  link: BookingLink;
};

export type RevokeLinkVerdict =
  | 'revoked'
  | 'already_used'
  | 'already_revoked'
  | 'not_found';

// ─── Réservations ───────────────────────────────────────────────────────
export type BookingStatus = 'confirmed' | 'cancelled';
export type CancelledBy = 'attendee' | 'organizer';

export type Attendee = {
  name: string;
  email: string;
  phone: string | null;
  /** Fuseau choisi par l'invité — repris tel quel dans les notifications. */
  timezone: string;
};

export type Booking = {
  /** Identifiant du RDV. C'est l'uid que l'hôte consomme dans ses événements. */
  id: string;
  linkToken: string | null;
  targetId: string;
  targetExternalRef: string;
  /** Ressource FIGÉE à la confirmation (ne suit pas un re-pointage). */
  resourceId: string;
  resourceExternalRef: string;
  startAt: string;
  endAt: string;
  status: BookingStatus;
  cancelledBy: CancelledBy | null;
  cancelledReason: string | null;
  cancelledAt: string | null;
  rescheduledFrom: string | null;
  attendee: Attendee;
  context: unknown;
  /** Snapshot du lieu résolu à la confirmation. */
  meetingLocation: MeetingLocation | null;
  manageToken: string;
  createdAt: string;
  availabilityCheck: AvailabilityCheck | null;
};

export type ConfirmBookingInput = {
  token: string;
  /** Début demandé, UTC ISO — doit correspondre EXACTEMENT à un créneau offert. */
  startAt: string;
  attendee: {
    name: string;
    email: string;
    phone?: string | null;
    timezone: string;
  };
};

/** Motifs de refus — chacun porte un message distinct côté interface. */
export type ConfirmFailureReason =
  | 'link_not_found'
  | 'link_gone'
  | 'link_expired'
  | 'target_changed'
  | 'resource_unavailable'
  | 'invalid_slot'
  | 'slot_taken'
  /** La source d'indisponibilités externe n'a pas pu être relue : on ne confirme pas à l'aveugle. */
  | 'availability_unverified';

export type ConfirmBookingResult =
  | { ok: true; booking: Booking; manageToken: string; replay: boolean }
  | { ok: false; reason: ConfirmFailureReason };

export type RescheduleResult =
  | { ok: true; booking: Booking; previous: Booking }
  | { ok: false; reason: ConfirmFailureReason | 'booking_not_found' | 'booking_cancelled' };

export type CancelVerdict =
  | 'cancelled'
  | 'already_cancelled'
  | 'not_found';

/** État de la page publique pour un token donné. */
export type BookingPageState =
  | {
      status: 'open';
      display: LinkDisplay;
      resource: {
        displayName: string;
        timezone: string;
        slotDurationMinutes: number;
      };
      meetingLocationType: MeetingLocationType | null;
      expiresAt: string | null;
    }
  /** Cible sans ressource active : « momentanément indisponible ». */
  | { status: 'degraded'; display: LinkDisplay }
  /** Lien consommé, révoqué, expiré ou inconnu. */
  | { status: 'gone'; display: LinkDisplay | null; reason: BookingLinkStatus | 'unknown' };

// ─── Événements ─────────────────────────────────────────────────────────
export type SchedEventType =
  | 'booking.created'
  | 'booking.cancelled'
  | 'booking.rescheduled'
  /** RÉSERVÉ V2 (lieu résolu après coup) — jamais émis en V1. */
  | 'booking.updated';

export type SchedEventBooking = {
  id: string;
  targetExternalRef: string;
  resourceExternalRef: string;
  startAt: string;
  endAt: string;
  attendee: Attendee;
  meetingLocation: MeetingLocation | null;
  /** Restitué TEL QUEL — le module ne l'interprète jamais. */
  context: unknown;
  availabilityCheck: AvailabilityCheck | null;
  cancelledBy?: CancelledBy;
  cancelReason?: string | null;
  rescheduledFrom?: string;
  previousStartAt?: string;
};

export type SchedEvent = {
  /** Clé d'idempotence pour le consommateur (livraison at-least-once). */
  id: string;
  occurredAt: string;
  type: SchedEventType;
  booking: SchedEventBooking;
};

export type SchedEventConsumer = (event: SchedEvent) => Promise<void>;

export type DrainResult = {
  dispatched: number;
  failed: number;
  /** Réservations confirmées sans événement `booking.created` — rattrapées. */
  repaired: number;
};
