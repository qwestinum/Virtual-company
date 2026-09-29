/**
 * Empreinte du texte d'un CV — CONTRAT (import initial du vivier).
 *
 * Second critère de dédoublonnage après l'adresse, et clé de REPRISE de
 * `npm run vivier:import` : un fichier dont l'empreinte est déjà en base est
 * sauté AVANT tout appel au modèle. La valeur est stockée
 * (`vivier_candidates.cv_fingerprint`) : changer la normalisation rendrait
 * les empreintes stockées inopérantes — d'où le préfixe de version, qu'une
 * évolution incrémente au lieu de réécrire.
 *
 * Normalisation : Unicode NFKD, diacritiques retirés, minuscules, caractères
 * invisibles retirés, toute suite d'espaces (sauts de ligne compris) réduite à
 * une espace. Deux exports du même CV qui ne diffèrent que par la mise en page
 * du texte extrait ont la même empreinte ; deux CV qui diffèrent d'un mot, non.
 */

import { createHash } from 'node:crypto';

export const FINGERPRINT_VERSION = 'v1';

export function normalizeCvTextForFingerprint(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[​-‍⁠﻿­]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Empreinte versionnée, ou null pour un texte vide après normalisation. */
export function cvTextFingerprint(text: string): string | null {
  const normalized = normalizeCvTextForFingerprint(text);
  if (!normalized) return null;
  const hex = createHash('sha256').update(normalized, 'utf8').digest('hex');
  return `${FINGERPRINT_VERSION}:${hex}`;
}
