/**
 * Résolution DÉTERMINISTE de l'email destinataire d'un candidat.
 *
 * Problème résolu : l'email du candidat était pris de l'extraction LLM —
 * non déterministe. Selon les passes, il pouvait
 * renvoyer l'adresse de l'expéditeur de l'enveloppe, une adresse citée,
 * ou halluciner, si bien que le mail destiné au candidat partait parfois
 * à la mauvaise personne.
 *
 * Règle : le destinataire DOIT être une adresse littéralement présente
 * dans le texte du CV.
 *   - 'verified'  : l'email du LLM figure bien dans le CV → retenu (casse du CV).
 *   - 'corrected' : l'email du LLM est absent du CV → remplacé par la 1ʳᵉ
 *                   adresse trouvée dans le CV (ordre du document).
 *   - 'absent'    : aucune adresse dans le CV → email = null, on n'envoie rien.
 *
 * Pure et déterministe : même (cvText, llmEmail) ⇒ même résultat.
 */

// Regex email volontairement simple et stricte sur le TLD (≥ 2 lettres).
// `g` pour capturer toutes les occurrences ; on déduplique ensuite.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export type CandidateEmailStatus = 'verified' | 'corrected' | 'absent';

export type CandidateEmailResolution = {
  /** Adresse retenue pour l'outreach, ou null si rien d'exploitable. */
  email: string | null;
  status: CandidateEmailStatus;
  /** Adresses littéralement présentes dans le CV (ordre, dédupliquées). */
  found: string[];
};

/**
 * Extrait les adresses email d'un texte, dans l'ordre d'apparition,
 * dédupliquées (insensible à la casse, mais on conserve la casse de la
 * 1ʳᵉ occurrence). Nettoie une éventuelle ponctuation finale.
 */
export function extractEmailsFromText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of (text ?? '').matchAll(EMAIL_RE)) {
    const raw = match[0].replace(/[.,;:]+$/, '');
    const key = raw.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(raw);
    }
  }
  return out;
}

export function resolveCandidateEmail(
  cvText: string,
  llmEmail: string | null | undefined,
): CandidateEmailResolution {
  const found = extractEmailsFromText(cvText);
  if (found.length === 0) {
    return { email: null, status: 'absent', found };
  }
  const llm = (llmEmail ?? '').trim();
  if (llm) {
    const canonical = found.find((e) => e.toLowerCase() === llm.toLowerCase());
    if (canonical) {
      return { email: canonical, status: 'verified', found };
    }
  }
  // Le LLM a renvoyé une adresse absente du CV (ou rien) → on retombe sur
  // la 1ʳᵉ adresse réellement présente, choix déterministe.
  return { email: found[0], status: 'corrected', found };
}
