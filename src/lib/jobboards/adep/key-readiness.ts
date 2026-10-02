/**
 * Le serveur peut-il s'authentifier auprès de l'Apec ? — et la phrase qui le
 * dit (02/10/2026).
 *
 * Incident s2i-talents : sans `ADEP_ATS_PASSWORD_HASH`, l'application tentait
 * de calculer la clé au vol avec un module absent de la production. La
 * vérification de l'offre répondait « prête à partir », le clic rendait
 * `publish_failed` brut. Ce module sert les DEUX moments — avant le bouton et
 * au clic — avec le MÊME texte.
 *
 * Module à part (ni `service`, ni `publisher`) : les deux l'utilisent, et le
 * service importe déjà le publisher.
 */
import {
  AdepArgon2Error,
  adepKeyProblem,
  isArgon2ModuleAvailable,
  type AdepKeyProblem,
} from './argon2';

/** À qui s'adresse la suite : le recruteur ne règle pas un serveur. */
const FOR_ADMIN = 'À transmettre à l’administrateur de la plateforme : ';
const NOTHING_SENT = 'Rien n’a été envoyé à l’Apec.';

/** La phrase d'un problème de clé — même texte avant le clic et au clic. */
export function describeAdepKeyProblem(problem: AdepKeyProblem): string {
  switch (problem.kind) {
    case 'missing':
    case 'module_unavailable':
      return (
        'La connexion à l’Apec n’est pas configurée sur ce serveur : sa clé ' +
        'd’authentification est absente ou inutilisable. ' +
        FOR_ADMIN +
        'calculer la clé (npm run adep:hash), la poser dans ADEP_ATS_PASSWORD_HASH, puis redéployer.'
      );
    case 'bad_length':
      return (
        `La clé de connexion à l’Apec configurée sur ce serveur n’est pas valide (${problem.length} ` +
        'caractères au lieu de 342). ' +
        FOR_ADMIN +
        'la recalculer avec npm run adep:hash, la reposer dans ADEP_ATS_PASSWORD_HASH, puis redéployer.'
      );
  }
}

/**
 * Ce qui empêche CE SERVEUR de s'authentifier auprès de l'Apec, dit AVANT le
 * bouton Publier. Vaut aussi en simulation : la publication y résout les
 * mêmes identifiants (le flux est construit, puis caviardé).
 */
export function adepServerBlockers(
  env: Partial<Record<string, string>> = process.env,
  moduleAvailable: boolean = isArgon2ModuleAvailable(),
): string[] {
  const blockers: string[] = [];
  if (!env.ADEP_ATS_ID?.trim()) {
    blockers.push(
      'L’identifiant éditeur Apec n’est pas configuré sur ce serveur. ' +
        FOR_ADMIN +
        'poser ADEP_ATS_ID (fourni par l’Apec), puis redéployer.',
    );
  }
  const key = adepKeyProblem(env, moduleAvailable);
  if (key) blockers.push(describeAdepKeyProblem(key));
  return blockers;
}

/**
 * Une erreur de clé levée pendant une publication ou une transition, en
 * phrase. Elle survient à la PREMIÈRE résolution d'identité — avant la
 * réservation de la référence et avant tout envoi — d'où « rien n'a été
 * envoyé », qui est vrai ici et seulement ici.
 */
export function describeAdepKeyError(err: AdepArgon2Error): string {
  const problem: AdepKeyProblem =
    err.code === 'module_unavailable' ? { kind: 'module_unavailable' } : { kind: 'missing' };
  return `${describeAdepKeyProblem(problem)} ${NOTHING_SENT}`;
}
