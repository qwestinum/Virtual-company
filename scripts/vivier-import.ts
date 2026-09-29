/**
 * Import INITIAL du vivier depuis un fonds de CV (dossier et/ou archives .zip).
 *
 *   npm run vivier:import -- --env=<fichier> --dir=<dossier> [--dates=<csv>]
 *   npm run vivier:import -- --env=<fichier> --zip=a.zip --zip=b.zip
 *   npm run vivier:import -- … --execute --confirm-project=<ref>
 *
 * CONSTAT PAR DÉFAUT : sans `--execute`, rien ne s'écrit et aucun modèle n'est
 * appelé — lecture, extraction, empreinte, adresse repérée, coût estimé.
 * `--execute` refait ce constat, affiche le coût, puis écrit.
 *
 * Ce que l'import fait : il ALIMENTE le vivier, et rien d'autre. Aucun mail,
 * aucune analyse de campagne, aucune présélection (garde structurelle :
 * `src/lib/vivier/import/__tests__/no-side-effects.test.ts`). Un doublon (même
 * CV ou même adresse) est listé, jamais réinséré ni mis à jour.
 *
 * Procédure et prérequis : docs/ops/configuration-client.md (« Import initial
 * du vivier »). Le détail par fichier (noms) va dans `--report-dir`, ignoré par
 * git ; le rapport (`rapport.md`) ne contient que des nombres.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { ImportDeps, Importable, FileResult } from '@/lib/vivier/import/pipeline';
import type { SourceBatch } from '@/lib/vivier/import/sources';

function fail(message: string): never {
  console.error(`[vivier-import] ${message}`);
  process.exit(1);
}

/** Même format de fichier d'environnement que la purge et la réindexation. */
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    fail(`Fichier d'environnement introuvable : ${path}`);
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u);
    if (!m) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/gu, '');
  }
}

function projectRef(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.match(/^([^.]+)\.supabase\./u)?.[1] ?? host;
  } catch {
    return url;
  }
}

function runIdNow(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `vimp-${stamp}`;
}

