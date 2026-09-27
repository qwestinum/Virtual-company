import { Suspense } from 'react';

import { CampaignAssistantScreen } from '@/components/campagnes/assistant/CampaignAssistantScreen';

export const metadata = { title: 'Nouvelle campagne — QWESTINUM' };

/**
 * La création de campagne devient une ADRESSE.
 *
 * C'est ce qui permet de fermer et de revenir (`?campagne=CAMP-…` reprend le
 * brouillon), et c'est la MÊME route depuis Campagnes et depuis *Aujourd'hui* —
 * un raccourci qui ouvrirait une autre surface serait un second chemin de
 * création, donc deux comportements à tenir d'accord.
 *
 * `Suspense` : l'écran lit `?campagne=…`, et `useSearchParams` suspend au
 * rendu — sans frontière, le prérendu échoue.
 */
export default function NouvelleCampagnePage() {
  return (
    <Suspense fallback={null}>
      <CampaignAssistantScreen />
    </Suspense>
  );
}
