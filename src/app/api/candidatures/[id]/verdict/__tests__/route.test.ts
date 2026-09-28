/**
 * Règle SERVEUR (feat/feedback-candidat) : un verdict final ne se pose pas
 * sans choix de message au candidat, et un message qui reprend le commentaire
 * interne est refusé AVANT toute écriture. Même règle pour l'absence et le
 * « sans suite » individuel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ANALYSIS = {
  id: 'can_1',
  uid: 'u1',
  campaignId: 'CAMP-2026-001',
  candidateName: 'Awa Témoin',
  candidateEmail: 'awa@exemple.fr',
};
const postFinalVerdict = vi.fn(async () => ({
  status: 'decided' as const,
  verdict: 'rejected' as const,
  commentId: null,
  nextStage: 'non_retenu',
}));
const postNoShow = vi.fn(async () => ({ status: 'decided' as const, nextStage: 'non_retenu' }));
const dismissCandidature = vi.fn(async () => ({ status: 'dismissed' as const, mailStatus: 'not_requested' }));
const recordFeedback = vi.fn(async () => ({
  feedbackId: 'fb1',
  kind: 'non_retenu',
  channel: 'mail',
  mailStatus: 'sent',
}));

vi.mock('@/lib/auth/require-api-user', () => ({ getApiUser: vi.fn(async () => null) }));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  getCandidateAnalysis: vi.fn(async () => ANALYSIS),
}));
vi.mock('@/lib/candidatures/verdict', () => ({ postFinalVerdict: () => postFinalVerdict() }));
vi.mock('@/lib/candidatures/no-show', () => ({ postNoShow: () => postNoShow() }));
vi.mock('@/lib/candidatures/dismissal', () => ({ dismissCandidature: () => dismissCandidature() }));
vi.mock('@/lib/candidatures/feedback', () => ({ recordFeedback: () => recordFeedback() }));

const verdict = await import('@/app/api/candidatures/[id]/verdict/route');
const noShow = await import('@/app/api/candidatures/[id]/no-show/route');
const dismiss = await import('@/app/api/candidatures/[id]/dismiss/route');

type Handler = (r: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
const call = (handler: Handler, body: unknown) =>
  handler(
    new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: 'can_1' }) },
  );

const COMMENT = 'Réserves sur la mobilité, solide sur la recette';
const SEND = { mode: 'send', subject: 'Votre candidature', body: 'Bonjour Awa, merci.' };

beforeEach(() => vi.clearAllMocks());

describe('verdict : le message au candidat est OBLIGATOIRE', () => {
  it('sans choix ⇒ 400 `feedback_required`, aucun verdict posé', async () => {
    const res = await call(verdict.POST, { status: 'rejected', comment: COMMENT });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('feedback_required');
    expect(postFinalVerdict).not.toHaveBeenCalled();
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('TEST NÉGATIF : le commentaire collé dans le message ⇒ 400, rien posé, rien envoyé', async () => {
    const res = await call(verdict.POST, {
      status: 'rejected',
      comment: COMMENT,
      feedback: { ...SEND, body: `Bonjour Awa,\n${COMMENT}` },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('comment_in_message');
    expect(postFinalVerdict).not.toHaveBeenCalled();
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('choix recevable ⇒ verdict PUIS message', async () => {
    const res = await call(verdict.POST, { status: 'rejected', comment: COMMENT, feedback: SEND });
    expect(res.status).toBe(200);
    expect(postFinalVerdict).toHaveBeenCalledTimes(1);
    expect(recordFeedback).toHaveBeenCalledTimes(1);
    expect((await res.json()).feedback.mailStatus).toBe('sent');
  });

  it('« je préviens moi-même » est recevable', async () => {
    const res = await call(verdict.POST, {
      status: 'validated',
      feedback: { mode: 'self', channel: 'telephone' },
    });
    expect(res.status).toBe(200);
  });

  it('l’échec du message ne défait pas le verdict : il se DIT', async () => {
    recordFeedback.mockRejectedValueOnce(new Error('db'));
    const res = await call(verdict.POST, { status: 'rejected', feedback: SEND });
    expect(res.status).toBe(200);
    expect((await res.json()).feedback).toEqual({ error: 'record_failed' });
  });
});

describe('absence classée non retenue : même règle', () => {
  it('sans choix ⇒ 400, aucun marqueur', async () => {
    const res = await call(noShow.POST, {});
    expect(res.status).toBe(400);
    expect(postNoShow).not.toHaveBeenCalled();
  });

  it('avec choix ⇒ marqueur puis message', async () => {
    const res = await call(noShow.POST, { feedback: { mode: 'self', channel: 'mail_personnel' } });
    expect(res.status).toBe(200);
    expect(postNoShow).toHaveBeenCalledTimes(1);
    expect(recordFeedback).toHaveBeenCalledTimes(1);
  });
});

describe('« sans suite » individuel', () => {
  it('raison qui appelle un message, sans choix ⇒ 400, rien classé', async () => {
    const res = await call(dismiss.POST, { reason: 'sans_reponse' });
    expect(res.status).toBe(400);
    expect(dismissCandidature).not.toHaveBeenCalled();
  });

  it('doublon ⇒ aucun choix demandé, aucun message', async () => {
    const res = await call(dismiss.POST, { reason: 'doublon' });
    expect(res.status).toBe(200);
    expect(dismissCandidature).toHaveBeenCalledTimes(1);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('avec choix ⇒ classement puis message', async () => {
    const res = await call(dismiss.POST, { reason: 'candidat_retire', feedback: SEND });
    expect(res.status).toBe(200);
    expect(recordFeedback).toHaveBeenCalledTimes(1);
  });
});
