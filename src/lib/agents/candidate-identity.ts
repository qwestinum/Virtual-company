/**
 * Extraction d'IDENTITÉ candidat depuis un texte de CV (réutilisable).
 *
 * Brique RÉUTILISÉE par l'upload vivier (Session V1) : elle s'appuie sur le
 * pipeline d'extraction candidat existant — les MÊMES prompts que le CV
 * Analyzer (`buildCandidateExtractionSystemPrompt/UserPrompt`) et le MÊME
 * résolveur d'email déterministe (`resolveCandidateEmail`) — sans dupliquer la
 * logique d'intelligence. On n'en garde que la projection d'identité dont le
 * vivier a besoin (nom, email, téléphone), pas le scoring ni la narration.
 *
 * Server-only (passe par `chatCompleteJson`).
 */

import { z } from 'zod';

import { resolveCandidateEmail } from '@/lib/agents/candidate-email';
import {
  buildCandidateExtractionSystemPrompt,
  buildCandidateExtractionUserPrompt,
} from '@/lib/agents/cv-extraction-prompts';
import { chatCompleteJson } from '@/lib/ai/provider';

/**
 * Sous-ensemble d'identité extrait par le LLM. Le prompt partagé émet d'autres
 * champs (langue, localisation, photo…) : Zod les ignore (objet non strict, les
 * clés inconnues sont retirées). `.catch` durcit les champs sensibles.
 */
const CandidateIdentitySchema = z.object({
  isCv: z.boolean().catch(true),
  fullName: z.string().min(1),
  email: z.string().email().nullable().catch(null),
  phone: z.string().nullish().catch(null),
});

export type CandidateIdentity = {
  /** Le document est-il une candidature ? false ⇒ pas d'identité exploitable. */
  isCv: boolean;
  fullName: string;
  /** Email canonique résolu DÉTERMINISTE depuis le texte (jamais halluciné). */
  email: string | null;
  phone: string | null;
};

/**
 * Extrait l'identité d'un CV. L'email retenu est TOUJOURS une adresse
 * littéralement présente dans le texte (résolution déterministe partagée avec
 * le CV Analyzer) — jamais une hallucination du LLM. Si le document n'est pas
 * une candidature (`isCv: false`), on ne récupère AUCUN email (ne pas grappiller
 * l'adresse d'un recruteur dans un document non-CV).
 *
 * Lève `AIValidationError` si le LLM ne produit pas de sortie exploitable après
 * les retries (l'appelant traite l'absence d'email comme « email non extractible »).
 */
export async function extractCandidateIdentity(
  cvText: string,
  fileName: string,
): Promise<CandidateIdentity> {
  const r = await chatCompleteJson(
    [
      { role: 'system', content: buildCandidateExtractionSystemPrompt() },
      { role: 'user', content: buildCandidateExtractionUserPrompt(cvText, fileName) },
    ],
    CandidateIdentitySchema,
  );
  const d = r.data;

  if (d.isCv === false) {
    return { isCv: false, fullName: 'Candidat anonyme', email: null, phone: null };
  }

  const resolved = resolveCandidateEmail(cvText, d.email);
  return {
    isCv: true,
    fullName: d.fullName,
    email: resolved.email,
    phone: d.phone ?? null,
  };
}
