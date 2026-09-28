'use client';

/**
 * Menu Candidatures — conteneur des 3 niveaux (liste + ruban → panneau →
 * page). Source de données : `/api/candidatures` (jamais le journal). Le ruban
 * (périmètre campagne+période) et la liste (tous filtres) viennent du hook
 * `useCandidatures`. Les options de campagne + le libellé « CAMP · poste »
 * viennent du store (le conteneur en est le propriétaire — la ligne, elle,
 * reste découplée et reçoit le libellé en prop).
 */

import type { TrajectoryStep } from '@/lib/reporting/campaign-trajectory';
import { useCampaignStateFilter } from '@/components/referent/useCampaignStateFilter';
import { AUCUNE_CAMPAGNE } from '@/lib/candidatures/campaign-perimeter';
import {
  campaignFilterResultLabel,
  campaignsMatchingFilters,
  matchesCampaignState,
} from '@/lib/referent/campaign-state';
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
  referentSelectionKey,
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
  initialPassage = null,
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
   * Compteur de carte campagne : les candidatures PASSÉES par une étape,
   * pas seulement celles dont c'est le stade actuel.
   */
  initialPassage?: TrajectoryStep | null;
} = {}) {
  // `useShallow` OBLIGATOIRE : `selectActiveCampaigns` recrée un tableau à chaque
  // appel → sans comparaison superficielle, useSyncExternalStore boucle à
  // l'infini (« Maximum update depth exceeded »). Même pattern que CandidatesCard.
  const campaigns = useCampaignsStore(useShallow(selectActiveCampaigns));
  const { campaignOptions, labelOf, titleOf } = useMemo(() => {
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
  } = useCandidatures(
    // Pré-filtres de navigation croisée, posés DÈS LA CRÉATION de l'état (le
    // composant remonte à chaque entrée dans l'onglet, et le parent remet les
    // pré-filtres à null sur toute navigation manuelle) :
    //  - étape seule (notification métier) : le deep-link doit voir TOUTES les
    //    campagnes (le signal n'est pas scopé aux actives) → sélecteur « Toutes » ;
    //  - campagne (quadrant d'une carte campagne) : sélecteur figé sur CETTE
    //    campagne, étape éventuelle du quadrant en plus.
    initialCampaignId
      ? {
          campaignId: initialCampaignId,
          campaignIds: NO_CAMPAIGN_IDS,
          stage: initialStage ?? null,
          passage: initialPassage,
        }
      : initialStage
        ? { stage: initialStage }
        : undefined,
  );

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
  // L'ÉTAT de campagne, partagé et cumulé au référent (point 3) : il borne le
  // périmètre des candidatures comme le référent, par la même intersection.
  const [stateFilter, setStateFilter] = useCampaignStateFilter(currentUserId);
  const campagnesFiltrees = useMemo(
    () => campaignsMatchingFilters(campaigns, tousReferents, referentFilter, stateFilter),
    [campaigns, tousReferents, referentFilter, stateFilter],
  );
  const campagnesDeLEtat = useMemo(
    () =>
      stateFilter === 'all'
        ? null
        : campaigns.filter((c) => matchesCampaignState(c.status, stateFilter)).map((c) => c.id),
    [campaigns, stateFilter],
  );
  const resultLabel = campaignFilterResultLabel({
    selection: referentFilter,
    currentUserId,
    referentLabel: referentOptions.find(
      (o) => referentSelectionKey(o.selection) === referentSelectionKey(referentFilter),
    )?.label,
    state: stateFilter,
    count: campagnesFiltrees.length,
  });
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
  const referenceDate = useMemo(() => new Date(), []);


  // PÉRIMÈTRE D'ÉTAT : tant qu'aucune campagne précise n'est choisie, les
  // candidatures sont celles des campagnes de l'état filtré (« Actives » par
  // défaut). Une liste vide n'est JAMAIS « toutes » : sentinelle explicite.
  useEffect(() => {
    if (filters.campaignId) return;
    setFilters({
      campaignIds:
        campagnesDeLEtat === null
          ? NO_CAMPAIGN_IDS
          : campagnesDeLEtat.length > 0
            ? campagnesDeLEtat
            : [AUCUNE_CAMPAGNE],
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagnesDeLEtat, filters.campaignId]);

  // Sélecteur campagne : 'all' (les campagnes des deux filtres) | <id>.
  const campaignValue = filters.campaignId || 'all';
  const onCampaign = (v: string) => {
    if (v === 'all') setFilters({ campaignId: '' });
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
    setPeriod('all');
    setFilters({
      campaignId: '',
      from: '',
      to: '',
      search: '',
      stage: null,
      fromVivier: false,
      passage: null,
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
            state={{ value: stateFilter, onChange: setStateFilter }}
            result={resultLabel}
          />
          <CandidaturesFilters
            campaignOptions={campaignOptions.filter((o) => campagnesFiltrees.some((c) => c.id === o.id))}
            campaignValue={campaignValue}
            onCampaign={onCampaign}
            search={filters.search}
            onSearch={(v) => setFilters({ search: v })}
            period={period}
            onPeriod={onPeriod}
            fromVivier={filters.fromVivier}
            onVivier={(b) => setFilters({ fromVivier: b })}
            passage={filters.passage}
            onClearPassage={() => setFilters({ passage: null })}
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
          {/* Accès à la revue GROUPÉE, attaché aux deux puces d'attente
              (« À valider », « Propositions de refus ») — il n'apparaît que
              quand l'une d'elles est sélectionnée, d'où qu'on vienne. La page
              de revue montre les DEUX files : c'est elle qui porte le refus
              groupé des propositions. */}
          {filters.stage === 'a_valider' || filters.stage === 'proposition_refus' ? (
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
