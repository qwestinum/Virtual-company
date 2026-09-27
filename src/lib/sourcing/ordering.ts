/**
 * Ordre d'affichage d'un groupe de profils — tri STABLE, jamais un filtre. PUR.
 *
 * 1. Les profils déjà CONTACTÉS passent en bas (25/09/2026) : le travail qui
 *    reste à faire est en tête, le geste déjà fait reste visible (marqué)
 *    sans occuper le haut de la liste.
 * 2. « En recherche d'abord » (spec §4.3) : à l'intérieur de chacune des deux
 *    parties, les profils signalés passent en tête ; décocher rend l'ordre du
 *    moteur pur.
 */
import type { SourcingProfileView } from '@/types/sourcing';

export function orderProfiles(profiles: SourcingProfileView[], availableFirst: boolean): SourcingProfileView[] {
  const byRank = [...profiles].sort((a, b) => a.exaRank - b.exaRank);
  const part = (list: SourcingProfileView[]) =>
    availableFirst
      ? [...list.filter((p) => p.snapshot.availability), ...list.filter((p) => !p.snapshot.availability)]
      : list;
  return [
    ...part(byRank.filter((p) => p.state !== 'contacted')),
    ...part(byRank.filter((p) => p.state === 'contacted')),
  ];
}
