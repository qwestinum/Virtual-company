/**
 * Ce que l'écran de liste affiche — PUR.
 *
 * Les profils « à examiner » sont groupés par recherche, la plus récente en
 * tête, et dans chaque groupe dans l'ORDRE DU MOTEUR. La réserve, la fin de
 * réserve et la couverture de zone portent sur la recherche la plus récente :
 * c'est celle que le recruteur est en train de lire.
 */
import { coverageOf, isInZone, zoneTerms } from '@/lib/sourcing/selection';
import { cleanLocation } from '@/lib/sourcing/query-deterministic';
import type { SourcingSearch, StoredSourcingProfile } from '@/lib/db/repos/sourcing';
import type { SearchYield } from '@/lib/sourcing/search-yield';
import type { CoverageVerdict, SourcingProfileView } from '@/types/sourcing';

export type SearchGroupView = {
  search: Pick<SourcingSearch, 'id' | 'query' | 'language' | 'queryMethod' | 'createdAt' | 'returned' | 'newAfterDedup'>;
  profiles: SourcingProfileView[];
};

export type ProfilesView = {
  groups: SearchGroupView[];
  /** Profils encore en réserve sur la recherche la plus récente. */
  reserveCount: number;
  /** La recherche la plus récente a montré tout ce qu'elle avait. */
  exhausted: boolean;
  coverage: CoverageVerdict;
  /**
   * Bilan de la recherche la plus récente (renvoyés, illisibles, écartés,
   * gardés). Posé par la route, qui le lit au journal ; `null` si inconnu.
   */
  latestYield?: SearchYield | null;
};

export function buildProfilesView(
  searches: SourcingSearch[],
  profiles: StoredSourcingProfile[],
  fdpLocation: string | null,
): ProfilesView {
  const ordered = [...searches].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = ordered[0] ?? null;
  const city = cleanLocation(fdpLocation);

  // « Montré » = à examiner OU déjà contacté : un profil approché reste dans la
  // liste (marqué), le recruteur ne perd pas la trace de son geste.
  const isShown = (p: StoredSourcingProfile): boolean => p.state !== 'reserve';
  const latestShown = latest ? profiles.filter((p) => p.searchId === latest.id && isShown(p)) : [];
  const coverage = coverageOf(city, latestShown.map((p) => p.snapshot));
  const terms = city ? zoneTerms(city, latestShown.map((p) => p.snapshot)) : null;

  const groups: SearchGroupView[] = [];
  for (const s of ordered) {
    const shown = profiles
      .filter((p) => p.searchId === s.id && isShown(p))
      .sort((a, b) => a.exaRank - b.exaRank)
      .map<SourcingProfileView>((p) => ({
        id: p.id,
        searchId: p.searchId,
        exaRank: p.exaRank,
        state: p.state,
        snapshot: p.snapshot,
        inZone: terms ? isInZone(p.snapshot, terms) : null,
      }));
    if (shown.length > 0 || s.id === latest?.id) {
      groups.push({
        search: {
          id: s.id,
          query: s.query,
          language: s.language,
          queryMethod: s.queryMethod,
          createdAt: s.createdAt,
          returned: s.returned,
          newAfterDedup: s.newAfterDedup,
        },
        profiles: shown,
      });
    }
  }

  const reserveCount = latest
    ? profiles.filter((p) => p.searchId === latest.id && p.state === 'reserve').length
    : 0;

  return { groups, reserveCount, exhausted: latest !== null && reserveCount === 0, coverage };
}
