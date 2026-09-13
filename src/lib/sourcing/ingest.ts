/**
 * Ingestion d'un résultat du moteur de profils — PUR.
 * Spec : docs/specs/sourcing.md §7.3.
 *
 * ─── LE POINT DE COUPE UNIQUE ────────────────────────────────────────────
 * `keepAllowedSections` est appelé EN TÊTE, et c'est la seule fonction qui
 * reçoit le texte brut. Tout le reste — projection, et au lot 3 disponibilité,
 * mentions, email du titulaire — ne reçoit que son résultat.
 *
 * Pourquoi c'est le garde-fou le plus important de l'ingestion : la section
 * `## Social` (56 profils sur 306 à l'étude) est faite de publications et de
 * REPUBLICATIONS de tiers — opinions, santé, religion observées. Un « je
 * recherche un poste » republié y est la phrase de quelqu'un d'autre.
 *
 * LISTE BLANCHE, jamais liste noire : une section que le moteur ajoutera
 * demain est coupée par défaut. Ce qu'on garde se décide ; ce qu'on jette n'a
 * pas à être prévu.
 * ─────────────────────────────────────────────────────────────────────────
 */
import type { ExaResult } from '@/lib/sourcing/exa-schema';
import { normalizeProfileUrl } from '@/lib/sourcing/fingerprint';
import type { ExaSnapshot } from '@/types/sourcing';

const ALLOWED_SECTIONS = {
  about: 'About',
  experience: 'Experience',
  education: 'Education',
  skills: 'Skills',
  languages: 'Languages',
  certifications: 'Licenses & Certifications',
} as const;

export type AllowedSectionKey = keyof typeof ALLOWED_SECTIONS;

export type AllowedText = {
  /** Lignes d'en-tête après le nom (titre de profil) — la ligne du nom n'est jamais lue. */
  headline: string | null;
  sections: Partial<Record<AllowedSectionKey, string>>;
  /** Le seul texte que l'aval a le droit de lire. */
  text: string;
};

const HEADING_TO_KEY = new Map<string, AllowedSectionKey>(
  (Object.entries(ALLOWED_SECTIONS) as [AllowedSectionKey, string][]).map(([k, h]) => [
    h.toLowerCase(),
    k,
  ]),
);

export function keepAllowedSections(raw: string | null | undefined): AllowedText {
  const source = (raw ?? '').replace(/\r\n?/g, '\n');
  const firstSection = source.search(/^## /m);
  const header = firstSection === -1 ? source : source.slice(0, firstSection);
  const body = firstSection === -1 ? '' : source.slice(firstSection);

  const headline =
    header
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'))
      .slice(0, 2)
      .join(' · ') || null;

  const sections: Partial<Record<AllowedSectionKey, string>> = {};
  for (const chunk of body.split(/\n(?=## )/)) {
    const m = /^## (.+)\n?([\s\S]*)$/.exec(chunk.trim());
    if (!m) continue;
    const key = HEADING_TO_KEY.get(m[1]!.trim().toLowerCase());
    if (!key) continue; // Social, Recommendations, et tout ce qui n'est pas décidé
    const content = m[2]!.trim();
    if (content) sections[key] = content;
  }

  const text = [
    headline ?? '',
    ...(Object.entries(sections) as [AllowedSectionKey, string][]).map(
      ([k, v]) => `## ${ALLOWED_SECTIONS[k]}\n${v}`,
    ),
  ]
    .filter(Boolean)
    .join('\n\n');

  return { headline, sections, text };
}

// ─── Coordonnées : retirées en attendant la règle du titulaire (lot 3) ─────

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /(?:\+\d{2,3}[\s.-]?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g;

/**
 * Aucune adresse ni aucun numéro n'entre en base au lot 2. L'email attribuable
 * au titulaire sera extrait au lot 3 par une règle dédiée (§6), AVANT ce
 * retrait ; les autres — tiers, adresses fonctionnelles, doute — ne le seront
 * jamais.
 */
export function redactContacts(value: string): string {
  return value.replace(EMAIL, '[adresse retirée]').replace(PHONE, '[numéro retiré]');
}

// ─── Projection ────────────────────────────────────────────────────────────

const LIMITS = { about: 2000, skills: 800, languages: 400, certifications: 600, highlight: 500 };

const clip = (v: string | null | undefined, max: number): string | null => {
  const t = v?.trim();
  if (!t) return null;
  const clean = redactContacts(t);
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const collapse = (v: string): string =>
  v.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * L'extrait « le plus proche de la requête » est choisi par le moteur sur le
 * texte COMPLET du profil — donc aussi dans la section Social, et au-delà de
 * ce qu'il nous a transmis. Il arrive en plusieurs FRAGMENTS reliés par `...`.
 *
 * Règle : un fragment n'est gardé que s'il se retrouve dans le texte AUTORISÉ.
 * Un fragment introuvable est jeté, qu'il vienne d'une section exclue ou d'une
 * partie non transmise : on ne peut pas prouver qu'il n'est pas la phrase d'un
 * tiers. Mesuré sur 306 profils : aucun extrait entier retrouvé seulement dans
 * Social ; 124 extraits portaient sur du texte non transmis.
 */
export function keepHighlightIfAllowed(highlight: string | null | undefined, allowed: string): string | null {
  const h = highlight?.trim();
  if (!h) return null;
  const haystack = collapse(allowed);
  const kept = h
    .split(/\n?\s*(?:\.\.\.|…)\s*\n?/)
    .map((f) => f.replace(/^#+\s*/gm, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim())
    .filter((f) => f.length >= 20 && haystack.includes(f.toLowerCase()));
  return kept.length > 0 ? kept.join(' … ') : null;
}

/** `null` si le résultat n'est pas un profil exploitable (pas d'adresse de profil, pas de nom). */
export function projectExaResult(result: ExaResult): ExaSnapshot | null {
  const normalized = normalizeProfileUrl(result.url);
  if (!normalized) return null;

  const props = result.entities?.[0]?.properties ?? null;
  const name = (props?.name ?? result.title ?? '').trim();
  if (!name) return null;

  const allowed = keepAllowedSections(result.text);

  const workHistory = (props?.workHistory ?? [])
    .filter((w) => (w.title ?? '').trim().length > 0)
    .map((w) => ({
      title: w.title!.trim(),
      company: w.company?.name?.trim() || null,
      location: w.location?.trim() || null,
      from: w.dates?.from ?? null,
      to: w.dates?.to ?? null,
    }));
  const current = workHistory.find((w) => w.to === null) ?? workHistory[0] ?? null;

  return {
    url: `https://www.${normalized}`,
    name,
    firstName: props?.firstName?.trim() || null,
    location: props?.location?.trim() || null,
    headline: clip(allowed.headline, 300),
    current: current ? { title: current.title, company: current.company, since: current.from } : null,
    workHistory,
    education: (props?.educationHistory ?? []).map((e) => ({
      degree: e.degree?.trim() || null,
      institution: e.institution?.name?.trim() || null,
      from: e.dates?.from ?? null,
      to: e.dates?.to ?? null,
    })),
    about: clip(allowed.sections.about, LIMITS.about),
    skills: clip(allowed.sections.skills, LIMITS.skills),
    languages: clip(allowed.sections.languages, LIMITS.languages),
    certifications: clip(allowed.sections.certifications, LIMITS.certifications),
    highlight: clip(keepHighlightIfAllowed(result.highlights?.[0], allowed.text), LIMITS.highlight),
    indexedAt: result.publishedDate ?? null,
  };
}
