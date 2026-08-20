/**
 * Pont recruteur ⇄ ressource réservable.
 *
 * Côté module, une « ressource » est une personne qui tient des rendez-vous —
 * il ignore ce qu'est un recruteur. La couture est l'`external_ref` : on y met
 * l'identifiant du compte (`auth.users.id`), opaque pour le module et stable
 * pour nous.
 *
 * Toutes les fonctions sont FAIL-SOFT quand elles servent une lecture : une
 * table absente ou un hoquet de base rend « pas de ressource », jamais une
 * exception qui casserait un écran de réglages. Les écritures, elles, lèvent :
 * un recruteur qui croit avoir enregistré ses disponibilités doit être détrompé.
 */
import {
  createResource,
  getResource,
  listWeeklyRules,
  updateResource,
  type MeetingLocation,
  type Resource,
} from '@/lib/scheduling';
import type { Recruiter } from '@/types/recruiter';

import { ensureSchedulingConfigured } from './configure';

/** Réglages de départ d'un entretien — modifiables ensuite par le recruteur. */
const DEFAULTS = {
  timezone: 'Europe/Paris',
  slotDurationMinutes: 45,
  bufferMinutes: 15,
  minNoticeMinutes: 24 * 60,
  horizonDays: 30,
} as const;

/** La ressource d'un recruteur, ou `null` s'il n'en a jamais configuré. */
export async function getRecruiterResource(
  userId: string,
): Promise<Resource | null> {
  try {
    await ensureSchedulingConfigured();
    return await getResource(userId);
  } catch {
    return null;
  }
}

/**
 * Crée ou met à jour la ressource d'un recruteur. Le nom affiché et l'adresse
 * de notification suivent la fiche : c'est elle qui fait foi.
 */
export async function upsertRecruiterResource(
  recruiter: Pick<Recruiter, 'id' | 'displayName' | 'email' | 'isActive'>,
  patch?: {
    timezone?: string;
    slotDurationMinutes?: number;
    bufferMinutes?: number;
    minNoticeMinutes?: number;
    horizonDays?: number;
    meetingLocation?: MeetingLocation | null;
  },
): Promise<Resource> {
  await ensureSchedulingConfigured();
  const existing = await getResource(recruiter.id);
  if (!existing) {
    return createResource({
      externalRef: recruiter.id,
      displayName: recruiter.displayName,
      notifyEmail: recruiter.email,
      ...DEFAULTS,
      ...patch,
    });
  }
  const updated = await updateResource(recruiter.id, {
    displayName: recruiter.displayName,
    notifyEmail: recruiter.email,
    isActive: recruiter.isActive,
    ...patch,
  });
  // `updateResource` ne rend `null` que si la ligne a disparu entre les deux
  // lectures — cas théorique, mais on ne renvoie pas un objet inventé.
  if (!updated) throw new Error('ressource de réservation introuvable après mise à jour');
  return updated;
}

/**
 * Désactivation DOUCE, en écho au référentiel : la ressource cesse d'offrir
 * des créneaux, ses rendez-vous déjà pris restent intacts.
 */
export async function setRecruiterResourceActive(
  userId: string,
  isActive: boolean,
): Promise<void> {
  await ensureSchedulingConfigured();
  const existing = await getResource(userId);
  if (!existing) return; // rien à désactiver
  await updateResource(userId, { isActive });
}

/**
 * Répercute la fiche sur la ressource — SANS la créer. Un recruteur qui n'a
 * jamais déclaré de disponibilités n'en a pas besoin d'une : lui en fabriquer
 * une à la première édition de son nom la ferait apparaître, vide, dans les
 * écrans de pilotage.
 */
export async function syncRecruiterResourceFromProfile(
  recruiter: Pick<Recruiter, 'id' | 'displayName' | 'email' | 'isActive'>,
): Promise<void> {
  await ensureSchedulingConfigured();
  const existing = await getResource(recruiter.id);
  if (!existing) return;
  await updateResource(recruiter.id, {
    displayName: recruiter.displayName,
    notifyEmail: recruiter.email,
    isActive: recruiter.isActive,
  });
}

/**
 * Un recruteur est-il RÉELLEMENT prêt à recevoir des réservations ?
 *
 * Trois conditions, et la troisième est celle qu'on oublie : une ressource
 * active sans aucune règle hebdomadaire n'offre aucun créneau — le candidat
 * verrait une grille vide. C'est la garde du flag « réservation native ».
 */
export async function recruiterCanHostBookings(
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  try {
    await ensureSchedulingConfigured();
    const resource = await getResource(userId);
    if (!resource || !resource.isActive) return false;
    const rules = await listWeeklyRules(userId);
    return rules.length > 0;
  } catch {
    return false;
  }
}
