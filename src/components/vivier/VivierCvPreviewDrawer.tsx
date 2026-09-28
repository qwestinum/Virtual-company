'use client';

/**
 * Aperçu du CV d'un profil proposé par le vivier (point 1) — panneau latéral,
 * par-dessus l'écran de la campagne, avec la décision à portée de main.
 *
 * Le fichier est servi par `/api/vivier/[id]/cv` : lu côté serveur sous la
 * session, jamais une URL publique (un lien signé serait moins restreint).
 * Un .docx ne s'affiche pas dans un navigateur : on montre alors le texte
 * extrait du CV. Le score SUR LA GRILLE n'existe pas encore — il est calculé
 * à l'invitation (arbitrage DO, option A) ; la présélection ne donne qu'une
 * proximité de titre et de compétences, et l'écran le dit.
 */

import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { VivierTarget } from './useVivierInvite';

type Detail = { cvFileName: string | null; cvText: string | null };

export function VivierCvPreviewDrawer({
  entry,
  busy,
  onInvite,
  onReject,
  onClose,
}: {
  entry: VivierTarget;
  busy: boolean;
  onInvite: () => void;
  /** Absent pour un profil que la présélection n'a pas proposé. */
  onReject?: () => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/vivier/${entry.candidateId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive && d) setDetail({ cvFileName: d.candidate?.cvFileName ?? null, cvText: d.candidate?.cvText ?? null });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [entry.candidateId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isPdf = (detail?.cvFileName ?? '').toLowerCase().endsWith('.pdf');
  return (
    <aside
      role="dialog"
      aria-label={`Aperçu du CV de ${entry.nom}`}
      data-role="vivier-cv-preview"
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[640px] flex-col border-l border-stone-200 bg-white"
    >
      <header className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-display text-[15px] font-semibold text-stone-800">{entry.nom}</p>
          <p className="truncate font-body text-[12px] text-stone-500">{entry.subtitle}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fermer l’aperçu" className="rounded-md p-1 text-stone-500 hover:bg-stone-100">
          <X className="h-4 w-4" aria-hidden />
        </button>
      </header>

      <section className="border-b border-stone-100 px-4 py-3 font-body text-[12px] text-stone-600">
        <p className="font-semibold text-stone-700">Pourquoi ce profil</p>
        {entry.lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <p className="mt-1 text-stone-500">
          Le score sur la grille de la campagne sera calculé à l’invitation, sur ce CV.
        </p>
      </section>

      <div className="min-h-0 flex-1 bg-stone-50">
        {!detail ? (
          <p className="p-4 font-body text-[12px] text-stone-500">Chargement du CV…</p>
        ) : isPdf ? (
          <iframe title={`CV de ${entry.nom}`} src={`/api/vivier/${entry.candidateId}/cv`} className="h-full w-full" />
        ) : detail.cvText ? (
          <pre className="h-full overflow-auto whitespace-pre-wrap p-4 font-body text-[12px] leading-relaxed text-stone-700">
            {detail.cvText}
          </pre>
        ) : (
          <p className="p-4 font-body text-[12px] text-stone-500">Aucun aperçu disponible pour ce fichier.</p>
        )}
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3">
        {onReject ? (
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded-md border border-stone-200 px-3 py-1.5 font-body text-[12px] font-semibold text-stone-700 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
        >
          Écarter
        </button>
        ) : null}
        <button
          type="button"
          onClick={onInvite}
          disabled={busy}
          data-role="vivier-invite"
          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-body text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {busy ? 'Analyse du CV et envoi…' : 'Inviter'}
        </button>
      </footer>
    </aside>
  );
}
