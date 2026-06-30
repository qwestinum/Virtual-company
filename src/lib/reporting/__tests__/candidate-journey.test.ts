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
    // HITL ON par défaut (= DEFAULT_HITL_CONFIG) : verdict système provisoire.
    rejectionGated: true,
    acceptanceGated: true,
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

  it('refus envoyé après screening → validation écarté, final écarté définitivement', () => {
    const j = deriveCandidateJourney(input({ dashboardStatus: 'rejected' }));
    expect(j.validation).toBe('ecarte');
    expect(j.interview).toBe('na');
    // Un refus envoyé après screening clôt le parcours (plus de « en attente »).
    expect(j.final).toBe('ecarte');
    expect(journeyCurrentState(j).label).toBe('Écarté définitivement');
  });

  it('entretien réalisé sans décision finale → final en attente', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'interview_done', interviewMarked: 'realized' }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(j.interview).toBe('realise');
    expect(j.final).toBe('en_attente');
  });

  it('entretien non réalisé → interview non_realise, final écarté définitivement', () => {
    const j = deriveCandidateJourney(
      input({ dashboardStatus: 'rejected', interviewMarked: 'missed' }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(j.interview).toBe('non_realise');
    // Un entretien non réalisé clôt le parcours : jamais « en attente ».
    expect(j.final).toBe('ecarte');
    expect(journeyCurrentState(j).label).toBe('Écarté définitivement');
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

describe('repêchage humain d’un refus screening (régression)', () => {
  it('rejeté + invité par un humain → retenu pour entretien (pas écarté au screening)', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        dashboardStatus: 'invited',
        recommendation: 'go',
      }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(journeyCurrentState(j).label).toBe('Retenu pour entretien');
    expect(j.humanIntervention).toBe(true);
  });

  it('rejeté repêché + entretien réalisé → « Entretien réalisé »', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        dashboardStatus: 'interview_done',
        interviewMarked: 'realized',
        recommendation: 'go',
      }),
    );
    expect(j.interview).toBe('realise');
    expect(journeyCurrentState(j).label).toBe('Entretien réalisé');
  });

  it('rejeté repêché en HITL refus OFF : ne bascule PAS en écarté définitif', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        dashboardStatus: 'invited',
        recommendation: 'go',
        rejectionGated: false,
      }),
    );
    expect(j.validation).toBe('retenu_entretien');
    expect(j.final).toBe('en_attente');
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
    expect(enAttente.label).toBe('Retenu au screening');

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

describe('deriveJourneyFor — HITL 3 zones', () => {
  it('zone auto_accept → retenu pour entretien (auto, non gated)', () => {
    const j = deriveJourneyFor('accepted', 'auto_accept', 'auto');
    expect(j.validation).toBe('retenu_entretien');
  });
  it('zone auto_reject → écarté définitivement', () => {
    const j = deriveJourneyFor('rejected', 'auto_reject', 'auto');
    expect(j.screening).toBe('ecarte');
    expect(j.final).toBe('ecarte');
  });
  it('zone grise non tranchée → RETENU au screening (passé en validation), en attente', () => {
    const j = deriveJourneyFor('rejected', 'gray', 'auto');
    // Un gris a PASSÉ le screening (bande de validation) → PAS « écarté » en
    // présélection. Le statut binaire 'rejected' est provisoire.
    expect(j.screening).toBe('retenu');
    expect(j.validation).toBe('en_attente');
    expect(j.final).toBe('na'); // pas définitif tant qu'un humain n'a pas tranché
  });
  it('zone grise REFUSÉE (refus envoyé) → rejet à la VALIDATION, pas à la présélection', () => {
    const j = deriveJourneyFor('rejected', 'gray', 'user', {
      dashboardStatus: 'rejected',
      interviewMarked: null,
      validationMarked: null,
      recommendation: 'no-go',
    });
    expect(j.screening).toBe('retenu'); // a bien passé le screening
    expect(j.validation).toBe('ecarte'); // écarté à la VALIDATION (humain)
    expect(j.final).toBe('ecarte');
  });
  it('humanIntervention = decidedBy user (gris tranché par un humain)', () => {
    expect(deriveJourneyFor('accepted', 'gray', 'user').humanIntervention).toBe(true);
    expect(deriveJourneyFor('accepted', 'auto_accept', 'auto').humanIntervention).toBe(false);
  });
});

describe('toggles HITL figés', () => {
  it('rejeté + HITL refus OFF → écarté définitivement (pas d’attente)', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        recommendation: null,
        rejectionGated: false,
      }),
    );
    expect(j.screening).toBe('ecarte');
    expect(j.final).toBe('ecarte');
    expect(journeyCurrentState(j).label).toBe('Écarté définitivement');
  });

  it('rejeté + HITL refus ON, non envoyé → écarté au screening (provisoire)', () => {
    const j = deriveCandidateJourney(
      input({ screeningStatus: 'rejected', recommendation: null }),
    );
    expect(j.final).toBe('na');
    const cur = journeyCurrentState(j);
    expect(cur.label).toBe('Écarté au screening');
    expect(cur.tone).toBe('screening_out');
  });

  it('rejeté + HITL refus ON + refus envoyé → écarté définitivement', () => {
    const j = deriveCandidateJourney(
      input({
        screeningStatus: 'rejected',
        recommendation: null,
        dashboardStatus: 'rejected',
      }),
    );
    expect(j.final).toBe('ecarte');
    expect(journeyCurrentState(j).label).toBe('Écarté définitivement');
  });

  it('retenu + HITL acceptation OFF → retenu pour entretien direct (auto)', () => {
    const j = deriveCandidateJourney(input({ acceptanceGated: false }));
    expect(j.validation).toBe('retenu_entretien');
    expect(journeyCurrentState(j).label).toBe('Retenu pour entretien');
  });

  it('retenu + HITL acceptation ON, rien d’acté → retenu au screening', () => {
    const j = deriveCandidateJourney(input({}));
    expect(j.validation).toBe('en_attente');
    expect(journeyCurrentState(j).label).toBe('Retenu au screening');
  });
});
