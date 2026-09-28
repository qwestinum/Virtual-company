import { describe, expect, it } from 'vitest';

import { buildVivierProfile, PROFILE_SKILLS_MAX } from '@/lib/vivier/profile-summary';

const base = {
  title: '  Business Analyst ',
  titleAnchors: [
    { text: 'Business Analyst', depth: 0, terms: [] },
    { text: 'Consultant AMOA', depth: 2, terms: [] },
    { text: 'Chef de projet MOA', depth: 1, terms: [] },
  ],
  skills: ['SQL', 'SQL', ' JIRA ', ...Array.from({ length: 20 }, (_, i) => `S${i}`)],
  entities: { technologies: [], certifications: [], diplomes: ['Master MIAGE'], secteurs: ['Banque'], langues: ['Anglais'], experienceYears: 8, localisation: 'Paris' },
  applications: [
    { analysisId: 'a1', campaignId: 'CAMP-1', jobTitle: 'BA', receivedAt: '2026-03-12T09:00:00Z', score: 71, stageLabel: 'Non retenu' },
    { analysisId: 'a2', campaignId: 'CAMP-2', jobTitle: 'MOA', receivedAt: '2026-01-02T09:00:00Z', score: 55, stageLabel: 'Écarté' },
  ],
  proposals: [
    { campaignId: 'CAMP-1', state: 'identified' as const, contactedAt: null, rejectedAt: null },
    { campaignId: 'CAMP-3', state: 'contacted' as const, contactedAt: '2026-05-01T09:00:00Z', rejectedAt: null },
    { campaignId: 'CAMP-4', state: 'rejected' as const, contactedAt: null, rejectedAt: '2026-06-01T09:00:00Z' },
  ],
  jobTitleOf: (id: string) => `Poste ${id}`,
  currentCampaignId: 'CAMP-1',
};

describe('synthèse d’un profil du vivier', () => {
  it('titre, derniers postes récents d’abord, expérience, compétences dédoublonnées et bornées', () => {
    const p = buildVivierProfile(base);
    expect(p.synthesis.title).toBe('Business Analyst');
    expect(p.synthesis.positions).toEqual(['Chef de projet MOA', 'Consultant AMOA']);
    expect(p.synthesis).toMatchObject({ experienceYears: 8, localisation: 'Paris', diplomes: ['Master MIAGE'], langues: ['Anglais'] });
    expect(p.synthesis.skills.slice(0, 2)).toEqual(['SQL', 'JIRA']);
    expect(p.synthesis.skills).toHaveLength(PROFILE_SKILLS_MAX);
  });

  it('historique : la candidature à CETTE campagne est signalée, les sollicitations des autres campagnes datées', () => {
    const p = buildVivierProfile(base);
    expect(p.applications.map((a) => [a.analysisId, a.current])).toEqual([['a1', true], ['a2', false]]);
    expect(p.solicitations).toEqual([
      { campaignId: 'CAMP-3', jobTitle: 'Poste CAMP-3', state: 'contacted', at: '2026-05-01T09:00:00Z' },
      { campaignId: 'CAMP-4', jobTitle: 'Poste CAMP-4', state: 'rejected', at: '2026-06-01T09:00:00Z' },
    ]);
  });

  it('entités absentes : la synthèse reste lisible, rien n’est inventé', () => {
    const p = buildVivierProfile({ ...base, entities: null, titleAnchors: [], skills: [], title: null });
    expect(p.synthesis).toEqual({ title: null, positions: [], experienceYears: null, localisation: null, skills: [], diplomes: [], langues: [], secteurs: [] });
  });
});
