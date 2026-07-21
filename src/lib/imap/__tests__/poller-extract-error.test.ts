/**
 * Incident 07/2026 — un docx illisible partait en retry en boucle et gelait
 * la file : `processEmailAttachment` ré-enveloppait `CVExtractError` dans un
 * `new Error(...)`, détruisant le type AVANT `classifyProcessingError`.
 *
 * Ce test verrouille le dé-wrap : l'erreur d'extraction traverse
 * `processEmailAttachment` EN CONSERVANT son type — le classifieur peut donc
 * router `parse_failed` en PERMANENT (mise de côté immédiate, zéro retry).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';

vi.mock('@/lib/agents/cv-extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agents/cv-extract')>();
  return { ...actual, extractCVText: vi.fn() };
});
vi.mock('@/lib/db/repos/journal', () => ({
  appendJournalEntry: vi.fn().mockResolvedValue(undefined),
}));

import { CVExtractError, extractCVText } from '@/lib/agents/cv-extract';
import { classifyProcessingError } from '@/lib/imap/poll-retry';
import { processEmailAttachment } from '@/lib/imap/poller';
import type { MailboxRow } from '@/lib/db/repos/mailboxes';

const MAILBOX = { id: 'mbx-1' } as unknown as MailboxRow;
const CAMPAIGN = {
  id: 'CAMP-0001',
  status: 'active',
  scoringSheet: { isValidated: true },
} as unknown as ActiveCampaign;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('processEmailAttachment — préservation du type CVExtractError', () => {
  it('un parse_failed (docx illisible) remonte TEL QUEL → classé permanent', async () => {
    const original = new CVExtractError(
      'parse_failed',
      'Could not find the body element: are you sure this is a docx file?',
    );
    vi.mocked(extractCVText).mockRejectedValue(original);

    const promise = processEmailAttachment({
      mailbox: MAILBOX,
      campaign: CAMPAIGN,
      fileName: 'cv.docx',
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from('not-a-docx'),
      uid: '1624',
      subject: 'Candidature CAMP-0001',
      from: 'candidat@example.com',
      matchSource: 'subject',
    });

    // Le TYPE survit (l'ancien wrap `new Error('extract_failed: …')` le
    // détruisait) …
    await expect(promise).rejects.toBe(original);
    // … donc la classification voit un défaut PROUVÉ du document.
    const err = await promise.catch((e) => e);
    expect(classifyProcessingError(err)).toBe('permanent');
  });
});
