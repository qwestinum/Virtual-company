/**
 * Pont campagne ⇄ cible de réservation, et émission des liens candidat.
 *
 * Une CIBLE par campagne (`external_ref` = `CAMP-XXXX`), créée paresseusement
 * à la première invitation et pointée sur le recruteur référent. Le module ne
 * sait rien de tout cela : il voit une cible re-pointable, des liens et un
 * contexte JSON qu'il restitue tel quel.
 *
 * Pourquoi une cible par campagne plutôt qu'un lien figé sur un recruteur :
 * le référent change en cours de route. Avec la cible, tous les liens déjà
 * partis basculent sur le nouvel agenda sans réémission, et les rendez-vous
 * déjà pris ne bougent pas (ils ont figé leur ressource).
 *
 * CLÉ D'IDEMPOTENCE = l'identifiant d'ANALYSE, jamais l'uid brut. L'uid IMAP
 * n'est unique que par boîte, et une campagne peut en avoir plusieurs
 * (`campaign_mailboxes` est une table n:n) : deux candidats pourraient alors
 * partager une clé sur la même cible — donc le même jeton, donc le prénom de
 * l'autre sur la page, et une révocation qui frappe le mauvais lien.
 */
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getRecruiter } from '@/lib/db/repos/recruiters';
import {
  cancelBookingByOrganizer,
  createBookingLink,
  createTarget,
  getBooking,
  getConfirmedBookingByLink,
  getTarget,
  listLinksForTarget,
  repointTarget,
  revokeLink,
  type Booking,
  type BookingLink,
} from '@/lib/scheduling';

import { ensureSchedulingConfigured } from './configure';
import { recruiterCanHostBookings } from './recruiter-resource';

/** Durée de vie d'un lien d'invitation — alignée sur le lien CV signé. */
const LINK_TTL_DAYS = 30;

/**
 * Contexte transporté par le lien et restitué dans chaque événement. Trois
 * champs : `uid` retrouve le briefing en attente, `analysisId` identifie la
 * candidature de façon globalement unique, `campaignId` situe le tout.
 */
export type BookingContext = {
  uid: string | null;
  analysisId: string;
  campaignId: string;
};

/** Lecture DÉFENSIVE du contexte : il vient de la base, pas du code. */
export function parseBookingContext(value: unknown): BookingContext | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  const analysisId = typeof raw.analysisId === 'string' ? raw.analysisId : null;
  const campaignId = typeof raw.campaignId === 'string' ? raw.campaignId : null;
  if (!analysisId || !campaignId) return null;
  return {
    uid: typeof raw.uid === 'string' ? raw.uid : null,
    analysisId,
    campaignId,
  };
}

/** Une campagne réserve-t-elle en natif ? Une tâche isolée : jamais. */
export async function isNativeSchedulingCampaign(
  campaignId: string | null | undefined,
): Promise<boolean> {
  if (!campaignId || campaignId.startsWith('TASK-')) return false;
  try {
    const campaign = await getCampaign(campaignId);
    return campaign?.schedulingNative === true;
  } catch {
    // Campagne illisible ⇒ on ne bascule pas : le régime historique reste la
    // valeur sûre (un lien Cal.com qui part vaut mieux qu'un lien absent).
    return false;
  }
}

/**
 * SONDE, sans effet de bord : l'invitation peut-elle porter un lien natif ?
 *
 * Sert au gate d'envoi, qui s'exécute AVANT de savoir si le mail partira.
 * Émettre un jeton ici laisserait un lien orphelin derrière chaque envoi
 * avorté — d'où la séparation stricte entre « peut-on ? » et « émets ».
 */
export async function canEmitBookingLink(campaignId: string): Promise<boolean> {
  try {
    const campaign = await getCampaign(campaignId);
    if (!campaign?.ownerUserId) return false;
    const recruiter = await getRecruiter(campaign.ownerUserId);
    if (!recruiter?.isActive) return false;
    return await recruiterCanHostBookings(campaign.ownerUserId);
  } catch {
    return false;
  }
}

