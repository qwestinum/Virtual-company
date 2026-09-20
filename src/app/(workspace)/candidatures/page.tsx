import { Suspense } from 'react';

import { CandidaturesScreen } from '@/components/candidatures/CandidaturesScreen';

export const metadata = { title: 'Candidatures — QWESTINUM' };

/**
 * LA vue des candidatures. Conservée telle quelle ; elle reçoit désormais ses
 * filtres par l'URL (`?campagne=…&statut=…`).
 *
 * `Suspense` : `useSearchParams` suspend au rendu, et sans frontière Next
 * bascule la page entière en rendu client.
 */
export default function CandidaturesPage() {
  return (
    <Suspense fallback={null}>
      <CandidaturesScreen />
    </Suspense>
  );
}
