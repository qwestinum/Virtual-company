/**
 * Le PARCOURS d'une campagne (compteurs de la carte) et les entretiens à
 * pointer — les deux bugs du 28/09/2026 sur CAMP-2026-221 :
 *   - « Retenu » à 0 alors que deux candidats avaient été retenus (la carte
 *     montrait l'étape COURANTE : l'un recruté, l'autre non sélectionné) ;
 *   - « 2 entretiens passés sans confirmation » après entretiens pointés et
 *     tranchés (la carte comptait les briefings, restés « programmés »).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildHiredMarkerEntry,
  buildInterviewMarkerEntry,
  buildValidationMarkerEntry,
} from '@/lib/candidatures/decision-markers';
import { NOT_SELECTED_CAUSE } from '@/lib/campagnes/closure-constants';
import { computeTrajectoryCounts, conversionRate, passedThrough } from '@/lib/reporting/campaign-trajectory';
import type { JournalEntry } from '@/lib/db/repos/journal';
import type { DecisionZone } from '@/types/hitl';

const listJournalEntriesByActions = vi.fn();
const listAllCandidateAnalyses = vi.fn();

vi.mock('@/lib/db/repos/journal', () => ({
  listJournalEntriesByActions: (...a: unknown[]) => listJournalEntriesByActions(...a),
}));
vi.mock('@/lib/db/repos/pending-validations', () => ({ listPendingValidations: async () => [] }));
vi.mock('@/lib/db/repos/interview-briefs', () => ({ listScheduledInterviewUids: async () => new Set<string>() }));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  listAllCandidateAnalyses: (...a: unknown[]) => listAllCandidateAnalyses(...a),
  countCandidateAnalyses: async () => 0,
}));

const C = 'CAMP-2026-221';
let n = 1;
const at = (built: { action: string; campaignId: string | null; payload: Record<string, unknown> }, createdAt: string): JournalEntry => ({
  id: n++,
  action: built.action,
  campaignId: built.campaignId,
  actor: 'user',
  payload: built.payload,
  createdAt,
});
const analysis = (uid: string, over: { status?: string; decisionZone?: DecisionZone } = {}) => ({
  id: `can_${uid}`,
  uid,
  campaignId: C,
  status: 'accepted',
  decisionZone: 'auto_accept' as DecisionZone,
  decidedBy: 'auto',
  dismissedAt: null,
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

/** CAMP-2026-221 tel qu'en base : deux retenus, l'un recruté, l'autre non sélectionné. */
function journal221(): JournalEntry[] {
  const m = (uid: string) => ({ uid, candidateName: uid, campaignId: C });
  return [
    at(buildInterviewMarkerEntry({ ...m('imad'), value: 'realized' }), '2026-09-19T02:32:40Z'),
    at(buildValidationMarkerEntry({ ...m('imad'), value: 'validated' }), '2026-09-19T02:35:25Z'),
    at(buildInterviewMarkerEntry({ ...m('damois'), value: 'realized' }), '2026-09-28T14:35:20Z'),
    at(buildValidationMarkerEntry({ ...m('damois'), value: 'validated' }), '2026-09-28T14:35:32Z'),
    at(buildHiredMarkerEntry({ ...m('imad'), value: 'hired' }), '2026-09-28T14:38:28Z'),
    at(buildValidationMarkerEntry({ ...m('damois'), value: 'rejected', cause: NOT_SELECTED_CAUSE }), '2026-09-28T14:38:29Z'),
  ];
}

beforeEach(() => {
  listJournalEntriesByActions.mockReset();
  listAllCandidateAnalyses.mockReset();
});

async function signalsFor(entries: JournalEntry[]) {
  listJournalEntriesByActions.mockResolvedValue(entries);
  const { loadStageSignals } = await import('@/lib/reporting/stage-signals');
  return loadStageSignals({ campaignId: C });
}

