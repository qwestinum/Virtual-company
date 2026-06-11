import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CVApplication } from '@/types/cv-analysis';

const candidates = { upsertVivierCandidate: vi.fn() };
const indexing = { indexVivierCandidate: vi.fn() };

vi.mock('@/lib/vivier/candidates', () => candidates);
vi.mock('@/lib/vivier/indexing', () => indexing);

/** CVApplication minimale : seul `candidate` est lu par l'alimentation. */
function application(
  candidate: Partial<CVApplication['candidate']> = {},
): CVApplication {
  return {
    candidate: {
      fullName: 'Jane Doe',
      email: 'jane@doe.com',
      phone: '0600000000',
      detectedLanguage: 'fr',
      fileName: 'jane.pdf',
      source: 'email',
      receivedAt: '2026-06-01T00:00:00Z',
      rightToWork: null,
      location: null,
      photoPresent: false,
      ...candidate,
    },
    // Le reste n'est pas lu par feedVivierFromApplication.
  } as CVApplication;
}

beforeEach(() => {
  candidates.upsertVivierCandidate.mockReset();
  indexing.indexVivierCandidate.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('feedVivierFromApplication', () => {
  it('candidature avec email ⇒ upsert (source campaign_application) puis indexation', async () => {
    candidates.upsertVivierCandidate.mockResolvedValueOnce({
      candidate: { id: 'uuid-1' },
      created: true,
    });
    indexing.indexVivierCandidate.mockResolvedValueOnce({
      status: 'indexed',
      error: null,
    });

    const { feedVivierFromApplication } = await import(
      '@/lib/vivier/ingest-application'
    );
    const ok = await feedVivierFromApplication({
      application: application(),
      cvText: 'texte du cv',
      cvContent: Buffer.from('pdf'),
      cvMimeType: 'application/pdf',
    });

    expect(ok).toBe(true);
    expect(candidates.upsertVivierCandidate).toHaveBeenCalledTimes(1);
    const arg = candidates.upsertVivierCandidate.mock.calls[0][0];
    expect(arg).toMatchObject({
      email: 'jane@doe.com',
      nom: 'Jane Doe',
      telephone: '0600000000',
      cvFileName: 'jane.pdf',
      cvText: 'texte du cv',
      source: 'campaign_application',
    });
    expect(indexing.indexVivierCandidate).toHaveBeenCalledWith('uuid-1');
  });

  it('email manquant ⇒ ni upsert ni indexation, pas d’exception', async () => {
    const { feedVivierFromApplication } = await import(
      '@/lib/vivier/ingest-application'
    );
    const ok = await feedVivierFromApplication({
      application: application({ email: null }),
      cvText: 'texte',
      cvContent: Buffer.from('pdf'),
    });

    expect(ok).toBe(false);
    expect(candidates.upsertVivierCandidate).not.toHaveBeenCalled();
    expect(indexing.indexVivierCandidate).not.toHaveBeenCalled();
  });

  it('échec d’upsert ⇒ avalé (non bloquant), pas d’exception vers l’appelant', async () => {
    candidates.upsertVivierCandidate.mockRejectedValueOnce(
      new Error('storage down'),
    );

    const { feedVivierFromApplication } = await import(
      '@/lib/vivier/ingest-application'
    );
    const ok = await feedVivierFromApplication({
      application: application(),
      cvText: 'texte',
      cvContent: Buffer.from('pdf'),
    });

    expect(ok).toBe(false);
    expect(indexing.indexVivierCandidate).not.toHaveBeenCalled();
  });

  it('MIME déduit du nom de fichier quand absent', async () => {
    candidates.upsertVivierCandidate.mockResolvedValueOnce({
      candidate: { id: 'uuid-2' },
      created: false,
    });
    indexing.indexVivierCandidate.mockResolvedValueOnce({
      status: 'indexed',
      error: null,
    });

    const { feedVivierFromApplication } = await import(
      '@/lib/vivier/ingest-application'
    );
    await feedVivierFromApplication({
      application: application({ fileName: 'cv.txt' }),
      cvText: 'texte',
      cvContent: Buffer.from('txt'),
      // cvMimeType absent
    });

    expect(candidates.upsertVivierCandidate.mock.calls[0][0].cvMimeType).toBe(
      'text/plain',
    );
  });
});
