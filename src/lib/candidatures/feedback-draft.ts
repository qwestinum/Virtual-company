/**
 * Brouillon du choix de message à l'écran de décision — logique PURE et
 * testée (le rendu React n'est pas testable en environnement node).
 * CLIENT-SAFE.
 *
 * Règles :
 *   - AUCUN choix n'est pré-sélectionné : le recruteur choisit explicitement
 *     « envoyer » ou « je préviens moi-même » — jamais le silence par défaut,
 *     jamais l'envoi par défaut ;
 *   - tant que le corps n'a pas été retouché, il SUIT la prochaine étape
 *     saisie ; dès la première retouche, il ne bouge plus (on n'écrase jamais
 *     un texte écrit à la main) ;
 *   - « envoyer » n'est pas offert sans adresse, ni quand un message du même
 *     type a déjà informé le candidat (rien ne repartirait).
 */

import { renderFeedbackProposal, unresolvedPlaceholders } from '@/lib/candidatures/feedback-template';
import type {
  FeedbackChoice,
  FeedbackProposal,
  SelfFeedbackChannel,
} from '@/types/candidate-feedback';

export type FeedbackDraft = {
  mode: 'send' | 'self' | null;
  subject: string;
  body: string;
  /** Le corps a été retouché à la main : il ne suit plus la prochaine étape. */
  bodyEdited: boolean;
  nextStep: string;
  channel: SelfFeedbackChannel | null;
  note: string;
};

export function emptyFeedbackDraft(): FeedbackDraft {
  return {
    mode: null,
    subject: '',
    body: '',
    bodyEdited: false,
    nextStep: '',
    channel: null,
    note: '',
  };
}

/** Pourquoi « envoyer » n'est pas offert ; `null` = offert. */
export function sendUnavailableReason(
  proposal: Pick<FeedbackProposal, 'candidateEmail' | 'alreadyInformed'>,
): 'no_email' | 'already_informed' | null {
  if (!proposal.candidateEmail) return 'no_email';
  if (proposal.alreadyInformed) return 'already_informed';
  return null;
}

function rendered(proposal: FeedbackProposal, nextStep: string) {
  return renderFeedbackProposal(proposal.template, { ...proposal.vars, nextStep });
}

/** La proposition arrive : on remplit ce qui n'a pas été retouché. */
export function applyProposal(draft: FeedbackDraft, proposal: FeedbackProposal): FeedbackDraft {
  const { subject, body } = rendered(proposal, draft.nextStep);
  return {
    ...draft,
    subject: draft.subject || subject,
    body: draft.bodyEdited ? draft.body : body,
    mode: draft.mode === 'send' && sendUnavailableReason(proposal) ? null : draft.mode,
  };
}

export function setNextStep(
  draft: FeedbackDraft,
  nextStep: string,
  proposal: FeedbackProposal | null,
): FeedbackDraft {
  if (draft.bodyEdited || !proposal) return { ...draft, nextStep };
  return { ...draft, nextStep, body: rendered(proposal, nextStep).body };
}

export function editBody(draft: FeedbackDraft, body: string): FeedbackDraft {
  return { ...draft, body, bodyEdited: true };
}

/** Remet le texte proposé (avec la prochaine étape courante). */
export function resetBody(draft: FeedbackDraft, proposal: FeedbackProposal): FeedbackDraft {
  return { ...draft, body: rendered(proposal, draft.nextStep).body, bodyEdited: false };
}

/** Variables restées entre crochets — l'écran les signale, l'envoi est refusé. */
export function draftPlaceholders(draft: FeedbackDraft): string[] {
  return [...new Set([...unresolvedPlaceholders(draft.subject), ...unresolvedPlaceholders(draft.body)])];
}

/**
 * Le choix prêt à partir, ou `null` tant qu'il est incomplet — c'est ce qui
 * désarme le bouton de décision.
 */
export function draftToChoice(
  draft: FeedbackDraft,
  proposal: FeedbackProposal | null,
): FeedbackChoice | null {
  if (draft.mode === 'self') {
    if (!draft.channel) return null;
    if (draft.channel === 'autre' && !draft.note.trim()) return null;
    return { mode: 'self', channel: draft.channel, note: draft.note.trim() || null };
  }
  if (draft.mode === 'send') {
    if (!proposal || sendUnavailableReason(proposal)) return null;
    if (!draft.subject.trim() || !draft.body.trim()) return null;
    if (draftPlaceholders(draft).length > 0) return null;
    return { mode: 'send', subject: draft.subject.trim(), body: draft.body.trim() };
  }
  return null;
}
