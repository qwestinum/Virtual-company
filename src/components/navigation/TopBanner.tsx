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

import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { OrqaLogo } from './OrqaLogo';

const BANNER_FILL = 'rgba(255, 176, 0, 0.5)';

export type TopBannerProps = {
  /**
   * Fil d'Ariane affiché à droite du logo. Omettre pour la racine
   * (Lobby) où aucun chemin n'a de sens.
   */
  breadcrumb?: BreadcrumbItem[];
};

export function TopBanner({ breadcrumb }: TopBannerProps) {
  return (
    <header
      className="sticky top-0 z-50 flex items-center gap-6 px-6 py-2 shadow-[0_1px_0_rgba(255,176,0,0.35)]"
      style={{ background: BANNER_FILL, backdropFilter: 'blur(6px)' }}
    >
      <Link
        href="/"
        aria-label="Retour au Lobby"
        className="block shrink-0 transition-opacity hover:opacity-90"
      >
        <OrqaLogo width={125} priority />
      </Link>
      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="font-body text-[12px] text-stone-900/85">
          <Breadcrumb items={breadcrumb} />
        </div>
      ) : null}
    </header>
  );
}
