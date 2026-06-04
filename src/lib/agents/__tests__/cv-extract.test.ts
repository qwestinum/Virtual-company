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
      extractCVText(makeFile('cv.docx', 'x'.repeat(50), 'application/zip')),
    ).rejects.toMatchObject({ code: 'unsupported_type' });
  });
});

describe('extractCVText — PDF', () => {
  let restore: () => void;

  beforeEach(() => {
    getTextImpl = () =>
      Promise.resolve({
        text: 'Imad BELFAQIR — Expert test management, 20 ans d’expérience.',
      });
  });

  afterEach(() => {
    restore?.();
    vi.clearAllMocks();
  });

  it('extrait le texte quand le moteur PDF est polyfillé', async () => {
    restore = setPdfGlobals(true);
    const out = await extractCVText(
      makeFile('CV.pdf', '%PDF-1.4 binaire factice', 'application/pdf'),
    );
    expect(out.mime).toBe('application/pdf');
    expect(out.text).toContain('Imad BELFAQIR');
  });

  it('lève pdf_engine_unavailable (pas parse_failed) si un global manque (précondition)', async () => {
    restore = setPdfGlobals(false);
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
