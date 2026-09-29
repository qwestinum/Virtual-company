/**
 * Point d'écoute de la consommation des appels au modèle — ADDITIF.
 *
 * Chaque appel facturé (complétion OpenAI, tentative Anthropic, embedding)
 * émet un évènement ; sans écouteur, rien ne se passe et rien ne change.
 * Premier usage : `npm run vivier:import`, qui additionne le coût RÉEL d'un
 * import alors que l'indexation ne remonte pas ses coûts à l'appelant.
 *
 * Mémoire de PROCESS, volontairement : c'est une mesure locale d'une exécution
 * (un script), jamais un compteur partagé entre instances.
 */

export type AIUsageEvent = {
  kind: 'chat' | 'embedding';
  model: string;
  promptTokens: number;
  completionTokens: number;
  costEstimate: number;
};

type Listener = (event: AIUsageEvent) => void;

const listeners = new Set<Listener>();

/** Abonne un écouteur ; rend la fonction de désabonnement. */
export function onAIUsage(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Émet un évènement. Un écouteur qui lève n'emporte jamais l'appel au modèle. */
export function emitAIUsage(event: AIUsageEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Mesure seulement : une erreur d'écouteur ne remonte pas.
    }
  }
}
