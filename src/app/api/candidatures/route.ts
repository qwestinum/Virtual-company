/**
 * /api/candidatures — liste PAGINÉE du menu Candidatures.
 *
 * Source : `candidate_analyses` (colonnes/tables complètes), JAMAIS le journal
 * tronqué. Chaque ligne est enrichie de son `stage` (étape pipeline) via le
 * helper partagé `deriveCandidateStage` — le MÊME que le ruban.
 *
 * Filtres (ET logique) : campaignId, from, to, search, fromVivier, stage.
 *   - `fromVivier` et la période/campagne sont des COLONNES → filtrés en SQL,
 *     pagination serveur exacte (`range` + `count`).
 *   - `stage` est DÉRIVÉ → on dérive sur tout le périmètre, on filtre, puis on
 *     pagine en mémoire (volume borné par le périmètre). Sans filtre `stage`, on
 *     reste sur la pagination SQL (cas courant, le moins coûteux).
 */
import { NextResponse } from 'next/server';

import {
  countCandidateAnalyses,
  listAllCandidateAnalyses,
  listCandidateAnalyses,
} from '@/lib/db/repos/candidate-analyses';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import {
  CANDIDATE_STAGES,
  type CandidateStage,
} from '@/lib/reporting/candidate-stage';
import { loadStageSignals, stageFor } from '@/lib/reporting/stage-signals';
import type {
  CandidateAnalysisFilters,
  CandidateListItem,
} from '@/types/reporting';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 50;

function clampLimit(raw: string | null): number {
  const n = raw ? Number(raw) : DEFAULT_LIMIT;
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(Math.max(Math.trunc(n), 1), 200);
}

function clampOffset(raw: string | null): number {
  const n = raw ? Number(raw) : 0;
  if (!Number.isFinite(n)) return 0;
  return Math.max(Math.trunc(n), 0);
}

export async function GET(request: Request): Promise<NextResponse> {
  const params = new URL(request.url).searchParams;
  const limit = clampLimit(params.get('limit'));
  const offset = clampOffset(params.get('offset'));

  const baseFilters: CandidateAnalysisFilters = {};
  const campaignId = params.get('campaignId');
  if (campaignId) baseFilters.campaignId = campaignId;
  const campaignIdsRaw = params.get('campaignIds');
  const campaignIds = campaignIdsRaw
    ? campaignIdsRaw.split(',').filter(Boolean)
    : [];
  if (campaignIds.length > 0) baseFilters.campaignIds = campaignIds;
  const search = params.get('search');
  if (search) baseFilters.search = search;
  const from = params.get('from');
  if (from) baseFilters.from = from;
  const to = params.get('to');
  if (to) baseFilters.to = to;
  if (params.get('fromVivier') === 'true') baseFilters.fromVivier = true;

  const stageRaw = params.get('stage');
  const stageFilter = (CANDIDATE_STAGES as readonly string[]).includes(
    stageRaw ?? '',
  )
    ? (stageRaw as CandidateStage)
    : null;

  try {
    // Signaux scopés à la campagne (les loaders journal/entretien filtrent par
    // campagne ; pending est global, intersecté par uid). Réutilisés par toutes
    // les lignes — un seul chargement.
    const signals = await loadStageSignals({ campaignId: campaignId ?? undefined });

    if (stageFilter) {
      // Filtre DÉRIVÉ : dérive sur tout le périmètre (campagne+période+recherche
      // +fromVivier), filtre par étape, puis pagine en mémoire.
      const all = await listAllCandidateAnalyses(baseFilters);
      const enriched: CandidateListItem[] = all.map((c) => ({
        ...c,
        stage: stageFor(c, signals),
      }));
      const filtered = enriched.filter((c) => c.stage === stageFilter);
      const rows = filtered.slice(offset, offset + limit);
      return NextResponse.json({ rows, total: filtered.length });
    }

    // Pas de filtre d'étape : pagination SQL exacte.
    const [page, total] = await Promise.all([
      listCandidateAnalyses({ ...baseFilters, limit, offset }),
      countCandidateAnalyses(baseFilters),
    ]);
    const rows: CandidateListItem[] = page.map((c) => ({
      ...c,
      stage: stageFor(c, signals),
    }));
    return NextResponse.json({ rows, total });
  } catch (err) {
    if (err instanceof SupabaseNotConfiguredError) {
      return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
    }
    return NextResponse.json(
      { error: 'db_error', message: (err as Error).message },
      { status: 500 },
    );
  }
}
