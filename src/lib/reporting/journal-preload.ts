/**
 * Lecture PARTAGÉE du journal entre plusieurs dérivations d'une même requête.
 *
 * Le détail d'une candidature dérive trois choses du journal (parcours, frise,
 * étape), chacune sur son propre jeu d'actions et sur le MÊME périmètre de
 * campagne. Plutôt que trois lectures qui se recouvrent, la route lit l'UNION
 * une fois et chaque dérivation en reprend exactement ses actions — l'ordre
 * (`created_at` décroissant) est celui de la lecture, un filtre ne le change
 * pas.
 *
 * ⚠️ Le périmètre est la responsabilité de l'appelant : une lecture partagée ne
 * se passe qu'à des dérivations qui l'auraient faite avec le MÊME `campaignId`.
 *
 * Pur : aucune lecture ici, seulement l'union et le filtre.
 */

import type { JournalEntry } from '@/lib/db/repos/journal';

/** Union des listes d'actions, sans doublon, dans l'ordre de première apparition. */
export function unionActions(...lists: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const action of list) {
      if (seen.has(action)) continue;
      seen.add(action);
      out.push(action);
    }
  }
  return out;
}

/** Les seules entrées des actions demandées, dans l'ordre reçu. */
export function pickActions(
  entries: readonly JournalEntry[],
  actions: readonly string[],
): JournalEntry[] {
  const wanted = new Set(actions);
  return entries.filter((e) => wanted.has(e.action));
}
