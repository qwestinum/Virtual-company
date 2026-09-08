/**
 * Constructeur du flux `openPositionRequest` (SEP). PUR.
 *
 * ── L'ORDRE DES ÉLÉMENTS VIENT DU WSDL, PAS DE LA PROSE ─────────────────────
 *
 * Tous les types HR-XML utilisés ici sont des `<xs:sequence>` : l'ordre est
 * IMPOSÉ, et un élément bien nommé mais mal placé rend
 * `API_023_VALIDATION_XML_ERROR`. Le document de spécifications présente les
 * champs en tableaux, qui ne disent rien de l'ordre ; les schémas INLINE du
 * WSDL (`docs/apec/adepsep-test.wsdl`) le disent. Ce fichier suit le WSDL.
 *
 * Les séquences qui nous concernent, telles que le WSDL les déclare :
 *
 *   OpenPositionRequestType : authentication, UniquePayloadTrackingId, position
 *   PositionOpeningType     : PositionRecordInfo?, PositionPostings?,
 *                             PositionSupplier*, PositionProfile*,
 *                             NumberToFill?, UserArea?
 *   PositionProfileType     : ProfileId?, ProfileName?, PositionDateInfo,
 *                             Organization*, PositionDetail?,
 *                             PositionClassification?,
 *                             FormattedPositionDescription*, HowToApply*, …
 *   PositionMatchingType    : Company*, CompanyScale*, IndustryCode*,
 *   (base de PositionDetail)  PhysicalLocation*, JobCategory*, PositionTitle*,
 *                             PositionClassification*, PositionSchedule*,
 *                             Shift*, Competency*, Education*,
 *                             RemunerationPackage?, …, UserArea?
 *   OrganizationType        : OrganizationName?, OrganizationId*, TaxId*,
 *                             LegalId*, …, IndustryCode*, …
 *
 * Deux conséquences non évidentes, toutes deux vérifiées par des tests :
 *
 *   · `PositionDateInfo` est le SEUL enfant NON optionnel de
 *     `PositionProfileType`. Ses propres enfants sont tous optionnels : on
 *     l'émet donc VIDE. L'omettre invaliderait le document, alors même que la
 *     spec le déclare « ignoré par ADEP ».
 *   · `Education` se place ENTRE `Competency` et `RemunerationPackage`. C'est
 *     contre-intuitif (la spec le mentionne bien après, au chapitre stage) et
 *     c'est le genre de détail qu'on ne découvre qu'au premier rejet.
 *
 * ── LES DEUX PRÉFIXES ───────────────────────────────────────────────────────
 *
 * `UserArea` est typé `<xs:any namespace="##other">` : ses enfants doivent être
 * dans un espace de noms AUTRE que HR-XML. D'où le mélange, à l'intérieur d'un
 * même bloc, de `hr:UserArea` et de `sep:StatusJob`. Ce n'est pas un caprice de
 * l'exemple officiel, c'est le schéma qui l'exige.
 */

import {
  NS_ADEP_SEP,
  NS_HR_XML,
  NS_SOAP_ENV,
  PREFIX_HR,
  PREFIX_SEP,
  PREFIX_SOAP,
} from './namespaces';
import { cdata, el, empty, join, raw } from './xml';
import type { AdepCredentials, AdepOffer } from '@/types/adep';

const HR = (name: string) => `${PREFIX_HR}:${name}`;
const SEP = (name: string) => `${PREFIX_SEP}:${name}`;

/** Mention imposée sur l'intitulé (API_316). Ajoutée par Apec si ≤ 76 car. */
export const HF_SUFFIX = 'H/F';

/**
 * Intitulé tel qu'il partira. PUR et exporté : l'écran affiche EXACTEMENT
 * cette chaîne et son compteur de caractères, plutôt qu'un intitulé qui
 * grandirait en silence entre l'aperçu et l'envoi.
 *
 * On n'ajoute la mention que si elle est absente — et on accepte les formes
 * courantes (`F/H`, `H-F`, `(h/f)`) plutôt que d'en coller une seconde.
 */
export function withGenderMention(title: string): string {
  const trimmed = title.trim().replace(/\s+/g, ' ');
  const alreadyMentioned = /\b[hf]\s*[/\-–]\s*[hf]\b/i.test(trimmed);
  if (alreadyMentioned) return trimmed;
  return `${trimmed} ${HF_SUFFIX}`;
}

