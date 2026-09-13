/**
 * Générateur de requête DÉTERMINISTE — le repli (a). PUR.
 * Spec : docs/specs/sourcing.md §3 (règles mesurées), §3.3 (défauts connus).
 *
 * Il ne sert que lorsque le générateur (b) échoue ou rend une sortie invalide.
 * L'étude l'a mesuré ÉGAL à (b) en pertinence ; ce qui l'a fait passer second
 * est la LISIBILITÉ du champ que le recruteur relit. Ses défauts observés sont
 * donc corrigés ici plutôt qu'acceptés : intitulé brut (« (H/F) »,
 * « Directeur de Département … »), article résiduel (« l'excellence… »),
 * localisation omise quand la fiche ne dit que « Télétravail ».
 */
import type { NotEncodedCriterion, QueryFicheInput } from '@/types/sourcing';

// ─── Amorces retirées d'un libellé (liste FERMÉE, spec §5.3) ──────────────

const AMORCES: RegExp[] = [
  /^(?:une |un )?(?:solide |bonne |excellente |forte )?(?:première )?expériences? (?:confirmée |significative |solide |réussie |avérée |opérationnelle )?(?:de |d['’](?:une? )?|en |du |des |dans (?:le |la |les |l['’])?|avec |sur |sur le |sur la )?(?:la |le |les |l['’])?/i,
  /^(?:parfaite |bonne |excellente )?maîtrise (?:du |de la |de l['’]|des |de |d['’])?/i,
  /^(?:bonne |solide )?connaissances? (?:approfondies? |solides? |opérationnelles? )?(?:du |de la |de l['’]|des |de |d['’]|en )?/i,
  /^(?:solide |forte )?culture (?:de |du |de la |de l['’]|des )?/i,
  /^pratique (?:du |de la |de l['’]|des |de |d['’])?/i,
  /^utilisation (?:du |de la |de l['’]|des |de |d['’])?/i,
  /^compétences? (?:en |sur |dans )?/i,
  /^capacité (?:à |a )/i,
  /^sensibilité (?:aux |à la |à l['’]|au |à )?/i,
  /^expertises? (?:fonctionnelles? |techniques? )?(?:dans (?:le |la |les |l['’])?|en |sur (?:le |la |les )?)?/i,
  /^(?:savoir |aptitude à |goût pour |appétence pour )/i,
];
const SUFFIXES =
  /\s*\(?(?:exigée?s?|requise?s?|souhaitée?s?|obligatoires?|indispensables?|appréciée?s?|un plus|impératif)\)?\.?$/i;
const LEADING_ARTICLE = /^(?:l['’]|le |la |les |un |une |des |du |de |d['’])/i;

export function stripAmorces(label: string): string {
  let s = label.trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    for (const re of AMORCES) s = s.replace(re, '');
    if (s === before) break;
  }
  return s.replace(SUFFIXES, '').replace(LEADING_ARTICLE, '').trim();
}

// ─── Classement des critères ───────────────────────────────────────────────

const ADMIN =
  /autorisation|permis|nationalit|habilitation|disponib|salaire|rémun|contrat|\bcdi\b|\bcdd\b|télétravail|mobilité géographique|déplacements?/i;
const SOFT =
  /leadership|relationnel|communication|autonomie|rigueur|esprit d|capacité à|sens (?:de|du)|synthèse|fédérer|dynamisme|curiosit|adaptabilit|pédagog|interaction|écoute|documentation claire/i;
const GENERIC = /^(?:anglais|langue|pack office|excel|word|git)\b/i;
const YEARS = /(\d{1,2})\s*(?:à|-|–)\s*(\d{1,2})\s*ans|(\d{1,2})\s*\+?\s*ans/i;
const NO_CITY = /télétravail|remote|distanciel|à définir|tbd|hybride|non précisée?/i;

const ENCODED_LEVELS = new Set(['critique', 'tres_important', 'redhibitoire']);
const MAX_SKILLS = 4;

export function cleanJobTitle(raw: string): { title: string; seniority: string | null } {
  let s = raw.replace(/\((?:h\/f|f\/h)\)|\bh\/f\b|\bf\/h\b/gi, '').trim();
  let seniority: string | null = null;
  const m = /\s*[–-]\s*(expérimentée?|confirmée?|senior|junior)\s*$/i.exec(s);
  if (m) {
    seniority = m[1]!.toLowerCase();
    s = s.slice(0, m.index).trim();
  }
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/^directeur de département /i, 'Directeur ').replace(/\s+/g, ' ').trim();
  return { title: s.charAt(0).toUpperCase() + s.slice(1), seniority };
}

/** Ville en clair, ou `null` quand la fiche ne donne pas de lieu (§3.6). */
export function cleanLocation(raw: string | null): string | null {
  const v = raw?.trim();
  if (!v || NO_CITY.test(v)) return null;
  const s = v.replace(/^site (?:principal )?(?:de |d['’])\s*/i, '').replace(/\s*\([^)]*\)/g, '').trim();
  return s.length > 0 ? s : null;
}

export function deterministicQuery(fiche: QueryFicheInput): {
  query: string;
  encoded: string[];
  notEncoded: NotEncodedCriterion[];
} {
  const { title, seniority: fromTitle } = cleanJobTitle(fiche.jobTitle);
  const seniority = fromTitle ?? fiche.seniority?.trim() ?? null;
  const encoded: string[] = [];
  const notEncoded: NotEncodedCriterion[] = [];
  const skills: string[] = [];
  let years: string | null = null;

  for (const c of fiche.criteria) {
    if (!ENCODED_LEVELS.has(c.level)) {
      notEncoded.push({ label: c.label, reason: `niveau ${c.level.replace('_', ' ')}` });
      continue;
    }
    const y = YEARS.exec(c.label);
    if (y) {
      years = y[1] ? `${y[1]} à ${y[2]} ans d'expérience` : `${y[3]} ans d'expérience`;
      encoded.push(c.label);
      continue;
    }
    if (ADMIN.test(c.label)) {
      notEncoded.push({ label: c.label, reason: 'administratif' });
      continue;
    }
    if (SOFT.test(c.label)) {
      notEncoded.push({ label: c.label, reason: 'savoir-être' });
      continue;
    }
    const stripped = stripAmorces(c.label);
    if (GENERIC.test(stripped)) {
      notEncoded.push({ label: c.label, reason: 'compétence générique' });
      continue;
    }
    if (skills.length >= MAX_SKILLS) {
      notEncoded.push({ label: c.label, reason: 'au-delà de 4 compétences' });
      continue;
    }
    // Mots-clés : deux au plus, sans doublon de mot (« Node.js ou Node » est un défaut observé).
    const kept: string[] = [];
    for (const k of c.keywords ?? []) {
      const words = new Set(k.toLowerCase().split(/[\s.]+/).filter(Boolean));
      if (kept.some((x) => x.toLowerCase().split(/[\s.]+/).some((t) => words.has(t)))) continue;
      kept.push(k.trim());
      if (kept.length === 2) break;
    }
    const phrase = kept.length > 0
      ? kept.join(' ou ')
      : stripped.replace(/\s+ou d['’](?:une?|la|le)\s+/gi, ' ou ').split(/\s+/).slice(0, 8).join(' ');
    skills.push(phrase);
    encoded.push(c.label);
  }

  const location = cleanLocation(fiche.location);
  const head = `${title}${seniority ? ` ${seniority}` : ''}${years ? `, ${years}` : ''}`;
  const parts = [head, ...skills, location ? `basé à ${location}` : 'basé en France'];
  return { query: parts.join(', '), encoded, notEncoded };
}
