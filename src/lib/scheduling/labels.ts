/**
 * Libellés — français par défaut, tous surchargeables par l'hôte.
 *
 * Rassemblés ici pour deux raisons. D'abord parce qu'une traduction future ne
 * doit pas obliger à rouvrir chaque écran : les chaînes sont déjà sorties du
 * code (l'internationalisation elle-même n'est PAS implémentée — un seul jeu de
 * libellés existe). Ensuite parce que certaines phrases n'appartiennent pas au
 * module : la mention de traitement des données relève de l'organisation qui
 * exploite le service, pas de l'outil de prise de rendez-vous. L'hôte la
 * remplace par la sienne sans que le module sache ce qu'elle contient.
 *
 * Deux niveaux de surcharge, du plus général au plus précis :
 *   1. `configureScheduling({ labels })` — pour toute l'installation ;
 *   2. `display.privacyNotice` sur un lien — pour un envoi particulier.
 */

export type SchedulingLabels = {
  // ── Page de réservation ──────────────────────────────────────────────
  bookingTitleFallback: string;
  durationMinutes: string;
  locationVideo: string;
  locationInPerson: string;
  locationPhone: string;
  timezoneLabel: string;
  timezoneChange: string;
  timezoneClose: string;
  weekOf: string;
  previousWeek: string;
  nextWeek: string;
  noSlotThatDay: string;
  noSlotThisWeek: string;
  loadingSlots: string;
  chosenSlot: string;
  chooseAnotherSlot: string;
  fieldName: string;
  fieldEmail: string;
  fieldPhone: string;
  confirmCta: string;
  confirmingCta: string;
  privacyNotice: string;

  // ── Confirmation ─────────────────────────────────────────────────────
  confirmedTitle: string;
  confirmedIntro: string;
  recapWhen: string;
  recapWhere: string;
  recapDuration: string;
  icsSent: string;
  manageCta: string;

  // ── États fermés ─────────────────────────────────────────────────────
  degradedTitle: string;
  degradedBody: string;
  goneTitle: string;
  goneBody: string;
  alreadyBookedTitle: string;
  alreadyBookedBody: string;

  // ── Page de gestion ──────────────────────────────────────────────────
  manageTitle: string;
  rescheduleCta: string;
  cancelCta: string;
  rescheduleTitle: string;
  rescheduleCurrent: string;
  rescheduleConfirm: string;
  rescheduleKeep: string;
  cancelTitle: string;
  cancelWarning: string;
  cancelConfirm: string;
  cancelBack: string;
  cancelledTitle: string;
  cancelledBody: string;

  // ── Messages d'erreur ────────────────────────────────────────────────
  errorSlotTaken: string;
  errorTargetChanged: string;
  errorLinkGone: string;
  errorRateLimited: string;
  errorGeneric: string;

  // ── Champs obligatoires ──────────────────────────────────────────────
  errorNameRequired: string;
  errorEmailInvalid: string;
};

export const FR_LABELS: SchedulingLabels = {
  bookingTitleFallback: 'Prendre rendez-vous',
  durationMinutes: '{n} min',
  locationVideo: 'Visioconférence',
  locationInPerson: 'Sur place',
  locationPhone: 'Par téléphone',
  timezoneLabel: 'Heure de {zone}',
  timezoneChange: 'Changer',
  timezoneClose: 'Fermer',
  weekOf: 'Semaine du {date}',
  previousWeek: 'Semaine précédente',
  nextWeek: 'Semaine suivante',
  noSlotThatDay: 'Aucun créneau ce jour-là',
  noSlotThisWeek: 'Aucun créneau cette semaine. Essayez la semaine suivante.',
  loadingSlots: 'Recherche des créneaux…',
  chosenSlot: 'Créneau choisi',
  chooseAnotherSlot: 'Choisissez un nouveau créneau',
  fieldName: 'Nom et prénom',
  fieldEmail: 'Adresse email',
  fieldPhone: 'Téléphone (facultatif)',
  confirmCta: 'Confirmer ce créneau',
  confirmingCta: 'Confirmation en cours…',
  privacyNotice:
    'Vos coordonnées servent uniquement à organiser ce rendez-vous et sont conservées le temps des échanges en cours. Vous pouvez demander leur suppression à tout moment.',

  confirmedTitle: 'C’est confirmé',
  confirmedIntro: 'Nous vous attendons {when}.',
  recapWhen: 'Quand',
  recapWhere: 'Où',
  recapDuration: 'Durée',
  icsSent:
    'Une invitation à ajouter à votre agenda vient de vous être envoyée par email.',
  manageCta: 'Modifier ou annuler',

  degradedTitle: 'Momentanément indisponible',
  degradedBody:
    'La prise de rendez-vous n’est pas accessible pour l’instant. Nous revenons vers vous très vite.',
  goneTitle: 'Ce lien n’est plus actif',
  goneBody:
    'Si vous pensez qu’il s’agit d’une erreur, répondez au message que vous avez reçu.',
  alreadyBookedTitle: 'Vous avez déjà réservé',
  alreadyBookedBody: 'Ce lien a servi à prendre le rendez-vous ci-dessous.',

  manageTitle: 'Votre rendez-vous',
  rescheduleCta: 'Déplacer ce rendez-vous',
  cancelCta: 'Annuler ce rendez-vous',
  rescheduleTitle: 'Déplacer votre rendez-vous',
  rescheduleCurrent: 'Actuellement : {when}',
  rescheduleConfirm: 'Déplacer vers {when}',
  rescheduleKeep: 'Garder mon créneau',
  cancelTitle: 'Annuler ce rendez-vous ?',
  cancelWarning:
    'Cette action est définitive. Pour un simple changement d’horaire, préférez « Déplacer ».',
  cancelConfirm: 'Oui, annuler',
  cancelBack: 'Revenir en arrière',
  cancelledTitle: 'Rendez-vous annulé',
  cancelledBody: 'Ce rendez-vous a été annulé. Nous vous recontacterons si nécessaire.',

  errorSlotTaken: 'Ce créneau vient d’être réservé. Voici les disponibilités à jour.',
  errorTargetChanged: 'Les disponibilités ont changé. Voici les créneaux à jour.',
  errorLinkGone: 'Ce lien n’est plus actif.',
  errorRateLimited: 'Trop de tentatives. Patientez un instant avant de réessayer.',
  errorGeneric: 'Une erreur est survenue. Réessayez dans un instant.',

  errorNameRequired: 'Indiquez votre nom.',
  errorEmailInvalid: 'Indiquez une adresse email valide.',
};

/** Remplace les `{clés}` par leur valeur. Une clé absente reste telle quelle. */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
