import { describe, expect, it } from 'vitest';

import {
  buildCandidateTimeline,
  type CandidateTimelineFacts,
} from '@/lib/reporting/candidate-timeline';

function facts(over: Partial<CandidateTimelineFacts> = {}): CandidateTimelineFacts {
  return {
    receivedAt: '2026-06-01T08:00:00.000Z',
    source: 'email',
    fileName: 'cv.pdf',
    analyzedAt: '2026-06-01T08:05:00.000Z',
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
    interviewRealizedAt: null,
    interviewMissedAt: null,
    finalValidatedAt: null,
    finalRejectedAt: null,
    dismissedAt: null,
    dismissalReasonLabel: null,
    ...over,
  };
}

describe('buildCandidateTimeline', () => {
  it('omet les faits sans date et garde réception + analyse', () => {
    const t = buildCandidateTimeline(facts());
    expect(t.map((e) => e.key)).toEqual(['received', 'analyzed']);
  });

  it('trie par date ascendante et inclut tous les faits datés (par-uid)', () => {
    const t = buildCandidateTimeline(
      facts({
        vivierContactedAt: '2026-05-30T10:00:00.000Z',
        invitationSentAt: '2026-06-01T09:00:00.000Z',
        interviewRealizedAt: '2026-06-05T10:00:00.000Z',
        finalValidatedAt: '2026-06-06T09:00:00.000Z',
        fromVivier: true,
      }),
    );
    expect(t.map((e) => e.key)).toEqual([
      'vivier_contacted', // 05-30
      'received', // 06-01 08:00
      'analyzed', // 06-01 08:05
      'invited', // 06-01 09:00
      'interview_realized', // 06-05
      'final_validated', // 06-06
    ]);
  });

  it('RÉCEPTION avant ANALYSE même si analyzedAt précède receivedAt (tri par rang)', () => {
    // Horodatages inversés (analyse « avant » réception, à la seconde près) :
    // l'ordre métier doit primer.
    const t = buildCandidateTimeline(
      facts({
        receivedAt: '2026-06-01T19:57:30.000Z',
        analyzedAt: '2026-06-01T19:57:10.000Z',
      }),
    );
    expect(t.map((e) => e.key)).toEqual(['received', 'analyzed']);
  });

  it('inclut « Candidat validé » et « RDV pris », dans l’ordre du pipeline', () => {
    const t = buildCandidateTimeline(
      facts({
        validatedAt: '2026-06-02T09:00:00.000Z',
        scheduledAt: '2026-06-03T14:00:00.000Z',
        interviewRealizedAt: '2026-06-05T10:00:00.000Z',
      }),
    );
    expect(t.map((e) => e.key)).toEqual([
      'received',
      'analyzed',
      'validated',
      'scheduled',
      'interview_realized',
    ]);
  });

  it('ignore une date sentinelle 1970 (analyse historique)', () => {
    const t = buildCandidateTimeline(facts({ analyzedAt: '1970-01-01T00:00:00.000Z' }));
    expect(t.map((e) => e.key)).toEqual(['received']);
  });

  it('porte la tonalité des issues négatives', () => {
    const t = buildCandidateTimeline(facts({ finalRejectedAt: '2026-06-07T00:00:00.000Z' }));
    const final = t.find((e) => e.key === 'final_rejected');
    expect(final?.tone).toBe('negative');
  });

  it('refus HITL (gris tranché humain) : « Refus envoyé » avec décideur en détail', () => {
    const t = buildCandidateTimeline(
      facts({
        rejectionSentAt: '2026-07-31T07:19:05.000Z',
        rejectionViaValidation: true,
        decidedByUserEmail: 'manuela.chotoklieva@biagroupe.fr',
      }),
    );
    const rejected = t.find((e) => e.key === 'rejected_mail');
    expect(rejected?.label).toBe('Refus envoyé');
    expect(rejected?.detail).toBe(
      'Refus tranché en zone de validation · par manuela.chotoklieva@biagroupe.fr',
    );
  });

  it('refus AUTO : « Refus envoyé » sans détail de validation', () => {
    const t = buildCandidateTimeline(
      facts({ rejectionSentAt: '2026-07-31T07:19:05.000Z' }),
    );
    expect(t.find((e) => e.key === 'rejected_mail')?.detail).toBeNull();
  });

  it('acceptation HITL : décideur en détail de « Candidat validé »', () => {
    const t = buildCandidateTimeline(
      facts({
        validatedAt: '2026-06-02T09:00:00.000Z',
        invitationSentAt: '2026-06-02T09:00:00.000Z',
        decidedByUserEmail: 'vanessa.eudaric@biagroupe.fr',
      }),
    );
    expect(t.find((e) => e.key === 'validated')?.detail).toBe(
      'Acceptation tranchée en zone de validation · par vanessa.eudaric@biagroupe.fr',
    );
    expect(t.map((e) => e.key)).toContain('invited');
  });
});

describe('corrections — le journal est en ajout seul, la frise aussi', () => {
  it('le fait corrigé RESTE, la correction se pose après lui', () => {
    const t = buildCandidateTimeline(
      facts({
        finalRejectedAt: '2026-08-21T14:32:00.000Z',
        corrections: [
          {
            at: '2026-08-22T09:10:00.000Z',
            previousLabel: 'Non retenu',
            nextLabel: 'Verdict final retiré',
            by: 'sarah@qwestinum.fr',
            reason: 'erreur de manipulation',
          },
        ],
      }),
    );
    const keys = t.map((e) => e.key);
    // Le refus reste visible — on n'efface pas ce qui s'est produit.
    expect(keys).toContain('final_rejected');
    expect(keys.indexOf('correction_0')).toBeGreaterThan(
      keys.indexOf('final_rejected'),
    );
    const correction = t.find((e) => e.key === 'correction_0');
    expect(correction?.label).toBe('Décision corrigée');
    expect(correction?.detail).toBe(
      'Non retenu → Verdict final retiré · par sarah@qwestinum.fr — erreur de manipulation',
    );
    // Une correction n'est ni une bonne ni une mauvaise nouvelle.
    expect(correction?.tone).toBe('neutral');
  });

  it('deux corrections successives apparaissent toutes les deux, dans l’ordre', () => {
    const t = buildCandidateTimeline(
      facts({
        corrections: [
          { at: '2026-08-22T09:00:00.000Z', previousLabel: 'Retenu', nextLabel: 'Non retenu', by: null, reason: null },
          { at: '2026-08-23T09:00:00.000Z', previousLabel: 'Non retenu', nextLabel: 'Retenu', by: null, reason: null },
        ],
      }),
    );
    const keys = t.map((e) => e.key);
    expect(keys).toContain('correction_0');
    expect(keys).toContain('correction_1');
    expect(keys.indexOf('correction_0')).toBeLessThan(keys.indexOf('correction_1'));
  });

  it('sans auteur enregistré, le détail ne fabrique aucun nom', () => {
    const t = buildCandidateTimeline(
      facts({
        corrections: [
          {
            at: '2026-08-22T09:00:00.000Z',
            previousLabel: 'Entretien réalisé',
            nextLabel: 'Marquage d’entretien retiré',
            by: null,
            reason: null,
          },
        ],
      }),
    );
    expect(t.find((e) => e.key === 'correction_0')?.detail).toBe(
      'Entretien réalisé → Marquage d’entretien retiré',
    );
  });
});
