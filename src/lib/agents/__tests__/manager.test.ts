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
  buildOtherIntentResponse,
  ensureNonEmptyMessage,
  ensureProposalAnchor,
  generateCampaignId,
  runManagerTurn,
  type ConversationTurn,
} from '@/lib/agents/manager';
import {
  buildConversationalPrompt,
  buildIntentClassificationPrompt,
} from '@/lib/agents/manager-prompts';
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

  it('conversational prompt includes the closed list of 8 fields', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    for (const key of [
      'job_title',
      'seniority',
      'contract_type',
      'location',
      'salary_range',
      'start_date',
      'main_missions',
      'key_skills',
    ]) {
      expect(prompt).toContain(key);
    }
    expect(prompt).toContain('LISTE FERMÉE');
  });

  it('conversational prompt instructs 2-3 canonical chips when needsClarification', () => {
    const prompt = buildConversationalPrompt({
      intent: 'other',
      confidence: 0.4,
      needsClarification: true,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('CLARIFICATION');
    expect(prompt).toContain('2 à 3 chips');
    expect(prompt).toContain('below_bubble');
  });

  it('conversational prompt mentions empty pre-search hint', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('Aucune fiche archivée');
  });

  it('first campaign turn: verbalise la pré-recherche mais interdit l’annonce d’échec sans poste', () => {
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null,
      preSearchHits: [],
    });
    expect(prompt).toContain('VERBALISATION');
    expect(prompt).toMatch(/PREMIER tour/i);
    // Garde-fou : jamais « pas trouvé de fiche » tant qu'aucun poste nommé.
    expect(prompt).toMatch(/jamais/i);
    expect(prompt).toMatch(/pas trouvé de fiche/i);
  });

  it('skips pre-search verbalization once at least one field is filled', () => {
    const fdp = buildEmptyFDP('CAMP-2026-099');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable',
      status: 'filled',
    };
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp,
      preSearchHits: [],
    });
    expect(prompt).not.toContain('VERBALISATION OBLIGATOIRE');
  });

  it('mode réutilisation L1 : conserve l’intitulé DEMANDÉ, pas celui de l’archive', () => {
    const archived = buildEmptyFDP('CAMP-2026-ARCH');
    archived.fields.job_title = {
      ...archived.fields.job_title!,
      value: 'Comptable senior',
      status: 'filled',
    };
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp: null, // premier tour de cadrage → MODE RÉUTILISATION L1
      preSearchHits: [
        {
          id: 'a1',
          title: 'Comptable senior',
          archivedAt: '2026-01-01T00:00:00.000Z',
          fdp: archived,
        },
      ],
    });
    expect(prompt).toContain('MODE RÉUTILISATION L1');
    // RÈGLE 1bis : job_title = intitulé demandé, JAMAIS celui de l'archive.
    expect(prompt).toMatch(/RÈGLE 1bis/);
    expect(prompt).toMatch(/intitulé EXACT que le DRH vient de demander/i);
    expect(prompt).toMatch(/PAS celui de la fiche archivée/i);
  });

  it('conversational prompt formats FDP state when present', () => {
    const fdp = buildEmptyFDP('CAMP-2026-014');
    const prompt = buildConversationalPrompt({
      intent: 'new_campaign',
      confidence: 0.9,
      needsClarification: false,
      fdp,
      preSearchHits: [],
    });
    expect(prompt).toContain('CAMP-2026-014');
    expect(prompt).toContain('isComplete: false');
  });
});

