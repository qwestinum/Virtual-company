/**
 * Le constructeur XML, et surtout l'ORDRE.
 *
 * Tous les types HR-XML en jeu sont des `<xs:sequence>` : l'ordre est imposé.
 * Un test qui vérifierait seulement la PRÉSENCE des balises passerait sur un
 * document que l'Apec refuserait avec `API_023_VALIDATION_XML_ERROR`. D'où le
 * helper `orderOf`, qui compare des positions et pas des existences.
 */
import { describe, expect, it } from 'vitest';

import {
  buildGetPositionStatusEnvelope,
  buildOpenPositionBody,
  buildOpenPositionEnvelope,
  buildUpdatePositionStatusEnvelope,
  redactCredentials,
  withGenderMention,
} from '../build-open-position';
import { NS_ADEP_SEP, NS_HR_XML } from '../namespaces';
import {
  SAMPLE_CREDENTIALS,
  SAMPLE_OFFER,
  SAMPLE_OFFER_BROKER,
} from './fixtures/sample-offer';

/** Positions d'apparition — `-1` si absent, pour que l'échec soit lisible. */
function orderOf(xml: string, ...needles: string[]): number[] {
  return needles.map((n) => xml.indexOf(n));
}

function isStrictlyIncreasing(values: number[]): boolean {
  return values.every((v, i) => v >= 0 && (i === 0 || v > values[i - 1]!));
}

describe('mention H/F', () => {
  it('est ajoutée quand elle manque', () => {
    expect(withGenderMention('Consultant AMOA')).toBe('Consultant AMOA H/F');
  });

  it('n’est pas doublée quand elle est déjà là, sous ses formes courantes', () => {
    expect(withGenderMention('Testeur F/H')).toBe('Testeur F/H');
    expect(withGenderMention('Développeur H/F')).toBe('Développeur H/F');
    expect(withGenderMention('Chef de projet (h/f)')).toBe('Chef de projet (h/f)');
    expect(withGenderMention('Analyste H-F')).toBe('Analyste H-F');
  });

  it('normalise les espaces — le compteur de l’écran doit dire vrai', () => {
    expect(withGenderMention('  Consultant   AMOA  ')).toBe('Consultant AMOA H/F');
  });
});

