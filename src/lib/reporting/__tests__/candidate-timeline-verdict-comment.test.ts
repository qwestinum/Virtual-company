/**
 * La frise porte le commentaire qui motive le verdict final — ou dit qu'il
 * n'y en a pas. Spec : docs/specs/compte-rendu-entretien.md §7.1.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCandidateTimeline,
  type CandidateTimelineFacts,
} from '@/lib/reporting/candidate-timeline';

const BASE: CandidateTimelineFacts = {
  receivedAt: '2026-09-01T08:00:00.000Z',
  source: 'email',
  fileName: 'cv.pdf',
  analyzedAt: '2026-09-01T08:05:00.000Z',
  totalScore: 78,
  criteriaVersion: 'v1',
  status: 'accepted',
  decisionJustification: 'OK',
  fromVivier: false,
  vivierContactedAt: null,
  vivierAppliedAt: null,
  corrections: [],
  validatedAt: null,
  invitationSentAt: null,
  rejectionSentAt: null,
  rejectionViaValidation: false,
  decidedByUserEmail: null,
  scheduledAt: null,
  interviewRealizedAt: '2026-09-10T10:00:00.000Z',
  interviewMissedAt: null,
  finalValidatedAt: '2026-09-11T09:00:00.000Z',
  finalRejectedAt: null,
  verdictComments: [],
  dismissedAt: null,
  dismissalReasonLabel: null,
};

const detailOf = (facts: CandidateTimelineFacts, key: string) =>
  buildCandidateTimeline(facts).find((e) => e.key === key)?.detail;

describe('frise — commentaire du verdict final', () => {
  it('le verdict porte SON commentaire et son auteur', () => {
    const d = detailOf(
      {
        ...BASE,
        verdictComments: [
          { at: '2026-09-11T09:00:00.000Z', verdict: 'validated', body: 'Solide sur la recette.', by: 'sarah@cabinet.fr' },
        ],
      },
      'final_validated',
    );
    expect(d).toBe('« Solide sur la recette. » — sarah@cabinet.fr');
  });

  it('le plus RÉCENT commentaire écrit pour CE verdict', () => {
    const d = detailOf(
      {
        ...BASE,
        verdictComments: [
          { at: '2026-09-11T09:00:00.000Z', verdict: 'validated', body: 'Premier.', by: 'a@c.fr' },
          { at: '2026-09-12T09:00:00.000Z', verdict: 'validated', body: 'Second.', by: 'b@c.fr' },
          { at: '2026-09-13T09:00:00.000Z', verdict: 'rejected', body: 'Autre verdict.', by: 'c@c.fr' },
        ],
      },
      'final_validated',
    );
    expect(d).toBe('« Second. » — b@c.fr');
  });

  it('un commentaire écrit pour un autre verdict ne justifie pas celui-ci', () => {
    const d = detailOf(
      {
        ...BASE,
        verdictComments: [
          { at: '2026-09-11T09:00:00.000Z', verdict: 'rejected', body: 'Écrit pour un refus.', by: 'a@c.fr' },
        ],
      },
      'final_validated',
    );
    expect(d).toBe('Aucun commentaire enregistré pour ce verdict');
  });

  it('verdict historique sans commentaire : on le DIT', () => {
    expect(detailOf(BASE, 'final_validated')).toBe('Aucun commentaire enregistré pour ce verdict');
  });

  it('lecture indisponible : on se TAIT (jamais une absence non vérifiée)', () => {
    expect(detailOf({ ...BASE, verdictComments: null }, 'final_validated')).toBeNull();
  });

  it('auteur non enregistré : écrit, jamais inventé', () => {
    const d = detailOf(
      {
        ...BASE,
        verdictComments: [
          { at: '2026-09-11T09:00:00.000Z', verdict: 'validated', body: 'Motif.', by: null },
        ],
      },
      'final_validated',
    );
    expect(d).toBe('« Motif. » — auteur non enregistré');
  });
});

describe('frise — compte rendu d’entretien', () => {
  it('un compte rendu VALIDÉ apparaît après l’entretien, avec sa mention', () => {
    const t = buildCandidateTimeline({
      ...BASE,
      interviewReport: { verifiedAt: '2026-09-10T15:00:00.000Z', mention: 'Rédigé et validé par sarah@cabinet.fr le 10/09/2026' },
    });
    const keys = t.map((e) => e.key);
    expect(keys.indexOf('interview_report')).toBeGreaterThan(keys.indexOf('interview_realized'));
    expect(keys.indexOf('interview_report')).toBeLessThan(keys.indexOf('final_validated'));
    expect(t.find((e) => e.key === 'interview_report')?.detail).toBe(
      'Rédigé et validé par sarah@cabinet.fr le 10/09/2026',
    );
  });

  it('aucun compte rendu (ou brouillon) : aucun événement', () => {
    expect(buildCandidateTimeline({ ...BASE, interviewReport: null }).some((e) => e.key === 'interview_report')).toBe(false);
  });
});
