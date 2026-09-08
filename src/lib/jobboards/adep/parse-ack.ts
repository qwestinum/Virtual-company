/**
 * Lecture de l'acquittement ADEP (`AcknowledgeType`). PUR.
 *
 * ── LE VERDICT ──────────────────────────────────────────────────────────────
 *
 * La spec est explicite, et c'est la seule règle qui compte : « Un acquittement
 * contenant pour chaque entité `EntityNoException:true`, ou des exceptions de
 * sévérité inférieure à Fatal, sera considéré comme étant un succès. Par contre
 * une exception `Fatal` annulera TOUTE transaction réalisée par le web
 * service. »
 *
 * Donc : `ok` est vrai si et seulement si AUCUNE exception `Fatal` n'apparaît,
 * où qu'elle soit. Ce n'est pas un décompte d'entités en erreur, ce n'est pas
 * une majorité, et une entité en succès ne compense jamais une entité en échec.
 * Les `Warning` et `Informational` sont CONSERVÉS et remontés : ce sont des
 * remarques utiles (« champ facultatif vide ») qu'on veut voir sans bloquer.
 *
 * ── POURQUOI UN VRAI PARSEUR ────────────────────────────────────────────────
 *
 * `PayloadDisposition` contient une LISTE d'`EntityDisposition` dont le nombre
 * varie avec le flux, et chacune peut porter PLUSIEURS `Exception`. Lire cela
 * à la regex marcherait sur le premier exemple et casserait en silence sur la
 * deuxième exception — exactement le mode de défaillance qu'on ne veut pas sur
 * le chemin qui décide si une offre est publiée.
 *
 * Deux réglages de `fast-xml-parser` sont indispensables et non négociables :
 *
 *   · `removeNSPrefix` — les préfixes changent d'une réponse à l'autre
 *     (`ns2:`, `ns3:`, aucun) ; s'y fier serait bâtir sur du sable ;
 *   · `isArray` sur `EntityDisposition` et `Exception` — sans quoi une
 *     occurrence UNIQUE arrive en objet et une boucle la manque. C'est le
 *     piège classique de ce parseur, et il est silencieux.
 */

import { XMLParser } from 'fast-xml-parser';

import { describeAdepError, extractErrorCode } from './errors';
import { ADEP_SEVERITIES } from '@/types/adep';
import type {
  AdepAcknowledgement,
  AdepException,
  AdepPositionStatusResult,
  AdepSeverity,
} from '@/types/adep';

export class AdepParseError extends Error {
  constructor(
    public readonly code: 'unparseable' | 'soap_fault' | 'unexpected_shape',
    message: string,
    /** Détail de la faute SOAP, quand c'en est une. */
    public readonly faultString?: string,
  ) {
    super(message);
    this.name = 'AdepParseError';
  }
}

const ARRAY_NODES = new Set([
  'EntityDisposition',
  'Exception',
  'onePosition',
  'EntityInfo',
  'validationErrors',
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  trimValues: true,
  // Tout en chaîne : `177596708W` est un identifiant, `0642` un code postal.
  // Laisser le parseur « deviner » des nombres perdrait des zéros de tête et
  // transformerait des identifiants en flottants.
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => ARRAY_NODES.has(name),
});

type XmlNode = Record<string, unknown>;

function asNode(value: unknown): XmlNode | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as XmlNode)
    : null;
}

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Texte d'un nœud, qu'il soit une chaîne nue ou un objet à attributs. */
function text(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() || null;
  const node = asNode(value);
  if (!node) return null;
  const inner = node['#text'];
  return typeof inner === 'string' ? inner.trim() || null : null;
}

/** Premier `IdValue` d'un `EntityIdType`. */
function idValue(value: unknown): string | null {
  const node = asNode(value);
  if (!node) return text(value);
  const first = asArray(node.IdValue)[0];
  return text(first);
}

/** Descend une suite de clés, en tolérant l'absence à chaque étage. */
function at(root: unknown, ...path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    const node = asNode(current);
    if (!node) return undefined;
    current = node[key];
  }
  return current;
}

function parseXml(xml: string): XmlNode {
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new AdepParseError(
      'unparseable',
      err instanceof Error ? err.message : 'XML illisible.',
    );
  }
  const root = asNode(parsed);
  if (!root) {
    throw new AdepParseError('unparseable', 'Réponse vide ou non XML.');
  }
  return root;
}

/**
 * Une faute de service SOAP est un chemin d'échec DISTINCT de l'acquittement,
 * et il faut les distinguer : une faute ne dit rien sur l'offre (l'appel n'a
 * pas atteint la couche métier), un acquittement `Fatal` dit précisément quel
 * champ est en cause. Les confondre ferait chercher un champ inexistant.
 */
function assertNoSoapFault(root: XmlNode): void {
  const body = at(root, 'Envelope', 'Body');
  const fault = asNode(at(body, 'Fault'));
  if (!fault) return;
  const detail =
    text(fault.faultstring) ??
    text(at(fault, 'Reason', 'Text')) ??
    text(fault.faultcode) ??
    'faute de service non détaillée';
  throw new AdepParseError(
    'soap_fault',
    `L'Apec a renvoyé une faute de service : ${detail}`,
    detail,
  );
}

