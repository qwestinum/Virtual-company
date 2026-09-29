/**
 * Import initial du vivier — le traitement d'un fichier, en DEUX TEMPS.
 *
 * 1. CONSTAT (`surveyFile`) — gratuit, aucun appel au modèle, aucune écriture :
 *    lecture, extraction du texte, empreinte, adresse(s) repérée(s) dans le
 *    texte. C'est tout le dry-run, et c'est aussi la première passe de
 *    l'exécution (c'est elle qui fournit le texte dont on estime le coût).
 *    L'adresse du constat est EXACTE quand le texte en porte zéro ou une : le
 *    résolveur de production ne retient jamais qu'une adresse littéralement
 *    présente (`resolveCandidateEmail`). Avec plusieurs, le modèle tranche à
 *    l'exécution — et le rapport le dit.
 * 2. ÉCRITURE (`importFile`) — identité par le modèle, dédoublonnage par
 *    l'adresse retenue, création du dossier, indexation vérifiée.
 *
 * Dédoublonnage : l'EMPREINTE d'abord (avant tout appel payant — un fichier
 * déjà importé est sauté pour rien, c'est la reprise), l'ADRESSE ensuite. Un
 * doublon est LISTÉ, jamais réinséré ni mis à jour : l'import ne touche aucun
 * dossier existant.
 *
 * Toutes les dépendances sont injectées : ce module ne sait ni lire la base,
 * ni appeler le modèle, ni envoyer quoi que ce soit (garde structurelle).
 */

import { extractEmailsFromText } from '@/lib/agents/candidate-email';
import type { VivierRetentionReferenceKind } from '@/types/vivier';

import { cvTextFingerprint } from './fingerprint';
import type { ImportFile } from './sources';

export type Outcome =
  | 'importable'
  | 'imported'
  | 'imported_not_indexed'
  | 'duplicate_fingerprint'
  | 'duplicate_email'
  | 'unreadable'
  | 'no_email'
  | 'not_a_cv'
  | 'failed';

export type FileResult = {
  batchId: string;
  displayPath: string;
  outcome: Outcome;
  /** Raison lisible (détail local). */
  detail: string | null;
};

export type Seen = 'vivier' | 'run';

/** Index de dédoublonnage : empreintes et adresses, du vivier et du run. */
export class DedupIndex {
  private readonly fingerprints = new Map<string, Seen>();
  private readonly emails = new Map<string, Seen>();

  constructor(vivier: { email: string; cvFingerprint: string | null }[]) {
    for (const row of vivier) {
      this.emails.set(row.email.trim().toLowerCase(), 'vivier');
      if (row.cvFingerprint) this.fingerprints.set(row.cvFingerprint, 'vivier');
    }
  }

  /** Rend l'origine d'un doublon, ou null après avoir RÉSERVÉ la clé (synchrone). */
  claimFingerprint(fp: string): Seen | null {
    const seen = this.fingerprints.get(fp);
    if (seen) return seen;
    this.fingerprints.set(fp, 'run');
    return null;
  }

  claimEmail(email: string): Seen | null {
    const key = email.trim().toLowerCase();
    const seen = this.emails.get(key);
    if (seen) return seen;
    this.emails.set(key, 'run');
    return null;
  }
}

const DUP_LABEL: Record<Seen, string> = {
  vivier: 'déjà dans le vivier',
  run: 'dans une version plus récente du même import (gardée)',
};

/**
 * Ordre de DÉCISION des doublons internes à un import : le fichier le PLUS
 * RÉCENT d'abord (date dans l'archive, ou sur le disque), donc c'est lui qui
 * est gardé ; date inconnue en dernier ; à égalité, l'ordre du chemin.
 * Décision du donneur d'ordre, 29/09/2026.
 */
export function newestFirst(
  a: { modifiedAt: number | null; displayPath: string },
  b: { modifiedAt: number | null; displayPath: string },
): number {
  const da = a.modifiedAt ?? -Infinity;
  const db = b.modifiedAt ?? -Infinity;
  if (da !== db) return db > da ? 1 : -1;
  return a.displayPath.localeCompare(b.displayPath);
}

export type SurveyDeps = {
  extractText(buffer: Buffer, fileName: string, mimeType: string): Promise<string>;
  /** Code d'une erreur d'extraction reconnue (document illisible), sinon null. */
  extractErrorCode(err: unknown): string | null;
};

export type Importable = {
  batchId: string;
  file: ImportFile;
  text: string;
  fingerprint: string;
  /** Plusieurs adresses dans le texte : le modèle tranchera. */
  emailAmbiguous: boolean;
  retention: { at: string; kind: VivierRetentionReferenceKind };
};

