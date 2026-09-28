'use client';

/**
 * Les trois gestes sur un profil du vivier — « CV », « Écarter », « Inviter »
 * — IDENTIQUES partout où un profil apparaît : profils proposés, résultats de
 * la recherche par mot-clé (28/09/2026). Écarter ne vaut que pour cette
 * campagne, et n'envoie rien.
 */

import { Eye, Loader2 } from 'lucide-react';

export function VivierActions({
  busy,
  locked,
  onPreview,
  onReject,
  onInvite,
}: {
  /** Ce profil est en cours d'invitation. */
  busy: boolean;
  /** Un geste est en cours ailleurs sur l'écran. */
  locked: boolean;
  onPreview: () => void;
  /** Absent : le profil est déjà écarté pour cette campagne. */
  onReject?: () => void;
  onInvite: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        onClick={onPreview}
        title="Aperçu du CV"
        data-role="vivier-preview"
        className="flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2 py-1 font-body text-[12px] font-semibold text-stone-700 hover:bg-stone-50"
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        CV
      </button>
      {onReject ? (
      <button
        type="button"
        onClick={onReject}
        disabled={busy || locked}
        data-role="vivier-reject"
        title="Pas pour cette campagne — rien n’est envoyé"
        className="rounded-md border border-stone-200 bg-white px-2 py-1 font-body text-[12px] font-semibold text-stone-600 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
      >
        Écarter
      </button>
      ) : null}
      <button
        type="button"
        onClick={onInvite}
        disabled={busy || locked}
        data-role="vivier-invite-row"
        className="flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {busy ? 'Analyse et envoi…' : 'Inviter'}
      </button>
    </div>
  );
}
