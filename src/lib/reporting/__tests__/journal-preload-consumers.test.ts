/**
 * Les dérivations nourries par une lecture PARTAGÉE du journal rendent
 * exactement ce qu'elles rendaient avec leur propre lecture ciblée — y compris
 * leurs replis en cas d'échec, qui restent propres à chacune.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { JournalEntry } from '@/lib/db/repos/journal';

const listJournalEntriesByActions = vi.fn();
const listPendingValidations = vi.fn();

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: (...a: unknown[]) => listJournalEntriesByActions(...a),
}));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  listPendingValidations: () => listPendingValidations(),
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  listScheduledInterviewUids: vi.fn(async () => new Set<string>()),
  getScheduledInterviewByUid: vi.fn(async () => null),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  listAllCandidateAnalyses: vi.fn(async () => []),
  countCandidateAnalyses: vi.fn(async () => 0),
}));

import { unionActions } from '../journal-preload';
import { CANDIDATE_MARKER_ACTIONS, loadJourneySignals } from '../journey-lookup';
import { loadStageSignals, STAGE_MARKER_ACTIONS } from '../stage-signals';
import { extractCandidateTimelineFacts, TIMELINE_JOURNAL_ACTIONS } from '../timeline-facts';
import type { CandidateAnalysisDetail } from '@/types/reporting';

let id = 1;
function e(action: string, payload: Record<string, unknown>, createdAt: string): JournalEntry {
  return { id: id++, action, campaignId: 'CAMP-1', actor: 'user', payload, createdAt };
}

/** Journal DESC, toutes actions confondues — ce que lirait l'union. */
const ALL: JournalEntry[] = [
  e('decision_corrected', { uid: 'u1', previousLabel: 'A', nextLabel: 'B' }, '2026-09-06T00:00:00.000Z'),
  e('candidate_interview_marked', { uid: 'u1', status: 'cleared' }, '2026-09-05T00:00:00.000Z'),
  e('candidate_validation_marked', { uid: 'u1', status: 'validated' }, '2026-09-04T00:00:00.000Z'),
  e('candidate_interview_marked', { uid: 'u1', status: 'realized' }, '2026-09-03T00:00:00.000Z'),
  e('imap_outreach_mail', { uid: 'u1', mode: 'invite', status: 'sent' }, '2026-09-02T00:00:00.000Z'),
  e('hitl_validation_sent', { uid: 'u1', decision: 'accept', mailSent: true }, '2026-09-02T00:00:00.000Z'),
  e('imap_cv_analyzed', { uid: 'u1', candidate: 'Malaka', score: 70 }, '2026-09-01T00:00:00.000Z'),
];

/** La lecture ciblée d'origine : les seules actions demandées, même ordre. */
function targeted(actions: unknown): JournalEntry[] {
  const wanted = new Set(actions as string[]);
  return ALL.filter((x) => wanted.has(x.action));
}

const PENDING = [{ payload: { uid: 'u2' } }];

beforeEach(() => {
  vi.clearAllMocks();
  listJournalEntriesByActions.mockImplementation(async (actions: unknown) => targeted(actions));
  listPendingValidations.mockResolvedValue(PENDING);
});

const UNION = unionActions(CANDIDATE_MARKER_ACTIONS, TIMELINE_JOURNAL_ACTIONS, STAGE_MARKER_ACTIONS);

describe('lecture partagée ⇔ lectures ciblées', () => {
  it('parcours (journey)', async () => {
    const own = await loadJourneySignals({ campaignId: 'CAMP-1' });
    const shared = await loadJourneySignals({
      campaignId: 'CAMP-1',
      preloaded: { journal: Promise.resolve(targeted(UNION)), pending: Promise.resolve(PENDING as never) },
    });
    expect(shared).toEqual(own);
    expect(shared.markers.get('u1')?.status).toBe('invited');
  });

  it('étape (stage signals)', async () => {
    const own = await loadStageSignals({ campaignId: 'CAMP-1' });
    const shared = await loadStageSignals(
      { campaignId: 'CAMP-1' },
      { journal: Promise.resolve(targeted(UNION)), pending: Promise.resolve(PENDING as never) },
    );
    expect(shared).toEqual(own);
    expect(shared.validationMarks.get('u1')).toBe('validated');
    expect(shared.interviewMarks.has('u1')).toBe(false);
  });

  it('frise (timeline facts)', async () => {
    const detail = {
      uid: 'u1',
      campaignId: 'CAMP-1',
      receivedAt: '2026-09-01T00:00:00.000Z',
      createdAt: '2026-09-01T00:00:00.000Z',
      computedAt: '2026-09-01T00:00:00.000Z',
      application: { scoringResult: { criteriaVersion: 'v1' }, narration: { justification: 'j' } },
      dismissalReason: null,
    } as unknown as CandidateAnalysisDetail;
    const origin = { contactedAt: '2026-08-01T00:00:00.000Z', appliedAt: null };
    const own = await extractCandidateTimelineFacts(detail, origin);
    const shared = await extractCandidateTimelineFacts(detail, Promise.resolve(origin), {
      journal: Promise.resolve(targeted(UNION)),
    });
    expect(shared).toEqual(own);
    expect(shared.vivierContactedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(shared.corrections).toHaveLength(1);
  });
});

describe('replis propres à chaque dérivation', () => {
  it('journal partagé en échec : parcours vide, étape et frise sans marqueurs', async () => {
    const failed = Promise.reject(new Error('journal KO'));
    failed.catch(() => undefined);
    const journey = await loadJourneySignals({
      preloaded: { journal: failed, pending: Promise.resolve(PENDING as never) },
    });
    expect(journey.markers.size).toBe(0);
    // Le parcours échoue EN BLOC (file comprise), comme avec sa propre lecture.
    expect(journey.pendingUids.size).toBe(0);

    const stage = await loadStageSignals({}, { journal: failed, pending: Promise.resolve(PENDING as never) });
    expect(stage.pendingUids.has('u2')).toBe(true);
    expect(stage.validationMarks.size).toBe(0);
  });

  it('une origine vivier en échec fait échouer la frise', async () => {
    const detail = { uid: 'u1', campaignId: null, application: {} } as unknown as CandidateAnalysisDetail;
    await expect(
      extractCandidateTimelineFacts(detail, Promise.reject(new Error('vivier KO'))),
    ).rejects.toThrow('vivier KO');
  });
});
