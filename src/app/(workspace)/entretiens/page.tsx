import { Suspense } from 'react';

import { InterviewsScreen } from '@/components/interviews/InterviewsScreen';

export const metadata = { title: 'Entretiens — QWESTINUM' };

/** LA vue des entretiens. Conservée ; filtre campagne reçu par l'URL. */
export default function EntretiensPage() {
  return (
    <Suspense fallback={null}>
      <InterviewsScreen />
    </Suspense>
  );
}
