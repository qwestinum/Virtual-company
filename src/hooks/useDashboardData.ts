'use client';

/**
 * Hook de chargement des métriques du dashboard (Session 6).
 *
 * ⚠️ AUCUN SONDAGE (27/09/2026, diagnostic d'egress) : le hook relisait
 * `/api/metrics/global` toutes les 5 s, MÊME ONGLET CACHÉ — ~1,8 Go/jour par
 * onglet oublié, de quoi sortir seul du quota Supabase. Il lit désormais à
 * l'ouverture, au retour sur l'onglet et sur demande (`refresh`, après une
 * action). Retiré ICI, à la source, pour qu'aucun écran ne le rallume par
 * défaut.
 *
 * Gestion des erreurs : un échec réseau ne casse pas l'UI — on garde
 * la dernière donnée valide affichée et on annote `isStale: true`.
 * L'API renvoie elle-même un payload vide cohérent si Supabase n'est
 * pas configuré (cf. /api/metrics/global), donc on n'a pas à gérer
 * de 503 ici.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  AgentMetric,
  CandidateRow,
  GlobalKPIs,
  ZoneCounts,
} from '@/lib/dashboard/derive-metrics';

export type DashboardData = {
  offline: boolean;
  kpis: GlobalKPIs;
  agents: AgentMetric[];
  candidates: CandidateRow[];
  /** Répartition par zone de décision (Bureau « Process First »). */
  zones: ZoneCounts;
};

export type DashboardState = {
  data: DashboardData | null;
  isLoading: boolean;
  isStale: boolean;
  error: string | null;
  refresh: () => void;
};

export function useDashboardData(): DashboardState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [isStale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async (): Promise<void> => {
    inflight.current?.abort();
    const ctl = new AbortController();
    inflight.current = ctl;
    try {
      const res = await fetch('/api/metrics/global', {
        signal: ctl.signal,
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DashboardData;
      setData(json);
      setError(null);
      setStale(false);
    } catch (err) {
      if (ctl.signal.aborted) return;
      setStale(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // `fetchOnce` est asynchrone : tous les setState qu'il déclenche
    // sont planifiés après `await`, jamais en synchrone dans le body
    // de l'effet. La règle eslint react-hooks/set-state-in-effect ne
    // peut pas prouver cela statiquement — on documente ici le pattern
    // « chargement avec abort » d'un useEffect de synchronisation avec un
    // système externe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchOnce();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void fetchOnce();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      inflight.current?.abort();
    };
  }, [fetchOnce]);

  return { data, isLoading, isStale, error, refresh: fetchOnce };
}
