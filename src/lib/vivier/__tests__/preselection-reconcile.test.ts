import { describe, expect, it } from 'vitest';

import {
  reconcilePreselection,
  type ExistingPreselectionRow,
} from '@/lib/vivier/preselection-reconcile';
import type { ShortlistEntry } from '@/types/vivier-preselection';

function entry(candidateId: string): ShortlistEntry {
  return {
    candidateId,
    nom: candidateId,
    email: `${candidateId}@x.com`,
    matchKind: 'title_semantic',
    matchTerm: null,
    similarity: 0.5,
    skillCoverage: 0,
    skillMatches: [],
    freshnessFactor: 1,
    relevanceScore: 0.5,
    updatedAt: '2026-06-01T00:00:00Z',
    passedFilters: [],
    rank: 1,
    state: 'identified',
    contactedAt: null,
    rejectedAt: null,
    decidedBy: null,
    appliedAt: null,
  };
}

describe('reconcilePreselection — idempotence + préservation des décisions', () => {
  it('table vide ⇒ tout est à upsert, rien à supprimer', () => {
    const r = reconcilePreselection([], [entry('a'), entry('b')]);
    expect(r.toUpsert.map((e) => e.candidateId)).toEqual(['a', 'b']);
    expect(r.toDeleteCandidateIds).toEqual([]);
  });

  it('un identified périmé (absent de la nouvelle short-list) est purgé', () => {
    const existing: ExistingPreselectionRow[] = [
      { candidateId: 'stale', state: 'identified' },
      { candidateId: 'keep', state: 'identified' },
    ];
    const r = reconcilePreselection(existing, [entry('keep'), entry('new')]);
    expect(r.toUpsert.map((e) => e.candidateId).sort()).toEqual(['keep', 'new']);
    expect(r.toDeleteCandidateIds).toEqual(['stale']);
  });

  it('un candidat DÉCIDÉ (contacted/rejected) n’est jamais ressuscité ni supprimé', () => {
    const existing: ExistingPreselectionRow[] = [
      { candidateId: 'contacted', state: 'contacted' },
      { candidateId: 'rejected', state: 'rejected' },
      { candidateId: 'old', state: 'identified' },
    ];
    // La nouvelle short-list re-propose les décidés + un nouveau : les décidés
    // doivent être exclus de l'upsert et JAMAIS supprimés ; l'ancien identified
    // disparu est purgé.
    const r = reconcilePreselection(existing, [
      entry('contacted'),
      entry('rejected'),
      entry('fresh'),
    ]);
    expect(r.toUpsert.map((e) => e.candidateId)).toEqual(['fresh']);
    // 'old' purgé ; les décidés intouchés (ni delete ni upsert).
    expect(r.toDeleteCandidateIds).toEqual(['old']);
  });

  it('idempotence : même short-list rejouée ⇒ ni purge ni doublon', () => {
    const existing: ExistingPreselectionRow[] = [
      { candidateId: 'a', state: 'identified' },
      { candidateId: 'b', state: 'identified' },
    ];
    const r = reconcilePreselection(existing, [entry('a'), entry('b')]);
    expect(r.toUpsert.map((e) => e.candidateId).sort()).toEqual(['a', 'b']);
    expect(r.toDeleteCandidateIds).toEqual([]);
  });
});
