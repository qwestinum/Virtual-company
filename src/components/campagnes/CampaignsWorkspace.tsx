'use client';

/**
 * Onglet « Campagnes » du workspace recrutement.
 *
 * Héberge la gestion de campagne complète (liste, création, édition, actions de
 * cycle de vie), extraite de `DashboardView` sans changement de logique. Les
 * données candidats viennent de `useDashboardData()` (mêmes stats par carte) ;
 * l'ouverture des sheets d'édition/création se fait par id local, comme avant.
 *
 * L'hydratation du store campagnes est portée par `<HydrationGate />` du
 * workspace recrutement (déjà monté) — rien à initialiser ici.
 *
 * ⚠️ L'URL est un ORDRE, pas un état — et il se CONSOMME (défaut du 21/09,
 * régression S29). Ce qu'elle demande (`?ouvrir=vivier`, `?nouvelle=1`) était
 * lu dans l'initialiseur d'un `useState`, qui ne s'exécute QU'AU MONTAGE. Or
 * les portes de la carte (« Chercher dans le vivier », « Diffuser l'annonce »)
 * mènent à la page DÉJÀ affichée : Next ne remonte rien, l'initialiseur ne
 * repasse jamais, et le lien ne faisait rien. Le même lien venu d'*Aujourd'hui*
 * marchait — parce que là, c'est un changement d'écran. D'où un effet, et le
 * retrait du paramètre une fois servi : sans ce retrait, re-cliquer la MÊME
 * porte après avoir refermé la feuille ne changerait pas l'adresse, donc
 * n'ouvrirait plus rien.
 */

import { usePathname, useRouter } from 'next/navigation';
import { useMemo, useEffect, useRef, useState } from 'react';

import { PARAM, nouvelleCampagneHref } from '@/lib/navigation/workspace-routes';

import { PageShell } from '@/components/navigation/PageShell';

import { CampaignsList } from './CampaignsList';
import { UnsavedChangesBanner } from './UnsavedChangesBanner';
import type { BlockKey } from './edit/CampaignEditAccordion';
import { CampaignEditSheet } from './edit/CampaignEditSheet';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { useReferentContext } from '@/components/referent/useReferentContext';
import { useReferentFilter } from '@/components/referent/useReferentFilter';
import {
  activeReferentOf,
  buildReferentOptionsBy,
  myReferentCountBy,
} from '@/lib/referent/filter';

/** Ce que la feuille d'édition montre : une campagne, et par quoi commencer. */
type Edition = { campaignId: string; section?: BlockKey };

