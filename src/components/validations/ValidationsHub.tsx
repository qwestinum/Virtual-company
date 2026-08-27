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
  partitionRejectionProposals,
  sortRejectionProposals,
} from '@/lib/hitl/rejection-proposal';
import type { PendingValidation } from '@/types/hitl';

import { EmptyQueueNotice } from './EmptyQueueNotice';
import { ReferentFilterBar } from '@/components/referent/ReferentFilterBar';
import { RejectionProposalsTab } from './RejectionProposalsTab';
import { SubTabButton } from './SubTabButton';
import { useValidationsQueue } from './use-validations-queue';
import { ValidationCard } from './ValidationCard';
import { ValidationsHistory } from './ValidationsHistory';

type SubTab = 'examine' | 'proposals';

export function ValidationsHub() {
  const {
    state,
    zones,
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
  const [tab, setTab] = useState<SubTab>('examine');
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
          active={tab === 'examine'}
          label="À examiner"
          count={visibleExamine.length}
          total={toExamine.length}
          onClick={() => setTab('examine')}
        />
        <SubTabButton
          active={tab === 'proposals'}
          label="Propositions de refus"
          count={visibleProposals.length}
          total={sortedProposals.length}
          onClick={() => setTab('proposals')}
        />
      </div>

      {tab === 'proposals' ? (
        <RejectionProposalsTab
          items={visibleProposals}
          onSent={onSent}
          onBatchDone={onBatchDone}
          referentOf={referentOf}
          filterKey={filterKey}
          maskedByFilter={sortedProposals.length - visibleProposals.length}
        />
      ) : visibleExamine.length === 0 ? (
        <EmptyQueueNotice
          maskedByFilter={toExamine.length}
          emptyLabel="Aucune candidature en attente de validation."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visibleExamine.map((v) => (
            <ValidationCard
              key={v.id}
              v={v}
              onSent={onSent}
              referent={referentOf(v.campaignId)}
            />
          ))}
        </div>
      )}

      {showHistory ? <ValidationsHistory items={history} /> : null}
    </div>
  );
}
