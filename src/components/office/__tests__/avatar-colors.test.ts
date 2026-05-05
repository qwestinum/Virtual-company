import { describe, expect, it } from 'vitest';

import {
  getAvatarColor,
  getAvatarPhase,
} from '@/components/office/avatar-colors';

describe('getAvatarColor', () => {
  it('returns the registered color for each known agent id', () => {
    expect(getAvatarColor('agent.manager-rh')).toBe('#1e3a8a');
    expect(getAvatarColor('agent.cv-analyzer')).toBe('#0d9488');
    expect(getAvatarColor('agent.mail-composer')).toBe('#d97706');
    expect(getAvatarColor('agent.job-writer')).toBe('#7c3aed');
    expect(getAvatarColor('agent.scheduler')).toBe('#16a34a');
  });

  it('returns the slate fallback for unknown ids', () => {
    expect(getAvatarColor('agent.unknown')).toBe('#64748b');
    expect(getAvatarColor('')).toBe('#64748b');
  });
});

describe('getAvatarPhase', () => {
  it('is deterministic for a given id', () => {
    expect(getAvatarPhase('agent.cv-analyzer')).toBe(
      getAvatarPhase('agent.cv-analyzer'),
    );
  });

  it('differs across the registry ids (desync bobbing)', () => {
    const phases = [
      'agent.manager-rh',
      'agent.cv-analyzer',
      'agent.mail-composer',
      'agent.job-writer',
      'agent.scheduler',
    ].map(getAvatarPhase);
    const unique = new Set(phases);
    expect(unique.size).toBe(phases.length);
  });

  it('stays within [0, 2π)', () => {
    for (const id of ['a', 'agent.x', 'lorem-ipsum']) {
      const p = getAvatarPhase(id);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(Math.PI * 2);
    }
  });
});
