/**
 * Rapprochement d'un mail entrant avec une campagne, par son identifiant
 * `CAMP-XXXX`. Pur, testé. Utilisé par le poller IMAP.
 *
 * Deux champs, deux niveaux de confiance :
 *  - le SUJET est court et intentionnel → un ID y est un signal FORT. On garde
 *    la sémantique historique « premier ID de la liste présent gagne ».
 *  - le CORPS est long et pollué (fils Fwd:/Re:, signatures, disclaimers) → un
 *    ID y est un signal FAIBLE. On ne le consulte QU'EN REPLI du sujet, et on
 *    REFUSE de deviner si PLUSIEURS campagnes distinctes y apparaissent
 *    (`ambiguous`) : un mauvais rattachement (CV scoré contre la mauvaise
 *    grille) est pire qu'un non-rattachement, et il est silencieux.
 *
 * Priorité active > inactive alignée sur le poller : on rattache d'abord aux
 * campagnes qui écoutent (`active`), l'inactif ne sert qu'à la visibilité DRH.
 */

export type CampaignMatch =
  | { kind: 'active'; campaignId: string; source: 'subject' | 'body' }
  | { kind: 'inactive'; campaignId: string; source: 'subject' | 'body' }
  // Plusieurs campagnes distinctes trouvées dans le CORPS : on ne devine pas.
  | { kind: 'ambiguous'; campaignIds: string[]; source: 'body' }
  | { kind: 'none' };

/** Premier ID de `ids` présent dans `text` (sémantique historique du sujet). */
function firstIdInText(
  text: string | null | undefined,
  ids: string[],
): string | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  for (const id of ids) {
    if (haystack.includes(id.toLowerCase())) return id;
  }
  return null;
}

/**
 * TOUS les IDs de `ids` présents dans `text`, distincts, dans l'ordre de `ids`
 * (déterministe, indépendant de l'ordre d'apparition dans le mail).
 */
export function findAllCampaignIdsInText(
  text: string | null | undefined,
  ids: string[],
): string[] {
  if (!text) return [];
  const haystack = text.toLowerCase();
  const found: string[] = [];
  for (const id of ids) {
    if (haystack.includes(id.toLowerCase()) && !found.includes(id)) {
      found.push(id);
    }
  }
  return found;
}

/**
 * Résout la campagne d'un mail. `activeIds` ⊆ `associatedIds` (les campagnes
 * de la boîte qui sont `active`). Ordre de résolution :
 *   1. sujet → active (nominal, inchangé)
 *   2. sujet → inactive (visibilité)
 *   3. corps → active : 1 seule ⇒ rattache ; ≥2 distinctes ⇒ `ambiguous`
 *   4. corps → inactive (visibilité)
 *   5. rien
 */
export function resolveCampaignMatch(args: {
  subject: string | null | undefined;
  body: string | null | undefined;
  activeIds: string[];
  associatedIds: string[];
}): CampaignMatch {
  const { subject, body, activeIds, associatedIds } = args;

  // 1-2. Sujet (signal fort) — premier match, comportement historique.
  const subjectActive = firstIdInText(subject, activeIds);
  if (subjectActive) {
    return { kind: 'active', campaignId: subjectActive, source: 'subject' };
  }
  const subjectInactive = firstIdInText(subject, associatedIds);
  if (subjectInactive) {
    return { kind: 'inactive', campaignId: subjectInactive, source: 'subject' };
  }

  // 3. Corps → campagnes ACTIVES. Refus de deviner si plusieurs distinctes.
  const bodyActive = findAllCampaignIdsInText(body, activeIds);
  if (bodyActive.length === 1) {
    return { kind: 'active', campaignId: bodyActive[0], source: 'body' };
  }
  if (bodyActive.length >= 2) {
    return { kind: 'ambiguous', campaignIds: bodyActive, source: 'body' };
  }

  // 4. Corps → campagnes INACTIVES (visibilité). Aucune active dans le corps
  // à ce stade ⇒ tout match ici est inactif ; premier distinct suffit (on ne
  // rattache pas, on informe).
  const bodyInactive = findAllCampaignIdsInText(body, associatedIds);
  if (bodyInactive.length >= 1) {
    return { kind: 'inactive', campaignId: bodyInactive[0], source: 'body' };
  }

  return { kind: 'none' };
}

/**
 * Texte cherchable depuis le corps parsé (mailparser). Priorité au `text`
 * (plaintext) ; repli sur une version dé-balisée du `html` quand le mail est
 * HTML-only (`text` absent). Le dé-balisage est volontairement grossier : on
 * ne cherche qu'un motif `CAMP-XXXX`, pas à reconstruire le document. Limite
 * connue : un ID scindé par une balise au milieu (rarissime) ne matcherait pas.
 */
export function emailBodyText(parsed: {
  text?: string | null;
  html?: string | false | null;
}): string {
  if (parsed.text) return parsed.text;
  const html = typeof parsed.html === 'string' ? parsed.html : null;
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
