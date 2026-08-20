/**
 * Jetons d'URL — 128 bits d'entropie, encodés base64url.
 *
 * Deux jetons distincts par réservation, jamais dérivables l'un de l'autre :
 *   - le jeton de LIEN (réserver) ;
 *   - le jeton de GESTION (annuler / replanifier), remis seulement APRÈS la
 *     confirmation.
 * Ils sont l'unique authentification des pages publiques : ni devinables, ni
 * énumérables, et jamais préfixés d'un identifiant lisible.
 */
import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 16; // 128 bits

function base64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function generateToken(): string {
  return base64url(randomBytes(TOKEN_BYTES));
}

/** Forme attendue d'un jeton : 22 caractères base64url (16 octets). */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;

/**
 * Filtre de forme avant toute requête : évite d'aller en base pour une chaîne
 * qui ne peut pas être un jeton (scan d'URL, faute de frappe).
 */
export function isTokenShaped(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}
