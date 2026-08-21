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

import { getAdminApiUser } from '@/lib/auth/require-api-user';

import {
  ACTIVITY_FEED_ACTIONS,
  AGENT_METRIC_ACTIONS,
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
  fetchRecentRowsForActions,
} from '@/lib/db/repos/metrics';
import { listPendingValidations } from '@/lib/db/repos/pending-validations';
import { SupabaseNotConfiguredError } from '@/lib/db/supabase-server';
import { ensureSchedulerStarted } from '@/lib/imap/scheduler';
import { getAgentOrder } from '@/lib/agents/registry';

export const runtime = 'nodejs';

/** Nombre d'items visés par le fil d'activité. */
const ACTIVITY_ITEMS = 50;

/**
 * Marge de lignes chargées pour obtenir ces items. Le filtre en base retire le
 * bruit TECHNIQUE ; il reste un tri sur le CONTENU (un envoi dont le statut
 * n'est pas `sent` n'est pas un envoi, un mail HITL non parti a son propre
 * évènement). Cette part-là est bornée par la nature des lignes, pas par le
 * volume du journal — d'où une marge constante, et non un multiple à faire
 * grandir. Sans elle, un lot de lignes écartées sur leur contenu raccourcirait
 * le fil ; avec elle, on ne charge jamais 500 lignes pour en montrer 11.
 */
const ACTIVITY_FETCH_ROWS = ACTIVITY_ITEMS * 3;

/** Fenêtre « récente » des métriques par agent — sur les actions d'agent SEULES. */
const AGENT_WINDOW_ROWS = 500;

export async function GET(): Promise<NextResponse> {
  // Filet de sécurité : le scheduler IMAP démarre au boot (instrumentation),
  // mais on le re-garantit ici — cette route est pollée toutes les 5 s tant que
  // l'app est ouverte, donc la relève des candidatures par mail ne peut pas
  // rester en panne silencieuse. Idempotent (garde sur globalThis).
  ensureSchedulerStarted();

  // Multi-utilisateur : la route sert le MÉTIER (Bureau : zones, activité,
  // candidats — accessible à toute session) ET l'admin (coûts IA, métriques
  // par agent). SCINDÉ plutôt que gaté en bloc : un member reçoit le payload
  // avec `agents` vidé et `costEstimate` à 0 (cache de rôle 60 s — la route
  // est pollée toutes les 5 s).
  const isAdmin = (await getAdminApiUser()) !== null;

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
  // Sert à (a) compter « À valider », (b) MARQUER ces analyses
  // (`awaitingValidation`) : les cartes campagne les comptent en « CV reçus »,
  // le dashboard résiduel et les KPIs dérivés les écartent jusqu'à l'envoi.
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

  // Fil d'activité et métriques agents : deux fenêtres CIBLÉES, en parallèle.
  // Repli sur la fenêtre brute si le fetch ciblé échoue — dégradé, jamais vide.
  const [activityResult, agentResult] = await Promise.all([
    fetchRecentRowsForActions(ACTIVITY_FEED_ACTIONS, ACTIVITY_FETCH_ROWS).catch(
      () => null,
    ),
    isAdmin
      ? fetchRecentRowsForActions(AGENT_METRIC_ACTIONS, AGENT_WINDOW_ROWS).catch(
          () => null,
        )
      : Promise.resolve<{ rows: typeof result.rows } | null>({ rows: [] }),
  ]);
  const activityRows = activityResult?.rows ?? result.rows;
  const agentRows = agentResult?.rows ?? result.rows;

  // Répartition par zone (récit Bureau) — EXHAUSTIF depuis candidate_analyses.
  // Best-effort : un échec retombe sur des zones vides, le reste du payload tient.
  const zones = await zoneDistribution().catch(() => EMPTY_ZONE_COUNTS);

  const kpis = {
    ...journalToGlobalKPIs(totalRows, pendingUids),
    awaitingValidation: pending.length,
  };
  return NextResponse.json({
    offline: false,
    // Coût IA = donnée ADMIN (member : 0, jamais le chiffre réel).
    kpis: isAdmin ? kpis : { ...kpis, costEstimate: 0 },
    // Agents + activité = fenêtres RÉCENTES assumées (limite légitime, pas un
    // total) — mais des fenêtres sur les lignes QU'ELLES SAVENT UTILISER, et
    // non sur le journal brut : charger large puis jeter laissait une action
    // technique bavarde évincer tout le métier (21/08/2026). Métriques par
    // agent = ADMIN uniquement.
    agents: isAdmin ? journalToAgentMetrics(agentRows, agentIds) : [],
    candidates,
    activity: journalToActivityFeed(activityRows, ACTIVITY_ITEMS),
    zones,
  });
}
