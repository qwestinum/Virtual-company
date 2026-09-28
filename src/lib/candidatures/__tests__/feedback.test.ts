/**
 * Message au candidat après décision — cœur serveur (`recordFeedback`).
 * Exactly-once par (candidature, type) via le verrou deux-phases ; « je
 * préviens moi-même » n'envoie rien ; le journal ne porte ni corps ni nom.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Claim = 'won' | 'in_flight' | 'already_sent';
const state = {
  claims: new Map<string, 'pending' | 'confirmed'>(),
  sent: [] as { to: string; subject: string; html: string; replyTo?: string }[],
  rows: [] as Record<string, unknown>[],
  settled: [] as { id: string; status: string }[],
  journal: [] as { action: string; payload: Record<string, unknown> }[],
  sendOk: true,
};
const keyOf = (k: { mailboxId: string; uid: string; mode: string }) => `${k.mailboxId}|${k.uid}|${k.mode}`;

vi.mock('@/lib/db/repos/imap-outreach-claims', () => ({
  claimOutreach: vi.fn(async (k: { mailboxId: string; uid: string; mode: string }): Promise<Claim> => {
    const cur = state.claims.get(keyOf(k));
    if (cur === 'confirmed') return 'already_sent';
    if (cur === 'pending') return 'in_flight';
    state.claims.set(keyOf(k), 'pending');
    return 'won';
  }),
  confirmOutreachClaim: vi.fn(async (k: { mailboxId: string; uid: string; mode: string }) => {
    state.claims.set(keyOf(k), 'confirmed');
  }),
  releaseOutreachClaim: vi.fn(async (k: { mailboxId: string; uid: string; mode: string }) => {
    state.claims.delete(keyOf(k));
  }),
}));
vi.mock('@/lib/email/client', () => ({
  sendEmail: vi.fn(async (input: { to: string; subject: string; html: string; replyTo?: string }) => {
    if (!state.sendOk) return { ok: false, messageId: null, error: 'boom' };
    state.sent.push(input);
    return { ok: true, messageId: 'm1' };
  }),
}));
vi.mock('@/lib/db/repos/candidate-feedback', () => ({
  insertPendingFeedbackMail: vi.fn(async (input: Record<string, unknown>) => {
    const row = { ...input, id: `fb${state.rows.length + 1}`, channel: 'mail' };
    state.rows.push(row);
    return row;
  }),
  insertSelfFeedback: vi.fn(async (input: Record<string, unknown>) => {
    const row = { ...input, id: `fb${state.rows.length + 1}` };
    state.rows.push(row);
    return row;
  }),
  settleFeedbackMail: vi.fn(async (id: string, status: string) => {
    state.settled.push({ id, status });
    return true;
  }),
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn(async (e: { action: string; payload: Record<string, unknown> }) => {
    state.journal.push(e);
  }),
}));

const { recordFeedback, feedbackClaimKey } = await import('@/lib/candidatures/feedback');
import type { FeedbackContext } from '@/lib/candidatures/feedback';

const ANALYSIS = {
  id: 'can_1',
  uid: 'u1',
  campaignId: 'CAMP-2026-001',
  candidateName: 'Awa Témoin',
  candidateEmail: 'awa@exemple.fr',
};
const CTX: FeedbackContext = {
  vars: {
    prenom: 'Awa',
    jobTitle: 'Chef de projet',
    organisation: 'Cabinet',
    recruiterFirstName: 'Sami',
    recruiterName: 'Sami B.',
  },
  templates: {
    feedbackRetainedTemplate: 'x',
    feedbackNotRetainedTemplate: 'x',
    feedbackNoShowTemplate: 'x',
    feedbackDismissedTemplate: 'x',
  },
  candidateEmail: 'awa@exemple.fr',
  replyTo: 'sami@cabinet.fr',
  rgpdContact: 'rh@cabinet.fr',
};
const ACTOR = { userId: '00000000-0000-0000-0000-000000000001', email: 'sami@cabinet.fr' };
const SEND = { mode: 'send' as const, subject: 'Votre candidature', body: 'Bonjour Awa,\n\nMerci.' };

beforeEach(() => {
  state.claims.clear();
  state.sent = [];
  state.rows = [];
  state.settled = [];
  state.journal = [];
  state.sendOk = true;
});

describe('recordFeedback', () => {
  it('« envoyer » ⇒ UN mail, signé du recruteur, mention RGPD en pied', async () => {
    const out = await recordFeedback({ analysis: ANALYSIS, kind: 'retenu', choice: SEND, actor: ACTOR, context: CTX });
    expect(out.mailStatus).toBe('sent');
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]!.to).toBe('awa@exemple.fr');
    expect(state.sent[0]!.replyTo).toBe('sami@cabinet.fr');
    expect(state.sent[0]!.html).toContain('rh@cabinet.fr');
    expect(state.settled).toEqual([{ id: 'fb1', status: 'sent' }]);
  });

  it('double clic / rejeu ⇒ un seul mail, le second est `duplicate`', async () => {
    await recordFeedback({ analysis: ANALYSIS, kind: 'non_retenu', choice: SEND, actor: ACTOR, context: CTX });
    const again = await recordFeedback({ analysis: ANALYSIS, kind: 'non_retenu', choice: SEND, actor: ACTOR, context: CTX });
    expect(again.mailStatus).toBe('duplicate');
    expect(state.sent).toHaveLength(1);
  });

  it('deux envois CONCURRENTS ⇒ un seul mail', async () => {
    const [a, b] = await Promise.all([
      recordFeedback({ analysis: ANALYSIS, kind: 'absent', choice: SEND, actor: ACTOR, context: CTX }),
      recordFeedback({ analysis: ANALYSIS, kind: 'absent', choice: SEND, actor: ACTOR, context: CTX }),
    ]);
    expect([a.mailStatus, b.mailStatus].sort()).toEqual(['duplicate', 'sent']);
    expect(state.sent).toHaveLength(1);
  });

  it('un autre TYPE (verdict corrigé) n’est pas bloqué par le premier — mais n’est jamais automatique', async () => {
    await recordFeedback({ analysis: ANALYSIS, kind: 'retenu', choice: SEND, actor: ACTOR, context: CTX });
    await recordFeedback({ analysis: ANALYSIS, kind: 'non_retenu', choice: SEND, actor: ACTOR, context: CTX });
    expect(state.sent).toHaveLength(2);
  });

  it('« je préviens moi-même » ⇒ AUCUN mail, le canal est tracé au journal', async () => {
    const out = await recordFeedback({
      analysis: ANALYSIS,
      kind: 'non_retenu',
      choice: { mode: 'self', channel: 'telephone' },
      actor: ACTOR,
      context: CTX,
    });
    expect(out).toMatchObject({ channel: 'telephone', mailStatus: null });
    expect(state.sent).toHaveLength(0);
    expect(state.journal).toHaveLength(1);
    expect(state.journal[0]!.payload).toMatchObject({ channel: 'telephone', kind: 'non_retenu' });
  });

  it('le journal ne porte ni le corps, ni l’objet, ni le nom', async () => {
    await recordFeedback({ analysis: ANALYSIS, kind: 'retenu', choice: SEND, actor: ACTOR, context: CTX, cause: 'x' });
    const text = JSON.stringify(state.journal);
    expect(text).not.toContain('Merci.');
    expect(text).not.toContain('Votre candidature');
    expect(text).not.toContain('Awa');
    expect(state.journal[0]!.payload).toMatchObject({ feedbackId: 'fb1', analysisId: 'can_1', mailStatus: 'sent' });
  });

  it('échec de transport ⇒ `send_failed`, verrou relâché (un réessai pourra partir)', async () => {
    state.sendOk = false;
    const out = await recordFeedback({ analysis: ANALYSIS, kind: 'retenu', choice: SEND, actor: ACTOR, context: CTX });
    expect(out.mailStatus).toBe('send_failed');
    expect(state.claims.size).toBe(0);
    state.sendOk = true;
    const retry = await recordFeedback({ analysis: ANALYSIS, kind: 'retenu', choice: SEND, actor: ACTOR, context: CTX });
    expect(retry.mailStatus).toBe('sent');
  });

  it('sans adresse ⇒ rien ne part, `skipped_no_email`', async () => {
    const out = await recordFeedback({
      analysis: { ...ANALYSIS, candidateEmail: null },
      kind: 'retenu',
      choice: SEND,
      actor: ACTOR,
      context: { ...CTX, candidateEmail: null },
    });
    expect(out.mailStatus).toBe('skipped_no_email');
    expect(state.sent).toHaveLength(0);
  });

  it('« sans suite » partage la clé du mail d’information historique', () => {
    expect(feedbackClaimKey('can_1', 'sans_suite')).toEqual({
      mailboxId: 'candidature_dismissal',
      uid: 'can_1',
      mode: 'dismiss',
    });
    expect(feedbackClaimKey('can_1', 'retenu').mailboxId).toBe('candidate_feedback');
  });
});
