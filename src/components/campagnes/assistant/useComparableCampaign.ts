'use client';

/**
 * « Une campagne comparable existe » — la pré-recherche d'archives, reprise de
 * la création historique.
 *
 * Elle interroge `/api/fdps/search` sur l'intitulé saisi et PROPOSE ; elle
 * n'applique rien d'elle-même. C'est la différence avec l'ancienne feuille,
 * qui préremplissait d'office au passage d'étape : un écran qui se remplit
 * tout seul fait douter de ce qu'on vient de taper.
 *
 * ⚠️ Fail-soft de bout en bout : Supabase absent, réseau coupé, aucun résultat
 * — on ne propose rien et l'écran ne change pas. Une aide qui tombe ne doit
 * jamais bloquer une saisie.
 */

import { useEffect, useState } from 'react';

import type { JobDescription } from '@/lib/storage/job-descriptions';

export type Comparable = { source: JobDescription };

/** Intitulé trop court : on ne cherche pas (« dé » ne compare rien). */
const LONGUEUR_MINIMALE = 3;
/** On cherche quand la frappe s'arrête, pas à chaque lettre. */
const REPOS_MS = 600;

export function useComparableCampaign(
  jobTitle: string,
  actif: boolean,
): Comparable | null {
  const [trouvee, setTrouvee] = useState<Comparable | null>(null);

  useEffect(() => {
    const requete = jobTitle.trim();
    if (!actif || requete.length < LONGUEUR_MINIMALE) {
      // On synchronise avec un SERVICE EXTERNE (la recherche d'archives) :
      // quand la requête cesse d'être valable, sa réponse aussi. La garder à
      // l'écran proposerait une campagne comparable à un intitulé qui n'existe
      // plus.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrouvee(null);
      return;
    }
    let abandonne = false;
    const minuteur = setTimeout(async () => {
      try {
        const res = await fetch(`/api/fdps/search?q=${encodeURIComponent(requete)}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const json = (await res.json()) as { hits?: JobDescription[] };
        const hit = json.hits?.[0] ?? null;
        if (!abandonne) setTrouvee(hit ? { source: hit } : null);
      } catch {
        // Hors ligne / storage absent : on ne propose rien, c'est tout.
      }
    }, REPOS_MS);
    return () => {
      abandonne = true;
      clearTimeout(minuteur);
    };
  }, [jobTitle, actif]);

  return trouvee;
}
