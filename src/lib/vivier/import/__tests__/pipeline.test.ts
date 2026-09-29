import { describe, expect, it, vi } from 'vitest';

import { cvTextFingerprint } from '../fingerprint';
import {
  DedupIndex,
  classifySurvey,
  importFile,
  importLot,
  mapBounded,
  newestFirst,
  readForSurvey,
  surveyFile,
  type ImportDeps,
  type Importable,
  type SurveyDeps,
} from '../pipeline';
import type { ImportFile } from '../sources';

const RETENTION = () => ({ at: '2026-09-29T00:00:00.000Z', kind: 'import_date' as const });

function file(name: string, content = name): ImportFile {
  return {
    displayPath: `lot:${name}`,
    fileName: name,
    mimeType: 'application/pdf',
    modifiedAt: null,
    load: async () => Buffer.from(content),
  };
}

/** L'« extraction » rend le contenu du fichier tel quel. */
const survey: SurveyDeps = {
  extractText: async (buffer) => buffer.toString(),
  extractErrorCode: () => null,
};

const CV_A = 'Alice Test consultante alice@test.local';
const CV_B = 'Bruno Test développeur bruno@test.local';

describe('CONSTAT — gratuit, sans modèle', () => {
  it('importable : une adresse, un texte jamais vu', async () => {
    const r = await surveyFile('b1', file('a.pdf', CV_A), new DedupIndex([]), RETENTION, survey);
    expect(r.result.outcome).toBe('importable');
    expect(r.importable?.fingerprint).toBe(cvTextFingerprint(CV_A));
  });

  it('même CV déjà dans le vivier — y compris un dossier antérieur SANS empreinte stockée', async () => {
    const dedup = new DedupIndex([{ email: 'autre@test.local', cvFingerprint: cvTextFingerprint(CV_A) }]);
    const r = await surveyFile('b1', file('a.pdf', CV_A), dedup, RETENTION, survey);
    expect(r.result).toMatchObject({ outcome: 'duplicate_fingerprint', detail: expect.stringContaining('vivier') });
  });

  it('même CV deux fois dans le run : le second est un doublon', async () => {
    const dedup = new DedupIndex([]);
    await surveyFile('b1', file('a.pdf', CV_A), dedup, RETENTION, survey);
    const r = await surveyFile('b2', file('copie.pdf', `  ${CV_A.toUpperCase()}\n`), dedup, RETENTION, survey);
    expect(r.result).toMatchObject({ outcome: 'duplicate_fingerprint', detail: expect.stringContaining('plus récente') });
  });

  it('même adresse, CV différent : doublon par l’adresse (casse ignorée)', async () => {
    const dedup = new DedupIndex([{ email: 'Alice@Test.local', cvFingerprint: null }]);
    const r = await surveyFile('b1', file('a2.pdf', 'Alice Test v2 alice@test.local'), dedup, RETENTION, survey);
    expect(r.result.outcome).toBe('duplicate_email');
  });

  it('aucune adresse : sans adresse, sans appeler personne', async () => {
    const r = await surveyFile('b1', file('x.pdf', 'Un CV sans adresse'), new DedupIndex([]), RETENTION, survey);
    expect(r.result.outcome).toBe('no_email');
    expect(r.importable).toBeNull();
  });

  it('plusieurs adresses : importable, et le rapport dit que le modèle tranchera', async () => {
    const r = await surveyFile('b1', file('x.pdf', `${CV_A} rh@cabinet.test`), new DedupIndex([]), RETENTION, survey);
    expect(r.result.outcome).toBe('importable');
    expect(r.importable?.emailAmbiguous).toBe(true);
    expect(r.result.detail).toContain('2 adresses');
  });

  it('document illisible ≠ outil en panne', async () => {
    const unreadable: SurveyDeps = {
      extractText: async () => Promise.reject(new Error('x')),
      extractErrorCode: () => 'empty_text',
    };
    const broken: SurveyDeps = { ...unreadable, extractErrorCode: () => 'pdf_engine_unavailable' };
    expect((await surveyFile('b', file('a.pdf'), new DedupIndex([]), RETENTION, unreadable)).result.outcome).toBe('unreadable');
    expect((await surveyFile('b', file('a.pdf'), new DedupIndex([]), RETENTION, broken)).result.outcome).toBe('failed');
  });

  it('un fichier qu’on ne peut pas lire dans l’archive est illisible', async () => {
    const f: ImportFile = { ...file('a.pdf'), load: async () => ({ error: 'fichier corrompu dans l’archive' }) };
    const r = await surveyFile('b', f, new DedupIndex([]), RETENTION, survey);
    expect(r.result).toMatchObject({ outcome: 'unreadable', detail: 'fichier corrompu dans l’archive' });
  });
});

