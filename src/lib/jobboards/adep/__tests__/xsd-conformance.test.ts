/**
 * Conformité du flux généré aux schémas RÉELS du WSDL.
 *
 * C'est la preuve hors ligne la plus forte disponible : les XSD sont ceux que
 * l'Apec sert elle-même (inline dans `<wsdl:types>`), et `xmllint` est un
 * validateur indépendant de notre code. Si le document passe ici, il ne sera
 * pas rejeté pour un `API_023_VALIDATION_XML_ERROR`.
 *
 * ⚠️ Ce fichier dépend de `xmllint`, qui n'est pas garanti présent. Il se
 * SAUTE alors, et le dit — il ne prétend jamais avoir validé. Les tests qui
 * portent la prévention des rejets réels (`validate.test.ts`) n'ont, eux,
 * aucune dépendance externe et tournent partout.
 *
 * Installation : `apt install libxml2-utils` (Debian/Ubuntu), `brew install
 * libxml2` (macOS).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildOpenPositionBody } from '../build-open-position';
import { checkAgainstXsd, extractInlineSchemas } from '../../../../../scripts/lib/adep-xsd';
import {
  SAMPLE_CREDENTIALS,
  SAMPLE_OFFER,
  SAMPLE_OFFER_BROKER,
} from './fixtures/sample-offer';

const WSDL = readFileSync(resolve(process.cwd(), 'docs/apec/adepsep-test.wsdl'), 'utf8');

function hasXmllint(): boolean {
  try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const available = hasXmllint();

describe('schémas inline du WSDL', () => {
  it('en contient trois — ADEP SEP, HR-XML, xml:lang', () => {
    // Aucun XSD n'est téléchargeable : tout est dans le WSDL. Ce test n'a
    // besoin d'aucun outil externe, et il documente d'où viennent les schémas.
    const schemas = extractInlineSchemas(WSDL);
    expect([...schemas.keys()].sort()).toEqual([
      'http://adep.apec.fr/hrxml/sep',
      'http://ns.hr-xml.org/2006-02-28',
      'http://www.w3.org/XML/1998/namespace',
    ]);
  });
});

describe.skipIf(!available)('validation XSD du flux généré', () => {
  it('le flux en mode client direct est conforme', () => {
    const body = buildOpenPositionBody(SAMPLE_OFFER, SAMPLE_CREDENTIALS);
    expect(checkAgainstXsd({ wsdl: WSDL, bodyXml: body })).toEqual({ status: 'valid' });
  });

  it('le flux en mode client indirect est conforme', () => {
    const body = buildOpenPositionBody(SAMPLE_OFFER_BROKER, SAMPLE_CREDENTIALS);
    expect(checkAgainstXsd({ wsdl: WSDL, bodyXml: body })).toEqual({ status: 'valid' });
  });

  it('le flux d’une offre de stage est conforme — Education à sa place', () => {
    const body = buildOpenPositionBody(
      { ...SAMPLE_OFFER, jobType: '9', durationMonths: 6, educationLevel: '3', statusJob: 'STAGE' },
      SAMPLE_CREDENTIALS,
    );
    expect(checkAgainstXsd({ wsdl: WSDL, bodyXml: body })).toEqual({ status: 'valid' });
  });

  // ── SONDES : un contrôle qui ne sait pas échouer ne contrôle rien ─────────

  const probes: Array<[string, (xml: string) => string]> = [
    [
      'PositionDateInfo omis',
      (x) => x.replace('<hr:PositionDateInfo/>', ''),
    ],
    [
      'ProfileName avant ProfileId (ordre de séquence inversé)',
      (x) =>
        x.replace(
          /(<hr:ProfileId[^>]*>[\s\S]*?<\/hr:ProfileId>)(<hr:ProfileName>APEC<\/hr:ProfileName>)/,
          '$2$1',
        ),
    ],
    [
      'un enfant de UserArea remis dans HR-XML',
      (x) =>
        x
          .replace('<sep:StatusJob>', '<hr:StatusJob>')
          .replace('</sep:StatusJob>', '</hr:StatusJob>'),
    ],
    [
      'espace de noms en https — la correction de la Phase 1',
      (x) => x.replace(/http:\/\/adep\.apec\.fr/g, 'https://adep.apec.fr'),
    ],
  ];

  it.each(probes)('détecte : %s', (_label, corrupt) => {
    const body = corrupt(buildOpenPositionBody(SAMPLE_OFFER, SAMPLE_CREDENTIALS));
    const result = checkAgainstXsd({ wsdl: WSDL, bodyXml: body });
    expect(result.status).toBe('invalid');
  });
});

describe.skipIf(available)('xmllint absent', () => {
  it('le dit, et ne prétend PAS avoir validé', () => {
    // Traiter l'absence de l'outil comme un succès ferait croire à une
    // vérification qui n'a pas eu lieu.
    const result = checkAgainstXsd({
      wsdl: WSDL,
      bodyXml: buildOpenPositionBody(SAMPLE_OFFER, SAMPLE_CREDENTIALS),
    });
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('libxml2-utils');
    }
  });
});
