/**
 * Course RÉELLE sur un créneau — et pourquoi il faut la rejouer.
 *
 * `slot_taken` n'est rendu que si les deux confirmations franchissent leur
 * revalidation AVANT que l'une d'elles n'insère : c'est alors l'index unique
 * qui tranche, et c'est le SEUL chemin qui produit ce verdict. Si la première
 * a déjà inséré, la seconde voit le créneau occupé et rend `invalid_slot` —
 * verdict correct lui aussi, mais qui ne prouve rien sur l'index.
 *
 * Or `Promise.all` ne garantit pas le chevauchement : sous charge (suite
 * complète, base distante), la première requête termine parfois avant que la
 * seconde n'ait émis sa première lecture. La course n'a alors pas lieu, et le
 * test échouait sans qu'aucun comportement n'ait changé — deux fois observé
 * en recette (S14.2, puis S13.2), à chaque fois en suite complète et jamais
 * sur le fichier seul.
 *
 * On REJOUE donc la course sur un créneau neuf jusqu'à en observer une vraie,
 * plutôt que d'accepter les deux verdicts : accepter `invalid_slot` reviendrait
 * à ne plus prouver que `slot_taken` est atteignable — précisément ce que ces
 * tests existent pour tenir. Si aucune tentative ne se chevauche, on échoue en
 * le DISANT (« la course n'a jamais eu lieu »), ce qui est un diagnostic, pas
 * une comparaison de chaînes trompeuse.
 *
 * `attempt` rend le motif du perdant (ou `null` s'il n'y en a pas) et porte
 * ses propres assertions : celles qui tiennent à CHAQUE tentative, course ou
 * pas — un seul gagnant, une seule réservation en base.
 */
export async function raceUntilContended(
  attempt: (index: number) => Promise<string | null>,
  attempts = 5,
): Promise<void> {
  const verdicts: string[] = [];
  for (let index = 0; index < attempts; index++) {
    const reason = await attempt(index);
    if (reason === 'slot_taken') return;
    verdicts.push(reason ?? 'aucun perdant');
  }
  throw new Error(
    `aucune course réelle en ${attempts} tentatives (verdicts du perdant : ` +
      `${verdicts.join(', ')}) — l'index unique n'a jamais eu à trancher, ` +
      `le chemin « slot_taken » n'est donc pas couvert par cette exécution`,
  );
}
