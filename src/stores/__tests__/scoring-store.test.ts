import { beforeEach, describe, expect, it } from 'vitest';

import { useScoringStore } from '@/stores/scoring-store';
import { buildCriterion, DEFAULT_WEIGHTS } from '@/types/scoring';

describe('scoring-store', () => {
  beforeEach(() => {
    useScoringStore.getState().reset();
  });

  it('proposeSheet stores the criteria and starts in draft state', () => {
    const sheet = useScoringStore.getState().proposeSheet('CAMP-2026-001', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      buildCriterion({ id: 'c2', label: 'Anglais', level: 'important' }),
    ]);

    expect(sheet.campaignId).toBe('CAMP-2026-001');
    expect(sheet.criteria).toHaveLength(2);
    expect(sheet.isValidated).toBe(false);
    expect(useScoringStore.getState().sheet?.criteria[0]?.weight).toBe(
      DEFAULT_WEIGHTS.obligatoire,
    );
  });

  it('confirmAllSuggestions acquitte toutes les pondérations suggérées', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-SG1', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      buildCriterion({ id: 's1', label: 'Management', level: 'critique', suggere: true }),
      buildCriterion({ id: 's2', label: 'Anglais', level: 'souhaitable', suggere: true }),
    ]);
    useScoringStore.getState().confirmAllSuggestions();
    const sheet = useScoringStore.getState().sheet;
    expect(sheet?.criteria).toHaveLength(3); // rien retiré
    expect(sheet?.criteria.every((c) => c.suggere !== true)).toBe(true);
  });

  it('rejectAllSuggestions retire les pondérations suggérées, garde les humaines', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-SG2', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
      buildCriterion({ id: 's1', label: 'Management', level: 'critique', suggere: true }),
    ]);
    useScoringStore.getState().rejectAllSuggestions();
    const sheet = useScoringStore.getState().sheet;
    expect(sheet?.criteria).toHaveLength(1);
    expect(sheet?.criteria[0]?.id).toBe('c1');
  });

  it('addCriterion appends with auto weight by level', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-002', []);
    useScoringStore
      .getState()
      .addCriterion({ label: 'Excel avancé', level: 'critique' });
    const sheet = useScoringStore.getState().sheet;
    expect(sheet?.criteria).toHaveLength(1);
    expect(sheet?.criteria[0]?.label).toBe('Excel avancé');
    expect(sheet?.criteria[0]?.weight).toBe(DEFAULT_WEIGHTS.critique);
  });

  it('updateCriterion realigns weight on level change when weight is omitted', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-003', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
    ]);
    useScoringStore.getState().updateCriterion('c1', { level: 'souhaitable' });
    const c = useScoringStore.getState().sheet?.criteria[0];
    expect(c?.level).toBe('souhaitable');
    expect(c?.weight).toBe(DEFAULT_WEIGHTS.souhaitable);
  });

  it('updateCriterion respects explicit weight override', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-004', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
    ]);
    useScoringStore
      .getState()
      .updateCriterion('c1', { level: 'souhaitable', weight: 9 });
    const c = useScoringStore.getState().sheet?.criteria[0];
    expect(c?.weight).toBe(9);
  });

  it('removeCriterion drops the matching entry', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-005', [
      buildCriterion({ id: 'c1', label: 'A', level: 'obligatoire' }),
      buildCriterion({ id: 'c2', label: 'B', level: 'critique' }),
    ]);
    useScoringStore.getState().removeCriterion('c1');
    const sheet = useScoringStore.getState().sheet;
    expect(sheet?.criteria).toHaveLength(1);
    expect(sheet?.criteria[0]?.id).toBe('c2');
  });

  it('validate switches isValidated to true only with at least one criterion', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-006', []);
    useScoringStore.getState().validate();
    expect(useScoringStore.getState().sheet?.isValidated).toBe(false);

    useScoringStore
      .getState()
      .addCriterion({ label: 'IFRS', level: 'obligatoire' });
    useScoringStore.getState().validate();
    expect(useScoringStore.getState().sheet?.isValidated).toBe(true);
  });

  it('reset clears the sheet entirely', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-007', [
      buildCriterion({ id: 'c1', label: 'A', level: 'critique' }),
    ]);
    useScoringStore.getState().reset();
    expect(useScoringStore.getState().sheet).toBeNull();
  });

  it('invalidate flips isValidated back to false without losing criteria', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-008', [
      buildCriterion({ id: 'c1', label: 'IFRS', level: 'obligatoire' }),
    ]);
    useScoringStore.getState().validate();
    expect(useScoringStore.getState().sheet?.isValidated).toBe(true);
    useScoringStore.getState().invalidate();
    const sheet = useScoringStore.getState().sheet;
    expect(sheet?.isValidated).toBe(false);
    expect(sheet?.criteria).toHaveLength(1);
  });

  it('invalidate is a no-op when the sheet is already a draft', () => {
    useScoringStore.getState().proposeSheet('CAMP-2026-009', [
      buildCriterion({ id: 'c1', label: 'A', level: 'critique' }),
    ]);
    useScoringStore.getState().invalidate();
    expect(useScoringStore.getState().sheet?.isValidated).toBe(false);
  });
});