function normalizeSeverity(value: string | null): AdepSeverity {
  const match = ADEP_SEVERITIES.find(
    (s) => s.toLowerCase() === value?.trim().toLowerCase(),
  );
  // Une sévérité illisible est traitée comme FATALE. C'est le seul repli sûr :
  // supposer « Warning » ferait considérer comme publiée une offre rejetée.
  return match ?? 'Fatal';
}

function collectExceptions(disposition: XmlNode): AdepException[] {
  const entity = text(disposition.EntityShortName);
  const xpath = text(disposition.EntityInstanceXPath);
  const exceptions = asArray(at(disposition, 'EntityException', 'Exception'));
  return exceptions.flatMap((raw): AdepException[] => {
    const node = asNode(raw);
    if (!node) return [];
    const message = text(node.ExceptionMessage) ?? '';
    return [
      {
        code: extractErrorCode({
          code: text(node.ExceptionIdentifier),
          message,
        }),
        severity: normalizeSeverity(text(node.ExceptionSeverity)),
        message,
        entity,
        xpath: text(node.ExceptionScopeSchemaXPath) ?? xpath,
      },
    ];
  });
}

/**
 * Lit un acquittement `openPositionResponse` (ou tout `AcknowledgeType`).
 *
 * `apecPositionNumero` est `minOccurs="0"` au schéma : il est absent quand rien
 * n'a été créé. On ne le rend donc JAMAIS avec `ok:false` — la combinaison
 * « échec + numéro » ferait croire à une offre existante et empêcherait la
 * reprise par référence.
 */
export function parseAcknowledgement(xml: string): AdepAcknowledgement {
  const root = parseXml(xml);
  assertNoSoapFault(root);

  const body = at(root, 'Envelope', 'Body');
  const response = asNode(body)
    ? Object.entries(asNode(body) as XmlNode).find(([key]) =>
        key.endsWith('Response'),
      )?.[1]
    : undefined;
  const payload = asNode(response);
  if (!payload) {
    throw new AdepParseError(
      'unexpected_shape',
      "La réponse ne contient pas d'acquittement exploitable.",
    );
  }

  const dispositions = asArray(
    at(payload, 'PayloadDisposition', 'EntityDisposition'),
  );
  const exceptions = dispositions.flatMap((raw) => {
    const node = asNode(raw);
    return node ? collectExceptions(node) : [];
  });

  const ok = !exceptions.some((e) => e.severity === 'Fatal');
  const numero = text(payload.apecPositionNumero) ?? idValue(payload.apecPositionNumero);

  return {
    ok,
    trackingId: idValue(
      at(payload, 'PayloadResponseSummary', 'UniquePayloadTrackingId'),
    ),
    apecPositionNumero: ok ? numero : null,
    exceptions,
  };
}

/**
 * Traduit les exceptions en phrases montrables, l'échec d'abord.
 *
 * Le tri n'est pas cosmétique : quand l'Apec renvoie huit remarques et un
 * `Fatal`, c'est le `Fatal` qui explique le rejet, et c'est lui qu'on veut sur
 * la première ligne de l'écran.
 */
export function describeAcknowledgement(ack: AdepAcknowledgement): Array<{
  severity: AdepSeverity;
  code: string | null;
  message: string;
  field?: string;
}> {
  const rank: Record<AdepSeverity, number> = {
    Fatal: 0,
    Warning: 1,
    Informational: 2,
  };
  return [...ack.exceptions]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .map((e) => {
      const described = describeAdepError({ code: e.code, message: e.message });
      return {
        severity: e.severity,
        code: e.code,
        message: described.message,
        ...(described.field ? { field: described.field } : {}),
      };
    });
}

/** Lit `getPositionStatusResponse`. Plusieurs offres possibles. */
export function parsePositionStatus(xml: string): AdepPositionStatusResult[] {
  const root = parseXml(xml);
  assertNoSoapFault(root);
  const body = at(root, 'Envelope', 'Body');
  const response = asNode(body)
    ? Object.entries(asNode(body) as XmlNode).find(([key]) =>
        key.endsWith('Response'),
      )?.[1]
    : undefined;
  const positions = asArray(at(response, 'onePosition'));
  return positions.flatMap((raw): AdepPositionStatusResult[] => {
    const node = asNode(raw);
    if (!node) return [];
    const numero = text(node.apecPositionNumero) ?? idValue(node.apecPositionNumero);
    const clientId = text(node.clientPositionId) ?? idValue(node.clientPositionId);
    const status = text(node.status);
    if (!numero || !status) return [];
    return [
      {
        apecPositionNumero: numero,
        clientPositionId: clientId ?? '',
        status,
        isEditable: text(node.isEditable) === 'true',
        positionUrl: text(node.positionUrl) ?? '',
      },
    ];
  });
}
