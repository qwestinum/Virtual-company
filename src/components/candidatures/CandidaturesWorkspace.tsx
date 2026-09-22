'use client';

/**
 * Menu Candidatures — conteneur des 3 niveaux (liste + ruban → panneau →
 * page). Source de données : `/api/candidatures` (jamais le journal). Le ruban
 * (périmètre campagne+période) et la liste (tous filtres) viennent du hook
 * `useCandidatures`. Les options de campagne + le libellé « CAMP · poste »
 * viennent du store (le conteneur en est le propriétaire — la ligne, elle,
 * reste découplée et reçoit le libellé en prop).
 */

import { PageShell } from '@/components/navigation/PageShell';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { CandidateStage } from '@/lib/reporting/candidate-stage';

import {
  selectActiveCampaigns,
  useCampaignsStore,
} from '@/stores/campaigns-store';
import type { CandidateListItem } from '@/types/reporting';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { useReferentContext } from '@/components/referent/useReferentContext';
import { useReferentFilter } from '@/components/referent/useReferentFilter';
import {
  activeReferentOf,
  buildReferentOptionsBy,
  campaignIdsForSelection,
  myReferentCountBy,
} from '@/lib/referent/filter';

import { CandidatureFullPage } from './CandidatureFullPage';
import { CandidaturePanel } from './CandidaturePanel';
import { CandidatureRow } from './CandidatureRow';
import { CandidaturesFilters, type PeriodKey } from './CandidaturesFilters';
import { CandidaturesRibbon } from './CandidaturesRibbon';
import { useVisibleHeight } from './useVisibleHeight';
import {
  CANDIDATURES_PAGE_SIZE,
  NO_CAMPAIGN_IDS,
  useCandidatures,
} from './useCandidatures';

