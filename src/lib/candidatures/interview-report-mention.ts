/**
 * Mention d'un compte rendu d'entretien — PURE, CLIENT-SAFE.
 * Spec : docs/specs/compte-rendu-entretien.md §5.7.
 *
 * Rendue à partir de la SOURCE et des colonnes de vérification, jamais
 * stockée en texte : une mention recopiée survivrait à une correction de son
 * auteur ou de sa date. Un seul endroit la formule — l'écran, la frise et le
 * PDF d'audit disent la même phrase.
 */

import type { InterviewReport } from '@/types/interview-report';

function frDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function interviewReportMention(
  report: Pick<InterviewReport, 'source' | 'status' | 'verifiedByEmail' | 'verifiedAt'>,
): string {
  if (report.status !== 'verified' || !report.verifiedAt) {
    return report.source === 'transcript'
      ? 'Proposé à partir d’une transcription — brouillon, pas encore vérifié'
      : 'Brouillon — pas encore validé';
  }
  const who = report.verifiedByEmail ?? 'auteur non enregistré';
  const when = frDate(report.verifiedAt);
  return report.source === 'transcript'
    ? `Établi à partir d’une transcription, vérifié par ${who} le ${when}`
    : `Rédigé et validé par ${who} le ${when}`;
}
