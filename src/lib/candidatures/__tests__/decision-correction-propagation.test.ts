/**
 * LA correction se propage PARTOUT — c'est l'invariant central du chantier.
 *
 * L'étape n'est stockée nulle part : elle est dérivée. Un nouveau marqueur doit
 * donc changer l'étape à TOUS les endroits qui la dérivent, sans qu'aucun ne
 * garde l'ancienne :
 *   - `stage-signals` → ruban Candidatures, page Entretiens, signaux métier ;
 *   - `derive-metrics` → Bureau (KPIs, liste candidats, fil d'activité) ;
 *   - `candidate-timeline` → frise du candidat.
 *
 * Un lecteur oublié serait SILENCIEUX : rien ne planterait, l'écran afficherait
 * simplement la décision qu'on vient de retirer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildInterviewMarkerEntry,
  buildValidationMarkerEntry,
  DECISION_CORRECTED_ACTION,
} from '@/lib/candidatures/decision-markers';
import type { JournalEntry } from '@/lib/db/repos/journal';

const listJournalEntriesByActions = vi.fn();
const listPendingValidations = vi.fn(async () => []);
const listScheduledInterviewUids = vi.fn(async () => new Set<string>());

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: (...a: unknown[]) =>
    listJournalEntriesByActions(...a),
}));
vi.mock('@/lib/db/repos/pending-validations', () => ({
  listPendingValidations: () => listPendingValidations(),
}));
vi.mock('@/lib/db/repos/interview-briefs', () => ({
  listScheduledInterviewUids: () => listScheduledInterviewUids(),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  listAllCandidateAnalyses: vi.fn(async () => []),
  countCandidateAnalyses: vi.fn(async () => 0),
}));

const UID = 'uid-malaka';
const T_MARK = '2026-08-21T14:32:00.000Z';
const T_FIX = '2026-08-22T09:10:00.000Z';

let nextId = 1;
function entry(
  built: { action: string; campaignId: string | null; payload: Record<string, unknown> },
  createdAt: string,
): JournalEntry {
  return {
    id: nextId++,
    action: built.action,
    campaignId: built.campaignId,
    actor: 'user',
    payload: built.payload,
    createdAt,
  };
}

/** Le journal arrive trié created_at DESC — comme en production. */
function journalDesc(entries: JournalEntry[]): JournalEntry[] {
  return [...entries].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

const MARK_REALIZED = entry(
  buildInterviewMarkerEntry({
    uid: UID,
    candidateName: 'Malaka Diarra',
    campaignId: 'CAMP-2026-288',
    value: 'realized',
  }),
  T_MARK,
);
const CLEAR_INTERVIEW = entry(
  buildInterviewMarkerEntry({
    uid: UID,
    candidateName: 'Malaka Diarra',
    campaignId: 'CAMP-2026-288',
    value: 'cleared',
    corrected: true,
  }),
  T_FIX,
);

beforeEach(() => {
  vi.clearAllMocks();
  listPendingValidations.mockResolvedValue([]);
  listScheduledInterviewUids.mockResolvedValue(new Set<string>());
});

describe('stage-signals — ruban, Entretiens, signaux métier', () => {
  async function signalsFor(entries: JournalEntry[]) {
    listJournalEntriesByActions.mockResolvedValue(journalDesc(entries));
    const { loadStageSignals } = await import('@/lib/reporting/stage-signals');
    return loadStageSignals({ campaignId: 'CAMP-2026-288' });
  }

  it('sans correction, le marquage tient', async () => {
    const s = await signalsFor([MARK_REALIZED]);
    expect(s.interviewMarks.get(UID)).toBe('realized');
    expect(s.interviewMarkedAt.get(UID)).toBe(T_MARK);
  });

  it('après la gomme, l’uid SORT des marqueurs (et de la date associée)', async () => {
    const s = await signalsFor([MARK_REALIZED, CLEAR_INTERVIEW]);
    expect(s.interviewMarks.has(UID)).toBe(false);
    expect(s.interviewMarkedAt.has(UID)).toBe(false);
  });

  it('l’étape dérivée retombe sur les colonnes', async () => {
    const { stageFor } = await import('@/lib/reporting/stage-signals');
    const analysis = {
      uid: UID,
      status: 'accepted' as const,
      decisionZone: 'auto_accept' as const,
      decidedBy: 'auto' as const,
      dismissedAt: null,
    };
    const before = await signalsFor([MARK_REALIZED]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(stageFor(analysis as any, before)).toBe('entretien_fait');
    const after = await signalsFor([MARK_REALIZED, CLEAR_INTERVIEW]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(stageFor(analysis as any, after)).toBe('invite');
  });

  it('corriger DEUX fois de suite : le dernier gagne, sans état bâtard', async () => {
    const remark = entry(
      buildInterviewMarkerEntry({
        uid: UID,
        candidateName: 'Malaka Diarra',
        campaignId: 'CAMP-2026-288',
        value: 'missed',
        corrected: true,
      }),
      '2026-08-23T08:00:00.000Z',
    );
    const s = await signalsFor([MARK_REALIZED, CLEAR_INTERVIEW, remark]);
    expect(s.interviewMarks.get(UID)).toBe('missed');
  });
});

describe('derive-metrics — Bureau (liste candidats + fil d’activité)', () => {
  it('la liste candidats oublie le marquage gommé', async () => {
    const { journalToCandidatesList } = await import(
      '@/lib/dashboard/derive-metrics'
    );
    const analyzed: JournalEntry = {
      id: 100,
      action: 'imap_cv_analyzed',
      campaignId: 'CAMP-2026-288',
      actor: 'system',
      payload: { uid: UID, candidate: 'Malaka Diarra', score: 78 },
      createdAt: '2026-08-20T08:00:00.000Z',
    };
    const before = journalToCandidatesList(
      journalDesc([analyzed, MARK_REALIZED]),
    );
    expect(before[0]?.interviewMarked).toBe('realized');
    const after = journalToCandidatesList(
      journalDesc([analyzed, MARK_REALIZED, CLEAR_INTERVIEW]),
    );
    expect(after[0]?.interviewMarked).toBeNull();
  });

  it('le fil d’activité ne lit JAMAIS une gomme comme un refus', async () => {
    const { journalToActivityFeed } = await import(
      '@/lib/dashboard/derive-metrics'
    );
    const feed = journalToActivityFeed(
      journalDesc([CLEAR_INTERVIEW]),
      10,
    );
    const message = feed[0]?.message ?? '';
    expect(message).toContain('annulé');
    expect(message).not.toContain('non réalisé');
  });

  it('un verdict gommé ne se lit pas « Validation refusée »', async () => {
    const { journalToActivityFeed } = await import(
      '@/lib/dashboard/derive-metrics'
    );
    const cleared = entry(
      buildValidationMarkerEntry({
        uid: UID,
        candidateName: 'Malaka Diarra',
        campaignId: null,
        value: 'cleared',
        corrected: true,
      }),
      T_FIX,
    );
    const feed = journalToActivityFeed([cleared], 10);
    expect(feed[0]?.message).toContain('annulé');
    expect(feed[0]?.message).not.toContain('refusée');
  });

  it('l’événement de correction est rendu (donc chargé — registre unique)', async () => {
    const { journalToActivityFeed, ACTIVITY_FEED_ACTIONS } = await import(
      '@/lib/dashboard/derive-metrics'
    );
    expect(ACTIVITY_FEED_ACTIONS).toContain(DECISION_CORRECTED_ACTION);
    const corrected: JournalEntry = {
      id: 200,
      action: DECISION_CORRECTED_ACTION,
      campaignId: 'CAMP-2026-288',
      actor: 'user',
      payload: {
        uid: UID,
        candidate: 'Malaka Diarra',
        previousLabel: 'Non retenu',
        nextLabel: 'Entretien réalisé',
      },
      createdAt: T_FIX,
    };
    const feed = journalToActivityFeed([corrected], 10);
    expect(feed[0]?.message).toContain('Décision corrigée');
    expect(feed[0]?.message).toContain('Non retenu → Entretien réalisé');
  });
});
