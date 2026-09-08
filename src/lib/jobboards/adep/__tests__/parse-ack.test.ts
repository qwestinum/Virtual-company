/**
 * Lecture de l'acquittement.
 *
 * Les cas de SUCCÈS sont lus sur les exemples RÉELS livrés par l'Apec
 * (`docs/apec/sep_*.xml`) plutôt que sur des fixtures réécrites : un parseur
 * validé contre notre propre idée du format ne prouve rien. Les cas d'ÉCHEC
 * sont construits, faute d'exemple fourni, en calquant très exactement le
 * §VI.2.2 de la spécification.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AdepParseError,
  describeAcknowledgement,
  parseAcknowledgement,
  parsePositionStatus,
} from '../parse-ack';

const apecDoc = (name: string) =>
  readFileSync(resolve(process.cwd(), 'docs/apec', name), 'utf8');
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('acquittement de succès (exemple RÉEL de l’Apec)', () => {
  const ack = parseAcknowledgement(apecDoc('sep_openPositionResponse.xml'));

  it('rend ok et le numéro Apec', () => {
    expect(ack.ok).toBe(true);
    expect(ack.apecPositionNumero).toBe('xxxxxxxxxW');
    expect(ack.exceptions).toEqual([]);
  });

  it('renvoie notre identifiant de transaction — le contrôle de corrélation', () => {
    expect(ack.trackingId).toBe('v5-doc-adep-143');
  });
});

describe('acquittement avec exception Fatal', () => {
  const ack = parseAcknowledgement(fixture('ack-fatal-330.xml'));

  it('UNE seule Fatal suffit à faire échouer, même noyée dans des succès', () => {
    // La règle de la spec : « une exception Fatal annulera TOUTE transaction ».
    // Ce n'est ni un décompte ni une majorité — ici, deux entités en succès et
    // une en échec, et le verdict est l'échec.
    expect(ack.ok).toBe(false);
    expect(ack.exceptions).toHaveLength(1);
    expect(ack.exceptions[0]).toMatchObject({
      code: '330',
      severity: 'Fatal',
      message: 'API_330_CLIENT_INDIRECT_ACCESS_ERROR',
      entity: 'Staffing Order',
    });
  });

  it('n’expose JAMAIS de numéro Apec sur un échec', () => {
    // Rien n'a été créé. Rendre un numéro ferait croire à une offre existante
    // et empêcherait la reprise par référence.
    expect(ack.apecPositionNumero).toBeNull();
  });

  it('traduit en français orienté action, sans jargon', () => {
    const [first] = describeAcknowledgement(ack);
    expect(first?.severity).toBe('Fatal');
    expect(first?.message).toContain('client indirect');
    expect(first?.message).not.toContain('API_330');
  });
});

describe('acquittement 390 — la référence existe déjà', () => {
  const ack = parseAcknowledgement(fixture('ack-fatal-390.xml'));

  it('est un échec identifiable par son code', () => {
    // C'est ce code qui déclenche la reprise : « existe déjà, va la lire »
    // via getPositionStatus, JAMAIS un second openPosition.
    expect(ack.ok).toBe(false);
    expect(ack.exceptions[0]?.code).toBe('390');
  });

  it('se traduit en disant que la référence est prise', () => {
    const [first] = describeAcknowledgement(ack);
    expect(first?.message).toContain('déjà utilisée');
    expect(first?.field).toBe('clientPositionId');
  });
});

describe('acquittement avec Warning et Informational seulement', () => {
  const ack = parseAcknowledgement(fixture('ack-warning-only.xml'));

  it('est un SUCCÈS — seul Fatal bloque', () => {
    expect(ack.ok).toBe(true);
    expect(ack.apecPositionNumero).toBe('177596708W');
  });

  it('conserve les remarques plutôt que de les jeter', () => {
    expect(ack.exceptions).toHaveLength(2);
    expect(ack.exceptions.map((e) => e.severity)).toEqual(['Warning', 'Informational']);
  });

  it('lit une exception dont l’ExceptionIdentifier est ABSENT', () => {
    // `ExceptionIdentifier` est minOccurs="0" au schéma : le code doit alors se
    // déduire du nom. Sans ce repli, l'exception serait affichée sans code et
    // introuvable au catalogue.
    const informational = ack.exceptions[1];
    expect(informational?.code).toBe('411');
    expect(informational?.message).toBe('API_411_INVALID_URL_VIDEO_ERROR');
  });

  it('DEUX exceptions dans une seule entité sont toutes les deux lues', () => {
    // Le piège de fast-xml-parser : sans `isArray`, une occurrence unique
    // arrive en objet et une boucle la manque — en silence.
    expect(ack.exceptions.map((e) => e.code)).toEqual(['409', '411']);
  });

  it('trie l’affichage par gravité', () => {
    const described = describeAcknowledgement(ack);
    expect(described.map((d) => d.severity)).toEqual(['Warning', 'Informational']);
  });
});

describe('faute de service SOAP', () => {
  it('est un chemin d’échec DISTINCT de l’acquittement', () => {
    // Une faute ne dit rien sur l'offre : l'appel n'a pas atteint la couche
    // métier. La confondre avec un acquittement ferait chercher un champ
    // fautif qui n'existe pas.
    expect(() => parseAcknowledgement(fixture('soap-fault.xml'))).toThrow(AdepParseError);
    try {
      parseAcknowledgement(fixture('soap-fault.xml'));
    } catch (err) {
      expect(err).toBeInstanceOf(AdepParseError);
      expect((err as AdepParseError).code).toBe('soap_fault');
      expect((err as AdepParseError).faultString).toBe('API_023_VALIDATION_XML_ERROR');
    }
  });
});

describe('réponses illisibles', () => {
  it('ne rend jamais un faux succès sur du non-XML', () => {
    expect(() => parseAcknowledgement('<html>502 Bad Gateway</html>')).toThrow(
      AdepParseError,
    );
    expect(() => parseAcknowledgement('')).toThrow(AdepParseError);
  });

  it('une sévérité illisible est traitée comme FATALE', () => {
    // Le seul repli sûr : supposer « Warning » ferait considérer comme publiée
    // une offre rejetée.
    const forged = fixture('ack-fatal-330.xml').replace(
      '<ns2:ExceptionSeverity>Fatal</ns2:ExceptionSeverity>',
      '<ns2:ExceptionSeverity>Bizarre</ns2:ExceptionSeverity>',
    );
    const ack = parseAcknowledgement(forged);
    expect(ack.ok).toBe(false);
    expect(ack.exceptions[0]?.severity).toBe('Fatal');
  });

  it('lit les sévérités quelle que soit la casse', () => {
    const forged = fixture('ack-warning-only.xml').replace(
      '<ns2:ExceptionSeverity>Warning</ns2:ExceptionSeverity>',
      '<ns2:ExceptionSeverity>WARNING</ns2:ExceptionSeverity>',
    );
    expect(parseAcknowledgement(forged).ok).toBe(true);
  });
});

describe('getPositionStatus (exemple RÉEL de l’Apec)', () => {
  const positions = parsePositionStatus(apecDoc('sep_getPositionStatusResponse.xml'));

  it('lit le statut, le lien public et l’éditabilité', () => {
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({
      apecPositionNumero: '177596708W',
      clientPositionId: '26335625/CDGTB/78L',
      status: 'PUBLIEE',
      isEditable: true,
      positionUrl:
        'https://wwwrec1.apec.fr/candidat/recherche-emploi.html/emploi/detail-offre/177596708W',
    });
  });

  it('garde les identifiants en CHAÎNE — jamais un nombre', () => {
    // `177596708W` finit par une lettre, mais un `clientPositionId` purement
    // numérique perdrait ses zéros de tête si le parseur « devinait » un
    // nombre.
    expect(typeof positions[0]?.apecPositionNumero).toBe('string');
  });

  it('lit plusieurs offres — le schéma déclare onePosition non borné', () => {
    const doubled = apecDoc('sep_getPositionStatusResponse.xml').replace(
      /(<ns2:onePosition>[\s\S]*?<\/ns2:onePosition>)/,
      '$1$1',
    );
    expect(parsePositionStatus(doubled)).toHaveLength(2);
  });
});
