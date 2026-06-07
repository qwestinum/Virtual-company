import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return { ...actual, requireServerSupabase: vi.fn() };
});

import { getAppSettings, patchAppSettings } from '@/lib/db/repos/app-settings';
import { requireServerSupabase } from '@/lib/db/supabase-server';
import { DEFAULT_HITL_CONFIG } from '@/types/hitl';

const requireServerSupabaseMock = vi.mocked(requireServerSupabase);

const BASE_ROW = {
  id: 1,
  synthesis_email: null,
  synthesis_emails: null,
  sender_email: null,
  sender_emails: null,
  intake_email: null,
  flux_config: {},
  channels_config: {},
  updated_at: '2026-06-08T00:00:00Z',
};

describe('app-settings — hitlConfig', () => {
  beforeEach(() => requireServerSupabaseMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it('row sans hitl_config → défaut ON', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { ...BASE_ROW, hitl_config: null }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const settings = await getAppSettings();
    expect(settings?.hitlConfig).toEqual(DEFAULT_HITL_CONFIG);
    expect(settings?.hitlConfig.rejectionMail).toBe(true);
  });

  it('patch écrit hitl_config', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        ...BASE_ROW,
        hitl_config: { rejectionMail: false, acceptanceMail: true },
      },
      error: null,
    });
    const selectAfter = vi.fn().mockReturnValue({ single });
    const eq = vi.fn().mockReturnValue({ select: selectAfter });
    const update = vi.fn().mockReturnValue({ eq });
    requireServerSupabaseMock.mockReturnValue({
      from: vi.fn().mockReturnValue({ update }),
    } as never);

    const next = await patchAppSettings({
      hitlConfig: { rejectionMail: false, acceptanceMail: true },
    });
    expect(update).toHaveBeenCalledWith({
      hitl_config: { rejectionMail: false, acceptanceMail: true },
    });
    expect(next.hitlConfig).toEqual({
      rejectionMail: false,
      acceptanceMail: true,
    });
  });
});