const EXTRACT_LABEL: Record<string, string> = {
  empty_text: 'aucun texte lisible (document scanné ?)',
  parse_failed: 'document illisible',
  unsupported_type: 'type de document non reconnu',
};

/** Lecture + extraction d'un fichier : parallélisable, NE DÉCIDE RIEN. */
export type SurveyRead =
  | { kind: 'text'; batchId: string; file: ImportFile; text: string }
  | { kind: 'done'; result: FileResult };

export async function readForSurvey(
  batchId: string,
  file: ImportFile,
  deps: SurveyDeps,
): Promise<SurveyRead> {
  const done = (outcome: Outcome, detail: string): SurveyRead => ({
    kind: 'done',
    result: { batchId, displayPath: file.displayPath, outcome, detail },
  });
  const loaded = await file.load();
  if (!Buffer.isBuffer(loaded)) return done('unreadable', loaded.error);
  try {
    // Le caractère NUL est refusé par Postgres dans une colonne texte
    // (« unsupported Unicode escape sequence ») : certains PDF en produisent.
    const text = (await deps.extractText(loaded, file.fileName, file.mimeType)).replace(/\u0000/gu, '');
    return { kind: 'text', batchId, file, text };
  } catch (err) {
    const code = deps.extractErrorCode(err);
    if (code === 'pdf_engine_unavailable' || code === null) {
      // Panne de l'OUTIL, pas défaut du document : échec à reprendre.
      return done('failed', `extraction indisponible (${code ?? 'erreur inattendue'})`);
    }
    return done('unreadable', EXTRACT_LABEL[code] ?? code);
  }
}

/**
 * Décision du constat sur un texte lu — SYNCHRONE : appelée dans l'ordre
 * `newestFirst`, c'est elle qui fait gagner la version la plus récente. Si
 * elle était prise à la fin de chaque extraction parallèle, le gagnant serait
 * le fichier le plus RAPIDE à lire.
 */
export function classifySurvey(
  read: Extract<SurveyRead, { kind: 'text' }>,
  dedup: DedupIndex,
  retentionFor: (fileName: string) => Importable['retention'],
): { result: FileResult; importable: Importable | null } {
  const { batchId, file, text } = read;
  const r = (outcome: Outcome, detail: string | null = null) => ({
    result: { batchId, displayPath: file.displayPath, outcome, detail },
    importable: null,
  });

  const fingerprint = cvTextFingerprint(text);
  if (!fingerprint) return r('unreadable', EXTRACT_LABEL.empty_text!);
  const fpSeen = dedup.claimFingerprint(fingerprint);
  if (fpSeen) return r('duplicate_fingerprint', `même CV ${DUP_LABEL[fpSeen]}`);

  const emails = extractEmailsFromText(text);
  if (emails.length === 0) return r('no_email', 'aucune adresse dans le texte du CV');
  if (emails.length === 1) {
    const seen = dedup.claimEmail(emails[0]!);
    if (seen) return r('duplicate_email', `même adresse ${DUP_LABEL[seen]}`);
  }
  const ambiguous = emails.length > 1;
  return {
    result: {
      batchId,
      displayPath: file.displayPath,
      outcome: 'importable',
      detail: ambiguous ? `${emails.length} adresses dans le texte — le modèle tranchera` : null,
    },
    importable: {
      batchId,
      file,
      text,
      fingerprint,
      emailAmbiguous: ambiguous,
      retention: retentionFor(file.fileName),
    },
  };
}

/** Lecture + décision d'un fichier isolé (régression, tests). */
export async function surveyFile(
  batchId: string,
  file: ImportFile,
  dedup: DedupIndex,
  retentionFor: (fileName: string) => Importable['retention'],
  deps: SurveyDeps,
): Promise<{ result: FileResult; importable: Importable | null }> {
  const read = await readForSurvey(batchId, file, deps);
  if (read.kind === 'done') return { result: read.result, importable: null };
  return classifySurvey(read, dedup, retentionFor);
}

