import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return {
    ...actual,
    requireServerSupabase: vi.fn(),
  };
});

import { requireServerSupabase } from '@/lib/db/supabase-server';
import { ARTIFACTS_BUCKET, uploadArtifact } from '@/lib/storage/blob';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

function mockSupabaseStorage(args: {
  uploadError?: { message: string } | null;
  publicUrl?: string;
}): {
  upload: ReturnType<typeof vi.fn>;
  getPublicUrl: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
} {
  const upload = vi
    .fn()
    .mockResolvedValue({ data: null, error: args.uploadError ?? null });
  const getPublicUrl = vi.fn().mockReturnValue({
    data: { publicUrl: args.publicUrl ?? 'https://example.com/storage/x' },
  });
  const from = vi.fn().mockReturnValue({ upload, getPublicUrl });
  requireServerSupabaseMock.mockReturnValue({
    storage: { from },
  } as never);
  return { upload, getPublicUrl, from };
}

describe('uploadArtifact', () => {
  beforeEach(() => {
    requireServerSupabaseMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads to campagnes/<id>/<name> with the right MIME type', async () => {
    const { upload, getPublicUrl, from } = mockSupabaseStorage({
      publicUrl: 'https://example.com/storage/campagnes/CAMP-1/fdp.md',
    });

    const result = await uploadArtifact({
      owner: { kind: 'campaign', id: 'CAMP-1' },
      name: 'fdp.md',
      content: '# FDP\n',
    });

    expect(from).toHaveBeenCalledWith(ARTIFACTS_BUCKET);
    expect(upload).toHaveBeenCalledWith(
      'campagnes/CAMP-1/fdp.md',
      '# FDP\n',
      expect.objectContaining({
        contentType: 'text/markdown; charset=utf-8',
        upsert: true,
      }),
    );
    expect(getPublicUrl).toHaveBeenCalledWith('campagnes/CAMP-1/fdp.md');
    expect(result).toEqual({
      bucket: ARTIFACTS_BUCKET,
      path: 'campagnes/CAMP-1/fdp.md',
      publicUrl: 'https://example.com/storage/campagnes/CAMP-1/fdp.md',
    });
  });

  it('uploads tasks under tasks/<id>/<name>', async () => {
    const { upload } = mockSupabaseStorage({});
    await uploadArtifact({
      owner: { kind: 'task', id: 'TASK-1' },
      name: 'rapport.md',
      content: 'rapport',
    });
    expect(upload.mock.calls[0]![0]!).toBe('tasks/TASK-1/rapport.md');
  });

  it('ajoute charset=utf-8 aux mimeType texte', async () => {
    const { upload } = mockSupabaseStorage({});
    await uploadArtifact({
      owner: { kind: 'campaign', id: 'CAMP-1' },
      name: 'rapport.txt',
      content: 'plain',
      mimeType: 'text/plain',
    });
    expect(upload.mock.calls[0]![2]!.contentType).toBe('text/plain; charset=utf-8');
  });

  it('laisse les mimeType non-texte inchangés (pas de charset)', async () => {
    const { upload } = mockSupabaseStorage({});
    await uploadArtifact({
      owner: { kind: 'campaign', id: 'CAMP-1' },
      name: 'doc.pdf',
      content: 'binaire',
      mimeType: 'application/pdf',
    });
    expect(upload.mock.calls[0]![2]!.contentType).toBe('application/pdf');
  });

  it('throws when Storage returns an error', async () => {
    mockSupabaseStorage({ uploadError: { message: 'Bucket not found' } });
    await expect(
      uploadArtifact({
        owner: { kind: 'campaign', id: 'CAMP-1' },
        name: 'x.md',
        content: 'x',
      }),
    ).rejects.toThrow(/uploadArtifact: Bucket not found/);
  });
});
