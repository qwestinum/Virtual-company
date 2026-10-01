/**
 * Lecteur d'archives .zip de l'import initial du vivier — sans dépendance.
 *
 * Pourquoi un lecteur à nous : il faut (1) savoir qu'une archive est protégée
 * par mot de passe AVANT de la traiter (les bibliothèques installées ne
 * l'exposent pas : elles rendent des octets inexploitables), et (2) lire les
 * entrées UNE PAR UNE, sans décompresser l'archive entière. Chaque CV passe
 * par la mémoire le temps de son traitement et n'est JAMAIS écrit sur disque :
 * aucun dossier temporaire à nettoyer, aucun CV qui traîne après un arrêt
 * brutal.
 *
 * Périmètre assumé : méthodes « stockée » (0) et « deflate » (8), soit ce que
 * produisent Windows, macOS et les outils courants. ZIP64 (archives > 4 Go ou
 * > 65 535 entrées) est refusé — dit comme tel, jamais traité à moitié.
 *
 * Les fonctions d'analyse sont PURES (sur des Buffers) ; `openZipArchive`
 * n'ajoute que la lecture de fichier.
 */

import { open, type FileHandle } from 'node:fs/promises';
import { crc32, inflateRawSync } from 'node:zlib';

export type ZipEntry = {
  name: string;
  encrypted: boolean;
  isDirectory: boolean;
  method: number;
  crc: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  /** Date de modification du fichier dans l'archive (ms), null si illisible. */
  modifiedAt: number | null;
};

export type ZipArchiveError =
  | 'not_a_zip'
  | 'zip64_unsupported'
  | 'corrupt'
  | 'password_protected';

export const ZIP_ERROR_LABEL: Record<ZipArchiveError, string> = {
  not_a_zip: "pas une archive zip lisible (fin d'archive introuvable)",
  zip64_unsupported: 'archive ZIP64 (> 4 Go ou > 65 535 fichiers) non prise en charge — la découper',
  corrupt: 'archive corrompue (répertoire central illisible)',
  password_protected: 'archive protégée par mot de passe',
};

/** Borne par entrée : aucun CV ne pèse 50 Mo ; au-delà, c'est autre chose. */
export const MAX_ENTRY_BYTES = 50 * 1024 * 1024;

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const EOCD_MIN = 22;
const EOCD_MAX_COMMENT = 0xffff;

// Page de code 437 (noms de fichiers d'un zip sans le drapeau UTF-8 : c'est
// ce qu'écrit l'explorateur Windows). Caractères 0x80-0xFF.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

export function decodeCp437(bytes: Buffer): string {
  let out = '';
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return out;
}

export type EocdInfo = { entryCount: number; cdSize: number; cdOffset: number };

/** Cherche la fin d'archive dans la QUEUE du fichier (commentaire compris). */
export function findEocd(tail: Buffer): EocdInfo | ZipArchiveError {
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue;
    const commentLen = tail.readUInt16LE(i + 20);
    if (i + EOCD_MIN + commentLen !== tail.length) continue; // faux positif
    const entryCount = tail.readUInt16LE(i + 10);
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    if (entryCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      return 'zip64_unsupported';
    }
    return { entryCount, cdSize, cdOffset };
  }
  return 'not_a_zip';
}

const STRICT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Nom d'une entrée, en forme Unicode NFC. Ordre : drapeau UTF-8, champ Unicode
 * Path, puis — sans l'un ni l'autre — UTF-8 s'il est VALIDE, sinon page 437.
 * Le troisième cas est celui de l'archiveur de macOS, qui écrit de l'UTF-8
 * sans le signaler : décodé en 437, « détaillé » devenait « de╠ütaille╠ü »
 * (import du 29/09/2026). Un vrai nom 437 accentué n'est presque jamais de
 * l'UTF-8 valide (un octet ≥ 0x80 isolé ne l'est pas) ; le risque inverse est
 * accepté. NFC : macOS décompose les accents (e + ◌́), un fichier de dates
 * tapé sous Windows les compose — sans normalisation, ils ne se reconnaîtraient
 * pas.
 */
function entryName(flags: number, raw: Buffer, extra: Buffer): string {
  return decodeEntryName(flags, raw, extra).normalize('NFC');
}

function decodeEntryName(flags: number, raw: Buffer, extra: Buffer): string {
  if (flags & 0x0800) return raw.toString('utf8');
  // Champ « Info-ZIP Unicode Path » (0x7075) : le nom UTF-8 à côté du nom 437.
  for (let p = 0; p + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(p);
    const size = extra.readUInt16LE(p + 2);
    if (id === 0x7075 && size >= 5 && p + 4 + size <= extra.length) {
      return extra.subarray(p + 9, p + 4 + size).toString('utf8');
    }
    p += 4 + size;
  }
  if (raw.some((b) => b >= 0x80)) {
    try {
      return STRICT_UTF8.decode(raw);
    } catch {
      // Pas de l'UTF-8 : un nom écrit par l'explorateur Windows.
    }
  }
  return decodeCp437(raw);
}

