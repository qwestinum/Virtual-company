import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { decodeCp437, dosDateTime, findEocd, openZipArchive } from '../zip-reader';

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'zip-reader-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, bytes: Uint8Array): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, bytes);
  return p;
}

function sample(): Uint8Array {
  return zipSync({
    'cv/Hélène.pdf': [strToU8('%PDF-1.4 contenu '.repeat(50)), { level: 6 }],
    'cv/brut.docx': [strToU8('docx brut'), { level: 0 }],
    'vide/': new Uint8Array(0),
  });
}

/** Pose le bit « chiffré » sur chaque en-tête du répertoire central. */
function markEncrypted(zip: Uint8Array): Uint8Array {
  const b = Buffer.from(zip);
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b.readUInt32LE(i) === 0x02014b50) b.writeUInt16LE(b.readUInt16LE(i + 8) | 1, i + 8);
  }
  return b;
}

describe('lecteur d’archives de l’import', () => {
  it('lit les entrées une à une, stockées ou compressées, noms UTF-8 compris', async () => {
    const archive = await openZipArchive(await write('ok.zip', sample()));
    if (typeof archive === 'string') throw new Error(archive);
    const names = archive.entries.map((e) => e.name);
    expect(names).toContain('cv/Hélène.pdf');
    const pdf = archive.entries.find((e) => e.name === 'cv/Hélène.pdf')!;
    const docx = archive.entries.find((e) => e.name === 'cv/brut.docx')!;
    expect((await archive.read(pdf)).toString()).toBe('%PDF-1.4 contenu '.repeat(50));
    expect((await archive.read(docx)).toString()).toBe('docx brut');
    expect(archive.entries.find((e) => e.name === 'vide/')!.isDirectory).toBe(true);
    await archive.close();
  });

  it('une archive protégée par mot de passe est refusée ENTIÈRE', async () => {
    expect(await openZipArchive(await write('chiffre.zip', markEncrypted(sample())))).toBe('password_protected');
  });

  it('une archive tronquée ou qui n’en est pas une est refusée, sans lever', async () => {
    const full = sample();
    expect(await openZipArchive(await write('tronque.zip', full.slice(0, full.length - 10)))).toBe('not_a_zip');
    expect(await openZipArchive(await write('texte.zip', strToU8('bonjour')))).toBe('not_a_zip');
    expect(await openZipArchive(join(dir, 'absente.zip'))).toBe('not_a_zip');
  });

  it('une entrée altérée est signalée (contrôle CRC), les autres restent lisibles', async () => {
    const b = Buffer.from(zipSync({ 'a.pdf': [strToU8('AAAA'), { level: 0 }], 'b.pdf': [strToU8('BBBB'), { level: 0 }] }));
    b[b.indexOf('AAAA')] = 0x5a; // 'ZAAA'
    const archive = await openZipArchive(await write('altere.zip', b));
    if (typeof archive === 'string') throw new Error(archive);
    expect(await archive.read(archive.entries[0]!)).toBe('corrupt_entry');
    expect((await archive.read(archive.entries[1]!)).toString()).toBe('BBBB');
    await archive.close();
  });

  it('refuse ZIP64 plutôt que de le traiter à moitié', () => {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0xffff, 10);
    expect(findEocd(eocd)).toBe('zip64_unsupported');
  });

  it('les noms sans drapeau UTF-8 se lisent en page de code 437 (explorateur Windows)', () => {
    expect(decodeCp437(Buffer.from([0x43, 0x56, 0x5f, 0x82, 0x2e]))).toBe('CV_é.');
  });

  it('lit la date de chaque entrée (format MS-DOS, à 2 s près)', async () => {
    const when = new Date(2025, 2, 14, 10, 30, 42);
    const archive = await openZipArchive(
      await write('date.zip', zipSync({ 'a.pdf': [strToU8('x'), { mtime: when }] })),
    );
    if (typeof archive === 'string') throw new Error(archive);
    expect(archive.entries[0]!.modifiedAt).toBe(when.getTime());
    await archive.close();
    expect(dosDateTime(0, 0)).toBeNull();
  });

  /** Archive dont le nom brut est `raw`, SANS drapeau UTF-8 (placeholder ASCII remplacé). */
  function rawNamed(raw: Buffer): Uint8Array {
    const placeholder = 'N'.repeat(raw.length);
    const b = Buffer.from(zipSync({ [placeholder]: [strToU8('x'), { level: 0 }] }));
    for (let i = b.indexOf(placeholder); i !== -1; i = b.indexOf(placeholder, i + 1)) raw.copy(b, i);
    return b;
  }

  it('nom UTF-8 NON signalé (archiveur macOS, accents décomposés) : lu en UTF-8, recomposé', async () => {
    const mac = Buffer.from('CV-de\u0301taille\u0301.docx'.normalize('NFD'), 'utf8');
    const archive = await openZipArchive(await write('mac.zip', rawNamed(mac)));
    if (typeof archive === 'string') throw new Error(archive);
    expect(archive.entries[0]!.name).toBe('CV-détaillé.docx'.normalize('NFC'));
    expect(archive.entries[0]!.name).not.toContain('╠');
    await archive.close();
  });

  it('un vrai nom Windows (page 437) n’est pas pris pour de l’UTF-8', async () => {
    const windows = Buffer.from([0x43, 0x56, 0x5f, 0x82, 0x2e, 0x70, 0x64, 0x66]); // CV_é.pdf en 437
    const archive = await openZipArchive(await write('win.zip', rawNamed(windows)));
    if (typeof archive === 'string') throw new Error(archive);
    expect(archive.entries[0]!.name).toBe('CV_é.pdf');
    await archive.close();
  });
});
