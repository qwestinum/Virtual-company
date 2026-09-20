'use client';

/**
 * Prénom du recruteur + activité de l'équipe SUR LES SEPT DERNIERS JOURS.
 *
 * ⚠️ Remplace un chargement indexé sur la « dernière visite », gardée dans le
 * `localStorage`. Deux défauts, et le second était le vrai : la fenêtre vivait
 * dans le navigateur (donc une par machine), et surtout elle CHANGEAIT d'une
 * visite à l'autre — « 12 CV analysés » un jour et « 3 » le lendemain ne se
 * comparent pas, et rien à l'écran ne disait pourquoi.
 *
 * La fenêtre est désormais décidée par le serveur et DITE sous la bande.
 */

import { useCallback, useEffect, useState } from 'react';

type TodayTeam = {
  firstName: string | null;
  /** id d'agent → nombre d'actions sur la fenêtre. */
  agentCounts: Record<string, number>;
};

const VIDE: TodayTeam = { firstName: null, agentCounts: {} };

export function useTodayTeam(): TodayTeam {
  const [team, setTeam] = useState<TodayTeam>(VIDE);

  const charger = useCallback(async () => {
    try {
      const res = await fetch('/api/today', { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        firstName?: string | null;
        agents?: { id: string; count: number }[];
      };
      setTeam({
        firstName: json.firstName ?? null,
        agentCounts: Object.fromEntries(
          (json.agents ?? []).map((a) => [a.id, a.count]),
        ),
      });
    } catch {
      // Best-effort : l'écran reste utilisable sans prénom ni chiffres.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
  }, [charger]);

  return team;
}
