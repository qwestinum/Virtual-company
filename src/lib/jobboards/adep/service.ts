/**
 * Le service APEC — ce que les routes appellent.
 *
 * Il assemble le publisher (logique ADEP), le repo (`job_postings`) et
 * l'identité d'appel. Trois responsabilités, et une seule règle d'or :
 *
 *   **on réserve la ligne AVANT l'appel, on la met à jour APRÈS.**
 *
 * L'ordre n'est pas négociable. Réserver après l'appel laisserait une fenêtre
 * pendant laquelle deux instances serverless partiraient toutes les deux, et
 * l'Apec créerait deux offres qu'aucun geste ne peut fusionner. C'est la même
 * discipline que les claims d'outreach IMAP, pour la même raison : entre deux
 * instances, la base est la seule chose partagée.
 *
 * ── LE MOCK N'EST PAS UN REPLI, C'EST UN MODE ───────────────────────────────
 *
 * Sans `ADEP_ENABLED`, le service utilise le transport de recette. Ce n'est pas
 * une dégradation silencieuse : la réponse porte `simulated: true`, et l'écran
 * le DIT. Un connecteur qui publierait « pour de faux » sans le montrer serait
 * pire que pas de connecteur du tout, le jour d'une démonstration.
 */

import { redactCredentials } from './build-open-position';
import { createHttpAdepTransport, endpointFromWsdlUrl } from './http-transport';
import { MockAdepTransport, type MockPosition } from './mock-transport';
import { AdepSepPublisher, defaultTrackingId } from './publisher';
import type { AdepTransport } from './transport';
import {
  getCurrentJobPosting,
  listJobPostings,
  patchJobPosting,
  reserveJobPosting,
  type JobPosting,
} from '@/lib/db/repos/job-postings';
import { getAdepNumeroDossier } from '@/lib/db/repos/recruiters';
import { resolveAtsPasswordFromEnv } from './argon2';
import { buildClientReference, nextAttempt } from './reference';
import type { PublishOutcome, TransitionOutcome } from '../types';
import {
  ADEP_POSITION_STATUSES,
  type AdepCredentials,
  type AdepOffer,
  type AdepPositionStatus,
  type AdepPositionStatusResult,
  type AdepReadOutcome,
} from '@/types/adep';

/** `ADEP_ENABLED` — fail-closed strict, comme `DEMO_JOBBOARD_ENABLED`. */
export function isAdepEnabled(env: Partial<Record<string, string>> = process.env): boolean {
  return env.ADEP_ENABLED === '1';
}

export class AdepCredentialsError extends Error {
  constructor(
    public readonly code: 'ats_id_missing' | 'password_missing' | 'numero_dossier_missing',
    message: string,
  ) {
    super(message);
    this.name = 'AdepCredentialsError';
  }
}

/**
 * Résout l'identité d'appel. Trois sources, trois natures :
 *
 *   · `atsId`          — variable d'environnement (le cabinet) ;
 *   · `atsPassword`    — variable d'environnement (précalculée) ;
 *   · `numeroDossier`  — fiche du recruteur RÉFÉRENT, déchiffrée à l'instant.
 *
 * En développement, `ADEP_TEST_NUMERO_DOSSIER` sert de repli pour les premiers
 * appels — et seulement là : il est ignoré dès que `ADEP_ENABLED` vaut `1`,
 * pour qu'un numéro de test ne parte jamais en production sous l'identité d'un
 * recruteur réel.
 */
export async function resolveAdepCredentials(
  ownerUserId: string | null,
  env: Partial<Record<string, string>> = process.env,
): Promise<AdepCredentials> {
  const atsId = env.ADEP_ATS_ID?.trim();
  if (!atsId) {
    throw new AdepCredentialsError(
      'ats_id_missing',
      "ADEP_ATS_ID n'est pas configuré : l'Apec fournit cet identifiant à la signature du contrat.",
    );
  }

  const atsPassword = await resolveAtsPasswordFromEnv(env);

  const fromRecruiter = ownerUserId ? await getAdepNumeroDossier(ownerUserId) : null;
  const fallback = isAdepEnabled(env) ? null : env.ADEP_TEST_NUMERO_DOSSIER?.trim();
  const numeroDossier = fromRecruiter ?? fallback ?? null;
  if (!numeroDossier) {
    throw new AdepCredentialsError(
      'numero_dossier_missing',
      "Le recruteur référent de la campagne n'a pas d'identifiant Apec. " +
        'Renseignez-le sur sa fiche dans les paramètres.',
    );
  }

  return { atsId, numeroDossier, atsPassword };
}

