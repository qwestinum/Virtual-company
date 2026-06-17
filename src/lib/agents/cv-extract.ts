/**
 * Extraction de texte depuis un fichier CV (Session 4).
 *
 * Supports MVP :
 * - .txt / .md → string brute (utf-8).
 * - .pdf → texte extrait via `pdf-parse`. Le décodage est fait sur un
 *   Buffer Node.js ; ce module est strictement server-side.
 * - .docx → texte brut via `mammoth` (OOXML uniquement ; le format legacy
 *   `.doc` n'est PAS supporté). Réutilisé par l'analyse CV ET le cadrage
 *   de campagne à partir d'un document (extracteur de pré-remplissage).
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
    public readonly code:
      | 'unsupported_type'
      | 'empty_text'
      | 'parse_failed'
      | 'pdf_engine_unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'CVExtractError';
  }
}

/**
 * Message métier affiché au DRH quand le moteur PDF est hors service.
 * On NE laisse PAS fuiter le détail technique (« DOMMatrix is not
 * defined ») dans le chat Manager — voir CLAUDE.md : le Manager parle
 * métier, jamais technique.
 */
const PDF_ENGINE_UNAVAILABLE_MESSAGE =
  "La lecture des PDF est momentanément indisponible côté serveur. Le CV n'a pas pu être lu — réessayez plus tard ou envoyez-le en .txt.";

/**
 * Le moteur pdfjs (via pdf-parse) a besoin de globals navigateur
 * (`DOMMatrix`, `ImageData`, `Path2D`) pour décoder polices et images.
 * En Node, pdfjs tente de les polyfiller lui-même depuis `@napi-rs/canvas`
 * via `require("@napi-rs/canvas")` (createRequire(import.meta.url)).
 *
 * PROBLÈME : ce mécanisme casse en build de production. Next encapsule
 * `pdf-parse` en « external module » (`pdf-parse-<hash>`) et le require
 * interne de pdfjs ne se résout plus → pas de polyfill → `ReferenceError:
 * DOMMatrix is not defined` au cœur du parsing (visible en preview/prod
 * alors que le dev passe). On NE compte donc PAS sur l'auto-polyfill de
 * pdfjs : on installe nous-mêmes les globals depuis un import direct de
 * `@napi-rs/canvas` (que l'on contrôle) AVANT de charger pdf-parse.
 */
const PDF_REQUIRED_GLOBALS = ['DOMMatrix', 'ImageData', 'Path2D'] as const;

function isPdfEnginePolyfilled(): boolean {
  const g = globalThis as Record<string, unknown>;
  return PDF_REQUIRED_GLOBALS.every((name) => typeof g[name] === 'function');
}

/**
 * Installe DOMMatrix/ImageData/Path2D sur globalThis depuis
 * `@napi-rs/canvas`, idempotent et tolérant : si le binaire natif n'est
 * pas disponible pour la plateforme, on n'échoue pas ici — la
 * précondition `isPdfEnginePolyfilled` lèvera ensuite un message métier.
 */
async function ensurePdfDomPolyfills(): Promise<void> {
  // Déjà présents (navigateur, ou polyfillés lors d'un précédent appel —
  // `import()` est mis en cache par le module system) : rien à faire.
  if (isPdfEnginePolyfilled()) return;
  const g = globalThis as Record<string, unknown>;
  try {
    const canvas = (await import('@napi-rs/canvas')) as Record<string, unknown>;
    for (const name of PDF_REQUIRED_GLOBALS) {
      if (typeof g[name] !== 'function' && typeof canvas[name] === 'function') {
        g[name] = canvas[name];
      }
    }
  } catch {
    // @napi-rs/canvas indisponible (binaire natif manquant) — on laisse
    // la précondition produire l'erreur métier.
  }
}

function isMissingPdfGlobalError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return PDF_REQUIRED_GLOBALS.some((name) =>
    new RegExp(`\\b${name}\\b`).test(err.message),
  );
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
      // Polyfille DOMMatrix & co. AVANT de charger pdf-parse, sans
      // dépendre de l'auto-polyfill (cassé en build de prod).
      await ensurePdfDomPolyfills();
      const { PDFParse } = await import('pdf-parse');
      await ensurePdfWorkerConfigured(PDFParse);
      // Précondition : si le polyfill a échoué (binaire canvas manquant),
      // on échoue proprement AVANT le parsing plutôt que sur un
      // ReferenceError opaque qui fuiterait dans le chat.
      if (!isPdfEnginePolyfilled()) {
        throw new CVExtractError(
          'pdf_engine_unavailable',
          PDF_ENGINE_UNAVAILABLE_MESSAGE,
        );
      }
      const instance = new PDFParse({ data });
      parser = instance;
      const result = await instance.getText();
      text = result.text ?? '';
    } catch (err) {
      if (err instanceof CVExtractError) throw err;
      // Filet de sécurité : si malgré la précondition un global manque
      // au cœur du parsing, on traduit le ReferenceError technique en
      // erreur métier au lieu de le laisser fuiter dans le chat.
      if (isMissingPdfGlobalError(err)) {
        throw new CVExtractError(
          'pdf_engine_unavailable',
          PDF_ENGINE_UNAVAILABLE_MESSAGE,
        );
      }
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

  if (
    mime ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lower.endsWith('.docx')
  ) {
    let text: string;
    try {
      const buffer = Buffer.from(await file.arrayBuffer());
      const mod = (await import('mammoth')) as unknown as {
        extractRawText?: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
        default?: {
          extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }>;
        };
      };
      // Interop CJS/ESM : selon le bundler, `extractRawText` est exposé
      // directement ou sous `.default`.
      const extractRawText = mod.extractRawText ?? mod.default?.extractRawText;
      if (!extractRawText) {
        throw new Error('mammoth.extractRawText indisponible.');
      }
      const result = await extractRawText({ buffer });
      text = result.value ?? '';
    } catch (err) {
      throw new CVExtractError(
        'parse_failed',
        err instanceof Error ? err.message : 'Échec parsing DOCX.',
      );
    }
    return ensureNonEmpty({
      fileName,
      text,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
  }

  throw new CVExtractError(
    'unsupported_type',
    `Type non supporté : ${mime || fileName}. Utilise .pdf, .docx, .txt ou .md.`,
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
  if (lower.endsWith('.docx'))
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.md')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  return '';
}

/**
 * Configure le worker pdfjs-dist avec un chemin absolu sur disque.
 *
 * Pourquoi : Turbopack ne sait pas résoudre le `pdf.worker.mjs` quand
 * pdf-parse v2 le demande à la volée (« Cannot find module
 * .next/dev/server/chunks/pdf.worker.mjs »). On force
 * GlobalWorkerOptions.workerSrc vers le fichier physique sur disque.
 *
 * On NE PASSE PAS par `require.resolve()` : Next refuse d'externaliser
 * pdfjs-dist (module ESM), donc require() casse. On construit le
 * chemin à partir de `process.cwd()` — c'est suffisant pour dev et
 * prod (le worker est toujours dans node_modules à l'exécution).
 *
 * Idempotent : un seul setWorker par process Node.
 */
let pdfWorkerConfigured = false;
async function ensurePdfWorkerConfigured(
  PDFParse: { setWorker: (src: string) => string },
): Promise<void> {
  if (pdfWorkerConfigured) return;
  const path = await import('node:path');
  const { pathToFileURL } = await import('node:url');
  const workerPath = path.join(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'legacy',
    'build',
    'pdf.worker.mjs',
  );
  PDFParse.setWorker(pathToFileURL(workerPath).href);
  pdfWorkerConfigured = true;
}
