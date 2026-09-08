/**
 * Transport de recette — rejoue des réponses ADEP enregistrées.
 *
 * ── CE QU'IL SIMULE, ET CE QU'IL N'A PAS LE DROIT DE SIMULER ────────────────
 *
 * Il ne fabrique que ce qui vient du réseau : des chaînes XML. Tout le reste —
 * construction du flux SEP, lecture de l'acquittement, reconnaissance du
 * « ça existe déjà », enchaînement de reprise — est le code de production, et
 * il tourne pour de bon. Un faux `JobBoardPublisher` rendant des objets tout
 * faits aurait donné une recette d'écran verte sans qu'une seule de ces lignes
 * ne s'exécute ; c'est précisément ce qu'on refuse.
 *
 * Corollaire : le mock tient un ÉTAT, parce que l'Apec en tient un. Une offre
 * publiée devient lisible, une référence réutilisée rend `API_390`, une offre
 * suspendue se republie. Sans cet état, le scénario qui compte — celui de la
 * reprise après incident — ne serait pas jouable.
 *
 * ── LES SCÉNARIOS D'ÉCHEC SONT DES FICHIERS, PAS DU CODE ────────────────────
 *
 * Les acquittements en échec sont des réponses ENREGISTRÉES
 * (`__tests__/fixtures/*.xml`), calquées sur le §VI.2.2 de la spécification. Le
 * jour où l'Apec nous enverra un vrai rejet, on remplacera le fichier par la
 * réponse réelle sans toucher au mock : c'est la consigne « le mock rejoue des
 * acquittements réels ».
 *
 * ⚠️ Elles sont lues depuis `recorded-acks.ts` (copie INLINE), jamais depuis le
 * disque : ce transport est appelé depuis une route Next en recette, et un
 * `readFileSync` vers `__tests__` casserait dans un bundle de production. La
 * copie et la source sont gardées identiques par un test.
 */

import { NS_ADEP_SEP, NS_HR_XML } from './namespaces';
import { ACK_FATAL_330, ACK_FATAL_390, ACK_WARNING_ONLY, SOAP_FAULT } from './recorded-acks';
import { AdepTransportError, type AdepTransport, type AdepTransportRequest } from './transport';
import type { AdepPositionStatus } from '@/types/adep';

/** Panne injectable, pour jouer les chemins d'incident. */
export type MockFailure =
  /** Le réseau tombe AVANT l'envoi — rejouable sans risque. */
  | { kind: 'not_sent'; message?: string }
  /** Délai dépassé : l'Apec a peut-être traité. C'est le cas intéressant. */
  | { kind: 'timeout'; message?: string }
  /** Une réponse brute arbitraire (faute SOAP, HTML d'un portail…). */
  | { kind: 'respond'; xml: string };

export type MockPosition = {
  clientPositionId: string;
  apecPositionNumero: string;
  status: AdepPositionStatus;
  positionUrl: string;
  isEditable: boolean;
};

export type MockAdepOptions = {
  /** Offres déjà connues de l'Apec au démarrage. */
  seed?: MockPosition[];
  /**
   * Pannes à jouer, consommées dans l'ordre, par opération. Une entrée par
   * appel ; les appels suivants se déroulent normalement.
   */
  failures?: Partial<Record<AdepTransportRequest['operation'], MockFailure[]>>;
  /** Numéros Apec attribués aux créations, dans l'ordre. */
  numeros?: string[];
};

/** Extrait une valeur d'élément, quel que soit le préfixe. */
function readElement(xml: string, local: string): string | null {
  const pattern = new RegExp(
    `<(?:[A-Za-z0-9_.-]+:)?${local}\\b[^>]*>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${local}>`,
  );
  const match = pattern.exec(xml);
  if (!match) return null;
  const inner = match[1] ?? '';
  const idValue = /<(?:[A-Za-z0-9_.-]+:)?IdValue\b[^>]*>([\s\S]*?)</.exec(inner);
  return (idValue?.[1] ?? inner).trim() || null;
}

