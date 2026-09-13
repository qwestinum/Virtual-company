/**
 * Aucun montant ne quitte le serveur vers l'écran du recruteur : la rédaction
 * de la requête journalise son coût pour l'administration et le RETIRE de la
 * réponse ; la recherche l'enregistre en base et ne le renvoie pas.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourcing/server/route-guard', () => ({
  guardSourcingCampaign: vi.fn(async () => ({
    ok: true,
    value: { user: { id: 'u1', email: 'r@x.fr' }, campaign: { fdp: { fields: {} }, scoringSheet: null } },
  })),
}));
vi.mock('@/lib/sourcing/server/generate-query', () => ({
  generateSourcingQuery: vi.fn(async () => ({
    query: 'Business Analyst confirmé, secteur financier, parcours digitaux et UX, basé à Paris',
    encoded: [],
    notEncoded: [],
    method: 'llm',
    language: 'fr',
    fallbackReason: null,
    llmCostUsd: 0.0058,
  })),
}));
vi.mock('@/lib/sourcing/server/run-search', () => ({
  runSourcingSearch: vi.fn(async () => ({
    searchId: 's1',
    returned: 100,
    unusable: 0,
    toReview: 50,
    reserve: 50,
    skipped: { alreadySeen: 0, excluded: 0, opposed: 0, duplicates: 0 },
  })),
}));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));

import { POST as generateQuery } from '@/app/api/sourcing/campaigns/[id]/query/route';
import { POST as runSearch } from '@/app/api/sourcing/campaigns/[id]/searches/route';
import { appendJournalEntry } from '@/lib/db/repos/journal';

const params = { params: Promise.resolve({ id: 'CAMP-2026-293' }) };
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });

describe('réponses des routes du recruteur', () => {
  it('rédaction de requête : pas de coût dans la réponse, coût journalisé pour l’administration', async () => {
    const res = await generateQuery(post({ language: 'fr' }), params);
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toMatch(/cost|coût/i);
    expect(vi.mocked(appendJournalEntry).mock.calls.at(-1)![0]).toMatchObject({
      action: 'sourcing_query_generated',
      payload: { llmCostUsd: 0.0058 },
    });
  });

  it('recherche : pas de coût dans la réponse, et un coût envoyé par le client est ignoré', async () => {
    const res = await runSearch(
      post({ query: 'Business Analyst à Paris', queryGenerated: 'x', queryMethod: 'llm', language: 'fr', llmCostUsd: 99 }),
      params,
    );
    expect(res.status).toBe(200);
    expect(await res.text()).not.toMatch(/cost|coût/i);
  });
});
