/**
 * Jeton nominatif d'une approche — 128 bits, STOCKÉ HACHÉ.
 * Spec : docs/specs/sourcing.md §8.2.
 *
 * Même entropie que les liens de réservation (`scheduling/tokens.ts`), mais à
 * l'inverse d'eux on ne garde que l'empreinte : ce jeton ouvrira des données
 * pré-remplies, et il n'a jamais à être relu. Le recruteur qui veut recopier
 * son message reçoit un NOUVEAU jeton (l'ancien est révoqué tant qu'il n'a pas
 * été ouvert).
 */
import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16;

export function mintApproachToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashApproachToken(token) };
}

export function hashApproachToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function approachUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${token}`;
}
