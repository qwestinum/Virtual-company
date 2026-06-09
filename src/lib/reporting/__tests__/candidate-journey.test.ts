import { describe, expect, it } from 'vitest';

import {
  deriveCandidateJourney,
  deriveJourneyFor,
  type CandidateJourneyInput,
} from '@/lib/reporting/candidate-journey';

function input(p: Partial<CandidateJourneyInput>): CandidateJourneyInput {
  return {
    screeningStatus: 'accepted',
    interviewMarked: null,
    validationMarked: null,
    recommendation: 'go',
    ...p,
  };
}

describe('deriveCandidateJourney — étapes', () => {
  it('écarté au screening, aucun marqueur', () => {
    const j = deriveCandidateJourney(
      input({ screeningStatus: 'rejected', recommendation: null }),
    );
    expect(j.stage).toBe('ecarte_screening');
    expect(j.humanIntervention).toBe(false);
  });

  it('retenu au screening, aucun marqueur', () => {
    expect(deriveCandidateJourney(input({})).stage).toBe('retenu_screening');
  });

  it('entretien réalisé', () => {
    expect(
      deriveCandidateJourney(input({ interviewMarked: 'realized' })).stage,
    ).toBe('entretien_realise');
  });

  it('entretien non réalisé → refusé après entretien', () => {
    expect(
      deriveCandidateJourney(input({ interviewMarked: 'missed' })).stage,
    ).toBe('refuse_apres_entretien');
  });

  it('validation définitive → accepté (précédence sur entretien)', () => {
    expect(
      deriveCandidateJourney(
        input({ interviewMarked: 'realized', validationMarked: 'validated' }),
      ).stage,
    ).toBe('accepte');
  });

  it('validation refusée → refusé après entretien', () => {
    expect(
      deriveCandidateJourney(input({ validationMarked: 'rejected' })).stage,
    ).toBe('refuse_apres_entretien');
  });
});

describe('deriveCandidateJourney — intervention humaine', () => {
  it('aucune quand la décision suit le verdict IA', () => {
    expect(deriveCandidateJourney(input({})).humanIntervention).toBe(false);
    expect(
      deriveCandidateJourney(
        input({ validationMarked: 'validated' }),
      ).humanIntervention,
    ).toBe(false);
  });

  it('humain valide un candidat écarté au screening', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        validationMarked: 'validated',
        recommendation: 'go',
      }),
    );
    expect(j.stage).toBe('accepte');
    expect(j.humanIntervention).toBe(true);
  });

  it('humain refuse un candidat recommandé', () => {
    const j = deriveCandidateJourney(
      input({ validationMarked: 'rejected', recommendation: 'go' }),
    );
    expect(j.humanIntervention).toBe(true);
  });

  it('switch HITL : retenu au screening invité alors qu’écarté', () => {
    const j = deriveCandidateJourney(
      input({ screeningStatus: 'rejected', recommendation: 'go' }),
    );
    expect(j.stage).toBe('retenu_screening');
    expect(j.humanIntervention).toBe(true);
  });
});

describe('deriveJourneyFor — fallback sans marqueurs', () => {
  it('retenu si screening accepté, écarté sinon', () => {
    expect(deriveJourneyFor('accepted').stage).toBe('retenu_screening');
    expect(deriveJourneyFor('rejected').stage).toBe('ecarte_screening');
    expect(deriveJourneyFor('accepted').humanIntervention).toBe(false);
    expect(deriveJourneyFor('rejected').humanIntervention).toBe(false);
  });

  it('applique les marqueurs fournis', () => {
    const j = deriveJourneyFor('accepted', {
      interviewMarked: 'realized',
      validationMarked: 'validated',
      recommendation: 'go',
    });
    expect(j.stage).toBe('accepte');
  });
});
