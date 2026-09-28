import { describe, expect, it } from 'vitest';

import { closureOutcomeLabel, closureOutcomes } from '@/lib/campagnes/closure-outcome';

const ANALYSES = new Map([['can_jean', { uid: 'u_jean', candidateName: 'Jean Martin' }]]);
const closed = (campaignId: string, payload: Record<string, unknown>, createdAt = '2026-09-28T10:00:00Z') => ({
  action: 'campaign_closed',
  campaignId,
  payload,
  createdAt,
});
const hired = (status: string, createdAt: string) => ({
  action: 'candidate_hired_marked',
  campaignId: 'C1',
  payload: { uid: 'u_jean', status },
  createdAt,
});

describe('issue de clôture affichée par Pilotage', () => {
  it('conclu avec un recruté désigné ⇒ « Recrutement conclu — nom »', () => {
    const v = closureOutcomes(
      [closed('C1', { outcome: 'conclu', hiredAnalysisId: 'can_jean' }), hired('hired', '2026-09-28T10:00:01Z')],
      ANALYSES,
    ).get('C1')!;
    expect(closureOutcomeLabel(v)).toBe('Recrutement conclu — Jean Martin');
  });

  it('désignation annulée ⇒ plus de nom', () => {
    const v = closureOutcomes(
      [
        closed('C1', { outcome: 'conclu', hiredAnalysisId: 'can_jean' }),
        hired('hired', '2026-09-28T10:00:01Z'),
        hired('cleared', '2026-09-29T10:00:00Z'),
      ],
      ANALYSES,
    ).get('C1')!;
    expect(closureOutcomeLabel(v)).toBe('Recrutement conclu');
  });

  it('conclu sans préciser, et non conclu', () => {
    const m = closureOutcomes(
      [closed('C1', { outcome: 'conclu', hiredAnalysisId: null }), closed('C2', { outcome: 'non_conclu' })],
      ANALYSES,
    );
    expect(closureOutcomeLabel(m.get('C1')!)).toBe('Recrutement conclu');
    expect(closureOutcomeLabel(m.get('C2')!)).toBe('Clôturée sans recrutement');
  });

  it('campagne clôturée avant le chantier ⇒ aucune issue lue (libellé historique conservé)', () => {
    expect(closureOutcomes([], ANALYSES).has('C9')).toBe(false);
  });

  it('seule la clôture la plus récente compte', () => {
    const m = closureOutcomes(
      [
        closed('C1', { outcome: 'conclu' }, '2026-09-01T10:00:00Z'),
        closed('C1', { outcome: 'non_conclu' }, '2026-09-20T10:00:00Z'),
      ],
      ANALYSES,
    );
    expect(m.get('C1')!.outcome).toBe('non_conclu');
  });
});
