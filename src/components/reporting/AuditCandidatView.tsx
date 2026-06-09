'use client';

/**
 * Interface Audit candidat (cf. docs/specs/reporting.md §5.3). Deux états :
 *   - sélection : filtres + liste (CandidateSelectionPanel) ;
 *   - détail : vue critère-par-critère (CandidateAuditDetail).
 * Bouton « ← Choisir un autre type d'audit » (retour à la vue d'accueil) ;
 * depuis le détail, « ← Retour à la sélection ».
 */

import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { CandidateAnalysisDetail } from '@/types/reporting';

import { CandidateAuditDetail } from './CandidateAuditDetail';
import { CandidateSelectionPanel } from './CandidateSelectionPanel';

export function AuditCandidatView({ onBack }: { onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CandidateAnalysisDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pas de selectedId → on reste sur le panneau de sélection ; le `detail`
    // éventuellement périmé n'est jamais rendu (garde `!selectedId` plus bas),
    // donc aucun reset d'état nécessaire ici.
    if (!selectedId) return;
    const controller = new AbortController();
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/reporting/audit/candidates/${selectedId}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          setError(
            res.status === 404
              ? 'Candidat introuvable.'
              : `Erreur de chargement (HTTP ${res.status}).`,
          );
          return;
        }
        const data = await res.json();
        setDetail(data.candidate as CandidateAnalysisDetail);
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : 'Erreur réseau.');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [selectedId]);

  return (
    <div className="flex flex-col gap-5">
      <button
        type="button"
        onClick={selectedId ? () => setSelectedId(null) : onBack}
        className="inline-flex items-center gap-1.5 self-start font-body text-[13px] font-semibold text-stone-500 hover:text-stone-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {selectedId ? 'Retour à la sélection' : "Choisir un autre type d'audit"}
      </button>

      {!selectedId ? (
        <>
          <div>
            <h2 className="font-display text-xl font-bold text-stone-900">
              Audit candidat
            </h2>
            <p className="font-body text-[13px] text-stone-500">
              Comprendre pourquoi un candidat a été retenu ou écarté —
              traçabilité critère par critère.
            </p>
          </div>
          <CandidateSelectionPanel onSelect={setSelectedId} />
        </>
      ) : loading ? (
        <div className="flex items-center gap-2 font-body text-[13px] text-stone-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Chargement de l&apos;audit…
        </div>
      ) : error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 font-body text-[13px] text-rose-700">
          {error}
        </p>
      ) : detail ? (
        <CandidateAuditDetail detail={detail} />
      ) : null}
    </div>
  );
}
