/**
 * Validation XSD du flux ADEP — OUTIL DE SONDE, jamais l'application.
 *
 * ── POURQUOI CE FICHIER N'EST PAS DANS `src/` ───────────────────────────────
 *
 * Il lance un binaire externe. Le placer sous `src/lib` en ferait quelque chose
 * qu'une route pourrait importer par mégarde, et l'écosystème TypeScript n'a de
 * toute façon pas de validateur XSD utilisable sans binding natif — mal
 * supporté sur Vercel. La prévention des rejets réels se joue dans
 * `validate.ts` (règles de gestion, que le XSD ne connaît pas) ; le XSD, lui,
 * ne vérifie que la structure et l'ORDRE, ce que le constructeur produit de
 * toute façon. Il reste précieux comme filet lors d'une évolution du flux.
 *
 * ── LES SCHÉMAS SONT INLINE DANS LE WSDL ────────────────────────────────────
 *
 * Il n'y a AUCUN fichier XSD à télécharger : `<wsdl:types>` porte trois schémas
 * imbriqués (xml:lang, HR-XML, ADEP SEP). On les extrait vers des fichiers
 * temporaires, et on complète l'`<xs:import>` du schéma SEP avec un
 * `schemaLocation` — sans quoi xmllint ne saurait pas où trouver HR-XML et
 * rendrait un « élément inconnu » parfaitement trompeur.
 *
 * ── ABSENCE DE xmllint : ON LE DIT ──────────────────────────────────────────
 *
 * `check()` distingue trois issues : `valid`, `invalid` (avec les messages) et
 * `unavailable`. Traiter l'absence de l'outil comme un succès ferait croire à
 * une vérification qui n'a pas eu lieu — c'est le défaut que ce projet appelle
 * « ne jamais laisser un contrôle dire `clean` quand il n'a pas tourné ».
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NS_HR_XML = 'http://ns.hr-xml.org/2006-02-28';
const NS_ADEP_SEP = 'http://adep.apec.fr/hrxml/sep';
const NS_XML = 'http://www.w3.org/XML/1998/namespace';

export type XsdCheckResult =
  | { status: 'valid' }
  | { status: 'invalid'; messages: string[] }
  | { status: 'unavailable'; reason: string };

type ExtractedSchemas = { sepPath: string; dir: string };

/** Les trois schémas inline du WSDL, indexés par leur targetNamespace. PUR. */
export function extractInlineSchemas(wsdl: string): Map<string, string> {
  const schemas = new Map<string, string>();
  const pattern = /<xs:schema\b[^>]*>[\s\S]*?<\/xs:schema>/g;
  for (const match of wsdl.match(pattern) ?? []) {
    const ns = /targetNamespace="([^"]+)"/.exec(match)?.[1];
    if (ns) schemas.set(ns, match);
  }
  return schemas;
}

/**
 * Écrit les schémas sur disque et relie l'import. Rend le chemin du schéma SEP,
 * qui est le point d'entrée de la validation.
 */
function materializeSchemas(wsdl: string): ExtractedSchemas {
  const schemas = extractInlineSchemas(wsdl);
  const sep = schemas.get(NS_ADEP_SEP);
  const hr = schemas.get(NS_HR_XML);
  const xml = schemas.get(NS_XML);
  if (!sep || !hr) {
    throw new Error(
      "Le WSDL ne contient pas les schémas attendus (ADEP SEP et HR-XML). " +
        'Le fichier a-t-il bien été récupéré depuis `?wsdl` ?',
    );
  }

  const dir = mkdtempSync(join(tmpdir(), 'adep-xsd-'));
  const hrPath = join(dir, 'hr-xml.xsd');
  const xmlPath = join(dir, 'xml.xsd');
  const sepPath = join(dir, 'adep-sep.xsd');

  // Les schémas inline n'ont pas de déclaration `xs:` autonome : ils l'ont, en
  // fait, chacun redéclarant `xmlns:xs`. On les écrit tels quels.
  writeFileSync(xmlPath, xml ?? emptyXmlLangSchema(), 'utf8');
  writeFileSync(
    hrPath,
    hr.replace(
      /<xs:import namespace="http:\/\/www\.w3\.org\/XML\/1998\/namespace"\s*\/>/,
      `<xs:import namespace="${NS_XML}" schemaLocation="xml.xsd"/>`,
    ),
    'utf8',
  );
  writeFileSync(
    sepPath,
    sep.replace(
      /<xs:import namespace="http:\/\/ns\.hr-xml\.org\/2006-02-28"\s*\/>/,
      `<xs:import namespace="${NS_HR_XML}" schemaLocation="hr-xml.xsd"/>`,
    ),
    'utf8',
  );
  return { sepPath, dir };
}

/** Schéma minimal pour `xml:lang`, si le WSDL ne l'embarque pas. */
function emptyXmlLangSchema(): string {
  return (
    '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" ' +
    `targetNamespace="${NS_XML}"><xs:attribute name="lang" type="xs:language"/>` +
    '</xs:schema>'
  );
}

/**
 * Valide un CORPS de requête (pas l'enveloppe SOAP : le schéma ADEP ne décrit
 * pas l'enveloppe, et lui soumettre l'ensemble rendrait une erreur qui n'a
 * rien à voir).
 */
export function checkAgainstXsd(input: {
  wsdl: string;
  /** Le corps `<sep:openPositionRequest …>`, avec ses déclarations d'espaces. */
  bodyXml: string;
  /** Binaire à utiliser — surchargeable pour les environnements sans PATH. */
  xmllintPath?: string;
}): XsdCheckResult {
  const bin = input.xmllintPath ?? 'xmllint';
  try {
    execFileSync(bin, ['--version'], { stdio: 'ignore' });
  } catch {
    return {
      status: 'unavailable',
      reason:
        `\`${bin}\` est introuvable. La validation XSD n'a PAS eu lieu ` +
        '(sur Debian/Ubuntu : apt install libxml2-utils). Les règles métier, ' +
        'elles, ont bien été vérifiées.',
    };
  }

  let schemas: ExtractedSchemas;
  try {
    schemas = materializeSchemas(input.wsdl);
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : 'Schémas illisibles.',
    };
  }

  const bodyPath = join(schemas.dir, 'body.xml');
  // Une déclaration XML n'est légale qu'en TOUT DÉBUT de document : en ajouter
  // une seconde produit une erreur d'analyse qui ressemble à un défaut de
  // schéma et envoie chercher au mauvais endroit.
  const alreadyDeclared = input.bodyXml.trimStart().startsWith('<?xml');
  writeFileSync(
    bodyPath,
    alreadyDeclared ? input.bodyXml : `<?xml version="1.0" encoding="UTF-8"?>${input.bodyXml}`,
    'utf8',
  );

  try {
    execFileSync(bin, ['--noout', '--schema', schemas.sepPath, bodyPath], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    return { status: 'valid' };
  } catch (err) {
    const stderr =
      err && typeof err === 'object' && 'stderr' in err
        ? String((err as { stderr: Buffer | string }).stderr)
        : String(err);
    const messages = stderr
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.endsWith('fails to validate'))
      .map((l) => l.replace(new RegExp(`^${bodyPath}:`), 'ligne '));
    return { status: 'invalid', messages };
  }
}
