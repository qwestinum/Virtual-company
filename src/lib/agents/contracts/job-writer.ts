import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
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

/**
 * Stub côté contrat. La vraie exécution vit dans
 * `src/lib/agents/server/job-writer-execute.ts` (server-only) pour ne
 * pas polluer le bundle client via la chaîne d'imports du registry.
 * Les routes API (/api/job-writer) appellent directement
 * `executeJobWriter`.
 */
export const jobWriterAgent: AgentContract = {
  ...jobWriterData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
