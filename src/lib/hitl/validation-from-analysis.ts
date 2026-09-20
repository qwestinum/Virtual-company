/**
 * Reconstruit une ligne de file HITL à partir de l'ANALYSE — PUR.
 *
 * Une analyse en zone d'attente et sa ligne de file décrivent le même fait.
 * Quand la seconde manque, tout ce qu'il faut pour la refaire est déjà dans la
 * première : `application` porte le `CVApplication` intégral, dont la
 * projection `MailCandidate` est exactement ce que la carte de validation et
 * le rédacteur de mail consomment.
 *
 * Sert deux appelants : la re-mise en file manuelle (bouton de la fiche
 * candidature) et le re-scoring, quand il fait ENTRER un dossier en zone
 * d'attente. Aucun des deux n'envoie quoi que ce soit — ils rendent le dossier
 * décidable, c'est tout.
 */
import { validationIdFor } from '@/lib/hitl/validation-id';
import { isAwaitingHumanZone, type PendingValidation } from '@/types/hitl';
import { cvApplicationToMailCandidate } from '@/types/mail-candidate';
import type { CandidateAnalysisDetail } from '@/types/reporting';

/** Pourquoi une analyse ne peut pas être remise en file. */
export type RequeueRefusal =
  | 'no_campaign'
  | 'not_awaiting'
  | 'decided_by_human'
  | 'dismissed';

export type BuildValidationOutcome =
  | { ok: true; validation: PendingValidation }
  | { ok: false; reason: RequeueRefusal };

/**
 * `now` injecté (tests). La direction posée est PROVISOIRE — un dossier en
 * attente n'a, par construction, aucune direction décidée : `reject` n'est
 * qu'un placeholder de colonne, la carte compose le mail quand l'humain
 * tranche. C'est la convention déjà tenue par le poller.
 */
export function buildValidationFromAnalysis(
  analysis: CandidateAnalysisDetail,
  /**
   * Intitulé du poste — il ne vit PAS dans l'analyse (`CVApplication` ne porte
   * pas la fiche) : l'appelant le lit sur la campagne. `null` est accepté et
   * dégrade proprement (la carte et le rédacteur de mail le traitent déjà).
   */
  jobTitle: string | null = null,
  now: Date = new Date(),
): BuildValidationOutcome {
  if (!analysis.campaignId) return { ok: false, reason: 'no_campaign' };
  if (analysis.dismissedAt !== null) return { ok: false, reason: 'dismissed' };
  // Un humain a déjà tranché : remettre en file rouvrirait une décision prise.
  // La réparation d'une erreur passe par « Corriger la décision », pas par ici.
  if (analysis.decidedBy === 'user') return { ok: false, reason: 'decided_by_human' };
  if (!isAwaitingHumanZone(analysis.decisionZone ?? 'auto_accept')) {
    return { ok: false, reason: 'not_awaiting' };
  }

  const candidate = cvApplicationToMailCandidate(analysis.application);
  const nowIso = now.toISOString();
  return {
    ok: true,
    validation: {
      id: validationIdFor(analysis.id, 'reject'),
      campaignId: analysis.campaignId,
      candidateName: analysis.candidateName,
      candidateEmail: analysis.candidateEmail,
      score: analysis.totalScore,
      decision: 'reject',
      // Les artefacts ne se devinent pas depuis l'analyse : la carte affichera
      // le CV et le rapport si une passe ultérieure les rattache (la fusion
      // d'enqueue est non destructive), jamais un lien inventé ici.
      cvArtifactId: null,
      reportArtifactId: null,
      mailDraftArtifactId: null,
      confirmed: false,
      status: 'pending',
      payload: {
        uid: analysis.uid,
        analysisId: analysis.id,
        candidate,
        jobTitle,
        summary: candidate.summary,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
      decidedAt: null,
      decidedBy: null,
      decidedByUser: null,
    },
  };
}
