import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { collectSources } from '../sources';

let root = '';
let fonds = '';
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'sources-'));
  fonds = join(root, 'fonds');
  await mkdir(join(fonds, '2024'), { recursive: true });
  await writeFile(join(fonds, 'a.pdf'), '%PDF a');
  await writeFile(join(fonds, '2024', 'b.docx'), 'docx b');
  await writeFile(join(fonds, '2024', 'vieux.doc'), 'doc');
  await writeFile(join(fonds, '.DS_Store'), '');
  await writeFile(
    join(fonds, 'CV Jean Dupont.zip'),
    zipSync({ 'c.pdf': strToU8('%PDF c'), 'interne.zip': strToU8('x'), 'img.png': strToU8('png') }),
  );
  await writeFile(join(root, 'casse.zip'), strToU8('pas une archive'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('sources de l’import', () => {
  it('un lot pour le dossier, un par archive — identifiants OPAQUES', async () => {
    const zipInDir = join(fonds, 'CV Jean Dupont.zip');
    const batches = await collectSources({
      runId: 'vimp-t',
      dir: fonds,
      zips: [join(root, 'casse.zip'), zipInDir], // la même archive, deux fois
    });
    expect(batches.map((b) => b.batchId)).toEqual(['vimp-t-1', 'vimp-t-2', 'vimp-t-3']);
    for (const b of batches) expect(b.batchId).not.toContain('Dupont');

    const [dir, archive, broken] = batches;
    expect(dir!.files.map((f) => f.displayPath).sort()).toEqual(['2024/b.docx', 'a.pdf']);
    expect(dir!.ignored.map((i) => i.displayPath).sort()).toEqual(['.DS_Store', '2024/vieux.doc']);

    expect(archive!.kind).toBe('zip');
    expect(archive!.files.map((f) => f.fileName)).toEqual(['c.pdf']);
    expect((await archive!.files[0]!.load()).toString()).toBe('%PDF c');
    expect(archive!.ignored.map((i) => i.reason)).toEqual(
      expect.arrayContaining([expect.stringContaining('--zip'), expect.stringContaining('.png')]),
    );

    expect(broken!.unreadable).toContain('pas une archive');
    expect(broken!.files).toEqual([]);
    for (const b of batches) await b.close();
  });
});
