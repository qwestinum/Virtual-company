'use client';

/**
 * Flux « poste pourvu » après un verdict POSITIF (fiche candidature) : propose
 * de classer sans suite les candidatures restantes SANS clôturer la campagne.
 * Non bloquant (« Plus tard »), jamais silencieux : le récapitulatif est
 * affiché avant toute action. Le message part sur le gabarit « Sans suite »
 * des Réglages ([motif] = poste pourvu), comme à la clôture.
 *
 * Extrait de `CampaignDismissFlowDialog` (lot 4 de feat/feedback-candidat) :
 * la clôture a désormais son propre dialog (`CampaignCloseDialog`).
 */

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { OpenCandidaturesRecap } from '@/lib/candidatures/dismissal-batch';
import {
  CANDIDATE_STAGE_LABELS,
  OPEN_CANDIDATE_STAGES,
} from '@/lib/reporting/candidate-stage';

import type { ClosureSummary } from './CampaignCloseDialog';

export function GoDismissDialog({
  campaignId,
  onCancel,
  onDone,
}: {
  campaignId: string;
  onCancel: () => void;
  onDone: (summary: ClosureSummary | null) => void;
}) {
  const [recap, setRecap] = useState<OpenCandidaturesRecap | null>(null);
  const [sendMail, setSendMail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/campaigns/${encodeURIComponent(campaignId)}/open-candidatures`;

  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as OpenCandidaturesRecap;
      })
      .catch((): OpenCandidaturesRecap => ({
        counts: {} as OpenCandidaturesRecap['counts'],
        total: 0,
        hasRetenu: false,
        retenus: [],
      }))
      .then((data) => {
        if (!cancelled) setRecap(data);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'poste_pourvu', sendMail }),
      });
      if (!res.ok) {
        setError(`L'opération a échoué (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { summary?: ClosureSummary | null };
      onDone(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setBusy(false);
    }
  }

  const recapText =
    recap && recap.total > 0
      ? OPEN_CANDIDATE_STAGES.filter((s) => (recap.counts[s] ?? 0) > 0)
          .map((s) => `${recap.counts[s]} ${CANDIDATE_STAGE_LABELS[s].toLowerCase()}`)
          .join(' · ')
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-display text-[16px] font-bold text-stone-900">
            Poste pourvu — candidatures restantes
          </h3>
          <button type="button" onClick={onCancel} className="rounded-md p-1 text-stone-400 hover:bg-stone-100">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {recap === null ? (
          <p className="mb-4 font-body text-[13px] text-stone-500">
            <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden />
            Vérification des candidatures en cours…
          </p>
        ) : recap.total === 0 ? (
          <p className="mb-4 font-body text-[13px] text-stone-600">Aucune candidature en cours à classer.</p>
        ) : (
          <>
            <p className="mb-3 font-body text-[13px] text-stone-600">
              <strong>{recap.total}</strong> candidature{recap.total > 1 ? 's' : ''} en cours : {recapText}.
              Le poste étant pourvu, elles peuvent être classées sans suite (ce n’est pas un refus).
            </p>
            <label className="mb-4 flex items-start gap-2 font-body text-[12.5px] text-stone-700">
              <input
                type="checkbox"
                checked={sendMail}
                onChange={(e) => setSendMail(e.currentTarget.checked)}
                className="mt-0.5"
              />
              <span>Les informer par email (message « Sans suite » des Réglages).</span>
            </label>
          </>
        )}

        {error ? <p className="mb-3 font-body text-[12px] text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
          >
            Plus tard
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || recap === null || recap.total === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Classer sans suite
          </button>
        </div>
      </div>
    </div>
  );
}
