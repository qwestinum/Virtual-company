/**
 * Mise en forme des dates — PURE, et toujours dans un fuseau EXPLICITE.
 *
 * Aucune fonction ici ne lit le fuseau de la machine. C'est délibéré : le
 * serveur qui compose un message et le navigateur qui affiche une page ne
 * vivent pas au même endroit que l'invité, et une heure affichée sans son
 * fuseau est une source d'erreur de rendez-vous. Chaque appel dit dans quel
 * fuseau il veut lire l'instant, et le résultat est étiqueté.
 */

/** Nom lisible d'un fuseau : `Europe/Paris` → « Paris ». */
export function zoneLabel(timeZone: string): string {
  const last = timeZone.split('/').pop() ?? timeZone;
  return last.replace(/_/g, ' ');
}

/** « mardi 25 août 2026 à 11:15 » */
export function formatDateTime(iso: string, timeZone: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(iso));
}

/** « mardi 25 août 2026 » */
export function formatDate(iso: string, timeZone: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone }).format(
    new Date(iso),
  );
}

/** « 11:15 » — la brique de la grille de créneaux. */
export function formatTime(iso: string, timeZone: string, locale = 'fr-FR'): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/** « 11:15 — 12:00 » */
export function formatTimeRange(
  startIso: string,
  endIso: string,
  timeZone: string,
  locale = 'fr-FR',
): string {
  return `${formatTime(startIso, timeZone, locale)} — ${formatTime(endIso, timeZone, locale)}`;
}

/** « lundi 24 août » — en-tête de journée dans la grille. */
export function formatDayHeading(
  iso: string,
  timeZone: string,
  locale = 'fr-FR',
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(iso));
}

/** « 24 août » — pour l'étiquette de semaine. */
export function formatShortDate(
  iso: string,
  timeZone: string,
  locale = 'fr-FR',
): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date(iso));
}

/**
 * Clé de journée `YYYY-MM-DD` DANS LE FUSEAU DEMANDÉ. Sert à regrouper les
 * créneaux par jour : `toISOString().slice(0,10)` regrouperait selon UTC, et
 * un créneau de 23 h à Paris tomberait dans la journée suivante.
 */
export function dayKey(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone,
  }).format(new Date(iso));
  return parts;
}

/** Le fuseau est-il utilisable ? Une valeur inconnue ferait planter `Intl`. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}
