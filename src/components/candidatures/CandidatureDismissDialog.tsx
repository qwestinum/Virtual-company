'use client';

/**
 * Dialog « Classer sans suite » (action INDIVIDUELLE, panneau/page candidat).
 * Raison typée obligatoire (individuelles uniquement — les raisons campagne
 * passent par les flux clôture/GO) + option mail selon la matrice
 * DISMISSAL_MAIL_POLICY (masquée pour doublon/invalide). Modèle :
 * VivierDeleteDialog.
 */

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

import {
  DISMISSAL_MAIL_POLICY,
  DISMISSAL_REASON_LABELS,
  INDIVIDUAL_DISMISSAL_REASONS,
  type DismissalReason,
} from '@/types/dismissal';
import type { CandidateListItem } from '@/types/reporting';

export function CandidatureDismissDialog({
  item,
  onClose,
  onDismissed,
}: {
  item: CandidateListItem;
  onClose: () => void;
  onDismissed: () => void;
}) {
  const [reason, setReason] = useState<DismissalReason>('sans_reponse');
  const [sendMail, setSendMail] = useState(
    DISMISSAL_MAIL_POLICY.sans_reponse === 'checked',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mailPolicy = DISMISSAL_MAIL_POLICY[reason];
  const mailAllowed = mailPolicy !== 'never' && Boolean(item.candidateEmail);

  function pickReason(next: DismissalReason) {
    setReason(next);
    setSendMail(DISMISSAL_MAIL_POLICY[next] === 'checked');
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/candidatures/${encodeURIComponent(item.id)}/dismiss`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason, sendMail: mailAllowed && sendMail }),
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'send_in_flight'
            ? 'Un envoi de validation est en cours pour ce candidat — réessayez dans quelques minutes.'
            : `Le classement a échoué (HTTP ${res.status}).`,
        );
        return;
      }
      onDismissed();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur réseau.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 px-4">
      <div className="w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-display text-[16px] font-bold text-stone-900">
            Classer sans suite
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-stone-400 hover:bg-stone-100"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
        <p className="mb-4 font-body text-[13px] text-stone-600">
          La candidature de <strong>{item.candidateName}</strong> sera clôturée
          sans décision d&apos;évaluation — ce n&apos;est pas un refus. Elle
          reste visible et consultable, et peut être rouverte en cas
          d&apos;erreur.
        </p>
        <label className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Motif
        </label>
        <select
          value={reason}
          onChange={(e) => pickReason(e.currentTarget.value as DismissalReason)}
          className="mb-3 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
        >
          {INDIVIDUAL_DISMISSAL_REASONS.map((r) => (
            <option key={r} value={r}>
              {DISMISSAL_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        {mailAllowed ? (
          <label className="mb-4 flex items-start gap-2 font-body text-[12.5px] text-stone-700">
            <input
              type="checkbox"
              checked={sendMail}
              onChange={(e) => setSendMail(e.currentTarget.checked)}
              className="mt-0.5"
            />
            <span>
              Informer le candidat par email (dossier clôturé, profil conservé
              dans le vivier).
            </span>
          </label>
        ) : null}
        {error ? (
          <p className="mb-3 font-body text-[12px] text-rose-600">{error}</p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 font-body text-[12px] font-semibold text-stone-600 hover:bg-stone-100"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-stone-700 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-stone-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Classer sans suite
          </button>
        </div>
      </div>
    </div>
  );
}