function authenticationBlock(creds: AdepCredentials): string {
  // Séquence AuthenticationType : atsId, numeroDossier, atsPassword.
  return raw(
    SEP('authentication'),
    join([
      el(SEP('atsId'), creds.atsId),
      el(SEP('numeroDossier'), creds.numeroDossier),
      el(SEP('atsPassword'), creds.atsPassword),
    ]),
  );
}

/** `EntityIdType` : un `IdValue`, plus l'attribut `idOwner`. */
function entityId(qualifiedName: string, value: string, idOwner = 'CLIENT'): string {
  return raw(qualifiedName, el(HR('IdValue'), value), { idOwner });
}

function organizationBlock(offer: AdepOffer): string {
  if (offer.relationship === 'broker' && offer.finalClient) {
    const client = offer.finalClient;
    // Séquence OrganizationType : OrganizationName, …, LegalId, …, IndustryCode.
    return raw(
      HR('Organization'),
      join([
        el(HR('OrganizationName'), client.organizationName),
        entityId(HR('LegalId'), client.siret, 'INSEE'),
        el(HR('IndustryCode'), client.nafCode, { classificationName: 'INSEE' }),
      ]),
    );
  }
  // Mode direct : seul le courriel de l'interlocuteur peut figurer, et il est
  // facultatif (à défaut, l'Apec pose celui du compte). D'où l'élément vide,
  // exactement comme dans l'exemple officiel.
  if (offer.contactEmail) {
    return raw(
      HR('Organization'),
      raw(
        HR('ContactInfo'),
        raw(HR('ContactMethod'), el(HR('InternetEmailAddress'), offer.contactEmail)),
      ),
    );
  }
  return empty(HR('Organization'));
}

function physicalLocations(offer: AdepOffer): string {
  // Deux occurrences, dans l'ordre de l'exemple officiel : zone puis commune.
  // Séquence SEPPhysicalLocationType : Id?, Name?, SpatialLocation?,
  // TravelDirections*, Area*, PostalAddress?, Comments?.
  const zone = raw(
    HR('PhysicalLocation'),
    join([
      el(HR('Name'), 'LOCATION_ZONE_DEPLACEMENT'),
      raw(HR('Area'), el(HR('Value'), offer.travelZone), { type: 'APEC' }),
    ]),
  );
  const commune = raw(
    HR('PhysicalLocation'),
    join([
      el(HR('Name'), 'LOCATION_CODE'),
      raw(HR('Area'), el(HR('Value'), offer.inseeCode), { type: 'INSEE' }),
    ]),
  );
  return zone + commune;
}

function remunerationBlock(offer: AdepOffer): string | null {
  if (offer.salaryMin == null && offer.salaryMax == null) return null;
  return raw(
    HR('RemunerationPackage'),
    raw(
      HR('BasePay'),
      join([
        offer.salaryMin != null ? el(HR('BasePayAmountMin'), String(offer.salaryMin)) : null,
        offer.salaryMax != null ? el(HR('BasePayAmountMax'), String(offer.salaryMax)) : null,
      ]),
    ),
  );
}

/**
 * `UserArea` du `PositionDetail`. Ses enfants sont dans l'espace de noms ADEP
 * (cf. l'en-tête). L'ordre suit celui de la réponse `getPosition` de l'Apec,
 * qui est la meilleure indication disponible : le schéma déclare un `xs:any`,
 * donc rien n'y est contraint, mais coller à ce que le serveur émet lui-même
 * coûte zéro et supprime une inconnue.
 */
function userAreaBlock(offer: AdepOffer): string {
  return raw(
    HR('UserArea'),
    join([
      offer.durationMonths != null
        ? el(SEP('Duration'), String(offer.durationMonths))
        : null,
      el(SEP('PartTime'), offer.partTime ? 'true' : 'false'),
      offer.partTimeDuration ? el(SEP('PartTimeDuration'), offer.partTimeDuration) : null,
      offer.remoteWork ? el(SEP('RemoteWork'), offer.remoteWork) : null,
      el(SEP('JobType'), offer.jobType),
      el(SEP('StatusJob'), offer.statusJob),
      offer.datePositionTaken
        ? el(SEP('DatePositionTaken'), offer.datePositionTaken)
        : null,
      offer.releaseDate ? el(SEP('ReleaseDate'), offer.releaseDate) : null,
      el(SEP('DisplayedPay'), offer.displayedPay),
      offer.videoUrl ? el(SEP('UrlVideo'), offer.videoUrl) : null,
    ]),
  );
}

