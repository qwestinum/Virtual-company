import { Suspense } from 'react';

import { CampaignsScreen } from '@/components/campagnes/CampaignsScreen';

export const metadata = { title: 'Campagnes — QWESTINUM' };

/**
 * Liste des campagnes. Le hub de la carte dépliée est le livrable du lot 3.
 *
 * `Suspense` : l'écran lit `?campagne=…` (« retour à la campagne »), et
 * `useSearchParams` suspend au rendu — sans frontière, le prérendu échoue.
 */
export default function CampagnesPage() {
  return (
    <Suspense fallback={null}>
      <CampaignsScreen />
    </Suspense>
  );
}