export type ImportDeps = {
  identify(text: string, fileName: string): Promise<{
    isCv: boolean;
    fullName: string;
    email: string | null;
    phone: string | null;
  }>;
  /** Erreur d'identité PERMANENTE (sortie du modèle inexploitable). */
  isPermanentIdentityError(err: unknown): boolean;
  /** Crée le dossier (ligne + fichier). `duplicate_email` = course sur l'unicité. */
  createCandidate(input: {
    item: Importable;
    content: Buffer;
    email: string;
    fullName: string;
    phone: string | null;
  }): Promise<{ id: string } | 'duplicate_email'>;
  /** Indexation SYNCHRONE vérifiée (embedding du titre présent, bon espace). */
  index(candidateId: string): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export type Identity = Awaited<ReturnType<ImportDeps['identify']>>;

/** Identité par le modèle : parallélisable, NE DÉCIDE RIEN. */
export async function identifyImportable(
  item: Importable,
  deps: ImportDeps,
): Promise<{ identity: Identity } | { result: FileResult }> {
  try {
    return { identity: await deps.identify(item.text, item.file.fileName) };
  } catch (err) {
    const detail = deps.isPermanentIdentityError(err)
      ? 'identité illisible par le modèle'
      : `identité : ${errorText(err)}`;
    return { result: resultFor(item, 'failed', detail) };
  }
}

/**
 * Décision sur l'ADRESSE — SYNCHRONE, appelée dans l'ordre `newestFirst` : la
 * version la plus récente réserve l'adresse la première (l'empreinte est
 * réservée plus tôt, avant tout appel au modèle — cf. `importLot`). Rend le résultat
 * final, ou l'adresse retenue quand il faut écrire.
 */
export function decideImport(
  item: Importable,
  identified: { identity: Identity } | { result: FileResult },
  dedup: DedupIndex,
): FileResult | { email: string; identity: Identity } {
  if ('result' in identified) return identified.result;
  const { identity } = identified;
  if (!identity.isCv) return resultFor(item, 'not_a_cv', 'le modèle ne reconnaît pas un CV');
  if (!identity.email) return resultFor(item, 'no_email', 'aucune adresse retenue');
  const emailSeen = dedup.claimEmail(identity.email);
  if (emailSeen) return resultFor(item, 'duplicate_email', `même adresse ${DUP_LABEL[emailSeen]}`);
  return { email: identity.email, identity };
}

/** Écriture + indexation d'un dossier décidé : parallélisable. */
export async function writeImport(
  item: Importable,
  decided: { email: string; identity: Identity },
  deps: ImportDeps,
): Promise<FileResult> {
  const content = await item.file.load();
  if (!Buffer.isBuffer(content)) return resultFor(item, 'failed', content.error);
  let created;
  try {
    created = await deps.createCandidate({
      item,
      content,
      email: decided.email,
      fullName: decided.identity.fullName,
      phone: decided.identity.phone,
    });
  } catch (err) {
    return resultFor(item, 'failed', `écriture : ${errorText(err)}`);
  }
  if (created === 'duplicate_email') {
    return resultFor(item, 'duplicate_email', `même adresse ${DUP_LABEL.vivier}`);
  }
  const indexed = await deps.index(created.id);
  if (indexed.ok) return resultFor(item, 'imported');
  return resultFor(item, 'imported_not_indexed', indexed.reason);
}

/**
 * Un LOT d'import en trois temps : identités en parallèle, décisions dans
 * l'ordre du plus récent, écritures en parallèle. L'appelant passe les lots
 * dans l'ordre global `newestFirst` : une adresse réservée par un lot
 * précédent appartient donc toujours à une version plus récente.
 */
export async function importLot(
  lot: Importable[],
  dedup: DedupIndex,
  deps: ImportDeps,
  concurrency: number,
): Promise<FileResult[]> {
  const ordered = [...lot].sort((a, b) => newestFirst(a.file, b.file));
  // 1. Empreintes, AVANT tout appel payant — relues contre un index FRAIS (la
  //    base a pu bouger depuis le constat) : un doublon ne coûte rien.
  const fpDuplicates = ordered.map((item) => {
    const seen = dedup.claimFingerprint(item.fingerprint);
    return seen ? resultFor(item, 'duplicate_fingerprint', `même CV ${DUP_LABEL[seen]}`) : null;
  });
  const survivors = ordered.filter((_, i) => fpDuplicates[i] === null);
  // 2. Identités en parallèle ; 3. adresses décidées dans l'ordre ; 4. écritures.
  const identified = await mapBounded(survivors, concurrency, (item) => identifyImportable(item, deps));
  const decided = survivors.map((item, i) => decideImport(item, identified[i]!, dedup));
  const written = await mapBounded(
    survivors.map((item, i) => ({ item, d: decided[i]! })),
    concurrency,
    ({ item, d }) => ('outcome' in d ? Promise.resolve(d) : writeImport(item, d, deps)),
  );
  return [...fpDuplicates.filter((r): r is FileResult => r !== null), ...written];
}

/** Un fichier isolé, de bout en bout (tests, régression). */
export async function importFile(
  item: Importable,
  dedup: DedupIndex,
  deps: ImportDeps,
): Promise<FileResult> {
  return (await importLot([item], dedup, deps, 1))[0]!;
}

function resultFor(item: Importable, outcome: Outcome, detail: string | null = null): FileResult {
  return { batchId: item.batchId, displayPath: item.file.displayPath, outcome, detail };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Map à concurrence bornée, ordre des résultats = ordre d'entrée. */
export async function mapBounded<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
