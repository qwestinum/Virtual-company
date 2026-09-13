/**
 * Email du TITULAIRE d'un profil public — règle déterministe. PUR.
 * Spec : docs/specs/sourcing.md §6.1 (mesure : 9 trouvés sur 306, 7 retenus).
 *
 * Sections lues : titre de profil et About, écrites par la personne sur
 * elle-même. Dans le doute, on jette : une adresse attribuée à tort ferait
 * écrire à quelqu'un qui n'est pas la personne approchée.
 *
 * Le téléphone n'est PAS extrait (0 sur 306, action hors périmètre — §6.3).
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

const FUNCTIONAL_LOCAL =
  /^(?:contact|info|infos|rh|hr|jobs?|recrutement|recruitment|careers?|hello|bonjour|admin|support|team|equipe|candidatures?|noreply|no-reply)$/i;

const THIRD_PARTY_CUE =
  /(recommand|recommend|manager|colleague|collègue|notre équipe|our team|recruteur|recruiter|candidatures? à|apply at|send (?:your )?cv|envoyez (?:votre )?cv)/i;

const FIRST_PERSON =
  /(contact(?:ez)?[- ]?(?:me|moi)|reach(?:ed)? (?:me|out)|me contacter|me joindre|écrivez[- ]moi|write (?:to )?me|connect with me|email me|e-?mail ?:|📧|✉️|par e-?mail|at\s*$|à l['’]adresse)/i;

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function extractHolderEmails(input: {
  headline: string | null;
  about: string | null;
  firstName: string | null;
  lastName: string | null;
}): string[] {
  const tokens = [input.firstName, input.lastName]
    .map((t) => fold(t ?? '').trim())
    .filter((t) => t.length > 2);
  const kept: string[] = [];
  for (const section of [input.headline, input.about]) {
    if (!section) continue;
    for (const m of section.matchAll(EMAIL)) {
      const address = m[0].replace(/[.,;]+$/, '');
      const local = fold(address.split('@')[0] ?? '');
      const before = section.slice(Math.max(0, (m.index ?? 0) - 80), m.index ?? 0);
      if (FUNCTIONAL_LOCAL.test(local)) continue;
      if (THIRD_PARTY_CUE.test(before)) continue;
      const byName = tokens.some((t) => local.includes(t));
      if (!byName && !FIRST_PERSON.test(before)) continue;
      const normalized = address.toLowerCase();
      if (!kept.includes(normalized)) kept.push(normalized);
    }
  }
  return kept;
}
