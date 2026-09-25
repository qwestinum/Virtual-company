/**
 * Comparaison de modèles pour l'analyse des CV — HORS PRODUIT, dry-run pur.
 * Protocole : docs/ops/comparaison-modeles-scoring.md.
 *
 *   npm run compare:models -- --env=.env.local [--sample=N|all] [--noise=20]
 *        [--candidate-model=gpt-4o-mini] [--candidate-provider=openai]
 *        [--candidate-base-url=https://…] [--reference-model=gpt-4o]
 *        [--include=<id>,<id>] [--out=<répertoire>] [--concurrency=3]
 *        [--max-cost=6] [--yes] [--estimate-only]
 *
 * Trois bras, chacun dans SON processus (le modèle est lu une fois, au
 * chargement du fournisseur) :
 *   - référence  : gpt-4o REJOUÉ aujourd'hui sur tout l'échantillon ;
 *   - bruit      : un second rejeu gpt-4o sur `--noise` CV (le plancher) ;
 *   - candidat   : le modèle évalué, sur tout l'échantillon.
 * La valeur STOCKÉE en base n'est pas la référence : le scoring a changé
 * depuis une partie des analyses, la comparer mélangerait modèle et code.
 *
 * GARANTIES (tenues par `src/lib/model-comparison/__tests__/script-guard.test.ts`) :
 *   - aucune écriture en base : le script ne fait que lire (`select`,
 *     téléchargement du CV), n'importe aucun repo, aucun émetteur, aucun claim ;
 *   - l'analyse tourne EN MÉMOIRE par `analyzeCVApplication`, le même chemin
 *     que le produit — rien n'est persisté, aucun gate d'envoi n'est appelé ;
 *   - le modèle en service ne change pas : les réglages du bras sont posés
 *     dans l'environnement du SOUS-PROCESSUS seulement ;
 *   - la sortie (CV extraits, CSV, rapport, détails) va dans `--out`, qui ne
 *     peut pas être dans le dépôt : ce sont des dossiers de personnes réelles.
 */
