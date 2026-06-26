'use client';

/**
 * Hub « Validation suspendue » (HITL 3 zones, lot 2d).
 *
 * Colonne UNIQUE : les candidatures en ZONE GRISE (ni refus auto ni acceptation
 * auto) à trancher. Chaque carte propose deux actions (accepter / refuser) +
 * relecture du mail avant envoi (cf. ValidationCard). Une candidature traitée
 * disparaît de la file et reste consultable dans l'historique (status 'sent').
 */

import { useEffect, useState } from 'react';

import { hydrateArtifactsForCampaign } from '@/lib/db/sync/artifacts-sync';
import { formatDateTimeFr } from '@/lib/format/datetime';
import type { PendingValidation } from '@/types/hitl';

import { ValidationCard } from './ValidationCard';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: PendingValidation[] }
  | { kind: 'error'; message: string };

export function ValidationsHub() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [history, setHistory] = useState<PendingValidation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/validations', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { validations: PendingValidation[] };
        if (!cancelled) setState({ kind: 'ready', items: json.validations });
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

      {items.length === 0 ? (
        <p className="font-body text-[13px] text-stone-400 italic rounded-lg border border-dashed border-stone-200 px-4 py-8 text-center">
          Aucune candidature en attente de validation.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((v) => (
            <ValidationCard key={v.id} v={v} onSent={onSent} />
          ))}
        </div>
      )}

      {showHistory ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[14px] font-bold text-stone-700">
            Historique des décisions
          </h2>
          {history.length === 0 ? (
            <p className="font-body text-[12px] text-stone-400 italic">
              Aucune décision envoyée pour le moment.
            </p>
          ) : (
            history.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-body text-[13px] font-semibold text-stone-800 truncate">
                    {v.candidateName}
                  </p>
                  <p className="font-body text-[11px] text-stone-500">
                    {v.campaignId} · {formatDateTimeFr(v.decidedAt ?? v.updatedAt)}
                  </p>
                </div>
                <span
                  className={`flex-shrink-0 rounded-full px-2.5 py-1 font-body text-[11px] font-semibold ${
                    v.decision === 'accept'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-rose-100 text-rose-700'
                  }`}
                >
                  {v.decision === 'accept' ? 'Acceptée' : 'Refusée'}
                </span>
              </div>
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
