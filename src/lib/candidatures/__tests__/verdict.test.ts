/**
 * Le verdict final MOTIVÉ — cœur serveur.
 * Spec : docs/specs/compte-rendu-entretien.md §4.2, §14.
 *
 * Ce qui est tenu ici :
 *   - pas de décision sans commentaire, et un refus ne coûte AUCUNE lecture ni
 *     écriture ;
 *   - l'étape est relue : hors attente de verdict ⇒ rien n'est écrit (c'est
 *     aussi ce qui laisse l'historique en paix) ;
 *   - le commentaire PUIS le marqueur, qui porte l'IDENTIFIANT du commentaire
 *     et jamais son texte ;
 *   - aucun envoi, au runtime ET structurellement.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CandidateAnalysisSummary } from '@/types/reporting';

type JournalCall = { action: string; actor?: string; payload: Record<string, unknown> };
const calls: string[] = [];
const appendJournalEntry = vi.fn(async (entry: JournalCall) => {
  calls.push(`journal:${entry.action}`);
});
const insertVerdictComment = vi.fn(async (input: Record<string, unknown>) => {
  calls.push('comment');
  return { id: 'vc-1', ...input, createdAt: '2026-09-19T08:00:00.000Z' };
});
const loadStageSignals = vi.fn(async () => ({}));
let stages: string[] = [];
const sendEmail = vi.fn(async () => ({ ok: true }));

vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: (entry: JournalCall) => appendJournalEntry(entry),
  listJournalEntriesByActions: vi.fn(async () => []),
}));
vi.mock('@/lib/db/repos/verdict-comments', () => ({
  insertVerdictComment: (input: Record<string, unknown>) => insertVerdictComment(input),
  listVerdictCommentsByAnalyses: vi.fn(async () => []),
}));
vi.mock('@/lib/reporting/stage-signals', () => ({
  loadStageSignals: () => loadStageSignals(),
  stageFor: () => stages.shift() ?? 'entretien_fait',
}));
vi.mock('@/lib/email/client', () => ({ sendEmail: () => sendEmail() }));

const { postFinalVerdict } = await import('@/lib/candidatures/verdict');

const analysis = {
  id: 'can_imap_box_102',
  uid: 'uid-102',
  campaignId: 'CAMP-2026-288',
  candidateName: 'Témoin Candidat',
} as unknown as CandidateAnalysisSummary;

const GOOD =
  'Solide sur la recette et le pilotage du lot, il a su expliquer ses arbitrages ; réserve sur la mobilité.';
const actor = { userId: 'u-sarah', email: 'sarah@cabinet.fr' };

beforeEach(() => {
  calls.length = 0;
  stages = [];
  vi.clearAllMocks();
});

describe('pas de décision sans commentaire', () => {
  it.each(['', 'ok pour moi', 'bla '.repeat(20)])('« %s » : refusé, RIEN lu ni écrit', async (comment) => {
    const out = await postFinalVerdict({ analysis, verdict: 'validated', comment, actor });
    expect(out.status).toBe('comment_too_thin');
    expect(loadStageSignals).not.toHaveBeenCalled();
    expect(insertVerdictComment).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });

  it('la phrase de refus est métier', async () => {
    const out = await postFinalVerdict({ analysis, verdict: 'rejected', comment: 'non', actor });
    expect(out).toEqual({
      status: 'comment_too_thin',
      message: 'Encore 14 mots : expliquez ce qui motive votre décision.',
    });
  });
});

describe('seulement en attente de verdict — l’historique n’est jamais re-bloqué', () => {
  it.each(['retenu', 'non_retenu', 'invite', 'sans_suite'])('étape %s : 409, rien écrit', async (stage) => {
    stages = [stage];
    const out = await postFinalVerdict({ analysis, verdict: 'validated', comment: GOOD, actor });
    expect(out).toEqual({ status: 'not_awaiting_verdict', stage });
    expect(insertVerdictComment).not.toHaveBeenCalled();
    expect(appendJournalEntry).not.toHaveBeenCalled();
  });
});

describe('verdict posé', () => {
  it('le commentaire PUIS le marqueur, qui désigne le commentaire', async () => {
    stages = ['entretien_fait', 'retenu'];
    const out = await postFinalVerdict({ analysis, verdict: 'validated', comment: `  ${GOOD}  `, actor });
    expect(out).toEqual({ status: 'decided', verdict: 'validated', commentId: 'vc-1', nextStage: 'retenu' });
    expect(calls).toEqual(['comment', 'journal:candidate_validation_marked']);

    expect(insertVerdictComment).toHaveBeenCalledWith({
      analysisId: 'can_imap_box_102',
      uid: 'uid-102',
      campaignId: 'CAMP-2026-288',
      verdict: 'validated',
      body: GOOD, // espaces de bord retirés
      authorUserId: 'u-sarah',
      authorEmail: 'sarah@cabinet.fr',
    });
    const entry = appendJournalEntry.mock.calls[0]![0];
    expect(entry.actor).toBe('user');
    expect(entry.payload).toEqual({
      uid: 'uid-102',
      candidate: 'Témoin Candidat',
      status: 'validated',
      commentId: 'vc-1',
      actorUserId: 'u-sarah',
      actorEmail: 'sarah@cabinet.fr',
    });
  });

  it('le TEXTE du commentaire n’entre jamais dans le journal', async () => {
    stages = ['entretien_fait', 'non_retenu'];
    await postFinalVerdict({ analysis, verdict: 'rejected', comment: GOOD, actor });
    const blob = JSON.stringify(appendJournalEntry.mock.calls);
    expect(blob).not.toContain('recette');
    expect(blob).not.toContain('mobilité');
  });

  it('session illisible : auteur non enregistré, jamais inventé', async () => {
    stages = ['entretien_fait', 'retenu'];
    await postFinalVerdict({ analysis, verdict: 'validated', comment: GOOD, actor: null });
    expect(insertVerdictComment.mock.calls[0]![0]).toMatchObject({ authorUserId: null, authorEmail: null });
  });
});

describe('aucun envoi', () => {
  it('au runtime : le transport n’est jamais appelé', async () => {
    stages = ['entretien_fait', 'retenu'];
    await postFinalVerdict({ analysis, verdict: 'validated', comment: GOOD, actor });
    stages = ['entretien_fait', 'non_retenu'];
    await postFinalVerdict({ analysis, verdict: 'rejected', comment: GOOD, actor });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('structurellement : le module n’importe aucun émetteur', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/candidatures/verdict.ts'), 'utf8');
    for (const forbidden of ['@/lib/email/client', '@/lib/hitl/send-validation', 'sendEmail', 'emitCampaignBookingLink']) {
      expect(source).not.toContain(forbidden);
    }
  });
});
