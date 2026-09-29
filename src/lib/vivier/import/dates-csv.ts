/**
 * Fichier `--dates` de l'import initial : nom de fichier → date de candidature.
 * PUR.
 *
 * La date devient la date de référence de RÉTENTION du dossier : c'est une
 * promesse faite au candidat, donc une ligne illisible est une ERREUR qui
 * arrête l'import avant toute écriture — jamais une ligne ignorée en silence
 * (le dossier partirait avec la date d'import, sans que personne le sache).
 *
 * Format accepté : deux colonnes, séparées par `;` ou `,` (détecté sur la
 * première ligne), en-tête facultatif, date `AAAA-MM-JJ` ou `JJ/MM/AAAA`.
 * Correspondance sur le NOM de fichier seul (sans dossier), insensible à la
 * casse : le client connaît ses fichiers, pas l'arborescence de l'archive.
 */

export type DatesCsvResult = {
  /** Nom de fichier (minuscules) → date ISO `AAAA-MM-JJ`. */
  dates: Map<string, string>;
  errors: string[];
};

const HEADER = /^(fichier|file|nom|filename|name)\b/iu;

export function datesKey(fileName: string): string {
  const base = fileName.split(/[\\/]/u).pop() ?? fileName;
  return base.trim().toLowerCase();
}

export function parseDateCell(raw: string, today: Date): string | null {
  const v = raw.trim().replace(/^"|"$/gu, '');
  let y: number;
  let m: number;
  let d: number;
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  const fr = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/u);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (fr) [d, m, y] = [Number(fr[1]), Number(fr[2]), Number(fr[3])];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null; // 31/02, 00/13…
  }
  if (date.getTime() > today.getTime()) return null; // une candidature future n'existe pas
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseDatesCsv(content: string, today: Date = new Date()): DatesCsvResult {
  const dates = new Map<string, string>();
  const errors: string[] = [];
  const lines = content.replace(/^﻿/u, '').split(/\r?\n/u);
  const firstData = lines.find((l) => l.trim() !== '') ?? '';
  const sep = firstData.includes(';') ? ';' : ',';

  let first = true;
  lines.forEach((line, i) => {
    const n = i + 1;
    if (line.trim() === '') return;
    const cells = line.split(sep);
    const isFirst = first;
    first = false;
    if (isFirst && HEADER.test(cells[0]!.trim().replace(/^"/u, ''))) return; // en-tête
    if (cells.length !== 2) {
      errors.push(`ligne ${n} : deux colonnes attendues (fichier${sep}date), ${cells.length} trouvée(s)`);
      return;
    }
    const key = datesKey(cells[0]!.trim().replace(/^"|"$/gu, ''));
    if (!key) {
      errors.push(`ligne ${n} : nom de fichier vide`);
      return;
    }
    const date = parseDateCell(cells[1]!, today);
    if (!date) {
      errors.push(`ligne ${n} : date illisible ou future (AAAA-MM-JJ ou JJ/MM/AAAA)`);
      return;
    }
    const prior = dates.get(key);
    if (prior !== undefined && prior !== date) {
      errors.push(`ligne ${n} : « ${key} » a déjà une autre date (${prior})`);
      return;
    }
    dates.set(key, date);
  });
  return { dates, errors };
}
