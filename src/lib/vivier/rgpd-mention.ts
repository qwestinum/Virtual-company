/**
 * Mention RGPD du vivier (Session V3, docs/specs/vivier.md §8.1). PARTAGÉE par
 * le message d'invitation (§6.1) et les annonces générées (§7) : une seule
 * formulation, un seul endroit à faire évoluer. Pure.
 */
export function buildVivierRgpdMention(contact: string): string {
  const c = contact.trim() || 'notre service recrutement';
  return (
    'Vos données pourront être conservées dans notre vivier de candidatures ' +
    'afin de vous proposer des opportunités futures. Vous pouvez demander leur ' +
    `suppression à tout moment à ${c}.`
  );
}

/**
 * Le début INVARIANT de la mention — sa signature, indépendante du contact.
 *
 * Sert à la retrouver dans un texte pour ne pas l'y empiler : le contact varie
 * (adresse de réception de la campagne, expéditeur, repli), la phrase non.
 */
const MENTION_MARKER = 'Vos données pourront être conservées';

/**
 * Retire la mention (et ce qui la suit) d'un texte. PURE — testée.
 *
 * Utile quand un texte DÉJÀ pourvu de la mention repart comme matériau à
 * reformuler : sans ce retrait, on la ferait réécrire par le modèle puis on la
 * rajouterait de façon déterministe — deux mentions dans une même annonce.
 */
export function stripVivierRgpdMention(text: string): string {
  const at = text.indexOf(MENTION_MARKER);
  return (at === -1 ? text : text.slice(0, at)).trimEnd();
}

/**
 * Appose la mention à un texte, une fois et une seule. PURE — testée.
 *
 * Déterministe par principe : la mention n'est JAMAIS laissée au modèle, qui
 * pourrait l'oublier, la reformuler ou en inventer une autre.
 */
export function withRgpdMentionAppended(text: string, contact: string): string {
  const body = stripVivierRgpdMention(text);
  const mention = buildVivierRgpdMention(contact);
  return body ? `${body}\n\n${mention}` : mention;
}
