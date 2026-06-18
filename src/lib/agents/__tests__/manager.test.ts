import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  chatComplete: vi.fn(),
}));

vi.mock('@/lib/storage/job-descriptions', () => ({
  searchExistingJobDescriptions: vi.fn(async () => []),
}));

import { chatComplete } from '@/lib/ai/provider';
import {
  CLARIFICATION_THRESHOLD,
  ManagerError,
  MANAGER_AGENT_ID,
  buildManagerSituation,
  buildOtherIntentResponse,
  ensureNonEmptyMessage,
  ensureProposalAnchor,
  ensureReadOnlyChips,
  generateCampaignId,
  runManagerTurn,
  type ConversationTurn,
} from '@/lib/agents/manager';
import { buildIntentClassificationPrompt } from '@/lib/agents/manager-prompts';
import { searchExistingJobDescriptions } from '@/lib/storage/job-descriptions';
import { buildEmptyFDP, FIELD_KEYS } from '@/types/field-collection';

const chatCompleteMock = vi.mocked(chatComplete);
const searchMock = vi.mocked(searchExistingJobDescriptions);

type FakeCompletion = Awaited<ReturnType<typeof chatComplete>>;

function fakeCompletion(
  content: string,
  overrides: Partial<FakeCompletion> = {},
): FakeCompletion {
  return {
    content,
    model: 'gpt-4o-mini',
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    costEstimate: 0.001,
    durationMs: 100,
    ...overrides,
  };
}

const VALID_INTENT = JSON.stringify({
  intent: 'new_campaign',
  confidence: 0.92,
  reasoning: 'Le DRH demande explicitement un recrutement.',
  needsClarification: false,
  // Le message nomme le poste → le classifier le renvoie ; le verrou
  // « demande d'abord le poste » ne doit donc PAS se déclencher.
  specifiedRole: 'Comptable senior',
});

const VALID_RESPONSE = JSON.stringify({
  message: "Je m'en occupe. Quelle est la séniorité visée ?",
  chips: { placement: 'below_bubble', options: ['junior', 'confirmé', 'senior'] },
  fieldExtractions: { job_title: 'Comptable senior' },
});

const SIMPLE_HISTORY: ConversationTurn[] = [
  { role: 'user', content: 'Je veux recruter un comptable senior à Paris.' },
];

describe('ensureNonEmptyMessage', () => {
  it('remplace un message blanc par une relance', () => {
    const out = ensureNonEmptyMessage({ message: '   ' });
    expect(out.message).toMatch(/reformuler/i);
  });
  it('laisse intact un message non vide', () => {
    const out = ensureNonEmptyMessage({ message: 'Bonjour' });
    expect(out.message).toBe('Bonjour');
  });
  it('buildOtherIntentResponse propose des chips d’amorçage', () => {
    expect(buildOtherIntentResponse().chips?.options).toHaveLength(2);
  });
});

