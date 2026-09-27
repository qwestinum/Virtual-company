/**
 * LA PRÉFÉRENCE « Référent » — UN SEUL état, partagé par tous les écrans et
 * mémorisé PAR RECRUTEUR.
 *
 * ⚠️ RENVERSEMENT D'UNE DÉCISION ÉCRITE (21/09/2026, à la demande du donneur
 * d'ordre). Le filtre était volontairement NON persisté — « un filtre oublié
 * qui masque des dossiers est pire que pas de filtre ». L'arbitrage change :
 * un recruteur qui coche « Mes campagnes » sur Candidatures veut le retrouver
 * coché sur Campagnes, sans le reposer à chaque écran.
 *
 * Le risque d'origine ne disparaît pas pour autant, il est CONTENU par ce qui
 * existait déjà et qu'on ne touche pas :
 *   - les compteurs d'onglet écrivent toujours « n sur N » — un dossier masqué
 *     reste compté ;
 *   - l'état vide est filtre-conscient (« il n'y a rien » et « le filtre
 *     masque tout » ne se confondent pas) ;
 *   - les ALERTES ne sont jamais filtrées ;
 *   - la barre du filtre est visible sur chaque écran qui l'applique, donc un
 *     filtre actif se voit à l'endroit même où il agit.
 *
 * PAR RECRUTEUR : la clé porte l'identifiant de session. Sur un poste partagé,
 * le suivant ne récupère pas le filtre du précédent — « Mes campagnes » ne
 * veut pas dire la même chose pour deux personnes.
 *
 * Le stockage est le navigateur. Il peut être vide, refusé ou lever (fenêtre
 * privée, données bloquées) : toute lecture et toute écriture sont gardées, et
 * l'absence retombe sur « Tous », qui ne masque rien.
 */

import { ALL_REFERENTS, type ReferentSelection } from './filter';

const PREFIXE = 'orqa.referent-filter.';

/** Sérialisation stable — un format, pas l'objet brut. */
export function serialiserSelection(s: ReferentSelection): string {
  return s.kind === 'recruiter' ? `recruiter:${s.id}` : s.kind;
}

/**
 * Lecture TOLÉRANTE : tout ce qui n'est pas reconnu vaut « Tous ». Une valeur
 * corrompue ou écrite par une version antérieure ne doit jamais masquer des
 * dossiers.
 */
export function analyserSelection(brut: string | null): ReferentSelection {
  if (!brut) return ALL_REFERENTS;
  if (brut === 'all') return ALL_REFERENTS;
  if (brut === 'none') return { kind: 'none' };
  const m = /^recruiter:(.+)$/.exec(brut);
  return m ? { kind: 'recruiter', id: m[1]! } : ALL_REFERENTS;
}

const cle = (userId: string | null) => `${PREFIXE}${userId ?? 'anonyme'}`;

export function lirePreference(userId: string | null): ReferentSelection {
  try {
    return analyserSelection(window.localStorage.getItem(cle(userId)));
  } catch {
    return ALL_REFERENTS;
  }
}

export function ecrirePreference(
  userId: string | null,
  selection: ReferentSelection,
): void {
  try {
    window.localStorage.setItem(cle(userId), serialiserSelection(selection));
  } catch {
    // Stockage refusé : le filtre vit alors le temps de la session. On ne
    // prévient pas — c'est une commodité, pas une donnée.
  }
}
