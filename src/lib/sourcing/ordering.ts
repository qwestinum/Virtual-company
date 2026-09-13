/**
 * « En recherche d'abord » — tri STABLE, jamais un filtre (spec §4.3). PUR.
 * Les profils signalés passent en tête, l'ordre du moteur est conservé à
 * l'intérieur de chaque groupe ; décocher rend l'ordre du moteur pur.
 */
import type { SourcingProfileView } from '@/types/sourcing';

export function orderProfiles(profiles: SourcingProfileView[], availableFirst: boolean): SourcingProfileView[] {
  const byRank = [...profiles].sort((a, b) => a.exaRank - b.exaRank);
  if (!availableFirst) return byRank;
  return [...byRank.filter((p) => p.snapshot.availability), ...byRank.filter((p) => !p.snapshot.availability)];
}
