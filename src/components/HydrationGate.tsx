/**
 * `<HydrationGate />` — bootstrap de la persistance (Session 5, round 1).
 *
 * Monté tôt dans le `<main>` (page.tsx). À l'apparition :
 *   - pose les subscribers de sync (push debounced sur mutation),
 *   - déclenche l'hydratation initiale depuis Supabase.
 *
 * Ne rend rien. Volontairement non-bloquant : on ne veut pas freezer
 * l'UI sur un round-trip réseau au boot. La page apparaît, les
 * campagnes/tâches arrivent quand la réponse revient. En mode démo
 * sans Supabase (503), la fonction est un no-op silencieux.
 */
'use client';

import { useEffect } from 'react';

import {
  attachCampaignsSync,
  hydrateCampaigns,
} from '@/lib/db/sync/campaigns-sync';
import { attachTasksSync, hydrateTasks } from '@/lib/db/sync/tasks-sync';

export function HydrationGate(): null {
  useEffect(() => {
    const detachCampaigns = attachCampaignsSync();
    const detachTasks = attachTasksSync();
    void hydrateCampaigns();
    void hydrateTasks();
    return () => {
      detachCampaigns();
      detachTasks();
    };
  }, []);
  return null;
}
