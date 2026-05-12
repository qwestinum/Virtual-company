import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('getEmailClient', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('returns null when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY;
    const mod = await import('@/lib/email/client');
    expect(mod.getEmailClient()).toBeNull();
  });

  it('returns a client when RESEND_API_KEY is set', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'no-reply@example.com';
    process.env.EMAIL_DRH = 'drh@example.com';
    const mod = await import('@/lib/email/client');
    const client = mod.getEmailClient();
    expect(client).not.toBeNull();
    expect(client?.from).toBe('no-reply@example.com');
    expect(client?.drhAddress).toBe('drh@example.com');
  });

  it('falls back to onboarding@resend.dev when EMAIL_FROM missing', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    delete process.env.EMAIL_FROM;
    delete process.env.EMAIL_DRH;
    const mod = await import('@/lib/email/client');
    const client = mod.getEmailClient();
    expect(client?.from).toBe('onboarding@resend.dev');
    expect(client?.drhAddress).toBeNull();
  });

  it('sendEmail returns email_not_configured when no key', async () => {
    delete process.env.RESEND_API_KEY;
    const mod = await import('@/lib/email/client');
    const result = await mod.sendEmail({
      to: 'a@example.com',
      subject: 'x',
      html: '<p>x</p>',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('email_not_configured');
  });

  it('requireEmailClient throws when not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const mod = await import('@/lib/email/client');
    expect(() => mod.requireEmailClient()).toThrow(mod.EmailNotConfiguredError);
  });
});
