/**
 * Clôture — désignation du recruté et retenus non sélectionnés
 * (feat/feedback-candidat, lot 4). Contrôle AVANT écriture, puis écritures
 * canoniques : marqueur « recruté », verdict `rejected` + cause, un message
 * par non-sélectionné par le chemin unique des messages.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const journal: { action: string; payload: Record<string, unknown> }[] = [];
const recordFeedback = vi.fn(async (args: { analysis: { id: string }; kind: string; cause?: string }) => ({
  feedbackId: `fb_${args.analysis.id}`,
  kind: args.kind,
  channel: 'mail',
  mailStatus: 'sent',
}));

vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn(async (e: { action: string; payload: Record<string, unknown> }) => {
    journal.push(e);
  }),
}));
vi.mock('@/lib/candidatures/feedback', () => ({
  recordFeedback: (a: { analysis: { id: string }; kind: string; cause?: string }) => recordFeedback(a),
}));

const { applyClosureDecisions, checkClosure, NOT_SELECTED_CAUSE } = await import(
  '@/lib/campagnes/closure'
);
import type { CandidateAnalysisSummary } from '@/types/reporting';

const retenu = (id: string, email: string | null = `${id}@ex.fr`) =>
  ({
    id,
    uid: `u_${id}`,
    campaignId: 'CAMP-2026-001',
    candidateName: `Nom ${id}`,
    candidateEmail: email,
  }) as unknown as CandidateAnalysisSummary;
const RETENUS = [retenu('awa'), retenu('jean'), retenu('lea')];
const SELF = { mode: 'self', channel: 'telephone' } as const;
const SEND = { mode: 'send', subject: 'Votre candidature', body: 'Bonjour, merci.' } as const;

beforeEach(() => {
  journal.length = 0;
  recordFeedback.mockClear();
});

describe('checkClosure — tout est contrôlé AVANT écriture', () => {
  it('non conclu, conclu sans préciser : recevables sans rien d’autre', () => {
    expect(checkClosure({ outcome: 'non_conclu', hiredAnalysisId: null, notSelected: [] }, RETENUS)).toBeNull();
    expect(checkClosure({ outcome: 'conclu', hiredAnalysisId: null, notSelected: [] }, RETENUS)).toBeNull();
  });

  it('une désignation sur une clôture non conclue est refusée', () => {
    expect(
      checkClosure({ outcome: 'non_conclu', hiredAnalysisId: 'jean', notSelected: [] }, RETENUS)?.error,
    ).toBe('hire_without_conclusion');
  });

  it('le recruté doit être un retenu COURANT', () => {
    expect(
      checkClosure({ outcome: 'conclu', hiredAnalysisId: 'inconnu', notSelected: [] }, RETENUS)?.error,
    ).toBe('invalid_hire');
  });

  it('chaque autre retenu exige SON message — règle serveur', () => {
    const r = checkClosure(
      { outcome: 'conclu', hiredAnalysisId: 'jean', notSelected: [{ analysisId: 'awa', feedback: SELF }] },
      RETENUS,
    );
    expect(r).toMatchObject({ error: 'feedback_required', analysisId: 'lea' });
  });

  it('un message pour le recruté lui-même, ou pour un non-retenu, est refusé', () => {
    expect(
      checkClosure(
        {
          outcome: 'conclu',
          hiredAnalysisId: 'jean',
          notSelected: [
            { analysisId: 'awa', feedback: SELF },
            { analysisId: 'lea', feedback: SELF },
            { analysisId: 'jean', feedback: SELF },
          ],
        },
        RETENUS,
      )?.error,
    ).toBe('not_selected_mismatch');
  });

  it('« envoyer » sans adresse est refusé pour le candidat concerné', () => {
    const retenus = [retenu('awa', null), retenu('jean')];
    expect(
      checkClosure(
        { outcome: 'conclu', hiredAnalysisId: 'jean', notSelected: [{ analysisId: 'awa', feedback: SEND }] },
        retenus,
      ),
    ).toMatchObject({ error: 'no_candidate_email', analysisId: 'awa' });
  });
});

describe('applyClosureDecisions — les écritures', () => {
  it('désignation : UN marqueur « recruté » ; les autres « non retenu » + cause, un message chacun', async () => {
    const out = await applyClosureDecisions({
      input: {
        outcome: 'conclu',
        hiredAnalysisId: 'jean',
        notSelected: [
          { analysisId: 'awa', feedback: SEND },
          { analysisId: 'lea', feedback: SELF },
        ],
      },
      retenus: RETENUS,
      actor: { userId: '00000000-0000-0000-0000-000000000001', email: 'sami@cabinet.fr' },
    });

    const hired = journal.filter((e) => e.action === 'candidate_hired_marked');
    expect(hired).toHaveLength(1);
    expect(hired[0]!.payload).toMatchObject({ uid: 'u_jean', status: 'hired', actorEmail: 'sami@cabinet.fr' });

    const verdicts = journal.filter((e) => e.action === 'candidate_validation_marked');
    expect(verdicts.map((v) => v.payload.uid)).toEqual(['u_awa', 'u_lea']);
    for (const v of verdicts) {
      expect(v.payload).toMatchObject({ status: 'rejected', cause: NOT_SELECTED_CAUSE });
    }

    expect(recordFeedback).toHaveBeenCalledTimes(2);
    for (const call of recordFeedback.mock.calls) {
      expect(call[0]).toMatchObject({ kind: 'non_retenu', cause: NOT_SELECTED_CAUSE });
    }
    expect(out.map((o) => o.analysisId)).toEqual(['awa', 'lea']);
  });

  it('sans désignation : aucune écriture, aucun message', async () => {
    const out = await applyClosureDecisions({
      input: { outcome: 'conclu', hiredAnalysisId: null, notSelected: [] },
      retenus: RETENUS,
      actor: null,
    });
    expect(out).toEqual([]);
    expect(journal).toHaveLength(0);
    expect(recordFeedback).not.toHaveBeenCalled();
  });

  it('un message en échec ne défait pas le verdict : il se DIT', async () => {
    recordFeedback.mockRejectedValueOnce(new Error('db'));
    const out = await applyClosureDecisions({
      input: {
        outcome: 'conclu',
        hiredAnalysisId: 'jean',
        notSelected: [
          { analysisId: 'awa', feedback: SEND },
          { analysisId: 'lea', feedback: SELF },
        ],
      },
      retenus: RETENUS,
      actor: null,
    });
    expect(out[0]!.feedback).toEqual({ error: 'record_failed' });
    expect(journal.filter((e) => e.action === 'candidate_validation_marked')).toHaveLength(2);
  });

  it('le journal de désignation ne porte aucun texte de message', async () => {
    await applyClosureDecisions({
      input: {
        outcome: 'conclu',
        hiredAnalysisId: 'jean',
        notSelected: [
          { analysisId: 'awa', feedback: SEND },
          { analysisId: 'lea', feedback: SELF },
        ],
      },
      retenus: RETENUS,
      actor: null,
    });
    expect(JSON.stringify(journal)).not.toContain('Bonjour, merci.');
  });
});
