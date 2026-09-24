/**
 * Onglet « Historique » — PUR.
 *
 * Qui a rencontré qui, quand, avec quel verdict : entretiens PASSÉS
 * seulement, « Absent » distinct de « Non retenu », et jamais un entretien
 * que personne n'a constaté.
 */
import { describe, expect, it } from 'vitest';

import { buildHistoryRows, historyVerdict } from '@/lib/interviews/history-rows';
import type { BriefFacts } from '@/lib/interviews/pipeline-rows';

const NOW = Date.parse('2026-09-24T12:00:00.000Z');

function brief(over: Partial<BriefFacts> & { briefId: string }): BriefFacts {
  return {
    uid: over.briefId.replace('b', 'u'),
    campaignId: 'CAMP-1',
    candidateName: 'Alice Martin',
    candidateEmail: 'alice@mail.com',
    jobTitle: 'Comptable',
    updatedAt: '2026-09-20T12:00:00.000Z',
    createdAt: '2026-09-01T12:00:00.000Z',
    interviewStartAt: '2026-09-22T09:00:00.000Z',
    interviewEndAt: '2026-09-22T10:00:00.000Z',
    interviewLocation: null,
    bookingUid: `bk_${over.briefId}`,
    ...over,
  };
}

function build(
  briefs: BriefFacts[],
  stages: Record<string, string>,
  marks: Record<string, 'realized' | 'missed'> = {},
) {
  return buildHistoryRows(briefs, {
    nowMs: NOW,
    stageOf: (uid) => stages[uid] ?? null,
    interviewMarkOf: (uid) => marks[uid] ?? null,
    analysisIdOf: (uid) => `can_${uid}`,
  });
}

describe('verdict affiché', () => {
  it('lit l’étape dérivée, sans état parallèle', () => {
    expect(historyVerdict('rdv_pris', null)).toBe('a_pointer');
    expect(historyVerdict('entretien_fait', 'realized')).toBe('verdict_attendu');
    expect(historyVerdict('retenu', 'realized')).toBe('retenu');
    expect(historyVerdict('non_retenu', 'realized')).toBe('non_retenu');
  });

  it('une absence n’est PAS un « Non retenu » : personne n’a rien évalué', () => {
    expect(historyVerdict('non_retenu', 'missed')).toBe('absent');
    expect(historyVerdict('sans_suite', 'missed')).toBe('absent');
  });

  it('classée sans suite : seulement si la rencontre a été CONSTATÉE', () => {
    expect(historyVerdict('sans_suite', 'realized')).toBe('sans_suite');
    expect(historyVerdict('sans_suite', null)).toBeNull();
  });

  it('étape hors du cycle d’entretien ou inconnue : on ne devine pas', () => {
    expect(historyVerdict('a_valider', null)).toBeNull();
    expect(historyVerdict(null, null)).toBeNull();
  });
});

describe('sélection des lignes', () => {
  it('entretiens PASSÉS seulement — l’à-venir reste dans « Programmés »', () => {
    const rows = build(
      [
        brief({ briefId: 'b1' }),
        brief({
          briefId: 'b2',
          interviewStartAt: '2026-09-25T09:00:00.000Z',
          interviewEndAt: '2026-09-25T10:00:00.000Z',
        }),
        // Commencé mais pas terminé : pas encore « passé ».
        brief({
          briefId: 'b3',
          interviewStartAt: '2026-09-24T11:30:00.000Z',
          interviewEndAt: '2026-09-24T12:30:00.000Z',
        }),
      ],
      { u1: 'retenu', u2: 'rdv_pris', u3: 'rdv_pris' },
    );
    expect(rows.map((r) => r.briefId)).toEqual(['b1']);
  });

  it('sans créneau réservé, pas d’entretien', () => {
    const rows = build([brief({ briefId: 'b1', bookingUid: null })], { u1: 'retenu' });
    expect(rows).toEqual([]);
  });

  it('une candidature = une ligne, le briefing le plus récent gagne', () => {
    const rows = build(
      [
        brief({ briefId: 'b1', uid: 'u1', updatedAt: '2026-09-10T00:00:00.000Z' }),
        brief({ briefId: 'b9', uid: 'u1', updatedAt: '2026-09-21T00:00:00.000Z' }),
      ],
      { u1: 'non_retenu' },
    );
    expect(rows.map((r) => r.briefId)).toEqual(['b9']);
  });

  it('le plus récent d’abord, verdict et identité d’analyse portés', () => {
    const rows = build(
      [
        brief({ briefId: 'b1', interviewStartAt: '2026-09-01T09:00:00.000Z', interviewEndAt: '2026-09-01T10:00:00.000Z' }),
        brief({ briefId: 'b2', interviewStartAt: '2026-09-20T09:00:00.000Z', interviewEndAt: '2026-09-20T10:00:00.000Z' }),
      ],
      { u1: 'non_retenu', u2: 'entretien_fait' },
      { u1: 'missed', u2: 'realized' },
    );
    expect(rows.map((r) => [r.briefId, r.verdict, r.analysisId])).toEqual([
      ['b2', 'verdict_attendu', 'can_u2'],
      ['b1', 'absent', 'can_u1'],
    ]);
  });
});
