'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  type CandidateStage,
  type CandidateStageCounts,
  emptyStageCounts,
} from '@/lib/reporting/candidate-stage';
import type { CandidateListItem } from '@/types/reporting';

export const CANDIDATURES_PAGE_SIZE = 50;

export type CandidaturesFilters = {
  /** '' = toutes campagnes. */
  campaignId: string;
  /** Ensemble de campagnes (ex. « actives »). Prioritaire sur campaignId. */
  campaignIds: string[];
  from: string;
  to: string;
  search: string;
  stage: CandidateStage | null;
  fromVivier: boolean;
};

/** Référence stable pour « aucune campagne ciblée » (évite les refetch en boucle). */
export const NO_CAMPAIGN_IDS: string[] = [];

const EMPTY_FILTERS: CandidaturesFilters = {
  campaignId: '',
  campaignIds: NO_CAMPAIGN_IDS,
  from: '',
  to: '',
  search: '',
  stage: null,
  fromVivier: false,
};

function buildQuery(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return q.toString();
}

/**
 * État + données du menu Candidatures.
 *
 * RÈGLE DE RECALCUL :
 *   - compteurs du ruban  → dépendent du PÉRIMÈTRE (campagne + période) SEUL.
 *     Jamais de la recherche texte ni du chip d'étape ni du filtre vivier.
 *   - liste paginée       → dépend de TOUS les filtres (recherche debouncée).
 */
export function useCandidatures() {
  const [filters, setFilters] = useState<CandidaturesFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<CandidateListItem[]>([]);
  const [listTotal, setListTotal] = useState(0);
  const [loadingList, setLoadingList] = useState(false);
  const [counts, setCounts] = useState<CandidateStageCounts>(emptyStageCounts());
  const [perimeterTotal, setPerimeterTotal] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  // Debounce de la recherche (la liste ne refetch pas à chaque frappe).
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 300);
    return () => clearTimeout(t);
  }, [filters.search]);

  const campaignIds = filters.campaignIds;
  const campaignIdsParam = campaignIds.length > 0 ? campaignIds.join(',') : undefined;
  const perimeter = useMemo(
    () => ({
      campaignId: filters.campaignId,
      campaignIdsParam,
      from: filters.from,
      to: filters.to,
    }),
    [filters.campaignId, campaignIdsParam, filters.from, filters.to],
  );

  // Compteurs — PÉRIMÈTRE uniquement.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/candidatures/counters?${buildQuery({
            campaignId: perimeter.campaignId,
            campaignIds: perimeter.campaignIdsParam,
            from: perimeter.from,
            to: perimeter.to,
          })}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          counts: CandidateStageCounts;
          total: number;
        };
        if (!cancelled) {
          setCounts(json.counts);
          setPerimeterTotal(json.total);
        }
      } catch {
        // silencieux : le ruban garde ses dernières valeurs.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [perimeter.campaignId, perimeter.campaignIdsParam, perimeter.from, perimeter.to, refreshToken]);

  // Liste — tous les filtres.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingList(true);
      try {
        const res = await fetch(
          `/api/candidatures?${buildQuery({
            campaignId: perimeter.campaignId,
            campaignIds: perimeter.campaignIdsParam,
            from: perimeter.from,
            to: perimeter.to,
            search: debouncedSearch,
            stage: filters.stage ?? undefined,
            fromVivier: filters.fromVivier ? 'true' : undefined,
            limit: String(CANDIDATURES_PAGE_SIZE),
            offset: String(page * CANDIDATURES_PAGE_SIZE),
          })}`,
          { cache: 'no-store' },
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          rows: CandidateListItem[];
          total: number;
        };
        if (!cancelled) {
          setRows(json.rows);
          setListTotal(json.total);
        }
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    perimeter.campaignId,
    perimeter.campaignIdsParam,
    perimeter.from,
    perimeter.to,
    debouncedSearch,
    filters.stage,
    filters.fromVivier,
    page,
    refreshToken,
  ]);

  // Rafraîchissement AUTO : les changements d'étape peuvent venir d'événements
  // EXTERNES (réservation Cal.com → « RDV pris ») qui ne sont pas des actions UI.
  // On refetch au retour sur l'onglet/fenêtre + un polling léger, pour que le
  // tag se mette à jour sans recharger la page à la main.
  useEffect(() => {
    const bump = () => setRefreshToken((t) => t + 1);
    const onVisible = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', bump);
    const id = window.setInterval(bump, 25_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', bump);
      window.clearInterval(id);
    };
  }, []);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  // Tout changement de filtre/périmètre remet la pagination à zéro (fait ici,
  // pas dans un effet → évite un setState synchrone en corps d'effet).
  const patchFilters = useCallback((patch: Partial<CandidaturesFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(0);
  }, []);

  return {
    filters,
    setFilters: patchFilters,
    counts,
    perimeterTotal,
    rows,
    listTotal,
    loadingList,
    page,
    setPage,
    refresh,
  };
}
