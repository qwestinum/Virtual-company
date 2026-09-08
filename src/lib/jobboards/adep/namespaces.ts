/**
 * Espaces de noms et actions SOAP du service ADEP V5 / HR-XML SEP.
 *
 * ── LA PREUVE, parce que les exemples de flux fournis se contredisaient ──
 *
 * Deux des quatre exemples de requête SEP livrés par l'Apec portent
 * `xmlns:ns2="https://adep.apec.fr/hrxml/sep"` (en HTTPS). C'est FAUX. Le WSDL
 * servi par l'environnement de test (`docs/apec/adepsep-test.wsdl`, ligne 1)
 * dit :
 *
 *     <wsdl:definitions … xmlns:tns="http://adep.apec.fr/hrxml/sep"
 *                         name="AdepSepService"
 *                         targetNamespace="http://adep.apec.fr/hrxml/sep">
 *
 * En HTTP, donc. Les réponses du serveur l'utilisent aussi. Un espace de noms
 * n'est pas cosmétique : le mauvais rend `API_023_VALIDATION_XML_ERROR`, une
 * erreur qui ne dit pas laquelle des cinquante balises est en cause.
 *
 * ⚠️ Le WSDL de PRODUCTION n'a pas encore été vu. `adep:probe` compare le
 * `targetNamespace` réellement servi par l'endpoint configuré à la constante
 * ci-dessous et refuse de continuer s'ils diffèrent — plutôt que de découvrir
 * la divergence sur une offre réelle.
 */

/** Espace de noms du service ADEP (préfixe `sep` dans nos flux). */
export const NS_ADEP_SEP = 'http://adep.apec.fr/hrxml/sep';

/** Espace de noms HR-XML CPO — tout le vocabulaire de l'offre. */
export const NS_HR_XML = 'http://ns.hr-xml.org/2006-02-28';

/** Enveloppe SOAP 1.1 (le WSDL déclare un binding `soap:` classique). */
export const NS_SOAP_ENV = 'http://schemas.xmlsoap.org/soap/envelope/';

/**
 * `UserArea` est typé `<xs:any namespace="##other">` dans le schéma HR-XML :
 * ses enfants doivent donc appartenir à un AUTRE espace de noms que HR-XML.
 * C'est pour cela — et pas par coquetterie — que le flux mélange les deux
 * préfixes jusque dans un même bloc :
 *
 *     <hr:UserArea><sep:StatusJob>CADRE_PRIVE</sep:StatusJob></hr:UserArea>
 *
 * Mettre `StatusJob` dans HR-XML rendrait le document invalide.
 */
export const USER_AREA_CHILDREN_NS = NS_ADEP_SEP;

/** Préfixes utilisés par le constructeur. Stables : les tests les lisent. */
export const PREFIX_SEP = 'sep';
export const PREFIX_HR = 'hr';
export const PREFIX_SOAP = 'soapenv';

/** Opérations exposées par le module Offre, avec leur `SOAPAction` (WSDL). */
export const SOAP_ACTIONS = {
  openPosition: `${NS_ADEP_SEP}/openPosition`,
  getPosition: `${NS_ADEP_SEP}/getPosition`,
  getPositionStatus: `${NS_ADEP_SEP}/getPositionStatus`,
  updatePositionStatus: `${NS_ADEP_SEP}/updatePositionStatus`,
  listRecruiterPositionOpenings: `${NS_ADEP_SEP}/listRecruiterPositionOpenings`,
  /** Exposé par le WSDL mais DÉSACTIVÉ côté Apec (API_398). Ne pas appeler. */
  updatePosition: `${NS_ADEP_SEP}/updatePosition`,
} as const;

export type AdepOperation = keyof typeof SOAP_ACTIONS;

/**
 * Extrait le `targetNamespace` d'un document WSDL. PUR — sert à la garde de
 * cohérence de `adep:probe`, et se teste sans réseau.
 *
 * On lit l'attribut porté par `<wsdl:definitions>` (le premier élément), pas
 * n'importe quel `targetNamespace` du document : les schémas INLINE de
 * `<wsdl:types>` en portent d'autres (HR-XML, `xml:lang`), parfaitement
 * légitimes, et les confondre ferait échouer la garde sur un WSDL valide.
 */
export function extractWsdlTargetNamespace(wsdl: string): string | null {
  const definitions = /<(?:[A-Za-z0-9_.-]+:)?definitions\b[^>]*>/.exec(wsdl);
  if (!definitions) return null;
  const attr = /\btargetNamespace\s*=\s*"([^"]*)"/.exec(definitions[0]);
  return attr?.[1] ?? null;
}