function importable(text: string): Importable {
  return {
    batchId: 'b1',
    file: file('a.pdf', text),
    text,
    fingerprint: cvTextFingerprint(text)!,
    emailAmbiguous: false,
    retention: RETENTION(),
  };
}

function deps(over: Partial<ImportDeps> = {}): ImportDeps {
  return {
    identify: vi.fn(async (text: string) => ({
      isCv: true,
      fullName: 'Alice Test',
      email: text.match(/\S+@\S+/u)?.[0] ?? null,
      phone: null,
    })),
    isPermanentIdentityError: () => false,
    createCandidate: vi.fn(async () => ({ id: 'id-1' })),
    index: vi.fn(async () => ({ ok: true as const })),
    ...over,
  };
}

describe('ÉCRITURE', () => {
  it('parcours nominal : identité, création, indexation vérifiée', async () => {
    const d = deps();
    const r = await importFile(importable(CV_A), new DedupIndex([]), d);
    expect(r.outcome).toBe('imported');
    expect(d.createCandidate).toHaveBeenCalledWith(expect.objectContaining({ email: 'alice@test.local' }));
  });

  it('un doublon d’empreinte ne coûte AUCUN appel au modèle', async () => {
    const d = deps();
    const dedup = new DedupIndex([{ email: 'z@test.local', cvFingerprint: cvTextFingerprint(CV_A) }]);
    expect((await importFile(importable(CV_A), dedup, d)).outcome).toBe('duplicate_fingerprint');
    expect(d.identify).not.toHaveBeenCalled();
    expect(d.createCandidate).not.toHaveBeenCalled();
  });

  it('l’adresse retenue par le modèle est déjà connue : listé, jamais écrit', async () => {
    const d = deps();
    const dedup = new DedupIndex([{ email: 'alice@test.local', cvFingerprint: null }]);
    expect((await importFile(importable(CV_A), dedup, d)).outcome).toBe('duplicate_email');
    expect(d.createCandidate).not.toHaveBeenCalled();
  });

  it('course sur l’unicité en base : doublon, pas échec', async () => {
    const d = deps({ createCandidate: vi.fn(async () => 'duplicate_email' as const) });
    expect((await importFile(importable(CV_B), new DedupIndex([]), d)).outcome).toBe('duplicate_email');
  });

  it('non-CV et sans adresse : rien n’est écrit', async () => {
    const notCv = deps({ identify: async () => ({ isCv: false, fullName: 'x', email: null, phone: null }) });
    expect((await importFile(importable(CV_A), new DedupIndex([]), notCv)).outcome).toBe('not_a_cv');
    expect(notCv.createCandidate).not.toHaveBeenCalled();
  });

  it('panne du modèle : échec à relancer, rien n’est écrit', async () => {
    const d = deps({ identify: async () => Promise.reject(new Error('429 rate limit')) });
    const r = await importFile(importable(CV_A), new DedupIndex([]), d);
    expect(r.outcome).toBe('failed');
    expect(d.createCandidate).not.toHaveBeenCalled();
  });

  it('indexation en échec : le dossier est importé, et c’est dit', async () => {
    const d = deps({ index: async () => ({ ok: false as const, reason: 'embedding du titre absent' }) });
    expect(await importFile(importable(CV_A), new DedupIndex([]), d)).toMatchObject({
      outcome: 'imported_not_indexed',
      detail: 'embedding du titre absent',
    });
  });
});

