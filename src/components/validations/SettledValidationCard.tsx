'use client';

/**
 * Une fiche de validation dont le dossier N'ATTEND PLUS de décision.
 *
 * ⚠️ On DÉSARME, on ne masque pas. Deux dossiers de production portaient la
 * direction `reject` avec un score de 100 et 90 sur une analyse `auto_accept` :
 * refuser depuis leur carte aurait envoyé un refus à quelqu'un que le reste du
 * produit compte comme accepté. Les faire disparaître aurait été pire — deux
 * dossiers évaporés du hub, un compteur qui bouge sans explication, et personne
 * pour savoir qu'il y avait eu une incohérence.
 *
 * La carte dit donc ce qui s'est passé, retire les deux boutons d'arbitrage, et
 * n'offre qu'un geste : clore la fiche. Clore n'est pas refuser — aucun mail,
 * aucune décision, le verdict de screening reste intact.
 */

import { useState } from 'react';

import { ReferentMention } from '@/components/referent/ReferentMention';
import type { ReferentInfo } from '@/lib/referent/filter';
import { SETTLED_LABELS, type SettledReason } from '@/lib/hitl/queue-coherence';
import type { PendingValidation } from '@/types/hitl';

export function SettledValidationCard({
  v,
  reason,
  onSettled,
  referent = null,
}: {
  v: PendingValidation;
  reason: SettledReason;
  /** Retire la fiche du hub une fois close. */
  onSettled: (v: PendingValidation, message: string) => void;
  referent?: ReferentInfo | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/validations/${encodeURIComponent(v.id)}/settle`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(
          json?.error === 'send_in_flight'
            ? 'Un envoi est en cours sur ce dossier. Réessayez dans un instant.'
            : json?.error === 'still_awaiting'
              ? 'Ce dossier attend finalement une décision — la fiche est conservée.'
              : 'La fiche n’a pas pu être close. Rien n’a été modifié.',
        );
        return;
      }
      onSettled(v, `Fiche de ${v.candidateName} close — aucun mail n’est parti.`);
    } catch {
      setError('La fiche n’a pas pu être close. Rien n’a été modifié.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border border-orqa-ambre/50 bg-orqa-ambre-bg px-5 py-4">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-display text-[15px] font-bold text-orqa-encre">
          {v.candidateName}
        </h3>
        <span className="font-data text-[12px] text-orqa-gris">{v.campaignId}</span>
        {typeof v.score === 'number' ? (
          <span className="font-data text-[12px] text-orqa-gris">{v.score}/100</span>
        ) : null}
        <ReferentMention referent={referent} />
      </header>

      <p className="mt-2 font-body text-[13px] leading-relaxed text-orqa-encre">
        <strong className="font-semibold">Cette fiche n’a plus lieu d’être.</strong>{' '}
        {SETTLED_LABELS[reason]}
      </p>
      <p className="mt-1.5 font-body text-[12px] leading-relaxed text-orqa-gris">
        Les boutons d’arbitrage sont retirés&nbsp;: trancher ici enverrait un
        message qui contredirait l’état réel du dossier. La clore ne décide rien
        et n’envoie aucun mail.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void settle()}
          disabled={busy}
          className="rounded-lg border border-orqa-nuit bg-orqa-nuit px-4 py-2 font-body text-[13px] font-semibold text-white disabled:opacity-60"
        >
          {busy ? 'Clôture…' : 'Clore cette fiche'}
        </button>
        <span className="font-body text-[12px] text-orqa-gris">
          Le dossier reste consultable dans Candidatures.
        </span>
      </div>

      {error ? (
        <p role="alert" className="mt-2 font-body text-[12px] font-semibold text-orqa-rouge">
          {error}
        </p>
      ) : null}
    </article>
  );
}
