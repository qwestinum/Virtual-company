/**
 * Sélection des profils d'un appel au moteur — PUR.
 * Spec : docs/specs/sourcing.md §1.1, §2.4, §3.6, §7.1.
 *
 * Trois décisions, et aucune ne réordonne : l'ordre affiché EST l'ordre du
 * moteur (seul le rang de réponse compte).
 *   1. dédoublonnage par EMPREINTE contre ce que la campagne a déjà vu, ses
 *      exclusions et les oppositions ;
 *   2. partage en « à examiner » (50) et « réserve » (le reste) ;
 *   3. couverture de la zone demandée, dite au recruteur quand elle est faible.
 */
import type { CoverageVerdict, ExaSnapshot } from '@/types/sourcing';

export type Candidate = { rank: number; fingerprint: string; snapshot: ExaSnapshot };

export type SkipReason = 'already_seen' | 'excluded' | 'opposed' | 'duplicate_in_response';

export type Selection = {
  fresh: (Candidate & { state: 'to_review' | 'reserve' })[];
  skipped: Record<SkipReason, number>;
};

export const BATCH_SIZE = 50;

export function selectFreshProfiles(
  candidates: Candidate[],
  known: { seen: Set<string>; excluded: Set<string>; opposed: Set<string> },
  batchSize: number = BATCH_SIZE,
): Selection {
  const skipped: Record<SkipReason, number> = {
    already_seen: 0,
    excluded: 0,
    opposed: 0,
    duplicate_in_response: 0,
  };
  const inResponse = new Set<string>();
  const kept: Candidate[] = [];
  for (const c of [...candidates].sort((a, b) => a.rank - b.rank)) {
    // L'opposition d'abord : c'est la raison qui doit être comptée pour ce qu'elle est.
    if (known.opposed.has(c.fingerprint)) skipped.opposed += 1;
    else if (known.excluded.has(c.fingerprint)) skipped.excluded += 1;
    else if (known.seen.has(c.fingerprint)) skipped.already_seen += 1;
    else if (inResponse.has(c.fingerprint)) skipped.duplicate_in_response += 1;
    else {
      inResponse.add(c.fingerprint);
      kept.push(c);
    }
  }
  return {
    fresh: kept.map((c, i) => ({ ...c, state: i < batchSize ? 'to_review' : 'reserve' })),
    skipped,
  };
}

// ─── Couverture de zone (§3.6) ─────────────────────────────────────────────

export const COVERAGE_THRESHOLD = 0.4;

const fold = (v: string): string =>
  v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const locationsOf = (s: ExaSnapshot): string[] =>
  [s.location, s.workHistory.find((w) => w.to === null)?.location ?? null].filter(
    (v): v is string => !!v,
  );

/**
 * Termes de zone = la ville de la fiche + la RÉGION lue dans les localisations
 * au format « Ville, Région, Pays » qui contiennent cette ville. Aucune table de
 * communes : le moteur fournit la région, on la lui emprunte.
 */
export function zoneTerms(city: string, snapshots: ExaSnapshot[]): string[] {
  const c = fold(city);
  const terms = new Set<string>([c]);
  for (const s of snapshots) {
    for (const loc of locationsOf(s)) {
      const parts = loc.split(',').map((p) => p.trim());
      if (parts.length >= 3 && fold(parts[0]!).includes(c)) terms.add(fold(parts[1]!));
    }
  }
  return [...terms].filter((t) => t.length >= 3);
}

export function isInZone(snapshot: ExaSnapshot, terms: string[]): boolean {
  return locationsOf(snapshot).some((loc) => terms.some((t) => fold(loc).includes(t)));
}

export function coverageOf(city: string | null, snapshots: ExaSnapshot[]): CoverageVerdict {
  if (!city || snapshots.length === 0) {
    return { zoneLabel: city, inZone: 0, total: snapshots.length, limited: false };
  }
  const terms = zoneTerms(city, snapshots);
  const inZone = snapshots.filter((s) => isInZone(s, terms)).length;
  const region = terms.find((t) => t !== fold(city));
  const regionLabel = region
    ? snapshots
        .flatMap(locationsOf)
        .map((l) => l.split(',').map((p) => p.trim()))
        .find((p) => p.length >= 3 && fold(p[1]!) === region)?.[1]
    : undefined;
  return {
    zoneLabel: regionLabel ? `${city} (${regionLabel})` : city,
    inZone,
    total: snapshots.length,
    limited: inZone / snapshots.length < COVERAGE_THRESHOLD,
  };
}
