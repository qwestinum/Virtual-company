import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import { buildEmptyFDP } from '@/types/field-collection';
import { buildCriterion, type ScoringSheet } from '@/types/scoring';
import { EMPTY_VIVIER_ENTITIES, type VivierEntities } from '@/types/vivier';
import type { IndexedVivierCandidate } from '@/lib/db/repos/vivier';

const campaigns = { getCampaign: vi.fn() };
const vivierRepo = {
  listIndexedVivierEntities: vi.fn(),
  matchVivierCandidates: vi.fn(),
};
const analyses = { listCandidateAnalyses: vi.fn() };
const presel = {
  replacePreselection: vi.fn(),
  listContactedEmailsSince: vi.fn(),
  listRejectedEmailsForCampaign: vi.fn(),
};
const settings = { getAppSettings: vi.fn() };
const ai = { embedText: vi.fn() };

vi.mock('@/lib/db/repos/campaigns', () => campaigns);
vi.mock('@/lib/db/repos/vivier', () => vivierRepo);
vi.mock('@/lib/db/repos/candidate-analyses', () => analyses);
vi.mock('@/lib/db/repos/vivier-preselection', () => presel);
vi.mock('@/lib/db/repos/app-settings', () => settings);
vi.mock('@/lib/ai/embeddings', () => ai);
vi.mock('@/lib/vivier/candidates', () => ({
  normalizeEmail: (s: string) => s.trim().toLowerCase(),
}));

const NOW = Date.parse('2027-06-15T00:00:00Z');

function sheet(criteria: ScoringSheet['criteria'] = []): ScoringSheet {
  return { campaignId: 'CAMP-1', isValidated: true, criteria };
}

/** FDP avec un intitulé renseigné (texte de requête sémantique non vide). */
function fdpWithTitle() {
  const fdp = buildEmptyFDP('CAMP-1');
  fdp.fields.job_title = { ...fdp.fields.job_title, value: 'Développeur' };
  return fdp;
}

function campaign(over: Partial<ActiveCampaign> = {}): ActiveCampaign {
  return {
    id: 'CAMP-1',
    name: 'Camp',
    sources: ['vivier'],
    scoringSheet: sheet(),
    fdp: fdpWithTitle(),
    ...over,
  } as unknown as ActiveCampaign;
}

function cand(
  id: string,
  over: Partial<IndexedVivierCandidate> = {},
): IndexedVivierCandidate {
  return {
    id,
    nom: id,
    email: `${id}@x.com`,
    updatedAt: '2027-06-01T00:00:00Z',
    entities: { ...EMPTY_VIVIER_ENTITIES },
    ...over,
  };
}

function ent(over: Partial<VivierEntities>): VivierEntities {
  return { ...EMPTY_VIVIER_ENTITIES, ...over };
}

beforeEach(() => {
  [campaigns, vivierRepo, analyses, presel, settings, ai].forEach((m) =>
    Object.values(m).forEach((f) => f.mockReset()),
  );
  analyses.listCandidateAnalyses.mockResolvedValue([]);
  presel.replacePreselection.mockResolvedValue(undefined);
  presel.listContactedEmailsSince.mockResolvedValue([]);
  presel.listRejectedEmailsForCampaign.mockResolvedValue([]);
  settings.getAppSettings.mockResolvedValue(null); // → DEFAULT_VIVIER_CONFIG
  ai.embedText.mockResolvedValue({ vector: [0.1, 0.2] });
});
afterEach(() => vi.restoreAllMocks());

