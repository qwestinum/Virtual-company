'use client';

/**
 * Prénom du recruteur + activité de l'équipe DEPUIS SA DERNIÈRE VISITE.
 *
 * ⚠️ « Dernière visite » = le dernier chargement d'*Aujourd'hui* par CE
 * recruteur. L'horodatage est donc gardé PAR UTILISATEUR (clé indexée sur son
 * identifiant), jamais globalement : deux recruteurs qui ouvrent la page à une
 * heure d'intervalle ne doivent pas se voler leur fenêtre.
 *
 * ⚠️ ARBITRAGE ASSUMÉ, à confirmer : l'horodatage vit dans le `localStorage`,
 * donc PAR NAVIGATEUR. Le porter côté serveur demanderait une colonne sur
 * `recruiters` — donc une migration, et le cadrage du chantier impose un point
 * d'arrêt avant toute migration. Conséquence à connaître : le même recruteur
 * sur deux machines a deux fenêtres. Le jour où la colonne existe, seul ce
 * fichier change.
 *
 * La fenêtre est POSÉE APRÈS la lecture : on lit avec l'horodatage précédent,
 * puis on inscrit celui de maintenant. L'inverse afficherait toujours zéro.
 */

import { useCallback, useEffect, useState } from 'react';

const CLE = 'orqa.today.lastVisit';

type TodayContext = {
  firstName: string | null;
  /** id d'agent → nombre d'actions depuis la dernière visite. */
  agentCounts: Record<string, number>;
};

const VIDE: TodayContext = { firstName: null, agentCounts: {} };

/** `localStorage` peut lever (navigation privée, stockage bloqué). */
function lire(cle: string): string | null {
  try {
    return window.localStorage.getItem(cle);
  } catch {
    return null;
  }
}

function ecrire(cle: string, valeur: string): void {
  try {
    window.localStorage.setItem(cle, valeur);
  } catch {
    // Stockage indisponible : la fenêtre retombe sur 24 h à chaque visite.
    // Dégradation douce — jamais une page qui refuse de s'afficher.
  }
}

export function useTodayContext(): TodayContext {
  const [context, setContext] = useState<TodayContext>(VIDE);

  const charger = useCallback(async () => {
    try {
      // On ignore la clé tant qu'on ne sait pas QUI lit : une fenêtre lue sous
      // une clé anonyme mélangerait deux recruteurs sur un poste partagé.
      const id = await fetch('/api/recruiters/options', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { currentUserId?: string | null } | null) => j?.currentUserId ?? null)
        .catch(() => null);

      const cle = id ? `${CLE}.${id}` : null;
      const since = cle ? lire(cle) : null;

      const url = since
        ? `/api/today?since=${encodeURIComponent(since)}`
        : '/api/today';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const json = (await res.json()) as {
        firstName?: string | null;
        agents?: { id: string; count: number }[];
      };

      setContext({
        firstName: json.firstName ?? null,
        agentCounts: Object.fromEntries(
          (json.agents ?? []).map((a) => [a.id, a.count]),
        ),
      });

      // La visite n'est inscrite QU'APRÈS une lecture réussie : une panne ne
      // doit pas consommer la fenêtre du recruteur.
      if (cle) ecrire(cle, new Date().toISOString());
    } catch {
      // Best-effort : l'écran reste utilisable sans prénom ni chiffres.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger();
  }, [charger]);

  return context;
}