import { spawn } from 'node:child_process';
import { hash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { childEnv, envMismatches, type ArmSettings } from '@/lib/model-comparison/arm-env';
import type { ArmFailureKind, ArmRecord, ArmVerdict, ReplayItem } from '@/lib/model-comparison/types';
import type { ScoringSheet } from '@/types/scoring';

// ─── Arguments ──────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const val = (flag: string): string | undefined => argv.find((a) => a.startsWith(`--${flag}=`))?.slice(flag.length + 3);
const has = (flag: string): boolean => argv.includes(`--${flag}`);

function fail(msg: string): never {
  console.error(`\n  ❌ ${msg}\n`);
  process.exit(1);
}

/** Même format que les autres scripts (purge RGPD, reindex) : le fichier écrase l'environnement. */
function loadEnvFile(path: string): void {
  let raw: string;
  try {
    raw = readFileSync(resolve(process.cwd(), path), 'utf8');
  } catch {
    fail(`Fichier d'environnement introuvable : ${path}`);
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/gu, '');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BRAS (sous-processus)
// ═══════════════════════════════════════════════════════════════════════════

async function runWorker(): Promise<void> {
  const settings: ArmSettings = {
    provider: (val('provider') as ArmSettings['provider']) ?? fail('--provider manquant'),
    model: val('model') ?? fail('--model manquant'),
    baseUrl: val('base-url') ?? null,
  };
  const arm = val('arm') ?? fail('--arm manquant');
  const itemsPath = val('items') ?? fail('--items manquant');
  const sheetsPath = val('sheets') ?? fail('--sheets manquant');
  const outputPath = val('output') ?? fail('--output manquant');
  const concurrency = Math.max(1, Number(val('concurrency') ?? 3));

  // ⚠️ AVANT tout import du fournisseur : il lit le modèle UNE fois, au
  // chargement. Si l'environnement ne dit pas exactement ce que ce bras
  // demande, on ne démarre pas — un bras qui tournerait en réalité sur un
  // autre modèle rendrait un « accord parfait ».
  const mismatches = envMismatches(settings, process.env);
  if (mismatches.length > 0) fail(`[${arm}] environnement différent des réglages demandés :\n    ${mismatches.join('\n    ')}`);

  const { analyzeCVApplication } = await import('@/lib/agents/server/cv-application-analyze');
  const { AIProviderError, AnalysisUnavailableError } = await import('@/lib/ai/errors');
  const { UnprovenNegativeVerdictError } = await import('@/lib/scoring/verdict-integrity');
  const { isSameModel, quoteFoundInCv } = await import('@/lib/model-comparison/compare');
  const sheets = JSON.parse(readFileSync(sheetsPath, 'utf8')) as Record<string, ScoringSheet>;

  const items = JSON.parse(readFileSync(itemsPath, 'utf8')) as ReplayItem[];
  const done = new Set<string>();
  if (existsSync(outputPath)) {
    for (const line of readFileSync(outputPath, 'utf8').split('\n')) {
      if (line.trim()) done.add((JSON.parse(line) as ArmRecord).analysisId);
    }
  }
  const todo = items.filter((i) => !done.has(i.analysisId));
  console.log(`[${arm}] ${settings.provider}/${settings.model} — ${todo.length} CV à analyser (${done.size} déjà faits)`);

  let aborted: string | null = null;
  let finished = 0;
  const classify = (err: unknown): ArmFailureKind => {
    if (err instanceof AnalysisUnavailableError) return 'analysis_unavailable';
    if (err instanceof UnprovenNegativeVerdictError) return 'unproven_negative';
    if (err instanceof AIProviderError) return 'transport';
    return 'other';
  };

  const one = async (item: ReplayItem): Promise<void> => {
    const started = Date.now();
    let record: ArmRecord;
    try {
      const out = await analyzeCVApplication({
        cvText: item.cvText,
        fileName: item.fileName,
        sheet: sheets[item.campaignId]!,
        source: 'email',
        receivedAt: item.receivedAt,
        computedAt: '2026-01-01T00:00:00.000Z',
        thresholdLow: item.thresholdLow,
        thresholdHigh: item.thresholdHigh,
      });
      const models = out.metrics.models ?? [];
      const wrong = models.find((m) => !isSameModel(settings.model, m));
      if (wrong) aborted = `modèle renvoyé « ${wrong} » ≠ modèle demandé « ${settings.model} »`;
      const sr = out.application.scoringResult;
      const knockoutIds = new Set(sr.breakdown.filter((b) => b.criticityLevel === 'redhibitoire').map((b) => b.criterionId));
      record = {
        ok: true,
        analysisId: item.analysisId,
        campaignId: item.campaignId,
        score: sr.totalScore,
        zone: sr.decisionZone ?? 'gray',
        verdicts: sr.breakdown.map<ArmVerdict>((b) => ({
          criterionId: b.criterionId,
          label: b.criterionLabel,
          level: b.criticityLevel,
          decision: b.llmDecision,
          quote: b.llmCVQuote,
          justification: b.llmJustification,
          quoteFound: quoteFoundInCv(b.llmCVQuote, item.cvText),
        })),
        knockoutsFailed: sr.hardFailures.filter((f) => knockoutIds.has(f.criterionId)).map((f) => f.criterionId),
        durationMs: Date.now() - started,
        promptTokens: out.metrics.promptTokens ?? 0,
        completionTokens: out.metrics.completionTokens ?? 0,
        costUsd: out.metrics.costEstimate,
        models,
        degradedPhases: (['candidate', 'ledger', 'narration'] as const).filter((k) => out.llmFailures[k]),
      };
    } catch (err) {
      record = {
        ok: false,
        analysisId: item.analysisId,
        campaignId: item.campaignId,
        kind: classify(err),
        // Le nom de la classe et un message borné : un message d'erreur de
        // validation peut citer la sortie du modèle, donc le CV.
        message: `${err instanceof Error ? err.name : 'Error'}${err instanceof AIProviderError ? ` (${err.code})` : ''}`,
        durationMs: Date.now() - started,
      };
    }
    appendFileSync(outputPath, `${JSON.stringify(record)}\n`);
    finished += 1;
    console.log(`[${arm}] ${finished}/${todo.length} ${record.ok ? `score ${record.score}` : `ÉCHEC ${record.kind}`}`);
  };

  const queue = [...todo];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let item = queue.shift(); item && !aborted; item = queue.shift()) await one(item);
    }),
  );
  if (aborted) fail(`[${arm}] ARRÊT : ${aborted}`);
  console.log(`[${arm}] terminé.`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESSUS PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

type AnalysisRow = { id: string; campaign_id: string | null; source: string; received_at: string };
type CampaignRow = { id: string; scoring_sheet: { criteria?: unknown[] } | null; threshold_low: number | null; threshold_high: number | null };

/** Où vit le CV d'origine d'une analyse (conventions de persistance du produit). */
function cvArtifactId(analysisId: string): string {
  return analysisId.startsWith('can_imap_') ? analysisId.replace('can_imap_', 'art_imap_cvfile_') : `art_cv_${analysisId}`;
}

async function readAll<T extends { id: string }>(db: SupabaseClient, table: string, columns: string): Promise<T[]> {
  const { fetchAllKeyset } = await import('@/lib/db/paginate');
  return fetchAllKeyset<T>({
    fetchPage: async (after, limit) => {
      let q = db.from(table).select(columns).order('id').limit(limit);
      if (after) q = q.gt('id', after);
      const { data, error } = await q;
      if (error) fail(`lecture ${table} : ${error.message}`);
      return (data ?? []) as unknown as T[];
    },
    cursorOf: (r) => r.id,
  });
}

async function downloadCv(db: SupabaseClient, artifactId: string): Promise<File | null> {
  const { data: meta } = await db.from('artifacts_meta').select('storage_bucket, storage_path, name, mime').eq('id', artifactId).maybeSingle();
  if (!meta?.storage_bucket || !meta.storage_path) return null;
  const { data, error } = await db.storage.from(meta.storage_bucket as string).download(meta.storage_path as string);
  if (error || !data) return null;
  const name = (meta.name as string) ?? 'cv.pdf';
  return new File([new Uint8Array(await data.arrayBuffer())], name, { type: (meta.mime as string) || 'application/pdf' });
}

/**
 * Ordre stable et sans biais apparent : l'empreinte de l'identifiant.
 * (`hash` en un appel plutôt que l'API incrémentale de `createHash` : la garde
 * structurelle refuse tout appel de mise à jour dans ce fichier, sans
 * exception à maintenir.)
 */
const stableOrder = (id: string) => hash('sha256', id);

async function runMain(): Promise<void> {
  const envPath = val('env') ?? fail("--env=<fichier> est obligatoire. Aucun repli : l'environnement visé se nomme, il ne se devine pas.");
  loadEnvFile(envPath);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) fail('Accès Supabase absent du fichier d’environnement.');
  const projectRef = new URL(url).hostname.split('.')[0] ?? url;

  const reference: ArmSettings = { provider: 'openai', model: val('reference-model') ?? 'gpt-4o', baseUrl: null };
  const candidate: ArmSettings = {
    provider: (val('candidate-provider') as ArmSettings['provider']) ?? 'openai',
    model: val('candidate-model') ?? 'gpt-4o-mini',
    baseUrl: val('candidate-base-url') ?? null,
  };
  if (!['openai', 'anthropic'].includes(candidate.provider)) fail('--candidate-provider : openai ou anthropic.');
  if (candidate.baseUrl && candidate.provider !== 'openai') fail('--candidate-base-url ne vaut que pour un point d’accès compatible OpenAI.');
  if (candidate.baseUrl) {
    const { resolveOpenAiEndpoint } = await import('@/lib/ai/openai-endpoint');
    const check = resolveOpenAiEndpoint({ ...process.env, OPENAI_BASE_URL: candidate.baseUrl });
    if (!check.ok) fail(check.reason);
  }

  const outDir = resolve(val('out') ?? join(tmpdir(), `compare-models-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  const rel = relative(process.cwd(), outDir);
  if (!rel.startsWith('..') && !isAbsolute(rel)) fail(`--out est DANS le dépôt (${outDir}) : ce sont des dossiers de personnes réelles, la sortie va ailleurs.`);
  mkdirSync(outDir, { recursive: true });

  const noiseN = Math.max(0, Number(val('noise') ?? 20));
  const sampleArg = val('sample') ?? 'all';
  const include = (val('include') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const concurrency = Math.max(1, Number(val('concurrency') ?? 3));
  const maxCost = Number(val('max-cost') ?? 6);

  console.log(`\n  Base visée : ${projectRef} (via ${envPath})`);
  console.log(`  Sortie     : ${outDir}\n`);

  // ── Rapport seul : on recalcule à partir des résultats déjà obtenus ──
  if (has('report-only')) {
    const itemsFile = join(outDir, 'items.json');
    if (!existsSync(itemsFile)) fail(`--report-only : aucun items.json dans ${outDir}.`);
    const saved = JSON.parse(readFileSync(itemsFile, 'utf8')) as ReplayItem[];
    const meta = JSON.parse(readFileSync(join(outDir, 'sample.json'), 'utf8')) as SampleMeta;
    await writeReport(outDir, projectRef, saved, meta, reference, candidate);
    return;
  }

  // ── Sélection (lecture seule) ──
  const db = createClient(url, key, { auth: { persistSession: false } });
  const [campaigns, analyses, artifacts] = await Promise.all([
    readAll<CampaignRow>(db, 'campaigns', 'id, scoring_sheet, threshold_low, threshold_high'),
    readAll<AnalysisRow>(db, 'candidate_analyses', 'id, campaign_id, source, received_at'),
    readAll<{ id: string }>(db, 'artifacts_meta', 'id'),
  ]);
  const campaignById = new Map(campaigns.map((c) => [c.id, c]));
  const artifactIds = new Set(artifacts.map((a) => a.id));

  const excluded: Record<string, number> = {};
  const exclude = (why: string) => (excluded[why] = (excluded[why] ?? 0) + 1);
  const eligible: AnalysisRow[] = [];
  for (const a of analyses) {
    // Zone FORCÉE par le recruteur à l'admission : pas une décision du modèle.
    if (a.source === 'sourcing') exclude('candidature sourcing (zone forcée, pas une décision du modèle)');
    else if (!a.campaign_id || !campaignById.get(a.campaign_id)?.scoring_sheet?.criteria?.length) exclude('campagne ou fiche de scoring absente');
    else if (!artifactIds.has(cvArtifactId(a.id))) exclude('CV d’origine non conservé');
    else eligible.push(a);
  }
  const missingSentinels = include.filter((id) => !eligible.some((a) => a.id === id));
  const ordered = [
    ...eligible.filter((a) => include.includes(a.id)),
    ...eligible.filter((a) => !include.includes(a.id)).sort((x, y) => stableOrder(x.id).localeCompare(stableOrder(y.id))),
  ];
  const wanted = sampleArg === 'all' ? ordered.length : Math.max(1, Number(sampleArg));

  const { extractCVText } = await import('@/lib/agents/cv-extract');
  const items: ReplayItem[] = [];
  const seenTexts = new Set<string>();
  for (const a of ordered) {
    if (items.length >= wanted) break;
    const file = await downloadCv(db, cvArtifactId(a.id));
    if (!file) {
      exclude('CV d’origine illisible dans le stockage');
      continue;
    }
    try {
      const x = await extractCVText(file);
      // Le même CV envoyé plusieurs fois sur la même campagne (fréquent en
      // recette) compterait plusieurs fois le même cas : on n'en garde qu'un.
      const fingerprint = `${a.campaign_id}:${hash('sha256', x.text)}`;
      if (seenTexts.has(fingerprint)) {
        exclude('même CV déjà dans l’échantillon (même campagne)');
        continue;
      }
      seenTexts.add(fingerprint);
      const camp = campaignById.get(a.campaign_id!)!;
      items.push({
        analysisId: a.id,
        campaignId: a.campaign_id!,
        cvText: x.text,
        fileName: x.fileName,
        receivedAt: a.received_at,
        thresholdLow: camp.threshold_low ?? 0,
        thresholdHigh: camp.threshold_high ?? 100,
      });
    } catch {
      exclude('texte du CV non extractible');
    }
  }
  if (items.length === 0) fail('Aucun CV rejouable dans cette base.');
  const sampleMeta: SampleMeta = {
    eligible: eligible.length,
    selected: items.length,
    excluded,
    sentinelsRequested: include.length,
    sentinelsFound: include.length - missingSentinels.length,
  };
  writeFileSync(join(outDir, 'sample.json'), JSON.stringify(sampleMeta));
  const noiseItems = items.slice(0, Math.min(noiseN, items.length));
  const sheets = Object.fromEntries([...new Set(items.map((i) => i.campaignId))].map((id) => [id, campaignById.get(id)!.scoring_sheet]));
  writeFileSync(join(outDir, 'items.json'), JSON.stringify(items));
  writeFileSync(join(outDir, 'noise-items.json'), JSON.stringify(noiseItems));
  writeFileSync(join(outDir, 'sheets.json'), JSON.stringify(sheets));

  // ── Estimation du coût, AVANT tout appel ──
  const { estimateCost, isKnownModel } = await import('@/lib/ai/pricing');
  // Quatre appels par CV (candidat, relevé, verdicts, narration) : le CV est
  // relu trois fois, la narration part du score. Ordre de grandeur, ±50 %.
  const estimate = (model: string, list: ReplayItem[]) =>
    list.reduce((sum, i) => sum + estimateCost(model, 3 * Math.ceil(i.cvText.length / 3.5) + 7000, 2500), 0);
  const plan = [
    { arm: 'reference', settings: reference, list: items },
    { arm: 'noise', settings: reference, list: noiseItems },
    { arm: 'candidate', settings: candidate, list: items },
  ].filter((p) => p.list.length > 0);
  let total = 0;
  console.log(`  Échantillon : ${items.length} CV (éligibles ${eligible.length}) · bruit : ${noiseItems.length}`);
  for (const [why, n] of Object.entries(excluded)) console.log(`    écartées — ${why} : ${n}`);
  if (include.length) console.log(`  Sentinelles : ${include.length - missingSentinels.length}/${include.length} trouvées`);
  console.log('\n  Coût estimé (ordre de grandeur, ±50 %) :');
  for (const p of plan) {
    const c = estimate(p.settings.model, p.list);
    total += c;
    const known = isKnownModel(p.settings.model) ? '' : '  ⚠ tarif inconnu : compté 0';
    console.log(`    ${p.arm.padEnd(10)} ${p.settings.model.padEnd(22)} ${String(p.list.length).padStart(4)} CV  ≈ ${c.toFixed(2)} $${known}`);
  }
  console.log(`    ${'TOTAL'.padEnd(10)} ${''.padEnd(22)} ${''.padStart(4)}     ≈ ${total.toFixed(2)} $\n`);
  if (total > maxCost) fail(`Estimation ${total.toFixed(2)} $ > plafond --max-cost=${maxCost} $.`);
  if (has('estimate-only')) return;
  if (!has('yes')) {
    const rl = createInterface({ input: stdin, output: stdout });
    const answer = await rl.question('  Lancer ? (oui/non) ');
    rl.close();
    if (answer.trim().toLowerCase() !== 'oui') fail('Abandon.');
  }

  // ── Les trois bras, chacun dans son processus ──
  const tsx = join(process.cwd(), 'node_modules', '.bin', 'tsx');
  const runArm = (arm: string, settings: ArmSettings, itemsFile: string) =>
    new Promise<void>((done, reject) => {
      const env = childEnv(process.env, settings) as NodeJS.ProcessEnv;
      const child = spawn(
        tsx,
        [
          'scripts/compare-models.ts', '--worker', `--arm=${arm}`, `--provider=${settings.provider}`, `--model=${settings.model}`,
          ...(settings.baseUrl ? [`--base-url=${settings.baseUrl}`] : []),
          `--items=${itemsFile}`, `--sheets=${join(outDir, 'sheets.json')}`, `--output=${join(outDir, `${arm}.jsonl`)}`, `--concurrency=${concurrency}`,
        ],
        { env, stdio: 'inherit' },
      );
      child.on('exit', (code) => (code === 0 ? done() : reject(new Error(`bras ${arm} : code ${code}`))));
    });
  await Promise.all(
    plan.map((p) => runArm(p.arm, p.settings, join(outDir, p.arm === 'noise' ? 'noise-items.json' : 'items.json'))),
  );

  await writeReport(outDir, projectRef, items, sampleMeta, reference, candidate);
}

type SampleMeta = { eligible: number; selected: number; excluded: Record<string, number>; sentinelsRequested: number; sentinelsFound: number };

async function writeReport(
  outDir: string,
  projectRef: string,
  items: ReplayItem[],
  sample: SampleMeta,
  reference: ArmSettings,
  candidate: ArmSettings,
): Promise<void> {
  const { quoteFoundInCv } = await import('@/lib/model-comparison/compare');
  const { computeOutcome, renderCsv, renderReport, summarizeArm } = await import('@/lib/model-comparison/report');
  // Seuls les CV de CET échantillon comptent (un répertoire repris peut porter
  // les résultats d'un essai autrement composé). Les citations sont REVÉRIFIÉES
  // ici avec la règle courante : un rapport recalculé suit le contrôle du jour.
  const textOf = new Map(items.map((i) => [i.analysisId, i.cvText]));
  const readArm = (arm: string): ArmRecord[] => {
    const f = join(outDir, `${arm}.jsonl`);
    if (!existsSync(f)) return [];
    const latest = new Map<string, ArmRecord>();
    for (const l of readFileSync(f, 'utf8').split('\n').filter(Boolean)) {
      const r = JSON.parse(l) as ArmRecord;
      const text = textOf.get(r.analysisId);
      if (text === undefined) continue;
      if (r.ok) r.verdicts = r.verdicts.map((v) => ({ ...v, quoteFound: quoteFoundInCv(v.quote, text) }));
      latest.set(r.analysisId, r);
    }
    return [...latest.values()];
  };
  const refRecords = readArm('reference');
  const noiseRecords = readArm('noise');
  const candRecords = readArm('candidate');
  const outcome = computeOutcome(refRecords, candRecords, noiseRecords.length ? noiseRecords : null);
  const report = renderReport({
    generatedAt: new Date().toISOString(),
    projectRef,
    sample,
    arms: [
      summarizeArm('référence', { provider: reference.provider, requestedModel: reference.model, baseUrl: null }, refRecords),
      summarizeArm('bruit', { provider: reference.provider, requestedModel: reference.model, baseUrl: null }, noiseRecords),
      summarizeArm('candidat', { provider: candidate.provider, requestedModel: candidate.model, baseUrl: candidate.baseUrl }, candRecords),
    ],
    outcome,
    candidateLabel: candidate.model,
  });
  writeFileSync(join(outDir, 'rapport.md'), report);
  writeFileSync(join(outDir, 'comparison.csv'), renderCsv(outcome.candidate.pairs, refRecords, candRecords));
  // Pour la relecture à la main : les deux verdicts côte à côte, AVEC citations
  // et justifications. Données personnelles — ne quitte pas ce répertoire.
  const byId = (rs: ArmRecord[]) => new Map(rs.map((r) => [r.analysisId, r]));
  const refMap = byId(refRecords);
  const candMap = byId(candRecords);
  writeFileSync(
    join(outDir, 'details.json'),
    JSON.stringify(
      outcome.candidate.pairs.filter((p) => p.disagreeingCriteria.length > 0 || !p.zoneSame || p.quotesInvalid > 0).map((p) => ({
        analysisId: p.analysisId,
        reference: refMap.get(p.analysisId),
        candidate: candMap.get(p.analysisId),
      })),
      null,
      2,
    ),
  );
  console.log(`\n  Verdict proposé : ${outcome.verdict.acceptable ? 'ACCEPTABLE' : 'REFUSÉ'}`);
  for (const c of outcome.verdict.checks) console.log(`    ${c.passed ? '✅' : '❌'} (${c.id}) ${c.detail}`);
  console.log(`\n  Rapport : ${join(outDir, 'rapport.md')}\n  CSV     : ${join(outDir, 'comparison.csv')}\n  Détails : ${join(outDir, 'details.json')} (données personnelles)\n`);
}

(has('worker') ? runWorker() : runMain()).catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
  process.exit(1);
});
