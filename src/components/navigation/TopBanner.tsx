'use client';

/**
 * TopBanner — le bandeau du produit.
 *
 * ⚠️ PLUS DE FIL D'ARIANE « Lobby / RH / Recrutement » (lot 8 bis). Il
 * décrivait une hiérarchie que personne ne parcourait : on entrait par le
 * lobby, on traversait le département, on arrivait au service — trois clics
 * pour atteindre le travail du jour. L'application s'ouvre maintenant sur
 * « Aujourd'hui », et le logo y ramène. Les anciennes adresses redirigent,
 * elles ne rendent jamais 404.
 *
 * À la place, TROIS ESPACES DE GESTION TRANSVERSES : Vivier · Sourcing ·
 * Diffusion. Ce ne sont PAS des entrées de navigation — la colonne de gauche
 * garde ce rendu — mais des endroits où l'on va ponctuellement, par-dessus les
 * campagnes. D'où des liens TEXTE discrets : leur donner un rendu d'onglet
 * ferait huit entrées concurrentes pour cinq destinations de travail.
 *
 * ⚠️ PAS DE « VALIDATIONS » ICI. Sa population vit sous la puce « À valider »
 * de Candidatures et dans la section d'Aujourd'hui ; une troisième porte
 * recréerait l'onglet qu'on vient de supprimer. Les RÈGLES de validation
 * (seuils par défaut, gabarits de refus) sont dans Réglages.
 */

import Link from 'next/link';

import { LogoutButton } from '@/components/auth/LogoutButton';

import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';
import { OrqaLogo } from './OrqaLogo';

const BANNER_FILL = 'rgba(255, 176, 0, 0.5)';

/**
 * Les espaces de gestion TRANSVERSES — ceux qui ne sont pas une étape du
 * travail mais un stock ou une vue d'ensemble. Ils traversent les campagnes,
 * donc ils ne peuvent pas vivre DANS une campagne.
 */
const ESPACES = [
  { id: 'vivier', label: 'Vivier', href: '/vivier' },
  { id: 'sourcing', label: 'Sourcing', href: '/sourcing' },
  { id: 'diffusion', label: 'Diffusion', href: '/diffusion' },
] as const;

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
  /**
   * Affiche le lien « Paramètres » du bandeau. Par défaut `true`. Mis à
   * `false` sur le workspace recrutement, où l'icône d'engrenage (à droite des
   * onglets) fait déjà l'accès aux paramètres — éviter la redondance.
   */
  showSettings?: boolean;
  /**
   * Les trois espaces transverses. Retirés sur les écrans PUBLICS (réservation
   * d'entretien, page d'un profil sourcé) : un invité n'a rien à y faire, et
   * lui montrer des portes fermées n'aide personne.
   */
  showEspaces?: boolean;
};

export function TopBanner({
  breadcrumb,
  showLogout = true,
  showSettings = true,
  showEspaces = true,
}: TopBannerProps) {
  return (
    <header
      className="sticky top-0 z-50 flex items-center gap-6 px-6 py-2 shadow-[0_1px_0_rgba(255,176,0,0.35)]"
      style={{ background: BANNER_FILL, backdropFilter: 'blur(6px)' }}
    >
      <Link
        href="/aujourdhui"
        aria-label="Revenir à Aujourd’hui"
        data-top-logo
        className="block shrink-0 transition-opacity hover:opacity-90"
      >
        <OrqaLogo width={125} priority />
      </Link>

      {/* LES ESPACES TRANSVERSES — liens texte, jamais des onglets. */}
      {showEspaces ? (
        <nav aria-label="Espaces de gestion" className="flex items-center gap-4">
          {ESPACES.map((e) => (
            <Link
              key={e.href}
              href={e.href}
              data-top-espace={e.id}
              className="font-body text-[13px] text-stone-900/80 underline-offset-4 transition hover:text-stone-900 hover:underline"
            >
              {e.label}
            </Link>
          ))}
        </nav>
      ) : null}

      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="font-body text-[12px] text-stone-900/85">
          <Breadcrumb items={breadcrumb} />
        </div>
      ) : null}
      <nav className="ml-auto flex items-center gap-4">
        {showSettings ? (
          <Link
            href="/settings"
            className="font-body text-[13px] font-semibold text-stone-900/85 transition-opacity hover:opacity-70"
          >
            Paramètres
          </Link>
        ) : null}
        {showLogout ? <LogoutButton /> : null}
      </nav>
    </header>
  );
}
