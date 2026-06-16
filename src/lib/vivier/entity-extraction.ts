/**
 * Extraction des entités structurées d'un CV (Vivier — Session V1).
 *
 * Un seul appel LLM (via `chatCompleteJson`, déterministe + validation Zod +
 * retry × 3), schéma strict. Les entités sont un ENRICHISSEMENT, pas un
 * bloquant : si le LLM ne produit pas de sortie exploitable après les retries
 * (`AIValidationError`), on retombe sur des entités VIDES — l'indexation
 * pourra tout de même être marquée `indexed` dès lors que l'embedding a réussi
 * (cf. docs/specs/vivier.md §3.3 et le service d'indexation). Les erreurs de
 * transport (`AIProviderError`) se propagent : c'est au service d'indexation de
 * décider qu'elles restent non bloquantes pour le statut.
 *
 * Server-only.
 */

import { z } from 'zod';

import {
  buildVivierEntitySystemPrompt,
  buildVivierEntityUserPrompt,
} from '@/lib/agents/vivier-entity-prompts';
import { AIValidationError } from '@/lib/ai/errors';
import { chatCompleteJson } from '@/lib/ai/provider';
import { EMPTY_VIVIER_ENTITIES, type VivierEntities } from '@/types/vivier';

/** Schéma strict des entités. `.catch` durcit chaque champ contre une sortie partielle. */
export const VivierEntitiesSchema = z.object({
  technologies: z.array(z.string()).catch([]),
  certifications: z.array(z.string()).catch([]),
  diplomes: z.array(z.string()).catch([]),
  secteurs: z.array(z.string()).catch([]),
  langues: z.array(z.string()).catch([]),
  experienceYears: z.number().int().nonnegative().nullish().catch(null),
  localisation: z.string().nullish().catch(null),
});

/**
 * Schéma d'extraction = entités + TITRE du candidat (titre déclaré en tête de
 * CV, repli sur le poste le plus récent). Le titre est extrait dans le MÊME
 * appel LLM (pas de surcoût) mais routé À PART (vers le dossier, pas vers la
 * table d'entités qui reste inchangée).
 */
export const VivierExtractionSchema = VivierEntitiesSchema.extend({
  title: z.string().nullish().catch(null),
  /** Compétences atomiques (hard + soft), routées à part (matching set-to-set). */
  skills: z.array(z.string()).catch([]),
  /** Intitulés des 2 derniers postes (ancres de titre du Bloc 1, du + récent au + ancien). */
  recentPositions: z.array(z.string()).catch([]),
});

/** Résultat d'extraction : entités + titre + compétences + derniers postes (séparés). */
export type VivierExtraction = {
  entities: VivierEntities;
  title: string | null;
  skills: string[];
  recentPositions: string[];
};

/** Nettoie une liste de chaînes (trim, retrait des vides, déduplication insensible casse). */
function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

function normalize(data: z.infer<typeof VivierEntitiesSchema>): VivierEntities {
  return {
    technologies: cleanList(data.technologies),
    certifications: cleanList(data.certifications),
    diplomes: cleanList(data.diplomes),
    secteurs: cleanList(data.secteurs),
    langues: cleanList(data.langues),
    experienceYears: data.experienceYears ?? null,
    localisation: data.localisation?.trim() || null,
  };
}

/**
 * Extrait les entités structurées + le TITRE d'un CV. Renvoie entités VIDES +
 * titre null (jamais d'exception) si l'extraction LLM échoue à produire une
 * sortie valide (`AIValidationError`) — enrichissement non bloquant. Les autres
 * erreurs (transport) remontent.
 */
export async function extractVivierEntities(
  cvText: string,
  fileName: string,
): Promise<VivierExtraction> {
  try {
    const r = await chatCompleteJson(
      [
        { role: 'system', content: buildVivierEntitySystemPrompt() },
        { role: 'user', content: buildVivierEntityUserPrompt(cvText, fileName) },
      ],
      VivierExtractionSchema,
    );
    return {
      entities: normalize(r.data),
      title: r.data.title?.trim() || null,
      skills: cleanList(r.data.skills ?? []),
      // Cap à 2 derniers postes (ancres de titre du Bloc 1).
      recentPositions: cleanList(r.data.recentPositions ?? []).slice(0, 2),
    };
  } catch (err) {
    if (err instanceof AIValidationError) {
      return {
        entities: { ...EMPTY_VIVIER_ENTITIES },
        title: null,
        skills: [],
        recentPositions: [],
      };
    }
    throw err;
  }
}