async function main(): Promise<void> {
  const { parseImportArgs, USAGE, LOT_SIZE } = await import('@/lib/vivier/import/options');
  const parsed = parseImportArgs(process.argv.slice(2));
  if ('error' in parsed) fail(`${parsed.error}\n${USAGE}`);
  const opts = parsed;

  // L'environnement AVANT tout module qui le lit.
  loadEnvFile(opts.envPath);
  const ref = projectRef(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  if (!ref) fail(`NEXT_PUBLIC_SUPABASE_URL absent de ${opts.envPath}.`);
  if (opts.execute && opts.confirmProject!.trim() !== ref) {
    fail(`--confirm-project="${opts.confirmProject}" ≠ projet visé « ${ref} » — écriture refusée.`);
  }

  const { parseDatesCsv, datesKey } = await import('@/lib/vivier/import/dates-csv');
  const { collectSources } = await import('@/lib/vivier/import/sources');
  const { DedupIndex, readForSurvey, classifySurvey, newestFirst, importLot, mapBounded } = await import(
    '@/lib/vivier/import/pipeline'
  );
  const { estimateImportCost, formatUsd } = await import('@/lib/vivier/import/cost');
  const { tally, batchJournalPayload, renderSummary, renderDetail } = await import('@/lib/vivier/import/report');
  const { withRateLimitRetry, isRateLimit, isQuotaExhausted, backoffMs, sleep, errMsg } = await import(
    '@/lib/vivier/import/rate-limit'
  );
  const { cvTextFingerprint } = await import('@/lib/vivier/import/fingerprint');
  const { extractCVText, CVExtractError } = await import('@/lib/agents/cv-extract');
  const { onAIUsage } = await import('@/lib/ai/usage-observer');
  const repo = await import('@/lib/db/repos/vivier');

  const startedAt = new Date();
  const runId = runIdNow(startedAt);
  const chatModel =
    (process.env.CV_ANALYZER_PROVIDER ?? 'openai').trim().toLowerCase() === 'anthropic'
      ? process.env.ANTHROPIC_CHAT_MODEL?.trim() || 'claude-sonnet-4-6'
      : process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini';
  const embeddingModel = process.env.OPENAI_EMBEDDING_MODEL?.trim() || 'text-embedding-3-small';
  const expectedSpace = `${(process.env.EMBEDDING_PROVIDER ?? 'openai').trim().toLowerCase()}|${embeddingModel}`;

  console.log('\nIMPORT INITIAL DU VIVIER');
  console.log(`  Projet visé : ${ref} (via ${opts.envPath})`);
  console.log(`  Mode        : ${opts.execute ? 'EXÉCUTION — écriture' : 'CONSTAT — aucune écriture, aucun appel au modèle'}`);
  console.log(`  Exécution   : ${runId}`);

  // ── Dates de candidature (erreur = arrêt, avant tout) ─────────────────────
  let dates = new Map<string, string>();
  if (opts.datesPath) {
    let content: string;
    try {
      content = await readFile(opts.datesPath, 'utf8');
    } catch {
      fail(`Fichier de dates illisible : ${opts.datesPath}`);
    }
    const r = parseDatesCsv(content, startedAt);
    if (r.errors.length > 0) {
      fail(`Fichier de dates refusé (${r.errors.length} ligne(s)) — rien n'a été fait :\n  ${r.errors.join('\n  ')}`);
    }
    dates = r.dates;
    console.log(`  Dates       : ${dates.size} date(s) de candidature lue(s)`);
  }
  const importDay = startedAt.toISOString();
  const retentionFor = (fileName: string): Importable['retention'] => {
    const d = dates.get(datesKey(fileName));
    return d
      ? { at: `${d}T00:00:00.000Z`, kind: 'application_date' }
      : { at: importDay, kind: 'import_date' };
  };
  const provenance = `import initial du ${startedAt.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}, fonds du cabinet`;

  // ── Pré-vol : espace d'embedding homogène ────────────────────────────────
  const spaces = await repo.listDistinctEmbeddingModels().catch((err: unknown) =>
    fail(`Pré-vol impossible (lecture du vivier) : ${errMsg(err)}`),
  );
  const divergent = spaces.filter((s) => s !== expectedSpace);
  if (divergent.length > 0) {
    fail(
      `Le vivier contient l'espace d'embedding « ${divergent.join(', ')} » ≠ « ${expectedSpace} ». ` +
        `Importer mélangerait des espaces incomparables. Aligner OPENAI_EMBEDDING_MODEL ou réindexer d'abord.`,
    );
  }

  // ── Sources ───────────────────────────────────────────────────────────────
  const batches: SourceBatch[] = await collectSources({ runId, dir: opts.dir, zips: opts.zips }).catch(
    (err: unknown) => fail(`Source illisible : ${errMsg(err)}`),
  );
  const totalFiles = batches.reduce((n, b) => n + b.files.length, 0);
  console.log(`  Sources     : ${batches.length} lot(s), ${totalFiles} CV candidat(s) (PDF/DOCX)`);

  const fingerprintOfLegacy = (text: string | null) => (text ? cvTextFingerprint(text) : null);
  const loadDedup = async () => {
    const rows = await repo.listVivierDedupIndex();
    return new DedupIndex(
      rows.map((r) => ({ email: r.email, cvFingerprint: r.cvFingerprint ?? fingerprintOfLegacy(r.cvText) })),
    );
  };

  // ── 1. CONSTAT ────────────────────────────────────────────────────────────
  const surveyDedup = await loadDedup().catch((err: unknown) => fail(`Lecture du vivier : ${errMsg(err)}`));
  const surveyed: FileResult[] = [];
  const importables: Importable[] = [];
  // Lecture en parallèle (aucune décision), PUIS décision dans l'ordre du plus
  // récent : entre deux versions d'un même CV ou d'un même candidat, c'est la
  // plus récente qui est gardée — pas la plus rapide à lire.
  let done = 0;
  const everyFile = batches.flatMap((b) => b.files.map((file) => ({ batchId: b.batchId, file })));
  const reads = await mapBounded(everyFile, 4, async ({ batchId, file }) => {
    const r = await readForSurvey(batchId, file, {
      extractText: async (buffer, fileName, mimeType) =>
        (await extractCVText(new File([new Uint8Array(buffer)], fileName, { type: mimeType }))).text,
      extractErrorCode: (err) => (err instanceof CVExtractError ? err.code : null),
    });
    done++;
    if (done % 100 === 0) console.log(`  constat… ${done}/${totalFiles}`);
    return r;
  });
  const texts = reads.filter((r) => r.kind === 'text');
  for (const r of reads) if (r.kind === 'done') surveyed.push(r.result);
  texts.sort((a, b) => newestFirst(a.file, b.file));
  for (const read of texts) {
    const o = classifySurvey(read, surveyDedup, retentionFor);
    surveyed.push(o.result);
    if (o.importable) importables.push(o.importable);
  }
  const estimate = estimateImportCost({
    textLengths: importables.map((i) => i.text.length),
    chatModel,
    embeddingModel,
  });
  const ignored = batches.flatMap((b) => b.ignored);
  const unreadableArchives = batches
    .filter((b) => b.unreadable)
    .map((b) => ({ label: b.label, reason: b.unreadable! }));
  const surveyCounts = tally(surveyed, ignored.length, unreadableArchives.length);
  console.log('\nCONSTAT');
  console.log(`  importables          : ${surveyCounts.importable}` +
    (importables.some((i) => i.emailAmbiguous)
      ? ` (dont ${importables.filter((i) => i.emailAmbiguous).length} à adresses multiples, tranchées à l'exécution)`
      : ''));
  console.log(`  doublons             : ${surveyCounts.duplicate_fingerprint} même CV · ${surveyCounts.duplicate_email} même adresse`);
  console.log(`  sans adresse         : ${surveyCounts.no_email}`);
  console.log(`  illisibles           : ${surveyCounts.unreadable}`);
  console.log(`  échecs techniques    : ${surveyCounts.failed}`);
  console.log(`  ignorés (format)     : ${surveyCounts.ignored} · archives illisibles : ${surveyCounts.unreadableArchives}`);
  console.log(
    `  coût estimé          : ${formatUsd(estimate.usd)} (fourchette ${formatUsd(estimate.usdLow)} – ${formatUsd(estimate.usdHigh)}) ` +
      `— ${chatModel} + ${embeddingModel}${estimate.pricingKnown ? '' : ' ⚠ tarif inconnu pour un modèle : estimation incomplète'}`,
  );
  console.log("  (les documents qui ne sont pas des CV ne se reconnaissent qu'à l'exécution)");

  // ── 2. ÉCRITURE ───────────────────────────────────────────────────────────
  const written: FileResult[] = [];
  let actualUsd: number | null = null;
  let spentUsd = 0;
  let interrupted = false;
  let quotaExhausted = false;
  const journalFailures: string[] = [];
  if (opts.execute) {
    const { extractCandidateIdentity } = await import('@/lib/agents/candidate-identity');
    const { AIValidationError } = await import('@/lib/ai/errors');
    const { indexVivierCandidate } = await import('@/lib/vivier/indexing');
    const { createImportedCandidate } = await import('@/lib/vivier/import/write');
    const { appendJournalEntry } = await import('@/lib/db/repos/journal');

    const stopUsage = onAIUsage((e) => {
      spentUsd += e.costEstimate;
    });
    process.on('SIGINT', () => {
      if (interrupted) process.exit(130);
      interrupted = true;
      console.log('\n[vivier-import] Arrêt demandé — fin du lot en cours, puis sortie. Relancer reprend (même empreinte = sauté).');
    });

    const say = (label: string) => (ms: number, attempt: number) =>
      console.log(`    ⏳ ${label} : limite de débit (essai ${attempt}/${opts.maxRetries}) — pause ${Math.round(ms / 1000)} s`);

    const deps: ImportDeps = {
      identify: (text, fileName) =>
        withRateLimitRetry(opts.maxRetries, () => extractCandidateIdentity(text, fileName), say('identité')),
      isPermanentIdentityError: (err) => err instanceof AIValidationError,
      createCandidate: ({ item, content, email, fullName, phone }) =>
        createImportedCandidate({
          email,
          fullName,
          phone,
          fileName: item.file.fileName,
          mimeType: item.file.mimeType,
          content,
          text: item.text,
          fingerprint: item.fingerprint,
          provenance,
          retention: item.retention,
        }),
      index: async (candidateId) => {
        let last = 'indexation : inconnu';
        for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
          const idx = await indexVivierCandidate(candidateId);
          if (idx.status === 'indexed') {
            const meta = await repo.getVivierEmbeddingMeta(candidateId);
            if (meta) {
              const space = `${meta.provider}|${meta.model}`;
              if (space === expectedSpace) return { ok: true };
              const reason = `embedding dans l'espace ${space}`;
              await repo.setVivierIndexingStatus(candidateId, 'failed', reason).catch(() => {});
              return { ok: false, reason };
            }
            last = 'embedding du titre absent';
          } else {
            last = `indexation : ${idx.error ?? 'inconnu'}`;
            if (!isRateLimit(idx.error)) return { ok: false, reason: last };
          }
          if (attempt <= opts.maxRetries) await sleep(backoffMs(last, attempt));
        }
        // L'indexation peut écrire `indexed` sans embedding du titre (BACKLOG,
        // « faux indexé couche 2 ») : sur un dossier qu'on vient de créer, on
        // pose `failed`, sinon `reindex:vivier --only-failed` ne le verrait pas.
        await repo.setVivierIndexingStatus(candidateId, 'failed', last).catch(() => {});
        return { ok: false, reason: last };
      },
    };

    const writeDedup = await loadDedup(); // index FRAIS : la base a pu bouger
    console.log(`\nÉCRITURE — ${importables.length} dossier(s), lots de ${LOT_SIZE}, ${opts.concurrency} en parallèle`);
    // Lots pris dans l'ordre GLOBAL du plus récent (les `importables` le sont
    // déjà) : une adresse réservée par un lot précédent appartient toujours à
    // une version plus récente.
    for (let i = 0; i < importables.length && !interrupted; i += LOT_SIZE) {
      const lot = importables.slice(i, i + LOT_SIZE);
      const lotResults = await importLot(lot, writeDedup, deps, opts.concurrency);
      written.push(...lotResults);
      if (lotResults.some((r) => isQuotaExhausted(r.detail))) {
        // Plus de crédit : les lots suivants échoueraient tous. On s'arrête,
        // journal et rapport compris ; la relance reprendra (empreintes).
        quotaExhausted = true;
        interrupted = true;
        console.error('\n[vivier-import] Compte du fournisseur de modèle SANS CRÉDIT — arrêt après ce lot.');
      }
      const c = tally(written, 0, 0);
      console.log(
        `  ${written.length}/${importables.length} — ${c.imported} importés, ` +
          `${c.duplicate_email + c.duplicate_fingerprint} doublons, ${c.failed} échecs · coût ${formatUsd(spentUsd)}`,
      );
    }
    // Une entrée de journal par LOT (archive ou dossier) — des nombres et
    // l'identifiant opaque, jamais un nom.
    for (const batch of batches) {
      const expected = importables.filter((it) => it.batchId === batch.batchId).length;
      const results = written.filter((r) => r.batchId === batch.batchId);
      const batchSurvey = surveyed.filter((r) => r.batchId === batch.batchId && r.outcome !== 'importable');
      const counts = tally([...batchSurvey, ...results], batch.ignored.length, batch.unreadable ? 1 : 0);
      await appendJournalEntry({
        action: 'vivier_import_batch',
        actor: 'vivier_import',
        payload: batchJournalPayload(batch.batchId, runId, counts, results.length < expected),
      }).catch((err: unknown) => journalFailures.push(`${batch.batchId} : ${errMsg(err)}`));
    }
    stopUsage();
    actualUsd = spentUsd;
  }

  for (const b of batches) await b.close();

  // ── Rapports ─────────────────────────────────────────────────────────────
  const finalResults = opts.execute
    ? [...surveyed.filter((r) => r.outcome !== 'importable'), ...written]
    : surveyed;
  const counts = tally(finalResults, ignored.length, unreadableArchives.length);
  if (opts.execute && interrupted) {
    counts.importable = importables.length - written.length; // restés à faire
  }
  const summary = renderSummary(counts, {
    runId,
    execute: opts.execute,
    projectRef: ref,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    batches: batches.length,
    withDates: dates.size > 0,
    estimatedUsd: { low: estimate.usdLow, mid: estimate.usd, high: estimate.usdHigh },
    actualUsd,
    interrupted,
  });
  const outDir = join(opts.reportDir, runId);
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await writeFile(join(outDir, 'rapport.md'), summary, 'utf8');
  await writeFile(join(outDir, 'detail.md'), renderDetail(finalResults, ignored, unreadableArchives), {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log(`\n${summary}`);
  console.log(`Rapport (nombres seuls) : ${join(outDir, 'rapport.md')}`);
  console.log(`Détail par fichier (NOMS — ne pas commiter) : ${join(outDir, 'detail.md')}`);
  if (journalFailures.length > 0) {
    console.error(`⚠ Journal non écrit pour ${journalFailures.length} lot(s) :\n  ${journalFailures.join('\n  ')}`);
  }
  if (quotaExhausted) {
    console.error(
      '⚠ Arrêté faute de crédit chez le fournisseur de modèle. Recharger, puis :\n' +
        `  1. npm run reindex:vivier -- --env=${opts.envPath} --only-failed --confirm-project=${ref}\n` +
        '  2. relancer cette même commande (les fichiers déjà importés sont sautés).',
    );
  }
  if (!opts.execute) {
    console.log(`\nPour écrire : ajouter --execute --confirm-project=${ref}`);
  }
  if (counts.failed > 0 || counts.imported_not_indexed > 0 || journalFailures.length > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  console.error('[vivier-import] échec inattendu :', err);
  process.exitCode = 1;
});
