import { describe, expect, it } from 'vitest';

import { renderFdpMarkdown, suggestFdpFileName } from '@/lib/agents/fdp-render';
import { buildEmptyFDP, type FDPInProgress } from '@/types/field-collection';

function fillFdp(): FDPInProgress {
  const fdp = buildEmptyFDP('CAMP-0001');
  const set = (
    key: keyof typeof fdp.fields,
    value: unknown,
  ): void => {
    fdp.fields[key] = {
      ...fdp.fields[key]!,
      status: 'filled',
      value,
    };
  };
  set('job_title', 'Comptable senior');
  set('seniority', 'senior');
  set('contract_type', 'CDI');
  set('location', 'Paris');
  set('salary_range', '50-65K bruts annuels');
  set('start_date', 'septembre 2026');
  set('main_missions', ['Clôtures mensuelles', 'Suivi fiscal']);
  set('key_skills', ['IFRS', 'Compta générale']);
  fdp.isComplete = true;
  fdp.isValidated = true;
  return fdp;
}

describe('renderFdpMarkdown', () => {
  it('produces a structured markdown with bullets and sub-lists', () => {
    const md = renderFdpMarkdown(fillFdp());
    expect(md).toContain('# Fiche de poste — CAMP-0001');
    expect(md).toContain('- Intitulé du poste : Comptable senior');
    expect(md).toContain('- Séniorité : senior');
    expect(md).toContain('- Missions principales :');
    expect(md).toContain('  - Clôtures mensuelles');
    expect(md).toContain('  - Suivi fiscal');
    expect(md).toContain('- Compétences clés :');
    expect(md).toContain('  - IFRS');
    expect(md).toContain('Statut : validée.');
  });

  it('omits empty fields rather than rendering empty bullets', () => {
    const fdp = buildEmptyFDP('CAMP-0002');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      status: 'filled',
      value: 'Développeur',
    };
    const md = renderFdpMarkdown(fdp);
    expect(md).toContain('- Intitulé du poste : Développeur');
    expect(md).not.toContain('- Séniorité :');
    expect(md).not.toContain('- Localisation :');
    expect(md).toContain('Statut : en cours de cadrage.');
  });
});

describe('suggestFdpFileName', () => {
  it('returns fdp-<campaignId>.md', () => {
    expect(suggestFdpFileName('CAMP-2026-001')).toBe('fdp-CAMP-2026-001.md');
    expect(suggestFdpFileName('TASK-XYZ')).toBe('fdp-TASK-XYZ.md');
  });
});