describe('ensureProposalAnchor — « Ajuster » a toujours un champ cible', () => {
  // FDP dont tous les champs jusqu'à start_date sont remplis : le premier
  // champ encore à collecter est donc main_missions.
  function fdpUpToStartDate() {
    const fdp = buildEmptyFDP('CAMP-2026-077');
    for (const key of [
      'job_title',
      'seniority',
      'contract_type',
      'location',
      'salary_range',
      'start_date',
    ] as const) {
      fdp.fields[key]!.status = 'filled';
    }
    return fdp;
  }

  // FDP complète (les 8 champs remplis) → récap final.
  function fdpComplete() {
    const fdp = buildEmptyFDP('CAMP-2026-077');
    for (const key of FIELD_KEYS) fdp.fields[key]!.status = 'filled';
    fdp.isComplete = true;
    return fdp;
  }

  it('ancre proposalField sur l’unique champ extrait (fallback above_input)', () => {
    const out = ensureProposalAnchor(
      {
        message: 'Voici une proposition de missions.',
        chips: { placement: 'above_input', options: ['Continuer', 'Ajuster'] },
        fieldExtractions: { main_missions: ['Piloter la clôture'] },
      },
      buildEmptyFDP('CAMP-2026-077'),
    );
    expect(out.proposalField).toBe('main_missions');
  });

  it('ancre sur le premier champ manquant quand aucune extraction', () => {
    const out = ensureProposalAnchor(
      {
        message: 'On passe aux missions.',
        chips: { placement: 'above_input', options: ['Continuer', 'Ajuster'] },
      },
      fdpUpToStartDate(),
    );
    expect(out.proposalField).toBe('main_missions');
  });

  it('respecte un proposalField déjà posé par le LLM', () => {
    const out = ensureProposalAnchor(
      {
        message: 'Compétences clés ?',
        chips: { placement: 'inline', options: ['Ajuster'] },
        proposalField: 'key_skills',
      },
      fdpUpToStartDate(),
    );
    expect(out.proposalField).toBe('key_skills');
  });

  it('proposition double-écriture (≥2 extractions, FDP incomplète) → ancre sur le DERNIER champ extrait (a′)', () => {
    // Le DRH répond « Paris » ; le LLM extrait location (réponse) + salary_range
    // (prochain défaut proposé) et OUBLIE proposalField. La cible « Ajuster » est
    // le champ PROPOSÉ = le dernier dans l'ordre canonique (salary_range), pas
    // location (que le DRH vient de remplir).
    const out = ensureProposalAnchor(
      {
        message: 'Paris, noté. Pour la rémunération, je propose 45-55K.',
        chips: { placement: 'above_input', options: ['Continuer', 'Ajuster'] },
        fieldExtractions: { location: 'Paris', salary_range: '45-55K' },
      },
      buildEmptyFDP('CAMP-2026-077'),
    );
    expect(out.proposalField).toBe('salary_range');
  });

  it('ne touche pas un RÉCAP FINAL (FDP isComplete) → multi-édition conservée', () => {
    const out = ensureProposalAnchor(
      {
        message: 'Récap de la fiche, à valider ou ajuster.',
        chips: { placement: 'below_bubble', options: ['Valider la fiche', 'Ajuster'] },
        fieldExtractions: {
          job_title: 'Comptable',
          seniority: 'senior',
          contract_type: 'CDI',
          location: 'Paris',
          salary_range: '45-55K',
          start_date: 'septembre 2026',
          main_missions: ['Clôture'],
          key_skills: ['IFRS'],
        },
      },
      fdpComplete(),
    );
    expect(out.proposalField).toBeUndefined();
  });

  it('ne touche pas un DUMP RÉUTILISATION L1 (≥7 extractions, FDP incomplète) → multi-édition', () => {
    const out = ensureProposalAnchor(
      {
        message: "J'ai retrouvé une fiche archivée, je la reprends.",
        chips: { placement: 'below_bubble', options: ['Valider telle quelle', 'Examiner'] },
        fieldExtractions: {
          job_title: 'Comptable',
          seniority: 'senior',
          contract_type: 'CDI',
          location: 'Paris',
          salary_range: '45-55K',
          start_date: 'septembre 2026',
          main_missions: ['Clôture'],
        },
      },
      buildEmptyFDP('CAMP-2026-077'),
    );
    expect(out.proposalField).toBeUndefined();
  });

  it('ne touche pas une réponse sans chips (prose libre / éclaircissement)', () => {
    const out = ensureProposalAnchor(
      { message: 'Pouvez-vous préciser le périmètre ?' },
      fdpUpToStartDate(),
    );
    expect(out.proposalField).toBeUndefined();
  });

  it('ne touche pas hors collecte FDP (pas de FDP)', () => {
    const out = ensureProposalAnchor(
      {
        message: 'Bonjour !',
        chips: { placement: 'above_input', options: ['Continuer', 'Ajuster'] },
      },
      null,
    );
    expect(out.proposalField).toBeUndefined();
  });
});

