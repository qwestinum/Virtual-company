/**
 * L'espace de noms, contre le WSDL RÉEL.
 *
 * Ce test existe parce que deux des quatre exemples de requête livrés par
 * l'Apec portent `https://adep.apec.fr/hrxml/sep`. Se fier à eux aurait
 * garanti un `API_023_VALIDATION_XML_ERROR` au premier appel. Le test lit le
 * WSDL déposé, pas une constante recopiée : si le fichier change, il parle.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  NS_ADEP_SEP,
  NS_HR_XML,
  SOAP_ACTIONS,
  extractWsdlTargetNamespace,
} from '../namespaces';

const WSDL_PATH = resolve(process.cwd(), 'docs/apec/adepsep-test.wsdl');

describe('espace de noms ADEP', () => {
  const wsdl = readFileSync(WSDL_PATH, 'utf8');

  it('vaut ce que déclare le WSDL de test — en http, pas en https', () => {
    expect(extractWsdlTargetNamespace(wsdl)).toBe(NS_ADEP_SEP);
    expect(NS_ADEP_SEP).toBe('http://adep.apec.fr/hrxml/sep');
    expect(NS_ADEP_SEP.startsWith('https://')).toBe(false);
  });

  it("lit le targetNamespace de <definitions>, pas celui d'un schéma inline", () => {
    // Les schémas INLINE de <wsdl:types> portent leurs propres
    // targetNamespace (HR-XML, xml:lang). Une lecture naïve « premier
    // targetNamespace du document » tomberait juste ici par chance, mais
    // « dernier » ou « n'importe lequel » rendrait HR-XML. On le prouve : le
    // document contient bien plusieurs valeurs distinctes.
    const all = [...wsdl.matchAll(/targetNamespace="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(all).size).toBeGreaterThan(1);
    expect(all).toContain(NS_HR_XML);
    expect(extractWsdlTargetNamespace(wsdl)).toBe(NS_ADEP_SEP);
  });

  it('rend null sur un document qui n’est pas un WSDL', () => {
    expect(extractWsdlTargetNamespace('<html><body>404</body></html>')).toBeNull();
    expect(extractWsdlTargetNamespace('')).toBeNull();
  });

  it('sonde : un WSDL en https serait DÉTECTÉ, pas absorbé', () => {
    // La garde de `adep:probe` ne vaut que si elle mord. On la sonde en
    // fabriquant exactement le document contre lequel elle protège.
    const forged = wsdl.replace(
      'targetNamespace="http://adep.apec.fr/hrxml/sep"',
      'targetNamespace="https://adep.apec.fr/hrxml/sep"',
    );
    expect(extractWsdlTargetNamespace(forged)).not.toBe(NS_ADEP_SEP);
  });

  it('expose les SOAPAction telles que le WSDL les déclare', () => {
    for (const action of Object.values(SOAP_ACTIONS)) {
      expect(wsdl).toContain(`soapAction="${action}"`);
    }
  });
});
