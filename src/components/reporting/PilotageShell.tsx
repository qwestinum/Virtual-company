'use client';

/**
 * Le gabarit de Pilotage — `PageShell` avec son titre et ses sous-onglets.
 *
 * ⚠️ Pourquoi il existe : la barre d'outils d'un écran doit vivre dans la
 * ZONE DE TÊTE du gabarit (titre → onglets → outils → compteurs → filet →
 * liste). Or les filtres de Pilotage appartiennent à un sous-écran, pas au
 * hub. Plutôt que de remonter leur état — qui dépend des campagnes chargées —
 * c'est le sous-écran qui rend le gabarit, et ce composant évite d'y recopier
 * quatre fois le titre.
 */

import { PageShell } from '@/components/navigation/PageShell';
import type { ReactNode } from 'react';

export function PilotageShell({
  tabs,
  toolbar,
  children,
}: {
  tabs: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageShell
      title="Pilotage"
      subtitle="Les rapports de campagne et la vue transverse."
      tabs={tabs}
      toolbar={toolbar}
    >
      {children}
    </PageShell>
  );
}
