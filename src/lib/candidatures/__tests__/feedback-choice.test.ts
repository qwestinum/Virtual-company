import { describe, expect, it } from 'vitest';

import {
  bodyQuotesComment,
  checkFeedbackChoice,
  FeedbackChoiceSchema,
  feedbackKindForVerdict,
} from '@/lib/candidatures/feedback-choice';
import {
  applyProposal,
  draftToChoice,
  editBody,
  emptyFeedbackDraft,
  resetBody,
  sendUnavailableReason,
  setNextStep,
} from '@/lib/candidatures/feedback-draft';
import type { FeedbackProposal } from '@/types/candidate-feedback';
import { DEFAULT_FEEDBACK_NEXT_STEP, DEFAULT_FEEDBACK_RETAINED_TEMPLATE } from '@/types/interview-settings';

const PROPOSAL: FeedbackProposal = {
  kind: 'retenu',
  template: DEFAULT_FEEDBACK_RETAINED_TEMPLATE,
  vars: {
    prenom: 'Awa',
    jobTitle: 'Chef de projet',
    organisation: 'Cabinet',
    recruiterFirstName: 'Sami',
    recruiterName: 'Sami B.',
  },
  candidateEmail: 'awa@exemple.fr',
  replyTo: 'sami@cabinet.fr',
  rgpdFooter: 'Vos données…',
  alreadyInformed: null,
};

const COMMENT = 'Réserves sur la mobilité, solide sur la recette';

describe('schéma du choix', () => {
  it('refuse un envoi vide et un canal inconnu', () => {
    expect(FeedbackChoiceSchema.safeParse({ mode: 'send', subject: 'x', body: '   ' }).success).toBe(false);
    expect(FeedbackChoiceSchema.safeParse({ mode: 'self', channel: 'pigeon' }).success).toBe(false);
    expect(FeedbackChoiceSchema.safeParse({ mode: 'self', channel: 'telephone' }).success).toBe(true);
  });

  it('un verdict annonce son type de message', () => {
    expect(feedbackKindForVerdict('validated')).toBe('retenu');
    expect(feedbackKindForVerdict('rejected')).toBe('non_retenu');
  });
});

describe('contrôle serveur du choix', () => {
  const send = { mode: 'send' as const, subject: 'Votre candidature', body: 'Bonjour Awa, merci.' };

  it('« je préviens » est toujours recevable, même sans adresse', () => {
    expect(checkFeedbackChoice({ mode: 'self', channel: 'telephone' }, { candidateEmail: null })).toBeNull();
  });

  it('envoyer sans adresse est refusé', () => {
    expect(checkFeedbackChoice(send, { candidateEmail: null })).toBe('no_candidate_email');
  });

  it('TEST NÉGATIF : un corps qui reprend le commentaire interne est refusé', () => {
    const leaked = { ...send, body: `Bonjour Awa,\n\n${COMMENT.toUpperCase()}\n\nCordialement` };
    expect(checkFeedbackChoice(leaked, { candidateEmail: 'a@b.fr', comment: COMMENT })).toBe(
      'comment_in_message',
    );
    expect(bodyQuotesComment('réserves   sur la\nmobilité, solide sur la recette', COMMENT)).toBe(true);
  });

  it('un commentaire trop court n’est pas « détecté » (pas de faux positif)', () => {
    expect(bodyQuotesComment('Bonjour, OK pour la suite', 'OK')).toBe(false);
  });

  it('une variable restée entre crochets est refusée', () => {
    expect(
      checkFeedbackChoice({ ...send, body: 'Bonjour [prenom]' }, { candidateEmail: 'a@b.fr' }),
    ).toBe('unresolved_placeholders');
  });
});

describe('brouillon de l’écran', () => {
  it('aucun choix par défaut : ni silence, ni envoi', () => {
    const d = applyProposal(emptyFeedbackDraft(), PROPOSAL);
    expect(d.mode).toBeNull();
    expect(draftToChoice(d, PROPOSAL)).toBeNull();
  });

  it('envoyer : le texte proposé est prêt', () => {
    const d = { ...applyProposal(emptyFeedbackDraft(), PROPOSAL), mode: 'send' as const };
    const c = draftToChoice(d, PROPOSAL);
    expect(c?.mode).toBe('send');
    expect(c && c.mode === 'send' && c.body).toContain(DEFAULT_FEEDBACK_NEXT_STEP);
  });

  it('le corps suit la prochaine étape tant qu’il n’est pas retouché', () => {
    let d = applyProposal(emptyFeedbackDraft(), PROPOSAL);
    d = setNextStep(d, 'Rencontre client jeudi.', PROPOSAL);
    expect(d.body).toContain('Rencontre client jeudi.');
    d = editBody(d, d.body + '\nPS');
    d = setNextStep(d, 'Autre chose.', PROPOSAL);
    expect(d.body).toContain('Rencontre client jeudi.');
    expect(d.body).not.toContain('Autre chose.');
    d = resetBody(d, PROPOSAL);
    expect(d.body).toContain('Autre chose.');
  });

  it('je préviens : il faut un canal, et une précision pour « autre »', () => {
    const base = { ...emptyFeedbackDraft(), mode: 'self' as const };
    expect(draftToChoice(base, PROPOSAL)).toBeNull();
    expect(draftToChoice({ ...base, channel: 'autre' }, PROPOSAL)).toBeNull();
    expect(draftToChoice({ ...base, channel: 'autre', note: 'LinkedIn' }, PROPOSAL)).toEqual({
      mode: 'self',
      channel: 'autre',
      note: 'LinkedIn',
    });
  });

  it('envoyer n’est pas offert sans adresse, ni si le candidat est déjà informé', () => {
    const noEmail = { ...PROPOSAL, candidateEmail: null };
    expect(sendUnavailableReason(noEmail)).toBe('no_email');
    const d = applyProposal({ ...emptyFeedbackDraft(), mode: 'send' }, noEmail);
    expect(d.mode).toBeNull();
    const informed = { ...PROPOSAL, alreadyInformed: { channel: 'mail' as const, at: '2026-09-01' } };
    expect(draftToChoice({ ...applyProposal(emptyFeedbackDraft(), informed), mode: 'send' }, informed)).toBeNull();
  });

  it('une variable entre crochets désarme l’envoi', () => {
    const d = editBody({ ...applyProposal(emptyFeedbackDraft(), PROPOSAL), mode: 'send' }, 'Bonjour [prenom]');
    expect(draftToChoice(d, PROPOSAL)).toBeNull();
  });
});