/** Référence client d'une requête — le second `IdValue` du bloc identité. */
function readClientReference(envelope: string): string | null {
  return (
    readElement(envelope, 'clientPositionId') ?? readElement(envelope, 'ProfileId')
  );
}

function ackEnvelope(inner: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
    inner +
    '</soap:Body></soap:Envelope>'
  );
}

function soapFault(message: string): string {
  return ackEnvelope(
    `<soap:Fault><faultcode>soap:Server</faultcode><faultstring>${message}</faultstring></soap:Fault>`,
  );
}

function openPositionSuccess(trackingId: string, numero: string): string {
  return ackEnvelope(
    `<sep:openPositionResponse xmlns:hr="${NS_HR_XML}" xmlns:sep="${NS_ADEP_SEP}">` +
      `<hr:PayloadResponseSummary><hr:UniquePayloadTrackingId idOwner="CLIENT">` +
      `<hr:IdValue>${trackingId}</hr:IdValue></hr:UniquePayloadTrackingId>` +
      `</hr:PayloadResponseSummary>` +
      `<hr:PayloadDisposition><hr:EntityDisposition>` +
      `<hr:EntityShortName>Position opening</hr:EntityShortName>` +
      `<hr:EntityInstanceXPath>/PositionOpening</hr:EntityInstanceXPath>` +
      `<hr:EntityNoException>true</hr:EntityNoException>` +
      `</hr:EntityDisposition></hr:PayloadDisposition>` +
      `<sep:apecPositionNumero>${numero}</sep:apecPositionNumero>` +
      `</sep:openPositionResponse>`,
  );
}

function statusResponse(position: MockPosition): string {
  return ackEnvelope(
    `<sep:getPositionStatusResponse xmlns:hr="${NS_HR_XML}" xmlns:sep="${NS_ADEP_SEP}">` +
      `<hr:onePosition>` +
      `<hr:apecPositionNumero>${position.apecPositionNumero}</hr:apecPositionNumero>` +
      `<hr:clientPositionId>${position.clientPositionId}</hr:clientPositionId>` +
      `<hr:status>${position.status}</hr:status>` +
      `<hr:isEditable>${position.isEditable}</hr:isEditable>` +
      `<hr:positionUrl>${position.positionUrl}</hr:positionUrl>` +
      `</hr:onePosition>` +
      `<hr:uniquePayloadTrackingId idOwner="CLIENT"><hr:IdValue>mock</hr:IdValue></hr:uniquePayloadTrackingId>` +
      `</sep:getPositionStatusResponse>`,
  );
}

function transitionAck(): string {
  return ackEnvelope(
    `<sep:updatePositionStatusResponse xmlns:hr="${NS_HR_XML}" xmlns:sep="${NS_ADEP_SEP}">` +
      `<hr:PayloadResponseSummary/>` +
      `<hr:PayloadDisposition><hr:EntityDisposition>` +
      `<hr:EntityShortName>Position opening</hr:EntityShortName>` +
      `<hr:EntityInstanceXPath>/PositionOpening</hr:EntityInstanceXPath>` +
      `<hr:EntityNoException>true</hr:EntityNoException>` +
      `</hr:EntityDisposition></hr:PayloadDisposition>` +
      `</sep:updatePositionStatusResponse>`,
  );
}

/**
 * Le mock. Expose son état (`positions`, `calls`) pour que les tests et la
 * recette puissent affirmer ce qui s'est réellement passé — notamment
 * « combien de `openPosition` », qui est LA question du scénario de reprise.
 */
export class MockAdepTransport implements AdepTransport {
  readonly positions = new Map<string, MockPosition>();
  /** Journal des appels, dans l'ordre. */
  readonly calls: Array<{ operation: string; clientReference: string | null }> = [];

  private readonly failures: Map<string, MockFailure[]>;
  private readonly numeros: string[];
  private nextNumero = 0;

  constructor(options: MockAdepOptions = {}) {
    for (const position of options.seed ?? []) {
      this.positions.set(position.clientPositionId, { ...position });
    }
    this.failures = new Map(
      Object.entries(options.failures ?? {}).map(([op, list]) => [op, [...(list ?? [])]]),
    );
    this.numeros = options.numeros ?? [];
  }