/**
 * Cible de la campagne, créée si besoin et RÉCONCILIÉE sur le référent
 * courant. La réconciliation est un filet : le changement de référent passe
 * normalement par le dialog d'impact, mais rien ne garantit qu'un autre
 * chemin (import, correction en base) n'ait pas bougé `owner_user_id`.
 */
export async function ensureCampaignTarget(
  campaignId: string,
  ownerUserId: string | null,
): Promise<void> {
  await ensureSchedulingConfigured();
  const existing = await getTarget(campaignId);
  if (!existing) {
    await createTarget({
      externalRef: campaignId,
      resourceExternalRef: ownerUserId,
    });
    return;
  }
  if (existing.resourceExternalRef !== ownerUserId) {
    await repointTarget(campaignId, ownerUserId);
  }
}

/**
 * Un lien est à USAGE UNIQUE : une fois réservé, il est consommé. Réinviter un
 * candidat (rendez-vous annulé, lien expiré) demande donc une clé NOUVELLE —
 * ré-émettre avec la même rendrait fidèlement le jeton mort. Le suffixe garde
 * le rattachement à la candidature lisible, et `keysForAnalysis` le retrouve.
 */
export function reissueKey(analysisId: string, attempt: number): string {
  return attempt <= 1 ? analysisId : `${analysisId}#r${attempt}`;
}

function isKeyForAnalysis(key: string, analysisId: string): boolean {
  return key === analysisId || key.startsWith(`${analysisId}#r`);
}

/** Tous les liens (toutes générations) d'une candidature, du plus ancien au plus récent. */
async function linksForAnalysis(
  campaignId: string,
  analysisId: string,
): Promise<BookingLink[]> {
  const links = await listLinksForTarget(campaignId);
  return links.filter((l) => isKeyForAnalysis(l.idempotencyKey, analysisId));
}

export type EmitBookingLinkInput = {
  campaignId: string;
  /** Identité de la candidature — voyage dans le contexte de la réservation. */
  analysisId: string;
  /**
   * Clé d'idempotence du lien. Vaut l'identifiant d'analyse au premier envoi ;
   * une réinvitation en passe une nouvelle (`reissueKey`).
   */
  linkKey?: string;
  /** uid d'analyse : ce que porte le briefing en attente. */
  uid: string | null;
  candidateName: string;
  candidateEmail: string | null;
  jobTitle: string | null;
  organizationName: string | null;
};

/**
 * Émet (ou retrouve) le lien de réservation d'une candidature. Idempotent par
 * construction : ré-appeler avec la même analyse rend le MÊME jeton — c'est ce
 * qui permet au relecteur de prévisualiser autant de fois qu'il veut le lien
 * qui partira vraiment.
 *
 * `null` ⇒ pas de lien émissible (référent absent ou sans disponibilités) :
 * l'appelant retombe sur son gate « invitation bloquée ».
 */
