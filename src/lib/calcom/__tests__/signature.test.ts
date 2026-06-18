import { createHmac } from 'crypto';
import { describe, expect, it } from 'vitest';

import { verifyCalcomSignature } from '@/lib/calcom/signature';

const SECRET = 'whsec_test_secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

describe('verifyCalcomSignature', () => {
  const body = JSON.stringify({ triggerEvent: 'BOOKING_CREATED', payload: { uid: 'abc' } });

  it('accepts a signature computed over the exact raw body', () => {
    expect(verifyCalcomSignature(body, sign(body), SECRET)).toBe(true);
  });

  it('rejects a tampered body (signature no longer matches)', () => {
    const tampered = body.replace('abc', 'xyz');
    expect(verifyCalcomSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it('rejects a signature made with a different secret', () => {
    expect(verifyCalcomSignature(body, sign(body, 'other'), SECRET)).toBe(false);
  });

  it('rejects a missing or empty signature header', () => {
    expect(verifyCalcomSignature(body, null, SECRET)).toBe(false);
    expect(verifyCalcomSignature(body, '', SECRET)).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(verifyCalcomSignature(body, sign(body), '')).toBe(false);
  });

  it('rejects a non-hex / wrong-length signature without throwing', () => {
    expect(verifyCalcomSignature(body, 'not-hex!!', SECRET)).toBe(false);
    expect(verifyCalcomSignature(body, 'deadbeef', SECRET)).toBe(false);
  });
});
