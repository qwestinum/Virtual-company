/**
 * Vérification de la signature des webhooks Cal.com (juin 2026).
 *
 * Cal.com signe le corps brut avec HMAC-SHA256(secret) et place le hash hex
 * dans le header `x-cal-signature-256`. On RECALCULE le hash sur le corps brut
 * REÇU (jamais sur un JSON re-sérialisé : la moindre différence d'octet
 * casserait la comparaison) et on compare en temps constant.
 *
 * Sans signature valide, la requête est rejetée — sinon une requête forgée
 * pourrait déclencher l'envoi d'un CV.
 */

import { createHmac, timingSafeEqual } from 'crypto';

export const CALCOM_SIGNATURE_HEADER = 'x-cal-signature-256';

export function verifyCalcomSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  let receivedBuf: Buffer;
  try {
    receivedBuf = Buffer.from(signatureHeader.trim(), 'hex');
  } catch {
    return false;
  }
  // timingSafeEqual exige des longueurs égales — sinon comparaison impossible.
  if (expectedBuf.length === 0 || expectedBuf.length !== receivedBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, receivedBuf);
}
