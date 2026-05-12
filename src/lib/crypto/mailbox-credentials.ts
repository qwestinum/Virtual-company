/**
 * Chiffrement des credentials IMAP (Session 5 round 5).
 *
 * AES-256-GCM via le module `crypto` natif Node. Master key dans
 * `MAILBOX_ENCRYPTION_KEY` — 32 bytes encodés hex (64 caractères).
 * À générer une seule fois côté op :
 *
 *   openssl rand -hex 32
 *
 * Sans la master key, le ciphertext est inexploitable même avec un
 * accès root à Supabase. C'est le seul rempart entre la table
 * mailboxes et les credentials clairs des serveurs IMAP du DRH.
 *
 * Format du blob retourné par encrypt() : `iv:tag:ciphertext`
 * (tous en base64). Trois champs séparés par `:` pour rendre le
 * parsing trivial et l'inspection humaine possible.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits, recommandé pour GCM
const KEY_LENGTH_BYTES = 32; // AES-256

export class MailboxCryptoError extends Error {
  constructor(
    public readonly code:
      | 'master_key_missing'
      | 'master_key_invalid_length'
      | 'master_key_invalid_hex'
      | 'invalid_blob_format'
      | 'decryption_failed',
    message: string,
  ) {
    super(message);
    this.name = 'MailboxCryptoError';
  }
}

function readMasterKey(): Buffer {
  const hex = process.env.MAILBOX_ENCRYPTION_KEY;
  if (!hex) {
    throw new MailboxCryptoError(
      'master_key_missing',
      'MAILBOX_ENCRYPTION_KEY is not set. Generate one with: openssl rand -hex 32',
    );
  }
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    throw new MailboxCryptoError(
      'master_key_invalid_hex',
      'MAILBOX_ENCRYPTION_KEY is not valid hex.',
    );
  }
  if (hex.length !== KEY_LENGTH_BYTES * 2) {
    throw new MailboxCryptoError(
      'master_key_invalid_length',
      `MAILBOX_ENCRYPTION_KEY must be ${KEY_LENGTH_BYTES} bytes (${KEY_LENGTH_BYTES * 2} hex chars). Got ${hex.length}.`,
    );
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Chiffre un secret texte (mot de passe IMAP). Retourne un blob
 * base64 `iv:tag:ciphertext` stockable dans une colonne text.
 */
export function encryptCredential(plaintext: string): string {
  const key = readMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Déchiffre un blob produit par `encryptCredential`. Si le tag
 * d'authentification échoue (ciphertext modifié, mauvaise clé), lève
 * MailboxCryptoError 'decryption_failed'.
 */
export function decryptCredential(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 3) {
    throw new MailboxCryptoError(
      'invalid_blob_format',
      `Expected 3 parts (iv:tag:ciphertext), got ${parts.length}.`,
    );
  }
  const [ivB64, tagB64, ciphertextB64] = parts as [string, string, string];
  let iv: Buffer;
  let tag: Buffer;
  let ciphertext: Buffer;
  try {
    iv = Buffer.from(ivB64, 'base64');
    tag = Buffer.from(tagB64, 'base64');
    ciphertext = Buffer.from(ciphertextB64, 'base64');
  } catch (err) {
    throw new MailboxCryptoError(
      'invalid_blob_format',
      err instanceof Error ? err.message : 'Invalid base64.',
    );
  }
  const key = readMasterKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString('utf-8');
  } catch (err) {
    throw new MailboxCryptoError(
      'decryption_failed',
      err instanceof Error ? err.message : 'Auth tag mismatch.',
    );
  }
}

/**
 * Helper de test/diagnostic — vérifie que la master key est présente
 * et utilisable. Lève si manquante ou mal formée.
 */
export function assertMailboxCryptoReady(): void {
  readMasterKey();
}
