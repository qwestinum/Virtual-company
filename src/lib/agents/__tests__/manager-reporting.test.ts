import { describe, expect, it } from 'vitest';

import {
  buildCampaignFollowupResponse,
  buildReportingResponse,
  resolveCampaign,
  type ReportingSnapshot,
} from '@/lib/agents/manager-reporting';
import type { JournalEntry } from '@/lib/db/repos/journal';
import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { CampaignStatus } from '@/types/campaign-status';

function camp(
  id: string,
  name: string,
  status: CampaignStatus = 'active',
): ActiveCampaign {
  // Les builders n'utilisent que id / name / status — cast minimal.
  return { id, name, status } as ActiveCampaign;
}

function jrow(over: Partial<JournalEntry>): JournalEntry {
  return {
    id: 1,
    campaignId: null,
    actor: 'imap_poller',
    action: 'imap_cv_received',
    payload: {},
    createdAt: '2026-06-01T10:00:00.000Z',
    ...over,
  };
}

const CAMPAIGNS = [
  camp('CAMP-2026-025', 'Test Manager', 'active'),
  camp('CAMP-2026-099', 'Comptable', 'in_progress'),
  camp('CAMP-2026-010', 'Ancien poste', 'closed'),
];

const JOURNAL: JournalEntry[] = [
  jrow({ id: 1, action: 'imap_cv_received', campaignId: 'CAMP-2026-025' }),
  jrow({ id: 2, action: 'imap_cv_received', campaignId: 'CAMP-2026-025' }),
  jrow({
    id: 3,
    action: 'imap_cv_analyzed',
    campaignId: 'CAMP-2026-025',
    payload: { uid: 'u1', candidate: 'A', score: 90, aboveThreshold: true },
  }),
];

const SNAPSHOT: ReportingSnapshot = {
  campaigns: CAMPAIGNS,
  journal: JOURNAL,
};

describe('resolveCampaign', () => {
  it('trouve par identifiant CAMP-XXXX', () => {
    const r = resolveCampaign('où en est CAMP-2026-099 ?', CAMPAIGNS);
    expect(r.kind).toBe('found');
    expect(r.kind === 'found' && r.campaign.id).toBe('CAMP-2026-099');
  });

  it('trouve par intitulé', () => {
    const r = resolveCampaign('comment avance le Comptable ?', CAMPAIGNS);
    expect(r.kind === 'found' && r.campaign.id).toBe('CAMP-2026-099');
  });

  it('sans référence + plusieurs ouvertes → ambigu', () => {
    const r = resolveCampaign('fais le point', CAMPAIGNS);
    expect(r.kind).toBe('ambiguous');
  });

  it('une seule campagne ouverte → trouvée d’office', () => {
    const r = resolveCampaign('le point', [
      camp('CAMP-2026-025', 'Test Manager', 'active'),
      camp('CAMP-2026-010', 'Vieux', 'closed'),
    ]);
    expect(r.kind === 'found' && r.campaign.id).toBe('CAMP-2026-025');
  });

  it('aucune campagne → empty', () => {
    expect(resolveCampaign('le point', []).kind).toBe('empty');
  });
});

describe('buildCampaignFollowupResponse', () => {
  it('restitue les chiffres réels de la campagne', () => {
    const res = buildCampaignFollowupResponse(SNAPSHOT, 'CAMP-2026-025');
    expect(res.message).toContain('Test Manager');
    expect(res.message).toContain('Active');
    expect(res.message).toContain('CV reçus : 2');
    expect(res.message).toContain('Shortlistés / Invités : 1');
  });

  it('snapshot null → message dégradé', () => {
    expect(buildCampaignFollowupResponse(null, 'x').message).toMatch(
      /pas.*récupérer/i,
    );
  });

  it('aucune campagne → propose d’en lancer une', () => {
    const res = buildCampaignFollowupResponse(
      { campaigns: [], journal: [] },
      'le point',
    );
    expect(res.chips?.options).toContain('Lancer un recrutement');
  });

  it('ambigu → demande laquelle, chips = campagnes', () => {
    const res = buildCampaignFollowupResponse(SNAPSHOT, 'le point');
    expect(res.message).toMatch(/quelle campagne/i);
    expect(res.chips?.options.some((o) => o.includes('CAMP-2026-025'))).toBe(
      true,
    );
  });
});

describe('buildReportingResponse', () => {
  it('agrège les KPIs globaux + une ligne par campagne ouverte', () => {
    const res = buildReportingResponse(SNAPSHOT);
    expect(res.message).toContain('Point global');
    expect(res.message).toContain('CV reçus : 2');
    expect(res.message).toContain('Test Manager (CAMP-2026-025)');
    // La campagne fermée n'apparaît pas dans le détail.
    expect(res.message).not.toContain('Ancien poste');
    expect(res.chips?.options.some((o) => o.startsWith('Point sur'))).toBe(
      true,
    );
  });

  it('snapshot null → message dégradé', () => {
    expect(buildReportingResponse(null).message).toMatch(/pas.*récupérer/i);
  });
});
