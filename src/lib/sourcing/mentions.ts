/**
 * Mentions — mots de la fiche retrouvés dans le profil. PUR.
 * Spec : docs/specs/sourcing.md §5.
 *
 * Un INDICE DE LECTURE, jamais un verdict : pas de négatif (un mot absent ne
 * prouve rien), pas de compteur, aucun effet sur l'ordre. Un critère dont le
 * libellé ne donne aucun terme court le DIT (« pas de mention ») plutôt que de
 * se taire.
 */
import { stripAmorces } from '@/lib/sourcing/query-deterministic';
import type { ExaSnapshot } from '@/types/sourcing';

export type CriterionMention = {
  criterionId: string;
  label: string;
  /** Termes cherchés ; vide ⇒ critère rédigé en phrase, aucune mention possible. */
  terms: string[];
  found: string[];
};

const STOP = /^(?:un|une|le|la|les|l'|d'|de|du|des|et|ou|en|à|au|aux|majeur|majeure|complexes?|confirmée?|solide|bonne)$/i;
const DURATION = /\b\d+\s*(?:\+|à|-)?\s*\d*\s*ans\b/i;
const VERB_START = /^(?:piloter|définir|élaborer|assurer|structurer|cadrer|mettre|conduire|manager|gérer|animer|superviser|accompagner|développer|concevoir)\b/i;

const fold = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’]/g, "'").toLowerCase();

/** Découpe un libellé en termes courts (1 à 4 mots). */
export function atomizeLabel(label: string): string[] {
  if (DURATION.test(label)) return [];
  const s = stripAmorces(label).replace(/\([^)]*\)/g, (m) => `,${m.slice(1, -1)},`);
  return s
    .split(/\s*(?:,|;|\/|\bet\b|\bou\b)\s*/i)
    .map((t) => stripAmorces(t.trim()).replace(/^(?:d['’]|l['’]|une? |les? |la |des? |du )+/i, '').trim())
    .filter((t) => t.length >= 2 && !STOP.test(t) && !VERB_START.test(t) && t.split(/\s+/).length <= 4)
    .filter((t) => t.length > 3 || t === t.toUpperCase());
}

function termRegex(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Acronyme court (UX, SQL, CIS) : sensible à la casse — « Prince » n'est pas « prince ».
  const short = term.length <= 3;
  return new RegExp(`(?<![\\p{L}\\p{N}_])${short ? escaped : fold(escaped)}(?![\\p{L}\\p{N}_])`, 'u');
}

function searchableText(s: ExaSnapshot): { folded: string; raw: string } {
  const raw = [
    s.headline,
    s.about,
    s.skills,
    s.languages,
    s.certifications,
    ...s.workHistory.flatMap((w) => [w.title, w.company]),
    ...s.education.flatMap((e) => [e.degree, e.institution]),
  ]
    .filter(Boolean)
    .join('\n');
  return { raw, folded: fold(raw) };
}

export function computeMentions(
  snapshot: ExaSnapshot,
  criteria: { id: string; label: string; level: string; keywords?: string[] }[],
): CriterionMention[] {
  const text = searchableText(snapshot);
  return criteria
    .filter((c) => c.level === 'critique' || c.level === 'tres_important')
    .map((c) => {
      const terms = (c.keywords?.length ? c.keywords : atomizeLabel(c.label)).map((t) => t.trim()).filter(Boolean);
      const found = terms.filter((t) => termRegex(t).test(t.length <= 3 ? text.raw : text.folded));
      return { criterionId: c.id, label: c.label, terms, found: [...new Set(found)] };
    });
}
