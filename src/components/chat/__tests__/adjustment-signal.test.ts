import { describe, expect, it } from 'vitest';

import { isAdjustmentSignal } from '@/components/chat/adjustment-signal';

describe('isAdjustmentSignal', () => {
  it('matches the canonical adjustment chips', () => {
    expect(isAdjustmentSignal('Ajuster')).toBe(true);
    expect(isAdjustmentSignal('Modifier')).toBe(true);
    expect(isAdjustmentSignal('Préciser')).toBe(true);
    expect(isAdjustmentSignal('Reformuler')).toBe(true);
    expect(isAdjustmentSignal('Changer')).toBe(true);
    expect(isAdjustmentSignal('Autre')).toBe(true);
    expect(isAdjustmentSignal('Non')).toBe(true);
  });

  it('matches case-insensitively and ignores accents', () => {
    expect(isAdjustmentSignal('AJUSTER')).toBe(true);
    expect(isAdjustmentSignal('preciser')).toBe(true);
  });

  it('matches multi-word adjustment forms', () => {
    expect(isAdjustmentSignal('Pas vraiment')).toBe(true);
    expect(isAdjustmentSignal('Plutôt pas')).toBe(true);
  });

  it('does NOT match concrete value chips', () => {
    expect(isAdjustmentSignal('Plus haut (60-75K)')).toBe(false);
    expect(isAdjustmentSignal('Septembre 2026')).toBe(false);
    expect(isAdjustmentSignal('junior')).toBe(false);
    expect(isAdjustmentSignal('confirmé')).toBe(false);
    expect(isAdjustmentSignal('Utiliser 50-65K')).toBe(false);
    expect(isAdjustmentSignal('Garder cette liste')).toBe(false);
  });

  it('does NOT match adjustment keyword embedded in a longer phrase', () => {
    // "Plus haut" doesn't start with an adjustment keyword.
    expect(isAdjustmentSignal('Plus haut')).toBe(false);
    // "Modifier la fourchette" actually begins with "modifier", so we
    // accept it — the whole chip is asking the user to take over.
    expect(isAdjustmentSignal('Modifier la fourchette')).toBe(true);
  });

  it('treats empty string as not an adjustment signal', () => {
    expect(isAdjustmentSignal('')).toBe(false);
    expect(isAdjustmentSignal('   ')).toBe(false);
  });

  it('phases 6.2 resume chips also match (intentional collision)', () => {
    // Documenté : ces libellés débutent par "Modifier" et matchent
    // donc isAdjustmentSignal. handleChipSelect doit les intercepter
    // EN PREMIER (avant ce détecteur) pour ne pas les absorber comme
    // de simples dismissals.
    expect(isAdjustmentSignal('Modifier la FDP')).toBe(true);
    expect(isAdjustmentSignal('Modifier la fiche de scoring')).toBe(true);
    expect(isAdjustmentSignal('Modifier les annonces')).toBe(true);
    expect(isAdjustmentSignal('Modifier les flux')).toBe(true);
  });
});