export async function emitCampaignBookingLink(
  input: EmitBookingLinkInput,
): Promise<string | null> {
  const campaign = await getCampaign(input.campaignId).catch(() => null);
  const ownerUserId = campaign?.ownerUserId ?? null;
  if (!(await recruiterCanHostBookings(ownerUserId))) return null;

  await ensureCampaignTarget(input.campaignId, ownerUserId);

  const context: BookingContext = {
    uid: input.uid,
    analysisId: input.analysisId,
    campaignId: input.campaignId,
  };

  const result = await createBookingLink({
    targetExternalRef: input.campaignId,
    idempotencyKey: input.linkKey ?? input.analysisId,
    context,
    display: {
      title: input.jobTitle ? `Entretien — ${input.jobTitle}` : 'Entretien',
      organisation: input.organizationName,
      attendeeName: firstName(input.candidateName),
      attendeeEmail: input.candidateEmail,
    },
    expiresAt: new Date(
      Date.now() + LINK_TTL_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
  return result.url;
}

/**
 * Tue TOUS les liens d'une candidature (refus tranché, classement sans suite)
 * — y compris les réinvitations, sinon un lien d'une génération précédente
 * survivrait au classement. Aucun lien à révoquer est le cas NORMAL d'une
 * candidature qui n'a jamais été invitée : silence, pas d'erreur.
 */
export async function revokeCampaignBookingLink(
  campaignId: string | null,
  analysisId: string,
  reason: string,
): Promise<void> {
  if (!campaignId || campaignId.startsWith('TASK-')) return;
  await ensureSchedulingConfigured();
  const target = await getTarget(campaignId);
  if (!target) return; // aucune cible ⇒ aucun lien natif n'a jamais été émis
  for (const link of await linksForAnalysis(campaignId, analysisId)) {
    if (link.status === 'active') await revokeLink(link.token, reason);
  }
}

/**
 * Prochaine clé de lien pour une candidature : la génération suivante. Rendue
 * séparément de l'émission pour que l'appelant compose son message avec
 * exactement la clé qui sera utilisée.
 */
export async function nextReissueKey(
  campaignId: string,
  analysisId: string,
): Promise<string> {
  await ensureSchedulingConfigured();
  const target = await getTarget(campaignId);
  if (!target) return analysisId;
  const existing = await linksForAnalysis(campaignId, analysisId);
  return reissueKey(analysisId, existing.length + 1);
}

/**
 * Rendez-vous CONFIRMÉ d'une candidature, s'il existe. Passe par les liens de
 * la cible : la clé d'idempotence est la seule chose qu'on connaisse d'elle.
 */
export async function findConfirmedBookingForAnalysis(
  campaignId: string | null,
  analysisId: string,
): Promise<Booking | null> {
  if (!campaignId || campaignId.startsWith('TASK-')) return null;
  await ensureSchedulingConfigured();
  const target = await getTarget(campaignId);
  if (!target) return null;
  // Toutes générations confondues, la plus récente d'abord : c'est le dernier
  // lien qui porte le rendez-vous en cours.
  const links = (await linksForAnalysis(campaignId, analysisId)).reverse();
  for (const link of links) {
    const booking = await getConfirmedBookingByLink(link.token);
    if (booking) return booking;
  }
  return null;
}

/**
 * Annule le rendez-vous d'une candidature au nom de l'organisation, SANS
 * prévenir l'invité quand une autre voix s'en charge déjà (matrice de mails
 * du classement sans suite) — jamais deux messages pour un même fait.
 */
export async function cancelBookingForAnalysis(params: {
  campaignId: string | null;
  analysisId: string;
  reason: string;
  notifyAttendee: boolean;
  /**
   * Reçoit le rendez-vous AVANT son annulation. L'appelant a souvent besoin
   * de son créneau pour rédiger le message qui suit — et après l'annulation,
   * il faudrait le relire pour rien.
   */
  onBooking?: (booking: Booking) => void;
}): Promise<'cancelled' | 'none'> {
  const booking = await findConfirmedBookingForAnalysis(
    params.campaignId,
    params.analysisId,
  );
  if (!booking) return 'none';
  params.onBooking?.(booking);
  const verdict = await cancelBookingByOrganizer(booking.id, {
    reason: params.reason,
    notifyAttendee: params.notifyAttendee,
  });
  return verdict === 'cancelled' ? 'cancelled' : 'none';
}

/**
 * Un rendez-vous est-il ENCORE valide ? Sert à la réouverture d'une
 * candidature : restaurer un briefing en « rendez-vous pris » alors que la
 * réservation a été décommandée entre-temps donnerait un état faux.
 *
 * `null` = on ne sait pas (identifiant qui n'est pas du module — un uid
 * Cal.com par exemple) : l'appelant garde alors le comportement historique.
 */
export async function isBookingStillConfirmed(
  bookingUid: string | null,
): Promise<boolean | null> {
  if (!bookingUid) return null;
  try {
    await ensureSchedulingConfigured();
    const booking = await getBooking(bookingUid);
    return booking ? booking.status === 'confirmed' : null;
  } catch {
    // Identifiant hors module (colonne uuid + uid Cal.com) ⇒ indécidable.
    return null;
  }
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
