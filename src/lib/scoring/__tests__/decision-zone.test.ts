import { describe, expect, it } from 'vitest';

import { classifyDecisionZone } from '@/lib/scoring/score-candidat';

describe('classifyDecisionZone (HITL 3 zones)', () => {
  const LOW = 40;
  const HIGH = 80;

  it('score < bas → auto_reject', () => {
    expect(classifyDecisionZone(39, LOW, HIGH, false)).toBe('auto_reject');
  });

  it('score == bas → gray (borne basse incluse)', () => {
    expect(classifyDecisionZone(40, LOW, HIGH, false)).toBe('gray');
  });

  it('bas < score < haut → gray', () => {
    expect(classifyDecisionZone(60, LOW, HIGH, false)).toBe('gray');
  });

  it('score == haut → auto_accept (borne haute incluse)', () => {
    expect(classifyDecisionZone(80, LOW, HIGH, false)).toBe('auto_accept');
  });

  it('score ≥ haut → auto_accept', () => {
    expect(classifyDecisionZone(95, LOW, HIGH, false)).toBe('auto_accept');
  });

  it('knockout force auto_reject même avec un score élevé', () => {
    expect(classifyDecisionZone(95, LOW, HIGH, true)).toBe('auto_reject');
  });

  it('poignées collées (bas == haut) : aucune zone grise (binaire)', () => {
    expect(classifyDecisionZone(74, 75, 75, false)).toBe('auto_reject');
    expect(classifyDecisionZone(75, 75, 75, false)).toBe('auto_accept');
  });

  it('bord assumé : score 100 avec haut=100 → auto_accept (bornes non tordues)', () => {
    expect(classifyDecisionZone(100, 0, 100, false)).toBe('auto_accept');
    // … et tout le reste de [0,100[ est gris (traduction « tout validé »).
    expect(classifyDecisionZone(99, 0, 100, false)).toBe('gray');
    expect(classifyDecisionZone(0, 0, 100, false)).toBe('gray');
  });
});
