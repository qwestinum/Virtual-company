import { describe, expect, it } from 'vitest';

import {
  buildDefaultSourcesConfig,
  CV_SOURCE_OPERATIONAL,
  CV_SOURCES,
} from '@/types/cv-source';

describe('cv-source', () => {
  it('manual, email et vivier sont opérationnels ; les jobboards restent placeholders', () => {
    expect(CV_SOURCE_OPERATIONAL.manual).toBe(true);
    expect(CV_SOURCE_OPERATIONAL.email).toBe(true);
    // Vivier opérationnel en V2 (présélection interne à l'activation).
    expect(CV_SOURCE_OPERATIONAL.vivier).toBe(true);
    // Les autres sources (local_folder + jobboards) restent placeholders
    // tant que le Publisher réel n'est pas câblé.
    const operational = new Set(['manual', 'email', 'vivier']);
    for (const source of CV_SOURCES) {
      if (operational.has(source)) continue;
      expect(CV_SOURCE_OPERATIONAL[source]).toBe(false);
    }
  });

  it('le vivier figure dans la liste des sources cochables', () => {
    expect(CV_SOURCES).toContain('vivier');
  });

  it('buildDefaultSourcesConfig n’active jamais le vivier par défaut (pas un canal de diffusion)', () => {
    // Même avec des channels sélectionnés, le vivier reste à cocher manuellement.
    expect(buildDefaultSourcesConfig([]).vivier).toBe(false);
    expect(buildDefaultSourcesConfig(['linkedin', 'apec']).vivier).toBe(false);
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
