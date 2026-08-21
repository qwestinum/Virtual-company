/**
 * Rendu du corps d'annonce sur les pages publiques. Pur, testé.
 *
 * Le Job Writer produit un Markdown volontairement pauvre : des titres `##`,
 * des listes `-`, des paragraphes, et de l'emphase `**`. On découpe donc en
 * blocs plutôt que d'embarquer un moteur Markdown complet — une dépendance de
 * plus pour trois formes serait un mauvais échange, et un moteur générique
 * ouvrirait la porte à du HTML arbitraire sur une page publique.
 *
 * Le texte reste du TEXTE : aucun fragment n'est interprété comme du balisage,
 * il est rendu par React qui l'échappe. L'emphase est reconnue comme une
 * DÉCOUPE de segments, jamais comme une insertion de HTML.
 */

export type AdSegment = { text: string; strong: boolean };

export type AdBlock =
  | { kind: 'heading'; level: 2 | 3; segments: AdSegment[] }
  | { kind: 'paragraph'; segments: AdSegment[] }
  | { kind: 'list'; items: AdSegment[][] };

/** Découpe une ligne sur les `**…**`. Une paire non fermée reste du texte. */
export function parseSegments(line: string): AdSegment[] {
  const segments: AdSegment[] = [];
  const parts = line.split(/\*\*/);
  // Nombre PAIR de délimiteurs ⇒ alternance propre. Sinon (paire orpheline),
  // on rend la ligne telle quelle : mieux vaut un astérisque visible qu'un
  // gras qui déborde sur toute la fin de l'annonce.
  if (parts.length % 2 === 0) {
    return [{ text: line, strong: false }];
  }
  parts.forEach((text, index) => {
    if (text.length === 0) return;
    segments.push({ text, strong: index % 2 === 1 });
  });
  return segments.length > 0 ? segments : [{ text: line, strong: false }];
}

export function renderAdBlocks(body: string): AdBlock[] {
  const blocks: AdBlock[] = [];
  let listBuffer: AdSegment[][] = [];
  let paragraphBuffer: string[] = [];

  const flushList = (): void => {
    if (listBuffer.length > 0) {
      blocks.push({ kind: 'list', items: listBuffer });
      listBuffer = [];
    }
  };
  const flushParagraph = (): void => {
    if (paragraphBuffer.length > 0) {
      blocks.push({
        kind: 'paragraph',
        segments: parseSegments(paragraphBuffer.join(' ')),
      });
      paragraphBuffer = [];
    }
  };

  for (const raw of body.split('\n')) {
    const line = raw.trim();

    if (line.length === 0) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: 'heading',
        level: heading[1].length === 2 ? 2 : 3,
        segments: parseSegments(heading[2].trim()),
      });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      listBuffer.push(parseSegments(bullet[1].trim()));
      continue;
    }

    // Une ligne ordinaire interrompt une liste en cours — sans quoi la phrase
    // de clôture de l'annonce viendrait se coller en dernière puce.
    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}
