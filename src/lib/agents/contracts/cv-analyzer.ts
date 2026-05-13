import {
  AgentContractDataSchema,
  type AgentContract,
  type AgentContractData,
} from '@/types/agent';
import type { TaskInput, TaskOutput } from '@/types/task';

export const cvAnalyzerData: AgentContractData = AgentContractDataSchema.parse({
  id: 'agent.cv-analyzer',
  name: 'CV Analyzer',
  role: 'Analyse les CV reçus, en extrait un profil structuré et le score selon les critères de campagne.',
  department: 'rh',
  avatar: {
    modelUrl: '/models/analyst.glb',
    position: [-2.85, 0, -0.43],
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

/**
 * Stub côté contrat. La vraie exécution vit dans
 * `src/lib/agents/server/cv-analyzer-execute.ts` (server-only).
 */
export const cvAnalyzerAgent: AgentContract = {
  ...cvAnalyzerData,
  execute: async (_input: TaskInput): Promise<TaskOutput> => {
    throw new Error('NOT_IMPLEMENTED');
  },
};
