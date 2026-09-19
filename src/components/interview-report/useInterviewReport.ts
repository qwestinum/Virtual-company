'use client';

/**
 * Lecture et enregistrement du compte rendu d'une candidature. Aucune
 * logique métier : les gardes (entretien réalisé, validation signée, gabarit
 * vide) sont au serveur ; ce hook rapporte leurs refus en phrases lisibles.
 */

import { useCallback, useEffect, useState } from 'react';

import type {
  InterviewReport,
  InterviewReportSections,
  InterviewReportView,
} from '@/types/interview-report';

const REFUSALS: Record<string, string> = {
  interview_not_realized: 'L’entretien n’est pas marqué « réalisé » : il n’y a pas encore de compte rendu à écrire.',
  already_verified: 'Ce compte rendu est déjà validé : enregistrez vos modifications en le validant de nouveau.',
  empty_report: 'Le compte rendu est vide : remplissez au moins une rubrique avant de le valider.',
  session_required: 'Votre session a expiré : reconnectez-vous pour valider le compte rendu.',
};

export function useInterviewReport(analysisId: string) {
  const [view, setView] = useState<InterviewReportView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/candidatures/${encodeURIComponent(analysisId)}/interview-report`, {
        cache: 'no-store',
      });
      if (res.ok) setView((await res.json()) as InterviewReportView);
    } catch {
      // Réseau KO : on garde l'état précédent.
    }
  }, [analysisId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état n'est posé qu'après l'await (chargement asynchrone)
    void load();
  }, [load]);

  const save = useCallback(
    async (sections: InterviewReportSections, action: 'draft' | 'verify'): Promise<InterviewReport | null> => {
      setError(null);
      try {
        const res = await fetch(
          `/api/candidatures/${encodeURIComponent(analysisId)}/interview-report`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sections, action }),
          },
        );
        const data = (await res.json().catch(() => ({}))) as {
          report?: InterviewReport;
          error?: string;
          message?: string;
        };
        if (res.ok && data.report) {
          setView((v) => (v ? { ...v, report: data.report! } : v));
          return data.report;
        }
        setError(
          (data.error && REFUSALS[data.error]) ??
            data.message ??
            'Le compte rendu n’a pas pu être enregistré. Votre texte est conservé : réessayez.',
        );
      } catch {
        setError('Le compte rendu n’a pas pu être enregistré (réseau). Votre texte est conservé : réessayez.');
      }
      return null;
    },
    [analysisId],
  );

  return { view, error, save, reload: load, setView };
}
