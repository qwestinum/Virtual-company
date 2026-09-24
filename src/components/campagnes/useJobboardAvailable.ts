'use client';

/**
 * La page d'offres de démonstration existe-t-elle sur cette installation ?
 *
 * ⚠️ Sans `DEMO_JOBBOARD_ENABLED`, l'annonce générique n'a nulle part où
 * paraître : son panneau se retire. Proposer ce canal quand même, c'était un
 * choix qui s'enregistrait puis disparaissait sans un mot. On le demande au
 * serveur (le flag ne voyage jamais jusqu'au navigateur) — `null` tant qu'on
 * ne sait pas.
 */
import { useEffect, useState } from 'react';

import { loadJobPost } from '@/lib/jobboard/job-post-client';

export function useJobboardAvailable(campaignId: string): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void loadJobPost(campaignId)
      .then((o) => alive && setAvailable(!o.unavailable))
      // Une panne n'est pas une absence : on ne retire pas le canal pour ça.
      .catch(() => alive && setAvailable(true));
    return () => {
      alive = false;
    };
  }, [campaignId]);
  return available;
}
