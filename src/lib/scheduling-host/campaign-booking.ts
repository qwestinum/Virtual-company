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
  getResource,
  getTarget,
  listConfirmedBookingsByLinkTokens,
  listLinksForTarget,
  listWeeklyRules,
  repointTarget,
  resolveMeetingLocation,
  revokeLink,
  type Booking,
  type BookingLink,
  type MeetingLocation,
  type Resource,
  type Target,
  type WeeklyRule,
} from '@/lib/scheduling';
import type { ActiveCampaign } from '@/stores/campaigns-store';

import { ensureSchedulingConfigured } from './configure';

/**
 * CONTEXTE DE RÉSERVATION D'UNE CAMPAGNE — résolu au plus UNE fois par
 * requête, puis transmis.
 *
 * Une même requête (relancer un lien, classer sans suite, composer une
 * invitation) relisait la campagne, la cible, ses liens et la ressource du
 * référent à chaque sous-étape : jusqu'à 48 allers-retours enchaînés pour une
 * relance (diagnostic de latence du 14/09/2026). Ce contexte lit chaque
 * élément au premier besoin et le garde pour la suite de la requête.
 *
 * ⚠️ Jamais de mémoire ENTRE requêtes : l'objet naît dans la requête et meurt
 * avec elle. Toute écriture qui change ce qu'il a lu l'OUBLIE aussitôt
 * (`forgetTarget`, `forgetLinks`) — la lecture suivante repart de la base.
 * Les échecs sont partagés tels quels : chaque appelant garde son propre
 * `catch`, donc son propre repli, exactement comme avant.
 */
export type CampaignBookingContext = {
  readonly campaignId: string;
  campaign(): Promise<ActiveCampaign | null>;
  target(): Promise<Target | null>;
  /** Liens de la cible (toutes générations). Vide si la cible n'existe pas. */
  links(): Promise<BookingLink[]>;
  /** Ressource d'un compte (le référent, en pratique). */
  resource(userId: string): Promise<Resource | null>;
  weeklyRules(resource: Resource): Promise<WeeklyRule[]>;
  forgetTarget(): void;
  forgetLinks(): void;
  /**
   * Contexte FRÈRE pour un autre geste de la même requête : il partage ce qui
   * est stable (campagne, cible, ressources) mais relit les LIENS. Sert aux
   * lots (clôture) où chaque dossier doit voir un lien émis entre-temps.
   */
  fork(): CampaignBookingContext;
};

export function createCampaignBookingContext(
  campaignId: string,
  seed?: { campaign?: ActiveCampaign | null },
  inherited?: Map<string, Promise<unknown>>,
): CampaignBookingContext {
  const memo = new Map<string, Promise<unknown>>(
    [...(inherited ?? new Map<string, Promise<unknown>>())].filter(([key]) => key !== 'links'),
  );
  const once = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    let promise = memo.get(key) as Promise<T> | undefined;
    if (!promise) {
      promise = load();
      memo.set(key, promise);
    }
    return promise;
  };
  if (seed && 'campaign' in seed) memo.set('campaign', Promise.resolve(seed.campaign ?? null));

  const context: CampaignBookingContext = {
    campaignId,
    campaign: () => once('campaign', () => getCampaign(campaignId)),
    target: () =>
      once('target', async () => {
        await ensureSchedulingConfigured();
        return getTarget(campaignId);
      }),
    links: () =>
      once('links', async () => {
        const target = await context.target();
        return target ? listLinksForTarget(target) : [];
      }),
    resource: (userId) =>
      once(`resource:${userId}`, async () => {
        await ensureSchedulingConfigured();
        return getResource(userId);
      }),
    weeklyRules: (resource) =>
      once(`rules:${resource.id}`, () => listWeeklyRules(resource)),
    forgetTarget: () => {
      memo.delete('target');
      memo.delete('links');
    },
    forgetLinks: () => {
      memo.delete('links');
    },
    fork: () => createCampaignBookingContext(campaignId, undefined, memo),
  };
  return context;
}

/**
 * Le référent peut-il recevoir des réservations ? Même règle que
 * `recruiterCanHostBookings` (ressource active + au moins une règle), lue
 * dans le contexte de la requête.
 */
