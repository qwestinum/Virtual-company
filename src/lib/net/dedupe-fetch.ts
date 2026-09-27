/**
 * DÉDUPLICATION DES REQUÊTES EN VOL — pas un cache.
 *
 * ⚠️ La distinction est tout le sujet. Un cache sert une réponse ANCIENNE :
 * sur *Aujourd'hui*, dont l'unique fonction est de compter ce qui attend, dire
 * « 6 choses vous attendent » alors qu'on vient d'en traiter trois est la pire
 * faute possible. Ici on ne garde rien : on constate que deux appelants
 * demandent la MÊME adresse EN MÊME TEMPS, et on leur sert la même requête.
 * La réponse est aussi fraîche que si chacun l'avait faite ; il y en a
 * simplement une au lieu de deux.
 *
 * Mesuré sur *Aujourd'hui* : `/api/validations` (46 Ko) et
 * `/api/notifications/business` partaient DEUX fois à chaque affichage — une
 * fois pour le badge du bandeau, une fois pour l'écran. Personne ne le voyait,
 * parce que chaque appelant est correct isolément.
 *
 * La promesse est retirée dès qu'elle se RÉSOUT — succès comme échec : la
 * requête suivante repart pour de bon, et le compteur peut donc changer.
 *
 * ⚠️ Corollaire à connaître : un appel qui ne se résout JAMAIS (socket pendu,
 * sans délai d'attente) condamne son adresse pour tous les appelants suivants,
 * qui attendront la même promesse morte. C'est la contrepartie du partage. En
 * pratique `fetch` finit par rejeter, et un écran se recharge ; mais une route
 * qu'on partagerait ici devrait toujours porter un délai d'attente.
 */

const enVol = new Map<string, Promise<Response>>();

export function dedupeFetch(url: string, init?: RequestInit): Promise<Response> {
  const existante = enVol.get(url);
  // ⚠️ `clone()` : un corps de réponse ne se lit qu'UNE fois. Sans clone, le
  // second appelant recevrait un flux déjà consommé — un défaut bien pire que
  // la requête qu'on économise.
  if (existante) return existante.then((r) => r.clone());

  const promesse = fetch(url, init).finally(() => {
    enVol.delete(url);
  });
  enVol.set(url, promesse);
  return promesse.then((r) => r.clone());
}
