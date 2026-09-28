'use client';

/**
 * CLÔTURE d'une campagne (feat/feedback-candidat, lot 4). Remplace le mode
 * `close` de `CampaignDismissFlowDialog`, dans les trois points d'entrée.
 *
 * Dans l'ordre : 1. le recrutement est-il conclu ? 2. qui est recruté (parmi
 * les retenus, jamais pré-coché, « ne pas préciser » possible) ? 3. les
 * retenus non sélectionnés, chacun avec son message ; 4. les candidatures
 * encore ouvertes, classées sans suite en groupe (motif déduit de l'issue) ;
 * 5. la dépublication Apec. Rien n'est posé avant « Clôturer ».
 */

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  closureMissing,
  closureRequest,
  initialClosureDraft,
  notSelected,
  type ClosureDraft,
} from '@/lib/campagnes/closure-draft';
import type { OpenCandidaturesRecap } from '@/lib/candidatures/dismissal-batch';
import { useApecUnpublish } from '@/lib/jobboards/adep/use-apec-unpublish';

import { CampaignApecUnpublishOption } from '../CampaignApecUnpublishOption';
import { ClosureOpenSection } from './ClosureOpenSection';
import { ClosureOutcomeSection } from './ClosureOutcomeSection';
import { NotSelectedFeedbackList } from './NotSelectedFeedbackList';

export type ClosureSummary = {
  dismissed: number;
  deferredSending: number;
  mailsSent: number;
  mailsFailed: number;
};

const MISSING_TEXT = {
  outcome: 'Indiquez si le recrutement est conclu.',
  hired: 'Désignez le recruté, ou choisissez « Ne pas préciser ».',
  feedback: 'Choisissez comment chaque retenu non sélectionné est informé.',
} as const;

export function CampaignCloseDialog({
  campaignId,
  onCancel,
  onDone,
}: {
  campaignId: string;
  onCancel: () => void;
  onDone: (summary: ClosureSummary | null) => void;
}) {
  const [recap, setRecap] = useState<OpenCandidaturesRecap | null>(null);
  const [draft, setDraft] = useState<ClosureDraft>(() => initialClosureDraft(false));
  const apec = useApecUnpublish(campaignId, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/open-candidatures`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as OpenCandidaturesRecap;
      })
      .catch((): OpenCandidaturesRecap => ({
        // Récap indisponible (démo sans base) → clôture simple possible.
        counts: {} as OpenCandidaturesRecap['counts'],
        total: 0,
        hasRetenu: false,
        retenus: [],
      }))
      .then((data) => {
        if (cancelled) return;
        setRecap(data);
        setDraft(initialClosureDraft(data.hasRetenu));
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  const retenus = recap?.retenus ?? [];
  const missing = recap ? closureMissing(draft, retenus) : ['outcome' as const];
  const request = recap ? closureRequest(draft, retenus, recap.total) : null;

  async function confirm() {
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      const data = (await res.json().catch(() => ({}))) as {
        summary?: ClosureSummary | null;
        message?: string;
      };
      if (!res.ok) {
        setError(data.message ?? `La clôture a échoué (HTTP ${res.status}).`);
        return;
      }
      // La clôture a réussi : on tente la dépublication. Un échec ici ne la
      // remet pas en cause — on le dit, et le signal métier rattrape.
      const apecError = await apec.unpublishIfRequested();
      if (apecError) {
        setError(apecError);
        return;
      }
      onDone(data.summary ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Clôturer la campagne"
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4"
    >
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-display text-[16px] font-bold text-stone-900">Clôturer la campagne</h3>
          <button type="button" onClick={onCancel} aria-label="Fermer" className="rounded-md p-1 text-stone-400 hover:bg-stone-100">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        {recap === null ? (
          <p className="mb-4 font-body text-[13px] text-stone-500">
            <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" aria-hidden />
            Vérification des candidatures en cours…
          </p>
        ) : (
          <>
            <ClosureOutcomeSection
              draft={draft}
              retenus={retenus}
              disabled={busy}
              onOutcome={(outcome) => setDraft((d) => ({ ...d, outcome }))}
              onHired={(hired) => setDraft((d) => ({ ...d, hired }))}
            />
            <NotSelectedFeedbackList
              candidates={notSelected(draft, retenus)}
              feedbacks={draft.feedbacks}
              disabled={busy}
              onChange={(id, choice) =>
                setDraft((d) => ({ ...d, feedbacks: { ...d.feedbacks, [id]: choice } }))
              }
            />
            <ClosureOpenSection recap={recap} draft={draft} disabled={busy} onChange={setDraft} />
          </>
        )}

        <CampaignApecUnpublishOption live={apec.live} checked={apec.checked} onChange={apec.setChecked} />

        {recap && missing.length > 0 ? (
          <p className="mb-3 font-body text-[12px] text-stone-500">{MISSING_TEXT[missing[0]!]}</p>
        ) : null}
        {error ? <p role="alert" className="mb-3 font-body text-[12px] text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
          >
            Annuler
          </button>
          <button
            type="button"
            data-role="confirm-closure"
            onClick={() => void confirm()}
            disabled={busy || !request}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Clôturer la campagne
          </button>
        </div>
      </div>
    </div>
  );
}