describe('openPositionRequest — structure', () => {
  const body = buildOpenPositionBody(SAMPLE_OFFER, SAMPLE_CREDENTIALS);

  it('déclare les deux espaces de noms, celui du WSDL en http', () => {
    expect(body).toContain(`xmlns:sep="${NS_ADEP_SEP}"`);
    expect(body).toContain(`xmlns:hr="${NS_HR_XML}"`);
    expect(body).not.toContain('https://adep.apec.fr');
  });

  it('respecte la séquence OpenPositionRequestType', () => {
    expect(
      isStrictlyIncreasing(
        orderOf(body, '<sep:authentication>', '<sep:UniquePayloadTrackingId', '<sep:position>'),
      ),
    ).toBe(true);
  });

  it('respecte la séquence AuthenticationType', () => {
    expect(
      isStrictlyIncreasing(
        orderOf(body, '<sep:atsId>', '<sep:numeroDossier>', '<sep:atsPassword>'),
      ),
    ).toBe(true);
  });

  it('respecte la séquence PositionProfileType', () => {
    expect(
      isStrictlyIncreasing(
        orderOf(
          body,
          '<hr:ProfileId',
          '<hr:ProfileName>',
          '<hr:PositionDateInfo/>',
          '<hr:Organization',
          '<hr:PositionDetail>',
          '<hr:FormattedPositionDescription>',
          '<hr:HowToApply>',
        ),
      ),
    ).toBe(true);
  });

  it('émet PositionDateInfo VIDE — seul enfant non optionnel du profil', () => {
    // La spec le déclare « ignoré par ADEP », mais le schéma l'exige : l'omettre
    // invaliderait le document. Ses propres enfants sont tous optionnels.
    expect(body).toContain('<hr:PositionDateInfo/>');
  });

  it('respecte la séquence PositionMatchingType, Education AVANT la rémunération', () => {
    const withEducation = buildOpenPositionBody(
      { ...SAMPLE_OFFER, jobType: '9', durationMonths: 6, educationLevel: '3' },
      SAMPLE_CREDENTIALS,
    );
    expect(
      isStrictlyIncreasing(
        orderOf(
          withEducation,
          '<hr:IndustryCode',
          '<hr:PhysicalLocation>',
          '<hr:PositionTitle>',
          '<hr:Competency name="GLOBAL_EXPERIENCE_LEVEL">',
          '<hr:Education>',
          '<hr:RemunerationPackage>',
          '<hr:UserArea>',
        ),
      ),
    ).toBe(true);
  });

  it('met les enfants de UserArea dans l’espace de noms ADEP, pas HR-XML', () => {
    // `UserArea` est typé <xs:any namespace="##other"> : ses enfants DOIVENT
    // être ailleurs que dans HR-XML. Les y mettre invaliderait le document.
    expect(body).toContain('<hr:UserArea><sep:PartTime>');
    expect(body).toContain('<sep:StatusJob>CADRE_PRIVE</sep:StatusJob>');
    expect(body).not.toContain('<hr:StatusJob>');
  });

  it('émet les deux lieux, avec les bons types de zone', () => {
    expect(body).toContain('<hr:Name>LOCATION_ZONE_DEPLACEMENT</hr:Name>');
    expect(body).toContain('<hr:Area type="APEC"><hr:Value>REGIONAL</hr:Value></hr:Area>');
    expect(body).toContain('<hr:Name>LOCATION_CODE</hr:Name>');
    expect(body).toContain('<hr:Area type="INSEE"><hr:Value>37261</hr:Value></hr:Area>');
  });

  it('ajoute la mention H/F à l’intitulé envoyé', () => {
    expect(body).toContain('<hr:PositionTitle>Consultant AMOA Trade Finance H/F</hr:PositionTitle>');
  });

  it('émet les six descriptions obligatoires, chacune une seule fois', () => {
    for (const name of [
      'POSITION_TYPE',
      'POSITION_DESCRIPTION',
      'PROFILE_DESCRIPTION',
      'ORGANIZATION_DESCRIPTION',
      'ORGANIZATION_NAME',
      'POSITION_DISPLAY_LOGO',
    ]) {
      const occurrences = body.split(`<hr:Name>${name}</hr:Name>`).length - 1;
      // Un doublon rend API_1408 à API_1412 selon le nom.
      expect(occurrences, `${name} apparaît ${occurrences} fois`).toBe(1);
    }
  });

  it('omet les descriptions facultatives quand elles sont vides', () => {
    expect(body).not.toContain('PRESENTATION_DESCRIPTION');
    expect(body).not.toContain('RECRUITMENT_DESCRIPTION');
  });

  it('emballe les textes libres en CDATA', () => {
    expect(body).toContain('<hr:Value><![CDATA[Notre client, cabinet de conseil');
  });

  it('n’émet pas Duration pour un CDI', () => {
    // API_397 : un CDI ne peut pas porter de durée. Le constructeur ne doit
    // pas pouvoir produire un flux qu'on sait refusé.
    expect(body).not.toContain('<sep:Duration>');
  });

  it('émet Duration pour un CDD', () => {
    const cdd = buildOpenPositionBody(
      { ...SAMPLE_OFFER, jobType: '5', durationMonths: 12 },
      SAMPLE_CREDENTIALS,
    );
    expect(cdd).toContain('<sep:Duration>12</sep:Duration>');
  });

  it('porte l’adresse de candidature', () => {
    expect(body).toContain(
      '<hr:InternetEmailAddress>recrutement@qwestinum.fr</hr:InternetEmailAddress>',
    );
  });
});

