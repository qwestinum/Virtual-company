import { describe, expect, it } from 'vitest';

import {
  MULTI_CAMPAIGN_PERIOD_PRESET_KEYS,
  defaultMultiCampaignPeriod,
  multiCampaignReportFileName,
  multiCampaignSendDefaults,
} from '@/lib/reporting/multi-campaign-report-display';

describe('MULTI_CAMPAIGN_PERIOD_PRESET_KEYS', () => {
  it('propose les 8 presets (courts + longs)', () => {
    expect(MULTI_CAMPAIGN_PERIOD_PRESET_KEYS).toHaveLength(8);
    expect(MULTI_CAMPAIGN_PERIOD_PRESET_KEYS).toContain('this_quarter');
    expect(MULTI_CAMPAIGN_PERIOD_PRESET_KEYS).toContain('last_year');
  });
});

describe('defaultMultiCampaignPeriod', () => {
  it('renvoie le mois en cours (bornes from ≤ to)', () => {
    const r = defaultMultiCampaignPeriod(new Date('2026-06-15T12:00:00Z'));
    expect(r.from).toBe('2026-06-01');
    expect(r.to).toBe('2026-06-30');
  });
});

describe('multiCampaignReportFileName', () => {
  it('période seule', () => {
    expect(multiCampaignReportFileName('2026-01-01', '2026-03-31')).toBe(
      'ORQA-rapport-multi-campagnes-2026-01-01-au-2026-03-31.pdf',
    );
  });
  it('enrichi par donneur + site (slugifiés)', () => {
    expect(
      multiCampaignReportFileName('2026-01-01', '2026-03-31', {
        donneurLabel: 'M. Durand',
        siteLabel: 'Paris-La Défense',
      }),
    ).toBe(
      'ORQA-rapport-multi-campagnes-2026-01-01-au-2026-03-31-m-durand-paris-la-defense.pdf',
    );
  });
});

describe('multiCampaignSendDefaults', () => {
  it('sujet + message pré-remplis avec période et nombre de campagnes', () => {
    const d = multiCampaignSendDefaults({ from: '2026-01-01', to: '2026-03-31' }, 17);
    expect(d.subject).toBe('Rapport multi-campagnes — Du 1 janvier 2026 au 31 mars 2026');
    expect(d.message).toMatch(/agrège 17 campagnes/);
    expect(d.message).toMatch(/du 1 janvier 2026 au 31 mars 2026/);
    expect(d.attachmentName).toBe(
      'ORQA-rapport-multi-campagnes-2026-01-01-au-2026-03-31.pdf',
    );
  });
  it('accorde le singulier pour une campagne', () => {
    const d = multiCampaignSendDefaults({ from: '2026-01-01', to: '2026-03-31' }, 1);
    expect(d.message).toMatch(/agrège 1 campagne clôturée /);
  });
});
