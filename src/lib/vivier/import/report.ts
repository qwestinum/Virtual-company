/**
 * Rapports de l'import initial — PUR.
 *
 * DEUX documents, et la frontière entre eux est STRUCTURELLE :
 *   · le RAPPORT (`renderSummary`) ne reçoit QUE des nombres et des
 *     métadonnées d'exécution — aucun champ où déposer un nom de fichier, et
 *     un nom de fichier est souvent un nom de personne. C'est celui qu'on peut
 *     commiter ou transmettre au client ;
 *   · le DÉTAIL (`renderDetail`) liste chaque fichier avec sa raison. Il reste
 *     sur le poste de l'opérateur (dossier ignoré par git).
 */

import type { FileResult, Outcome } from './pipeline';
import type { IgnoredFile } from './sources';

export type ImportCounts = Record<Outcome, number> & {
  /** Fichiers hors format (extension, système, archive imbriquée). */
  ignored: number;
  /** Archives illisibles dans leur ensemble. */
  unreadableArchives: number;
};

export function emptyCounts(): ImportCounts {
  return {
    importable: 0,
    imported: 0,
    imported_not_indexed: 0,
    duplicate_fingerprint: 0,
    duplicate_email: 0,
    unreadable: 0,
    no_email: 0,
    not_a_cv: 0,
    failed: 0,
    ignored: 0,
    unreadableArchives: 0,
  };
}

export function tally(
  results: FileResult[],
  ignored: number,
  unreadableArchives: number,
): ImportCounts {
  const c = emptyCounts();
  for (const r of results) c[r.outcome]++;
  c.ignored = ignored;
  c.unreadableArchives = unreadableArchives;
  return c;
}

/** Charge du journal `vivier_import_batch` — des nombres et l'identifiant opaque. */
export function batchJournalPayload(
  batchId: string,
  runId: string,
  counts: ImportCounts,
  interrupted: boolean,
): Record<string, number | string | boolean> {
  return {
    batchId,
    runId,
    count: counts.imported + counts.imported_not_indexed,
    duplicates: counts.duplicate_fingerprint + counts.duplicate_email,
    skipped:
      counts.ignored + counts.unreadable + counts.no_email + counts.not_a_cv + counts.unreadableArchives,
    failed: counts.failed,
    notIndexed: counts.imported_not_indexed,
    interrupted,
  };
}

export type SummaryMeta = {
  runId: string;
  execute: boolean;
  projectRef: string;
  startedAt: string;
  durationMs: number;
  batches: number;
  withDates: boolean;
  estimatedUsd: { low: number; mid: number; high: number } | null;
  actualUsd: number | null;
  interrupted: boolean;
};

const LINES: [keyof ImportCounts, string][] = [
  ['imported', 'importés et indexés'],
  ['imported_not_indexed', 'importés, indexation à reprendre'],
  ['importable', 'importables (constat)'],
  ['duplicate_fingerprint', 'doublons — même CV'],
  ['duplicate_email', 'doublons — même adresse'],
  ['no_email', 'sans adresse'],
  ['not_a_cv', 'non reconnus comme CV'],
  ['unreadable', 'illisibles'],
  ['failed', 'échecs techniques (relancer)'],
  ['ignored', 'fichiers ignorés (format)'],
  ['unreadableArchives', 'archives illisibles'],
];

export function renderSummary(counts: ImportCounts, meta: SummaryMeta): string {
  const usd = (v: number) => `${v.toFixed(2)} $`;
  const out = [
    `# Import initial du vivier — ${meta.execute ? 'exécution' : 'constat (aucune écriture)'}`,
    '',
    `- Exécution : \`${meta.runId}\` · projet \`${meta.projectRef}\``,
    `- Début : ${meta.startedAt} · durée : ${Math.round(meta.durationMs / 1000)} s`,
    `- Lots : ${meta.batches}${meta.interrupted ? ' · **interrompu** (relancer reprend là où il s’est arrêté)' : ''}`,
    `- Date de référence de rétention : ${meta.withDates ? 'date de candidature du fichier de dates, sinon date d’import' : 'date d’import pour tous'}`,
  ];
  if (meta.estimatedUsd) {
    out.push(
      `- Coût estimé : ${usd(meta.estimatedUsd.mid)} (fourchette ${usd(meta.estimatedUsd.low)} – ${usd(meta.estimatedUsd.high)})`,
    );
  }
  if (meta.actualUsd !== null) out.push(`- Coût réel mesuré : ${usd(meta.actualUsd)}`);
  out.push('', '| Catégorie | Fichiers |', '|---|---:|');
  for (const [key, label] of LINES) {
    if (counts[key] > 0) out.push(`| ${label} | ${counts[key]} |`);
  }
  out.push(
    '',
    'Le détail par fichier (noms de fichiers, raisons) reste sur le poste de l’opérateur.',
    '',
  );
  return out.join('\n');
}

export function renderDetail(
  results: FileResult[],
  ignored: IgnoredFile[],
  unreadableArchives: { label: string; reason: string }[],
): string {
  const out = ['# Détail de l’import — DONNÉES PERSONNELLES, ne pas commiter', ''];
  if (unreadableArchives.length > 0) {
    out.push('## Archives illisibles', '');
    for (const a of unreadableArchives) out.push(`- ${a.label} — ${a.reason}`);
    out.push('');
  }
  if (ignored.length > 0) {
    out.push('## Fichiers ignorés', '');
    for (const f of ignored) out.push(`- ${f.displayPath} — ${f.reason}`);
    out.push('');
  }
  const byOutcome = new Map<Outcome, FileResult[]>();
  for (const r of results) byOutcome.set(r.outcome, [...(byOutcome.get(r.outcome) ?? []), r]);
  for (const [key, label] of LINES) {
    const list = byOutcome.get(key as Outcome);
    if (!list?.length) continue;
    out.push(`## ${label} (${list.length})`, '');
    for (const r of list) out.push(`- ${r.displayPath}${r.detail ? ` — ${r.detail}` : ''}`);
    out.push('');
  }
  return out.join('\n');
}