async function ownerCanHostBookings(
  ctx: CampaignBookingContext,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const resource = await ctx.resource(userId);
    if (!resource || !resource.isActive) return false;
    return (await ctx.weeklyRules(resource)).length > 0;
  } catch {
    return false;
  }
}

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
  ctx?: CampaignBookingContext,
): Promise<boolean> {
  if (!campaignId || campaignId.startsWith('TASK-')) return false;
  try {
    const campaign = await (ctx ?? createCampaignBookingContext(campaignId)).campaign();
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
export async function canEmitBookingLink(
  campaignId: string,
  ctx: CampaignBookingContext = createCampaignBookingContext(campaignId),
): Promise<boolean> {
  try {
    const campaign = await ctx.campaign();
    if (!campaign?.ownerUserId) return false;
    const ownerUserId = campaign.ownerUserId;
    // Les trois vérifications sont indépendantes : lues ENSEMBLE, jugées dans
    // l'ordre d'origine (le verdict est le même, une panne rend `false`).
    const recruiterPromise = getRecruiter(ownerUserId);
    const canHostPromise = ownerCanHostBookings(ctx, ownerUserId);
    const locationPromise = resolveCampaignMeetingLocation(campaignId, ctx);
    const recruiter = await recruiterPromise;
    if (!recruiter?.isActive) return false;
    if (!(await canHostPromise)) return false;
    // Un agenda ouvert ne suffit pas : sans lieu, le candidat réserverait un
    // rendez-vous dont personne ne lui dit où il se tient. C'est le seul
    // endroit qui le garantit pour TOUS les chemins d'envoi (chat, poller,
    // réinvitation, refus groupé) — l'écran, lui, ne fait que prévenir.
    const location = await locationPromise;
    return location.resolved !== null;
  } catch {
    return false;
  }
}

/**
 * Où se tient un entretien de cette campagne — les trois faits d'un coup.
 *
 * `resolved` est ce que le candidat verra ; il vaut la surcharge de campagne
 * si elle existe, sinon le lieu du référent. La résolution elle-même reste
 * celle du module (`resolveMeetingLocation`) : on ne réécrit pas la règle ici,
 * on lui fournit ses deux entrées. `inherited` est rendu à part parce qu'un
 * écran qui propose « hériter du référent » doit pouvoir MONTRER ce dont il
 * hérite — annoncer un héritage sans dire lequel n'aide personne.
 *
 * Fail-soft : une lecture impossible rend trois `null`. L'appelant qui décide
 * d'envoyer (la sonde) traite alors « inconnu » comme « pas de lieu », ce qui
 * bloque — c'est le bon sens de la panne pour une garde.
 */
export async function resolveCampaignMeetingLocation(
  campaignId: string,
  ctx: CampaignBookingContext = createCampaignBookingContext(campaignId),
): Promise<{
  /** Lieu du référent de la campagne. */
  inherited: MeetingLocation | null;
  /** Lieu propre à la campagne, s'il a été posé. */
  override: MeetingLocation | null;
  /** Ce qui sera réellement annoncé au candidat. */
  resolved: MeetingLocation | null;
}> {
  const empty = { inherited: null, override: null, resolved: null };
  try {
    await ensureSchedulingConfigured();
    const campaign = await ctx.campaign();
    if (!campaign) return empty;
    const [resource, target] = await Promise.all([
      // Même repli que `getRecruiterResource` : ressource illisible ⇒ aucune.
      campaign.ownerUserId
        ? ctx.resource(campaign.ownerUserId).catch(() => null)
        : Promise.resolve(null),
      ctx.target(),
    ]);
    const inherited = resource?.meetingLocation ?? null;
    const override = target?.meetingLocationOverride ?? null;
    return {
      inherited,
      override,
      resolved: resolveMeetingLocation({
        resourceDefault: inherited,
        targetOverride: override,
      }),
    };
  } catch {
    return empty;
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
  ctx: CampaignBookingContext = createCampaignBookingContext(campaignId),
): Promise<void> {
  await ensureSchedulingConfigured();
  const existing = await ctx.target();
  if (!existing) {
    await createTarget({
      externalRef: campaignId,
      resourceExternalRef: ownerUserId,
    });
    ctx.forgetTarget();
    return;
  }
  if (existing.resourceExternalRef !== ownerUserId) {
    await repointTarget(campaignId, ownerUserId);
    ctx.forgetTarget();
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
  ctx: CampaignBookingContext,
  analysisId: string,
): Promise<BookingLink[]> {
  const links = await ctx.links();
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
  ctx: CampaignBookingContext = createCampaignBookingContext(input.campaignId),
): Promise<string | null> {
  const campaign = await ctx.campaign().catch(() => null);
  const ownerUserId = campaign?.ownerUserId ?? null;
  // La cible est lue en même temps que la vérification du référent (elle en
  // est indépendante) ; la décision reste dans l'ordre d'origine.
  const targetPromise = ctx.target();
  targetPromise.catch(() => undefined);
  if (!(await ownerCanHostBookings(ctx, ownerUserId))) return null;

  await ensureCampaignTarget(input.campaignId, ownerUserId, ctx);

  const context: BookingContext = {
    uid: input.uid,
    analysisId: input.analysisId,
    campaignId: input.campaignId,
  };

  ctx.forgetLinks();
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
  ctx?: CampaignBookingContext,
): Promise<void> {
  if (!campaignId || campaignId.startsWith('TASK-')) return;
  const context = ctx ?? createCampaignBookingContext(campaignId);
  await ensureSchedulingConfigured();
  const target = await context.target();
  if (!target) return; // aucune cible ⇒ aucun lien natif n'a jamais été émis
  const active = (await linksForAnalysis(context, analysisId)).filter(
    (link) => link.status === 'active',
  );
  // Révocations indépendantes (un jeton chacune, update conditionnel).
  await Promise.all(active.map((link) => revokeLink(link.token, reason)));
  if (active.length > 0) context.forgetLinks();
}

/**
 * État du lien de réservation d'une candidature, pour ANNONCER un effet avant
 * de l'appliquer (dialog de correction). Sans effet de bord.
 *
 * `null` = régime Cal.com ou campagne sans cible : il n'existe AUCUN objet
 * lien à interroger. L'appelant doit le DIRE plutôt que d'afficher un vide —
 * « aucun lien » et « pas de notion de lien » ne se lisent pas pareil.
 */
export async function bookingLinkStateForAnalysis(
  campaignId: string | null,
  analysisId: string,
  ctx?: CampaignBookingContext,
): Promise<{ hasActive: boolean; statuses: BookingLink['status'][] } | null> {
  if (!campaignId || campaignId.startsWith('TASK-')) return null;
  try {
    const context = ctx ?? createCampaignBookingContext(campaignId);
    await ensureSchedulingConfigured();
    const target = await context.target();
    if (!target) return null;
    const links = await linksForAnalysis(context, analysisId);
    return {
      hasActive: links.some((l) => l.status === 'active'),
      statuses: links.map((l) => l.status),
    };
  } catch {
    return null;
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
  ctx: CampaignBookingContext = createCampaignBookingContext(campaignId),
): Promise<string> {
  await ensureSchedulingConfigured();
  const target = await ctx.target();
  if (!target) return analysisId;
  const existing = await linksForAnalysis(ctx, analysisId);
  return reissueKey(analysisId, existing.length + 1);
}

/**
 * Rendez-vous CONFIRMÉ d'une candidature, s'il existe. Passe par les liens de
 * la cible : la clé d'idempotence est la seule chose qu'on connaisse d'elle.
 */
export async function findConfirmedBookingForAnalysis(
  campaignId: string | null,
  analysisId: string,
  ctx?: CampaignBookingContext,
): Promise<Booking | null> {
  if (!campaignId || campaignId.startsWith('TASK-')) return null;
  const context = ctx ?? createCampaignBookingContext(campaignId);
  await ensureSchedulingConfigured();
  const target = await context.target();
  if (!target) return null;
  // Toutes générations confondues, la plus récente d'abord : c'est le dernier
  // lien qui porte le rendez-vous en cours.
  const links = (await linksForAnalysis(context, analysisId)).reverse();
  if (links.length === 0) return null;
  // UNE lecture pour tous les liens (au lieu d'une par lien), puis le même
  // choix : le lien le plus récent qui porte un rendez-vous confirmé, et pour
  // ce lien la réservation la plus récente.
  const bookings = await listConfirmedBookingsByLinkTokens(links.map((l) => l.token));
  return pickConfirmedBookingForLinks(links, bookings);
}

/**
 * Choix PUR (testé) : parcourt les liens dans l'ordre donné (le plus récent
 * d'abord) et rend, pour le premier lien qui en porte une, sa réservation
 * confirmée la plus récente — exactement ce que faisait la lecture lien par
 * lien (`order created_at desc, limit 1`).
 */
export function pickConfirmedBookingForLinks(
  linksMostRecentFirst: readonly Pick<BookingLink, 'token'>[],
  bookings: readonly Booking[],
): Booking | null {
  for (const link of linksMostRecentFirst) {
    const forLink = bookings
      .filter((b) => b.linkToken === link.token && b.status === 'confirmed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (forLink[0]) return forLink[0];
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
  /** Contexte déjà résolu par la requête appelante. */
  context?: CampaignBookingContext;
}): Promise<'cancelled' | 'none'> {
  const booking = await findConfirmedBookingForAnalysis(
    params.campaignId,
    params.analysisId,
    params.context,
  );
  if (!booking) return 'none';
  params.onBooking?.(booking);
  // La réservation vient d'être lue : on la transmet plutôt que de la relire.
  // L'annulation reste conditionnée à `confirmed` en base — une course perdue
  // rend `already_cancelled`, comme avant.
  const verdict = await cancelBookingByOrganizer(booking, {
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
