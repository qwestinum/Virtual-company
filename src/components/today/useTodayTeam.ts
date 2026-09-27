'use client';

/**
 * Prénom du recruteur + activité de l'équipe sur la FENÊTRE CHOISIE.
 *
 * ⚠️ Remplace un chargement indexé sur la « dernière visite », gardée dans le
 * `localStorage`. Deux défauts, et le second était le vrai : la fenêtre vivait
 * dans le navigateur (donc une par machine), et surtout elle CHANGEAIT d'une
 * visite à l'autre — « 12 CV analysés » un jour et « 3 » le lendemain ne se
 * comparent pas, et rien à l'écran ne disait pourquoi.
 *
 * La fenêtre est NOMMÉE, DITE sous la bande, et vérifiée par le serveur. Ce
 * qui rendait deux chiffres incomparables, c'était une fenêtre qui BOUGEAIT
 * toute seule — pas un choix explicite entre deux durées dites.
 */

import { useCallback, useEffect, useState } from 'react';

import type { BandWindow } from '@/lib/today/agents-band';

type TodayTeam = {
  firstName: string | null;
  /** id d'agent → nombre d'actions sur la fenêtre. */
  agentCounts: Record<string, number>;
};

const VIDE: TodayTeam = { firstName: null, agentCounts: {} };

export function useTodayTeam(fenetre: BandWindow = 'semaine'): TodayTeam {
  const [team, setTeam] = useState<TodayTeam>(VIDE);

  const charger = useCallback(async () => {
    try {
      const res = await fetch(`/api/today?fenetre=${fenetre}`, {
        cache: 'no-store',
      });
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
  }, [fenetre]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
  }, [charger]);

  return team;
}
