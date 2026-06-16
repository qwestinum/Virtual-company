import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveCampaign } from '@/stores/campaigns-store';
import { buildEmptyFDP } from '@/types/field-collection';
import type { IndexedVivierTitle } from '@/lib/db/repos/vivier';

const campaigns = { getCampaign: vi.fn() };
const vivierRepo = {
  listIndexedVivierTitles: vi.fn(),
  matchVivierTitles: vi.fn(),
  listDistinctEmbeddingModels: vi.fn(),
  listSkillEmbeddingsByCandidateIds: vi.fn(),
};
const analyses = { listCandidateAnalyses: vi.fn() };
const presel = {
  replacePreselection: vi.fn(),
  listContactedEmailsSince: vi.fn(),
  listRejectedEmailsForCampaign: vi.fn(),
};
const settings = { getAppSettings: vi.fn() };
const ai = { embedText: vi.fn() };
const variants = { runTitleVariantsSuggestion: vi.fn() };

vi.mock('@/lib/db/repos/campaigns', () => campaigns);
vi.mock('@/lib/db/repos/vivier', () => vivierRepo);
vi.mock('@/lib/db/repos/candidate-analyses', () => analyses);
vi.mock('@/lib/db/repos/vivier-preselection', () => presel);
vi.mock('@/lib/db/repos/app-settings', () => settings);
vi.mock('@/lib/ai/embeddings', () => ai);
vi.mock('@/lib/agents/server/title-variants-execute', () => variants);
vi.mock('@/lib/vivier/candidates', () => ({
  normalizeEmail: (s: string) => s.trim().toLowerCase(),
}));

const NOW = Date.parse('2027-06-15T00:00:00Z');

function fdpWithTitle(title: string) {
  const fdp = buildEmptyFDP('CAMP-1');
  fdp.fields.job_title = { ...fdp.fields.job_title, value: title };
  return fdp;
}

function campaign(over: Partial<ActiveCampaign> = {}): ActiveCampaign {
  return {
    id: 'CAMP-1',
    name: 'Camp',
    sources: ['vivier'],
    fdp: fdpWithTitle('Test Manager'),
    ...over,
  } as unknown as ActiveCampaign;
}

function cand(
  id: string,
  over: Partial<IndexedVivierTitle> = {},
): IndexedVivierTitle {
  return {
    id,
    nom: id,
    email: `${id}@x.com`,
    updatedAt: '2027-06-01T00:00:00Z',
    title: null,
    titleVariants: [],
    titleAnchors: [],
    ...over,
  };
}

beforeEach(() => {
  [campaigns, vivierRepo, analyses, presel, settings, ai, variants].forEach((m) =>
    Object.values(m).forEach((f) => f.mockReset()),
  );
  campaigns.getCampaign.mockResolvedValue(campaign());
  analyses.listCandidateAnalyses.mockResolvedValue([]);
  presel.replacePreselection.mockResolvedValue(undefined);
  presel.listContactedEmailsSince.mockResolvedValue([]);
  presel.listRejectedEmailsForCampaign.mockResolvedValue([]);
  settings.getAppSettings.mockResolvedValue(null); // → DEFAULT (similarityFloor 0.55)
  ai.embedText.mockResolvedValue({
    vector: [0.1, 0.2],
    provider: 'openai',
    model: 'text-embedding-3-small',
  });
  vivierRepo.listDistinctEmbeddingModels.mockResolvedValue([]); // garde-fou inactif
  vivierRepo.matchVivierTitles.mockResolvedValue(new Map());
  vivierRepo.listSkillEmbeddingsByCandidateIds.mockResolvedValue(new Map());
  // Variantes ISO-RÔLE de l'intitulé « Test Manager ».
  variants.runTitleVariantsSuggestion.mockResolvedValue({
    variants: ['QA Manager', 'QA Lead', 'Responsable des tests'],
  });
});
afterEach(() => vi.restoreAllMocks());

