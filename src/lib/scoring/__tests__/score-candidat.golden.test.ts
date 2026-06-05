import { describe, it, expect } from 'vitest';

import { scoreCandidat } from '@/lib/scoring';
import {
  CV_SAMPLE_FIXTURES,
} from '../../../../tests/fixtures/cv-samples';

/**
 * Golden tests du scoreur PUR — tolérance 0 (cf.
 * memory/feedback_pure_function_test_purity.md). Aucun appel LLM : les
 * décisions par critère sont pré-extraites dans les fixtures, le score est
 * mathématiquement déterminé. Le ±2 et le rejeu du `cvText` relèvent de C4.
 */
describe('scoreCandidat — golden fixtures (banque CV)', () => {
  it('la banque couvre au moins 10 CV représentatifs', () => {
    expect(CV_SAMPLE_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  it('couvre les deux statuts et les causes de rejet attendues', () => {
    const statuses = new Set(CV_SAMPLE_FIXTURES.map((f) => f.expectedScoreResult.status));
    expect(statuses).toEqual(new Set(['accepted', 'rejected']));
    const reasons = new Set(
      CV_SAMPLE_FIXTURES.flatMap((f) =>
        f.expectedScoreResult.hardFailures.map((h) => `${h.criticityLevel}:${h.reason}`),
      ),
    );
    // knockout unsatisfied/unverifiable + cap unsatisfied/unverifiable.
    expect(reasons).toContain('redhibitoire:unsatisfied');
    expect(reasons).toContain('redhibitoire:unverifiable');
    expect(reasons).toContain('obligatoire:unsatisfied');
    expect(reasons).toContain('obligatoire:unverifiable');
  });

  for (const fixture of CV_SAMPLE_FIXTURES) {
    describe(fixture.meta.name, () => {
      const result = scoreCandidat(fixture.decisions, fixture.scoringSheet);

      it('score & statut exacts (tolérance 0)', () => {
        expect(result.totalScore).toBe(fixture.expectedScoreResult.totalScore);
        expect(result.status).toBe(fixture.expectedScoreResult.status);
      });

      it('hardFailures exacts', () => {
        expect(result.hardFailures).toEqual(fixture.expectedScoreResult.hardFailures);
      });

      it('breakdown cohérent avec les décisions d’entrée', () => {
        // Tous les critères de la fiche sont dans le breakdown (jamais court-circuité).
        expect(result.breakdown).toHaveLength(fixture.scoringSheet.criteria.length);
        // Chaque décision d'entrée (hors llmFailure) se retrouve à l'identique.
        for (const d of fixture.decisions) {
          const inSheet = fixture.scoringSheet.criteria.some((c) => c.id === d.criterionId);
          if (!inSheet) continue;
          const row = result.breakdown.find((b) => b.criterionId === d.criterionId);
          expect(row).toBeDefined();
          const expectedDecision = d.llmFailure ? 'non_verifiable' : d.llmDecision;
          expect(row?.llmDecision).toBe(expectedDecision);
        }
        // Le score réel est conservé même pour un knockout (jamais forcé à 0
        // par le knockout — sauf si la base est nulle par ailleurs).
        if (result.status === 'rejected') {
          const knocked = fixture.expectedScoreResult.hardFailures.some(
            (h) => h.criticityLevel === 'redhibitoire',
          );
          if (knocked) {
            expect(result.totalScore).toBe(fixture.expectedScoreResult.totalScore);
          }
        }
      });

      it('sortie conforme au schéma (score entier 0-100)', () => {
        expect(Number.isInteger(result.totalScore)).toBe(true);
        expect(result.totalScore).toBeGreaterThanOrEqual(0);
        expect(result.totalScore).toBeLessThanOrEqual(100);
      });
    });
  }
});
