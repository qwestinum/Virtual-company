import { describe, expect, it } from 'vitest';

import {
  buildFdpProposalSystemPrompt,
  buildFdpProposalUserPrompt,
} from '@/lib/agents/fdp-proposal-prompts';

describe('buildFdpProposalSystemPrompt', () => {
  it('cadre les énums et les listes attendues', () => {
    const p = buildFdpProposalSystemPrompt();
    expect(p).toContain('"junior"');
    expect(p).toContain('"senior"');
    expect(p).toContain('"CDI"');
    expect(p).toContain('main_missions');
    expect(p).toContain('key_skills');
    // L'intitulé est fixé par le DRH, jamais proposé.
    expect(p).toMatch(/Ne propose PAS .*job_title/);
  });
});

describe('buildFdpProposalUserPrompt', () => {
  it('inclut l’intitulé fourni', () => {
    const p = buildFdpProposalUserPrompt('Comptable senior');
    expect(p).toContain('Comptable senior');
  });

  it('liste les champs déjà renseignés et ignore job_title vide', () => {
    const p = buildFdpProposalUserPrompt('Comptable', {
      location: 'Lyon',
      seniority: 'confirmé',
      job_title: 'Comptable',
    });
    expect(p).toContain('Lyon');
    expect(p).toContain('confirmé');
    expect(p).toMatch(/déjà renseignés/);
  });

  it('n’affiche pas la section « déjà renseignés » quand rien n’est connu', () => {
    const p = buildFdpProposalUserPrompt('Comptable', {});
    expect(p).not.toMatch(/déjà renseignés/);
  });
});
