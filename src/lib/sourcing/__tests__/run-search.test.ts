/**
 * Une recherche de bout en bout, moteur et base simulés : ce qui est enregistré,
 * ce qui ne l'est pas, et ce que le journal porte — aucune donnée personnelle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/sourcing/server/exa', () => ({ EXA_NUM_RESULTS: 100, searchPeople: vi.fn() }));
vi.mock('@/lib/db/repos/journal', () => ({ appendJournalEntry: vi.fn(async () => {}) }));
vi.mock('@/lib/db/repos/sourcing', () => ({
  insertSourcingSearch: vi.fn(async () => 'search-1'),
  insertSourcingProfiles: vi.fn(async () => {}),
  listKnownFingerprints: vi.fn(),
}));

import { appendJournalEntry } from '@/lib/db/repos/journal';
import { insertSourcingProfiles, insertSourcingSearch, listKnownFingerprints } from '@/lib/db/repos/sourcing';
import { ExaResultSchema } from '@/lib/sourcing/exa-schema';
import { normalizeProfileUrl, profileFingerprint } from '@/lib/sourcing/fingerprint';
import { searchPeople } from '@/lib/sourcing/server/exa';
import { runSourcingSearch } from '@/lib/sourcing/server/run-search';

const PEPPER = 'sel-de-test';
const url = (i: number) => `https://www.linkedin.com/in/profil-${i}`;
const fpOf = (i: number) => profileFingerprint(normalizeProfileUrl(url(i))!, PEPPER);

const result = (i: number) =>
  ExaResultSchema.parse({
    url: url(i),
    title: `Personne Numéro${i}`,
    text: `# Personne Numéro${i}\nConsultant\n## About\nAMOA\n## Social\nrepost d'un tiers`,
    entities: [{ properties: { name: `Personne Numéro${i}`, location: 'Paris, Île-de-France, France' } }],
  });

beforeEach(() => {
  process.env.SOURCING_FINGERPRINT_PEPPER = PEPPER;
  vi.mocked(insertSourcingProfiles).mockClear();
  vi.mocked(appendJournalEntry).mockClear();
  vi.mocked(insertSourcingSearch).mockClear();
  vi.mocked(searchPeople).mockResolvedValue({
    requestId: 'req-1',
    costUsd: 0.097,
    results: [
      ...Array.from({ length: 60 }, (_, k) => ({ rank: k + 1, result: result(k + 1) })),
      { rank: 61, result: ExaResultSchema.parse({ url: 'https://www.linkedin.com/company/banque-x', title: 'Banque X' }) },
    ],
    unreadable: 1,
    latencyMs: 1200,
  });
  vi.mocked(listKnownFingerprints).mockResolvedValue({
    seen: new Set([fpOf(1)]),
    excluded: new Set([fpOf(2)]), // décliné sur la campagne
    opposed: new Set([fpOf(3)]), // opposition, toutes campagnes
  });
});

const input = {
  campaignId: 'CAMP-2026-001',
  userId: 'u1',
  actorEmail: 'recruteur@cabinet.fr',
  query: 'Consultant AMOA senior à Paris, finance de marché',
  queryGenerated: 'Consultant AMOA senior, finance de marché, basé à Paris',
  queryMethod: 'llm' as const,
  language: 'fr' as const,
  llmCostUsd: 0.0004,
};

describe('runSourcingSearch', () => {
  it('n’enregistre ni le déjà vu, ni le décliné, ni l’opposé ; 50 à examiner puis réserve', async () => {
    const r = await runSourcingSearch(input);
    const rows = vi.mocked(insertSourcingProfiles).mock.calls[0]![1];
    const fps = rows.map((p) => p.fingerprint);
    expect(fps).not.toContain(fpOf(1));
    expect(fps).not.toContain(fpOf(2));
    expect(fps).not.toContain(fpOf(3));
    expect(rows).toHaveLength(57);
    expect(rows.filter((p) => p.state === 'to_review')).toHaveLength(50);
    expect(rows[0]!.exaRank).toBe(4); // l'ordre du moteur, les écartés en moins
    expect(r.skipped).toEqual({ alreadySeen: 1, excluded: 1, opposed: 1, duplicates: 0 });
    expect(r.unusable).toBe(2); // une page d'entreprise + un résultat illisible
  });

  it('l’empreinte stockée est salée, jamais l’adresse', async () => {
    await runSourcingSearch(input);
    const rows = vi.mocked(insertSourcingProfiles).mock.calls[0]![1];
    for (const row of rows) expect(row.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(rows.map((r) => r.fingerprint))).not.toContain('linkedin');
    expect(JSON.stringify(rows)).not.toContain("repost d'un tiers");
  });

  it('la requête envoyée ET la requête générée sont enregistrées avec la recherche', async () => {
    await runSourcingSearch(input);
    expect(vi.mocked(insertSourcingSearch).mock.calls[0]![0]).toMatchObject({
      query: input.query,
      queryGenerated: input.queryGenerated,
      queryMethod: 'llm',
      requested: 100,
      exaCostUsd: 0.097,
    });
  });

  it('le journal ne porte aucune donnée personnelle, et dit si la requête a été corrigée', async () => {
    await runSourcingSearch(input);
    const entry = vi.mocked(appendJournalEntry).mock.calls[0]![0];
    expect(entry.action).toBe('sourcing_search_run');
    const payload = JSON.stringify(entry.payload);
    expect(payload).not.toMatch(/Personne|Numéro|linkedin|Paris/);
    expect(entry.payload).toMatchObject({ queryEdited: true, newAfterDedup: 57 });
  });
});