describe('mode client', () => {
  it('direct : PositionSupplier self, Organization vide', () => {
    const body = buildOpenPositionBody(SAMPLE_OFFER, SAMPLE_CREDENTIALS);
    expect(body).toContain('<hr:PositionSupplier relationship="self"/>');
    expect(body).toContain('<hr:Organization/>');
  });

  it('direct avec courriel : Organization porte le seul champ admis', () => {
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, contactEmail: 'sami@qwestinum.fr' },
      SAMPLE_CREDENTIALS,
    );
    expect(body).toContain(
      '<hr:Organization><hr:ContactInfo><hr:ContactMethod><hr:InternetEmailAddress>sami@qwestinum.fr</hr:InternetEmailAddress></hr:ContactMethod></hr:ContactInfo></hr:Organization>',
    );
  });

  it('indirect : broker, et le bloc client réel complet dans l’ordre du schéma', () => {
    const body = buildOpenPositionBody(SAMPLE_OFFER_BROKER, SAMPLE_CREDENTIALS);
    expect(body).toContain('<hr:PositionSupplier relationship="broker"/>');
    expect(
      isStrictlyIncreasing(
        orderOf(
          body,
          '<hr:OrganizationName>BANQUE DE LOIRE</hr:OrganizationName>',
          '<hr:LegalId idOwner="INSEE">',
          '<hr:IndustryCode classificationName="INSEE">6419Z</hr:IndustryCode>',
        ),
      ),
    ).toBe(true);
  });

  it('indirect : le SIRET voyage en LegalId idOwner="INSEE"', () => {
    const body = buildOpenPositionBody(SAMPLE_OFFER_BROKER, SAMPLE_CREDENTIALS);
    expect(body).toContain(
      '<hr:LegalId idOwner="INSEE"><hr:IdValue>55208131766522</hr:IdValue></hr:LegalId>',
    );
  });

  it('indirect : la raison sociale ne remplace pas l’enseigne affichée', () => {
    // Deux champs, deux rôles, deux limites (38 vs 255). Les confondre rend
    // API_1372 ou API_1373, qui renvoient au support et pas à un champ.
    const body = buildOpenPositionBody(SAMPLE_OFFER_BROKER, SAMPLE_CREDENTIALS);
    expect(body).toContain('<hr:OrganizationName>BANQUE DE LOIRE</hr:OrganizationName>');
    expect(body).toContain('<hr:Name>ORGANIZATION_NAME</hr:Name>');
    expect(body).toContain('<![CDATA[QWESTINUM]]>');
  });
});

describe('offre confidentielle', () => {
  it('n’émet jamais d’URL de candidature en ODC', () => {
    // API_1336. Le constructeur refuse par construction plutôt que de compter
    // sur le validateur en amont.
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, positionType: 'ODC', applicationUrl: 'https://exemple.fr/offre' },
      SAMPLE_CREDENTIALS,
    );
    expect(body).not.toContain('InternetWebAddress');
  });

  it('émet l’URL en ODD', () => {
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, applicationUrl: 'https://exemple.fr/offre' },
      SAMPLE_CREDENTIALS,
    );
    expect(body).toContain('<hr:InternetWebAddress>https://exemple.fr/offre</hr:InternetWebAddress>');
  });
});

describe('échappement', () => {
  it('échappe les caractères réservés d’un attribut et d’un texte', () => {
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, positionTitle: 'Chargé R&D <senior>' },
      SAMPLE_CREDENTIALS,
    );
    expect(body).toContain('Chargé R&amp;D &lt;senior&gt; H/F');
  });

  it('découpe une séquence ]]> plutôt que de casser le CDATA', () => {
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, positionDescription: `a]]>b${'x'.repeat(300)}` },
      SAMPLE_CREDENTIALS,
    );
    expect(body).toContain(']]]]><![CDATA[>');
    // Autant d'ouvertures que de fermetures : le document reste équilibré.
    expect(body.split('<![CDATA[').length).toBe(body.split(']]>').length);
  });
});

