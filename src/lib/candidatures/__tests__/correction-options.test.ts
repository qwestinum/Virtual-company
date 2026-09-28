/**
 * Quelle décision est corrigible, et par quoi.
 *
 * Deux invariants tenus ici :
 *   - un dossier qui n'a RIEN de décidé (`a_valider`) n'offre aucune option —
 *     « corriger » n'y voudrait rien dire ;
 *   - un marquage d'entretien posé par erreur se répare par une GOMME, jamais
 *     par une bascule : basculer vers « absent » poserait une décision.
 */
import { describe, expect, it } from 'vitest';

import {
  CORRECTION_TARGET_STATE_LABELS,
  correctionNoticesFor,
  correctionOptionsFor,
  currentDecisionLabel,
  resolveCurrentDecision,
  type CurrentDecisionInput,
} from '@/lib/candidatures/correction-options';
import { CORRECTION_TARGETS } from '@/types/decision-correction';

function input(over: Partial<CurrentDecisionInput> = {}): CurrentDecisionInput {
  return {
    stage: 'entretien_fait',
    interviewEffect: 'realized',
    validationEffect: null,
    dismissalReason: null,
    decidedBy: null,
    ...over,
  };
}

describe('resolveCurrentDecision — même priorité que deriveCandidateStage', () => {
  it('le classement sans suite domine tout', () => {
    expect(
      resolveCurrentDecision(
        input({
          stage: 'sans_suite',
          validationEffect: 'rejected',
          dismissalReason: 'poste_pourvu',
        }),
      ),
    ).toEqual({ kind: 'dismissal', reason: 'poste_pourvu' });
  });

  it('le verdict final prime sur le marquage d’entretien', () => {
    expect(
      resolveCurrentDecision(
        input({ stage: 'retenu', validationEffect: 'validated' }),
      ),
    ).toEqual({ kind: 'final_verdict', value: 'validated' });
  });

  it('un dossier en attente de validation n’a RIEN à corriger (les deux files)', () => {
    expect(
      resolveCurrentDecision(
        input({ stage: 'a_valider', interviewEffect: null }),
      ),
    ).toBeNull();
    expect(
      resolveCurrentDecision(
        input({ stage: 'proposition_refus', interviewEffect: null }),
      ),
    ).toBeNull();
  });

  it('acceptation et refus de screening viennent des colonnes', () => {
    expect(
      resolveCurrentDecision(input({ stage: 'invite', interviewEffect: null })),
    ).toEqual({ kind: 'screening_decision', value: 'accepted', auto: false });
    expect(
      resolveCurrentDecision(
        input({ stage: 'ecarte', interviewEffect: null, decidedBy: 'user' }),
      ),
    ).toEqual({ kind: 'screening_decision', value: 'rejected', auto: false });
  });

  it('le refus auto LEGACY est requalifiable et se dit comme tel', () => {
    const current = resolveCurrentDecision(
      input({ stage: 'ecarte', interviewEffect: null, decidedBy: 'auto' }),
    );
    expect(current).toEqual({
      kind: 'screening_decision',
      value: 'rejected',
      auto: true,
    });
    expect(currentDecisionLabel(current!)).toContain('antérieur au 18/08');
    expect(currentDecisionLabel(current!)).not.toMatch(/Refusé/);
  });
});

describe('options — jamais un choix sans destination', () => {
  it('un entretien marqué réalisé se GOMME, il ne bascule pas vers « absent » seul', () => {
    const options = correctionOptionsFor({ kind: 'interview', value: 'realized' });
    expect(options.map((o) => o.target)).toEqual([
      'interview_missed',
      'interview_cleared',
    ]);
  });

  it('un verdict final offre la bascule ET la gomme', () => {
    expect(
      correctionOptionsFor({ kind: 'final_verdict', value: 'rejected' }).map(
        (o) => o.target,
      ),
    ).toEqual(['verdict_validated', 'verdict_cleared']);
  });

  it('un refus de screening ne propose PAS la remise en file', () => {
    const targets = correctionOptionsFor({
      kind: 'screening_decision',
      value: 'rejected',
      auto: false,
    }).map((o) => o.target);
    expect(targets).toEqual(['screening_accepted']);
    expect(targets).not.toContain('a_valider');
  });

  it('le classement sans suite se corrige en rouvrant', () => {
    expect(
      correctionOptionsFor({ kind: 'dismissal', reason: null }).map(
        (o) => o.target,
      ),
    ).toEqual(['dismissal_reopen']);
  });
});

describe('rappels — ce que la correction NE fait pas', () => {
  it('« aucun message » est dit sur TOUTES les familles', () => {
    const kinds = [
      { kind: 'interview', value: 'realized' },
      { kind: 'final_verdict', value: 'validated' },
      { kind: 'screening_decision', value: 'rejected', auto: false },
      { kind: 'dismissal', reason: null },
    ] as const;
    for (const current of kinds) {
      expect(correctionNoticesFor(current)[0]).toContain('Aucun message');
    }
  });

  it('un refus requalifié renvoie vers « Renvoyer une invitation »', () => {
    const notices = correctionNoticesFor({
      kind: 'screening_decision',
      value: 'rejected',
      auto: false,
    });
    expect(notices.join(' ')).toContain('Renvoyer une invitation');
    expect(notices.join(' ')).toContain('attente de validation');
  });
});

describe('libellés d’état', () => {
  it('chaque cible a un libellé d’état résultant', () => {
    for (const target of CORRECTION_TARGETS) {
      expect(CORRECTION_TARGET_STATE_LABELS[target]?.length).toBeGreaterThan(0);
    }
  });
});

describe('recruté — « Annuler la désignation » (feat/feedback-candidat, lot 4)', () => {
  it('un recruté se corrige par la gomme de la désignation, jamais par un envoi', () => {
    const current = resolveCurrentDecision(
      input({ stage: 'recrute', validationEffect: 'validated' }),
    );
    expect(current).toEqual({ kind: 'hire' });
    expect(currentDecisionLabel(current!)).toBe('Recruté');
    const options = correctionOptionsFor(current!);
    expect(options.map((o) => o.target)).toEqual(['hire_cleared']);
    expect(options[0]!.detail).toContain('Aucun message');
  });
});

describe('le mot dépend du moment (lexique, 28/09/2026)', () => {
  it('AVANT l’entretien (décision de tri sur CV) : « Requalifier en écarté »', () => {
    const current = resolveCurrentDecision(input({ stage: 'invite', interviewEffect: null }));
    expect(current).toEqual({ kind: 'screening_decision', value: 'accepted', auto: false });
    expect(correctionOptionsFor(current!).map((o) => o.label)).toEqual(['Requalifier en écarté']);
  });

  it('APRÈS l’entretien : « Non retenu », jamais « écarté »', () => {
    // Entretien réalisé puis verdict « Retenu » : la correction propose « Non retenu ».
    const verdict = correctionOptionsFor({ kind: 'final_verdict', value: 'validated' });
    expect(verdict[0]!.label).toBe('Non retenu');
    // Entretien marqué réalisé, sans verdict : l'absence mène à « Non retenu ».
    const interview = correctionOptionsFor({ kind: 'interview', value: 'realized' });
    expect(interview[0]!.detail).toContain('« Non retenu »');
    for (const o of [...verdict, ...interview]) {
      expect(`${o.label} ${o.detail}`).not.toMatch(/écart/i);
    }
  });
});
