/**
 * « Un mail = une candidature » (incident Malaka 30/07/2026) — gate
 * `skipIfNotCv` de `processEmailAttachment` :
 *
 *  - PJ classée non-CV (`isCv: false`) + skip actif → `not_a_cv`, RIEN n'est
 *    persisté (pas de ligne « Candidat anonyme » qui occuperait l'id
 *    `can_imap_<mailbox>_<uid>` insert-only et jetterait l'analyse du vrai CV
 *    en `already_exists`), trace journal explicite.
 *  - Même PJ SANS skip (dernier recours / rejeu humain) → voie « Candidat
 *    anonyme » historique : `processed`, analyse persistée.
 *  - PJ reconnue CV → `processed`, quel que soit le flag.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import type { MailboxRow } from '@/lib/db/repos/mailboxes';

vi.mock('@/lib/agents/cv-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/cv-extract')>();
  return { ...actual, extractCVText: vi.fn() };
});
vi.mock('@/lib/agents/server/cv-application-analyze', () => ({
  analyzeCVApplication: vi.fn(),
}));
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/db/repos/candidate-analyses', () => ({
  persistCandidateAnalysisStrict: vi.fn().mockResolvedValue('inserted'),
}));
vi.mock('@/lib/db/repos/artifacts', () => ({
  insertArtifactMeta: vi.fn().mockResolvedValue(undefined),
  upsertArtifactMeta: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/storage/blob', () => ({
  uploadArtifact: vi
    .fn()
    .mockResolvedValue({ bucket: 'artifacts', path: 'p', publicUrl: null }),
  uploadArtifactBinary: vi
    .fn()
    .mockResolvedValue({ bucket: 'artifacts', path: 'p', publicUrl: null }),
  uploadUnmatchedCvBinary: vi
    .fn()
    .mockResolvedValue({ bucket: 'artifacts', path: 'unmatched/p' }),
}));
vi.mock('@/lib/db/repos/imap-unmatched-cvs', () => ({
  insertUnmatchedCv: vi.fn().mockResolvedValue(true),
}));
vi.mock('@/lib/vivier/ingest-application', () => ({
  feedVivierFromApplication: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/vivier/match-application', () => ({
  matchVivierApplication: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/imap/outreach', () => ({
  dispatchImapCandidateOutreach: vi.fn().mockResolvedValue(undefined),
}));

import { extractCVText } from '@/lib/agents/cv-extract';
import { analyzeCVApplication } from '@/lib/agents/server/cv-application-analyze';
import { persistCandidateAnalysisStrict } from '@/lib/db/repos/candidate-analyses';
import { appendJournalEntry } from '@/lib/db/repos/journal';
import { dispatchImapCandidateOutreach } from '@/lib/imap/outreach';
import { processEmailAttachment } from '@/lib/imap/poller';

const MAILBOX = { id: 'mbx-1' } as unknown as MailboxRow;
const CAMPAIGN = {
  id: 'CAMP-0001',
  status: 'active',
  scoringSheet: { isValidated: true },
  thresholdLow: 40,
  thresholdHigh: 70,
  fdp: { fields: { job_title: { value: 'Business Analyst' } } },
} as unknown as ActiveCampaign;

function makeAnalysis(isCv: boolean) {
  return {
    application: {
      candidate: {
        fullName: isCv ? 'Aime Malaka' : 'Candidat anonyme',
        email: isCv ? 'aimeemalaka84@gmail.com' : null,
        phone: null,
        detectedLanguage: 'fr',
        fileName: isCv ? 'Cv_Malaka.pdf' : 'candidature.pdf',
        source: 'email',
        receivedAt: '2026-07-30T22:27:06.667Z',
        rightToWork: null,
        location: null,
        photoPresent: false,
      },
      scoringResult: {
        totalScore: isCv ? 39 : 0,
        status: 'rejected',
        decisionZone: isCv ? 'gray' : 'auto_reject',
        hardFailures: [],
        breakdown: [],
        thresholdLow: 40,
        thresholdHigh: 70,
        computedAt: '2026-07-30T22:27:06.667Z',
      },
      narration: {
        summary: 's',
        strengths: [],
        weaknesses: [],
        justification: 'j',
      },
    },
    isCv,
    metrics: { durationMs: 0, tokensUsed: 0, costEstimate: 0 },
    llmFailures: { candidate: false, ledger: false, narration: false },
  } as unknown as Awaited<ReturnType<typeof analyzeCVApplication>>;
}

function callArgs(overrides: Record<string, unknown> = {}) {
  return {
    mailbox: MAILBOX,
    campaign: CAMPAIGN,
    fileName: 'candidature.pdf',
    mime: 'application/pdf',
    buffer: Buffer.from('pdf'),
    uid: '152',
    subject: 'Candidature offre',
    from: 'relay@candidature.apec.fr',
    matchSource: 'body' as const,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(extractCVText).mockResolvedValue({
    fileName: 'x.pdf',
    text: 'texte extrait du document, assez long pour être exploitable',
    mime: 'application/pdf',
  });
});

describe('processEmailAttachment — sélection « un mail = une candidature »', () => {
  it('PJ non-CV + skipIfNotCv → not_a_cv, rien persisté, trace explicite', async () => {
    vi.mocked(analyzeCVApplication).mockResolvedValue(makeAnalysis(false));

    const outcome = await processEmailAttachment(
      callArgs({ skipIfNotCv: true }),
    );

    expect(outcome).toBe('not_a_cv');
    expect(persistCandidateAnalysisStrict).not.toHaveBeenCalled();
    expect(dispatchImapCandidateOutreach).not.toHaveBeenCalled();
    const actions = vi
      .mocked(appendJournalEntry)
      .mock.calls.map(([entry]) => entry.action);
    expect(actions).toContain('imap_attachment_skipped_non_cv');
  });

  it('PJ non-CV SANS skip (dernier recours) → voie anonyme historique, processed', async () => {
    vi.mocked(analyzeCVApplication).mockResolvedValue(makeAnalysis(false));

    const outcome = await processEmailAttachment(callArgs());

    expect(outcome).toBe('processed');
    expect(persistCandidateAnalysisStrict).toHaveBeenCalledTimes(1);
  });

  it('PJ reconnue CV → processed même avec skipIfNotCv', async () => {
    vi.mocked(analyzeCVApplication).mockResolvedValue(makeAnalysis(true));

    const outcome = await processEmailAttachment(
      callArgs({ fileName: 'Cv_Malaka.pdf', skipIfNotCv: true }),
    );

    expect(outcome).toBe('processed');
    expect(persistCandidateAnalysisStrict).toHaveBeenCalledTimes(1);
  });

  it('fiche non validée → pending_sheet (file C4), quelle que soit la PJ', async () => {
    const campaign = {
      ...CAMPAIGN,
      scoringSheet: { isValidated: false },
    } as unknown as ActiveCampaign;

    const outcome = await processEmailAttachment(
      callArgs({ campaign, skipIfNotCv: true }),
    );

    expect(outcome).toBe('pending_sheet');
    expect(analyzeCVApplication).not.toHaveBeenCalled();
  });
});