export type AdepServiceDeps = {
  /** Injecté par les tests ; en service, choisi selon `ADEP_ENABLED`. */
  transport?: AdepTransport;
  credentials?: () => Promise<AdepCredentials>;
  trackingId?: (clientReference: string) => string;
  now?: () => Date;
};

/**
 * Transport effectif — c'est ici que se joue le fail-closed.
 *
 * Sans `ADEP_ENABLED`, on simule, et la réponse porte `simulated: true` : la
 * simulation est un MODE, jamais une dégradation silencieuse. Avec le drapeau
 * mais sans URL, on ÉCHOUE — retomber sur le mock rendrait un faux succès sur
 * une offre réelle, et le recruteur croirait son poste diffusé.
 */
export function resolveTransport(
  deps: AdepServiceDeps,
  env: Partial<Record<string, string>> = process.env,
  /**
   * Ce que la BASE sait déjà de l'offre. Sert UNIQUEMENT à amorcer le mock.
   *
   * ⚠️ Sans lui, la simulation est amnésique : chaque requête HTTP construit un
   * mock vierge, et « Relire le statut » ou « Dépublier » ne trouvaient plus
   * l'offre publiée à la requête précédente — les deux boutons ne faisaient
   * RIEN. Les tests ne l'avaient pas vu parce qu'ils injectent la même instance
   * du début à la fin, ce que la vraie vie ne fait jamais. La seule chose
   * partagée entre deux requêtes est la base : c'est donc d'elle que l'état
   * doit venir, pas d'un singleton de process (qui mentirait de la même façon
   * entre deux instances serverless).
   */
  seed?: MockPosition[],
): { transport: AdepTransport; simulated: boolean } {
  if (deps.transport) return { transport: deps.transport, simulated: false };
  if (!isAdepEnabled(env)) {
    return {
      transport: new MockAdepTransport(seed?.length ? { seed } : {}),
      simulated: true,
    };
  }
  const wsdlUrl = env.ADEP_WSDL_URL?.trim();
  if (!wsdlUrl) {
    // Pas de repli sur le mock : il rendrait un faux succès sur une offre
    // réelle, et le recruteur croirait son poste diffusé.
    throw new Error(
      'ADEP_ENABLED=1 mais ADEP_WSDL_URL est absente : impossible de savoir à ' +
        "quel environnement Apec s'adresser.",
    );
  }
  return {
    transport: createHttpAdepTransport({ endpoint: endpointFromWsdlUrl(wsdlUrl) }),
    simulated: false,
  };
}

/**
 * Reconstitue, pour le mock, ce que l'Apec « saurait » de cette offre.
 *
 * Le cache local EST la vérité en simulation — il n'y a pas d'autre source. En
 * revanche il ne suffit pas toujours : une offre acquittée dont le statut n'a
 * jamais été relu n'a pas de `remoteStatus`, et on le DÉDUIT des dates plutôt
 * que de laisser le mock ignorer une offre qui existe.
 *
 * `null` quand il n'y a rien à amorcer : sans numéro Apec, l'offre n'a jamais
 * été acquittée, et prétendre le contraire ferait « réussir » une dépublication
 * sur une offre qui n'est jamais partie.
 */
export function mockSeedFromPosting(posting: JobPosting): MockPosition | null {
  if (!posting.apecPositionNumero) return null;
  const status: AdepPositionStatus =
    (ADEP_POSITION_STATUSES as readonly string[]).includes(posting.remoteStatus ?? '')
      ? (posting.remoteStatus as AdepPositionStatus)
      : posting.suspendedAt
        ? 'SUSPENDUE'
        : posting.publishedAt
          ? 'PUBLIEE'
          : 'AVALIDER';
  return {
    clientPositionId: posting.clientReference,
    apecPositionNumero: posting.apecPositionNumero,
    status,
    isEditable: posting.remoteIsEditable ?? true,
    positionUrl:
      posting.remoteUrl ??
      `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${posting.apecPositionNumero}`,
  };
}

export type PublishResult = {
  outcome: PublishOutcome<AdepPositionStatusResult>;
  posting: JobPosting | null;
  simulated: boolean;
};

/**
 * Publie une campagne. `offerWithoutTracking` vient du formulaire, DÉJÀ validé
 * par `validateAdepOffer` côté appelant : ce service n'est pas le lieu de la
 * validation métier, il est celui de l'idempotence.
 */