describe('concurrence bornée', () => {
  it('garde l’ordre et ne dépasse pas la borne', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapBounded([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
});

describe('doublons internes : la version la PLUS RÉCENTE est gardée (DO, 29/09/2026)', () => {
  const dated = (name: string, text: string, modifiedAt: number | null): ImportFile => ({
    ...file(name, text),
    modifiedAt,
  });

  it('ordre : plus récent d’abord, date inconnue en dernier, puis le chemin', () => {
    const list = [
      { displayPath: 'b', modifiedAt: null },
      { displayPath: 'a', modifiedAt: 1 },
      { displayPath: 'c', modifiedAt: 5 },
      { displayPath: 'a2', modifiedAt: 5 },
    ].sort(newestFirst);
    expect(list.map((x) => x.displayPath)).toEqual(['a2', 'c', 'a', 'b']);
  });

  it('CONSTAT : la version récente gagne même si l’ancienne est lue la première', async () => {
    const old = dated('ancien.pdf', 'Alice v1 alice@test.local', 1_000);
    const recent = dated('recent.pdf', 'Alice v2 alice@test.local', 2_000);
    // L'ancienne est LUE d'abord : c'est l'ordre des dates qui décide.
    const reads = [await readForSurvey('b', old, survey), await readForSurvey('b', recent, survey)];
    const texts = reads.filter((r) => r.kind === 'text');
    texts.sort((a, b) => newestFirst(a.file, b.file));
    const dedup = new DedupIndex([]);
    const out = texts.map((r) => classifySurvey(r, dedup, RETENTION));
    expect(out.map((o) => [o.result.displayPath, o.result.outcome])).toEqual([
      ['lot:recent.pdf', 'importable'],
      ['lot:ancien.pdf', 'duplicate_email'],
    ]);
    expect(out[1]!.result.detail).toContain('plus récente');
  });

  it('ÉCRITURE : l’identité de l’ancienne revient plus vite, la récente est pourtant écrite', async () => {
    const mk = (name: string, text: string, t: number): Importable => ({
      ...importable(text),
      file: dated(name, text, t),
    });
    const old = mk('ancien.pdf', 'Alice v1 alice@test.local rh@x.test', 1_000);
    const recent = mk('recent.pdf', 'Alice v2 alice@test.local rh@x.test', 2_000);
    const d = deps({
      identify: async (text: string) => {
        // L'ancienne répond tout de suite, la récente plus tard.
        await new Promise((r) => setTimeout(r, text.includes('v2') ? 20 : 0));
        return { isCv: true, fullName: 'Alice', email: 'alice@test.local', phone: null };
      },
    });
    const results = await importLot([old, recent], new DedupIndex([]), d, 2);
    const byPath = Object.fromEntries(results.map((r) => [r.displayPath, r.outcome]));
    expect(byPath).toEqual({ 'lot:recent.pdf': 'imported', 'lot:ancien.pdf': 'duplicate_email' });
    expect(d.createCandidate).toHaveBeenCalledTimes(1);
    expect(d.createCandidate).toHaveBeenCalledWith(expect.objectContaining({ item: recent }));
  });
});

describe('texte extrait', () => {
  it('le caractère NUL est retiré (Postgres le refuse dans une colonne texte)', async () => {
    const r = await readForSurvey('b', file('a.pdf', 'Alice\u0000 Test alice@test.local'), survey);
    expect(r.kind === 'text' && r.text).toBe('Alice Test alice@test.local');
  });
});
