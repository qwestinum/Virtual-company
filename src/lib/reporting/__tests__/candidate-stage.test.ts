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
    hiredMarked: false,
    isDismissed: false,
    ...over,
  };
}

describe('deriveCandidateStage — échelle des 10 étapes', () => {
  const cases: Array<{ name: string; input: CandidateStageInput; expected: CandidateStage }> = [
    {
      name: 'sans suite : domine TOUT état ouvert (gris en attente)',
      input: base({
        status: 'rejected',
        decisionZone: 'gray',
        isPendingValidation: true,
        isDismissed: true,
      }),
      expected: 'sans_suite',
    },
    {
      name: 'sans suite : domine un RDV pris',
      input: base({
        status: 'accepted',
        hasScheduledInterview: true,
        isDismissed: true,
      }),
      expected: 'sans_suite',
    },
    {
      name: 'sans suite : domine même un marqueur GO (cohérence terminal)',
      input: base({ validationMarked: 'validated', isDismissed: true }),
      expected: 'sans_suite',
    },
    {
      name: 'ancien refus automatique (auto_reject) → Écarté',
      input: base({ status: 'rejected', decisionZone: 'auto_reject', decidedBy: 'auto' }),
      expected: 'ecarte',
    },
    {
      name: 'ancien refus (legacy : rejeté, zone null) → Écarté',
      input: base({ status: 'rejected', decisionZone: null, decidedBy: null }),
      expected: 'ecarte',
    },
    {
      name: 'proposition de refus en file → Propositions de refus',
      input: base({
        status: 'rejected',
        decisionZone: 'proposed_reject',
        decidedBy: null,
        isPendingValidation: true,
      }),
      expected: 'proposition_refus',
    },
    {
      name: 'proposition de refus SANS ligne de file → toujours à traiter, jamais un refus',
      input: base({ status: 'rejected', decisionZone: 'proposed_reject', decidedBy: null }),
      expected: 'proposition_refus',
    },
    {
      name: 'gris SANS ligne de file → à valider',
      input: base({ status: 'rejected', decisionZone: 'gray', decidedBy: null }),
      expected: 'a_valider',
    },
    {
      name: 'proposition de refus VALIDÉE par un humain → Écarté',
      input: base({ status: 'rejected', decisionZone: 'proposed_reject', decidedBy: 'user' }),
      expected: 'ecarte',
    },
    {
      name: 'recruté : désignation sur un retenu',
      input: base({ interviewMarked: 'realized', validationMarked: 'validated', hiredMarked: true }),
      expected: 'recrute',
    },
    {
      name: 'désignation sans verdict positif courant → aucune embauche déduite',
      input: base({ interviewMarked: 'realized', validationMarked: 'rejected', hiredMarked: true }),
      expected: 'non_retenu',
    },
    {
      name: 'sans suite domine même une désignation',
      input: base({ validationMarked: 'validated', hiredMarked: true, isDismissed: true }),
      expected: 'sans_suite',
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
      name: 'ancien refus avec email réservé → Écarté, pas RDV pris',
      input: base({
        status: 'rejected',
        decisionZone: 'auto_reject',
        hasScheduledInterview: true,
      }),
      expected: 'ecarte',
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
      name: 'écarté (gris REFUSÉ par un humain sur CV : zone gray, plus en attente)',
      input: base({
        status: 'rejected',
        decisionZone: 'gray',
        decidedBy: 'user',
        isPendingValidation: false,
      }),
      expected: 'ecarte',
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
    const counts = tallyStages(['invite', 'invite', 'ecarte', 'retenu']);
    expect(counts.invite).toBe(2);
    expect(counts.ecarte).toBe(1);
    expect(counts.retenu).toBe(1);
    expect(counts.a_valider).toBe(0);
  });

  it('emptyStageCounts a bien 10 clés à zéro', () => {
    const empty = emptyStageCounts();
    expect(Object.values(empty)).toHaveLength(10);
    expect(Object.values(empty).every((n) => n === 0)).toBe(true);
  });
});

describe('CANDIDATE_STAGE_RIBBON_ORDER — garde-fou du piège non compilable', () => {
  it('contient TOUTES les étapes (une absente = carte invisible sans erreur TS)', async () => {
    const { CANDIDATE_STAGES, CANDIDATE_STAGE_RIBBON_ORDER } = await import(
      '@/lib/reporting/candidate-stage'
    );
    expect([...CANDIDATE_STAGE_RIBBON_ORDER].sort()).toEqual([...CANDIDATE_STAGES].sort());
  });
});

describe('lexique des étapes (28/09/2026)', () => {
  it('le ruban suit l’ordre du donneur d’ordre', async () => {
    const { CANDIDATE_STAGE_RIBBON_ORDER, CANDIDATE_STAGE_LABELS } = await import(
      '@/lib/reporting/candidate-stage'
    );
    expect(CANDIDATE_STAGE_RIBBON_ORDER.map((s) => CANDIDATE_STAGE_LABELS[s])).toEqual([
      'À valider',
      'Propositions de refus',
      'Invité',
      'RDV pris',
      'Entretien fait',
      'Retenu',
      'Recruté',
      'Écarté',
      'Non retenu',
      'Sans suite',
    ]);
  });

  it('un libellé = un ou deux mots, jamais un complément ; la définition va au survol', async () => {
    const { CANDIDATE_STAGES, CANDIDATE_STAGE_LABELS, CANDIDATE_STAGE_DEFINITIONS, stageHint } =
      await import('@/lib/reporting/candidate-stage');
    for (const s of CANDIDATE_STAGES) {
      const label = CANDIDATE_STAGE_LABELS[s];
      // « Propositions de refus » est le seul libellé à trois mots, et il est
      // celui du donneur d'ordre (sous-onglet historique de la file).
      if (s !== 'proposition_refus') expect(label.split(/\s+/).length).toBeLessThanOrEqual(2);
      expect(CANDIDATE_STAGE_DEFINITIONS[s].length).toBeGreaterThan(5);
      expect(stageHint(s).startsWith(`${label} — `)).toBe(true);
    }
    expect(CANDIDATE_STAGE_DEFINITIONS.ecarte).toContain('antérieurs au 18/08');
  });
});
