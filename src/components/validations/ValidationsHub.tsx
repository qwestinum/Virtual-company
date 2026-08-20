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
 * les deux. « À examiner » reste le comportement historique à l'identique ;
 * « Propositions de refus » ne fait qu'y prélever ce qu'un seuil de campagne
 * désigne, pour permettre le geste groupé.
 */

import { useEffect, useState } from 'react';

import { hydrateArtifactsForCampaign } from '@/lib/db/sync/artifacts-sync';
import type { DecisionZone, PendingValidation } from '@/types/hitl';

import {
  partitionRejectionProposals,
  sortRejectionProposals,
} from '@/lib/hitl/rejection-proposal';

import { RejectionProposalsTab } from './RejectionProposalsTab';
import { ValidationCard } from './ValidationCard';
import { ValidationsHistory } from './ValidationsHistory';

type SubTab = 'examine' | 'proposals';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: PendingValidation[] }
  | { kind: 'error'; message: string };

export function ValidationsHub() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  // Zone FIGÉE AU SCORING de chaque validation, servie par l'API. C'est elle
  // qui décide du sous-onglet — jamais une comparaison de score au seuil
  // courant de la campagne, qui re-jugerait un dossier avec un barème qu'il
  // n'a jamais connu (cf. rejection-proposal.ts).
  const [zones, setZones] = useState<Record<string, DecisionZone | null>>({});
  const [tab, setTab] = useState<SubTab>('examine');
  const [history, setHistory] = useState<PendingValidation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          validations: PendingValidation[];
          zoneByValidation?: Record<string, DecisionZone | null>;
        };
        if (!cancelled) {
          setState({ kind: 'ready', items: json.validations });
          setZones(json.zoneByValidation ?? {});
        }
        const campaigns = [...new Set(json.validations.map((v) => v.campaignId))];
        await Promise.all(campaigns.map((c) => hydrateArtifactsForCampaign(c)));
      } catch (err) {
        if (!cancelled)
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'load_failed',
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadHistory = async () => {
    setShowHistory((s) => !s);
    if (history.length > 0) return;
    try {
      const res = await fetch('/api/validations?status=sent', { cache: 'no-store' });
      if (res.ok) {
        const json = (await res.json()) as { validations: PendingValidation[] };
        setHistory(json.validations);
      }
    } catch {
      // historique best-effort
    }
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
    setState({ kind: 'ready', items: items.filter((it) => it.id !== v.id) });
    setHistory((h) => [{ ...v, status: 'sent' }, ...h]);
    setFlash(message);
    window.setTimeout(() => setFlash(null), 3500);
  };

  // Retire du hub les validations traitées par une fournée (celles qui ont
  // ABOUTI seulement : les échecs restent `pending`, donc restent visibles).
  const onBatchDone = (treatedIds: string[], message: string) => {
    const treated = new Set(treatedIds);
    setState({ kind: 'ready', items: items.filter((it) => !treated.has(it.id)) });
    setHistory((h) => [
      ...items
        .filter((it) => treated.has(it.id))
        .map((it) => ({ ...it, status: 'sent' as const, decision: 'reject' as const })),
      ...h,
    ]);
    setFlash(message);
    window.setTimeout(() => setFlash(null), 6000);
  };

  const { proposals, toExamine } = partitionRejectionProposals(items, zones);
  const sortedProposals = sortRejectionProposals(proposals);
  const shown = tab === 'proposals' ? sortedProposals : toExamine;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <p className="font-body text-[13px] text-stone-600">
          <strong className="font-semibold">{items.length}</strong> candidature
          {items.length > 1 ? 's' : ''} en zone de validation.
        </p>
        <button
          type="button"
          onClick={() => void loadHistory()}
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

      <div className="flex items-center gap-1 border-b border-stone-200">
        <SubTabButton
          active={tab === 'examine'}
          label="À examiner"
          count={toExamine.length}
          onClick={() => setTab('examine')}
        />
        <SubTabButton
          active={tab === 'proposals'}
          label="Propositions de refus"
          count={sortedProposals.length}
          onClick={() => setTab('proposals')}
        />
      </div>

      {tab === 'proposals' ? (
        <RejectionProposalsTab
          items={sortedProposals}
          onSent={onSent}
          onBatchDone={onBatchDone}
        />
      ) : shown.length === 0 ? (
        <p className="font-body text-[13px] text-stone-400 italic rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center">
          Aucune candidature en attente de validation.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {shown.map((v) => (
            <ValidationCard key={v.id} v={v} onSent={onSent} />
          ))}
        </div>
      )}

      {showHistory ? <ValidationsHistory items={history} /> : null}
    </div>
  );
}

function SubTabButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 font-body text-[13px] font-semibold ${
        active
          ? 'border-stone-800 text-stone-900'
          : 'border-transparent text-stone-500 hover:text-stone-700'
      }`}
    >
      {label} ({count})
    </button>
  );
}
