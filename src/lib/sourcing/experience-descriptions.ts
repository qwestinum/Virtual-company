/**
 * Descriptions de poste lues dans la section `## Experience` — PUR.
 * Spec : docs/specs/sourcing.md §7.3 (amendement du 14/09/2026 : CV enrichi).
 *
 * Structure observée (étude, 306 profils) :
 *
 *   ### Intitulé - [Entreprise](lien) (Current)       ← un poste
 *   ### [Entreprise](lien)                             ← un groupe…
 *   #### Intitulé (Current)                            ← …et ses postes
 *   Dec 2024 - Present (1 year) in Paris, France       ← dates [ + lieu ]
 *   Paris, France                                      ← lieu répété (parfois)
 *   <texte écrit par la personne>                      ← CE QU'ON GARDE
 *   Department: Finance & Accounting • Level: Senior   ← ajout du moteur
 *   <Entreprise> is a Banking company. …               ← ajout du moteur
 *
 * On ne garde QUE le texte de la personne : ce qui suit « Department: » et la
 * fiche d'entreprise sont des enrichissements du moteur, pas son parcours — les
 * mettre dans un CV qu'elle confirme lui ferait signer la phrase d'un tiers.
 * Reçoit le texte DÉJÀ coupé aux sections autorisées (`keepAllowedSections`).
 */

export type ParsedExperience = { title: string; company: string | null; description: string | null };

const DESCRIPTION_MAX = 1200;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const DATES = /^(?:[A-Za-zéû.]{3,9}\s+)?\d{4}\s*[-–]\s*(?:present|aujourd|(?:[A-Za-zéû.]{3,9}\s+)?\d{4})/i;
/**
 * Fiche d'organisme rédigée par le moteur. Mesuré sur 150 profils : elle ne dit
 * pas toujours « company » (université, agence publique…), mais porte toujours
 * l'effectif « has 3,000-4,000 employees » ou le siège « Headquartered in ».
 */
const ENGINE_COMPANY_BLURB = /\bis an? [^.]{0,80}\b(?:company|organization|agency|institution|university|school|nonprofit)\b|\bhas [\d,]+(?:-[\d,]+)?\+? employees\b|\bHeadquartered in\b/i;
/** Ligne d'enrichissement « Department: X • Level: Y » — pas une phrase de la personne. */
const ENGINE_DEPARTMENT_LINE = /^department:\s[^.]{0,80}(?:•\s*level:.*)?$/i;

const unlink = (s: string): string => s.replace(LINK, '$1');
const stripCurrent = (s: string): string => s.replace(/\s*\((?:current|actuel)\)\s*$/i, '').trim();

function headingToEntry(line: string, group: string | null): { entry: ParsedExperience | null; group: string | null } {
  const level4 = line.startsWith('#### ');
  const body = line.replace(/^#{3,4}\s+/, '').trim();
  if (level4) return { entry: { title: stripCurrent(unlink(body)), company: group, description: null }, group };
  // « ### [Entreprise](lien) » seul : un groupe, ses postes suivent en ####.
  if (/^\[[^\]]*\]\([^)]*\)\s*(?:\((?:current|actuel)\))?$/i.test(body)) return { entry: null, group: stripCurrent(unlink(body)) };
  const split = body.match(/^(.*?)\s+-\s+(\[[^\]]*\]\([^)]*\).*)$/);
  if (split) return { entry: { title: stripCurrent(unlink(split[1]!)), company: stripCurrent(unlink(split[2]!)), description: null }, group: null };
  return { entry: { title: stripCurrent(unlink(body)), company: null, description: null }, group: null };
}

function descriptionOf(paragraphs: string[]): string | null {
  const kept: string[] = [];
  let place: string | null = null;
  for (const [i, p] of paragraphs.entries()) {
    if (ENGINE_DEPARTMENT_LINE.test(p)) break; // tout ce qui suit vient du moteur
    if (i === 0 && DATES.test(p)) {
      place = p.match(/\bin\s+(.+)$/i)?.[1]?.trim() ?? null;
      continue;
    }
    if (place && p === place) continue;
    if (ENGINE_COMPANY_BLURB.test(p)) continue;
    kept.push(unlink(p));
  }
  const text = kept.join('\n').trim();
  if (!text) return null;
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…` : text;
}

export function parseExperienceSection(section: string | null | undefined): ParsedExperience[] {
  if (!section) return [];
  const out: ParsedExperience[] = [];
  let group: string | null = null;
  let current: ParsedExperience | null = null;
  let lines: string[] = [];

  const flush = () => {
    if (current) {
      const paragraphs = lines.join('\n').split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
      out.push({ ...current, description: descriptionOf(paragraphs) });
    }
    lines = [];
  };

  for (const line of section.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^#{3,4}\s/.test(line)) {
      flush();
      const next = headingToEntry(line, group);
      group = next.group;
      current = next.entry;
      continue;
    }
    if (/^##\s/.test(line)) continue;
    lines.push(line);
  }
  flush();
  return out;
}

const norm = (s: string | null): string =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Rattache chaque description au poste structuré du même intitulé (et de la
 * même entreprise quand les deux la portent), dans l'ordre, sans réemploi.
 * Un poste sans correspondance n'a pas de description — jamais une devinette.
 */
export function attachDescriptions<T extends { title: string; company: string | null }>(
  workHistory: T[],
  parsed: ParsedExperience[],
): (T & { description: string | null })[] {
  const used = new Set<number>();
  return workHistory.map((w) => {
    const idx = parsed.findIndex(
      (p, i) =>
        !used.has(i) &&
        norm(p.title) === norm(w.title) &&
        (!p.company || !w.company || norm(p.company).includes(norm(w.company)) || norm(w.company).includes(norm(p.company))),
    );
    if (idx === -1) return { ...w, description: null };
    used.add(idx);
    return { ...w, description: parsed[idx]!.description };
  });
}
