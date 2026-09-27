import { redirect } from 'next/navigation';

import { legacyTarget } from '@/lib/navigation/legacy-routes';

/**
 * ANCIENNE ADRESSE, conservée — elle ne rendra jamais 404 : des liens collés
 * dans des comptes rendus, des favoris et des captures de démonstration la
 * portent.
 *
 * « Validation suspendue » disparaît du premier niveau. Sa population, ce
 * sont les candidatures à valider — elles se retrouvent sous leur puce,
 * dans LA vue des candidatures.
 *
 * La cible est LUE dans `src/lib/navigation/legacy-routes.ts` (source unique,
 * testée) : la recopier ici ferait deux tableaux qui finiraient par diverger,
 * et la divergence serait muette — une redirection ne fait rougir personne.
 */
export default function LegacyRedirectPage() {
  redirect(legacyTarget('/validations'));
}
