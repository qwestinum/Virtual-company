import { describe, expect, it } from 'vitest';

import {
  addMonthsIso,
  buildCampaignReportData,
  buildCampaignReportSummary,
  channelPerformance,
  computeIssue,
  computeVolumes,
  daysBetween,
  scoreDistribution,
  stdDev,
  TIME_TO_HIRE_REFERENCE_DAYS,
  type CampaignReportMeta,
} from '@/lib/reporting/campaign-report';
import type { CampaignAnalysisDatum } from '@/types/reporting';

function datum(p: Partial<CampaignAnalysisDatum>): CampaignAnalysisDatum {
  return {
    status: 'accepted',
    totalScore: 80,
    source: 'email',
    humanIntervention: false,
    recruited: false,
    contacted: false,
    ...p,
  };
}

const META: CampaignReportMeta = {
  campaignId: 'CAMP-1',
  campaignName: 'Campagne dev',
  jobTitle: 'Développeur Front',
  launchedAt: '2026-03-01T00:00:00.000Z',
  closedAt: '2026-06-01T00:00:00.000Z',
  donneurOrdre: { label: 'M. Durand', role: 'DRH' },
  donneurOrdreId: 'DO-1',
  siteLabel: 'Paris',
};

describe('helpers numériques', () => {
  it('daysBetween compte les jours pleins', () => {
    expect(daysBetween('2026-03-01T00:00:00Z', '2026-06-01T00:00:00Z')).toBe(92);
    expect(daysBetween('bad', 'x')).toBe(0);
  });

  it('computeVolumes ventile statuts + arbitrage', () => {
    const v = computeVolumes([
      datum({ status: 'accepted' }),
      datum({ status: 'accepted', humanIntervention: true }),
      datum({ status: 'rejected' }),
    ]);
    expect(v).toEqual({ received: 3, retained: 2, rejected: 1, arbitrated: 1 });
  });

  it('computeIssue : recruited si au moins un recrutement', () => {
    expect(computeIssue([datum({ recruited: true })])).toEqual({
      issue: 'recruited',
      recruitedCount: 1,
    });
    expect(computeIssue([datum({})]).issue).toBe('no_hire');
  });

  it('scoreDistribution répartit en 5 tranches', () => {
    const d = scoreDistribution([10, 45, 70, 80, 95, 99]);
    expect(d.map((b) => b.count)).toEqual([1, 1, 1, 1, 2]);
  });

  it('stdDev : null sous 2 valeurs', () => {
    expect(stdDev([80])).toBeNull();
    expect(stdDev([70, 90])).toBe(10);
  });

  it('channelPerformance groupe par source, calcule taux et trie par retenus', () => {
    const rows = channelPerformance([
      datum({ source: 'email', status: 'accepted' }),
      datum({ source: 'email', status: 'rejected' }),
      datum({ source: 'linkedin', status: 'accepted', recruited: true }),
      datum({ source: 'linkedin', status: 'accepted', recruited: false }),
    ]);
    // LinkedIn : 2 retenus → en tête (tri par retenus décroissant).
    expect(rows[0]!.channelLabel).toBe('LinkedIn');
    expect(rows[0]!.recruited).toBe(1);
    const email = rows.find((r) => r.channelLabel === 'Boîte mail générique')!;
    expect(email.retentionRate).toBe(50);
  });

  it('addMonthsIso ajoute des mois', () => {
    expect(addMonthsIso('2026-06-01T00:00:00.000Z', 24).slice(0, 4)).toBe('2028');
  });
});

describe('buildCampaignReportSummary', () => {
  it('assemble durée, volumes, issue et tri des envois', () => {
    const s = buildCampaignReportSummary(
      META,
      [datum({ recruited: true }), datum({ status: 'rejected' })],
      [
        { at: '2026-06-02T10:00:00Z', to: ['a@x.fr'], subject: 'A' },
        { at: '2026-06-05T10:00:00Z', to: ['b@x.fr'], subject: 'B' },
      ],
      '2026-06-03T00:00:00Z',
    );
    expect(s.durationDays).toBe(92);
    expect(s.issue).toBe('recruited');
    expect(s.volumes.received).toBe(2);
    expect(s.generatedAt).toBe('2026-06-03T00:00:00Z');
    // Envois triés décroissant → le plus récent en tête.
    expect(s.sends[0]!.subject).toBe('B');
  });
});

describe('buildCampaignReportData — recommandations (règles)', () => {
  it('recommande le canal dominant + signale le faible volume', () => {
    const analyses = [
      datum({ source: 'linkedin', status: 'accepted', recruited: true }),
      datum({ source: 'email', status: 'rejected' }),
    ];
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    const data = buildCampaignReportData(summary, analyses);
    const joined = data.recommendations.join(' | ');
    expect(joined).toMatch(/LinkedIn/);
    expect(joined).toMatch(/[Ff]aible volume/);
    expect(data.recommendations.length).toBeLessThanOrEqual(5);
  });

  it('campagne sans recrutement → reco dédiée + issue no_hire', () => {
    const analyses = [datum({ status: 'rejected' }), datum({ status: 'rejected' })];
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    const data = buildCampaignReportData(summary, analyses);
    expect(summary.issue).toBe('no_hire');
    expect(data.recommendations.join(' ')).toMatch(/sans recrutement/i);
    expect(data.performance.timeToHireDays).toBeNull();
  });

  it('time-to-hire renseigné quand recrutement (proxy lancement→clôture)', () => {
    const analyses = [datum({ recruited: true })];
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    const data = buildCampaignReportData(summary, analyses);
    expect(data.performance.timeToHireDays).toBe(92);
    expect(92).toBeGreaterThan(TIME_TO_HIRE_REFERENCE_DAYS);
    expect(data.recommendations.join(' ')).toMatch(/[Tt]ime-to-hire/);
  });

  it('taux d’arbitrage élevé → reco de recalibration', () => {
    const analyses = Array.from({ length: 4 }, (_, i) =>
      datum({ humanIntervention: i < 2, status: 'accepted', recruited: false }),
    );
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    const data = buildCampaignReportData(summary, analyses);
    expect(data.scoring.arbitrationRate).toBe(0.5);
    expect(data.recommendations.join(' ')).toMatch(/arbitrage/i);
  });

  it('fallback : toujours au moins une recommandation', () => {
    // 6 retenus, aucun arbitrage, volume suffisant, recrutement → pas de règle
    // critique déclenchée hormis canal/retenue.
    const analyses = Array.from({ length: 6 }, () =>
      datum({ source: 'linkedin', status: 'accepted', recruited: true }),
    );
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    const data = buildCampaignReportData(summary, analyses);
    expect(data.recommendations.length).toBeGreaterThanOrEqual(1);
  });

  it('lowVolume vrai sous 5 candidatures', () => {
    const analyses = [datum({})];
    const summary = buildCampaignReportSummary(META, analyses, [], null);
    expect(buildCampaignReportData(summary, analyses).lowVolume).toBe(true);
  });
});
