'use client';

/**
 * Hub « Validation suspendue » (HITL 3 zones, lot 2d ; refus groupé).
 *
 * Les candidatures en ZONE GRISE (ni refus auto ni acceptation auto) à
 * trancher. Chaque carte propose deux actions (accepter / refuser) + relecture
 * du mail avant envoi (cf. ValidationCard). Une candidature traitée disparaît
 * de la file et reste consultable dans l'historique (status 'sent').
 *
 * DEUX SOUS-ONGLETS depuis le refus groupé, et une seule file en dessous : la
 * partition est stricte (cf. partitionRejectionProposals), rien ne tombe entre
 * les deux.
 *
 * Par-dessus, un FILTRE par recruteur référent (cf. lib/referent/filter) : une
 * commodité de LECTURE, jamais une restriction d'accès — tout reste
 * consultable et actionnable par tout le monde.
 */

import { useState } from 'react';

import {
  activeReferentOf,
  ALL_REFERENTS,
  buildReferentOptions,
  filterByReferent,
  myCampaignsCount,
  referentSelectionKey,
  type ReferentSelection,
} from '@/lib/referent/filter';
import {
  defaultValidationSubTab,
  partitionRejectionProposals,
  sortRejectionProposals,
  type ValidationSubTab,
} from '@/lib/hitl/rejection-proposal';
import type { PendingValidation } from '@/types/hitl';

import { EmptyQueueNotice } from './EmptyQueueNotice';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { RejectionProposalsTab } from './RejectionProposalsTab';
import { SettledValidationCard } from './SettledValidationCard';
import { SubTabButton } from './SubTabButton';
import { useValidationsQueue } from './use-validations-queue';
import { ValidationCard } from './ValidationCard';
import { ValidationsHistory } from './ValidationsHistory';

