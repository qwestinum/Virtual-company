/**
 * Neutralisation des saisies de recherche injectées dans un filtre PostgREST
 * `.or(...)` (partagé par les repos — corrigé une seule fois, consommé partout).
 *
 * On STRIPPE (remplace par une espace) les caractères porteurs de sens dans la
 * syntaxe `.or(...)` plutôt que de les échapper : c'est une recherche
 * « contient » insensible à la casse, l'échappement n'apporterait aucune valeur
 * fonctionnelle et ouvrirait une surface d'injection. Caractères neutralisés :
 *   - `,` `(` `)`  : séparateurs / groupage de la liste de conditions
 *   - `%` `*`      : jokers (PostgREST n'interprète que `*` dans `.or`)
 *   - `\` `'` `"`  : antislash et guillemets (échappement PostgREST)
 *
 * Pure et déterministe.
 */
export function sanitizePostgrestSearch(raw: string): string {
  return raw.replace(/[,()%*\\'"]/g, ' ').trim();
}
