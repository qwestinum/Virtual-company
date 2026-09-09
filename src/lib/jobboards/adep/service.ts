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
import { MockAdepTransport } from './mock-transport';
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
import type { AdepCredentials, AdepOffer, AdepPositionStatusResult } from '@/types/adep';

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
): { transport: AdepTransport; simulated: boolean } {
  if (deps.transport) return { transport: deps.transport, simulated: false };
  if (!isAdepEnabled(env)) {
    return { transport: new MockAdepTransport(), simulated: true };
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
    trackingId: () => trackingId,
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
  const { transport, simulated } = resolveTransport(deps);

  const posting = await getCurrentJobPosting(input.campaignId, 'apec');
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
export async function refreshAdepStatus(input: {
  campaignId: string;
  ownerUserId: string | null;
  deps?: AdepServiceDeps;
}): Promise<{ posting: JobPosting | null; changed: boolean; simulated: boolean }> {
  const deps = input.deps ?? {};
  const now = deps.now ?? (() => new Date());
  const { transport, simulated } = resolveTransport(deps);

  const posting = await getCurrentJobPosting(input.campaignId, 'apec');
  if (!posting) return { posting: null, changed: false, simulated };

  const publisher = new AdepSepPublisher({
    transport,
    credentials: deps.credentials ?? (() => resolveAdepCredentials(input.ownerUserId)),
    ...(deps.trackingId ? { trackingId: deps.trackingId } : {}),
  });

  const status = await publisher.getStatus({
    clientReference: posting.clientReference,
    remoteId: posting.apecPositionNumero,
  });
  if (status.kind !== 'found') {
    // On ne remet PAS le cache à zéro : « je n'ai pas pu lire » n'est pas
    // « l'offre a disparu ». L'écran garde l'état connu, avec sa date.
    return { posting, changed: false, simulated };
  }

  const changed = posting.remoteStatus !== status.status.status;
  const updated = await patchJobPosting(posting.id, {
    remoteStatus: status.status.status,
    remoteStatusAt: now().toISOString(),
    remoteIsEditable: status.status.isEditable,
    remoteUrl: status.status.positionUrl,
    apecPositionNumero: status.status.apecPositionNumero,
  });
  return { posting: updated ?? posting, changed, simulated };
}
