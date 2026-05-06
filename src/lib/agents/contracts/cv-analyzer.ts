import {
  buildCVAnalyzerSystemPrompt,
  buildCVAnalyzerUserPrompt,
} from '@/lib/agents/cv-analyzer-prompts';
import { chatComplete } from '@/lib/ai/provider';
import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import {
  CVAnalysisCriteriaSchema,
  CVAnalysisResultSchema,
  DEFAULT_CV_THRESHOLD,
  type CVAnalysisResult,
} from '@/types/cv-analysis';
import type { TaskInput, TaskOutput } from '@/types/task';

export const cvAnalyzerData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.cv-analyzer',
  name: 'CV Analyzer',
  role: 'Analyse les CV reçus, en extrait un profil structuré et le score selon les critères de campagne.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/analyst.glb',
    position: [-3, 0, -2],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'punctual', source: 'upload' },
  humanValidation: { required: false, enabled: false },
  skills: [
    {
      id: 'skill.parse-cv',
      name: 'Parsing CV',
      description: 'Extrait un profil structuré depuis un CV (PDF ou texte).',
      inputs: [
        {
          id: 'in.cv',
          source: 'upload',
          format: 'pdf|text',
          description: 'Fichier CV ou texte brut.',
        },
      ],
      outputs: [
        {
          id: 'out.profile',
          source: 'cv-analyzer',
          format: 'candidate-profile',
          description: 'Profil structuré du candidat.',
        },
      ],
    },
    {
      id: 'skill.score-candidate',
      name: 'Scoring',
      description: 'Note le candidat (0–100) face aux critères de la campagne.',
      inputs: [
        {
          id: 'in.profile',
          source: 'cv-analyzer',
          format: 'candidate-profile',
          description: 'Profil structuré.',
        },
        {
          id: 'in.criteria',
          source: 'campaign',
          format: 'campaign-criteria',
          description: 'Critères de la campagne.',
        },
      ],
      outputs: [
        {
          id: 'out.score',
          source: 'cv-analyzer',
          format: 'json',
          description: 'Score + synthèse + justifications.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.cv',
      source: 'upload',
      format: 'pdf|text',
      description: 'CV à analyser.',
    },
    {
      id: 'in.criteria',
      source: 'campaign',
      format: 'campaign-criteria',
      description: 'Critères de la campagne associée.',
    },
  ],
  outputs: [
    {
      id: 'out.candidate',
      source: 'cv-analyzer',
      format: 'json',
      description: 'Candidat enrichi (profil + score + synthèse).',
    },
  ],
});

export class CVAnalyzerError extends Error {
  constructor(
    public readonly code:
      | 'invalid_payload'
      | 'invalid_response'
      | 'empty_cv',
    message: string,
  ) {
    super(message);
    this.name = 'CVAnalyzerError';
  }
}

export const cvAnalyzerAgent: AgentContract = {
  ...cvAnalyzerData,
  execute: async (input: TaskInput): Promise<TaskOutput> => {
    const cvText = input.payload?.cvText;
    const fileName = input.payload?.fileName;
    const criteriaRaw = input.payload?.criteria;
    const thresholdRaw = input.payload?.threshold;

    if (typeof cvText !== 'string' || cvText.trim().length === 0) {
      throw new CVAnalyzerError(
        'empty_cv',
        'Le CV fourni est vide ou illisible.',
      );
    }
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new CVAnalyzerError('invalid_payload', 'fileName manquant.');
    }

    let criteria;
    try {
      criteria = CVAnalysisCriteriaSchema.parse(criteriaRaw ?? {});
    } catch (err) {
      throw new CVAnalyzerError(
        'invalid_payload',
        err instanceof Error ? err.message : 'Critères invalides.',
      );
    }

    const threshold =
      typeof thresholdRaw === 'number' &&
      thresholdRaw >= 0 &&
      thresholdRaw <= 100
        ? thresholdRaw
        : DEFAULT_CV_THRESHOLD;

    const completion = await chatComplete({
      model: 'gpt-4o',
      jsonMode: true,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildCVAnalyzerSystemPrompt(threshold) },
        {
          role: 'user',
          content: buildCVAnalyzerUserPrompt({ cvText, criteria, fileName }),
        },
      ],
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(completion.content);
    } catch (err) {
      throw new CVAnalyzerError(
        'invalid_response',
        err instanceof Error ? err.message : 'Réponse non JSON.',
      );
    }

    let result: CVAnalysisResult;
    try {
      result = CVAnalysisResultSchema.parse({
        ...((parsed ?? {}) as Record<string, unknown>),
        fileName,
      });
    } catch (err) {
      throw new CVAnalyzerError(
        'invalid_response',
        err instanceof Error ? err.message : 'Réponse mal formée.',
      );
    }

    // Garde-fou : aboveThreshold doit toujours refléter le seuil serveur,
    // même si le LLM s'est trompé.
    const finalAboveThreshold = result.score >= threshold;
    if (finalAboveThreshold !== result.aboveThreshold) {
      result = { ...result, aboveThreshold: finalAboveThreshold };
    }

    return {
      taskId: input.taskId,
      status: 'success',
      data: { result, threshold },
      metrics: {
        durationMs: completion.durationMs,
        tokensUsed: completion.usage.totalTokens,
        costEstimate: completion.costEstimate,
      },
      nextAgents: [],
    };
  },
};
