/**
 * Les SOURCES d'un import initial : un dossier (récursif) et/ou des archives.
 *
 * Chaque source devient un LOT (au sens du journal) : les fichiers libres d'un
 * dossier forment un lot, chaque archive en forme un autre — une archive
 * trouvée DANS le dossier comme une archive passée par `--zip`. L'identifiant
 * de lot est OPAQUE (`<run>-<n>`) : le nom d'une archive peut être celui d'une
 * personne (« CV Jean Dupont.zip ») et le journal ne doit en porter aucun. Le
 * libellé lisible ne quitte pas le poste de l'opérateur (détail local).
 */

import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { classifyEntry, mimeForExtension } from './classify';
import {
  ENTRY_ERROR_LABEL,
  openZipArchive,
  ZIP_ERROR_LABEL,
  type ZipArchive,
} from './zip-reader';

export type ImportFile = {
  /** Chemin lisible (détail local seulement — peut porter un nom). */
  displayPath: string;
  fileName: string;
  mimeType: string;
  /** Date du fichier (ms) — départage les doublons : la plus récente est gardée. */
  modifiedAt: number | null;
  /** Contenu, relu à la demande (jamais gardé pour tout le fonds). */
  load(): Promise<Buffer | { error: string }>;
};

export type IgnoredFile = { displayPath: string; reason: string };

export type SourceBatch = {
  batchId: string;
  kind: 'dir' | 'zip';
  /** Libellé lisible — détail local seulement. */
  label: string;
  files: ImportFile[];
  ignored: IgnoredFile[];
  /** Archive illisible dans son ensemble (listée et sautée). */
  unreadable: string | null;
  close(): Promise<void>;
};

export async function collectSources(opts: {
  runId: string;
  dir: string | null;
  zips: string[];
}): Promise<SourceBatch[]> {
  const batches: SourceBatch[] = [];
  const nextId = () => `${opts.runId}-${batches.length + 1}`;
  const zipPaths: string[] = [];
  const seenZips = new Set<string>();
  const addZip = async (p: string) => {
    const real = await realpath(p).catch(() => resolve(p));
    if (seenZips.has(real)) return;
    seenZips.add(real);
    zipPaths.push(p);
  };

  if (opts.dir) {
    const root = opts.dir;
    const files: ImportFile[] = [];
    const ignored: IgnoredFile[] = [];
    const walk = async (d: string): Promise<void> => {
      const entries = await readdir(d, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        const abs = join(d, e.name);
        const rel = relative(root, abs);
        if (e.isDirectory()) {
          if (e.name === '__MACOSX' || e.name.startsWith('.')) continue;
          await walk(abs);
          continue;
        }
        if (!e.isFile()) continue;
        const c = classifyEntry(rel, false);
        if (c.kind === 'zip') await addZip(abs);
        else if (c.kind === 'ignored') ignored.push({ displayPath: rel, reason: c.reason });
        else {
          files.push({
            displayPath: rel,
            fileName: e.name,
            mimeType: mimeForExtension(c.extension),
            modifiedAt: (await stat(abs).catch(() => null))?.mtimeMs ?? null,
            load: () => readFile(abs).catch((err: unknown) => ({ error: `lecture impossible : ${String(err)}` })),
          });
        }
      }
    };
    await walk(root);
    if (files.length > 0 || ignored.length > 0) {
      batches.push({
        batchId: nextId(),
        kind: 'dir',
        label: root,
        files,
        ignored,
        unreadable: null,
        close: async () => {},
      });
    }
  }

  for (const z of opts.zips) await addZip(z);

  for (const zipPath of zipPaths) {
    const archive = await openZipArchive(zipPath);
    const batchId = nextId();
    if (typeof archive === 'string') {
      batches.push({
        batchId,
        kind: 'zip',
        label: zipPath,
        files: [],
        ignored: [],
        unreadable: ZIP_ERROR_LABEL[archive],
        close: async () => {},
      });
      continue;
    }
    batches.push({ batchId, kind: 'zip', label: zipPath, ...zipContents(zipPath, archive) });
  }
  return batches;
}

function zipContents(
  zipPath: string,
  archive: ZipArchive,
): Pick<SourceBatch, 'files' | 'ignored' | 'unreadable' | 'close'> {
  const files: ImportFile[] = [];
  const ignored: IgnoredFile[] = [];
  const label = zipPath.split(/[\\/]/u).pop() ?? zipPath;
  for (const entry of archive.entries) {
    if (entry.isDirectory) continue;
    const displayPath = `${label}:${entry.name}`;
    const c = classifyEntry(entry.name, true);
    if (c.kind === 'ignored') {
      ignored.push({ displayPath, reason: c.reason });
      continue;
    }
    if (c.kind !== 'cv') continue;
    files.push({
      displayPath,
      fileName: entry.name.split('/').pop() ?? entry.name,
      mimeType: mimeForExtension(c.extension),
      modifiedAt: entry.modifiedAt,
      load: async () => {
        const r = await archive.read(entry);
        return typeof r === 'string' ? { error: ENTRY_ERROR_LABEL[r] } : r;
      },
    });
  }
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  return { files, ignored, unreadable: null, close: () => archive.close() };
}
