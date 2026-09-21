'use client';

/**
 * Colonne des cinq entrées + rappel des signaux métier, autour de l'écran courant.
 *
 * Ce qui était porté par `WorkspacePane` (compteurs de badge, signaux, toast,
 * navigation croisée) vit ici, au-dessus des pages : ces éléments ne dépendent
 * pas de l'écran affiché et re-les monter à chaque changement d'entrée
 * relancerait leurs requêtes à chaque clic.
 *
 * Le rafraîchissement des signaux est indexé sur le CHEMIN : c'est ce qui fait
 * retomber un badge après une action — comme le faisait le changement d'onglet.
 */

import { dedupeFetch } from '@/lib/net/dedupe-fetch';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BusinessToast } from '@/components/notifications/BusinessToast';
import {
  signalCount,
  useBusinessSignals,
} from '@/components/notifications/useBusinessSignals';
import { signalHref } from '@/lib/navigation/workspace-routes';

import { WorkspaceSidebar } from './WorkspaceSidebar';

/** Compteur best-effort : un chiffre absent vaut mieux qu'une erreur à l'écran. */
function useCount(url: string, read: (json: unknown) => number): number {
  const [count, setCount] = useState(0);
  const pathname = usePathname();
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await dedupeFetch(url, { cache: 'no-store' });
        if (!res.ok) return;
        const json: unknown = await res.json();
        if (!cancelled) setCount(read(json));
      } catch {
        // silencieux
      }
    })();
    return () => {
      cancelled = true;
    };
    // `read` est redéfinie à chaque rendu par l'appelant : l'indexer relancerait
    // le fetch en boucle. Le chemin suffit — c'est lui qui change après action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pathname]);
  return count;
}

export function WorkspaceChrome({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const signals = useBusinessSignals(pathname);

  const pendingValidations = useCount('/api/validations', (json) =>
    Array.isArray((json as { validations?: unknown[] }).validations)
      ? ((json as { validations: unknown[] }).validations.length ?? 0)
      : 0,
  );
  const pendingVivier = useCount(
    '/api/vivier/validations',
    (json) => (json as { total?: number }).total ?? 0,
  );

  return (
    // ⚠️ La colonne est À CÔTÉ du contenu, pas au-dessus : c'est ce qui rend
    // la largeur de page indépendante de la navigation. Le contenu garde son
    // gabarit de 1 400 px centré, colonne dépliée comme repliée.
    <div className="flex min-h-0 w-full flex-1">
      <WorkspaceSidebar
        badges={{
          pendingValidations,
          pendingVivier,
          overdueValidations: signalCount(signals, 'pending_validations_overdue'),
          interviewsAwaiting: signalCount(signals, 'interviews_awaiting_decision'),
          interviewsToPoint: signalCount(signals, 'interviews_awaiting_pointing'),
        }}
      />
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
        <BusinessToast
          signals={signals}
          onNavigate={(target) => router.push(signalHref(target))}
        />
      </div>
    </div>
  );
}
