import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getServerSupabase', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns null when SUPABASE env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mod = await import('@/lib/db/supabase-server');
    expect(mod.getServerSupabase()).toBeNull();
  });

  it('requireServerSupabase throws SupabaseNotConfiguredError when missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const mod = await import('@/lib/db/supabase-server');
    expect(() => mod.requireServerSupabase()).toThrow(
      mod.SupabaseNotConfiguredError,
    );
  });

  it('returns a client when both env vars are present', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    const mod = await import('@/lib/db/supabase-server');
    const client = mod.getServerSupabase();
    expect(client).not.toBeNull();
    // Sanity check that subsequent calls return the cached instance.
    expect(mod.getServerSupabase()).toBe(client);
  });
});
