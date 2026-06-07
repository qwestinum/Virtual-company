'use client';

/**
 * TopBanner — bandeau sticky orange-jaune translucide.
 *
 * Présent en haut de chaque page applicative (Lobby, Département,
 * Service, Settings). Embarque le logo ORQA à gauche et, à sa droite,
 * le fil d'Ariane reconstruit dynamiquement (cf. prop `breadcrumb`).
 *
 * Hauteur compacte (~22px de contenu + padding minimal) + fond
 * orange-jaune `#FFB000` à 50% d'opacité, posé sur un léger
 * backdrop-blur pour garder lisibilité du logo et du breadcrumb.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { LogoutButton } from '@/components/auth/LogoutButton';

import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { OrqaLogo } from './OrqaLogo';

const BANNER_FILL = 'rgba(255, 176, 0, 0.5)';

export type TopBannerProps = {
  /**
   * Fil d'Ariane affiché à droite du logo. Omettre pour la racine
   * (Lobby) où aucun chemin n'a de sens.
   */
  breadcrumb?: BreadcrumbItem[];
  /**
   * Affiche le bouton « Se déconnecter » à droite. Par défaut `true`
   * puisque le bandeau n'apparaît que sur les routes protégées
   * (middleware filtre l'accès anonyme avant que la page ne rende).
   */
  showLogout?: boolean;
};

export function TopBanner({
  breadcrumb,
  showLogout = true,
}: TopBannerProps) {
  const pendingCount = usePendingValidationsCount();
  return (
    <header
      className="sticky top-0 z-50 flex items-center gap-6 px-6 py-2 shadow-[0_1px_0_rgba(255,176,0,0.35)]"
      style={{ background: BANNER_FILL, backdropFilter: 'blur(6px)' }}
    >
      <Link
        href="/app"
        aria-label="Retour au lobby"
        className="block shrink-0 transition-opacity hover:opacity-90"
      >
        <OrqaLogo width={125} priority />
      </Link>
      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="font-body text-[12px] text-stone-900/85">
          <Breadcrumb items={breadcrumb} />
        </div>
      ) : null}
      <nav className="ml-auto flex items-center gap-4">
        <Link
          href="/validations"
          className="relative flex items-center gap-1.5 font-body text-[13px] font-semibold text-stone-900/85 transition-opacity hover:opacity-70"
        >
          Validation suspendue
          {pendingCount > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-600 px-1.5 font-data text-[11px] font-bold text-white">
              {pendingCount}
            </span>
          ) : null}
        </Link>
        <Link
          href="/settings"
          className="font-body text-[13px] font-semibold text-stone-900/85 transition-opacity hover:opacity-70"
        >
          Paramètres
        </Link>
        {showLogout ? <LogoutButton /> : null}
      </nav>
    </header>
  );
}

/** Compteur de validations en attente (badge nav). Best-effort, silencieux. */
function usePendingValidationsCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { validations?: unknown[] };
        if (!cancelled) setCount(json.validations?.length ?? 0);
      } catch {
        // silencieux — le badge n'est pas critique.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}