describe('enveloppe et autres opérations', () => {
  it('openPosition : enveloppe SOAP complète', () => {
    const env = buildOpenPositionEnvelope(SAMPLE_OFFER, SAMPLE_CREDENTIALS);
    expect(env.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(env).toContain('<soapenv:Envelope');
    expect(env).toContain('<soapenv:Body>');
    expect(env).toContain('<sep:openPositionRequest');
  });

  it('getPositionStatus : accepte la référence client seule', () => {
    const env = buildGetPositionStatusEnvelope({
      creds: SAMPLE_CREDENTIALS,
      trackingId: 'orqa-1',
      clientPositionId: 'CAMP-2026-288',
    });
    expect(env).toContain('<sep:clientPositionId idOwner="CLIENT">');
    expect(env).not.toContain('<sep:apecPositionNumero');
  });

  it('updatePositionStatus : le nom exact du champ vient du WSDL', () => {
    // La spec imprime « newPosition-Status » coupé sur deux lignes ; le WSDL
    // dit `newPositionStatus`.
    const env = buildUpdatePositionStatusEnvelope({
      creds: SAMPLE_CREDENTIALS,
      trackingId: 'orqa-2',
      apecPositionNumero: '177596708W',
      newStatus: 'SUSPENDUE',
    });
    expect(env).toContain('<sep:newPositionStatus>SUSPENDUE</sep:newPositionStatus>');
    expect(env).toContain('<sep:apecPositionNumero idOwner="APEC">');
  });

  it('updatePositionStatus : respecte la séquence, le statut EN DERNIER', () => {
    const env = buildUpdatePositionStatusEnvelope({
      creds: SAMPLE_CREDENTIALS,
      trackingId: 'orqa-3',
      clientPositionId: 'CAMP-2026-288',
      apecPositionNumero: '177596708W',
      newStatus: 'PUBLIEE',
    });
    expect(
      isStrictlyIncreasing(
        orderOf(
          env,
          '<sep:authentication>',
          '<sep:UniquePayloadTrackingId',
          '<sep:clientPositionId',
          '<sep:apecPositionNumero',
          '<sep:newPositionStatus>',
        ),
      ),
    ).toBe(true);
  });
});

describe('caviardage', () => {
  const env = buildOpenPositionEnvelope(SAMPLE_OFFER, SAMPLE_CREDENTIALS);

  it('retire le mot de passe ET le numéro de dossier', () => {
    const redacted = redactCredentials(env);
    expect(redacted).not.toContain(SAMPLE_CREDENTIALS.atsPassword);
    // Le numéro de dossier est l'identifiant Apec d'une PERSONNE : un journal
    // qui le porte est un journal qu'on ne peut plus montrer.
    expect(redacted).not.toContain(SAMPLE_CREDENTIALS.numeroDossier);
    expect(redacted).toContain('<sep:atsPassword>[secret]</sep:atsPassword>');
    expect(redacted).toContain('<sep:numeroDossier>[secret]</sep:numeroDossier>');
  });

  it('laisse intact tout le reste — le flux caviardé reste diagnosticable', () => {
    const redacted = redactCredentials(env);
    expect(redacted).toContain('CAMP-2026-288');
    expect(redacted).toContain('Consultant AMOA Trade Finance H/F');
    expect(redacted).toContain('<sep:atsId>50</sep:atsId>');
  });

  it('fonctionne quel que soit le préfixe — la réponse Apec n’a pas le nôtre', () => {
    const foreign =
      '<ns2:atsPassword>abc</ns2:atsPassword><atsPassword>def</atsPassword>';
    const redacted = redactCredentials(foreign);
    expect(redacted).not.toContain('abc');
    expect(redacted).not.toContain('def');
  });
});
