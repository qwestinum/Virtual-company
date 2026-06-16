import { describe, expect, it } from 'vitest';

import { atomizeJobSkills } from '@/lib/vivier/job-skills';

describe('atomizeJobSkills', () => {
  it('chaîne libre avec virgules ⇒ items atomiques', () => {
    expect(atomizeJobSkills('Python, Selenium, gestion d’équipe')).toEqual([
      'Python',
      'Selenium',
      'gestion d’équipe',
    ]);
  });

  it('découpe sur ; / saut de ligne / puce / « et »', () => {
    expect(atomizeJobSkills('Java; Spring\nDocker / Kubernetes • CI et CD')).toEqual([
      'Java',
      'Spring',
      'Docker',
      'Kubernetes',
      'CI',
      'CD',
    ]);
  });

  it('tableau déjà atomique ⇒ préservé + dédupliqué', () => {
    expect(atomizeJobSkills(['Python', 'python', 'SQL'])).toEqual(['Python', 'SQL']);
  });

  it('valeur absente / non exploitable ⇒ liste vide', () => {
    expect(atomizeJobSkills(undefined)).toEqual([]);
    expect(atomizeJobSkills(null)).toEqual([]);
    expect(atomizeJobSkills(42)).toEqual([]);
    expect(atomizeJobSkills('   ')).toEqual([]);
  });

  it('retire les fragments trop courts', () => {
    expect(atomizeJobSkills('a, Python, x')).toEqual(['Python']);
  });
});
