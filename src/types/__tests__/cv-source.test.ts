import { describe, expect, it } from 'vitest';

import {
  buildDefaultSourcesConfig,
  CV_SOURCE_OPERATIONAL,
  CV_SOURCES,
} from '@/types/cv-source';

describe('cv-source', () => {
  it('manual is the only operational source in Session 4', () => {
    expect(CV_SOURCE_OPERATIONAL.manual).toBe(true);
    for (const source of CV_SOURCES) {
      if (source === 'manual') continue;
      expect(CV_SOURCE_OPERATIONAL[source]).toBe(false);
    }
  });

  it('buildDefaultSourcesConfig activates manual + the published channels', () => {
    const config = buildDefaultSourcesConfig(['linkedin', 'apec']);
    expect(config.manual).toBe(true);
    expect(config.linkedin).toBe(true);
    expect(config.apec).toBe(true);
    expect(config.indeed).toBe(false);
    expect(config.welcome_to_the_jungle).toBe(false);
    expect(config.france_travail).toBe(false);
    expect(config.email).toBe(false);
    expect(config.local_folder).toBe(false);
  });

  it('buildDefaultSourcesConfig ignores the "generic" pseudo-channel', () => {
    const config = buildDefaultSourcesConfig(['generic', 'linkedin']);
    expect(config.linkedin).toBe(true);
    // 'generic' has no incoming flow → no source toggled by its mention.
    // The config never exposes 'generic' anyway (not in CV_SOURCES),
    // but we still want manual + linkedin and nothing else active.
    const activeKeys = (Object.entries(config) as [string, boolean][])
      .filter(([, on]) => on)
      .map(([k]) => k);
    expect(activeKeys.sort()).toEqual(['linkedin', 'manual']);
  });

  it('buildDefaultSourcesConfig with no channels keeps only manual active', () => {
    const config = buildDefaultSourcesConfig([]);
    const activeKeys = (Object.entries(config) as [string, boolean][])
      .filter(([, on]) => on)
      .map(([k]) => k);
    expect(activeKeys).toEqual(['manual']);
  });
});
