import { describe, expect, it } from 'vitest';

import {
  getAvatarColor,
  getAvatarInitials,
  getAvatarUrl,
  listAvatarMeta,
} from '@/lib/agents/avatar-colors';

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
  });
});

describe('getAvatarInitials', () => {
  it('returns the registered initials for each agent', () => {
    expect(getAvatarInitials('agent.manager-rh')).toBe('MR');
    expect(getAvatarInitials('agent.cv-analyzer')).toBe('CV');
    expect(getAvatarInitials('agent.mail-composer')).toBe('MC');
    expect(getAvatarInitials('agent.job-writer')).toBe('JW');
    expect(getAvatarInitials('agent.scheduler')).toBe('SC');
  });

  it('returns ?? for unknown ids', () => {
    expect(getAvatarInitials('agent.unknown')).toBe('??');
  });
});

describe('getAvatarUrl', () => {
  it('returns /avatars/<file>.png for known agents', () => {
    expect(getAvatarUrl('agent.manager-rh')).toBe('/avatars/manager.png');
    expect(getAvatarUrl('agent.cv-analyzer')).toBe('/avatars/cv-analyzer.png');
  });

  it('returns null for unknown ids', () => {
    expect(getAvatarUrl('agent.unknown')).toBeNull();
  });
});

describe('listAvatarMeta', () => {
  it('exposes the 6 registered agents', () => {
    const list = listAvatarMeta();
    expect(list).toHaveLength(6);
    expect(list.map((m) => m.agentId)).toEqual([
      'agent.manager-rh',
      'agent.cv-analyzer',
      'agent.mail-composer',
      'agent.job-writer',
      'agent.publisher',
      'agent.scheduler',
    ]);
  });
});
