/**
 * Extraction de texte depuis un fichier CV (Session 4).
 *
 * Supports MVP :
 * - .txt / .md → string brute (utf-8).
 * - .pdf → texte extrait via `pdf-parse`. Le décodage est fait sur un
 *   Buffer Node.js ; ce module est strictement server-side.
 *
 * Si le PDF est uniquement composé d'images scannées, l'extraction
 * renvoie une chaîne vide ou quasi vide. L'appelant doit alors
 * renvoyer une erreur métier claire (« CV illisible ») plutôt que
 * d'envoyer un texte vide au LLM.
 */

const MIN_TEXT_LENGTH = 40;

export type ExtractedCV = {
  fileName: string;
  text: string;
  mime: string;
};

export class CVExtractError extends Error {
  constructor(
    public readonly code: 'unsupported_type' | 'empty_text' | 'parse_failed',
    message: string,
  ) {
    super(message);
    this.name = 'CVExtractError';
  }
}

export async function extractCVText(file: File): Promise<ExtractedCV> {
  const fileName = file.name;
  const mime = file.type || guessMimeFromName(fileName);
  const lower = fileName.toLowerCase();

  if (
    mime.startsWith('text/') ||
    lower.endsWith('.txt') ||
    lower.endsWith('.md')
  ) {
    const text = await file.text();
    return ensureNonEmpty({ fileName, text, mime: mime || 'text/plain' });
  }

  if (mime === 'application/pdf' || lower.endsWith('.pdf')) {
    let text: string;
    let parser: { destroy: () => Promise<void> } | null = null;
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const { PDFParse } = await import('pdf-parse');
      await ensurePdfWorkerConfigured(PDFParse);
      const instance = new PDFParse({ data });
      parser = instance;
      const result = await instance.getText();
      text = result.text ?? '';
    } catch (err) {
      throw new CVExtractError(
        'parse_failed',
        err instanceof Error ? err.message : 'Échec parsing PDF.',
      );
    } finally {
      if (parser) {
        try {
          await parser.destroy();
        } catch {
          // best-effort
        }
      }
    }
    return ensureNonEmpty({
      fileName,
      text,
      mime: 'application/pdf',
    });
  }

  throw new CVExtractError(
    'unsupported_type',
    `Type non supporté : ${mime || fileName}. Utilise .pdf, .txt ou .md.`,
  );
}

function ensureNonEmpty(extracted: ExtractedCV): ExtractedCV {
  const trimmed = extracted.text.trim();
  if (trimmed.length < MIN_TEXT_LENGTH) {
    throw new CVExtractError(
      'empty_text',
      'Le CV ne contient pas assez de texte exploitable (PDF scanné ?).',
    );
  }
  return { ...extracted, text: trimmed };
}

function guessMimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return '';
}

/**
 * Configure le worker pdfjs-dist avec un chemin absolu sur disque.
 *
 * Pourquoi : Turbopack ne sait pas résoudre le `pdf.worker.mjs` quand
 * pdf-parse v2 le demande à la volée (« Cannot find module
 * .next/dev/server/chunks/pdf.worker.mjs »). On force GlobalWorkerOptions
 * vers le fichier physique présent dans `node_modules/pdfjs-dist/legacy/build`.
 *
 * Idempotent : un seul setWorker par process Node, même si plusieurs
 * CV sont analysés en série.
 */
let pdfWorkerConfigured = false;
async function ensurePdfWorkerConfigured(
  PDFParse: { setWorker: (src: string) => string },
): Promise<void> {
  if (pdfWorkerConfigured) return;
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const requireFromHere = createRequire(import.meta.url);
  const workerPath = requireFromHere.resolve(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
  );
  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}
