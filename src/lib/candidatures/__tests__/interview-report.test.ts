/**
 * Compte rendu d'entretien — garde-fous du cœur serveur, mention et gabarit.
 * Spec : docs/specs/compte-rendu-entretien.md §3, §5.7.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { interviewReportMention } from '@/lib/candidatures/interview-report-mention';
import {
  emptySections,
  hasReportContent,
  InterviewReportSectionsSchema,
  reportPlaceholder,
  sectionLabels,
  type InterviewReportSections,
} from '@/types/interview-report';

type JournalCall = { action: string; payload: Record<string, unknown> };
const appendJournalEntry = vi.fn(async (_e: JournalCall) => undefined);
const saveInterviewReport = vi.fn(async (input: Record<string, unknown>) => ({
  status: 'saved' as const,
  report: {
    id: 'ir-1',
    status: input.action === 'verify' ? 'verified' : 'draft',
    source: input.source,
  },
}));
let realized = true;

vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: (e: JournalCall) => appendJournalEntry(e),
}));
vi.mock('@/lib/db/repos/interview-reports', () => ({
  saveInterviewReport: (input: Record<string, unknown>) => saveInterviewReport(input),
  getInterviewReport: vi.fn(async () => null),
}));
vi.mock('@/lib/db/repos/campaigns', () => ({ getCampaign: vi.fn(async () => null) }));
vi.mock('@/lib/reporting/stage-signals', () => ({
  loadStageSignals: vi.fn(async () => ({
    interviewMarks: new Map(realized ? [['uid-1', 'realized']] : []),
  })),
}));

const { saveReportFor } = await import('@/lib/candidatures/interview-report');

const analysis = { id: 'can_1', uid: 'uid-1', campaignId: 'CAMP-2026-001' };
const actor = { userId: 'u-sarah', email: 'sarah@cabinet.fr' };
const filled: InterviewReportSections = {
  version: 2,
  body: 'Parcours en recette bancaire, souhait de mobilité interne.',
};

beforeEach(() => {
  vi.clearAllMocks();
  realized = true;
});

describe('saveReportFor — garde-fous', () => {
  it('pas d’entretien réalisé : rien à rendre compte, rien écrit', async () => {
    realized = false;
    const out = await saveReportFor({ analysis, sections: filled, action: 'draft', actor });
    expect(out).toEqual({ status: 'interview_not_realized' });
    expect(saveInterviewReport).not.toHaveBeenCalled();
  });

  it('valider sans session : refusé (valider, c’est signer)', async () => {
    const out = await saveReportFor({ analysis, sections: filled, action: 'verify', actor: null });
    expect(out).toEqual({ status: 'session_required' });
    expect(saveInterviewReport).not.toHaveBeenCalled();
  });

  it('un champ vide ne se valide pas… mais s’enregistre en brouillon', async () => {
    const empty = emptySections();
    expect(await saveReportFor({ analysis, sections: empty, action: 'verify', actor })).toEqual({
      status: 'empty_report',
    });
    expect((await saveReportFor({ analysis, sections: empty, action: 'draft', actor })).status).toBe('saved');
  });

  it('source MANUELLE par défaut : le client ne peut pas se dire « transcription »', async () => {
    await saveReportFor({ analysis, sections: filled, action: 'verify', actor });
    expect(saveInterviewReport.mock.calls[0]![0]).toMatchObject({ source: 'manual' });
  });

  it('la trace de journal ne porte AUCUNE rubrique', async () => {
    await saveReportFor({ analysis, sections: filled, action: 'verify', actor });
    const entry = appendJournalEntry.mock.calls[0]![0];
    expect(entry.action).toBe('interview_report_saved');
    expect(JSON.stringify(entry)).not.toContain('recette bancaire');
    expect(entry.payload).toMatchObject({ status: 'verified', source: 'manual', reportId: 'ir-1' });
  });
});

describe('champ unique, repères et ancienne forme', () => {
  it('les critères de la campagne sont des REPÈRES dans le texte d’aide, jamais une case', () => {
    const hint = reportPlaceholder([{ criterionId: 'c1', label: 'Anglais' }, { criterionId: 'c2', label: 'Recette' }]);
    expect(hint).toContain('Anglais · Recette');
    expect(hint).toContain('lien direct avec le poste');
  });

  it('hasReportContent : des espaces ne comptent pas', () => {
    expect(hasReportContent(emptySections())).toBe(false);
    expect(hasReportContent({ version: 2, body: '   ' })).toBe(false);
    expect(hasReportContent({ version: 2, body: 'Références à demander' })).toBe(true);
  });

  it('un compte rendu à RUBRIQUES (première forme) reste lisible, converti en texte', () => {
    const legacy = {
      version: 1,
      topics: 'Parcours bancaire.',
      criteria: [
        { criterionId: 'c1', label: 'Anglais', text: '' },
        { criterionId: 'c2', label: 'Recette', text: 'Pilotée de bout en bout.' },
      ],
      highlights: '',
      reservations: 'Mobilité à confirmer.',
      followUps: '',
    };
    expect(InterviewReportSectionsSchema.parse(legacy)).toEqual({
      version: 2,
      body: 'Sujets abordés\nParcours bancaire.\n\nRéponses aux critères de la campagne\n• Recette\nPilotée de bout en bout.\n\nRéserves\nMobilité à confirmer.',
    });
  });

  it('un compte rendu PROPOSÉ ne juge pas : pas de « points forts »', () => {
    const labels = Object.values(sectionLabels('transcript')).join(' ');
    expect(labels).not.toMatch(/points forts/i);
  });
});

describe('interviewReportMention', () => {
  const at = '2026-09-18T10:00:00.000Z';
  it('rédigé à la main', () => {
    expect(
      interviewReportMention({ source: 'manual', status: 'verified', verifiedByEmail: 'sarah@cabinet.fr', verifiedAt: at }),
    ).toBe('Rédigé et validé par sarah@cabinet.fr le 18/09/2026');
  });
  it('établi à partir d’une transcription', () => {
    expect(
      interviewReportMention({ source: 'transcript', status: 'verified', verifiedByEmail: 'sarah@cabinet.fr', verifiedAt: at }),
    ).toBe('Établi à partir d’une transcription, vérifié par sarah@cabinet.fr le 18/09/2026');
  });
  it('brouillon : jamais présenté comme vérifié', () => {
    expect(
      interviewReportMention({ source: 'transcript', status: 'draft', verifiedByEmail: null, verifiedAt: null }),
    ).toMatch(/pas encore vérifié/);
  });
});
