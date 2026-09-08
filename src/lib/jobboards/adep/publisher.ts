/**
 * `AdepSepPublisher` — l'adaptateur ADEP du port `JobBoardPublisher`.
 *
 * Il assemble tout le lot 0 : constructeur XML, parseur d'acquittement,
 * catalogue d'erreurs. Il ne connaît pas le réseau — le transport est injecté
 * (cf. `transport.ts`), ce qui permet au mock d'exercer la totalité de cette
 * logique en rejouant des réponses enregistrées.
 *
 * ── LA RÈGLE CENTRALE : JAMAIS UN SECOND `openPosition` ─────────────────────
 *
 * `openPosition` crée une offre, et l'Apec n'a aucun moyen de fusionner deux
 * créations. Dès que l'issue d'un appel est douteuse, on ne rejoue pas : **on
 * va lire**, par la référence client, qui est notre clé d'idempotence chez
 * l'Apec. Trois chemins mènent à cette lecture, et ils rendent tous le même
 * verdict :
 *
 *   1. le transport a échoué sans certitude → on lit ;
 *   2. l'acquittement porte un `API_390` (« cette référence est déjà prise »)
 *      → ce n'est PAS un échec, c'est la preuve que l'offre existe → on lit ;
 *   3. la lecture elle-même échoue → `uncertain`, et personne ne rejoue.
 *
 * Le seul cas où l'on peut rejouer `publish` tel quel est
 * `AdepTransportError.certainlyNotSent` : la requête n'a pas quitté la machine.
 *
 * ⚠️ Un `API_390` dont la lecture ne retrouve RIEN n'est pas un doublon à nous :
 * la référence appartient à une offre qu'on ne voit pas (un autre compte, un
 * historique). C'est alors un vrai refus, et il faut une nouvelle référence —
 * pas une reprise.
 */

import {
  buildGetPositionStatusEnvelope,
  buildOpenPositionEnvelope,
  buildUpdatePositionStatusEnvelope,
} from './build-open-position';
import { describeAdepError, extractErrorCode } from './errors';
import { SOAP_ACTIONS } from './namespaces';
import {
  AdepParseError,
  parseAcknowledgement,
  parsePositionStatus,
} from './parse-ack';
import { AdepTransportError, type AdepTransport } from './transport';
import type {
  JobBoardPublisher,
  PublishOutcome,
  RemoteIssue,
  RemoteRef,
  StatusOutcome,
  TransitionOutcome,
} from '../types';
import type {
  AdepAcknowledgement,
  AdepCredentials,
  AdepOffer,
  AdepPositionStatusResult,
} from '@/types/adep';

/**
 * Codes qui signifient « la plateforme ne connaît pas cette référence ».
 * Ils arrivent en faute de service, pas en acquittement — le schéma exige au
 * moins un `onePosition` dans une réponse de statut, donc « rien trouvé » ne
 * peut PAS s'exprimer par une réponse vide.
 */
const NOT_FOUND_CODES = new Set(['391', '392', '393']);

/** « Cette référence est déjà utilisée par une offre chez l'Apec. » */
const REFERENCE_TAKEN_CODE = '390';

/** « L'offre est déjà dans le statut demandé » — une non-action, pas une faute. */
const ALREADY_IN_STATE_CODE = '353';

export type AdepPublisherDeps = {
  transport: AdepTransport;
  /** Résout l'identité d'appel au moment de l'appel — jamais capturée ici. */
  credentials: () => Promise<AdepCredentials>;
  /**
   * Fabrique l'identifiant de transaction. Injecté pour que les tests soient
   * déterministes ; `defaultTrackingId` est l'implémentation réelle.
   */
  trackingId?: (clientReference: string) => string;
};

/**
 * Identifiant de transaction : `orqa-<référence>-<epoch ms>`.
 *
 * Les deux-points sont INTERDITS par l'Apec (spec §VI.1), ce qui exclut un
 * horodatage ISO — d'où l'epoch. Le tiret, lui, est autorisé.
 */
export function defaultTrackingId(clientReference: string): string {
  return `orqa-${clientReference}-${Date.now()}`;
}

function toIssues(ack: AdepAcknowledgement): RemoteIssue[] {
  return ack.exceptions.map((exception) => {
    const described = describeAdepError({
      code: exception.code,
      message: exception.message,
    });
    return {
      code: exception.code,
      message: described.message,
      ...(described.field ? { field: described.field } : {}),
      blocking: exception.severity === 'Fatal',
    };
  });
}

