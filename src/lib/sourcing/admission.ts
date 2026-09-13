/**
 * Manifestation d'une personne approchée — les règles PURES.
 * Spec : docs/specs/sourcing.md §10.
 */
import type { CVApplication } from '@/types/cv-analysis';
import type { Submission } from '@/lib/sourcing/landing';

export const SOURCING_ANALYSIS_PREFIX = 'can_src_';

export const sourcingAnalysisId = (approachId: string): string => `${SOURCING_ANALYSIS_PREFIX}${approachId}`;
export const sourcingCvFileArtifactId = (approachId: string): string => `art_src_cvfile_${approachId}`;
export const sourcingStructuredCvArtifactId = (approachId: string): string => `art_src_cv_${approachId}`;

/** L'approche d'une analyse `can_src_<uuid>`, ou `null`. */
export function approachIdOfAnalysis(analysisId: string | null | undefined): string | null {
  const m = /^can_src_([0-9a-f-]{36})$/.exec(analysisId ?? '');
  return m ? m[1] : null;
}

/**
 * La personne a répondu à un recruteur : la décision d'inviter est HUMAINE et
 * déjà prise. Zone forcée à l'acceptation, score et détail INCHANGÉS (le
 * briefing les montre tels quels) ; coordonnées = celles saisies sur la page,
 * jamais celles que l'extraction aurait lues dans un document.
 */
export function forceAcceptedApplication(application: CVApplication, submission: Submission): CVApplication {
  return {
    ...application,
    candidate: {
      ...application.candidate,
      fullName: submission.fullName,
      email: submission.email,
      phone: submission.phone ?? null,
    },
    scoringResult: { ...application.scoringResult, status: 'accepted', decisionZone: 'auto_accept' },
  };
}

/**
 * Reprise d'une admission en panne : 1, 5, 15 minutes, puis toutes les heures.
 * Jamais d'abandon — la personne a vu « bien reçue » ; un humain lit la cause
 * dans `admission_last_error` si la panne dure.
 */
export function admissionRetryDue(attempts: number, lastUpdateIso: string, now: Date): boolean {
  const minutes = attempts <= 0 ? 0 : attempts === 1 ? 1 : attempts === 2 ? 5 : attempts === 3 ? 15 : 60;
  return now.getTime() - new Date(lastUpdateIso).getTime() >= minutes * 60_000;
}