describe('runVivierPreselection — cascade', () => {
  it('tri sémantique : classement par similarité décroissante + rangs', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([
      cand('c1'),
      cand('c2'),
      cand('c3'),
    ]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['c1', 0.9],
        ['c2', 0.5],
        ['c3', 0.8],
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(res.map((e) => e.candidateId)).toEqual(['c1', 'c3', 'c2']);
    expect(res.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('modulation fraîcheur : un dossier ancien est dégradé sous un plus récent', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([
      cand('old', { updatedAt: '2020-01-01T00:00:00Z' }),
      cand('recent', { updatedAt: '2027-06-01T00:00:00Z' }),
    ]);
    // 'old' a une meilleure similarité brute, mais sa fraîcheur (plancher 0.5)
    // le fait passer derrière 'recent'.
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['old', 0.8],
        ['recent', 0.6],
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(res.map((e) => e.candidateId)).toEqual(['recent', 'old']);
    expect(res[1].freshnessFactor).toBe(0.5);
    expect(res[1].relevanceScore).toBeCloseTo(0.4, 5);
  });

  it('filtres durs : élimine les non conformes, n’embedde que les survivants', async () => {
    campaigns.getCampaign.mockResolvedValue(
      campaign({
        scoringSheet: sheet([
          buildCriterion({
            id: 'k',
            label: 'Java',
            level: 'redhibitoire',
            verificationMethod: 'keywords_exact',
            keywords: ['Java'],
          }),
        ]),
      }),
    );
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([
      cand('java', { entities: ent({ technologies: ['Java'] }) }),
      cand('python', { entities: ent({ technologies: ['Python'] }) }),
    ]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(new Map([['java', 0.7]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(res.map((e) => e.candidateId)).toEqual(['java']);
    expect(res[0].passedFilters[0].matchedTerms).toEqual(['Java']);
    // Seuls les survivants du filtre dur sont passés à la RPC sémantique.
    expect(vivierRepo.matchVivierCandidates.mock.calls[0][1]).toEqual(['java']);
  });

  it('repli sémantique : si les filtres durs écartent tout, on classe l’ensemble (signalé)', async () => {
    campaigns.getCampaign.mockResolvedValue(
      campaign({
        scoringSheet: sheet([
          buildCriterion({
            id: 'k',
            label: 'Java',
            level: 'redhibitoire',
            verificationMethod: 'keywords_exact',
            keywords: ['Java'],
          }),
        ]),
      }),
    );
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([
      cand('python', { entities: ent({ technologies: ['Python'] }) }),
    ]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(new Map([['python', 0.6]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries, meta } = await runVivierPreselection('CAMP-1', { now: NOW });

    // Personne ne passe le filtre dur, mais pas d'écran vide : repli sémantique
    // sur tout l'indexé (sans filtre dur ⇒ passedFilters vide), signalé.
    expect(entries.map((e) => e.candidateId)).toEqual(['python']);
    expect(entries[0].passedFilters).toEqual([]);
    expect(meta.fallbackSemantic).toBe(true);
    expect(meta.eliminatedByHardFilters).toBe(1);
    expect(ai.embedText).toHaveBeenCalled();
  });

  it('vivier vide ⇒ short-list vide, pas d’embedding ni de repli', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([]);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries, meta } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries).toEqual([]);
    expect(meta.fallbackSemantic).toBe(false);
    expect(ai.embedText).not.toHaveBeenCalled();
  });

  it('exclusion : un candidat déjà candidat sur la campagne (email) est écarté', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([
      cand('c1'),
      cand('c2'),
    ]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['c1', 0.9],
        ['c2', 0.8],
      ]),
    );
    analyses.listCandidateAnalyses.mockResolvedValue([
      { candidateEmail: 'C1@x.com' }, // casse différente : normalisé
    ]);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(res.map((e) => e.candidateId)).toEqual(['c2']);
  });

  it('cooldown global : un candidat contacté récemment (autre campagne) est exclu', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([cand('c1'), cand('c2')]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['c1', 0.9],
        ['c2', 0.8],
      ]),
    );
    presel.listContactedEmailsSince.mockResolvedValue(['c1@x.com']);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });
    expect(res.map((e) => e.candidateId)).toEqual(['c2']);
  });

  it('rejeté pour cette campagne ⇒ exclu de cette campagne', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([cand('c1'), cand('c2')]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['c1', 0.9],
        ['c2', 0.8],
      ]),
    );
    presel.listRejectedEmailsForCampaign.mockResolvedValue(['c1@x.com']);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });
    expect(res.map((e) => e.candidateId)).toEqual(['c2']);
  });

  it('échéance cooldown : fenêtre = now − cooldownDays (défaut 90 j)', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([cand('c1')]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(new Map([['c1', 0.9]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await runVivierPreselection('CAMP-1', { now: NOW });

    const expected = new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString();
    expect(presel.listContactedEmailsSince).toHaveBeenCalledWith(expected);
  });

  it('plafond appliqué depuis les settings (remplace la constante V2)', async () => {
    settings.getAppSettings.mockResolvedValue({
      vivierConfig: {
        contactMode: 'manual',
        invitationTemplate: 't',
        cooldownDays: 90,
        shortlistCap: 2,
        organisationName: '',
      },
    });
    campaigns.getCampaign.mockResolvedValue(campaign());
    const many = [cand('c1'), cand('c2'), cand('c3')];
    vivierRepo.listIndexedVivierEntities.mockResolvedValue(many);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map([
        ['c1', 0.9],
        ['c2', 0.8],
        ['c3', 0.7],
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });
    expect(res).toHaveLength(2);
    expect(res.map((e) => e.candidateId)).toEqual(['c1', 'c2']);
  });

  it('plafonne la short-list au défaut (50) sans settings', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    const many = Array.from({ length: 55 }, (_, i) => cand(`c${i}`));
    vivierRepo.listIndexedVivierEntities.mockResolvedValue(many);
    vivierRepo.matchVivierCandidates.mockResolvedValue(
      new Map(many.map((c, i) => [c.id, (55 - i) / 55])),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries: res } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(res).toHaveLength(50);
    expect(res[49].rank).toBe(50);
  });

  it('recherche libre : embedde le texte saisi (cascade identique)', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([cand('c1')]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(new Map([['c1', 0.9]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await runVivierPreselection('CAMP-1', {
      now: NOW,
      freeText: 'profil devops senior bancaire',
    });

    expect(ai.embedText).toHaveBeenCalledWith('profil devops senior bancaire');
    // La recherche libre ne persiste rien (l'appelant gère).
    expect(presel.replacePreselection).not.toHaveBeenCalled();
  });

  it('garde : source Vivier non cochée ⇒ PreselectionError', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign({ sources: ['email'] }));
    const { runVivierPreselection, PreselectionError } = await import(
      '@/lib/vivier/preselection'
    );
    await expect(runVivierPreselection('CAMP-1')).rejects.toBeInstanceOf(
      PreselectionError,
    );
  });

  it('garde : fiche non validée ⇒ PreselectionError', async () => {
    campaigns.getCampaign.mockResolvedValue(
      campaign({ scoringSheet: { ...sheet(), isValidated: false } }),
    );
    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await expect(runVivierPreselection('CAMP-1')).rejects.toMatchObject({
      code: 'no_validated_sheet',
    });
  });

  it('garde : campagne introuvable ⇒ PreselectionError', async () => {
    campaigns.getCampaign.mockResolvedValue(null);
    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await expect(runVivierPreselection('CAMP-1')).rejects.toMatchObject({
      code: 'campaign_not_found',
    });
  });
});

describe('runAndPersistPreselection', () => {
  it('persiste la short-list calculée (relance idempotente déléguée au repo)', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign());
    vivierRepo.listIndexedVivierEntities.mockResolvedValue([cand('c1')]);
    vivierRepo.matchVivierCandidates.mockResolvedValue(new Map([['c1', 0.9]]));

    const { runAndPersistPreselection } = await import(
      '@/lib/vivier/preselection'
    );
    const { entries } = await runAndPersistPreselection('CAMP-1', { now: NOW });

    expect(presel.replacePreselection).toHaveBeenCalledWith('CAMP-1', entries);
    expect(entries.map((e) => e.candidateId)).toEqual(['c1']);
  });
});
