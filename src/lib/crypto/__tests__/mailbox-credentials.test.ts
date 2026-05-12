import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  decryptCredential,
  encryptCredential,
  MailboxCryptoError,
} from '@/lib/crypto/mailbox-credentials';

const VALID_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('mailbox credentials crypto', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.MAILBOX_ENCRYPTION_KEY = VALID_KEY;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('round-trips a plaintext', () => {
    const plaintext = 'super-secret-imap-password';
    const blob = encryptCredential(plaintext);
    expect(blob.split(':')).toHaveLength(3);
    expect(decryptCredential(blob)).toBe(plaintext);
  });

  it('produces a different ciphertext for each call (random IV)', () => {
    const a = encryptCredential('same');
    const b = encryptCredential('same');
    expect(a).not.toBe(b);
    expect(decryptCredential(a)).toBe('same');
    expect(decryptCredential(b)).toBe('same');
  });

  it('encrypt throws when master key is missing', () => {
    delete process.env.MAILBOX_ENCRYPTION_KEY;
    expect(() => encryptCredential('x')).toThrow(MailboxCryptoError);
  });

  it('encrypt throws when master key is wrong length', () => {
    process.env.MAILBOX_ENCRYPTION_KEY = 'abcdef'; // 6 chars, way too short
    expect(() => encryptCredential('x')).toThrow(/32 bytes/);
  });

  it('encrypt throws when master key is not hex', () => {
    process.env.MAILBOX_ENCRYPTION_KEY = 'z'.repeat(64);
    expect(() => encryptCredential('x')).toThrow(/hex/);
  });

  it('decrypt throws on malformed blob', () => {
    expect(() => decryptCredential('not-a-valid-blob')).toThrow(
      /invalid_blob_format|3 parts/i,
    );
  });

  it('decrypt throws MailboxCryptoError when ciphertext was tampered', () => {
    const blob = encryptCredential('original');
    const parts = blob.split(':');
    parts[2] = Buffer.from('tampered-data').toString('base64');
    const tampered = parts.join(':');
    try {
      decryptCredential(tampered);
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MailboxCryptoError);
      expect((err as MailboxCryptoError).code).toBe('decryption_failed');
    }
  });

  it('decrypt throws MailboxCryptoError when master key changed', () => {
    const blob = encryptCredential('secret');
    process.env.MAILBOX_ENCRYPTION_KEY = 'f'.repeat(64);
    try {
      decryptCredential(blob);
      throw new Error('Expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(MailboxCryptoError);
      expect((err as MailboxCryptoError).code).toBe('decryption_failed');
    }
  });
});