/** Borne basse (jour ISO) pour une fenêtre de N jours à partir de `ref`. */
function isoDayMinus(ref: Date, days: number): string {
  const d = new Date(ref);
  d.setDate(ref.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function CandidaturesWorkspace({
  initialStage = null,
  initialCampaignId = null,
  initialEverInvited = false,
  initialEverInterviewed = false,
}: {
  /**
   * Pré-filtre étape appliqué UNE fois au montage (navigation depuis une
   * notification métier — ex. « Entretien fait »). Optionnel : null = aucun
   * effet, les navigations existantes sont inchangées. L'utilisateur reste
   * libre de changer/retirer le chip ensuite.
   */
  initialStage?: CandidateStage | null;
  /**
   * Pré-filtre campagne appliqué UNE fois au montage (navigation depuis un
   * quadrant de carte campagne — onglet Campagnes). Se combine avec
   * `initialStage` (quadrant « Entretiens » → campagne + entretien_fait).
   * L'utilisateur reste libre de changer le sélecteur ensuite.
   */
  initialCampaignId?: string | null;
  /**
   * Quadrant « Shortlistés / Invités » : tous ceux PASSÉS par l'invitation
   * (status accepted), pas seulement ceux dont c'est le stade actuel.
   */
  initialEverInvited?: boolean;
  /**
   * Quadrant « Entretiens » : entretien marqué réalisé, quel que soit le
   * stade actuel (un « Retenu » a bien passé son entretien).
   */
  initialEverInterviewed?: boolean;
} = {}) {
  // `useShallow` OBLIGATOIRE : `selectActiveCampaigns` recrée un tableau à chaque
  // appel → sans comparaison superficielle, useSyncExternalStore boucle à
  // l'infini (« Maximum update depth exceeded »). Même pattern que CandidatesCard.
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));
  const { campaignOptions, labelOf, titleOf, activeIds } = useMemo(() => {
    const opts = campaigns.map((c) => ({
      id: c.id,
      label: `${c.id} · ${c.fdp.fields.job_title?.value ?? 'Poste non précisé'}`,
    }));
    const map = new Map(opts.map((o) => [o.id, o.label]));
    // Intitulé du poste SEUL (chip de mise en évidence dans la ligne et le
    // panneau) — null si absent/vide : le lecteur retombe sur le libellé
    // combiné « CAMP · Poste non précisé ».
    const titles = new Map(
      campaigns.map((c) => {
        const v = c.fdp.fields.job_title?.value;
        return [
          c.id,
          typeof v === 'string' && v.trim().length > 0 ? v.trim() : null,
        ] as const;
      }),
    );
    return {
      campaignOptions: opts,
      labelOf: (id: string | null) => (id ? map.get(id) ?? id : null),
      titleOf: (id: string | null) => (id ? titles.get(id) ?? null : null),
      activeIds: campaigns.filter((c) => c.status === 'active').map((c) => c.id),
    };
  }, [campaigns]);

  const {
    filters,
    setFilters,
    counts,
    rows,
    referents,
    listTotal,
    loadingList,
    page,
    setPage,
    refresh,
  } = useCandidatures();

  // Référent ACTIF de la campagne d'une fiche — même règle et même rendu que
  // la file des validations et l'onglet Entretiens (cf. lib/referent/filter).
  const referentOf = (campaignId: string | null) =>
    campaignId ? activeReferentOf(campaignId, referents) : null;

  // ⚠️ LE MÊME FILTRE, AU MÊME ENDROIT que sur Entretiens : la barre ouvre la
  // barre d'outils, et l'état est PARTAGÉ entre les écrans (mémorisé par
  // recruteur). Le référent est celui de la CAMPAGNE — le référentiel complet
  // vient d'une route dédiée, parce que cet écran ne voit qu'une PAGE de
  // candidatures et ne peut donc pas en déduire les campagnes.
  const { referents: tousReferents, currentUserId } = useReferentContext();
  const [referentFilter, setReferentFilter] = useReferentFilter(currentUserId);
  const campagnesDuReferent = useMemo(
    () => campaignIdsForSelection(tousReferents, referentFilter),
    [tousReferents, referentFilter],
  );
  const referentOptions = useMemo(() => {
    const entrees = Object.keys(tousReferents).map((id) => ({ id }));
    return buildReferentOptionsBy(entrees, (c) =>
      activeReferentOf(c.id, tousReferents),
    );
  }, [tousReferents]);
  const myReferentCount = useMemo(
    () =>
      myReferentCountBy(
        Object.keys(tousReferents).map((id) => ({ id })),
        (c) => activeReferentOf(c.id, tousReferents),
        currentUserId,
      ),
    [tousReferents, currentUserId],
  );

  // Le périmètre du référent descend dans les FILTRES : la requête est
  // paginée côté serveur, filtrer les lignes reçues ne filtrerait qu'une page.
  useEffect(() => {
    setFilters({ referentCampaignIds: campagnesDuReferent });
    setPage(0);
  }, [campagnesDuReferent, setFilters, setPage]);

  const [panelItem, setPanelItem] = useState<CandidateListItem | null>(null);
  const [fullItem, setFullItem] = useState<CandidateListItem | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('all');

  // ⚠️ LA VUE CHANGE, LE PANNEAU SE REFERME. Changer d'étape, de campagne, de
  // période ou de page affiche une AUTRE liste : le panneau restait ouvert
  // sur un dossier qui n'y figurait plus (bug du 22/09/2026). Remis à zéro
  // PENDANT LE RENDU, pas dans un effet — sinon il survivrait une frame à
  // la liste qui ne le contient plus. Une action sur le dossier (`onActed`)
  // ne change pas la vue : le panneau reste, et montre le résultat.
  const cleVue = JSON.stringify([filters, page, period]);
  const [vueDuPanneau, setVueDuPanneau] = useState(cleVue);
  if (cleVue !== vueDuPanneau) {
    setVueDuPanneau(cleVue);
    if (panelItem) setPanelItem(null);
  }
  const colonnePanneau = useRef<HTMLDivElement>(null);
  const hauteurPanneau = useVisibleHeight(colonnePanneau, panelItem !== null);
  // L'utilisateur a touché au sélecteur de campagne : la vue par défaut
  // (campagnes actives) cesse de s'imposer.
  const [campaignTouched, setCampaignTouched] = useState(false);
  const referenceDate = useMemo(() => new Date(), []);

  // Pré-filtres de navigation croisée — appliqués une seule fois au montage ;
  // le composant remonte à chaque entrée dans l'onglet, et le parent remet les
  // pré-filtres à null sur toute navigation manuelle.
  //  - étape seule (notification métier) : le deep-link doit voir TOUTES les
  //    campagnes (le signal n'est pas scopé aux actives) → sélecteur « Toutes » ;
  //  - campagne (quadrant d'une carte campagne) : sélecteur figé sur CETTE
  //    campagne, étape éventuelle du quadrant en plus.
  useEffect(() => {
    if (initialCampaignId) {
      setCampaignTouched(true);
      setFilters({
        campaignId: initialCampaignId,
        campaignIds: NO_CAMPAIGN_IDS,
        stage: initialStage ?? null,
        everInvited: initialEverInvited,
        everInterviewed: initialEverInterviewed,
      });
    } else if (initialStage) {
      setCampaignTouched(true);
      setFilters({ stage: initialStage });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // VUE PAR DÉFAUT : candidatures des campagnes ACTIVES. Appliquée au montage
  // et maintenue tant que l'utilisateur n'a pas choisi lui-même une campagne
  // (le store se charge en asynchrone — activeIds arrive après le 1er rendu).
  useEffect(() => {
    if (campaignTouched || initialStage || initialCampaignId) return;
    setFilters({
      campaignId: '',
      campaignIds: activeIds.length > 0 ? activeIds : NO_CAMPAIGN_IDS,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIds, campaignTouched]);

  // Sélecteur campagne : 'all' | 'active' (ensemble) | <id> (campagne précise).
  const campaignValue =
    filters.campaignIds.length > 0 ? 'active' : filters.campaignId || 'all';
  const onCampaign = (v: string) => {
    setCampaignTouched(true);
    if (v === 'active') setFilters({ campaignId: '', campaignIds: activeIds });
    else if (v === 'all')
      setFilters({ campaignId: '', campaignIds: NO_CAMPAIGN_IDS });
    else setFilters({ campaignId: v, campaignIds: NO_CAMPAIGN_IDS });
  };
  const onPeriod = (v: PeriodKey) => {
    setPeriod(v);
    if (v === 'all') setFilters({ from: '', to: '' });
    else setFilters({ from: isoDayMinus(referenceDate, Number(v)), to: '' });
  };
  // « Toutes » : RÉINITIALISATION complète de la vue — étape, recherche,
  // période, origine vivier ET campagne (retour au défaut campagnes actives).
  const onResetView = () => {
    setCampaignTouched(false);
    setPeriod('all');
    setFilters({
      campaignId: '',
      campaignIds: activeIds.length > 0 ? activeIds : NO_CAMPAIGN_IDS,
      from: '',
      to: '',
      search: '',
      stage: null,
      fromVivier: false,
      everInvited: false,
      everInterviewed: false,
    });
  };

  // Une action ne ferme NI le panneau NI la page : on rafraîchit seulement la
  // liste + le ruban en arrière-plan (le panneau/la page re-fetchent leur propre
  // détail et mettent à jour l'étape + les actions proposées).
  const onActed = () => refresh();

  const pageCount = Math.max(1, Math.ceil(listTotal / CANDIDATURES_PAGE_SIZE));

  return (
    // ⚠️ GABARIT COMMUN. L'écran posait son propre cadre : pleine largeur, pas
    // de conteneur borné, et un fond `dash-bg` qui n'est pas celui du
    // workspace — en arrivant depuis Campagnes, la page s'élargissait ET
    // changeait de couleur. Sa peau divergente (Fraunces, marine, bleu-gris)
    // a été retirée le 21/09/2026 : cet écran porte désormais celle du
    // produit, et c'est toujours SA structure que les autres ont reprise.
    <PageShell
      title="Candidatures"
      subtitle={`${listTotal} candidature${listTotal > 1 ? 's' : ''}`}
      // ⚠️ LES FENTES DU GABARIT : filtres et ruban ne sont plus empilés par
      // l'écran avec ses propres marges — ils se rangent dans la zone de tête,
      // où les espacements sont nommés une fois pour les cinq onglets.
      toolbar={
        <div className="flex flex-col gap-2.5">
          <ReferentFilterBar
            options={referentOptions}
            selection={referentFilter}
            onChange={setReferentFilter}
            myCount={myReferentCount}
            currentUserId={currentUserId}
          />
          <CandidaturesFilters
          campaignOptions={campaignOptions}
          activeCount={activeIds.length}
          campaignValue={campaignValue}
          onCampaign={onCampaign}
          search={filters.search}
          onSearch={(v) => setFilters({ search: v })}
          period={period}
          onPeriod={onPeriod}
          fromVivier={filters.fromVivier}
          onVivier={(b) => setFilters({ fromVivier: b })}
          everInvited={filters.everInvited}
          onClearEverInvited={() => setFilters({ everInvited: false })}
          everInterviewed={filters.everInterviewed}
          onClearEverInterviewed={() => setFilters({ everInterviewed: false })}
            onReset={onResetView}
          />
        </div>
      }
      counters={
        <>
          <CandidaturesRibbon
            counts={counts}
            active={filters.stage}
            onSelect={(stage) => setFilters({ stage })}
          />
          {/* Accès à la revue GROUPÉE, attaché à la puce « À valider » — il
              n'apparaît que quand cette puce est sélectionnée, d'où qu'on
              vienne : un clic dans le ruban comme une arrivée par l'adresse
              `?statut=a_valider`. C'est la seule porte vers le mode groupé
              depuis que l'onglet dédié a disparu du premier niveau. */}
          {filters.stage === 'a_valider' ? (
            <div className="mt-2 flex justify-end">
              <Link
                href="/candidatures/validation"
                className="inline-flex min-h-6 items-center gap-1.5 rounded-md border border-stone-300 bg-white px-2.5 py-1 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50"
              >
                Passer en revue en une fois
                <span aria-hidden>→</span>
              </Link>
            </div>
          ) : null}
        </>
      }
    >
      <>
        <div className="flex items-start gap-5">
          <div className="min-w-0 flex-1">
          {loadingList && rows.length === 0 ? (
            <p className="font-body text-[13px] text-dash-text-tertiary">Chargement…</p>
          ) : rows.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-display text-[19px] text-dash-text">
                Aucune candidature ne correspond
              </p>
              <p className="mt-1.5 font-body text-[13px] text-dash-text-secondary">
                Ajustez les filtres ou l&apos;étape sélectionnée pour élargir la recherche.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {rows.map((item) => (
                <li key={item.id}>
                  <CandidatureRow
                    item={item}
                    campaignLabel={labelOf(item.campaignId)}
                    jobTitle={titleOf(item.campaignId)}
                    selected={panelItem?.id === item.id}
                    onClick={() => setPanelItem(item)}
                  />
                </li>
              ))}
            </ul>
          )}

          {pageCount > 1 ? (
            <div className="mt-5 flex items-center justify-center gap-3 font-body text-[12px]">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
                className="rounded-[10px] border border-dash-border bg-white px-3 py-1.5 font-medium text-dash-text transition hover:border-dash-blue disabled:opacity-40"
              >
                Précédent
              </button>
              <span className="font-data text-dash-text-secondary">
                Page {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(page + 1)}
                className="rounded-[10px] border border-dash-border bg-white px-3 py-1.5 font-medium text-dash-text transition hover:border-dash-blue disabled:opacity-40"
              >
                Suivant
              </button>
            </div>
          ) : null}
          </div>

          {panelItem ? (
            <div
              ref={colonnePanneau}
              data-candidature-panel-column
              className="sticky top-6 w-[420px] shrink-0 self-start"
              // ⚠️ HAUTEUR IMPOSÉE, pas un plafond : avec un simple
              // `max-height`, le panneau gardait sa hauteur de contenu
              // (1 371 px mesurés pour une fenêtre de 900) et débordait sous
              // le pli. Il occupe exactement l'espace VISIBLE sous lui —
              // mesuré, pas deviné (`useVisibleHeight`) — et fait défiler son
              // propre contenu.
              style={{ height: hauteurPanneau ?? 'calc(100vh - 150px)' }}
            >
              <CandidaturePanel
                item={panelItem}
                referent={referentOf(panelItem.campaignId)}
                campaignLabel={labelOf(panelItem.campaignId)}
                jobTitle={titleOf(panelItem.campaignId)}
                onClose={() => setPanelItem(null)}
                onOpenFull={() => setFullItem(panelItem)}
                onActed={onActed}
              />
            </div>
          ) : null}
        </div>
      </>

      {fullItem ? (
        <CandidatureFullPage
          item={fullItem}
          referent={referentOf(fullItem.campaignId)}
          onClose={() => setFullItem(null)}
          onActed={onActed}
        />
      ) : null}
    </PageShell>
  );
}
