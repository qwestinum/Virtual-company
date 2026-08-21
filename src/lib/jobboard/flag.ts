/**
 * Interrupteur du jobboard de démonstration.
 *
 * FAIL-CLOSED, sans exception : absente, vide, ou différente de `1`, la
 * variable laisse la surface INEXISTANTE. Cette règle est le seul rempart
 * entre une plateforme d'emploi fictive et une instance client — on ne
 * l'assouplit pas, et on n'ajoute pas de second chemin d'activation.
 *
 * Pourquoi une variable d'environnement et non un réglage `/settings` : un
 * réglage en base est cliquable par un utilisateur, et un mauvais clic
 * publierait une fausse plateforme d'emploi sur l'instance d'un client. Une
 * variable d'environnement suit le déploiement, pas la session.
 *
 * Pourquoi PAS un `NEXT_PUBLIC_*` : le préfixe embarquerait la valeur dans le
 * bundle client de TOUS les déploiements. Le flag se lit côté serveur ; le
 * client apprend l'état de la surface par sa réponse (404 ⇒ pas de panneau),
 * ce qui est fail-closed par construction.
 */
export function isDemoJobboardEnabled(): boolean {
  return (process.env.DEMO_JOBBOARD_ENABLED ?? '').trim() === '1';
}
