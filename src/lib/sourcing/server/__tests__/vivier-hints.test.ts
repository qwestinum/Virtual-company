/**
 * Indice « peut-être déjà dans votre vivier » : lectures parallélisées et
 * groupées, MÊME résultat que la boucle séquentielle d'origine (ordre des
 * homonymes, repli ligne à ligne, arrêt sur lot en erreur). Base simulée.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; nom: string; prenom: string | null; companies: string[] };
type Op = [string, ...unknown[]];

const state: {
  rows: Row[];
  failNameQueryContaining: string | null;
  failGroupedTextSearch: boolean;
  textSearchCalls: string[][];
} = { rows: [], failNameQueryContaining: null, failGroupedTextSearch: false, textSearchCalls: [] };

function run(ops: Op[]): { data: unknown; error: { message: string } | null } {
  const or = ops.find((o) => o[0] === 'or');
  if (or) {
    const filter = String(or[1]);
    if (state.failNameQueryContaining && filter.includes(state.failNameQueryContaining)) {
      return { data: null, error: { message: 'boom' } };
    }
    const lasts = filter.split(',').map((f) => f.replace('nom.ilike.', '').toLowerCase());
    return { data: state.rows.filter((r) => lasts.includes(r.nom.toLowerCase())), error: null };
  }
  const ts = ops.find((o) => o[0] === 'textSearch')!;
  const inOp = ops.find((o) => o[0] === 'in');
  const eqOp = ops.find((o) => o[0] === 'eq');
  const ids = inOp ? (inOp[2] as string[]) : [eqOp![2] as string];
  state.textSearchCalls.push(ids);
  if (state.failGroupedTextSearch && ids.length > 1) return { data: null, error: { message: 'ts' } };
  const company = String(ts[2]);
  return {
    data: state.rows.filter((r) => ids.includes(r.id) && r.companies.includes(company)).map((r) => ({ id: r.id })),
    error: null,
  };
}

function builder() {
  const ops: Op[] = [];
  const b = {
    select: (...a: unknown[]) => (ops.push(['select', ...a]), b),
    or: (...a: unknown[]) => (ops.push(['or', ...a]), b),
    in: (...a: unknown[]) => (ops.push(['in', ...a]), b),
    eq: (...a: unknown[]) => (ops.push(['eq', ...a]), b),
    limit: (...a: unknown[]) => (ops.push(['limit', ...a]), b),
    textSearch: (...a: unknown[]) => (ops.push(['textSearch', ...a]), b),
    then: <T>(resolve: (v: ReturnType<typeof run>) => T) => Promise.resolve(run(ops)).then(resolve),
  };
  return b;
}

vi.mock('@/lib/db/supabase-server', () => ({ requireServerSupabase: () => ({ from: () => builder() }) }));

import { findVivierHints, firstFound, sameNameRows } from '@/lib/sourcing/server/vivier-hints';
import type { SourcingProfileView } from '@/types/sourcing';

const profile = (id: string, name: string, company: string | null): SourcingProfileView =>
  ({
    id,
    searchId: 's',
    exaRank: 1,
    state: 'to_review',
    inZone: null,
    snapshot: { name, firstName: null, current: company ? { title: 'x', company, since: null } : null },
  }) as unknown as SourcingProfileView;

beforeEach(() => {
  state.rows = [];
  state.failNameQueryContaining = null;
  state.failGroupedTextSearch = false;
  state.textSearchCalls = [];
});

describe('helpers purs', () => {
  it('sameNameRows : nom ET prénom repliés, ordre conservé', () => {
    const rows = [
      { id: '1', nom: 'MARTIN', prenom: 'Claire' },
      { id: '2', nom: 'Martin', prenom: null },
      { id: '3', nom: 'Martín', prenom: 'CLAIRE' },
      { id: '4', nom: 'Martin', prenom: 'Paul' },
    ];
    expect(sameNameRows(rows, { first: 'claire', last: 'Martin' }).map((r) => r.id)).toEqual(['1', '3']);
  });

  it('firstFound : le premier dans l’ordre demandé', () => {
    expect(firstFound(['a', 'b', 'c'], new Set(['c', 'b']))).toBe('b');
    expect(firstFound(['a'], new Set())).toBeNull();
  });
});

describe('findVivierHints', () => {
  it('retient le premier homonyme (ordre des lignes) dont le CV cite l’entreprise, en une requête groupée', async () => {
    state.rows = [
      { id: 'v1', nom: 'Martin', prenom: 'Claire', companies: [] },
      { id: 'v2', nom: 'Martin', prenom: 'Claire', companies: ['Banque X'] },
      { id: 'v3', nom: 'Martin', prenom: 'Claire', companies: ['Banque X'] },
      { id: 'v4', nom: 'Durand', prenom: 'Paul', companies: ['Autre'] },
    ];
    const hints = await findVivierHints([
      profile('p1', 'Claire Martin', 'Banque X'),
      profile('p2', 'Paul Durand', 'Banque X'),
      profile('p3', 'Zoé Sans', null),
    ]);
    expect(Object.fromEntries(hints)).toEqual({ p1: 'v2' });
    expect(state.textSearchCalls).toEqual([['v1', 'v2', 'v3'], ['v4']]);
  });

  it('requête groupée en erreur ⇒ repli ligne à ligne, même résultat', async () => {
    state.failGroupedTextSearch = true;
    state.rows = [
      { id: 'v1', nom: 'Martin', prenom: 'Claire', companies: [] },
      { id: 'v2', nom: 'Martin', prenom: 'Claire', companies: ['Banque X'] },
    ];
    const hints = await findVivierHints([profile('p1', 'Claire Martin', 'Banque X')]);
    expect(Object.fromEntries(hints)).toEqual({ p1: 'v2' });
  });

  it('un lot de noms en erreur : indices des lots précédents gardés, rien au-delà', async () => {
    const profiles = Array.from({ length: 81 }, (_, i) => profile(`p${i}`, `Ana Nom${i}`, 'Acme'));
    state.rows = profiles.map((_, i) => ({ id: `v${i}`, nom: `Nom${i}`, prenom: 'Ana', companies: ['Acme'] }));
    state.failNameQueryContaining = 'Nom45';
    const hints = await findVivierHints(profiles);
    expect(hints.size).toBe(40);
    expect(hints.get('p0')).toBe('v0');
    expect(hints.has('p80')).toBe(false);
  });
});
