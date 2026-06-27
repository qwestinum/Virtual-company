import { describe, expect, it } from 'vitest';

import {
  campaignReportFileName,
  campaignSubjectRef,
  donneurOrdreLabel,
  filterCampaignSummaries,
  generatedMention,
  resultCountLabel,
  sentMention,
  sortCampaignSummaries,
} from '@/lib/reporting/campaign-report-display';
import type { CampaignReportSummary } from '@/types/reporting';

function summary(p: Partial<CampaignReportSummary>): CampaignReportSummary {
  return {
    campaignId: 'CAMP-1',
    campaignName: 'Campagne dev',
    jobTitle: 'Développeur Front',
    launchedAt: '2026-03-01T00:00:00.000Z',
    closedAt: '2026-06-01T00:00:00.000Z',
    durationDays: 92,
    donneurOrdre: { label: 'M. Durand', role: 'DRH' },
    donneurOrdreId: 'DO-1',
    siteId: 'SITE-1',
    siteLabel: 'Paris',
    volumes: { received: 10, retained: 3, rejected: 7, enAttente: 0, decidedBySystem: 9, decidedByHuman: 1 },
    issue: 'recruited',
    recruitedCount: 1,
    generatedAt: null,
    sends: [],
    ...p,
  };
}

describe('campaignReportFileName', () => {
  it('slugifie le poste + date de clôture', () => {
    expect(
      campaignReportFileName('Développeur Front-end', '2026-06-18T09:00:00Z'),
    ).toBe('ORQA-rapport-campagne-developpeur-front-end-2026-06-18.pdf');
  });
});

describe('mentions de carte', () => {
  it('sentMention : N fois + dernier envoi, null si jamais', () => {
    expect(sentMention(summary({ sends: [] }))).toBeNull();
    const m = sentMention(
      summary({
        sends: [
          { at: '2026-06-18T10:00:00Z', to: ['a@x.fr'], subject: 'A' },
          { at: '2026-06-10T10:00:00Z', to: ['b@x.fr'], subject: 'B' },
        ],
      }),
    );
    expect(m).toMatch(/envoyé 2 fois/);
    expect(m).toMatch(/18 juin 2026/);
  });

  it('generatedMention : null sans cache, sinon date', () => {
    expect(generatedMention(summary({ generatedAt: null }))).toBeNull();
    expect(generatedMention(summary({ generatedAt: '2026-06-15T00:00:00Z' }))).toMatch(
      /15 juin 2026/,
    );
  });

  it('donneurOrdreLabel : « Nom (rôle) » ou —', () => {
    expect(donneurOrdreLabel(summary({}))).toBe('M. Durand (DRH)');
    expect(donneurOrdreLabel(summary({ donneurOrdre: null }))).toBe('—');
  });

  it('campaignSubjectRef : intitulé distinct + id, sinon id seul', () => {
    expect(
      campaignSubjectRef(summary({ campaignName: 'Recrutement été', jobTitle: 'Dev' })),
    ).toBe('Recrutement été · CAMP-1');
    expect(
      campaignSubjectRef(summary({ campaignName: 'Dev', jobTitle: 'Dev' })),
    ).toBe('CAMP-1');
  });
});

describe('filterCampaignSummaries', () => {
  const items = [
    summary({ campaignId: 'A', jobTitle: 'Développeur', donneurOrdreId: 'DO-1', closedAt: '2026-06-01T00:00:00Z' }),
    summary({ campaignId: 'B', jobTitle: 'Comptable', donneurOrdreId: 'DO-2', donneurOrdre: { label: 'Mme Bernard', role: null }, siteId: 'SITE-2', closedAt: '2026-04-15T00:00:00Z' }),
  ];

  it('recherche sur poste / donneur', () => {
    expect(filterCampaignSummaries(items, { search: 'compta' })).toHaveLength(1);
    expect(filterCampaignSummaries(items, { search: 'durand' })[0]!.campaignId).toBe('A');
  });

  it('filtre donneur d’ordre', () => {
    expect(
      filterCampaignSummaries(items, { donneurOrdreId: 'DO-2' })[0]!.campaignId,
    ).toBe('B');
  });

  it('filtre site', () => {
    expect(filterCampaignSummaries(items, { siteId: 'SITE-1' })[0]!.campaignId).toBe('A');
    expect(filterCampaignSummaries(items, { siteId: 'SITE-2' })).toHaveLength(1);
  });

  it('filtre période sur la date de clôture (bornes incluses)', () => {
    expect(
      filterCampaignSummaries(items, { from: '2026-05-01', to: '2026-06-30' }),
    ).toHaveLength(1);
    expect(
      filterCampaignSummaries(items, { from: '2026-01-01', to: '2026-12-31' }),
    ).toHaveLength(2);
  });

  it('combinaison ET + reset (filtres vides = tout)', () => {
    // « Développeur » (poste de A) + donneur DO-2 (campagne B) → aucun.
    expect(
      filterCampaignSummaries(items, {
        search: 'Développeur',
        donneurOrdreId: 'DO-2',
      }),
    ).toHaveLength(0);
    expect(filterCampaignSummaries(items, {})).toHaveLength(2);
  });
});

describe('sortCampaignSummaries', () => {
  const items = [
    summary({ campaignId: 'A', campaignName: 'Bravo', closedAt: '2026-04-01T00:00:00Z', durationDays: 10 }),
    summary({ campaignId: 'B', campaignName: 'Alpha', closedAt: '2026-06-01T00:00:00Z', durationDays: 90 }),
  ];

  it('clôture décroissante par défaut', () => {
    expect(sortCampaignSummaries(items, 'closed_desc')[0]!.campaignId).toBe('B');
  });
  it('clôture croissante', () => {
    expect(sortCampaignSummaries(items, 'closed_asc')[0]!.campaignId).toBe('A');
  });
  it('nom A→Z', () => {
    expect(sortCampaignSummaries(items, 'name_asc')[0]!.campaignName).toBe('Alpha');
  });
  it('durée décroissante', () => {
    expect(sortCampaignSummaries(items, 'duration_desc')[0]!.durationDays).toBe(90);
  });
  it('ne mute pas l’entrée', () => {
    const copy = [...items];
    sortCampaignSummaries(items, 'name_asc');
    expect(items).toEqual(copy);
  });
});

describe('resultCountLabel', () => {
  it('accorde le pluriel', () => {
    expect(resultCountLabel(1)).toMatch(/^1 campagne clôturée /);
    expect(resultCountLabel(12)).toMatch(/^12 campagnes clôturées /);
  });
});
