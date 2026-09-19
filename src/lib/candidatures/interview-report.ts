/**
 * Compte rendu d'entretien — cœur SERVEUR (lecture de la vue, enregistrement).
 * Spec : docs/specs/compte-rendu-entretien.md §3, §5.7, §15.
 *
 * Invariants :
 *   1. **Il faut qu'un entretien ait eu lieu.** Le marqueur « entretien
 *      réalisé » (dernier-gagne) est RELU ici ; sans lui il n'y a rien à rendre
 *      compte — 409, jamais une ligne orpheline.
 *   2. **Valider, c'est signer.** La validation pose l'auteur et la date de la
 *      SESSION serveur ; sans session lisible, on ne valide pas (on n'inscrit
 *      jamais « vérifié par personne »).
 *   3. **Un gabarit vide ne se valide pas** : un compte rendu validé dit
 *      quelque chose.
 *   4. **Rien de son contenu au journal** : la trace `interview_report_saved`
 *      porte le statut et la source, jamais une rubrique (le journal est
 *      pseudonymisé à la purge, pas supprimé).
 *   5. **Aucun envoi.**
 */

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { getCampaign } from '@/lib/db/repos/campaigns';
import { getInterviewReport, saveInterviewReport } from '@/lib/db/repos/interview-reports';
import { loadStageSignals } from '@/lib/reporting/stage-signals';
import type { HumanDecider } from '@/types/hitl';
import {
  hasReportContent,
  type InterviewReport,
  type InterviewReportSections,
  type InterviewReportSource,
  type InterviewReportView,
  type ReportCriterionPrompt,
} from '@/types/interview-report';
import type { CandidateAnalysisSummary } from '@/types/reporting';

export const INTERVIEW_REPORT_SAVED_ACTION = 'interview_report_saved';

type Analysis = Pick<CandidateAnalysisSummary, 'id' | 'uid' | 'campaignId'>;

/** L'entretien a-t-il eu lieu ? (marqueur « réalisé », dernier-gagne) */
export async function interviewHappened(analysis: Analysis): Promise<boolean> {
  const signals = await loadStageSignals(
    analysis.campaignId ? { campaignId: analysis.campaignId } : {},
  );
  return signals.interviewMarks.get(analysis.uid) === 'realized';
}

/**
 * Critères de la fiche de scoring de la campagne, en REPÈRES (libellé seul :
 * ni poids ni seuil — un compte rendu dit ce qui s'est dit, pas ce qui pèse).
 * Best-effort : une campagne illisible rend des repères vides.
 */
export async function loadCriterionPrompts(
  campaignId: string | null,
): Promise<ReportCriterionPrompt[]> {
  if (!campaignId) return [];
  const campaign = await getCampaign(campaignId).catch(() => null);
  const criteria = campaign?.scoringSheet?.criteria ?? [];
  return criteria.map((c) => ({ criterionId: c.id, label: c.label }));
}

export async function loadInterviewReportView(
  analysis: Analysis,
): Promise<InterviewReportView> {
  const [report, criteria, writable] = await Promise.all([
    getInterviewReport(analysis.id),
    loadCriterionPrompts(analysis.campaignId),
    interviewHappened(analysis),
  ]);
  return { report, criteria, writable };
}

export type ReportSaveOutcome =
  | { status: 'saved'; report: InterviewReport }
  | { status: 'interview_not_realized' }
  | { status: 'empty_report' }
  | { status: 'session_required' }
  | { status: 'already_verified' };

export async function saveReportFor(args: {
  analysis: Analysis;
  sections: InterviewReportSections;
  action: 'draft' | 'verify';
  actor: HumanDecider | null;
  /** Posé par l'import de transcription (lot 4) ; `manual` sinon. */
  source?: InterviewReportSource;
  generatedModel?: string | null;
  omittedCount?: number | null;
}): Promise<ReportSaveOutcome> {
  const { analysis, sections, action, actor } = args;
  if (action === 'verify' && !actor) return { status: 'session_required' };
  if (action === 'verify' && !hasReportContent(sections)) return { status: 'empty_report' };
  if (!(await interviewHappened(analysis))) return { status: 'interview_not_realized' };

  const source = args.source ?? 'manual';
  const saved = await saveInterviewReport({
    analysisId: analysis.id,
    uid: analysis.uid,
    campaignId: analysis.campaignId,
    source,
    sections,
    action,
    actor,
    generatedModel: args.generatedModel ?? null,
    omittedCount: args.omittedCount ?? null,
  });
  if (saved.status === 'already_verified') return saved;

  await appendJournalEntry({
    action: INTERVIEW_REPORT_SAVED_ACTION,
    campaignId: analysis.campaignId,
    actor: 'user',
    payload: {
      uid: analysis.uid,
      analysisId: analysis.id,
      reportId: saved.report.id,
      status: saved.report.status,
      source: saved.report.source,
      actorUserId: actor?.userId ?? null,
      actorEmail: actor?.email ?? null,
    },
  }).catch((err) =>
    // Best-effort : la trace ne doit pas faire perdre un compte rendu déjà
    // enregistré. On le dit en console, sans aucun contenu.
    console.error('[interview-report] trace de journal non écrite', (err as Error).name),
  );
  return saved;
}
