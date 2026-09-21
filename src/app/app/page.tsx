import { redirect } from 'next/navigation';

import { legacyTarget } from '@/lib/navigation/legacy-routes';

/**
 * ANCIENNE ADRESSE du lobby des départements, conservée — elle ne rendra
 * jamais 404 : des favoris et des captures de démonstration la portent.
 *
 * L'application s'ouvre désormais sur « Aujourd'hui » (lot 8 bis). Le lobby
 * était un écran qu'on traversait sans le lire : un clic de plus, pas une
 * orientation. La cible est LUE dans `legacy-routes.ts` (source unique,
 * testée) : la recopier ici ferait deux tableaux qui divergeraient en
 * silence.
 */
export default function LobbyRedirectPage() {
  redirect(legacyTarget('/app'));
}