export function ValidationsHub() {
  const {
    state,
    zones,
    coherence,
    referents,
    currentUserId,
    history,
    loadHistory,
    applySent,
    applyBatchDone,
  } = useValidationsQueue();
  // Filtre de LECTURE, volontairement NON persisté (ni URL, ni localStorage) :
  // un filtre oublié qui masque des dossiers est pire que pas de filtre.
  const [referentFilter, setReferentFilter] =
    useState<ReferentSelection>(ALL_REFERENTS);
  // `null` = « le sous-onglet d'arrivée n'est pas encore pris ». Il ne peut pas
  // l'être ici : à ce stade la file est en chargement et les comptes sont
  // inconnus. Il est donc pris PLUS BAS, pendant le rendu — pas dans un
  // `useEffect`, qui afficherait le mauvais onglet pendant une frame.
  const [tab, setTab] = useState<ValidationSubTab | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const flashMessage = (message: string, ms: number) => {
    setFlash(message);
    window.setTimeout(() => setFlash(null), ms);
  };

  const toggleHistory = () => {
    setShowHistory((v) => !v);
    void loadHistory();
  };

  if (state.kind === 'loading') {
    return (
      <p className="font-body text-stone-500 text-sm">
        Chargement des validations…
      </p>
    );
  }
  if (state.kind === 'error') {
    return (
      <p className="font-body text-rose-600 text-sm">
        Impossible de charger les validations ({state.message}).
      </p>
    );
  }

  const { items } = state;

  const onSent = (v: PendingValidation, message: string) => {
    applySent(v);
    flashMessage(message, 3500);
  };

  const onBatchDone = (treatedIds: string[], message: string) => {
    applyBatchDone(treatedIds);
    flashMessage(message, 6000);
  };

  // La PARTITION reste faite sur la file ENTIÈRE (zone figée au scoring) : le
  // filtre est posé PAR-DESSUS, il ne redistribue rien entre les sous-onglets.
  // Les totaux non filtrés restent affichés — un dossier caché reste compté.
  const { proposals, toExamine } = partitionRejectionProposals(items, zones);
  const sortedProposals = sortRejectionProposals(proposals);

  const referentOf = (id: string) => activeReferentOf(id, referents);
  const filterKey = referentSelectionKey(referentFilter);
  const options = buildReferentOptions(items, referents);
  const myCount = myCampaignsCount(items, referents, currentUserId);

  // Sous-onglet d'arrivée, pris UNE SEULE FOIS sur les comptes NON FILTRÉS
  // (cf. defaultValidationSubTab), puis figé dans l'état.
  //
  // ⚠️ Il serait faux de le recalculer à chaque rendu : traiter la dernière
  // proposition ferait retomber le calcul sur « À examiner », et l'écran
  // basculerait TOUT SEUL sous le message qui confirme le traitement — on
  // lirait « 2 candidatures refusées » sous un onglet qui n'est pas celui où
  // on vient d'agir. Une fois pris, l'onglet appartient à l'utilisateur.
  //
  // Ajustement d'état PENDANT le rendu (React le prévoit) : la garde `=== null`
  // ne passe qu'au premier rendu où la file est chargée, donc pas de boucle.
  if (tab === null) {
    setTab(defaultValidationSubTab(toExamine.length, proposals.length));
  }
  const activeTab =
    tab ?? defaultValidationSubTab(toExamine.length, proposals.length);

  const visibleExamine = filterByReferent(toExamine, referents, referentFilter);
  const visibleProposals = filterByReferent(
    sortedProposals,
    referents,
    referentFilter,
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="font-body text-[13px] text-stone-600">
          <strong className="font-semibold">{items.length}</strong> candidature
          {items.length > 1 ? 's' : ''} en zone de validation.
        </p>
        <button
          type="button"
          onClick={toggleHistory}
          className="font-body text-[12px] font-semibold text-stone-500 hover:text-stone-800"
        >
          {showHistory ? 'Masquer l’historique' : 'Historique'}
        </button>
      </div>
      {flash ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800 font-body">
          {flash}
        </div>
      ) : null}

      <ReferentFilterBar
        options={options}
        selection={referentFilter}
        onChange={setReferentFilter}
        myCount={myCount}
        currentUserId={currentUserId}
      />

      <div className="flex items-center gap-1 border-b border-stone-200">
        <SubTabButton
          active={activeTab === 'examine'}
          label="À examiner"
          count={visibleExamine.length}
          total={toExamine.length}
          onClick={() => setTab('examine')}
        />
        <SubTabButton
          active={activeTab === 'proposals'}
          label="Propositions de refus"
          count={visibleProposals.length}
          total={sortedProposals.length}
          onClick={() => setTab('proposals')}
        />
      </div>

      {activeTab === 'proposals' ? (
        <RejectionProposalsTab
          items={visibleProposals}
          onSent={onSent}
          onBatchDone={onBatchDone}
          referentOf={referentOf}
          filterKey={filterKey}
          maskedByFilter={sortedProposals.length - visibleProposals.length}
          coherence={coherence}
        />
      ) : visibleExamine.length === 0 ? (
        <EmptyQueueNotice
          maskedByFilter={toExamine.length}
          emptyLabel="Aucune candidature en attente de validation."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleExamine.map((v) => {
            // DÉSARMÉE, jamais masquée : un dossier qui n'attend plus ne doit
            // pas offrir d'arbitrage, mais sa disparition silencieuse serait
            // pire (cf. plan-coherence-file-analyse-2026-09-20.md, lot 0).
            const c = coherence[v.id];
            return c?.kind === 'settled' ? (
              <SettledValidationCard
                key={v.id}
                v={v}
                reason={c.reason}
                onSettled={onSent}
                referent={referentOf(v.campaignId)}
              />
            ) : (
              <ValidationCard
                key={v.id}
                v={v}
                onSent={onSent}
                referent={referentOf(v.campaignId)}
              />
            );
          })}
        </div>
      )}

      {showHistory ? <ValidationsHistory items={history} /> : null}
    </div>
  );
}
