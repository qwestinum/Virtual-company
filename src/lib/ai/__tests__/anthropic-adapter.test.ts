import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { splitMessagesForAnthropic } from '@/lib/ai/provider';
import { zodToAnthropicToolSchema } from '@/lib/ai/zod-to-anthropic-schema';

describe('zodToAnthropicToolSchema', () => {
  it('convertit un schéma objet représentatif en input_schema d’outil', () => {
    const schema = z.object({
      fullName: z.string().min(1),
      email: z.string().email().nullable(),
      decision: z.enum(['satisfait', 'partiel', 'non', 'non_verifiable']),
      tools: z.array(z.string()),
      yearsExperience: z.number().nullable(),
    });

    const out = zodToAnthropicToolSchema(schema);

    expect(out.type).toBe('object');
    expect(out.properties).toBeDefined();
    expect(Object.keys(out.properties ?? {})).toEqual(
      expect.arrayContaining([
        'fullName',
        'email',
        'decision',
        'tools',
        'yearsExperience',
      ]),
    );
    // Pas de marqueur de dialecte dans la définition d'outil.
    expect(out).not.toHaveProperty('$schema');
  });

  it('gère un schéma verdicts (tableau d’objets imbriqués)', () => {
    const verdicts = z.object({
      verdicts: z.array(
        z.object({
          criterionId: z.string().min(1),
          llmDecision: z.enum(['satisfait', 'non_verifiable']),
          llmJustification: z.string().min(1),
          llmCVQuote: z.string(),
        }),
      ),
    });

    const out = zodToAnthropicToolSchema(verdicts);
    const verdictsProp = (out.properties as Record<string, { type?: string }>)
      .verdicts;
    expect(verdictsProp?.type).toBe('array');
  });

  it('lève si le schéma n’est pas un objet au top-level', () => {
    expect(() => zodToAnthropicToolSchema(z.string())).toThrow(/object/i);
  });
});

describe('splitMessagesForAnthropic', () => {
  it('extrait le(s) message(s) system et mappe les tours user/assistant', () => {
    const { system, messages } = splitMessagesForAnthropic([
      { role: 'system', content: 'Tu es un évaluateur.' },
      { role: 'user', content: 'Voici le CV.' },
      { role: 'assistant', content: 'Compris.' },
      { role: 'user', content: 'Analyse.' },
    ]);

    expect(system).toBe('Tu es un évaluateur.');
    expect(messages).toEqual([
      { role: 'user', content: 'Voici le CV.' },
      { role: 'assistant', content: 'Compris.' },
      { role: 'user', content: 'Analyse.' },
    ]);
  });

  it('concatène plusieurs blocs system', () => {
    const { system, messages } = splitMessagesForAnthropic([
      { role: 'system', content: 'Règle 1.' },
      { role: 'system', content: 'Règle 2.' },
      { role: 'user', content: 'Go.' },
    ]);

    expect(system).toBe('Règle 1.\n\nRègle 2.');
    expect(messages).toHaveLength(1);
  });
});
