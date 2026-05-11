/**
 * `<HydrationGate />` — bootstrap de la persistance (Session 5, round 1
 * → étendu en round 3).
 *
 * Monté tôt dans le `<main>` (page.tsx). À l'apparition :
 *   - pose les subscribers de sync (push debounced sur mutation),
 *   - déclenche l'hydratation initiale depuis Supabase (campagnes +
 *     tâches),
 *   - round 3 : une fois les campagnes/tâches hydratées, charge
 *     également leurs artefacts (metadata seule, sans content).
 *
 * Ne rend rien. Volontairement non-bloquant : on ne veut pas freezer
 * l'UI sur un round-trip réseau au boot. La page apparaît, les
 * campagnes/tâches arrivent quand la réponse revient. En mode démo
 * sans Supabase (503), la fonction est un no-op silencieux.
 */
'use client';

import { useEffect } from 'react';

import {
  hydrateArtifactsForCampaign,
  hydrateArtifactsForTask,
} from '@/lib/db/sync/artifacts-sync';
import {
  attachCampaignsSync,
  hydrateCampaigns,
} from '@/lib/db/sync/campaigns-sync';
import { attachTasksSync, hydrateTasks } from '@/lib/db/sync/tasks-sync';
import { useCampaignsStore } from '@/stores/campaigns-store';
import { useTasksStore } from '@/stores/tasks-store';

export function HydrationGate(): null {
  useEffect(() => {
    const detachCampaigns = attachCampaignsSync();
    const detachTasks = attachTasksSync();
    void (async () => {
      await Promise.all([hydrateCampaigns(), hydrateTasks()]);
      // Round 3 — fan-out hydratation des artefacts. Parallélisé sur
      // toutes les campagnes/tâches connues. Chaque erreur réseau
      // est swallow par artifacts-sync, le boot reste robuste.
      const campaignIds = useCampaignsStore.getState().order;
      const taskIds = useTasksStore.getState().order;
      await Promise.all([
        ...campaignIds.map((id) => hydrateArtifactsForCampaign(id)),
        ...taskIds.map((id) => hydrateArtifactsForTask(id)),
      ]);
    })();
    return () => {
      detachCampaigns();
      detachTasks();
    };
  }, []);
  return null;
}
