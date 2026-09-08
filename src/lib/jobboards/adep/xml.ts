/**
 * Primitives XML du connecteur ADEP. PURES.
 *
 * On construit le flux à la main plutôt que par un client SOAP généré : le
 * message est plat (une enveloppe, un corps, pas de WS-Security, pas de MTOM),
 * les générateurs TypeScript rendent des types approximatifs sur du HR-XML à
 * deux espaces de noms, et surtout `adep:probe` doit pouvoir MONTRER le XML
 * qui partirait — ce qu'un client opaque rend pénible.
 *
 * La contrepartie est que l'échappement est notre affaire, et il n'est pas
 * facultatif : les descriptions viennent d'un modèle de langage et d'un humain
 * qui colle du texte. Une esperluette non échappée produit
 * `API_002_UNABLE_TO_UNMARSHALL_ERROR`, une erreur qui ne dit pas où.
 */

/** Échappe le texte d'un nœud. */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Échappe une valeur d'attribut (guillemets compris). */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Caractères que XML 1.0 n'admet à AUCUN endroit — pas même dans un CDATA.
 * Construit par `RegExp` plutôt qu'en littéral : des octets de contrôle
 * invisibles dans le source sont exactement le genre de chose qu'on casse au
 * premier copier-coller.
 */
const INVALID_XML_CHARS = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\uFFFE\\uFFFF]',
  'g',
);

/**
 * Retire ces caractères. Un `` collé depuis un PDF suffirait à faire
 * rejeter le flux entier, et l'échappement n'y peut rien : ces octets sont
 * interdits, pas réservés.
 */
export function stripInvalidXmlChars(value: string): string {
  return value.replace(INVALID_XML_CHARS, '');
}

/**
 * Emballe un bloc de texte en CDATA, comme le fait l'exemple officiel pour les
 * descriptions (qui portent des balises HTML de mise en forme).
 *
 * `]]>` est la seule séquence qui puisse casser un CDATA : on la coupe en deux
 * sections plutôt que de l'échapper, parce qu'à l'intérieur d'un CDATA
 * l'échappement n'a pas cours.
 */
export function cdata(value: string): string {
  const safe = stripInvalidXmlChars(value);
  return `<![CDATA[${safe.split(']]>').join(']]]]><![CDATA[>')}]]>`;
}

export type XmlAttributes = Record<string, string | null | undefined>;

function renderAttributes(attrs: XmlAttributes | undefined): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .filter((entry): entry is [string, string] => entry[1] != null)
    .map(([k, v]) => ` ${k}="${escapeXmlAttribute(v)}"`)
    .join('');
}

/** Élément à contenu textuel simple (échappé). */
export function el(name: string, content: string, attrs?: XmlAttributes): string {
  const text = escapeXmlText(stripInvalidXmlChars(content));
  return `<${name}${renderAttributes(attrs)}>${text}</${name}>`;
}

/** Élément dont le contenu est déjà du XML (enfants, CDATA). */
export function raw(name: string, inner: string, attrs?: XmlAttributes): string {
  return `<${name}${renderAttributes(attrs)}>${inner}</${name}>`;
}

/** Élément vide — `PositionDateInfo`, `Organization` en mode direct. */
export function empty(name: string, attrs?: XmlAttributes): string {
  return `<${name}${renderAttributes(attrs)}/>`;
}

/** Assemble en écartant les `null` — l'ordre de la séquence XSD est préservé. */
export function join(parts: Array<string | null | undefined>): string {
  return parts.filter((p): p is string => Boolean(p)).join('');
}

/**
 * Indente un XML d'une seule ligne, pour l'AFFICHAGE seulement (`adep:probe`).
 * N'est JAMAIS appliqué au flux envoyé : ajouter des blancs dans un élément à
 * contenu simple changerait sa valeur.
 *
 * ⚠️ Les sections CDATA sont MISES DE CÔTÉ avant le découpage. Sans cela, la
 * coupure sur `><` tranche aussi `<Value><![CDATA[` et `]]></Value>`, et tout
 * le document part en escalier vers la droite à partir de la première
 * description. Un opérateur qui lit un XML en escalier doute du reste de
 * l'outil — et l'outil sert précisément à inspirer confiance avant un envoi
 * réel.
 */
export function prettyPrintXml(xml: string): string {
  const sections: string[] = [];
  const guarded = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, (match) => {
    sections.push(match);
    return `\u0000CDATA${sections.length - 1}\u0000`;
  });

  const lines = guarded.replace(/></g, '>\n<').split('\n');
  let depth = 0;
  const rendered = lines
    .map((line) => {
      if (/^<\/[^>]+>/.test(line)) depth = Math.max(0, depth - 1);
      const indented = '  '.repeat(depth) + line;
      const opensBlock =
        /^<[^/?!]/.test(line) &&
        !/\/>$/.test(line) &&
        !/^<[^/][^>]*>[\s\S]*<\/[^>]+>$/.test(line);
      if (opensBlock) depth += 1;
      return indented;
    })
    .join('\n');

  return rendered.replace(
    /\u0000CDATA(\d+)\u0000/g,
    (_m, index: string) => sections[Number(index)]!,
  );
}