describe('parcours : chaque candidature qui passe par une étape la compte', () => {
  it('CAMP-2026-221 : deux retenus, un recruté — conversion 50 %', async () => {
    const s = await signalsFor(journal221());
    expect([...s.notSelectedUids]).toEqual(['damois']);
    const counts = computeTrajectoryCounts([analysis('imad', { decisionZone: 'gray' }), analysis('damois')], s);
    expect(counts).toEqual({ recues: 2, a_valider: 1, invite: 2, entretien_fait: 2, retenu: 2, recrute: 1 });
    expect(conversionRate(counts)).toBe(50);
  });

  it('une décision CORRIGÉE compte pour son état actuel — seul le non-retenu de clôture garde le passage', async () => {
    const m = { uid: 'x', candidateName: 'x', campaignId: C };
    const s = await signalsFor([
      at(buildInterviewMarkerEntry({ ...m, value: 'realized' }), '2026-09-01T10:00:00Z'),
      at(buildValidationMarkerEntry({ ...m, value: 'validated' }), '2026-09-01T11:00:00Z'),
      at(buildValidationMarkerEntry({ ...m, value: 'rejected', corrected: true }), '2026-09-02T09:00:00Z'),
    ]);
    expect(s.notSelectedUids.size).toBe(0);
    expect(passedThrough('retenu', analysis('x'), s)).toBe(false);
    expect(passedThrough('entretien_fait', analysis('x'), s)).toBe(true);
  });

  it('monotone : un recruté a été retenu, reçu en entretien et invité, même sans marqueur d’entretien', async () => {
    const m = { uid: 'h', candidateName: 'h', campaignId: C };
    const s = await signalsFor([
      at(buildValidationMarkerEntry({ ...m, value: 'validated' }), '2026-09-01T09:00:00Z'),
      at(buildHiredMarkerEntry({ ...m, value: 'hired' }), '2026-09-01T10:00:00Z'),
    ]);
    const a = analysis('h', { status: 'rejected' });
    for (const step of ['invite', 'entretien_fait', 'retenu', 'recrute'] as const) expect(passedThrough(step, a, s)).toBe(true);
  });

  it('une désignation dont le verdict a été corrigé en « non retenu » ne recrute personne (même règle que l’étape)', async () => {
    const m = { uid: 'c', candidateName: 'c', campaignId: C };
    const s = await signalsFor([
      at(buildValidationMarkerEntry({ ...m, value: 'validated' }), '2026-09-01T09:00:00Z'),
      at(buildHiredMarkerEntry({ ...m, value: 'hired' }), '2026-09-01T10:00:00Z'),
      at(buildValidationMarkerEntry({ ...m, value: 'rejected', corrected: true }), '2026-09-02T10:00:00Z'),
    ]);
    expect(passedThrough('recrute', analysis('c'), s)).toBe(false);
  });

  it('aucune candidature : pas de taux', () => {
    expect(conversionRate({ recues: 0, recrute: 0 })).toBeNull();
  });
});

describe('carte : entretiens passés À POINTER', () => {
  it('un entretien pointé et tranché ne se réclame plus — le briefing « programmé » ne prouve rien', async () => {
    listJournalEntriesByActions.mockResolvedValue(journal221());
    listAllCandidateAnalyses.mockResolvedValue([analysis('imad'), analysis('damois'), analysis('ouvert')]);
    const { computeStageCountsByCampaign } = await import('@/lib/reporting/stage-signals');
    const out = await computeStageCountsByCampaign([C], Date.now(), [
      { uid: 'imad', campaignId: C },
      { uid: 'damois', campaignId: C },
      { uid: 'damois', campaignId: C }, // deux briefings pour un dossier : compté une fois
      { uid: 'ouvert', campaignId: C }, // encore « Invité » : à pointer
    ]);
    expect(out.get(C)?.unpointed).toBe(1);
    expect(out.get(C)?.trajectory).toMatchObject({ recues: 3, retenu: 2, recrute: 1 });
  });
});
