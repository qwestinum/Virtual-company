/**
 * Génération serveur des VARIANTES D'INTITULÉ iso-rôle (présélection Vivier).
 *
 * Distinct du keyword-variants du SCORING (registre différent) : ici on produit
 * des intitulés de poste équivalents EN ANGLAIS, strictement iso-rôle, pour
 * nourrir le Bloc 1 déterministe. On génère pour CHAQUE titre candidat (blocs +
 * titre complet, cf. splitTitleIntoBlocks) et on fusionne/déduplique.
 *
 * Server-only (importe provider.ts). Non bloquant côté indexation : l'appelant
 * traite un échec en laissant le candidat rapprochable par l'embedding titre.
 */

import { z } from 'zod';

import {
  buildTitleVariantsSystemPrompt,
  buildTitleVariantsUserPrompt,
} from '@/lib/agents/prompts/title-variants';
import { chatCompleteJson } from '@/lib/ai/provider';

const TitleVariantsResponseSchema = z.object({
  variants: z.array(z.string().min(1)).max(60).catch([]),
});

/** Borne haute du nombre de variantes conservées (rappel large mais fini). */
const MAX_TITLE_VARIANTS = 40;

/** Variantes iso-rôle pour UN titre candidat. Lève en cas d'échec transport. */
async function variantsForOne(title: string): Promise<string[]> {
  const { data } = await chatCompleteJson(
    [
      { role: 'system', content: buildTitleVariantsSystemPrompt() },
      { role: 'user', content: buildTitleVariantsUserPrompt(title) },
    ],
    TitleVariantsResponseSchema,
    { temperature: 0.5 },
  );
  return data.variants;
}

/**
 * Variantes iso-rôle fusionnées pour une liste de titres candidats (blocs +
 * complet). Dédup insensible casse/espaces, exclut les titres candidats
 * eux-mêmes (déjà connus), borné à `MAX_TITLE_VARIANTS`.
 */
export async function runTitleVariantsSuggestion(
  titleCandidates: string[],
): Promise<{ variants: string[] }> {
  const candidates = titleCandidates
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (candidates.length === 0) return { variants: [] };

  const lists = await Promise.all(candidates.map((t) => variantsForOne(t)));

  // Exclut les titres candidats déjà connus (ils matchent en direct au bloc 1).
  const known = new Set(candidates.map((t) => t.toLowerCase().replace(/\s+/g, ' ')));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of lists.flat()) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase().replace(/\s+/g, ' ');
    if (known.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= MAX_TITLE_VARIANTS) break;
  }
  return { variants: out };
}
