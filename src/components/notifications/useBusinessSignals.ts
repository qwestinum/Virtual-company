'use client';

/**
 * Chargement des signaux métier (toast + badges). Fetch au montage puis à
 * chaque changement de `refreshKey` (= l'onglet courant : une navigation
 * re-vérifie, c'est ce qui fait décrémenter les badges quand une action vient
 * d'être faite). AUCUN polling d'arrière-plan.
 */
import { useEffect, useState } from 'react';

import type { BusinessSignal } from '@/types/notifications';

export function useBusinessSignals(refreshKey: unknown): BusinessSignal[] {
  const [signals, setSignals] = useState<BusinessSignal[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/notifications/business', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { signals?: BusinessSignal[] };
        if (!cancelled) setSignals(json.signals ?? []);
      } catch {
        // best-effort : pas de signal plutôt qu'une erreur visible.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return signals;
}

/** Compteur d'un signal par clé (badges d'onglet). 0 si absent. */
export function signalCount(
  signals: BusinessSignal[],
  key: BusinessSignal['key'],
): number {
  return signals.find((s) => s.key === key)?.count ?? 0;
}
