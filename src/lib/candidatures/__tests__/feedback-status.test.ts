import { describe, expect, it } from 'vitest';

import { expectedFeedbackKind, feedbackStatus } from '@/lib/candidatures/feedback-status';
import type { CandidateFeedback } from '@/types/candidate-feedback';

const base = { validationMarked: null, interviewMarked: null, dismissalReason: null } as const;

describe('le message que la situation appelle', () => {
  it('retenu → « Retenu » ; recruté, écarté, dossiers ouverts → rien', () => {
    expect(expectedFeedbackKind({ ...base, stage: 'retenu', validationMarked: 'validated' })).toBe('retenu');
    for (const stage of ['recrute', 'ecarte', 'a_valider', 'proposition_refus', 'invite', 'rdv_pris', 'entretien_fait'] as const) {
      expect(expectedFeedbackKind({ ...base, stage }), stage).toBeNull();
    }
  });

  it('non retenu : le verdict prime, sinon c’est l’absence', () => {
    expect(
      expectedFeedbackKind({ ...base, stage: 'non_retenu', validationMarked: 'rejected', interviewMarked: 'realized' }),
    ).toBe('non_retenu');
    expect(expectedFeedbackKind({ ...base, stage: 'non_retenu', interviewMarked: 'missed' })).toBe('absent');
  });

  it('sans suite : un message, sauf doublon / invalide', () => {
    expect(expectedFeedbackKind({ ...base, stage: 'sans_suite', dismissalReason: 'candidat_retire' })).toBe('sans_suite');
    expect(expectedFeedbackKind({ ...base, stage: 'sans_suite', dismissalReason: 'doublon' })).toBeNull();
    expect(expectedFeedbackKind({ ...base, stage: 'sans_suite', dismissalReason: null })).toBeNull();
  });
});

const row = (over: Partial<CandidateFeedback>): CandidateFeedback => ({
  id: 'f',
  analysisId: 'a',
  uid: 'u',
  campaignId: 'C',
  kind: 'retenu',
  channel: 'mail',
  channelNote: null,
  subject: 's',
  body: 'b',
  mailStatus: 'sent',
  sentAt: null,
  authorUserId: null,
  authorEmail: null,
  createdAt: '2026-09-28T10:00:00Z',
  ...over,
});

describe('informé ?', () => {
  it('un envoi parti, ou un « je préviens », informe', () => {
    expect(feedbackStatus('retenu', [row({})]).informed?.id).toBe('f');
    expect(feedbackStatus('retenu', [row({ channel: 'telephone', mailStatus: null })]).informed).not.toBeNull();
  });

  it('un envoi en échec n’informe pas — mais reste la dernière tentative', () => {
    const s = feedbackStatus('retenu', [row({ mailStatus: 'send_failed' })]);
    expect(s.informed).toBeNull();
    expect(s.lastAttempt?.mailStatus).toBe('send_failed');
  });

  it('un message d’un AUTRE type (verdict corrigé) n’informe pas de la situation actuelle', () => {
    expect(feedbackStatus('non_retenu', [row({ kind: 'retenu' })]).informed).toBeNull();
  });

  it('rien à annoncer ⇒ rien de lu', () => {
    expect(feedbackStatus(null, [row({})])).toEqual({ expectedKind: null, informed: null, lastAttempt: null });
  });
});
