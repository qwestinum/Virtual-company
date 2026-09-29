/**
 * Ce qu'un fichier trouvé dans le fonds devient — PUR.
 *
 * Seuls PDF et DOCX entrent (ce que le pipeline d'extraction sait lire, comme
 * la relève IMAP). Tout le reste est LISTÉ avec sa raison, jamais écarté en
 * silence : un fonds de cabinet contient des .doc, des lettres scannées, des
 * archives dans des archives, et l'opérateur doit savoir quoi en faire.
 */

export type EntryKind =
  | { kind: 'cv'; extension: '.pdf' | '.docx' }
  | { kind: 'zip' }
  | { kind: 'ignored'; reason: string };

const SYSTEM_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);

export function extensionOf(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : '';
}

export function baseName(path: string): string {
  return path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
}

/**
 * `inArchive` : un zip DANS un zip n'est pas ouvert (profondeur non bornée,
 * et un fonds légitime n'en a pas besoin) — il est listé, à extraire à part.
 */
export function classifyEntry(path: string, inArchive: boolean): EntryKind {
  const base = baseName(path);
  const lower = base.toLowerCase();
  if (
    path.split(/[\\/]/u).includes('__MACOSX') ||
    lower.startsWith('._') ||
    SYSTEM_NAMES.has(lower) ||
    lower.startsWith('.')
  ) {
    return { kind: 'ignored', reason: 'fichier système ou caché' };
  }
  const ext = extensionOf(base);
  if (ext === '.pdf' || ext === '.docx') return { kind: 'cv', extension: ext };
  if (ext === '.zip') {
    return inArchive
      ? { kind: 'ignored', reason: 'archive dans une archive — à extraire puis passer avec --zip' }
      : { kind: 'zip' };
  }
  if (ext === '.doc') {
    return { kind: 'ignored', reason: 'format .doc non pris en charge — enregistrer en .docx ou PDF' };
  }
  return { kind: 'ignored', reason: ext ? `extension ${ext} non prise en charge` : 'fichier sans extension' };
}

export function mimeForExtension(ext: '.pdf' | '.docx'): string {
  return ext === '.pdf'
    ? 'application/pdf'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
}
