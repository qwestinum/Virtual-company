import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';

/**
 * On mocke `pdf-parse` pour piloter le comportement du moteur PDF sans
 * dépendre du fichier binaire ni du polyfill @napi-rs/canvas réel.
 * `getTextImpl` est réassigné par chaque test.
 */
let getTextImpl: () => Promise<{ text: string }>;

vi.mock('pdf-parse', () => {
  class PDFParse {
    static setWorker = vi.fn((src: string) => src);
    constructor(_opts: { data: Uint8Array }) {}
    getText() {
      return getTextImpl();
    }
    destroy() {
      return Promise.resolve();
    }
  }
  return { PDFParse };
});

/**
 * On mocke aussi `@napi-rs/canvas` (binaire natif) pour piloter, sans
 * dépendre de la plateforme, si le polyfill DOMMatrix/ImageData/Path2D
 * réussit (`canvasImpl` peuplé) ou échoue (`canvasImpl` vide).
 */
const noopFn = function stub() {};
let canvasImpl: Record<string, unknown> = {};
vi.mock('@napi-rs/canvas', () => ({
  get DOMMatrix() {
    return canvasImpl.DOMMatrix;
  },
  get ImageData() {
    return canvasImpl.ImageData;
  },
  get Path2D() {
    return canvasImpl.Path2D;
  },
}));

/**
 * On mocke `mammoth` pour piloter l'extraction DOCX sans dépendre d'un
 * binaire OOXML réel. `extractRawTextImpl` est réassigné par chaque test.
 */
let extractRawTextImpl: () => Promise<{ value: string }>;
vi.mock('mammoth', () => ({
  default: {
    extractRawText: (_opts: { buffer: Buffer }) => extractRawTextImpl(),
  },
  extractRawText: (_opts: { buffer: Buffer }) => extractRawTextImpl(),
}));

function makeFile(name: string, content: string, type = ''): File {
  return new File([content], name, { type });
}

const PDF_GLOBALS = ['DOMMatrix', 'ImageData', 'Path2D'] as const;

function setPdfGlobals(present: boolean): () => void {
  const g = globalThis as Record<string, unknown>;
  const saved = PDF_GLOBALS.map((n) => [n, g[n]] as const);
  for (const [name] of saved) {
    if (present) g[name] = function stub() {};
    else delete g[name];
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete g[name];
      } else {
        g[name] = value;
      }
    }
  };
}

describe('extractCVText — formats texte', () => {
  it('extrait le texte brut d’un .txt suffisamment long', async () => {
    const long = 'Imad BELFAQIR — Expert test management '.repeat(3);
    const out = await extractCVText(makeFile('cv.txt', long, 'text/plain'));
    expect(out.mime).toBe('text/plain');
    expect(out.text).toContain('Imad BELFAQIR');
  });

  it('rejette un texte trop court (empty_text)', async () => {
    await expect(
      extractCVText(makeFile('cv.txt', 'court', 'text/plain')),
    ).rejects.toMatchObject({ code: 'empty_text' });
  });

  it('rejette un type non supporté (unsupported_type)', async () => {
    await expect(
      extractCVText(makeFile('cv.rtf', 'x'.repeat(50), 'application/rtf')),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
  });
});

describe('extractCVText — DOCX', () => {
  const DOCX_MIME =
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  beforeEach(() => {
    extractRawTextImpl = () =>
      Promise.resolve({
        value: 'Imad BELFAQIR — Expert test management, 20 ans d’expérience.',
      });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('extrait le texte brut d’un .docx via mammoth', async () => {
    const out = await extractCVText(
      makeFile('CV.docx', 'PK binaire factice', DOCX_MIME),
    );
    expect(out.mime).toBe(DOCX_MIME);
    expect(out.text).toContain('Imad BELFAQIR');
  });

  it('reconnaît le .docx par extension même sans mime', async () => {
    const out = await extractCVText(makeFile('CV.docx', 'PK binaire factice'));
    expect(out.mime).toBe(DOCX_MIME);
    expect(out.text).toContain('Imad BELFAQIR');
  });

  it('mappe une erreur d’extraction DOCX en parse_failed', async () => {
    extractRawTextImpl = () => Promise.reject(new Error('corrupted zip'));
    const err = await extractCVText(
      makeFile('CV.docx', 'PK binaire factice', DOCX_MIME),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CVExtractError);
    expect((err as CVExtractError).code).toBe('parse_failed');
  });
});

describe('extractCVText — PDF', () => {
  let restore: () => void;

  beforeEach(() => {
    getTextImpl = () =>
      Promise.resolve({
        text: 'Imad BELFAQIR — Expert test management, 20 ans d’expérience.',
      });
    // Par défaut, @napi-rs/canvas expose les globals (polyfill OK).
    canvasImpl = { DOMMatrix: noopFn, ImageData: noopFn, Path2D: noopFn };
  });

  afterEach(() => {
    restore?.();
    vi.clearAllMocks();
  });

  it('polyfille DOMMatrix & co. depuis @napi-rs/canvas puis extrait le texte', async () => {
    // Globals absents au départ → c'est le polyfill qui doit les installer.
    restore = setPdfGlobals(false);
    const out = await extractCVText(
      makeFile('CV.pdf', '%PDF-1.4 binaire factice', 'application/pdf'),
    );
    expect(out.mime).toBe('application/pdf');
    expect(out.text).toContain('Imad BELFAQIR');
    // Le polyfill a bien posé les globals.
    expect(typeof (globalThis as Record<string, unknown>).DOMMatrix).toBe(
      'function',
    );
  });

  it('lève pdf_engine_unavailable si @napi-rs/canvas n’expose pas les globals (binaire manquant)', async () => {
    restore = setPdfGlobals(false);
    canvasImpl = {}; // import OK mais pas de DOMMatrix/ImageData/Path2D
    const err = await extractCVText(
      makeFile('CV.pdf', '%PDF-1.4 binaire factice', 'application/pdf'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CVExtractError);
    expect((err as CVExtractError).code).toBe('pdf_engine_unavailable');
    // Message métier — aucune fuite technique « DOMMatrix » dans le chat.
    expect((err as CVExtractError).message).not.toMatch(/DOMMatrix/);
  });

  it('traduit un ReferenceError DOMMatrix du parsing en pdf_engine_unavailable (filet)', async () => {
    restore = setPdfGlobals(true); // précondition OK…
    getTextImpl = () =>
      Promise.reject(new ReferenceError('DOMMatrix is not defined'));
    const err = await extractCVText(
      makeFile('CV.pdf', '%PDF-1.4 binaire factice', 'application/pdf'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CVExtractError);
    expect((err as CVExtractError).code).toBe('pdf_engine_unavailable');
  });

  it('mappe une autre erreur de parsing en parse_failed', async () => {
    restore = setPdfGlobals(true);
    getTextImpl = () => Promise.reject(new Error('Invalid PDF structure'));
    const err = await extractCVText(
      makeFile('CV.pdf', '%PDF-1.4 binaire factice', 'application/pdf'),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(CVExtractError);
    expect((err as CVExtractError).code).toBe('parse_failed');
  });
});