describe('runManagerTurn — orchestration', () => {
  beforeEach(() => {
    chatCompleteMock.mockReset();
    searchMock.mockReset();
    searchMock.mockResolvedValue([]);
  });

  it('chains intent classification then conversational response', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
    expect(result.classification.intent).toBe('new_campaign');
    expect(result.response.message).toContain('séniorité');
    expect(result.response.chips?.options).toContain('junior');
    expect(result.response.fieldExtractions?.job_title).toBe('Comptable senior');
  });

  it('démarrage de recrutement SANS poste → demande l’intitulé, sans appeler le LLM conversationnel ni la pré-recherche', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'new_campaign',
          confidence: 0.95,
          reasoning: 'Demande de recrutement sans poste précisé.',
          needsClarification: false,
          specifiedRole: null,
        }),
      ),
    );

    const result = await runManagerTurn({
      history: [{ role: 'user', content: 'je veux un recrutement' }],
      fdp: null,
    });

    // Verrou déterministe : un seul appel LLM (la classification), pas de
    // tour conversationnel.
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(searchMock).not.toHaveBeenCalled();
    expect(result.response.message).toMatch(/pour quel poste/i);
    // Surtout PAS la réponse absurde.
    expect(result.response.message).not.toMatch(/pas trouvé/i);
    expect(result.preSearchHits).toEqual([]);
  });

  it('intention `other` (salutation) → recadrage déterministe sans LLM conversationnel', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'other',
          confidence: 0.9,
          reasoning: 'Salutation.',
          needsClarification: false,
        }),
      ),
    );
    const result = await runManagerTurn({
      history: [{ role: 'user', content: 'bonjour' }],
      fdp: null,
    });
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.response.message).toMatch(/Manager RH/i);
    expect(result.response.chips?.options).toContain('Lancer un recrutement');
  });

  it('intention `out_of_campaign_task` → redirection déterministe, sans TASK ni LLM conversationnel', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'out_of_campaign_task',
          confidence: 0.9,
          reasoning: 'Demande atomique hors campagne.',
          needsClarification: false,
        }),
      ),
    );

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'prépare-moi juste une fiche de poste isolée' },
      ],
      fdp: null,
    });

    // Un seul appel LLM (la classification) — pas de tour conversationnel.
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.classification.intent).toBe('out_of_campaign_task');
    // Aucune TASK-XXXX créée.
    expect(result.campaignId).toBeNull();
    // Redirection polie vers la création de campagne, avec chips.
    expect(result.response.message).toMatch(/n'est pas disponible/i);
    expect(result.response.chips?.options).toContain('Lancer un recrutement');
    expect(result.preSearchHits).toEqual([]);
    expect(result.pendingSwitch).toBeNull();
  });

  it('out_of_campaign_task gaté même avec une FDP en cours (pas de switch vers une TASK)', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'out_of_campaign_task',
          confidence: 0.95,
          reasoning: 'Bascule explicite vers une tâche isolée.',
          needsClarification: false,
          isDistinctNewCampaign: true,
          candidateNewJobTitle: 'Développeur',
        }),
      ),
    );

    const fdp = buildEmptyFDP('CAMP-2026-077');
    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'en fait prépare juste une fiche isolée pour un développeur' },
      ],
      fdp,
    });

    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.pendingSwitch).toBeNull();
    expect(result.response.message).toMatch(/n'est pas disponible/i);
    // On conserve l'id de campagne courant, pas de TASK générée.
    expect(result.campaignId).toBe('CAMP-2026-077');
  });

  it('promotes needsClarification when confidence < CLARIFICATION_THRESHOLD', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.4,
            reasoning: 'Hésitation entre new_campaign et out_of_campaign_task.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            message: "Voulez-vous lancer une campagne complète ou simplement préparer une fiche ?",
            chips: {
              placement: 'below_bubble',
              options: ['Lancer une campagne', 'Préparer une fiche'],
            },
          }),
        ),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.classification.confidence).toBe(0.4);
    expect(result.classification.needsClarification).toBe(true);
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('calls searchExistingJobDescriptions for new_campaign without clarification', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    await runManagerTurn({ history: SIMPLE_HISTORY, fdp: null });

    expect(searchMock).toHaveBeenCalledOnce();
    expect(searchMock).toHaveBeenCalledWith(SIMPLE_HISTORY[0].content);
  });

  it('skips pre-search for non-campaign intents', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'reporting_request',
            confidence: 0.9,
            reasoning: 'Le DRH demande un point.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: 'Je vous prépare le bilan.' })),
      );

    await runManagerTurn({
      history: [{ role: 'user', content: 'Fais-moi un point.' }],
      fdp: null,
    });

    expect(searchMock).not.toHaveBeenCalled();
  });

  it('mints a CAMP-XXXX id for new_campaign without existing fdp', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.campaignId).toMatch(/^CAMP-\d{4}-\d{3}$/);
  });

  it('keeps the existing fdp.campaignId when fdp is provided (empty job_title)', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    const result = await runManagerTurn({ history: SIMPLE_HISTORY, fdp });

    expect(result.campaignId).toBe('CAMP-2026-042');
    expect(result.pendingSwitch).toBeNull();
  });

  it('triggers deterministic switch dialog when FDP has job_title + new_campaign high confidence + isDistinctNewCampaign + candidate', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'new_campaign',
          confidence: 0.92,
          reasoning: 'Le DRH bascule sur un autre poste.',
          needsClarification: false,
          isDistinctNewCampaign: true,
          candidateNewJobTitle: 'Commercial',
        }),
      ),
    );

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable senior',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Comptable senior à Paris.' },
        { role: 'manager', content: 'Pour la fourchette, je propose 50-65K.' },
        { role: 'user', content: 'En fait je veux recruter un commercial.' },
      ],
      fdp,
    });

    // Court-circuit : seul l'appel de classification est fait, pas le tour conversationnel.
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.pendingSwitch).not.toBeNull();
    expect(result.pendingSwitch?.currentCampaignId).toBe('CAMP-2026-042');
    expect(result.pendingSwitch?.currentJobTitle).toBe('Comptable senior');
    expect(result.pendingSwitch?.currentStatus).toBe('draft');
    expect(result.pendingSwitch?.proposedCampaignId).toMatch(
      /^CAMP-\d{4}-\d{3}$/,
    );
    expect(result.pendingSwitch?.proposedCampaignId).not.toBe('CAMP-2026-042');
    // Le campaignId du tour reste celui de la campagne courante.
    expect(result.campaignId).toBe('CAMP-2026-042');
    // Réponse déterministe : message + chips canoniques.
    expect(result.response.chips?.options).toEqual([
      'Oui, nouvelle campagne',
      'Non, je continue',
    ]);
    expect(result.response.chips?.placement).toBe('below_bubble');
    expect(result.response.message).toContain('Comptable senior');
  });

  it('switch dialog mentions validated status when current FDP is validated', async () => {
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'new_campaign',
          confidence: 0.92,
          reasoning: 'Le DRH bascule sur un autre poste.',
          needsClarification: false,
          isDistinctNewCampaign: true,
          candidateNewJobTitle: 'Commercial',
        }),
      ),
    );

    const fdp = {
      ...buildEmptyFDP('CAMP-2026-042'),
      isComplete: true,
      isValidated: true,
    };
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable senior',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Maintenant je veux recruter un commercial.' },
      ],
      fdp,
    });

    expect(result.pendingSwitch?.currentStatus).toBe('validated');
    expect(result.response.message).toContain('déjà validée');
  });

  it('does NOT trigger switch dialog when LLM hallucinates isDistinctNewCampaign=true but no candidateNewJobTitle (e.g. user said "ok")', async () => {
    // Cas réel observé : le LLM peut renvoyer isDistinctNewCampaign=true
    // à tort sur un message court (« ok », « oui ») à cause de la
    // pollution de l'historique. Le garde-fou serveur exige aussi un
    // candidateNewJobTitle non vide pour déclencher le switch.
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.9,
            reasoning: "L'historique parle de plusieurs postes.",
            needsClarification: false,
            isDistinctNewCampaign: true,
            candidateNewJobTitle: null,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Développeur Python',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'En fait je veux un développeur python.' },
        { role: 'manager', content: 'Quelle séniorité ?' },
        { role: 'user', content: 'ok' },
      ],
      fdp,
    });

    expect(result.pendingSwitch).toBeNull();
    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT trigger switch dialog when candidate matches current job_title (case-insensitive)', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.9,
            reasoning: 'Le DRH répète le même poste.',
            needsClarification: false,
            isDistinctNewCampaign: true,
            candidateNewJobTitle: 'comptable',
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [{ role: 'user', content: 'on continue sur Comptable.' }],
      fdp,
    });

    expect(result.pendingSwitch).toBeNull();
  });

  it('triggers switch dialog via keyword fallback when LLM is conservative (no candidate, isDistinct=false)', async () => {
    // Cas réel observé : DRH dit « non en fait je veux lancer une
    // campagne » sans nommer le poste cible. Le LLM met isDistinct=false
    // et candidate=null par excès de prudence. Le keyword « lancer une
    // campagne » suffit à déclencher le switch côté serveur.
    chatCompleteMock.mockResolvedValueOnce(
      fakeCompletion(
        JSON.stringify({
          intent: 'new_campaign',
          confidence: 0.9,
          reasoning: 'Le DRH demande une nouvelle campagne.',
          needsClarification: false,
          isDistinctNewCampaign: false,
          candidateNewJobTitle: null,
        }),
      ),
    );

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Développeur Python',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Développeur Python' },
        { role: 'manager', content: 'Quelle séniorité ?' },
        { role: 'user', content: 'non en fait je veux lancer une campagne' },
      ],
      fdp,
    });

    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    expect(result.pendingSwitch).not.toBeNull();
    expect(result.pendingSwitch?.currentJobTitle).toBe('Développeur Python');
  });

  it('does NOT trigger switch via keyword when message is just a short reply ("senior")', async () => {
    // Garde-fou : keyword n'est jamais matché par des réponses
    // courantes de collecte. Le LLM dit isDistinct=true par erreur,
    // mais aucun keyword → pas de switch.
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.9,
            reasoning: 'Faux positif hypothétique.',
            needsClarification: false,
            isDistinctNewCampaign: true,
            candidateNewJobTitle: null,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Développeur Python',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Développeur Python' },
        { role: 'manager', content: 'Quelle séniorité ?' },
        { role: 'user', content: 'senior' },
      ],
      fdp,
    });

    expect(result.pendingSwitch).toBeNull();
  });

  it('does NOT trigger switch dialog when DRH continues collection on the same job (isDistinctNewCampaign omitted)', async () => {
    // Reproduit le bug : pendant la collecte FDP, le DRH répond
    // « senior » à une question. Le classifier voit toute la conv
    // comme « new_campaign » mais isDistinctNewCampaign reste false
    // (ou omis) → le switch ne doit PAS se déclencher.
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.9,
            reasoning: 'La conversation reste dans le contexte de cadrage.',
            needsClarification: false,
            isDistinctNewCampaign: false,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Je veux recruter un comptable.' },
        { role: 'manager', content: 'Quelle séniorité ?' },
        { role: 'user', content: 'senior' },
      ],
      fdp,
    });

    // Pas de switch — le tour conversationnel LLM est appelé normalement.
    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
    expect(result.pendingSwitch).toBeNull();
  });

  it('does NOT trigger switch dialog when FDP has no job_title yet', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp,
    });

    // FDP vide ⇒ pas de switch ⇒ deux appels LLM (classification + tour conversationnel)
    expect(chatCompleteMock).toHaveBeenCalledTimes(2);
    expect(result.pendingSwitch).toBeNull();
    expect(result.campaignId).toBe('CAMP-2026-042');
  });

  it('does NOT trigger switch dialog when intent confidence is below threshold', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            intent: 'new_campaign',
            confidence: 0.55,
            reasoning: 'Hésitation.',
            needsClarification: false,
          }),
        ),
      )
      .mockResolvedValueOnce(fakeCompletion(VALID_RESPONSE));

    const fdp = buildEmptyFDP('CAMP-2026-042');
    fdp.fields.job_title = {
      ...fdp.fields.job_title!,
      value: 'Comptable senior',
      status: 'filled',
    };

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp,
    });

    expect(result.pendingSwitch).toBeNull();
    expect(result.campaignId).toBe('CAMP-2026-042');
  });

  it('aggregates metrics across both LLM calls', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(
        fakeCompletion(VALID_INTENT, {
          durationMs: 200,
          usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
          costEstimate: 0.002,
        }),
      )
      .mockResolvedValueOnce(
        fakeCompletion(VALID_RESPONSE, {
          durationMs: 350,
          usage: { promptTokens: 15, completionTokens: 25, totalTokens: 40 },
          costEstimate: 0.003,
        }),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.metrics.durationMs).toBe(550);
    expect(result.metrics.tokensUsed).toBe(70);
    expect(result.metrics.costEstimate).toBeCloseTo(0.005, 5);
  });

  it('cleans null chips/fieldExtractions but injects fallback chips when missing', async () => {
    // Le LLM renvoie chips/fieldExtractions à null → on les déserialise
    // proprement (les rendre undefined avant zod). Puis la Phase 2
    // garde-fou ensureChipsPresent injecte la paire fallback
    // Continuer/Ajuster placement above_input (le dernier message DRH
    // n'est pas une demande d'éclaircissement).
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            message: 'Quelles sont les missions principales ?',
            chips: null,
            fieldExtractions: null,
          }),
        ),
      );

    const result = await runManagerTurn({
      history: SIMPLE_HISTORY,
      fdp: null,
    });

    expect(result.response.fieldExtractions).toBeUndefined();
    expect(result.response.chips).toEqual({
      placement: 'above_input',
      options: ['Continuer', 'Ajuster'],
    });
  });

  it('does NOT inject fallback chips when DRH asks for clarification', async () => {
    // Exception unique à la règle « chips toujours » : si le dernier
    // message DRH contient un keyword d'éclaircissement (« explique »,
    // « pourquoi », « précise »…), le Manager peut répondre en prose
    // libre sans chips.
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(
          JSON.stringify({
            message:
              "La fourchette dépend du niveau d'expérience et de la localisation…",
          }),
        ),
      );

    const result = await runManagerTurn({
      history: [
        { role: 'user', content: 'Je veux recruter un comptable senior.' },
        {
          role: 'manager',
          content: 'Pour la fourchette, je propose 50-65K.',
        },
        { role: 'user', content: "Pourquoi cette fourchette ? Explique-moi." },
      ],
      fdp: null,
    });

    expect(result.response.chips).toBeUndefined();
  });

  it('throws ManagerError on invalid intent JSON', async () => {
    chatCompleteMock.mockResolvedValueOnce(fakeCompletion('not-json'));

    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toBeInstanceOf(ManagerError);
  });

  it('throws ManagerError on invalid response shape', async () => {
    chatCompleteMock
      .mockResolvedValueOnce(fakeCompletion(VALID_INTENT))
      .mockResolvedValueOnce(
        fakeCompletion(JSON.stringify({ message: '' })),
      );

    await expect(
      runManagerTurn({ history: SIMPLE_HISTORY, fdp: null }),
    ).rejects.toMatchObject({ name: 'ManagerError' });
  });
});
