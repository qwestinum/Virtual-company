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
  hitlCandidateKey,
  journalToActivityFeed,
  journalToAgentMetrics,
  journalToCandidatesList,
  journalToGlobalKPIs,
} from '@/lib/dashboard/derive-metrics';
import { listCampaigns } from '@/lib/db/repos/campaigns';
import { fetchMetricsRows } from '@/lib/db/repos/metrics';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { getAgentOrder } from '@/lib/agents/registry';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  const agentIds = getAgentOrder();

  const result = await fetchMetricsRows();
  if (!result) {
    return NextResponse.json({
      offline: true,
      kpis: journalToGlobalKPIs([]),
      agents: journalToAgentMetrics([], agentIds),
      candidates: [],
      activity: [],
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

  // HITL — file des validations en attente. Sert à (a) compter « À valider »,
  // (b) EXCLURE ces candidats du dashboard tant que l'envoi n'a pas eu lieu.
  const pending = await listPendingValidations();
  const pendingKeys = new Set(
    pending.map((v) =>
      hitlCandidateKey(v.candidateName, v.campaignId, v.candidateEmail),
    ),
  );

  const candidates = journalToCandidatesList(result.rows, pendingKeys).map(
    (c) => ({
      ...c,
      role: c.campaignId ? (campaignNameById.get(c.campaignId) ?? null) : null,
    }),
  );

  // DIAGNOSTIC TEMPORAIRE (HITL) — expose les clés de rapprochement pour
  // comprendre pourquoi un candidat validé ne réapparaît pas. À retirer.
  const hitlDebug = {
    pendingKeys: [...pendingKeys],
    analyzed: result.rows
      .filter((r) => r.action === 'imap_cv_analyzed')
      .map((r) => ({
        key: hitlCandidateKey(
          String(r.payload?.candidate ?? ''),
          r.campaignId,
          typeof r.payload?.email === 'string' ? r.payload.email : null,
        ),
        name: r.payload?.candidate,
        aboveThreshold: r.payload?.aboveThreshold,
      })),
    sent: result.rows
      .filter((r) => r.action === 'hitl_validation_sent')
      .map((r) => ({
        key: hitlCandidateKey(
          String(r.payload?.candidateName ?? ''),
          r.campaignId,
          typeof r.payload?.candidateEmail === 'string'
            ? r.payload.candidateEmail
            : null,
        ),
        decision: r.payload?.decision,
      })),
  };

  return NextResponse.json({
    offline: false,
    kpis: {
      ...journalToGlobalKPIs(result.rows, pendingKeys),
      awaitingValidation: pending.length,
    },
    agents: journalToAgentMetrics(result.rows, agentIds),
    candidates,
    activity: journalToActivityFeed(result.rows, 20),
    _hitlDebug: hitlDebug,
  });
}
