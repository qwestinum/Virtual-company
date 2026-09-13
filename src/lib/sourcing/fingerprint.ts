/**
 * Empreinte d'un profil professionnel public — PUR (hors le HMAC de node).
 * Spec : docs/specs/sourcing.md §7.1.
 *
 * Elle sert à trois choses, toutes sans stocker l'adresse du profil au-delà de
 * sa durée de vie : ne pas remontrer un profil déjà vu, décliné ou contacté ;
 * respecter une opposition sur toutes les campagnes ; retrouver, sur demande
 * d'effacement, les lignes d'un profil désigné par son adresse.
 *
 * ─── SALÉE, JAMAIS NUE ───────────────────────────────────────────────────
 * Une URL de profil est PUBLIQUE : une empreinte SHA-256 nue se retrouve en
 * recalculant celle de l'URL, ce n'est donc pas une pseudonymisation. Le sel
 * vient de `SOURCING_FINGERPRINT_PEPPER` (serveur), même principe que
 * `gdpr_erasure_requests.subject_hash`. Sans lui : refus, jamais de repli.
 *
 * ─── LA NORMALISATION EST LE CONTRAT ─────────────────────────────────────
 * Le moteur rend `https://www.linkedin.com/in/<slug>`, un recruteur colle
 * `fr.linkedin.com/in/<slug>/?originalSubdomain=fr`, une demande d'effacement
 * cite `linkedin.com/in/<Slug>/`. Si ces formes ne donnaient pas la même
 * empreinte, un profil décliné reviendrait et une opposition ne tiendrait pas.
 * Toute évolution de `normalizeProfileUrl` rend les empreintes stockées
 * inopérantes : elle se décide avec une migration des exclusions, jamais seule.
 */
import { createHmac } from 'node:crypto';

export const SOURCING_PEPPER_ENV = 'SOURCING_FINGERPRINT_PEPPER';

export class MissingSourcingPepperError extends Error {
  constructor() {
    super(
      `${SOURCING_PEPPER_ENV} absent : sans sel, l’empreinte d’un profil public se ` +
        'recalcule depuis son adresse et ne protège rien. Refus.',
    );
    this.name = 'MissingSourcingPepperError';
  }
}

/**
 * Forme canonique d'une adresse de profil LinkedIn : `linkedin.com/in/<slug>`,
 * slug décodé et en minuscules. `null` si ce n'est pas une adresse de profil —
 * on ne fabrique jamais une empreinte à partir d'autre chose (une page
 * d'entreprise, une publication), qui désignerait n'importe quoi.
 */
export function normalizeProfileUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0]!.toLowerCase() !== 'in') return null;

  let slug: string;
  try {
    slug = decodeURIComponent(segments[1]!);
  } catch {
    slug = segments[1]!;
  }
  slug = slug.normalize('NFC').toLowerCase().trim();
  if (slug.length === 0) return null;
  return `linkedin.com/in/${slug}`;
}

/** Empreinte hexadécimale (64 caractères) de l'adresse normalisée. */
export function profileFingerprint(normalizedUrl: string, pepper: string | undefined): string {
  if (!pepper || pepper.trim().length === 0) throw new MissingSourcingPepperError();
  return createHmac('sha256', pepper).update(normalizedUrl).digest('hex');
}
