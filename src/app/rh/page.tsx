import { redirect } from 'next/navigation';

import { legacyTarget } from '@/lib/navigation/legacy-routes';

/**
 * ANCIENNE ADRESSE du portail RH, conservée — jamais 404.
 *
 * Le département n'avait qu'une porte, Recrutement, et celle-ci n'a plus de
 * page d'accueil à elle : on atterrit sur le travail du jour.
 */
export default function RhRedirectPage() {
  redirect(legacyTarget('/rh'));
}
