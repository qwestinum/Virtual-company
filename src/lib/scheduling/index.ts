/**
 * Module de réservation — SURFACE PUBLIQUE.
 *
 * C'est le contrat : tout ce qu'un hôte peut appeler passe par ici. Rien de ce
 * fichier ne mentionne le domaine de qui que ce soit — le module manipule des
 * ressources réservables, des cibles, des liens, des réservations et des
 * événements, et traite les clés et charges utiles de l'hôte comme opaques.
 *
 * Démarrage, côté hôte :
 *
 *   configureScheduling({ supabase: () => client, mailer, publicBaseUrl });
 *   registerEventConsumer(async (event) => { ... });
 *
 * Spec : docs/specs/scheduling-module.md
 */

// Configuration & ports
export {
  branding,
  configureScheduling,
  notifiesOrganizer,
  createRecordingMailer,
  isSchedulingConfigured,
  resetSchedulingConfig,
  updateSchedulingIdentity,
  bookingUrl,
  manageUrl,
  type MailAttachment,
  type MailMessage,
  type MailPort,
  type MailSendResult,
  type ResolvedBranding,
  type SchedulingBranding,
  type SchedulingConfig,
} from './runtime';

export {
  SchedulingNotConfiguredError,
  SchedulingStoreError,
} from './errors';

// Ressources : disponibilités et réglages de créneau
export {
  addException,
  createResource,
  getResource,
  listBookableResources,
  listExceptions,
  listResources,
  listWeeklyRules,
  previewSlots,
  removeException,
  setWeeklyRules,
  updateResource,
} from './resources';

// Cibles : l'alias re-pointable entre un lien et une ressource
export {
  createTarget,
  getTarget,
  getTargetById,
  getTargetImpact,
  listOrphanTargets,
  repointTarget,
  setTargetLocationOverride,
} from './targets';

// Liens nominatifs
export {
  createBookingLink,
  getBookingLink,
  listLinksForTarget,
  revokeLink,
  revokeLinkByKey,
} from './links';

// Réservations
export {
  cancelBookingByAttendee,
  cancelBookingByOrganizer,
  confirmBooking,
  getBooking,
  getBookingByManageToken,
  getConfirmedBookingByLink,
  listBookings,
  listSlotsForLink,
  listSlotsForManageToken,
  rescheduleBooking,
  resolveBookingPage,
} from './bookings';

// Surfaces publiques : limitation de débit et libellés
export {
  consumeRateLimit,
  purgeExpiredRateLimits,
  DEFAULT_RATE_LIMITS,
  type RateLimitedAction,
  type RateLimitPolicy,
  type RateLimitRule,
  type RateLimitVerdict,
} from './rate-limit';

export { FR_LABELS, fill, type SchedulingLabels } from './labels';
export { labels, organizationName } from './runtime';

// Invitation d'agenda (exposée pour les tests et pour un hôte qui la réutilise)
export {
  buildBookingIcs,
  icsContentType,
  icsMethodFor,
  type IcsInput,
} from './ics';
export { resolveSeries, type BookingSeries } from './series';

// Gabarits de messages — purs
export {
  bookingCancelledForAttendee,
  bookingCancelledForOrganizer,
  bookingConfirmedForAttendee,
  bookingConfirmedForOrganizer,
  bookingRescheduledForAttendee,
  bookingRescheduledForOrganizer,
  type MailContent,
  type TemplateContext,
} from './mail-templates';

// Mise en forme des dates — toujours dans un fuseau explicite
export {
  dayKey,
  formatDate,
  formatDateTime,
  formatDayHeading,
  formatShortDate,
  formatTime,
  formatTimeRange,
  isValidTimeZone,
  zoneLabel,
} from './format';

// Événements
export {
  drainPendingEvents,
  hasEventConsumer,
  registerEventConsumer,
} from './events';

// Lieu de rencontre — opaque, résolu en un point unique
export {
  describeMeetingLocation,
  parseMeetingLocation,
  resolveMeetingLocation,
} from './meeting-location';

// Moteur de créneaux (pur) — exposé pour l'aperçu et les tests
export { computeSlots, findOfferedSlot, type SlotEngineInput } from './slots';

export type * from './types';