export function CampaignsWorkspace({
  focusCampaignId = null,
  openCreate = false,
  openSection = null,
}: {
  /**
   * Navigation croisée : un quadrant de carte campagne (« CV reçus »,
   * « Entretiens »…) ouvre l'onglet Candidatures pré-filtré sur la campagne
   * (+ préset du quadrant). Optionnel : absent = quadrants non cliquables.
   */
  /** Campagne à ouvrir, désignée par l'URL (« retour à la campagne »). */
  focusCampaignId?: string | null;
  /**
   * `/campagnes?nouvelle=1` — l'ANCIENNE adresse de la création. Elle ne monte
   * plus de feuille : elle REDIRIGE vers `/campagnes/nouvelle` (l'assistant du
   * lot 5). Un lien vieilli ou un favori doit continuer de déposer devant le
   * bon écran, pas sur une liste.
   */
  openCreate?: boolean;
  /**
   * Bloc d'édition à ouvrir (`?ouvrir=vivier`). C'est ce qui fait que
   * « Chercher dans le vivier », depuis la carte, dépose devant le vivier —
   * un bouton qui nomme un geste doit déposer devant ce geste.
   */
  openSection?: BlockKey | null;
} = {}) {
  const pathname = usePathname();
  const router = useRouter();

  // ⚠️ La section vit ICI, en état local, et n'est PAS relue de l'URL au fil
  // des rendus : on retire le paramètre une fois servi, et un bloc qui se
  // refermerait à ce moment-là refermerait précisément ce qu'on vient
  // d'ouvrir.
  const [edition, setEdition] = useState<Edition | null>(null);

  // Nettoyage de l'adresse : `campagne` RESTE (c'est une position, on la
  // partage et on y revient), `ouvrir` et `nouvelle` partent (ce sont des
  // gestes, déjà faits).
  const servi = useRef<string | null>(null);
  useEffect(() => {
    // ⚠️ Le repère se REMET À ZÉRO quand l'adresse ne demande plus rien —
    // c'est-à-dire juste après qu'on l'a nettoyée. Sans ce retour à zéro, la
    // MÊME porte cliquée une seconde fois porterait la même demande, serait
    // prise pour un doublon, et n'ouvrirait plus rien (S29.3).
    if (!openSection && !openCreate) {
      servi.current = null;
      return;
    }
    const demande = `${focusCampaignId ?? ''}|${openSection ?? ''}|${openCreate ? '1' : ''}`;
    if (servi.current === demande) return;
    servi.current = demande;

    // L'adresse EST le système externe qu'on synchronise ici, et l'ordre ne
    // se joue qu'une fois (repère `servi`, puis nettoyage juste en dessous).
    // Le lire pendant le rendu ne suffirait pas : il faut aussi RETIRER le
    // paramètre, et ça, c'est un effet.
    if (openSection && focusCampaignId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEdition({ campaignId: focusCampaignId, section: openSection });
    }

    // ⚠️ `history.replaceState` et NON `router.replace` : le second déclenche
    // un aller-retour serveur, et tant qu'il n'a pas abouti l'adresse porte
    // encore `ouvrir=…` — re-cliquer la même porte y est alors une navigation
    // vers l'URL courante, donc un geste sans effet. Next accepte l'API
    // native de l'historique et resynchronise `useSearchParams` : c'est
    // immédiat, et il n'y a rien à re-télécharger pour retirer un paramètre.
    const reste = focusCampaignId
      ? `?${PARAM.campagne}=${encodeURIComponent(focusCampaignId)}`
      : '';
    if (openCreate) {
      router.replace(nouvelleCampagneHref());
      return;
    }
    window.history.replaceState(null, '', `${pathname}${reste}`);
  }, [focusCampaignId, openSection, openCreate, pathname, router]);

  const { referents, currentUserId } = useReferentContext();
  const [referentFilter, setReferentFilter] = useReferentFilter(currentUserId);
  const entrees = useMemo<{ id: string }[]>(
    () => Object.keys(referents).map((id) => ({ id })),
    [referents],
  );
  const referentOptions = useMemo(
    () => buildReferentOptionsBy(entrees, (c) => activeReferentOf(c.id, referents)),
    [entrees, referents],
  );
  const myCount = useMemo(
    () =>
      myReferentCountBy(entrees, (c) => activeReferentOf(c.id, referents), currentUserId),
    [entrees, referents, currentUserId],
  );

  return (
    <PageShell
      title="Gestion des campagnes"
      subtitle="Vos campagnes de recrutement : création, édition, et pilotage du cycle de vie (suspendre, arrêter, reprendre)."
      // ⚠️ LE MÊME FILTRE, AU MÊME ENDROIT que sur les autres onglets, et le
      // MÊME ÉTAT : cocher « Mes campagnes » ici, c'est le retrouver coché
      // sur Candidatures, Entretiens et Pilotage.
      toolbar={
        <ReferentFilterBar
          options={referentOptions}
          selection={referentFilter}
          onChange={setReferentFilter}
          myCount={myCount}
          currentUserId={currentUserId}
        />
      }
    >
      <>
        <UnsavedChangesBanner />
        <CampaignsList
          focusCampaignId={focusCampaignId}
          referentFilter={referentFilter}
          referents={referents}
          onEditCampaign={(campaignId) => setEdition({ campaignId })}
        />
      </>
      {edition ? (
        // `key` : changer de campagne OU de bloc demandé remonte la feuille,
        // pour que l'accordéon reparte sur le bloc nommé. Sans ça, ouvrir une
        // seconde porte sur une feuille déjà ouverte ne bougerait rien.
        <CampaignEditSheet
          key={`${edition.campaignId}:${edition.section ?? 'defaut'}`}
          campaignId={edition.campaignId}
          initialSection={edition.section}
          onClose={() => setEdition(null)}
        />
      ) : null}
    </PageShell>
  );
}
