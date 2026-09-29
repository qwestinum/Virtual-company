import { describe, expect, it } from 'vitest';

import { isIdentityKey } from '@/lib/gdpr/identity-keys';

import type { FileResult } from '../pipeline';
import { batchJournalPayload, renderDetail, renderSummary, tally } from '../report';

const NAMED = 'CV Jean Dupont — jean.dupont@exemple.fr.pdf';
const results: FileResult[] = [
  { batchId: 'vimp-1-1', displayPath: `lot:${NAMED}`, outcome: 'imported', detail: null },
  { batchId: 'vimp-1-1', displayPath: 'lot:b.pdf', outcome: 'duplicate_email', detail: 'même adresse déjà dans le vivier' },
  { batchId: 'vimp-1-1', displayPath: 'lot:c.pdf', outcome: 'no_email', detail: null },
];

describe('rapports de l’import', () => {
  it('le rapport ne porte AUCUN nom de fichier', () => {
    const counts = tally(results, 2, 1);
    const text = renderSummary(counts, {
      runId: 'vimp-1',
      execute: true,
      projectRef: 'abc',
      startedAt: '2026-09-29T10:00:00Z',
      durationMs: 1000,
      batches: 1,
      withDates: false,
      estimatedUsd: { low: 1, mid: 2, high: 3 },
      actualUsd: 1.5,
      interrupted: false,
    });
    expect(text).not.toContain('Dupont');
    expect(text).not.toContain('b.pdf');
    expect(text).toContain('| importés et indexés | 1 |');
    expect(text).toContain('| archives illisibles | 1 |');
  });

  it('le détail, lui, liste chaque fichier avec sa raison', () => {
    const text = renderDetail(results, [{ displayPath: 'x.doc', reason: 'format .doc' }], [{ label: 'z.zip', reason: 'chiffrée' }]);
    expect(text).toContain(NAMED);
    expect(text).toContain('x.doc — format .doc');
    expect(text).toContain('z.zip — chiffrée');
  });

  it('le journal ne reçoit que des nombres et l’identifiant OPAQUE du lot', () => {
    const payload = batchJournalPayload('vimp-1-1', 'vimp-1', tally(results, 2, 0), false);
    expect(payload).toMatchObject({ batchId: 'vimp-1-1', count: 1, duplicates: 1, skipped: 3, failed: 0 });
    for (const [key, value] of Object.entries(payload)) {
      expect(isIdentityKey(key)).toBe(false);
      if (typeof value === 'string') expect(value).toMatch(/^vimp-[\w-]+$/u);
    }
  });
});
