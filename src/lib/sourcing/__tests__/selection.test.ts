import { describe, expect, it } from 'vitest';

import { coverageOf, selectFreshProfiles, type Candidate } from '@/lib/sourcing/selection';
import { buildProfilesView } from '@/lib/sourcing/profiles-view';
import type { SourcingSearch, StoredSourcingProfile } from '@/lib/db/repos/sourcing';
import type { ExaSnapshot } from '@/types/sourcing';

const fp = (n: number) => n.toString(16).padStart(64, '0');

const snap = (name: string, location: string | null = null): ExaSnapshot => ({
  url: `https://www.linkedin.com/in/${name}`,
  name,
  firstName: null,
  location,
  headline: null,
  current: null,
  workHistory: [],
  education: [],
  about: null,
  skills: null,
  languages: null,
  certifications: null,
  highlight: null,
  indexedAt: null,
});

const cands = (n: number): Candidate[] =>
  Array.from({ length: n }, (_, i) => ({ rank: i + 1, fingerprint: fp(i + 1), snapshot: snap(`p${i + 1}`) }));

const none = () => ({ seen: new Set<string>(), excluded: new Set<string>(), opposed: new Set<string>() });

describe('dédoublonnage par empreinte', () => {
  it('un profil décliné (exclu de la campagne) ou opposé n’apparaît pas', () => {
    const known = none();
    known.excluded.add(fp(2));
    known.opposed.add(fp(3));
    const s = selectFreshProfiles(cands(5), known);
    expect(s.fresh.map((f) => f.fingerprint)).toEqual([fp(1), fp(4), fp(5)]);
    expect(s.skipped).toEqual({ already_seen: 0, excluded: 1, opposed: 1, duplicate_in_response: 0 });
  });

  it('déjà vu sur la campagne ⇒ écarté ; doublon dans la réponse ⇒ gardé une fois', () => {
    const known = none();
    known.seen.add(fp(1));
    const list = [...cands(3), { rank: 4, fingerprint: fp(2), snapshot: snap('p2-bis') }];
    const s = selectFreshProfiles(list, known);
    expect(s.fresh.map((f) => f.rank)).toEqual([2, 3]);
    expect(s.skipped.already_seen).toBe(1);
    expect(s.skipped.duplicate_in_response).toBe(1);
  });

  it('une opposition l’emporte sur tout autre motif, et elle est comptée comme telle', () => {
    const known = none();
    known.seen.add(fp(1));
    known.excluded.add(fp(1));
    known.opposed.add(fp(1));
    expect(selectFreshProfiles(cands(1), known).skipped.opposed).toBe(1);
  });

  it('ordre du moteur conservé ; 50 à examiner, le reste en réserve', () => {
    const shuffled = cands(100).reverse();
    const s = selectFreshProfiles(shuffled, none());
    expect(s.fresh.map((f) => f.rank)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(s.fresh.filter((f) => f.state === 'to_review')).toHaveLength(50);
    expect(s.fresh[49]!.state).toBe('to_review');
    expect(s.fresh[50]!.state).toBe('reserve');
  });
});

describe('couverture de zone (§3.6)', () => {
  it('Belfort : région lue dans « Ville, Région, Pays », couverture limitée sous 40 %', () => {
    const snaps = [
      snap('a', 'Belfort, Bourgogne-Franche-Comté, France'),
      snap('b', 'Montbéliard, Bourgogne-Franche-Comté, France'),
      ...Array.from({ length: 8 }, (_, i) => snap(`c${i}`, 'Nantes, Pays de la Loire, France')),
    ];
    const c = coverageOf('Belfort', snaps);
    expect(c.inZone).toBe(2);
    expect(c.limited).toBe(true);
    expect(c.zoneLabel).toBe('Belfort (Bourgogne-Franche-Comté)');
  });

  it('Lyon bien couvert ⇒ pas de bandeau ; fiche sans ville ⇒ pas de contrôle', () => {
    const snaps = Array.from({ length: 10 }, (_, i) => snap(`l${i}`, i < 9 ? 'Lyon, Auvergne-Rhône-Alpes, France' : 'Paris'));
    expect(coverageOf('Lyon', snaps).limited).toBe(false);
    expect(coverageOf(null, snaps)).toEqual({ zoneLabel: null, inZone: 0, total: 10, limited: false });
  });
});

describe('vue de liste', () => {
  const search = (id: string, createdAt: string): SourcingSearch => ({
    id, campaignId: 'CAMP-1', query: `q-${id}`, queryGenerated: 'q', queryMethod: 'llm', language: 'fr',
    returned: 100, newAfterDedup: 60, exaCostUsd: 0.097, llmCostUsd: 0, createdAt,
  });
  const stored = (id: string, searchId: string, rank: number, state: 'to_review' | 'reserve'): StoredSourcingProfile => ({
    id, searchId, exaRank: rank, state, snapshot: snap(id, 'Lyon, Auvergne-Rhône-Alpes, France'),
  });

  it('dernière recherche en tête, ordre du moteur, réserve et fin de réserve sur la dernière', () => {
    const v = buildProfilesView(
      [search('old', '2026-09-01T00:00:00Z'), search('new', '2026-09-10T00:00:00Z')],
      [stored('n3', 'new', 3, 'to_review'), stored('n1', 'new', 1, 'to_review'), stored('n9', 'new', 9, 'reserve'), stored('o1', 'old', 1, 'to_review')],
      'Lyon (69)',
    );
    expect(v.groups.map((g) => g.search.id)).toEqual(['new', 'old']);
    expect(v.groups[0]!.profiles.map((p) => p.id)).toEqual(['n1', 'n3']);
    expect(v.reserveCount).toBe(1);
    expect(v.exhausted).toBe(false);
    expect(v.groups[0]!.profiles[0]!.inZone).toBe(true);
  });

  it('réserve vide ⇒ recherche épuisée', () => {
    const v = buildProfilesView([search('s', '2026-09-10T00:00:00Z')], [stored('a', 's', 1, 'to_review')], null);
    expect(v.exhausted).toBe(true);
  });
});
