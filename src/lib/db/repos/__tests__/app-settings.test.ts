import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/supabase-server', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/db/supabase-server')
  >('@/lib/db/supabase-server');
  return { ...actual, requireServerSupabase: vi.fn() };
});

import {
  getAppSettings,
  getResendApiKeyFromSettings,
  patchAppSettings,
} from '@/lib/db/repos/app-settings';
import { requireServerSupabase } from '@/lib/db/supabase-server';

const mock = vi.mocked(requireServerSupabase);

/** Row minimale (colonnes non testées laissées par défaut). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    synthesis_email: null,
    synthesis_emails: [],
    sender_email: null,
    sender_emails: [],
    intake_email: null,
    flux_config: {},
    channels_config: {},
    hitl_config: null,
    vivier_config: null,
    interview_config: null,
    resend_api_key: null,
    updated_at: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => mock.mockReset());

describe('app-settings — clé Resend write-only', () => {
  it('getAppSettings expose `resendApiKeyConfigured` mais JAMAIS la valeur brute', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: row({ resend_api_key: 're_secret_xyz' }), error: null });
    mock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    } as never);

    const settings = await getAppSettings();
    expect(settings?.resendApiKeyConfigured).toBe(true);
    // Garde-fou anti-fuite : la valeur brute ne doit apparaître nulle part.
    expect(JSON.stringify(settings)).not.toContain('re_secret_xyz');
    expect('resendApiKey' in (settings as object)).toBe(false);
  });

  it('resendApiKeyConfigured = false quand la colonne est vide', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: row({ resend_api_key: '' }), error: null });
    mock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    } as never);
    expect((await getAppSettings())?.resendApiKeyConfigured).toBe(false);
  });

  it('patchAppSettings écrit la colonne (valeur posée, `\'\'` efface)', async () => {
    const update = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: vi.fn().mockResolvedValue({ data: row(), error: null }),
        }),
      }),
    });
    mock.mockReturnValue({ from: () => ({ update }) } as never);

    await patchAppSettings({ resendApiKey: 're_new_key' });
    expect(update.mock.calls[0]![0]).toMatchObject({ resend_api_key: 're_new_key' });

    update.mockClear();
    await patchAppSettings({ resendApiKey: '' });
    expect(update.mock.calls[0]![0]).toMatchObject({ resend_api_key: null });
  });

  it('getResendApiKeyFromSettings renvoie la valeur brute (lecture serveur dédiée)', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { resend_api_key: 're_secret_xyz' }, error: null });
    mock.mockReturnValue({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }),
    } as never);
    expect(await getResendApiKeyFromSettings()).toBe('re_secret_xyz');
  });
});
