/**
 * Bench reproductible du CV Analyzer — isole la variable « modèle ».
 *
 * Lance N analyses séquentielles par CV via le provider configuré
 * (CV_ANALYZER_PROVIDER), écrit un JSON structuré (score / statut / décisions /
 * citations par CV × essai) et affiche un récap (variance de score, stabilité
 * des décisions par critère). AUCUNE modification du prompt ni du scoreur :
 * seul le modèle change entre deux runs.
 *
 * Usage :
 *   CV_ANALYZER_PROVIDER=openai    npm run bench:cv -- cv1.pdf cv2.pdf --runs=5
 *   CV_ANALYZER_PROVIDER=anthropic npm run bench:cv -- cv1.pdf cv2.pdf --runs=5
 *
 * Options :
 *   --runs=N            essais par CV (défaut 3)
 *   --sheet=<chemin>    fiche de scoring (JSON ScoringSheet). À défaut, une
 *                       fiche de DÉMO est utilisée (résultats non significatifs).
 *   --out=<chemin>      fichier JSON de sortie (défaut bench-cv-<provider>-<ts>.json)
 *
 * Pré-requis : .env.local renseigné (OPENAI_API_KEY, ou ANTHROPIC_API_KEY +
 * CV_ANALYZER_PROVIDER=anthropic). CV acceptés : .txt / .md / .pdf.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

import { loadEnvConfig } from '@next/env';

import type { ScoringSheet } from '@/types/scoring';

type RunResult = {
  run: number;
  score: number;
  status: string;
  durationMs: number;
  tokensUsed: number;
  costEstimate: number;
  llmFailures: { candidate: boolean; ledger: boolean; verdicts: boolean; narration: boolean };
  decisions: Array<{
    criterionId: string;
    label: string;
    decision: string;
    quote: string;
    justification: string;
  }>;
};

type CvResult = {
  cvPath: string;
  fileName: string;
  error?: string;
  runs: RunResult[];
};

function mimeForExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'application/pdf';
    case '.md':
      return 'text/markdown';
    case '.txt':
    default:
      return 'text/plain';
  }
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance);
}

function parseArgs(argv: string[]): {
  paths: string[];
  runs: number;
  sheetPath?: string;
  outPath?: string;
} {
  const paths: string[] = [];
  let runs = 3;
  let sheetPath: string | undefined;
  let outPath: string | undefined;
  for (const a of argv) {
    if (a.startsWith('--runs=')) {
      const n = Number.parseInt(a.slice('--runs='.length), 10);
      runs = Number.isFinite(n) && n > 0 ? n : 3;
    } else if (a.startsWith('--sheet=')) {
      sheetPath = a.slice('--sheet='.length);
    } else if (a.startsWith('--out=')) {
      outPath = a.slice('--out='.length);
    } else if (a.startsWith('--')) {
      console.warn(`[bench] flag ignoré : ${a}`);
    } else {
      paths.push(a);
    }
  }
  return { paths, runs, sheetPath, outPath };
}

async function main(): Promise<void> {
  // Charger .env.local AVANT d'importer la chaîne provider (qui lit l'env à
  // l'import pour le modèle par défaut). D'où les imports dynamiques ci-dessous.
  loadEnvConfig(process.cwd());

  const { paths, runs, sheetPath, outPath } = parseArgs(process.argv.slice(2));

  if (paths.length === 0) {
    console.error(
      'Usage : CV_ANALYZER_PROVIDER=openai|anthropic npm run bench:cv -- <cv1> [cv2 …] [--runs=N] [--sheet=fiche.json] [--out=res.json]',
    );
    process.exitCode = 1;
    return;
  }

  const provider = (process.env.CV_ANALYZER_PROVIDER ?? 'openai')
    .trim()
    .toLowerCase();
  const model =
    provider === 'anthropic'
      ? process.env.ANTHROPIC_CHAT_MODEL?.trim() || 'claude-sonnet-4-6'
      : process.env.OPENAI_CHAT_MODEL?.trim() || 'gpt-4o-mini';

  const { extractCVText, CVExtractError } = await import('@/lib/agents/cv-extract');
  const { analyzeCVApplication } = await import(
    '@/lib/agents/server/cv-application-analyze'
  );
  const { ScoringSheetSchema, buildCriterion } = await import('@/types/scoring');

  // Fiche de scoring : fournie (--sheet) ou démo.
  let sheet: ScoringSheet;
  if (sheetPath) {
    sheet = ScoringSheetSchema.parse(JSON.parse(readFileSync(sheetPath, 'utf-8')));
  } else {
    console.warn(
      '[bench] ⚠️ Aucune --sheet fournie : fiche de DÉMO utilisée (scores NON significatifs). Passe --sheet=fiche.json pour un vrai bench.',
    );
    sheet = {
      campaignId: 'BENCH',
      isValidated: true,
      acceptanceThreshold: 70,
      criteria: [
        buildCriterion({ id: 'c1', label: 'Diplôme Bac+5 en informatique', level: 'redhibitoire' }),
        buildCriterion({ id: 'c2', label: 'Maîtrise de Python', level: 'critique', weight: 8 }),
        buildCriterion({ id: 'c3', label: 'Expérience en data engineering (pipelines de données)', level: 'important', weight: 5 }),
        buildCriterion({ id: 'c4', label: 'Capacité à travailler en équipe dans un environnement agile', level: 'important', weight: 4 }),
      ],
    };
  }

  console.log(
    `[bench] provider=${provider} model=${model} runs=${runs} cvs=${paths.length} critères=${sheet.criteria.length}`,
  );

  const results: CvResult[] = [];

  for (const cvPath of paths) {
    const fileName = basename(cvPath);
    const cvResult: CvResult = { cvPath, fileName, runs: [] };
    results.push(cvResult);

    let cvText: string;
    try {
      const buffer = readFileSync(cvPath);
      const file = new File([buffer], fileName, { type: mimeForExt(extname(cvPath)) });
      const extracted = await extractCVText(file);
      cvText = extracted.text;
    } catch (err) {
      cvResult.error =
        err instanceof CVExtractError
          ? `${err.code}: ${err.message}`
          : err instanceof Error
            ? err.message
            : String(err);
      console.error(`[bench] ${fileName} : extraction échouée — ${cvResult.error}`);
      continue;
    }

    for (let run = 1; run <= runs; run++) {
      process.stdout.write(`[bench] ${fileName} run ${run}/${runs}… `);
      try {
        const { application, metrics, llmFailures } = await analyzeCVApplication({
          cvText,
          fileName,
          sheet,
          source: 'manual',
          receivedAt: new Date().toISOString(),
        });
        const r: RunResult = {
          run,
          score: application.scoringResult.totalScore,
          status: application.scoringResult.status,
          durationMs: metrics.durationMs,
          tokensUsed: metrics.tokensUsed,
          costEstimate: metrics.costEstimate,
          llmFailures,
          decisions: application.scoringResult.breakdown.map((d) => ({
            criterionId: d.criterionId,
            label: d.criterionLabel,
            decision: d.llmDecision,
            quote: d.llmCVQuote,
            justification: d.llmJustification,
          })),
        };
        cvResult.runs.push(r);
        console.log(`score=${r.score} (${r.status})`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`ÉCHEC — ${msg}`);
      }
    }
  }

  // ── Écriture du JSON structuré ─────────────────────────────────────────────
  const generatedAt = new Date().toISOString();
  const out = {
    provider,
    model,
    generatedAt,
    runsPerCv: runs,
    sheet: { campaignId: sheet.campaignId, criteria: sheet.criteria.length, acceptanceThreshold: sheet.acceptanceThreshold ?? null },
    results,
  };
  const resolvedOut =
    outPath ?? `bench-cv-${provider}-${generatedAt.replace(/[:.]/g, '-')}.json`;
  writeFileSync(resolvedOut, JSON.stringify(out, null, 2), 'utf-8');

  // ── Récapitulatif console ──────────────────────────────────────────────────
  console.log('\n──────── RÉCAP ────────');
  for (const cv of results) {
    if (cv.error) {
      console.log(`• ${cv.fileName} : ERREUR (${cv.error})`);
      continue;
    }
    const scores = cv.runs.map((r) => r.score);
    if (scores.length === 0) {
      console.log(`• ${cv.fileName} : aucun run abouti`);
      continue;
    }
    const sd = stdev(scores);
    console.log(
      `• ${cv.fileName} : scores=[${scores.join(', ')}] moy=${mean(scores).toFixed(1)} écart-type=${sd.toFixed(2)} (min ${Math.min(...scores)} / max ${Math.max(...scores)})`,
    );

    // Stabilité des décisions par critère sur les runs.
    const byCriterion = new Map<string, { label: string; decisions: string[] }>();
    for (const r of cv.runs) {
      for (const d of r.decisions) {
        const entry = byCriterion.get(d.criterionId) ?? { label: d.label, decisions: [] };
        entry.decisions.push(d.decision);
        byCriterion.set(d.criterionId, entry);
      }
    }
    let stableCount = 0;
    for (const [, entry] of byCriterion) {
      const counts = new Map<string, number>();
      for (const dec of entry.decisions) counts.set(dec, (counts.get(dec) ?? 0) + 1);
      const modal = Math.max(...counts.values());
      const rate = modal / entry.decisions.length;
      if (rate === 1) stableCount += 1;
      const label = entry.label.length > 48 ? `${entry.label.slice(0, 45)}…` : entry.label;
      console.log(
        `    - ${label} : ${(rate * 100).toFixed(0)}% stable [${entry.decisions.join('/')}]`,
      );
    }
    const total = byCriterion.size;
    console.log(
      `    → critères 100% stables : ${stableCount}/${total} (${total ? ((stableCount / total) * 100).toFixed(0) : '0'}%)`,
    );
  }
  console.log(`\n[bench] résultats écrits dans ${resolvedOut}`);
}

main().catch((err: unknown) => {
  console.error('[bench] erreur fatale :', err);
  process.exitCode = 1;
});