describe('runVivierPreselection — cascade titre', () => {
  it('bloc 1 déterministe : variante du titre qui matche ressort, hors-domaine non', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('qaLead', { title: 'QA Lead' }),
      cand('dirCom', { title: 'Directeur Commercial', titleVariants: ['Sales Director'] }),
    ]);
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map([['dirCom', 0.2]])); // < seuil

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries, meta } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries.map((e) => e.candidateId)).toEqual(['qaLead']);
    expect(entries[0].matchKind).toBe('title_exact');
    expect(entries[0].matchTerm).toBe('QA Lead');
    expect(meta.deterministicCount).toBe(1);
  });

  it('non-régression métier : « Directeur Commercial » sort, QA/Test ressortent', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('dirCom', { title: 'Directeur Commercial' }),
      cand('qaLead', { title: 'QA Lead' }), // bloc 1 (variante)
      cand('testMgr', { title: 'Test Manager' }), // bloc 1 (exact)
      cand('qaEng', { title: 'Ingénieur QA' }), // bloc 2 (sémantique)
    ]);
    // Bloc 2 : dirCom loin, qaEng proche.
    vivierRepo.matchVivierTitles.mockResolvedValue(
      new Map([
        ['dirCom', 0.22],
        ['qaEng', 0.74],
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });

    const ids = entries.map((e) => e.candidateId);
    expect(ids).not.toContain('dirCom'); // le directeur commercial disparaît
    expect(ids).toContain('qaLead');
    expect(ids).toContain('testMgr');
    expect(ids).toContain('qaEng');
    // Déterministes (bloc 1) en tête, sémantique (bloc 2) à la suite.
    expect(ids.slice(0, 2).sort()).toEqual(['qaLead', 'testMgr']);
    expect(ids[ids.length - 1]).toBe('qaEng');
  });

  it('bloc 2 : au-dessus du seuil inclus et classés décroissant ; sous le seuil exclus', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('a'),
      cand('b'),
      cand('c'),
    ]);
    variants.runTitleVariantsSuggestion.mockResolvedValue({ variants: [] }); // pas de bloc 1
    vivierRepo.matchVivierTitles.mockResolvedValue(
      new Map([
        ['a', 0.6],
        ['b', 0.8],
        ['c', 0.4], // < 0.55
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries, meta } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries.map((e) => e.candidateId)).toEqual(['b', 'a']);
    expect(entries.every((e) => e.matchKind === 'title_semantic')).toBe(true);
    expect(meta.belowThreshold).toBe(1);
  });

  it('pas de doublon entre blocs : un candidat matché au bloc 1 n’est pas re-testé au bloc 2', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([cand('qaLead', { title: 'QA Lead' })]);
    // Même si la RPC renverrait une similarité, qaLead est déjà au bloc 1.
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map([['qaLead', 0.9]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries.map((e) => e.candidateId)).toEqual(['qaLead']);
    expect(entries[0].matchKind).toBe('title_exact');
    // La RPC n'est appelée qu'avec les NON-retenus du bloc 1 (ici aucun).
    expect(vivierRepo.matchVivierTitles.mock.calls[0][1]).toEqual([]);
  });

  it('volume piloté par la pertinence : aucune troncature à un plafond', async () => {
    const many = Array.from({ length: 60 }, (_, i) => cand(`c${i}`));
    vivierRepo.listIndexedVivierTitles.mockResolvedValue(many);
    variants.runTitleVariantsSuggestion.mockResolvedValue({ variants: [] });
    vivierRepo.matchVivierTitles.mockResolvedValue(
      new Map(many.map((c) => [c.id, 0.7])),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries).toHaveLength(60); // pas de cap à 50
  });

  it('combinaison 70/30 : les compétences RÉORDONNENT les qualifiés (sans en éliminer)', async () => {
    // Deux candidats à ÉGALITÉ de titre (bloc 2, sim 0.7). La fiche attend
    // « Python » : 'a' la couvre, 'b' non. 'a' doit passer devant 'b', mais 'b'
    // reste présent (les compétences ne ferment pas la porte).
    const camp = campaign();
    camp.fdp.fields.key_skills = { ...camp.fdp.fields.key_skills, value: 'Python' };
    campaigns.getCampaign.mockResolvedValue(camp);
    variants.runTitleVariantsSuggestion.mockResolvedValue({ variants: [] }); // pas de bloc 1
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([cand('a'), cand('b')]);
    vivierRepo.matchVivierTitles.mockResolvedValue(
      new Map([['a', 0.7], ['b', 0.7]]),
    );
    // Embeddings orthonormés : la requête skill « Python » = axe 0.
    ai.embedText.mockImplementation(async (text: string) => ({
      vector: text === 'Python' ? [1, 0, 0] : [0.1, 0.2, 0.3],
      provider: 'openai',
      model: 'text-embedding-3-small',
    }));
    vivierRepo.listSkillEmbeddingsByCandidateIds.mockResolvedValue(
      new Map([
        ['a', [{ term: 'Python', vector: [1, 0, 0] }]], // couvre
        ['b', [{ term: 'Java', vector: [0, 1, 0] }]], // ne couvre pas
      ]),
    );

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries.map((e) => e.candidateId)).toEqual(['a', 'b']); // 'a' devant
    expect(entries.find((e) => e.candidateId === 'a')!.skillCoverage).toBeCloseTo(1);
    expect(entries.find((e) => e.candidateId === 'b')!.skillCoverage).toBe(0);
    // 'b' (couverture 0) RESTE qualifié — la porte d'entrée est le titre.
    expect(entries).toHaveLength(2);
  });

  it('ancres : titre déclaré bruité KO, repêché via un POSTE (décote + label)', async () => {
    // Job « Test Manager » → variantes incluent « QA Lead ». Le candidat a un
    // titre déclaré bruité (aucun match) mais un dernier poste dont une variante
    // est « QA Lead » ⇒ match Bloc 1 via l'ancre depth 1.
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('reco', {
        title: 'Ingénieur QL en reconversion vers le DevOps',
        titleAnchors: [
          { text: 'Ingénieur QL en reconversion vers le DevOps', depth: 0, terms: ['ingénieur ql en reconversion vers le devops'] },
          { text: 'Ingénieur Qualité Logicielle', depth: 1, terms: ['Ingénieur Qualité Logicielle', 'QA Lead'] },
        ],
      }),
    ]);
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map());

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries, meta } = await runVivierPreselection('CAMP-1', { now: NOW });

    expect(entries.map((e) => e.candidateId)).toEqual(['reco']);
    expect(entries[0].matchKind).toBe('title_exact');
    expect(entries[0].matchTerm).toBe('QA Lead');
    expect(entries[0].matchAnchorLabel).toBe('Dernier poste');
    // Décote d'ancienneté : similarité = poids du dernier poste (0,95), pas 1.
    expect(entries[0].similarity).toBe(0.95);
    expect(meta.deterministicCount).toBe(1);
  });

  it('décote : à variantes égales, le match TITRE prime sur le match POSTE', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('parTitre', {
        titleAnchors: [{ text: 'QA Lead', depth: 0, terms: ['QA Lead'] }],
      }),
      cand('parPoste', {
        titleAnchors: [
          { text: 'Autre chose', depth: 0, terms: ['autre chose'] },
          { text: 'QA Lead', depth: 1, terms: ['QA Lead'] },
        ],
      }),
    ]);
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map());

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });

    // Même terme « QA Lead », mais le match sur le titre (1.0) passe devant le
    // match sur le poste (0.95).
    expect(entries.map((e) => e.candidateId)).toEqual(['parTitre', 'parPoste']);
  });

  it('rien de pertinent ⇒ short-list vide (réponse valide)', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('x', { title: 'Boulanger' }),
    ]);
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map([['x', 0.1]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });
    expect(entries).toEqual([]);
  });

  it('exclusion : un candidat déjà candidat (email) est écarté des deux blocs', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([
      cand('qaLead', { title: 'QA Lead' }),
    ]);
    analyses.listCandidateAnalyses.mockResolvedValue([
      { candidateEmail: 'QALEAD@x.com' },
    ]);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', { now: NOW });
    expect(entries).toEqual([]);
  });

  it('recherche libre : bloc 2 sémantique seul (pas de déterministe)', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([cand('a', { title: 'QA Lead' })]);
    vivierRepo.matchVivierTitles.mockResolvedValue(new Map([['a', 0.7]]));

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runVivierPreselection('CAMP-1', {
      now: NOW,
      freeText: 'profil QA senior bancaire',
    });

    expect(ai.embedText).toHaveBeenCalledWith('profil QA senior bancaire');
    expect(variants.runTitleVariantsSuggestion).not.toHaveBeenCalled();
    expect(entries.map((e) => e.candidateId)).toEqual(['a']);
    expect(entries[0].matchKind).toBe('title_semantic');
  });

  it('garde : intitulé de poste manquant ⇒ no_job_title', async () => {
    campaigns.getCampaign.mockResolvedValue(campaign({ fdp: buildEmptyFDP('CAMP-1') }));
    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await expect(runVivierPreselection('CAMP-1')).rejects.toMatchObject({
      code: 'no_job_title',
    });
  });

  it('garde : espace d’embeddings incohérent ⇒ embedding_model_mismatch', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([cand('a', { title: 'QA' })]);
    ai.embedText.mockResolvedValue({
      vector: [0.1],
      provider: 'openai',
      model: 'text-embedding-3-large',
    });
    vivierRepo.listDistinctEmbeddingModels.mockResolvedValue([
      'openai|text-embedding-3-small',
    ]);

    const { runVivierPreselection } = await import('@/lib/vivier/preselection');
    await expect(runVivierPreselection('CAMP-1', { now: NOW })).rejects.toMatchObject(
      { code: 'embedding_model_mismatch' },
    );
  });
});

describe('runAndPersistPreselection', () => {
  it('persiste la short-list calculée', async () => {
    vivierRepo.listIndexedVivierTitles.mockResolvedValue([cand('qaLead', { title: 'QA Lead' })]);

    const { runAndPersistPreselection } = await import('@/lib/vivier/preselection');
    const { entries } = await runAndPersistPreselection('CAMP-1', { now: NOW });

    expect(presel.replacePreselection).toHaveBeenCalledWith('CAMP-1', entries);
    expect(entries.map((e) => e.candidateId)).toEqual(['qaLead']);
  });
});