/**
 * Date MS-DOS d'une entrée (heure locale de la machine qui a zippé, à 2 s
 * près). Sert à garder la version la PLUS RÉCENTE d'un doublon. PUR.
 */
export function dosDateTime(time: number, date: number): number | null {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

export function parseCentralDirectory(cd: Buffer, entryCount: number): ZipEntry[] | ZipArchiveError {
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let n = 0; n < entryCount; n++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== CD_SIG) return 'corrupt';
    const flags = cd.readUInt16LE(p + 8);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > cd.length) return 'corrupt';
    const name = entryName(
      flags,
      cd.subarray(p + 46, p + 46 + nameLen),
      cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen),
    );
    entries.push({
      name,
      encrypted: (flags & 0x0001) !== 0,
      isDirectory: name.endsWith('/'),
      method: cd.readUInt16LE(p + 10),
      crc: cd.readUInt32LE(p + 16),
      compressedSize: cd.readUInt32LE(p + 20),
      uncompressedSize: cd.readUInt32LE(p + 24),
      localHeaderOffset: cd.readUInt32LE(p + 42),
      modifiedAt: dosDateTime(cd.readUInt16LE(p + 12), cd.readUInt16LE(p + 14)),
    });
    p = end;
  }
  return entries;
}

export type EntryReadError = 'unsupported_method' | 'too_large' | 'corrupt_entry';

export const ENTRY_ERROR_LABEL: Record<EntryReadError, string> = {
  unsupported_method: 'méthode de compression non prise en charge',
  too_large: 'fichier de plus de 50 Mo dans l’archive',
  corrupt_entry: 'fichier corrompu dans l’archive',
};

/** Décompresse les données d'une entrée et contrôle taille + CRC. PUR. */
export function inflateEntry(entry: ZipEntry, data: Buffer): Buffer | EntryReadError {
  let out: Buffer;
  try {
    if (entry.method === 0) out = data;
    else if (entry.method === 8) out = inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    else return 'unsupported_method';
  } catch {
    return 'corrupt_entry';
  }
  if (out.length !== entry.uncompressedSize) return 'corrupt_entry';
  if (crc32(out) !== entry.crc) return 'corrupt_entry';
  return out;
}

export type ZipArchive = {
  entries: ZipEntry[];
  read(entry: ZipEntry): Promise<Buffer | EntryReadError>;
  close(): Promise<void>;
};

/**
 * Ouvre une archive : lit la fin et le répertoire central, refuse une archive
 * dont UNE entrée est chiffrée (on ne traite pas une moitié d'archive).
 */
export async function openZipArchive(path: string): Promise<ZipArchive | ZipArchiveError> {
  let fh: FileHandle;
  try {
    fh = await open(path, 'r');
  } catch {
    return 'not_a_zip';
  }
  try {
    const { size } = await fh.stat();
    if (size < EOCD_MIN) throw new ArchiveFailure('not_a_zip');
    const tailLen = Math.min(size, EOCD_MIN + EOCD_MAX_COMMENT);
    const tail = await readAt(fh, size - tailLen, tailLen);
    const eocd = findEocd(tail);
    if (typeof eocd === 'string') throw new ArchiveFailure(eocd);
    if (eocd.cdOffset + eocd.cdSize > size) throw new ArchiveFailure('corrupt');
    const cd = await readAt(fh, eocd.cdOffset, eocd.cdSize);
    const entries = parseCentralDirectory(cd, eocd.entryCount);
    if (typeof entries === 'string') throw new ArchiveFailure(entries);
    if (entries.some((e) => e.encrypted)) throw new ArchiveFailure('password_protected');

    return {
      entries,
      async read(entry) {
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) return 'too_large';
        try {
          const local = await readAt(fh, entry.localHeaderOffset, 30);
          if (local.readUInt32LE(0) !== LOCAL_SIG) return 'corrupt_entry';
          const dataStart =
            entry.localHeaderOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
          if (dataStart + entry.compressedSize > size) return 'corrupt_entry';
          return inflateEntry(entry, await readAt(fh, dataStart, entry.compressedSize));
        } catch {
          return 'corrupt_entry';
        }
      },
      close: () => fh.close(),
    };
  } catch (err) {
    await fh.close().catch(() => {});
    if (err instanceof ArchiveFailure) return err.reason;
    return 'corrupt';
  }
}

class ArchiveFailure extends Error {
  constructor(readonly reason: ZipArchiveError) {
    super(reason);
  }
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw new ArchiveFailure('corrupt');
  return buf;
}
