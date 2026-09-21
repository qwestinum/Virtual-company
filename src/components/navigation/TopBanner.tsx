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
 * À la place, QUATRE ESPACES DE GESTION TRANSVERSES, groupés À DROITE, juste
 * avant le compte : Vivier · Sourcing · Diffusion · Revue de candidature. Ce
 * ne sont PAS des entrées de navigation — la colonne de gauche garde ce rendu
 * — mais des endroits où l'on va ponctuellement, par-dessus les campagnes.
 * D'où des liens TEXTE : leur donner un rendu d'onglet ferait neuf entrées
 * concurrentes pour cinq destinations de travail.
 *
 * ⚠️ « Revue de candidature » n'est PAS un troisième chemin vers la même
 * population : c'est la revue GROUPÉE, celle qui passe les propositions de
 * refus en une fois. La décision à l'unité reste sous la puce « À valider » de
 * Candidatures. Son indicateur compte ce qui attend — un lien qui mène à une
 * pile sans en dire la taille oblige à cliquer pour savoir s'il y a lieu.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { LogoutButton } from '@/components/auth/LogoutButton';
import { CountBadge } from '@/components/ui/CountBadge';
import { dedupeFetch } from '@/lib/net/dedupe-fetch';

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
  { id: 'revue', label: 'Revue de candidature', href: '/candidatures/validation' },
] as const;

/**
 * Combien de candidatures attendent une validation.
 *
 * `dedupeFetch` : la colonne pose déjà cette question pour son badge. Deux
 * composants qui la posent en même temps ne déclenchent qu'une requête.
 * Zéro ⇒ AUCUN indicateur : un « 0 » sur un lien se lit comme un compteur en
 * panne.
 */
function useValidationsEnAttente(actif: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!actif) return;
    let vivant = true;
    void (async () => {
      try {
        const res = await dedupeFetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as { validations?: unknown[] };
        if (vivant) setN(json.validations?.length ?? 0);
      } catch {
        // Silencieux : un indicateur absent vaut mieux qu'une erreur en haut
        // de chaque écran.
      }
    })();
    return () => {
      vivant = false;
    };
  }, [actif]);
  return n;
}

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
  const enAttente = useValidationsEnAttente(showEspaces);
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

      {breadcrumb && breadcrumb.length > 0 ? (
        <div className="font-body text-[12px] text-stone-900/85">
          <Breadcrumb items={breadcrumb} />
        </div>
      ) : null}

      {/* LES ESPACES TRANSVERSES — à DROITE, juste avant le compte. Liens
          texte en vert gras, jamais des onglets. */}
      <nav className="ml-auto flex items-center gap-5" aria-label="Espaces de gestion">
        {showEspaces
          ? ESPACES.map((e) => (
              <Link
                key={e.href}
                href={e.href}
                data-top-espace={e.id}
                className="inline-flex items-center gap-1.5 font-body text-[13px] font-bold underline-offset-4 transition hover:underline"
                style={{ color: 'var(--dash-green-bandeau)' }}
              >
                {e.label}
                {e.id === 'revue' && enAttente > 0 ? (
                  <CountBadge
                    tone="alert"
                    title={`${enAttente} candidature${enAttente > 1 ? 's attendent' : ' attend'} votre validation`}
                  >
                    {enAttente}
                  </CountBadge>
                ) : null}
              </Link>
            ))
          : null}
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