  /** Nombre d'appels d'une opération — la mesure du « jamais deux fois ». */
  countOf(operation: string): number {
    return this.calls.filter((c) => c.operation === operation).length;
  }

  private takeFailure(operation: string): MockFailure | null {
    const queue = this.failures.get(operation);
    return queue && queue.length > 0 ? (queue.shift() ?? null) : null;
  }

  private allocateNumero(): string {
    const provided = this.numeros[this.nextNumero];
    this.nextNumero += 1;
    return provided ?? `${100000000 + this.nextNumero}W`;
  }

  async post(request: AdepTransportRequest): Promise<string> {
    const clientReference = readClientReference(request.envelope);
    this.calls.push({ operation: request.operation, clientReference });

    const failure = this.takeFailure(request.operation);
    if (failure) {
      if (failure.kind === 'not_sent') {
        throw new AdepTransportError(
          failure.message ?? 'Connexion à l’Apec impossible.',
          true,
        );
      }
      if (failure.kind === 'timeout') {
        // ⚠️ La panne est levée APRÈS la mutation d'état : c'est le scénario
        // qui compte. L'Apec a créé l'offre, la réponse s'est perdue, et un
        // rejeu naïf en créerait une seconde.
        this.applyEffect(request, clientReference);
        throw new AdepTransportError(
          failure.message ?? 'Délai dépassé en attendant la réponse de l’Apec.',
          false,
        );
      }
      return failure.xml;
    }

    return this.respond(request, clientReference);
  }

  /** Applique l'effet métier sans produire de réponse (cas du délai dépassé). */
  private applyEffect(
    request: AdepTransportRequest,
    clientReference: string | null,
  ): void {
    if (request.operation !== 'openPosition' || !clientReference) return;
    if (this.positions.has(clientReference)) return;
    const numero = this.allocateNumero();
    this.positions.set(clientReference, {
      clientPositionId: clientReference,
      apecPositionNumero: numero,
      status: 'PUBLIEE',
      isEditable: true,
      positionUrl: `https://www.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/${numero}`,
    });
  }

  private respond(
    request: AdepTransportRequest,
    clientReference: string | null,
  ): string {
    if (!clientReference) {
      return soapFault('API_393_INVALID_IDENTIFICATION_ERROR');
    }

    switch (request.operation) {
      case 'openPosition': {
        if (this.positions.has(clientReference)) {
          // Référence déjà prise : c'est la garde d'idempotence de l'Apec, et
          // c'est elle qui rend la reprise possible.
          return ACK_FATAL_390;
        }
        this.applyEffect(request, clientReference);
        const created = this.positions.get(clientReference)!;
        const trackingId =
          readElement(request.envelope, 'UniquePayloadTrackingId') ?? 'mock';
        return openPositionSuccess(trackingId, created.apecPositionNumero);
      }

      case 'getPositionStatus': {
        const position = this.positions.get(clientReference);
        if (!position) return soapFault('API_391_REF_NOT_FOUND_ERROR');
        return statusResponse(position);
      }

      case 'updatePositionStatus': {
        const position = this.positions.get(clientReference);
        if (!position) return soapFault('API_391_REF_NOT_FOUND_ERROR');
        const requested = readElement(request.envelope, 'newPositionStatus');
        if (requested === position.status) {
          return soapFault('API_353_OFFRE_A_ETAT_DEMANDE');
        }
        if (requested === 'PUBLIEE' && position.status === 'FERMEE') {
          return soapFault('API_352_CHANGEMENT_ETAT_ERROR');
        }
        position.status = (requested ?? position.status) as AdepPositionStatus;
        return transitionAck();
      }

      default:
        return soapFault('API_398_UPDATE_POSITION_NOT_AVAILABLE');
    }
  }
}

/** Fixtures d'acquittement disponibles pour la recette. */
export const MOCK_ACKS = {
  fatal330: () => ACK_FATAL_330,
  fatal390: () => ACK_FATAL_390,
  warningOnly: () => ACK_WARNING_ONLY,
  soapFault: () => SOAP_FAULT,
} as const;
