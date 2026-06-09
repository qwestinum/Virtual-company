import { describe, expect, it } from 'vitest';

import {
  deriveCandidateJourney,
  deriveJourneyFor,
  journeyColumns,
  journeyCurrentState,
  journeyFilterKey,
  type CandidateJourneyInput,
} from '@/lib/reporting/candidate-journey';

function input(p: Partial<CandidateJourneyInput>): CandidateJourneyInput {
  return {
    screeningStatus: 'accepted',
    isPendingValidation: false,
    dashboardStatus: 'analyzed',
    interviewMarked: null,
    validationMarked: null,
    recommendation: 'go',
    ...p,
  };
}

describe('deriveCandidateJourney — 4 phases', () => {
  it('écarté au screening : seule la présélection est atteinte', () => {
    const j = deriveCandidateJourney(
      input({ screeningStatus: 'rejected', recommendation: null }),
    );
    expect(j).toMatchObject({
      screening: 'ecarte',
      validation: 'na',
      interview: 'na',
      final: 'na',
    });
  });

  it('retenu + en attente HITL → validation « en attente »', () => {
    const j = deriveCandidateJourney(input({ isPendingValidation: true }));
    expect(j.screening).toBe('retenu');
    expect(j.validation).toBe('en_attente');
    expect(j.interview).toBe('na');
  });

  it('retenu + invité → retenu pour entretien, entretien en attente', () => {
    const j = deriveCandidateJourney(input({ dashboardStatus: 'invited' }));
    expect(j.validation).toBe('retenu_entretien');
    expect(j.interview).toBe('en_attente');
    expect(j.final).toBe('en_attente');
  });

  it('refus envoyé après screening → validation écarté', () => {
    const j = deriveCandidateJourney(input({ dashboardStatus: 'rejected' }));
    expect(j.validation).toBe('ecarte');
    expect(j.interview).toBe('na');
    expect(j.final).toBe('na');
  });

  it('entretien réalisé sans décision finale → final en attente', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'interview_done', interviewMarked: 'realized' }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(j.interview).toBe('realise');
    expect(j.final).toBe('en_attente');
  });

  it('entretien non réalisé → interview non_realise', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'rejected', interviewMarked: 'missed' }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(j.interview).toBe('non_realise');
  });

  it('validation définitive → final retenu (et NON dès la validation HITL)', () => {
    const j = deriveCandidateJourney(
      input({
        dashboardStatus: 'interview_done',
        interviewMarked: 'realized',
        validationMarked: 'validated',
      }),
    );
    expect(j.final).toBe('retenu');
  });

  it('un candidat juste invité n’est PAS « retenu définitivement »', () => {
    const j = deriveCandidateJourney(input({ dashboardStatus: 'invited' }));
    expect(j.final).not.toBe('retenu');
    expect(j.final).toBe('en_attente');
  });

  it('décision finale refusée → final écarté', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'interview_done', validationMarked: 'rejected' }),
    );
    expect(j.final).toBe('ecarte');
  });
});

describe('intervention humaine', () => {
  it('aucune quand la décision suit le verdict IA', () => {
    expect(
      deriveCandidateJourney(input({ dashboardStatus: 'invited' }))
        .humanIntervention,
    ).toBe(false);
  });

  it('humain valide un candidat écarté au screening', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        recommendation: 'go',
        dashboardStatus: 'interview_done',
        validationMarked: 'validated',
      }),
    );
    expect(j.humanIntervention).toBe(true);
  });

  it('humain refuse un candidat recommandé', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'interview_done', validationMarked: 'rejected' }),
    );
    expect(j.humanIntervention).toBe(true);
  });
});

describe('journeyCurrentState / journeyFilterKey', () => {
  it('état courant = le plus avancé atteint', () => {
    const enAttente = journeyCurrentState(
      deriveCandidateJourney(input({ isPendingValidation: true })),
    );
    expect(enAttente.label).toBe('En attente de validation');

    const retenuDef = journeyCurrentState(
      deriveCandidateJourney(
        input({ dashboardStatus: 'interview_done', validationMarked: 'validated' }),
      ),
    );
    expect(retenuDef.label).toBe('Retenu définitivement');
  });

  it('clé de filtre regroupe les états', () => {
    expect(
      journeyFilterKey(deriveCandidateJourney(input({ isPendingValidation: true }))),
    ).toBe('en_attente_validation');
    expect(
      journeyFilterKey(
        deriveCandidateJourney(input({ screeningStatus: 'rejected', recommendation: null })),
      ),
    ).toBe('ecarte');
  });
});

describe('journeyColumns', () => {
  it('produit 4 colonnes, grisées au-delà de l’étape atteinte', () => {
    const cols = journeyColumns(
      deriveCandidateJourney(input({ isPendingValidation: true })),
    );
    expect(cols.map((c) => c.key)).toEqual([
      'screening',
      'validation',
      'interview',
      'final',
    ]);
    expect(cols[0]!.reached).toBe(true);
    expect(cols[1]!.reached).toBe(true);
    expect(cols[2]!.reached).toBe(false);
    expect(cols[3]!.reached).toBe(false);
  });
});

describe('deriveJourneyFor — fallback', () => {
  it('sans marqueurs : retenu → en attente de validation', () => {
    const j = deriveJourneyFor('accepted');
    expect(j.validation).toBe('en_attente');
  });
  it('sans marqueurs : écarté → présélection écarté', () => {
    expect(deriveJourneyFor('rejected').screening).toBe('ecarte');
  });
  it('drapeau pending propagé', () => {
    expect(
      deriveJourneyFor('accepted', undefined, true).validation,
    ).toBe('en_attente');
  });
});
