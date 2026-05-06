/**
 * Parseur minimaliste pour les bulles du Manager.
 *
 * Le Manager produit parfois des listes (missions principales,
 * compétences clés, options à comparer). Sans rendu dédié, ces listes
 * arrivent en une phrase virgulée illisible. Ce helper transforme le
 * contenu textuel en blocs successifs (paragraphes + listes) pour que
 * `ChatBubble` puisse rendre de vrais `<ul>` / `<ol>`.
 *
 * Reconnaît :
 *  - bullets `- item` / `* item` / `• item`
 *  - numérotation `1. item` / `2) item`
 *
 * Tout le reste reste en paragraphe (préservation des sauts de ligne
 * via `whitespace-pre-wrap` côté composant).
 */

export type ListItem = { text: string; level: number };

export type RenderBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: ListItem[] };

const BULLET_RE = /^(\s*)[-•*]\s+(.+)$/;
const ORDERED_RE = /^(\s*)\d+[.)]\s+(.+)$/;

/**
 * Convertit l'indentation de tête en niveau d'arborescence. Chaque
 * groupe de 2 espaces (ou 1 tab) compte pour un niveau supplémentaire.
 * Le niveau est plafonné à 4 pour éviter qu'une indentation excessive
 * du LLM ne pousse le texte hors du conteneur.
 */
function indentLevel(leading: string): number {
  if (leading.length === 0) return 0;
  let cells = 0;
  for (const ch of leading) {
    if (ch === '\t') cells += 2;
    else if (ch === ' ') cells += 1;
  }
  return Math.min(4, Math.floor(cells / 2));
}

export function parseMessageToBlocks(content: string): RenderBlock[] {
  if (!content || content.trim().length === 0) return [];

  const lines = content.split('\n');
  const blocks: RenderBlock[] = [];

  let paragraphBuffer: string[] = [];
  let listBuffer: ListItem[] = [];
  let listOrdered: boolean | null = null;

  function flushParagraph(): void {
    if (paragraphBuffer.length === 0) return;
    const text = paragraphBuffer.join('\n').trim();
    if (text.length > 0) blocks.push({ kind: 'paragraph', text });
    paragraphBuffer = [];
  }

  function flushList(): void {
    if (listBuffer.length === 0) return;
    blocks.push({
      kind: 'list',
      ordered: listOrdered === true,
      items: listBuffer,
    });
    listBuffer = [];
    listOrdered = null;
  }

  for (const line of lines) {
    const bullet = line.match(BULLET_RE);
    const ordered = line.match(ORDERED_RE);
    if (bullet) {
      flushParagraph();
      if (listOrdered === true) flushList();
      listOrdered = false;
      listBuffer.push({
        text: bullet[2].trim(),
        level: indentLevel(bullet[1]),
      });
    } else if (ordered) {
      flushParagraph();
      if (listOrdered === false) flushList();
      listOrdered = true;
      listBuffer.push({
        text: ordered[2].trim(),
        level: indentLevel(ordered[1]),
      });
    } else {
      flushList();
      paragraphBuffer.push(line);
    }
  }

  flushList();
  flushParagraph();

  return blocks;
}
