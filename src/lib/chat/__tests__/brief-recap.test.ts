import { describe, expect, it } from 'vitest';

import { buildBriefRecap } from '@/lib/chat/manager-flow';
import {
  type CampaignPrefill,
  prefillToFDP,
} from '@/types/campaign-prefill';

function makePrefill(over: Partial<CampaignPrefill> = {}): CampaignPrefill {
  const t = () => ({ value: null, extraitSource: null });
  return {
    jobTitle: t(),
    contractType: t(),
    location: t(),
    salaryRange: t(),
    seniority: t(),
    startDate: t(),
    mainMissions: { value: null, extraitSource: null },
    keySkills: { value: null, extraitSource: null },
    suggestedCriteria: [],
    ...over,
  };
}

describe('buildBriefRecap', () => {
  it('rend explicite la distinction proposer / décider et cite les sources', () => {
    const prefill = makePrefill({
      jobTitle: { value: 'Comptable', extraitSource: 'Poste : Comptable' },
      location: { value: 'Lyon', extraitSource: null },
      suggestedCriteria: [
        {
          label: 'Management',
          level: 'critique',
          extraitSource: 'encadre une équipe de 5',
        },
      ],
    });
    const fdp = prefillToFDP(prefill, 'CAMP-X');
    const recap = buildBriefRecap('AO.pdf', fdp, prefill);

    expect(recap).toContain('AO.pdf');
    // Factuels « relevés ».
    expect(recap).toContain('Intitulé du poste');
    expect(recap).toContain('Localisation');
    // Pondérations « proposées », pas acquises.
    expect(recap).toContain('Je vous propose ces pondérations');
    expect(recap).toContain('Management');
    // Source citée.
    expect(recap).toContain('encadre une équipe de 5');
    // Seuils / éliminatoires laissés à l'humain.
    expect(recap).toContain('seuil');
  });

  it('sans pondération suggérée : pas de section propositions', () => {
    const prefill = makePrefill({
      jobTitle: { value: 'Dev', extraitSource: null },
    });
    const fdp = prefillToFDP(prefill, 'CAMP-Y');
    const recap = buildBriefRecap('notes.docx', fdp, prefill);
    expect(recap).not.toContain('Je vous propose ces pondérations');
  });
});
