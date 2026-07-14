/**
 * /api/metrics/global — agrégation globale pour le dashboard (Session 6).
 *
 * Renvoie en un seul appel les six KPIs, les métriques par agent, la
 * liste des candidats et les 20 dernières activités. Le client poll
 * cette route toutes les 5 secondes ; on évite ainsi un round-trip
 * supplémentaire pour le feed.
 *
 * Mode dégradé : si Supabase n'est pas configuré, on renvoie un payload
 * vide cohérent (200 OK) et un flag `offline: true`. Le dashboard
 * tournera quand même avec les données du store Zustand. Pas de 503 ici
 * — ce n'est pas une erreur métier, juste un environnement sans
 * persistance.
 */

import { NextResponse } from 'next/server';

import {
  EMPTY_ZONE_COUNTS,
  journalToActivityFeed,
  journalToAgentMetrics,
  journalToCandidatesList,
  journalToGlobalKPIs,
} from '@/lib/dashboard/derive-metrics';
import { zoneDistribution } from '@/lib/dashboard/zone-counts';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import {
  fetchCandidateTotalRows,
  fetchMetricsRows,
} from '@/lib/db/repos/metrics';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { ensureSchedulerStarted } from '@/lib/imap/scheduler';
import { getAgentOrder } from '@/lib/agents/registry';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  // Filet de sécurité : le scheduler IMAP démarre au boot (instrumentation),
  // mais on le re-garantit ici — cette route est pollée toutes les 5 s tant que
  // l'app est ouverte, donc la relève des candidatures par mail ne peut pas
  // rester en panne silencieuse. Idempotent (garde sur globalThis).
  ensureSchedulerStarted();

  const agentIds = getAgentOrder();

  const result = await fetchMetricsRows();
  if (!result) {
    return NextResponse.json({
      offline: true,
      kpis: journalToGlobalKPIs([]),
      agents: journalToAgentMetrics([], agentIds),
      candidates: [],
      activity: [],
      zones: EMPTY_ZONE_COUNTS,
    });
  }

  // Charge les campagnes en parallèle pour enrichir `role` sur les
  // candidats. Si listCampaigns plante, on dégrade vers `role: null`.
  let campaignNameById = new Map<string, string>();
  try {
    const campaigns = await listCampaigns();
    campaignNameById = new Map(campaigns.map((c) => [c.id, c.name]));
  } catch (err) {
    if (!(err instanceof SupabaseNotConfiguredError)) {
      console.error('[metrics/global] listCampaigns failed', err);
    }
  }

  // HITL — file des validations en attente, rattachées à l'analyse PAR UID.
  // Sert à (a) compter « À valider », (b) EXCLURE ces analyses du dashboard
  // tant que l'envoi n'a pas eu lieu.
  const pending = await listPendingValidations();
  const pendingUids = new Set(
    pending
      .map((v) => (typeof v.payload?.uid === 'string' ? v.payload.uid : null))
      .filter((u): u is string => u !== null),
  );

  // TOTAUX (KPIs, liste, coût) — EXHAUSTIFS (audit C10 surface b) : dérivés
  // des actions candidat/coût sans cap 500, sinon le récit « Process First »
  // du Bureau mentait au-delà de 500 événements. Même dérivation pure, input
  // complet. Repli sur la fenêtre récente si le fetch exhaustif échoue.
  const totalRows =
    (await fetchCandidateTotalRows().catch(() => null))?.rows ?? result.rows;

  const candidates = journalToCandidatesList(totalRows, pendingUids).map(
    (c) => ({
      ...c,
      role: c.campaignId ? (campaignNameById.get(c.campaignId) ?? null) : null,
    }),
  );

  // Répartition par zone (récit Bureau) — EXHAUSTIF depuis candidate_analyses.
  // Best-effort : un échec retombe sur des zones vides, le reste du payload tient.
  const zones = await zoneDistribution().catch(() => EMPTY_ZONE_COUNTS);

  return NextResponse.json({
    offline: false,
    kpis: {
      ...journalToGlobalKPIs(totalRows, pendingUids),
      awaitingValidation: pending.length,
    },
    // Agents + activité = fenêtre RÉCENTE assumée (durée/tokens/coût récents,
    // fil « qui défile ») — limite légitime, pas un total. Reste sur la
    // fenêtre 500 (`result.rows`).
    agents: journalToAgentMetrics(result.rows, agentIds),
    candidates,
    activity: journalToActivityFeed(result.rows, 50),
    zones,
  });
}