function hasCode(ack: AdepAcknowledgement, code: string): boolean {
  return ack.exceptions.some((e) => e.code === code);
}

/**
 * Code porté par une faute de service. L'Apec y met le nom de l'erreur
 * (`API_391_REF_NOT_FOUND_ERROR`) : sans cette lecture, un « offre inconnue »
 * deviendrait une panne, et l'appelant croirait la plateforme en carafe.
 */
function faultCode(err: AdepParseError): string | null {
  return extractErrorCode({ code: null, message: err.faultString ?? err.message });
}

export class AdepSepPublisher
  implements JobBoardPublisher<AdepOffer, AdepPositionStatusResult>
{
  readonly channel = 'apec';

  constructor(private readonly deps: AdepPublisherDeps) {}

  private nextTrackingId(clientReference: string): string {
    return (this.deps.trackingId ?? defaultTrackingId)(clientReference);
  }

  private async send(
    operation: keyof typeof SOAP_ACTIONS,
    envelope: string,
  ): Promise<string> {
    return this.deps.transport.post({
      operation,
      soapAction: SOAP_ACTIONS[operation],
      envelope,
    });
  }

  async publish(offer: AdepOffer): Promise<PublishOutcome<AdepPositionStatusResult>> {
    const credentials = await this.deps.credentials();
    const envelope = buildOpenPositionEnvelope(offer, credentials);

    let response: string;
    try {
      response = await this.send('openPosition', envelope);
    } catch (err) {
      if (err instanceof AdepTransportError && err.certainlyNotSent) {
        // La requête n'a pas quitté la machine : rien n'a pu être créé, et
        // republier est sans risque. C'est le SEUL cas.
        return { kind: 'unavailable', reason: err.message };
      }
      // Tout le reste est « on ne sait pas ». On ne republie surtout pas :
      // on va voir si l'offre existe.
      return this.reconcile(offer.clientPositionId, describeTransportFailure(err));
    }

    let ack: AdepAcknowledgement;
    try {
      ack = parseAcknowledgement(response);
    } catch (err) {
      if (err instanceof AdepParseError && err.code === 'soap_fault') {
        // Une faute de service peut survenir APRÈS la création (incident en
        // fin de traitement). On ne suppose rien : on va lire.
        return this.reconcile(offer.clientPositionId, err.message);
      }
      return this.reconcile(
        offer.clientPositionId,
        err instanceof Error ? err.message : 'Réponse illisible.',
      );
    }

    if (ack.ok && ack.apecPositionNumero) {
      return {
        kind: 'published',
        remoteId: ack.apecPositionNumero,
        status: null,
      };
    }

    if (hasCode(ack, REFERENCE_TAKEN_CODE)) {
      // « Référence déjà prise » n'est pas un échec : c'est la preuve que
      // l'offre existe. On va la chercher pour rendre son numéro.
      const found = await this.lookup(offer.clientPositionId);
      if (found.kind === 'found') {
        return {
          kind: 'already_published',
          remoteId: found.status.apecPositionNumero,
          status: found.status,
          recovered: true,
        };
      }
      if (found.kind === 'not_found') {
        // La référence est prise par une offre que NOUS ne voyons pas. C'est
        // un vrai refus : il faut une nouvelle référence, pas une reprise.
        return { kind: 'rejected', issues: toIssues(ack) };
      }
      return { kind: 'uncertain', reason: found.reason };
    }

    if (ack.ok && !ack.apecPositionNumero) {
      // Acquittement sans exception bloquante mais sans numéro : l'Apec ne
      // nous dit pas ce qu'elle a fait. On refuse de conclure.
      return this.reconcile(
        offer.clientPositionId,
        "L'Apec a acquitté sans donner de numéro d'offre.",
      );
    }

    return { kind: 'rejected', issues: toIssues(ack) };
  }

  /** Va lire par la référence client, et traduit le résultat en issue de publication. */
  private async reconcile(
    clientReference: string,
    reason: string,
  ): Promise<PublishOutcome<AdepPositionStatusResult>> {
    const found = await this.lookup(clientReference);
    if (found.kind === 'found') {
      return {
        kind: 'already_published',
        remoteId: found.status.apecPositionNumero,
        status: found.status,
        recovered: true,
      };
    }
    if (found.kind === 'not_found') {
      // Vérifié : rien n'existe sous cette référence. Rejouable tel quel.
      return { kind: 'unavailable', reason };
    }
    // On n'a pas pu vérifier. Personne ne rejoue.
    return {
      kind: 'uncertain',
      reason: `${reason} La vérification a échoué à son tour : ${found.reason}`,
    };
  }

  private async lookup(
    clientReference: string,
    remoteId?: string | null,
  ): Promise<StatusOutcome<AdepPositionStatusResult>> {
    let credentials: AdepCredentials;
    try {
      credentials = await this.deps.credentials();
    } catch (err) {
      return { kind: 'unavailable', reason: describeTransportFailure(err) };
    }

    const envelope = buildGetPositionStatusEnvelope({
      creds: credentials,
      trackingId: this.nextTrackingId(clientReference),
      clientPositionId: clientReference,
      apecPositionNumero: remoteId ?? null,
    });

    let response: string;
    try {
      response = await this.send('getPositionStatus', envelope);
    } catch (err) {
      return { kind: 'unavailable', reason: describeTransportFailure(err) };
    }

    try {
      const positions = parsePositionStatus(response);
      const first = positions[0];
      if (!first) return { kind: 'not_found' };
      return { kind: 'found', status: first };
    } catch (err) {
      if (err instanceof AdepParseError && err.code === 'soap_fault') {
        const code = faultCode(err);
        // « Référence inconnue » est une réponse VALIDE, pas une panne.
        if (code && NOT_FOUND_CODES.has(code)) return { kind: 'not_found' };
        return { kind: 'unavailable', reason: describeAdepError({ code }).message };
      }
      return {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'Réponse illisible.',
      };
    }
  }

  async getStatus(ref: RemoteRef): Promise<StatusOutcome<AdepPositionStatusResult>> {
    return this.lookup(ref.clientReference, ref.remoteId);
  }

  async suspend(ref: RemoteRef): Promise<TransitionOutcome<AdepPositionStatusResult>> {
    return this.transition(ref, 'SUSPENDUE');
  }

  async republish(ref: RemoteRef): Promise<TransitionOutcome<AdepPositionStatusResult>> {
    return this.transition(ref, 'PUBLIEE');
  }

  /**
   * Changement d'état. Contrairement à `publish`, il EST idempotent côté Apec :
   * demander deux fois le même statut rend `API_353` (« déjà dans cet état »),
   * qu'on traduit en `already_in_state` plutôt qu'en erreur. Un incident de
   * transport n'a donc pas besoin de la machinerie de réconciliation — il suffit
   * de dire que ça n'a pas abouti, et l'écran relira le statut.
   */
  private async transition(
    ref: RemoteRef,
    newStatus: 'SUSPENDUE' | 'PUBLIEE',
  ): Promise<TransitionOutcome<AdepPositionStatusResult>> {
    let credentials: AdepCredentials;
    try {
      credentials = await this.deps.credentials();
    } catch (err) {
      return { kind: 'unavailable', reason: describeTransportFailure(err) };
    }

    const envelope = buildUpdatePositionStatusEnvelope({
      creds: credentials,
      trackingId: this.nextTrackingId(ref.clientReference),
      clientPositionId: ref.clientReference,
      apecPositionNumero: ref.remoteId ?? null,
      newStatus,
    });

    let response: string;
    try {
      response = await this.send('updatePositionStatus', envelope);
    } catch (err) {
      return { kind: 'unavailable', reason: describeTransportFailure(err) };
    }

    let ack: AdepAcknowledgement;
    try {
      ack = parseAcknowledgement(response);
    } catch (err) {
      if (err instanceof AdepParseError && err.code === 'soap_fault') {
        const code = faultCode(err);
        if (code === ALREADY_IN_STATE_CODE) return { kind: 'already_in_state' };
        if (code) {
          return {
            kind: 'refused',
            issues: [
              {
                code,
                message: describeAdepError({ code }).message,
                blocking: true,
              },
            ],
          };
        }
      }
      return {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : 'Réponse illisible.',
      };
    }

    if (hasCode(ack, ALREADY_IN_STATE_CODE)) return { kind: 'already_in_state' };
    if (!ack.ok) return { kind: 'refused', issues: toIssues(ack) };

    // L'acquittement ne porte pas le nouvel état : on relit, pour que l'écran
    // affiche ce que l'Apec dit et non ce que nous avons demandé. Une lecture
    // en échec ne remet pas en cause la transition, qui a bien eu lieu.
    const found = await this.lookup(ref.clientReference, ref.remoteId);
    return {
      kind: 'changed',
      status: found.kind === 'found' ? found.status : null,
    };
  }
}

/** Message d'incident, sans jamais laisser filtrer un secret. */
function describeTransportFailure(err: unknown): string {
  if (err instanceof AdepTransportError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Incident de communication avec l’Apec.';
}