export async function publishToAdep(input: {
  campaignId: string;
  ownerUserId: string | null;
  offer: Omit<AdepOffer, 'trackingId' | 'clientPositionId'>;
  deps?: AdepServiceDeps;
}): Promise<PublishResult> {
  const deps = input.deps ?? {};
  const now = deps.now ?? (() => new Date());
  const { transport, simulated } = resolveTransport(deps);

  // La référence de CETTE tentative : rang = nombre de tentatives passées.
  const previous = await listJobPostings(input.campaignId, 'apec');
  const attempt = nextAttempt(previous.map((p) => p.clientReference));
  const clientReference = buildClientReference(input.campaignId, attempt);

  const trackingId = (deps.trackingId ?? defaultTrackingId)(clientReference);
  const offer: AdepOffer = { ...input.offer, clientPositionId: clientReference, trackingId };

  const credentials =
    deps.credentials ?? (() => resolveAdepCredentials(input.ownerUserId));

  // On construit le flux AVANT de réserver, pour pouvoir en stocker la version
  // caviardée : une ligne réservée dont on ignore ce qui devait partir serait
  // indéboguable.
  const { buildOpenPositionEnvelope } = await import('./build-open-position');
  const envelope = buildOpenPositionEnvelope(offer, await credentials());

  const reservation = await reserveJobPosting({
    id: `JOBP-${clientReference}`,
    campaignId: input.campaignId,
    channel: 'apec',
    clientReference,
    trackingId,
    requestSnapshot: offer,
    requestXml: redactCredentials(envelope),
  });

  if (reservation.kind === 'unavailable') {
    return {
      outcome: { kind: 'unavailable', reason: reservation.reason },
      posting: null,
      simulated,
    };
  }
  if (reservation.kind === 'taken') {
    // Un autre appel est parti sur cette référence. On n'envoie RIEN.
    return {
      outcome: {
        kind: 'uncertain',
        reason:
          'Une publication est déjà en cours pour cette campagne. Rechargez ' +
          "l'écran pour voir où elle en est.",
      },
      posting: reservation.existing,
      simulated,
    };
  }

  const publisher = new AdepSepPublisher({
    transport,
    credentials,
    // ⚠️ NE PAS figer l'identifiant de transaction ici.
    //
    // `publish()` prend le sien dans `offer.trackingId` : ce réglage ne servait
    // donc QU'aux appels que le publisher enchaîne derrière — au premier chef
    // la lecture « cette offre existe-t-elle ? » qui suit un envoi douteux. Or
    // l'Apec exige un identifiant unique par transaction et refuse un rejeu
    // (`API_108`). En le figeant, cette lecture repartait avec l'identifiant de
    // l'`openPosition` qui venait d'échouer, se faisait refuser à son tour, et
    // TOUTE publication en échec finissait en `uncertain` : le filet de
    // sécurité ne pouvait jamais se refermer, et l'écran renvoyait l'opérateur
    // vérifier à la main sur apec.fr. Mesuré le 09/09/2026 derrière un
    // `API_103` — « la vérification a échoué à son tour ».
    //
    // Rien ne se perd à le laisser libre : l'idempotence de l'offre ne repose
    // pas sur ce champ mais sur `clientPositionId` (`API_390`).
    ...(deps.trackingId ? { trackingId: deps.trackingId } : {}),
  });
  const outcome = await publisher.publish(offer);
  const at = now().toISOString();

  let posting: JobPosting | null = reservation.posting;
  switch (outcome.kind) {
    case 'published':
    case 'already_published': {
      // `openPosition` ACQUITTE, il ne renseigne pas l'état de l'offre : son
      // acquittement ne porte qu'un numéro. On enchaîne donc une LECTURE, pour
      // que l'écran affiche un statut daté au lieu d'un blanc juste après un
      // succès. (`already_published` vient déjà d'une lecture : rien à faire.)
      //
      // BEST-EFFORT STRICT : cette lecture ne peut pas faire échouer une
      // publication qui a réussi. L'offre existe chez l'Apec, le numéro est en
      // base ; si la lecture rate — latence de propagation, réseau — on laisse
      // `remoteStatusAt` à `null` et l'écran dit « statut pas encore lu »,
      // jamais « inconnu ». Le bouton « Relire le statut » reste la reprise.
      //
      // Deux filets, et ils ne couvrent pas la même chose : `getStatus` rend un
      // VERDICT pour tout ce qui est prévu (transport, faute SOAP, référence
      // inconnue) — d'où le test sur `found` ; le `catch` ne couvre que
      // l'imprévu, une exception qui échapperait au publisher. Sans lui, un
      // défaut interne de lecture ferait perdre une publication réussie, et la
      // reprise reposterait une SECONDE offre.
      const status =
        outcome.kind === 'already_published'
          ? outcome.status
          : await publisher
              .getStatus({ clientReference, remoteId: outcome.remoteId })
              .then((read) => (read.kind === 'found' ? read.status : null))
              .catch(() => null);
      posting = await patchJobPosting(reservation.posting.id, {
        attemptState: 'acknowledged',
        apecPositionNumero: status?.apecPositionNumero ?? outcome.remoteId,
        publishedAt: at,
        remoteStatus: status?.status ?? null,
        remoteStatusAt: status ? at : null,
        remoteIsEditable: status?.isEditable ?? null,
        remoteUrl: status?.positionUrl ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
      break;
    }
    case 'rejected': {
      const blocking = outcome.issues.find((i) => i.blocking) ?? outcome.issues[0];
      posting = await patchJobPosting(reservation.posting.id, {
        attemptState: 'failed',
        lastErrorCode: blocking?.code ?? null,
        lastErrorMessage: blocking?.message ?? 'Refusée par l’Apec.',
      });
      break;
    }
    case 'unavailable': {
      // Vérifié : rien n'existe chez l'Apec. La ligne reste, en échec, pour
      // que la prochaine tentative prenne une référence NEUVE — réutiliser
      // celle-ci risquerait un API_390 si la vérification s'était trompée.
      posting = await patchJobPosting(reservation.posting.id, {
        attemptState: 'failed',
        lastErrorMessage: outcome.reason,
      });
      break;
    }
    case 'uncertain': {
      // ⚠️ `sent`, pas `failed` : on ne SAIT PAS. L'écran doit dire d'aller
      // vérifier chez l'Apec, et surtout ne pas proposer de republier.
      posting = await patchJobPosting(reservation.posting.id, {
        attemptState: 'sent',
        lastErrorMessage: outcome.reason,
      });
      break;
    }
  }

  return { outcome, posting, simulated };
}

export type TransitionResult = {
  outcome: TransitionOutcome<AdepPositionStatusResult>;
  posting: JobPosting | null;
  simulated: boolean;
};

/** Dépublier ou republier la tentative courante. */
export async function transitionAdepPosting(input: {
  campaignId: string;
  ownerUserId: string | null;
  action: 'suspend' | 'republish';
  deps?: AdepServiceDeps;
}): Promise<TransitionResult> {
  const deps = input.deps ?? {};
  const now = deps.now ?? (() => new Date());

  // La base D'ABORD, pour la même raison que `refreshAdepStatus`.
  const posting = await getCurrentJobPosting(input.campaignId, 'apec');
  const seed = posting ? mockSeedFromPosting(posting) : null;
  const { transport, simulated } = resolveTransport(
    deps,
    process.env,
    seed ? [seed] : undefined,
  );
  if (!posting) {
    return {
      outcome: { kind: 'unavailable', reason: "Aucune offre APEC pour cette campagne." },
      posting: null,
      simulated,
    };
  }

  const publisher = new AdepSepPublisher({
    transport,
    credentials: deps.credentials ?? (() => resolveAdepCredentials(input.ownerUserId)),
    ...(deps.trackingId ? { trackingId: deps.trackingId } : {}),
  });

  const ref = {
    clientReference: posting.clientReference,
    remoteId: posting.apecPositionNumero,
  };
  const outcome =
    input.action === 'suspend'
      ? await publisher.suspend(ref)
      : await publisher.republish(ref);

  const at = now().toISOString();
  let updated: JobPosting | null = posting;
  if (outcome.kind === 'changed') {
    updated = await patchJobPosting(posting.id, {
      remoteStatus: outcome.status?.status ?? (input.action === 'suspend' ? 'SUSPENDUE' : 'PUBLIEE'),
      remoteStatusAt: at,
      remoteIsEditable: outcome.status?.isEditable ?? null,
      remoteUrl: outcome.status?.positionUrl ?? null,
      ...(input.action === 'suspend' ? { suspendedAt: at } : { suspendedAt: null }),
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  } else if (outcome.kind === 'refused') {
    const blocking = outcome.issues[0];
    updated = await patchJobPosting(posting.id, {
      lastErrorCode: blocking?.code ?? null,
      lastErrorMessage: blocking?.message ?? null,
    });
  }

  return { outcome, posting: updated, simulated };
}

/**
 * Relit le statut chez l'Apec et met le cache à jour.
 *
 * ⚠️ N'écrit QUE sur transition — c'est la leçon du 21/08 : `imap_mailbox_skipped`
 * réécrite à chaque relève a vidé le fil d'activité du Bureau. Ici l'écriture
 * inutile ne coûterait qu'un `updated_at`, mais le principe vaut aussi pour le
 * journal, que l'appelant alimente sur le même critère.
 */
export type RefreshResult = {
  posting: JobPosting | null;
  /**
   * Le statut a-t-il BOUGÉ ? Ne se lit que sous `read.kind === 'found'` : sur
   * une lecture qui n'a pas abouti, `false` ne veut rien dire.
   */
  changed: boolean;
  simulated: boolean;
  /** Ce que la lecture a donné. C'est LUI qui dit si elle a eu lieu. */
  read: AdepReadOutcome;
};

export async function refreshAdepStatus(input: {
  campaignId: string;
  ownerUserId: string | null;
  deps?: AdepServiceDeps;
}): Promise<RefreshResult> {
  const deps = input.deps ?? {};
  const now = deps.now ?? (() => new Date());

  // La base D'ABORD : c'est elle qui amorce le mock en simulation. Résoudre le
  // transport avant de savoir ce qu'on cherche donnait une simulation
  // amnésique, et un bouton sans effet.
  const posting = await getCurrentJobPosting(input.campaignId, 'apec');
  const seed = posting ? mockSeedFromPosting(posting) : null;
  const { transport, simulated } = resolveTransport(
    deps,
    process.env,
    seed ? [seed] : undefined,
  );
  if (!posting) {
    return { posting: null, changed: false, simulated, read: { kind: 'no_posting' } };
  }

  const publisher = new AdepSepPublisher({
    transport,
    credentials: deps.credentials ?? (() => resolveAdepCredentials(input.ownerUserId)),
    ...(deps.trackingId ? { trackingId: deps.trackingId } : {}),
  });

  const status = await publisher.getStatus({
    clientReference: posting.clientReference,
    remoteId: posting.apecPositionNumero,
  });
  if (status.kind === 'not_found') {
    // ── LA PREUVE QUI LÈVE LE DOUTE ─────────────────────────────────────────
    //
    // L'Apec a RÉPONDU, et elle ne connaît pas cette référence : rien n'existe
    // sous ce nom. C'est le même verdict que `publishToAdep` tire déjà de sa
    // réconciliation immédiate (`unavailable` ⇒ `failed`), sauf qu'il arrive
    // plus tard — donc avec MOINS de risque de propagation, pas plus.
    //
    // Sans ce passage, une publication refusée restait `sent` pour toujours :
    // `adepPhase` rendait `uncertain`, le panneau n'offrait que « Relire » et
    // « Dépublier », et la campagne était bloquée sans aucun geste pour en
    // sortir. Mesuré le 09/09/2026 sur CAMP-2026-267, refusée en `API_103`.
    //
    // ⚠️ DEUX GARDES, et elles ne sont pas négociables :
    //   · `attemptState === 'sent'` — on ne touche jamais à une tentative
    //     acquittée ni à une tentative déjà close ;
    //   · AUCUN numéro Apec — si l'offre a été acquittée, elle EXISTE, et un
    //     `not_found` est alors suspect (index en retard, mauvais dossier
    //     d'appel). La rouvrir à la publication créerait une SECONDE offre,
    //     que l'Apec ne sait pas fusionner.
    const closable = posting.attemptState === 'sent' && !posting.apecPositionNumero;
    if (!closable) {
      return { posting, changed: false, simulated, read: { kind: 'not_found', resolved: false } };
    }
    const closed = await patchJobPosting(posting.id, {
      attemptState: 'failed',
      lastErrorMessage:
        "L'Apec confirme qu'aucune offre n'existe sous cette référence : la " +
        'tentative est close, une nouvelle publication est possible.',
    });
    return {
      posting: closed ?? posting,
      changed: false,
      simulated,
      read: { kind: 'not_found', resolved: true },
    };
  }

  if (status.kind !== 'found') {
    // On ne remet PAS le cache à zéro : « je n'ai pas pu lire » n'est pas
    // « l'offre a disparu ». L'écran garde l'état connu, avec sa date.
    //
    // ⚠️ Mais on le DIT. Rendre `changed: false` et rien d'autre laissait
    // l'appelant annoncer « statut relu, il n'a pas changé » sur une lecture
    // qui n'avait jamais eu lieu — le seul message dont l'opérateur avait
    // besoin, précisément quand il en avait besoin, était le seul qu'il ne
    // recevait pas.
    return { posting, changed: false, simulated, read: status };
  }

  const changed = posting.remoteStatus !== status.status.status;
  const updated = await patchJobPosting(posting.id, {
    remoteStatus: status.status.status,
    remoteStatusAt: now().toISOString(),
    remoteIsEditable: status.status.isEditable,
    remoteUrl: status.status.positionUrl,
    apecPositionNumero: status.status.apecPositionNumero,
  });
  return { posting: updated ?? posting, changed, simulated, read: { kind: 'found' } };
}
