import {
  buildJobAdSystemPrompt,
  buildJobAdUserPrompt,
} from '@/lib/agents/job-writer-prompts';
import { chatComplete } from '@/lib/ai/provider';
import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import { FDPInProgressSchema } from '@/types/field-collection';
import { JobAdResultSchema, type JobAdResult } from '@/types/job-writer';
import type { TaskInput, TaskOutput } from '@/types/task';

export const jobWriterData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.job-writer',
  name: 'Job Writer',
  role: 'Rédige les annonces d’emploi optimisées par plateforme cible.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/creative.glb',
    position: [-3, 0, 2],
    animations: ['idle', 'working', 'talking', 'thinking'],
  },
  enabled: true,
  status: 'idle',
  trigger: { type: 'punctual', source: 'workflow' },
  humanValidation: { required: true, enabled: true },
  skills: [
    {
      id: 'skill.write-job-ad',
      name: 'Rédaction annonce',
      description: 'Produit une annonce d’emploi adaptée à la plateforme cible et au ton demandé.',
      inputs: [
        {
          id: 'in.job-spec',
          source: 'workflow',
          format: 'json',
          description: 'Fiche de poste structurée.',
        },
        {
          id: 'in.tone',
          source: 'workflow',
          format: 'enum',
          description: 'Ton de la rédaction (formal | startup | tech | inclusive).',
        },
        {
          id: 'in.platform',
          source: 'workflow',
          format: 'enum',
          description: 'Plateforme cible (linkedin | welcome-to-the-jungle | indeed | apec).',
        },
      ],
      outputs: [
        {
          id: 'out.ad',
          source: 'job-writer',
          format: 'json',
          description: 'Annonce avec title + body + tags.',
        },
      ],
    },
  ],
  inputs: [
    {
      id: 'in.job-spec',
      source: 'workflow',
      format: 'json',
      description: 'Fiche de poste.',
    },
    {
      id: 'in.tone',
      source: 'workflow',
      format: 'enum',
      description: 'Ton souhaité.',
    },
    {
      id: 'in.platform',
      source: 'workflow',
      format: 'enum',
      description: 'Plateforme cible.',
    },
  ],
  outputs: [
    {
      id: 'out.ad',
      source: 'job-writer',
      format: 'json',
      description: 'Annonce optimisée prête à publier.',
    },
  ],
});

export class JobWriterError extends Error {
  constructor(
    public readonly code: 'invalid_payload' | 'invalid_response',
    message: string,
  ) {
    super(message);
    this.name = 'JobWriterError';
  }
}

export const jobWriterAgent: AgentContract = {
  ...jobWriterData,
  execute: async (input: TaskInput): Promise<TaskOutput> => {
    const fdpRaw = input.payload?.fdp;
    let fdp;
    try {
      fdp = FDPInProgressSchema.parse(fdpRaw);
    } catch (err) {
      throw new JobWriterError(
        'invalid_payload',
        err instanceof Error ? err.message : 'Invalid FDP payload.',
      );
    }

    const completion = await chatComplete({
      model: 'gpt-4o',
      jsonMode: true,
      temperature: 0.5,
      messages: [
        { role: 'system', content: buildJobAdSystemPrompt() },
        { role: 'user', content: buildJobAdUserPrompt(fdp) },
      ],
    });

    let ad: JobAdResult;
    try {
      ad = JobAdResultSchema.parse(JSON.parse(completion.content));
    } catch (err) {
      throw new JobWriterError(
        'invalid_response',
        err instanceof Error ? err.message : 'Invalid Job Writer response.',
      );
    }

    return {
      taskId: input.taskId,
      status: 'success',
      data: { ad },
      metrics: {
        durationMs: completion.durationMs,
        tokensUsed: completion.usage.totalTokens,
        costEstimate: completion.costEstimate,
      },
      nextAgents: [],
    };
  },
};
