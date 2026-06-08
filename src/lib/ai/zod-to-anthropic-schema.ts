/**
 * Conversion d'un schéma Zod en JSON Schema pour l'API Anthropic (tool use).
 *
 * Pourquoi pas `zod-to-json-schema` : le projet est en **zod 4**, qui expose
 * `z.toJSONSchema()` nativement. On l'utilise comme équivalent direct (la lib
 * `zod-to-json-schema` vise zod 3 et peut diverger sur zod 4).
 *
 * Le résultat alimente `tools[].input_schema` d'un appel `messages.create`
 * Anthropic, avec `tool_choice` forçant l'outil — c'est notre équivalent du
 * « JSON mode » d'OpenAI : le modèle est contraint d'émettre un objet structuré,
 * qu'on revalide ensuite avec le schéma Zod d'origine (mêmes garanties qu'avant,
 * cf. `chatCompleteJson`). Les `input_schema` d'outil sont tolérants : les
 * mots-clés de validation fine (minLength, format…) servent de guidage et ne
 * font pas échouer la requête — la validation stricte reste côté Zod.
 *
 * Helper isolé pour être testable sans réseau.
 */

import { z } from 'zod';

/** JSON Schema d'objet, forme attendue par `tools[].input_schema` (Anthropic). */
export type AnthropicToolInputSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/**
 * Convertit un schéma Zod (objet au top-level) en `input_schema` d'outil Anthropic.
 *
 * @throws si le schéma ne se résout pas en un objet JSON Schema de type `object`
 *   (Anthropic exige un objet au top-level pour `input_schema`).
 */
export function zodToAnthropicToolSchema(
  schema: z.ZodType,
): AnthropicToolInputSchema {
  // `unrepresentable: 'any'` : tolère les constructions zod sans équivalent
  // JSON Schema strict (ex. transforms) au lieu de lever — la validation fine
  // reste assurée par le `safeParse` Zod côté appelant.
  const json = z.toJSONSchema(schema, {
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  // `$schema` (marqueur de dialecte) est inutile et bruite la définition d'outil.
  delete json.$schema;

  if (json.type !== 'object') {
    throw new Error(
      `zodToAnthropicToolSchema : le schéma doit être de type 'object' au top-level (reçu : ${String(
        json.type,
      )}).`,
    );
  }

  return json as AnthropicToolInputSchema;
}
