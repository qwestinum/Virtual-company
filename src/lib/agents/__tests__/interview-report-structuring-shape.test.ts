/**
 * La forme dite au modèle et le schéma qui la valide ne divergent pas.
 *
 * Incident du 24/09/2026 : le prompt demandait « le schéma demandé » sans
 * jamais l'écrire. Le mode JSON d'OpenAI ne transmet aucun schéma : le modèle
 * inventait sa structure et la validation stricte rejetait tout, à chaque
 * import de transcription. La régression mocke le modèle, elle ne pouvait pas
 * le voir — d'où ce test sur le texte même du prompt.
 */
import { describe, expect, it } from 'vitest';

import {
  buildStructuringMessages,
  STRUCTURING_OUTPUT_SHAPE,
} from '@/lib/agents/interview-report-structuring';
import { normalizeTranscript } from '@/lib/transcript/normalize';
import { StructuringOutputSchema } from '@/lib/transcript/structure';

const ITEM = { text: 'Le candidat indique…', quote: 'une citation mot pour mot', speaker: null, at: null };

describe('forme de sortie du compte rendu structuré', () => {
  it('le prompt système ÉCRIT la forme attendue', () => {
    const [system] = buildStructuringMessages({
      transcript: normalizeTranscript('Bonjour.'),
      criteria: [],
      candidateSpeaker: null,
    });
    expect(system!.content).toContain(STRUCTURING_OUTPUT_SHAPE);
    for (const key of ['"text"', '"quote"', '"speaker"', '"at"']) {
      expect(system!.content).toContain(key);
    }
  });

  it('la forme, éléments remplis, passe le schéma strict', () => {
    const filled = JSON.parse(
      STRUCTURING_OUTPUT_SHAPE.replaceAll('"<élément>"', JSON.stringify(ITEM)),
    ) as unknown;
    expect(StructuringOutputSchema.safeParse(filled).success).toBe(true);
  });

  it('la forme nomme toutes les clés du schéma, et aucune autre', () => {
    const shape = JSON.parse(STRUCTURING_OUTPUT_SHAPE) as Record<string, unknown>;
    expect(Object.keys(shape).sort()).toEqual(
      Object.keys(StructuringOutputSchema.shape).sort(),
    );
  });
});