function positionDetailBlock(offer: AdepOffer): string {
  return raw(
    HR('PositionDetail'),
    join([
      el(HR('IndustryCode'), offer.nafCode, { classificationName: 'INSEE' }),
      physicalLocations(offer),
      el(HR('PositionTitle'), withGenderMention(offer.positionTitle)),
      raw(
        HR('Competency'),
        raw(HR('CompetencyEvidence'), el(HR('StringValue'), offer.experienceLevel)),
        { name: 'GLOBAL_EXPERIENCE_LEVEL' },
      ),
      // Présent vide dans l'exemple officiel, et l'erreur API_335 existe : on
      // le reproduit tel quel plutôt que de parier sur son inutilité. C'est
      // l'une des questions posées au support (§ questions ouvertes).
      empty(HR('Competency'), { name: 'INTERNATIONAL_PROFILE' }),
      // ⚠️ Education AVANT RemunerationPackage — séquence PositionMatchingType.
      offer.educationLevel
        ? raw(HR('Education'), el(HR('EducationLevel'), offer.educationLevel))
        : null,
      remunerationBlock(offer),
      userAreaBlock(offer),
    ]),
  );
}

function formattedDescription(name: string, value: string, asCdata = true): string {
  return raw(
    HR('FormattedPositionDescription'),
    join([
      el(HR('Name'), name),
      asCdata ? raw(HR('Value'), cdata(value)) : el(HR('Value'), value),
    ]),
  );
}

function descriptionsBlock(offer: AdepOffer): string {
  return join([
    formattedDescription('POSITION_TYPE', offer.positionType, false),
    formattedDescription('POSITION_DESCRIPTION', offer.positionDescription),
    formattedDescription('PROFILE_DESCRIPTION', offer.profileDescription),
    formattedDescription('ORGANIZATION_DESCRIPTION', offer.organizationDescription),
    formattedDescription('ORGANIZATION_NAME', offer.organizationName),
    formattedDescription(
      'POSITION_DISPLAY_LOGO',
      offer.displayLogo ? 'true' : 'false',
      false,
    ),
    offer.presentationDescription
      ? formattedDescription('PRESENTATION_DESCRIPTION', offer.presentationDescription)
      : null,
    offer.recruitmentDescription
      ? formattedDescription('RECRUITMENT_DESCRIPTION', offer.recruitmentDescription)
      : null,
  ]);
}

function howToApplyBlock(offer: AdepOffer): string {
  // Séquence HowToApply : PersonName?, ApplicationMethod?, UserArea?.
  const personName = offer.applyContact
    ? raw(
        HR('PersonName'),
        join([
          el(HR('Affix'), offer.applyContact.civility, { type: 'formOfAdress' }),
          el(HR('GivenName'), offer.applyContact.givenName),
          el(HR('FamilyName'), offer.applyContact.familyName),
          el(HR('Affix'), offer.applyContact.qualification, { type: 'qualification' }),
        ]),
      )
    : null;
  const method = raw(
    HR('ApplicationMethod'),
    join([
      el(HR('InternetEmailAddress'), offer.applicationEmail),
      // Une URL de candidature est INTERDITE sur une offre confidentielle
      // (API_1336). On ne l'émet donc pas, plutôt que de compter sur le
      // validateur : le constructeur ne doit pas pouvoir produire un flux que
      // l'on sait refusé.
      offer.applicationUrl && offer.positionType !== 'ODC'
        ? el(HR('InternetWebAddress'), offer.applicationUrl)
        : null,
    ]),
  );
  return raw(HR('HowToApply'), join([personName, method]));
}

/** Le corps `openPositionRequest`, hors enveloppe. Utile aux tests. */
export function buildOpenPositionBody(
  offer: AdepOffer,
  creds: AdepCredentials,
): string {
  const profile = raw(
    HR('PositionProfile'),
    join([
      entityId(HR('ProfileId'), offer.clientPositionId),
      el(HR('ProfileName'), 'APEC'),
      // Seul enfant NON optionnel de PositionProfileType : émis vide.
      empty(HR('PositionDateInfo')),
      organizationBlock(offer),
      positionDetailBlock(offer),
      descriptionsBlock(offer),
      howToApplyBlock(offer),
    ]),
    { 'xml:lang': 'fr' },
  );

  const position = raw(
    SEP('position'),
    join([
      empty(HR('PositionSupplier'), { relationship: offer.relationship }),
      profile,
      el(HR('NumberToFill'), String(offer.numberToFill)),
    ]),
  );

  return raw(
    SEP('openPositionRequest'),
    join([
      authenticationBlock(creds),
      entityId(SEP('UniquePayloadTrackingId'), offer.trackingId),
      position,
    ]),
    {
      [`xmlns:${PREFIX_SEP}`]: NS_ADEP_SEP,
      [`xmlns:${PREFIX_HR}`]: NS_HR_XML,
    },
  );
}

