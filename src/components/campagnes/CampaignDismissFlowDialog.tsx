'use client';

/**
 * Dialog PARTAGÉ des deux flux de classement sans suite EN MASSE :
 *   - mode `close` : clôture de campagne (récap + motif + option mail) —
 *     remplace les window.confirm ; la clôture passe par POST
 *     /api/campaigns/[id]/close (qui pose closed_at) ;
 *   - mode `go`    : après un GO définitif (poste pourvu) — propose de classer
 *     les candidatures restantes SANS clôturer. Non bloquant (« Plus tard »).
 * Jamais silencieux : le récapitulatif est affiché AVANT toute action.
 *
 * ── LA DÉPUBLICATION APEC EST PROPOSÉE, JAMAIS AUTOMATIQUE ──────────────────
 *
 * Retirer l'annonce d'apec.fr est une action SORTANTE et visible du public. Ce
 * projet a déjà renversé exactement cette règle pour les refus (« aucun refus
 * n'est envoyé automatiquement »), et une clôture par erreur passé les 30 jours
 * de la fenêtre de republication serait sans retour arrière. La case est donc
 * cochée par défaut — c'est presque toujours ce qu'on veut — mais le geste
 * reste celui du recruteur.
 *
 * Elle est tentée APRÈS la clôture : fermer la campagne est l'intention
 * principale, et un incident de communication avec l'Apec ne doit pas
 * l'empêcher. Si la dépublication échoue, on le DIT, et le signal métier
 * « offre en ligne sur une campagne clôturée » la rattrape.
 */

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  CANDIDATE_STAGE_LABELS,
  CANDIDATE_STAGE_RIBBON_ORDER,
  type CandidateStageCounts,
} from '@/lib/reporting/candidate-stage';
import { useApecUnpublish } from '@/lib/jobboards/adep/use-apec-unpublish';

import { CampaignApecUnpublishOption } from './CampaignApecUnpublishOption';

type Recap = { counts: CandidateStageCounts; total: number; hasRetenu: boolean };
type Summary = {
  dismissed: number;
  deferredSending: number;
  mailsSent: number;
  mailsFailed: number;
};

export function CampaignDismissFlowDialog({
  campaignId,
  mode,
  onCancel,
  onDone,
}: {
  campaignId: string;
  mode: 'close' | 'go';
  onCancel: () => void;
  /** Appelé après succès (clôture posée / classement fait). */
  onDone: (summary: Summary | null) => void;
}) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [reason, setReason] = useState<'campagne_cloturee' | 'poste_pourvu'>(
    mode === 'go' ? 'poste_pourvu' : 'campagne_cloturee',
  );
  const [dismissOpen, setDismissOpen] = useState(true);
  const [sendMail, setSendMail] = useState(true);
  const apec = useApecUnpublish(campaignId, mode === 'close');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/campaigns/${encodeURIComponent(campaignId)}/open-candidatures`,
          { cache: 'no-store' },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Recap;
        if (cancelled) return;
        setRecap(data);
        if (mode === 'close' && data.hasRetenu) setReason('poste_pourvu');
      } catch {
        // Récap indisponible (démo sans base) → clôture simple possible.
        if (!cancelled) setRecap({ counts: {} as CandidateStageCounts, total: 0, hasRetenu: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [campaignId, mode]);


  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const url =
        mode === 'close'
          ? `/api/campaigns/${encodeURIComponent(campaignId)}/close`
          : `/api/campaigns/${encodeURIComponent(campaignId)}/open-candidatures`;
      const body =
        mode === 'close'
          ? { dismissOpen: dismissOpen && (recap?.total ?? 0) > 0, reason, sendMail }
          : { reason: 'poste_pourvu', sendMail };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(`L'opération a échoué (HTTP ${res.status}).`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { summary?: Summary | null };

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

  const openStages = CANDIDATE_STAGE_RIBBON_ORDER.filter(
    (s) => (recap?.counts[s] ?? 0) > 0 && s !== 'retenu' && s !== 'non_retenu' && s !== 'refus_auto' && s !== 'sans_suite',
  );
  const recapText =
    recap && recap.total > 0
      ? openStages
          .map((s) => `${recap.counts[s]} ${CANDIDATE_STAGE_LABELS[s].toLowerCase()}`)
          .join(' · ')
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-display text-[16px] font-bold text-stone-900">
            {mode === 'close' ? 'Clôturer la campagne' : 'Poste pourvu — candidatures restantes'}
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
          <p className="mb-4 font-body text-[13px] text-stone-600">
            {mode === 'close'
              ? 'Aucune candidature en cours — la campagne peut être clôturée proprement. Les agents arrêteront tout traitement automatique.'
              : 'Aucune candidature en cours à classer.'}
          </p>
        ) : (
          <>
            <p className="mb-3 font-body text-[13px] text-stone-600">
              <strong>{recap.total}</strong> candidature{recap.total > 1 ? 's' : ''} en cours : {recapText}.
              {mode === 'close'
                ? ' En clôturant, vous pouvez les classer sans suite (ce n’est pas un refus — aucune évaluation n’est posée).'
                : ' Le poste étant pourvu, elles peuvent être classées sans suite (ce n’est pas un refus).'}
            </p>
            {mode === 'close' ? (
              <>
                <label className="mb-3 flex items-start gap-2 font-body text-[12.5px] text-stone-700">
                  <input
                    type="checkbox"
                    checked={dismissOpen}
                    onChange={(e) => setDismissOpen(e.currentTarget.checked)}
                    className="mt-0.5"
                  />
                  <span>Classer sans suite les candidatures en cours.</span>
                </label>
                {dismissOpen ? (
                  <div className="mb-3 flex flex-col gap-1.5 pl-6">
                    {(['poste_pourvu', 'campagne_cloturee'] as const).map((r) => (
                      <label key={r} className="flex items-center gap-2 font-body text-[12.5px] text-stone-700">
                        <input type="radio" name="close-reason" checked={reason === r} onChange={() => setReason(r)} />
                        {r === 'poste_pourvu' ? 'Poste pourvu' : 'Campagne clôturée sans recrutement'}
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
            {mode === 'go' || dismissOpen ? (
              <label className="mb-4 flex items-start gap-2 font-body text-[12.5px] text-stone-700">
                <input
                  type="checkbox"
                  checked={sendMail}
                  onChange={(e) => setSendMail(e.currentTarget.checked)}
                  className="mt-0.5"
                />
                <span>Informer les candidats par email (recrutement clos, profil conservé dans le vivier).</span>
              </label>
            ) : null}
          </>
        )}

        {mode === 'close' ? (
          <CampaignApecUnpublishOption
            live={apec.live}
            checked={apec.checked}
            onChange={apec.setChecked}
          />
        ) : null}

        {error ? <p className="mb-3 font-body text-[12px] text-rose-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
          >
            {mode === 'go' ? 'Plus tard' : 'Annuler'}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy || recap === null || (mode === 'go' && recap.total === 0)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-800 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {mode === 'close'
              ? dismissOpen && (recap?.total ?? 0) > 0
                ? 'Clôturer et classer'
                : 'Clôturer la campagne'
              : 'Classer sans suite'}
          </button>
        </div>
      </div>
    </div>
  );
}
