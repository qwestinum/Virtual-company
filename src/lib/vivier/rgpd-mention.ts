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