describe('manager — constants and helpers', () => {
  it('exports MANAGER_AGENT_ID and CLARIFICATION_THRESHOLD', () => {
    expect(MANAGER_AGENT_ID).toBe('agent.manager-rh');
    expect(CLARIFICATION_THRESHOLD).toBeGreaterThan(0);
    expect(CLARIFICATION_THRESHOLD).toBeLessThan(1);
  });

  it('generateCampaignId returns CAMP-YYYY-NNN for campaign intents', () => {
    const year = new Date().getFullYear();
    expect(generateCampaignId('new_campaign')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
    expect(generateCampaignId('campaign_followup')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
    expect(generateCampaignId('reporting_request')).toMatch(
      new RegExp(`^CAMP-${year}-\\d{3}$`),
    );
  });

  it('generateCampaignId returns TASK-YYYY-NNN for out_of_campaign_task', () => {
    const year = new Date().getFullYear();
    expect(generateCampaignId('out_of_campaign_task')).toMatch(
      new RegExp(`^TASK-${year}-\\d{3}$`),
    );
  });
});

describe('manager-prompts — content', () => {
  it('intent prompt lists the five canonical intents', () => {
    const prompt = buildIntentClassificationPrompt();
    for (const intent of [
      'new_campaign',
      'campaign_followup',
      'out_of_campaign_task',
      'reporting_request',
      'other',
    ]) {
      expect(prompt).toContain(intent);
    }
    expect(prompt).toContain('needsClarification');
  });
});

describe('runManagerTurn — formulation lecture seule', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  it('classifie PUIS formule (2 appels LLM) et VERROUILLE toute écriture', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      // VALID_RESPONSE contient fieldExtractions → le code DOIT les supprimer.
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));
    const result = await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });
    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
    expect(result.classification.intent).toBe('new_campaign');
    expect(result.response.message).toContain('séniorité');
    // Verrou lecture seule : aucune écriture ne sort, même émise par le LLM.
    expect(result.response.fieldExtractions).toBeUndefined();
    expect(result.response.proposalField).toBeUndefined();
  });

  it('injecte la cartographie produit dans le prompt de formulation', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(JSON.stringify({ message: 'ok' })));
    await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });
    const system = chatCompleteMock.mock.calls[1]![0].messages[0]!
      .content as string;
    expect(system).toContain('CARTOGRAPHIE PRODUIT');
    expect(system).toContain('Nouvelle campagne'); // libellé réel d'UI
    expect(system).toMatch(/LECTURE SEULE/);
  });

  it('campaign_followup : charge le snapshot et injecte une section Données', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'campaign_followup',
            confidence: 0.9,
            reasoning: 'suivi',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(JSON.stringify({ message: 'Le point.' })));
    const loadReportingSnapshot = vi.fn(async () => null);
    await runManagerTurn({
      history: [{ role: 'user', content: 'où en est la campagne ?' }],
      fdp: null,
      loadReportingSnapshot,
    });
    expect(loadReportingSnapshot).toHaveBeenCalledTimes(1);
    const system = chatCompleteMock.mock.calls[1]![0].messages[0]!
      .content as string;
    expect(system).toMatch(/Données|récupérer les données/);
  });

  it('injecte une paire de chips d’orientation si le LLM n’en met pas', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: 'Réponse sans chips.' })),
      );
    const result = await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });
    expect(result.response.chips?.options).toHaveLength(2);
  });

  it('pas de chips imposés si l’utilisateur demande une explication libre', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'other',
            confidence: 0.9,
            reasoning: 'q',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(JSON.stringify({ message: 'Voici pourquoi…' })));
    const result = await runManagerTurn({
      history: [{ role: 'user', content: 'explique-moi pourquoi' }],
      fdp: null,
    });
    expect(result.response.chips).toBeUndefined();
  });

  it('agrège les métriques des deux appels LLM', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(VALID_INTENT, {
          durationMs: 200,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          costEstimate: 0.002,
        }),
      )
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: 'ok' }), {
          durationMs: 350,
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          costEstimate: 0.003,
        }),
      );
    const result = await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });
    expect(result.metrics.durationMs).toBe(550);
    expect(result.metrics.tokensUsed).toBe(70);
    expect(result.metrics.costEstimate).toBeCloseTo(0.005, 5);
  });

  it('throws ManagerError on invalid intent JSON', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('not-json'));
    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toBeInstanceOf(ManagerError);
  });

  it('throws ManagerError si la formulation renvoie une forme invalide', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(JSON.stringify({ message: '' })));
    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toMatchObject({ name: 'ManagerError' });
  });
});

describe('buildManagerSituation', () => {
  it('oriente new_campaign vers la création sans agir', () => {
    const s = buildManagerSituation('new_campaign', false);
    expect(s).toMatch(/création|créer/i);
    expect(s).toMatch(/ne la crées pas/i);
  });
  it('demande de narrer les chiffres réels pour campaign_followup', () => {
    expect(buildManagerSituation('campaign_followup', false)).toMatch(
      /chiffres réels/i,
    );
  });
  it('ajoute une consigne de clarification quand l’intention est ambiguë', () => {
    expect(buildManagerSituation('other', true)).toMatch(/AMBIGUË/);
  });
});

describe('ensureReadOnlyChips', () => {
  it('injecte une paire d’orientation si chips absents', () => {
    const out = ensureReadOnlyChips({ message: 'x' }, 'crée une campagne');
    expect(out.chips?.options).toEqual([
      'Faire un point sur une campagne',
      'Analyser un CV',
    ]);
  });
  it('laisse la prose libre si l’utilisateur demande une explication', () => {
    const out = ensureReadOnlyChips({ message: 'x' }, 'explique-moi pourquoi');
    expect(out.chips).toBeUndefined();
  });
  it('préserve les chips fournis par le LLM', () => {
    const out = ensureReadOnlyChips(
      { message: 'x', chips: { placement: 'below_bubble', options: ['A', 'B'] } },
      'salut',
    );
    expect(out.chips?.options).toEqual(['A', 'B']);
  });
});
