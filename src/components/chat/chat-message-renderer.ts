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

export type RenderBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const BULLET_RE = /^\s*[-•*]\s+(.+)$/;
const ORDERED_RE = /^\s*\d+[.)]\s+(.+)$/;

export function parseMessageToBlocks(content: string): RenderBlock[] {
  if (!content || content.trim().length === 0) return [];

  const lines = content.split('\n');
  const blocks: RenderBlock[] = [];

  let paragraphBuffer: string[] = [];
  let listBuffer: string[] = [];
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
      listBuffer.push(bullet[1].trim());
    } else if (ordered) {
      flushParagraph();
      if (listOrdered === false) flushList();
      listOrdered = true;
      listBuffer.push(ordered[1].trim());
    } else {
      flushList();
      paragraphBuffer.push(line);
    }
  }

  flushList();
  flushParagraph();

  return blocks;
}