/** L'enveloppe SOAP complète, prête à poster. */
export function buildOpenPositionEnvelope(
  offer: AdepOffer,
  creds: AdepCredentials,
): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    raw(
      `${PREFIX_SOAP}:Envelope`,
      join([
        empty(`${PREFIX_SOAP}:Header`),
        raw(`${PREFIX_SOAP}:Body`, buildOpenPositionBody(offer, creds)),
      ]),
      { [`xmlns:${PREFIX_SOAP}`]: NS_SOAP_ENV },
    )
  );
}

/** `getPositionStatus` — par référence client et/ou numéro Apec. */
export function buildGetPositionStatusEnvelope(input: {
  creds: AdepCredentials;
  trackingId: string;
  clientPositionId?: string | null;
  apecPositionNumero?: string | null;
}): string {
  // Séquence : authentication, UniquePayloadTrackingId, clientPositionId?,
  // apecPositionNumero?, numberLimit?.
  const body = raw(
    SEP('getPositionStatusRequest'),
    join([
      authenticationBlock(input.creds),
      entityId(SEP('UniquePayloadTrackingId'), input.trackingId),
      input.clientPositionId
        ? entityId(SEP('clientPositionId'), input.clientPositionId)
        : null,
      input.apecPositionNumero
        ? entityId(SEP('apecPositionNumero'), input.apecPositionNumero, 'APEC')
        : null,
    ]),
    {
      [`xmlns:${PREFIX_SEP}`]: NS_ADEP_SEP,
      [`xmlns:${PREFIX_HR}`]: NS_HR_XML,
    },
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    raw(
      `${PREFIX_SOAP}:Envelope`,
      join([
        empty(`${PREFIX_SOAP}:Header`),
        raw(`${PREFIX_SOAP}:Body`, body),
      ]),
      { [`xmlns:${PREFIX_SOAP}`]: NS_SOAP_ENV },
    )
  );
}

/** `updatePositionStatus` — dépublier (`SUSPENDUE`) / republier (`PUBLIEE`). */
export function buildUpdatePositionStatusEnvelope(input: {
  creds: AdepCredentials;
  trackingId: string;
  clientPositionId?: string | null;
  apecPositionNumero?: string | null;
  newStatus: string;
}): string {
  // Séquence : authentication, UniquePayloadTrackingId, clientPositionId?,
  // apecPositionNumero?, newPositionStatus. Le nom exact du dernier élément
  // vient du WSDL — la spec l'imprime coupé sur deux lignes.
  const body = raw(
    SEP('updatePositionStatusRequest'),
    join([
      authenticationBlock(input.creds),
      entityId(SEP('UniquePayloadTrackingId'), input.trackingId),
      input.clientPositionId
        ? entityId(SEP('clientPositionId'), input.clientPositionId)
        : null,
      input.apecPositionNumero
        ? entityId(SEP('apecPositionNumero'), input.apecPositionNumero, 'APEC')
        : null,
      el(SEP('newPositionStatus'), input.newStatus),
    ]),
    {
      [`xmlns:${PREFIX_SEP}`]: NS_ADEP_SEP,
      [`xmlns:${PREFIX_HR}`]: NS_HR_XML,
    },
  );
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    raw(
      `${PREFIX_SOAP}:Envelope`,
      join([
        empty(`${PREFIX_SOAP}:Header`),
        raw(`${PREFIX_SOAP}:Body`, body),
      ]),
      { [`xmlns:${PREFIX_SOAP}`]: NS_SOAP_ENV },
    )
  );
}

/**
 * Caviarde les secrets d'un flux avant journalisation ou affichage.
 *
 * Deux champs, pas un : le mot de passe évidemment, mais aussi le
 * `numeroDossier`, qui est l'identifiant Apec d'une PERSONNE. Un journal qui
 * porte l'un des deux est un journal qu'on ne peut plus montrer.
 */
export function redactCredentials(xml: string): string {
  return xml
    .replace(
      /(<(?:[A-Za-z0-9_.-]+:)?atsPassword>)[\s\S]*?(<\/(?:[A-Za-z0-9_.-]+:)?atsPassword>)/g,
      '$1[secret]$2',
    )
    .replace(
      /(<(?:[A-Za-z0-9_.-]+:)?numeroDossier>)[\s\S]*?(<\/(?:[A-Za-z0-9_.-]+:)?numeroDossier>)/g,
      '$1[secret]$2',
    );
}
