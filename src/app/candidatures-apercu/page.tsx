import { redirect } from 'next/navigation';

import { legacyTarget } from '@/lib/navigation/legacy-routes';

/**
 * ANCIENNE ADRESSE, conservée — elle ne rendra jamais 404 : des liens collés
 * dans des comptes rendus, des favoris et des captures de démonstration la
 * portent.
 *
 * C'était un aperçu JETABLE sur données fictives, que `.gitignore` excluait
 * pour qu'il ne devienne jamais une page publique en production (SEC-7). Il a
 * été remplacé par cette seule redirection — qui, elle, restait exclue par la
 * même règle et n'était donc JAMAIS DÉPLOYÉE : l'adresse rendait 404 partout
 * sauf sur le poste de développement (constaté le 27/09/2026 à la préparation
 * du merge). La règle est retirée ; la page ne porte AUCUNE donnée, sa cible
 * (`/candidatures`) est protégée par le proxy. Elle mène à la vraie liste
 * plutôt qu'au néant.
 *
 * La cible est LUE dans `src/lib/navigation/legacy-routes.ts` (source unique,
 * testée) : la recopier ici ferait deux tableaux qui finiraient par diverger,
 * et la divergence serait muette — une redirection ne fait rougir personne.
 */
export default function LegacyRedirectPage() {
  redirect(legacyTarget('/candidatures-apercu'));
}
