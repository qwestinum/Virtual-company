import { describe, expect, it } from 'vitest';

import {
  type CandidateStage,
  type CandidateStageInput,
  deriveCandidateStage,
  emptyStageCounts,
  tallyStages,
} from '@/lib/reporting/candidate-stage';

/** Base neutre : analysé, aucune étape postérieure. Surchargée par cas. */
function base(over: Partial<CandidateStageInput> = {}): CandidateStageInput {
  return {
    status: 'accepted',
    decisionZone: 'auto_accept',
    decidedBy: 'auto',
    isPendingValidation: false,
    hasScheduledInterview: false,
    interviewMarked: null,
    validationMarked: null,
    ...over,
  };
}

describe('deriveCandidateStage — échelle 7 priorités', () => {
  const cases: Array<{ name: string; input: CandidateStageInput; expected: CandidateStage }> = [
    {
      name: 'refus auto (system, auto_reject)',
      input: base({ status: 'rejected', decisionZone: 'auto_reject', decidedBy: 'auto' }),
      expected: 'refus_auto',
    },
    {
      name: 'refus auto (legacy : rejeté, zone null)',
      input: base({ status: 'rejected', decisionZone: null, decidedBy: null }),
      expected: 'refus_auto',
    },
    {
      name: 'à valider (gris en attente)',
      input: base({
        status: 'rejected', // statut provisoire d'un gris
        decisionZone: 'gray',
        decidedBy: null,
        isPendingValidation: true,
      }),
      expected: 'a_valider',
    },
    {
      name: 'invité (acceptation auto)',
      input: base({ status: 'accepted', decisionZone: 'auto_accept' }),
      expected: 'invite',
    },
    {
      name: 'invité (gris accepté par un humain)',
      input: base({ status: 'accepted', decisionZone: 'gray', decidedBy: 'user' }),
      expected: 'invite',
    },
    {
      name: 'RDV pris (réservation Cal.com) — candidat ACCEPTÉ',
      input: base({ status: 'accepted', hasScheduledInterview: true }),
      expected: 'rdv_pris',
    },
    {
      name: 'gris avec email déjà réservé → À VALIDER, pas RDV pris (faux positif email)',
      input: base({
        status: 'rejected',
        decisionZone: 'gray',
        isPendingValidation: true,
        hasScheduledInterview: true,
      }),
      expected: 'a_valider',
    },
    {
      name: 'refusé auto avec email réservé → Refus auto, pas RDV pris',
      input: base({
        status: 'rejected',
        decisionZone: 'auto_reject',
        hasScheduledInterview: true,
      }),
      expected: 'refus_auto',
    },
    {
      name: 'entretien fait',
      input: base({ status: 'accepted', hasScheduledInterview: true, interviewMarked: 'realized' }),
      expected: 'entretien_fait',
    },
    {
      name: 'entretien manqué → non retenu',
      input: base({ status: 'accepted', interviewMarked: 'missed' }),
      expected: 'non_retenu',
    },
    {
      name: 'retenu (GO définitif)',
      input: base({ status: 'accepted', interviewMarked: 'realized', validationMarked: 'validated' }),
      expected: 'retenu',
    },
    {
      name: 'non retenu (refus définitif après entretien)',
      input: base({ status: 'accepted', interviewMarked: 'realized', validationMarked: 'rejected' }),
      expected: 'non_retenu',
    },
    {
      name: 'non retenu (gris REFUSÉ par un humain : zone gray, plus en attente)',
      input: base({
        status: 'rejected',
        decisionZone: 'gray',
        decidedBy: 'user',
        isPendingValidation: false,
      }),
      expected: 'non_retenu',
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(deriveCandidateStage(c.input)).toBe(c.expected);
    });
  }

  it('le GO définitif prime sur toutes les étapes intermédiaires', () => {
    expect(
      deriveCandidateStage(
        base({ hasScheduledInterview: true, interviewMarked: 'realized', validationMarked: 'validated' }),
      ),
    ).toBe('retenu');
  });

  it("l'acceptation (Invité) prime sur un éventuel flag pending résiduel", () => {
    // Un accepté ne doit jamais retomber en « à valider ».
    expect(
      deriveCandidateStage(base({ status: 'accepted', isPendingValidation: true })),
    ).toBe('invite');
  });

  it('RDV pris prime sur Invité', () => {
    expect(deriveCandidateStage(base({ status: 'accepted', hasScheduledInterview: true }))).toBe(
      'rdv_pris',
    );
  });
});

describe('tallyStages', () => {
  it('part de zéro et compte chaque étape', () => {
    const counts = tallyStages(['invite', 'invite', 'refus_auto', 'retenu']);
    expect(counts.invite).toBe(2);
    expect(counts.refus_auto).toBe(1);
    expect(counts.retenu).toBe(1);
    expect(counts.a_valider).toBe(0);
  });

  it('emptyStageCounts a bien 7 clés à zéro', () => {
    const empty = emptyStageCounts();
    expect(Object.values(empty)).toHaveLength(7);
    expect(Object.values(empty).every((n) => n === 0)).toBe(true);
  });
});
