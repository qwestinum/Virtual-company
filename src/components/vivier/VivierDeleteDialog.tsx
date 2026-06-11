'use client';

/**
 * Confirmation de suppression d'un dossier vivier (action IRRÉVERSIBLE, RGPD
 * §8.2). Exige un motif (demande du candidat / décision interne) tracé au
 * journal sous forme anonymisée. Suppression cascade : fichier CV + embedding
 * + entités + dossier.
 */

import { Loader2, X } from 'lucide-react';
import { useState } from 'react';

import type { VivierCandidate } from '@/types/vivier';

export type VivierDeletionReason = 'candidate_request' | 'internal_decision';

export function VivierDeleteDialog({
  candidate,
  onClose,
  onDeleted,
}: {
  candidate: VivierCandidate;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState<VivierDeletionReason>('candidate_request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/vivier/${candidate.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message ?? `Erreur (HTTP ${res.status}).`);
        return;
      }
      onDeleted();
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
            Supprimer du vivier
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
          Le dossier de <strong>{candidate.nom}</strong> ({candidate.email}) sera
          définitivement supprimé : CV, index et entités. Cette action est
          irréversible.
        </p>
        <label className="mb-1 block font-body text-[11px] font-semibold uppercase tracking-wide text-stone-500">
          Motif
        </label>
        <select
          value={reason}
          onChange={(e) => setReason(e.currentTarget.value as VivierDeletionReason)}
          className="mb-4 w-full rounded-md border border-stone-300 bg-white px-2.5 py-1.5 font-body text-[13px] text-stone-800 outline-none focus:border-blue-400"
        >
          <option value="candidate_request">Demande du candidat</option>
          <option value="internal_decision">Décision interne</option>
        </select>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            Supprimer définitivement
          </button>
        </div>
      </div>
    </div>
  );
}
