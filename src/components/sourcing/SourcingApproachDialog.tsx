'use client';

/**
 * Coquille de la fenêtre d'approche — CENTRÉE, fond assombri ET flouté.
 *
 * ⚠️ Elle s'ouvre AU CLIC, pas à la réponse du serveur (22/09/2026). La
 * rédaction du message passe par le modèle et prend quelques secondes :
 * avant, la fenêtre n'apparaissait qu'après, tous les boutons de la liste
 * restaient grisés sans un mot, et on ne savait pas si le clic avait pris.
 * Désormais la fenêtre DIT ce qui se passe (« Rédaction du message… »).
 *
 * ⚠️ Elle RESTE MONTÉE quand on change de format : c'est son contenu qui
 * attend, pas elle qui disparaît. Avant, passer de « Note » à « InMail »
 * refermait la fenêtre le temps de la nouvelle rédaction.
 *
 * Posée au centre, avec le reste de l'écran flouté, parce que c'est un geste
 * qui part chez un tiers : rien d'autre ne doit attirer l'œil pendant qu'on
 * relit le message. Échap ferme — comme « Annuler ».
 */

import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

export function SourcingApproachDialog({
  titre,
  onClose,
  children,
}: {
  titre: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const echap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', echap);
    return () => window.removeEventListener('keydown', echap);
  }, [onClose]);

  return (
    <div
      data-approach-backdrop
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4 backdrop-blur-sm"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titre}
        data-approach-dialog
        className="flex max-h-[90vh] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-lg border border-stone-300 bg-white p-4"
      >
        {children}
      </div>
    </div>
  );
}

/** Le contenu d'attente, tant que le premier message n'est pas rédigé. */
export function ApproachPreparing({
  onCancel,
  error,
}: {
  onCancel: () => void;
  error: string | null;
}) {
  return (
    <>
      {error ? (
        <p role="alert" className="font-body text-[13px] text-rose-700">
          {error}
        </p>
      ) : (
        <p data-approach-preparing className="flex items-center gap-2 font-body text-[13px] text-stone-600">
          <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          Rédaction du message…
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-stone-300 px-3 py-1.5 font-body text-[12.5px] font-semibold text-stone-600 hover:bg-stone-50"
        >
          {error ? 'Fermer' : 'Annuler'}
        </button>
      </div>
    </>
  );
}
